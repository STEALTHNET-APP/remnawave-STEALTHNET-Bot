// Issue #198: Platega CANCELED -> CONFIRMED for the same transaction must credit once.
// Runs without DB/network: real route + decision module, mocked collaborators.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(path, mocks = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: n => { if (n in mocks) return mocks[n]; return require(n); }, Buffer, console: process.env.DBG ? console : { log() {}, warn() {}, error() {} }, Date, Promise, JSON, Number, Set }); return exports;
}
const T = load('src/modules/webhooks/platega-transition.ts');
const service = load('src/modules/platega/platega.service.ts', {
  './platega-request.js': load('src/modules/platega/platega-request.ts'),
  '../proxy-util/proxy-fetch.js': { proxyFetch: async () => { throw new Error('unexpected network'); } },
  '../proxy-util/get-proxy-url.js': { getProxyUrl: async () => null },
});
const NOW = '2026-10-10T00:00:00.000Z';

// ---- pure decision ----
const canceledMeta = T.withPlategaCancelMarker(null, 'CANCELED', 'tx1', NOW);
assert.equal(T.decidePlategaConfirmed({ status: 'PENDING', metadata: null }, 'tx1', 'confirmed', NOW).kind, 'from_pending');
assert.equal(T.decidePlategaConfirmed({ status: 'PAID', metadata: null }, 'tx1', 'confirmed', NOW).kind, 'already_paid');
const rec = T.decidePlategaConfirmed({ status: 'FAILED', metadata: canceledMeta }, 'tx1', 'confirmed', NOW);
assert.equal(rec.kind, 'recover_failed');
assert.equal(T.readPlategaCancelMarker(rec.nextMetadata), null, 'marker cleared after recovery');
assert.equal(T.decidePlategaConfirmed({ status: 'FAILED', metadata: canceledMeta }, 'tx1', 'unverified', NOW).kind, 'recover_failed');
assert.equal(T.decidePlategaConfirmed({ status: 'FAILED', metadata: canceledMeta }, 'tx1', 'rejected', NOW).kind, 'not_recoverable');
assert.equal(T.decidePlategaConfirmed({ status: 'FAILED', metadata: null }, 'tx1', 'confirmed', NOW).reason, 'failed_not_by_platega_webhook');
assert.equal(T.decidePlategaConfirmed({ status: 'FAILED', metadata: canceledMeta }, 'tx2', 'confirmed', NOW).reason, 'transaction_id_mismatch');
assert.equal(T.decidePlategaConfirmed({ status: 'FAILED', metadata: canceledMeta }, null, 'confirmed', NOW).reason, 'transaction_id_mismatch');
const refunded = JSON.stringify({ ...JSON.parse(canceledMeta), refundedAt: NOW });
assert.equal(T.decidePlategaConfirmed({ status: 'FAILED', metadata: refunded }, 'tx1', 'confirmed', NOW).reason, 'failed_after_refund');
assert.equal(T.decidePlategaConfirmed({ status: 'REFUNDED', metadata: canceledMeta }, 'tx1', 'confirmed', NOW).kind, 'not_recoverable');
assert.equal(T.withPlategaCancelMarker('{"a":1}', 'CANCELED', null, NOW), '{"a":1}');

// ---- route level ----
let row, balance, activations, outcomes, alerts, apiStatus, creds;
const matches = (where) => Object.entries(where).every(([k, v]) => {
  if (v && typeof v === 'object' && Array.isArray(v.in)) return v.in.includes(row[k]);
  return row[k] === v;
});
const payment = {
  findFirst: async ({ where }) => (matches(where) ? { ...row } : null),
  findUnique: async ({ where }) => (matches(where) ? { ...row } : null),
  updateMany: async ({ where, data }) => { if (!matches(where)) return { count: 0 }; Object.assign(row, data); return { count: 1 }; },
  update: async ({ data }) => Object.assign(row, data),
};
const db = { payment, client: { update: async ({ data }) => { balance += data.balance.increment; } }, $transaction: async fn => fn(db) };
const noop = async () => {};
let handler;
load('src/modules/webhooks/platega.webhooks.routes.ts', {
  express: { Router: () => ({ post: (_, fn) => { handler = fn; } }) },
  '../../db.js': { prisma: db },
  '../client/client.service.js': { getSystemConfig: async () => (creds ? { plategaMerchantId: 'm', plategaSecret: 's' } : {}) },
  '../platega/platega.service.js': { ...service, getPlategaTransactionStatus: async () => ({ status: apiStatus, id: 'tx1', amount: 100, currency: 'RUB', payload: 'order1' }) },
  '../webhook-inbox/webhook-inbox.service.js': { recordWebhook: async () => ({ id: 'w', startedAt: 0 }), markOutcome: async (_c, _s, o, extra) => { outcomes.push([o, extra && extra.errorMessage]); } },
  '../tariff/tariff-activation.service.js': { activateTariffByPaymentId: async () => { activations++; return { ok: true }; } },
  '../proxy/proxy-slots-activation.service.js': {}, '../singbox/singbox-slots-activation.service.js': {}, '../extra-options/extra-options.service.js': {},
  '../referral/referral.service.js': { distributeReferralRewards: noop },
  '../notification/telegram-notify.service.js': { notifyBalanceToppedUp: noop, notifyTariffActivated: noop, notifyTariffActivationFailed: async (...a) => { alerts.push(a); }, notifyProxySlotsCreated: noop, notifySingboxSlotsCreated: noop },
  '../payment/promo-code-usage.util.js': { recordPromoCodeUsageFromPayment: noop },
  '../payment/payment-webhook-audit.util.js': { auditPaymentClientBotAlignment: noop },
  '../client/personal-discount.js': { extinguishOneTimeDiscount: noop },
  './platega-transition.js': T,
});
function reset(tariffId = null, status = 'PENDING', metadata = null) {
  row = { id: 'p', provider: 'platega', orderId: 'order1', externalId: 'tx1', status, clientId: 'c', amount: 100, currency: 'RUB', tariffId, proxyTariffId: null, singboxTariffId: null, metadata };
  balance = 0; activations = 0; outcomes = []; alerts = []; apiStatus = 'CONFIRMED'; creds = true;
}
async function call(status, id = 'tx1') {
  const res = { code: 200, status(c) { this.code = c; return this; }, json() { return this; } };
  const body = id === null ? { status, payload: 'order1' } : { id, status, payload: 'order1' };
  await handler({ body: Buffer.from(JSON.stringify(body)), headers: {} }, res);
  return res.code;
}
const last = () => outcomes[outcomes.length - 1][0];

(async () => {
  // top-up: CANCELED then CONFIRMED -> credited once, duplicate does not double-credit
  reset();
  await call('CANCELED'); assert.equal(row.status, 'FAILED'); assert(T.readPlategaCancelMarker(row.metadata));
  assert.equal(await call('CONFIRMED'), 200); assert.equal(row.status, 'PAID'); assert.equal(balance, 100); assert.equal(last(), 'accepted');
  await call('CONFIRMED'); assert.equal(balance, 100);
  // CANCELED after PAID does not downgrade
  await call('CANCELED'); assert.equal(row.status, 'PAID');

  // A mismatched cancellation must not poison recovery for the real transaction.
  reset();
  assert.equal(await call('CANCELED', 'other'), 401);
  assert.equal(row.status, 'PENDING'); assert.equal(row.metadata, null);
  await call('CANCELED'); await call('CONFIRMED');
  assert.equal(row.status, 'PAID'); assert.equal(balance, 100);

  // concurrent duplicate CONFIRMED after CANCELED -> one credit
  reset(); await call('CANCELED');
  await Promise.all([call('CONFIRMED'), call('CONFIRMED'), call('CONFIRMED')]);
  assert.equal(balance, 100); assert.equal(row.status, 'PAID');

  // tariff: CANCELED then CONFIRMED -> activated once
  reset('tariff'); await call('CANCELED');
  await call('CONFIRMED'); assert.equal(row.status, 'PAID'); assert.equal(activations, 1); assert.equal(last(), 'accepted');
  await call('CONFIRMED'); assert.equal(activations, 1);

  // forged CONFIRMED (API says CANCELED) -> rejected, stays FAILED
  reset(); await call('CANCELED'); apiStatus = 'CANCELED';
  assert.equal(await call('CONFIRMED'), 401); assert.equal(row.status, 'FAILED'); assert.equal(balance, 0);

  // creds not configured -> mirrors PENDING path (accepted unverified)
  reset(); await call('CANCELED'); creds = false;
  await call('CONFIRMED'); assert.equal(row.status, 'PAID'); assert.equal(balance, 100);

  // FAILED for another reason (no marker) -> not resurrected, visible outcome + admin alert
  reset('tariff', 'FAILED', null);
  await call('CONFIRMED'); assert.equal(row.status, 'FAILED'); assert.equal(activations, 0);
  assert.equal(last(), 'error'); assert.match(outcomes[outcomes.length - 1][1], /failed_not_by_platega_webhook/); assert.equal(alerts.length, 1);

  // transaction id mismatch -> not resurrected
  reset(null, 'FAILED', T.withPlategaCancelMarker(null, 'CANCELED', 'other', NOW));
  await call('CONFIRMED'); assert.equal(row.status, 'FAILED'); assert.equal(balance, 0); assert.equal(last(), 'error');

  // CONFIRMED without a transaction id in the body must not recover (externalId fallback is not proof)
  reset(); await call('CANCELED');
  await call('CONFIRMED', null); assert.equal(row.status, 'FAILED'); assert.equal(balance, 0); assert.equal(last(), 'error');
  assert.match(outcomes[outcomes.length - 1][1], /transaction_id_mismatch/);
  // ...but a body-less-id CONFIRMED for a PENDING payment keeps the old behaviour
  reset(); await call('CONFIRMED', null); assert.equal(row.status, 'PAID'); assert.equal(balance, 100);

  console.log('PASS: Platega CANCELED->CONFIRMED recovery (top-up, tariff), idempotent/concurrent credit, forged confirm rejected, no-creds mirror, non-webhook FAILED untouched, tx mismatch, CANCELED after PAID, no-body-id recovery refused');
})().catch(e => { console.error(e); process.exitCode = 1; });
