const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(path, mocks = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: n => mocks[n] ?? require(n), Buffer, URL, console, Date, Number, Math, JSON, Promise, Set }, { filename: path });
  return exports;
}

let fetchImpl = async () => { throw new Error('no fetch'); };
const service = load('src/modules/platega/platega.service.ts', {
  '../proxy-util/proxy-fetch.js': { proxyFetch: (...a) => fetchImpl(...a) },
  '../proxy-util/get-proxy-url.js': { getProxyUrl: async () => null },
});

(async () => {
  // --- client: reads amount/currency/payload from documented response (paymentDetails + payload) ---
  fetchImpl = async () => ({ status: 200, ok: true, text: async () => JSON.stringify({ id: 'tx-1', status: 'CONFIRMED', paymentDetails: { amount: 990, currency: 'RUB' }, payload: 'order-1' }) });
  const st = await service.getPlategaTransactionStatus({ merchantId: 'm', secret: 's' }, 'tx-1');
  assert.equal(st.ok, true);
  assert.equal(st.amount, 990);
  assert.equal(st.currency, 'RUB');
  assert.equal(st.payload, 'order-1');
  assert.equal(st.id, 'tx-1');

  // --- pure binding check ---
  const pay = { orderId: 'order-1', externalId: 'tx-1', amount: 990, currency: 'RUB' };
  const ok = service.checkPlategaBinding(pay, 'tx-1', { id: 'tx-1', amount: 990, currency: 'RUB', payload: 'order-1' });
  assert.equal(ok.ok, true);
  assert.equal(service.checkPlategaBinding(pay, 'tx-1', { amount: 989.999, currency: 'rub', payload: 'order-1' }).ok, true, 'rounding tolerance + currency case');
  assert.equal(service.checkPlategaBinding(pay, 'tx-1', { amount: 10, currency: 'RUB', payload: 'order-1' }).ok, false, 'amount mismatch');
  assert.equal(service.checkPlategaBinding(pay, 'tx-1', { amount: 990, currency: 'USD', payload: 'order-1' }).ok, false, 'currency mismatch');
  assert.equal(service.checkPlategaBinding(pay, 'tx-1', { amount: 990, payload: 'order-2' }).ok, false, 'payload mismatch');
  assert.equal(service.checkPlategaBinding(pay, 'tx-1', { id: 'tx-9', amount: 990, payload: 'order-1' }).ok, false, 'api id mismatch');
  // legacy payment without stored tx id: payload is mandatory
  const legacy = { ...pay, externalId: '' };
  assert.equal(service.checkPlategaBinding(legacy, 'tx-1', { amount: 990, payload: 'order-1' }).ok, true);
  assert.equal(service.checkPlategaBinding(legacy, 'tx-1', { amount: 990 }).ok, false, 'no stored id and no payload');
  assert.equal(service.checkPlategaBinding(legacy, 'tx-1', { amount: 990, payload: 'other' }).ok, false);
  // pre-API check: webhook tx id vs stored
  assert.equal(service.checkPlategaWebhookTxId(pay, 'tx-X').ok, false);
  assert.equal(service.checkPlategaWebhookTxId(pay, 'tx-1').ok, true);
  assert.equal(service.checkPlategaWebhookTxId(pay, null).ok, true);
  assert.equal(service.checkPlategaWebhookTxId(legacy, 'tx-X').ok, true);

  // --- route level ---
  let handler;
  let rows, balance, apiTxs, creds, activations;
  const findRow = where => Object.values(rows).find(r =>
    (where.id && r.id === where.id) || (where.orderId && r.orderId === where.orderId) || (where.externalId && r.externalId === where.externalId && r.provider === where.provider));
  const payment = {
    findFirst: async ({ where }) => { const r = findRow({ externalId: where.externalId, provider: where.provider }); return r ? { ...r } : null; },
    findUnique: async ({ where }) => { const r = findRow(where); return r ? { ...r } : null; },
    updateMany: async ({ where, data }) => { const r = rows[where.id]; if (!r || r.status !== where.status) return { count: 0 }; Object.assign(r, data); return { count: 1 }; },
    update: async ({ where, data }) => Object.assign(rows[where.id], data),
  };
  const db = { payment, client: { update: async ({ data }) => { balance += data.balance.increment; } }, $transaction: async fn => fn(db) };
  const noop = async () => {};
  load('src/modules/webhooks/platega.webhooks.routes.ts', {
    express: { Router: () => ({ post: (_, fn) => { handler = fn; } }) },
    '../../db.js': { prisma: db },
    '../client/client.service.js': { getSystemConfig: async () => (creds ? { plategaMerchantId: 'm', plategaSecret: 's' } : {}) },
    '../platega/platega.service.js': { ...service, getPlategaTransactionStatus: async (_c, id) => apiTxs[id] ? { ok: true, raw: {}, ...apiTxs[id] } : { error: 'not found' } },
    '../webhook-inbox/webhook-inbox.service.js': { recordWebhook: async () => ({ id: null, startedAt: 0 }), markOutcome: noop },
    '../tariff/tariff-activation.service.js': { activateTariffByPaymentId: async () => { activations++; return { ok: true }; } },
    '../proxy/proxy-slots-activation.service.js': {}, '../singbox/singbox-slots-activation.service.js': {}, '../extra-options/extra-options.service.js': {},
    '../referral/referral.service.js': { distributeReferralRewards: noop },
    '../notification/telegram-notify.service.js': { notifyBalanceToppedUp: noop, notifyTariffActivated: noop, notifyTariffActivationFailed: noop, notifyProxySlotsCreated: noop, notifySingboxSlotsCreated: noop },
    '../payment/promo-code-usage.util.js': { recordPromoCodeUsageFromPayment: noop },
    '../payment/payment-webhook-audit.util.js': { auditPaymentClientBotAlignment: noop },
    '../client/personal-discount.js': { extinguishOneTimeDiscount: noop },
  });
  const reset = () => {
    creds = true; balance = 0; activations = 0;
    rows = {
      cheap: { id: 'cheap', provider: 'platega', orderId: 'o-cheap', externalId: 'tx-cheap', status: 'PAID', clientId: 'c', amount: 10, currency: 'RUB', tariffId: null, proxyTariffId: null, singboxTariffId: null, metadata: null },
      big: { id: 'big', provider: 'platega', orderId: 'o-big', externalId: 'tx-big', status: 'PENDING', clientId: 'c', amount: 5000, currency: 'RUB', tariffId: null, proxyTariffId: null, singboxTariffId: null, metadata: null },
    };
    apiTxs = {
      'tx-cheap': { id: 'tx-cheap', status: 'CONFIRMED', amount: 10, currency: 'RUB', payload: 'o-cheap' },
      'tx-big': { id: 'tx-big', status: 'CONFIRMED', amount: 5000, currency: 'RUB', payload: 'o-big' },
    };
  };
  async function call(body) {
    const res = { code: 0, status(c) { this.code = c; return this; }, json() { return this; } };
    await handler({ body: Buffer.from(JSON.stringify(body)), headers: {} }, res);
    return res.code;
  }

  // forged CONFIRMED: payload of the expensive payment, id of another (paid) transaction
  reset();
  assert.equal(await call({ id: 'tx-cheap', status: 'CONFIRMED', payload: 'o-big' }), 401);
  assert.equal(balance, 0); assert.equal(rows.big.status, 'PENDING'); assert.equal(rows.big.externalId, 'tx-big');

  // amount mismatch reported by API for the correct transaction
  reset(); apiTxs['tx-big'].amount = 10;
  assert.equal(await call({ id: 'tx-big', status: 'CONFIRMED', payload: 'o-big' }), 401);
  assert.equal(balance, 0); assert.equal(rows.big.status, 'PENDING');

  // legacy payment w/o stored tx id, API payload points elsewhere
  reset(); rows.big.externalId = null;
  assert.equal(await call({ id: 'tx-cheap', status: 'CONFIRMED', payload: 'o-big' }), 401);
  assert.equal(balance, 0); assert.equal(rows.big.externalId, null);

  // correct transaction credited once
  reset();
  assert.equal(await call({ id: 'tx-big', status: 'CONFIRMED', payload: 'o-big' }), 200);
  assert.equal(await call({ id: 'tx-big', status: 'CONFIRMED', payload: 'o-big' }), 200);
  assert.equal(balance, 5000); assert.equal(rows.big.status, 'PAID'); assert.equal(rows.big.externalId, 'tx-big');

  // legacy payment w/o stored id, API payload matches -> credited and id stored
  reset(); rows.big.externalId = '';
  assert.equal(await call({ id: 'tx-big', status: 'CONFIRMED', payload: 'o-big' }), 200);
  assert.equal(balance, 5000); assert.equal(rows.big.externalId, 'tx-big');

  // CANCELED with a different tx id must not overwrite stored externalId
  reset();
  assert.equal(await call({ id: 'tx-cheap', status: 'CANCELED', payload: 'o-big' }), 200);
  assert.equal(rows.big.externalId, 'tx-big');

  // no API credentials: unverified mode still accepts (unchanged), but stored-id mismatch is rejected
  reset(); creds = false;
  assert.equal(await call({ id: 'tx-cheap', status: 'CONFIRMED', payload: 'o-big' }), 401);
  assert.equal(balance, 0);
  assert.equal(await call({ id: 'tx-big', status: 'CONFIRMED', payload: 'o-big' }), 200);
  assert.equal(balance, 5000);

  console.log('PASS: Platega API verification bound to payment (tx id, payload, amount, currency), legacy fallback, failure webhook keeps externalId');
})().catch(e => { console.error(e); process.exitCode = 1; });
