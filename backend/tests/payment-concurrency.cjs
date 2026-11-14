const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(path, mocks = {}) {
  const exports = {};
  const sandboxConsole = { log() {}, warn() {}, error() {} };
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports,
      require: (name) => (Object.prototype.hasOwnProperty.call(mocks, name) ? mocks[name] : require(name)),
      console: sandboxConsole,
      Buffer, URL, Date, JSON, Promise, Math, Number, String, Boolean,
      setTimeout, clearTimeout, setImmediate, process, globalThis: {},
    },
  );
  return exports;
}

const noop = async () => {};

let state;
let tail = Promise.resolve();

function matches(row, where) {
  if (where.id !== undefined && row.id !== where.id) return false;
  if (where.orderId !== undefined && row.orderId !== where.orderId) return false;
  if (where.clientId !== undefined && row.clientId !== where.clientId) return false;
  if (where.status !== undefined) {
    const s = where.status;
    if (typeof s === 'string' && row.status !== s) return false;
    if (s && typeof s === 'object') {
      if (s.not !== undefined && row.status === s.not) return false;
      if (Array.isArray(s.notIn) && s.notIn.includes(row.status)) return false;
      if (Array.isArray(s.in) && !s.in.includes(row.status)) return false;
    }
  }
  return true;
}

function findPayment(where) {
  if (!where) return null;
  return state.payments.find((p) => matches(p, where)) ?? null;
}

const payment = {
  findFirst: async ({ where }) => findPayment(where),
  findUnique: async ({ where }) => findPayment(where),
  update: async ({ where, data }) => {
    const row = findPayment(where);
    if (!row) throw new Error('payment not found');
    Object.assign(row, data);
    return { ...row };
  },
  updateMany: async ({ where, data }) => {
    const rows = state.payments.filter((p) => matches(p, where));
    rows.forEach((p) => Object.assign(p, data));
    return { count: rows.length };
  },
  create: async ({ data }) => {
    if (state.payments.some((p) => p.orderId === data.orderId)) {
      const error = new Error('unique constraint');
      error.code = 'P2002';
      throw error;
    }
    const row = { ...data };
    state.payments.push(row);
    return { ...row };
  },
};

const client = {
  findUnique: async () => ({
    id: 'client', telegramId: null, email: null, telegramUsername: null, balance: state.balance,
  }),
  update: async ({ where, data }) => {
    if (where.id !== 'client') throw new Error('client not found');
    if (data.balance && data.balance.increment != null) state.balance += data.balance.increment;
    if (data.balance && data.balance.decrement != null) state.balance -= data.balance.decrement;
    return { id: 'client', balance: state.balance };
  },
  updateMany: async ({ where, data }) => {
    if (where.id !== 'client') return { count: 0 };
    if (where.balance && where.balance.gte != null && state.balance < where.balance.gte) return { count: 0 };
    state.balance -= data.balance.decrement;
    return { count: 1 };
  },
};

const quarantined = [];
let quarantineFails = false;
const prisma = {
  webhookEvent: { create: async ({ data }) => { if (quarantineFails) throw Error("inbox unavailable"); quarantined.push(data); return { id: "event" }; } },
  payment,
  client,
  $queryRaw: async () => [],
  paymentDelivery: { findUnique: async () => null, updateMany: async () => ({ count: 0 }) },
  proxyTariff: { findUnique: async () => null },
  singboxTariff: { findUnique: async () => null },
  tariff: { findUnique: async () => null },
  promoCodeUsage: { create: async () => ({ id: 'usage' }), deleteMany: async () => ({ count: 0 }) },
  referralCredit: {
    findMany: async () => state.credits.map((c) => ({ ...c })),
    deleteMany: async () => {
      const count = state.credits.length;
      state.credits = [];
      return { count };
    },
  },
  singboxRenewal: { findUnique: async () => null },
  $transaction: async (fn) => {
    const prior = tail;
    let release;
    tail = new Promise((resolve) => { release = resolve; });
    await prior;
    const snapshot = {
      balance: state.balance,
      credits: state.credits.map((c) => ({ ...c })),
      payments: state.payments.map((p) => ({ ...p })),
    };
    try {
      return await fn(prisma);
    } catch (error) {
      state.balance = snapshot.balance;
      state.credits = snapshot.credits;
      state.payments = snapshot.payments;
      throw error;
    } finally {
      release();
    }
  },
};

function resetState(overrides = {}) {
  state = {
    balance: 0,
    notifications: 0,
    activations: 0,
    credits: [],
    payments: [{
      id: 'pay1',
      clientId: 'client',
      orderId: 'order1',
      amount: 100,
      currency: 'USD',
      status: 'PENDING',
      provider: 'test',
      tariffId: null,
      proxyTariffId: null,
      singboxTariffId: null,
      metadata: null,
      ...overrides,
    }],
  };
  tail = Promise.resolve();
}

function makeRes() {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    send(body) { this.body = body; return this; },
    json(body) { this.body = body; return this; },
    set(name, value) { this.headers[name] = value; return this; },
  };
}

function captureRouter(path, mocks) {
  const routes = {};
  const router = {
    use() {},
    get(route, ...handlers) { routes[`GET ${route}`] = handlers[handlers.length - 1]; },
    post(route, ...handlers) { routes[`POST ${route}`] = handlers[handlers.length - 1]; },
  };
  load(path, { ...mocks, express: { Router: () => router } });
  return routes;
}

function activationMocks() {
  return {
    '../webhook-inbox/webhook-inbox.service.js': { recordWebhook: async () => ({ id: null }), markOutcome: noop },
    '../payment/payment-fulfillment.util.js': { handlePaymentActivationResult: noop },
    '../tariff/tariff-activation.service.js': { activateTariffByPaymentId: async () => { state.activations += 1; return { ok: true }; } },
    '../proxy/proxy-slots-activation.service.js': { createProxySlotsByPaymentId: async () => ({ ok: true, slotIds: [], slotsCreated: 0 }) },
    '../singbox/singbox-slots-activation.service.js': { createSingboxSlotsByPaymentId: async () => ({ ok: true, slotIds: [], slotsCreated: 0 }) },
    '../extra-options/extra-options.service.js': { applyExtraOptionByPaymentId: async () => ({ ok: true }) },
    '../referral/referral.service.js': { distributeReferralRewards: noop },
    '../notification/telegram-notify.service.js': {
      notifyBalanceToppedUp: async () => { state.notifications += 1; },
      notifyTariffActivated: noop,
      notifyProxySlotsCreated: noop,
      notifySingboxSlotsCreated: noop,
      notifyExtraOptionApplied: noop,
    },
    '../payment/promo-code-usage.util.js': { recordPromoCodeUsageFromPayment: noop },
    '../payment/payment-webhook-audit.util.js': { auditPaymentClientBotAlignment: noop },
    '../client/personal-discount.js': { extinguishOneTimeDiscount: noop },
    '../../db.js': { prisma },
  };
}

function yookassaRoutes() {
  return captureRouter('src/modules/webhooks/yookassa.webhooks.routes.ts', {
    ...activationMocks(),
    '../client/client.service.js': { getSystemConfig: async () => ({ yookassaWebhookBasicUser: 'user', yookassaWebhookBasicPassword: 'pass' }) },
    '../yookassa/yookassa.service.js': { getYookassaPaymentStatus: async () => ({ status: 'succeeded' }) },
    '../nalog/nalog.service.js': { createNalogReceipt: async () => ({ ok: true }) },
  });
}

function cryptopayRoutes() {
  return captureRouter('src/modules/webhooks/cryptopay.webhooks.routes.ts', {
    ...activationMocks(),
    '../client/client.service.js': { getSystemConfig: async () => ({ cryptopayApiToken: 'token' }) },
    '../cryptopay/cryptopay.service.js': { verifyCryptopayWebhookSignature: () => true },
  });
}

function lavaRoutes() {
  return captureRouter('src/modules/webhooks/lava.webhooks.routes.ts', {
    ...activationMocks(),
    '../client/client.service.js': { getSystemConfig: async () => ({ lavaAdditionalKey: 'key' }) },
    '../lava/lava.service.js': { verifyLavaWebhookSignature: () => true },
  });
}

function lavatopRoutes(parseEvent) {
  return captureRouter('src/modules/webhooks/lavatop.webhooks.routes.ts', {
    ...activationMocks(),
    '../client/client.service.js': { getSystemConfig: async () => ({ lavatopApiKey: 'key' }) },
    '../lavatop/lavatop.service.js': {
      verifyLavatopWebhookAuth: () => true,
      parseLavatopWebhook: parseEvent ?? (() => ({
        eventType: 'payment.success',
        contractId: 'order1',
        parentContractId: null,
        amount: 100,
        currency: 'USD',
        buyerEmail: null,
        productId: 'product1',
        productTitle: null,
        timestamp: '2026-01-01T00:00:00.000Z',
        status: 'success',
        errorMessage: null,
        raw: {},
      })),
    },
  });
}

async function sendYookassa(handler) {
  const res = makeRes();
  await handler({
    headers: { authorization: `Basic ${Buffer.from('user:pass').toString('base64')}` },
    body: { event: 'payment.succeeded', object: { id: 'yk1', status: 'succeeded', metadata: { payment_id: 'pay1' } } },
  }, res);
  return res;
}

async function sendCryptopay(handler) {
  const res = makeRes();
  await handler({
    body: Buffer.from(JSON.stringify({ update_type: 'invoice_paid', payload: { payload: 'pay1', invoice_id: 11 } })),
    headers: { 'crypto-pay-api-signature': 'sig' },
  }, res);
  return res;
}

async function sendLava(handler) {
  const res = makeRes();
  await handler({
    body: Buffer.from(JSON.stringify({ status: 'success', order_id: 'order1', invoice_id: 'inv1' })),
    headers: { authorization: 'sig' },
  }, res);
  return res;
}

async function sendLavatop(handler) {
  const res = makeRes();
  await handler({
    header: (name) => (String(name).toLowerCase() === 'x-api-key' ? 'key' : undefined),
    body: {},
  }, res);
  return res;
}

function refundRoutes() {
  return captureRouter('src/modules/payment-actions/payment-actions.routes.ts', {
    '../../db.js': { prisma },
    '../payment/payment-delivery.service.js': { processPaymentDelivery: noop },
    '../auth/middleware.js': { requireAuth: () => (req, res, next) => next?.(), requireAdminSection: () => (req, res, next) => next?.() },
    '../audit/audit.service.js': { logAdmin: noop },
    '../amnezia-web/renewal.js': { refundWebRenewal: async () => ({ summary: {} }), WebRenewalError: class WebRenewalError extends Error {} },
    '../amnezia-web/service.js': { reconcileWebPanels: async () => {} },
    '../telegram-stars/stars.service.js': { refundStarsPayment: async () => ({}) },
  });
}

function markPaidModule() {
  return load('src/modules/payment/mark-paid.service.ts', {
    '../../db.js': { prisma },
    '../referral/referral.service.js': { distributeReferralRewards: noop },
    '../tariff/tariff-activation.service.js': { activateTariffByPaymentId: async () => { state.activations += 1; return { ok: true }; } },
    '../proxy/proxy-slots-activation.service.js': { createProxySlotsByPaymentId: async () => ({ ok: true, slotIds: [], slotsCreated: 0 }) },
    '../singbox/singbox-slots-activation.service.js': { createSingboxSlotsByPaymentId: async () => ({ ok: true, slotIds: [], slotsCreated: 0 }) },
    '../extra-options/extra-options.service.js': { applyExtraOptionByPaymentId: async () => ({ ok: true }) },
    '../notification/telegram-notify.service.js': {
      notifyBalanceToppedUp: async () => { state.notifications += 1; },
      notifyProxySlotsCreated: noop,
      notifySingboxSlotsCreated: noop,
      notifyExtraOptionApplied: noop,
    },
    './payment-webhook-audit.util.js': { auditPaymentClientBotAlignment: noop },
    '../client/personal-discount.js': { extinguishOneTimeDiscount: noop },
  });
}

async function runWebhookScenarios() {
  const scenarios = [
    { name: 'yookassa', routes: yookassaRoutes, path: '/yookassa', send: sendYookassa },
    { name: 'cryptopay', routes: cryptopayRoutes, path: '/', send: sendCryptopay },
    { name: 'lava', routes: lavaRoutes, path: '/', send: sendLava },
    { name: 'lavatop', routes: lavatopRoutes, path: '/', send: sendLavatop },
  ];

  for (const scenario of scenarios) {
    const handler = scenario.routes()[`POST ${scenario.path}`];
    assert.equal(typeof handler, 'function', `${scenario.name} handler missing`);

    resetState();
    const results = await Promise.all(Array.from({ length: 8 }, () => scenario.send(handler)));
    assert.equal(state.balance, 100, `${scenario.name} must credit balance exactly once`);
    assert.equal(state.notifications, 1, `${scenario.name} must notify exactly once`);
    assert.equal(state.activations, 0, `${scenario.name} top-up must not activate a tariff`);
    assert.ok(results.every((r) => r.statusCode === 200));

    await scenario.send(handler);
    assert.equal(state.balance, 100, `${scenario.name} retry must not credit again`);
    state.payments[0].status = 'REFUNDED';
    await scenario.send(handler);
    assert.equal(state.balance, 100, `${scenario.name} must not credit a refunded payment again`);

    resetState({ metadata: JSON.stringify({ customBuild: { days: 30, devices: 1 } }) });
    await Promise.all([scenario.send(handler), scenario.send(handler)]);
    assert.equal(state.balance, 0, `${scenario.name} customBuild must not be treated as a top-up`);
    assert.equal(state.activations, 1, `${scenario.name} customBuild must activate exactly once`);
  }
}

async function runRecurringScenario() {
  const recurringEvent = {
    eventType: 'subscription.recurring.payment.success',
    contractId: 'contract-parent',
    parentContractId: 'contract-parent',
    amount: 100,
    currency: 'USD',
    buyerEmail: null,
    productId: 'product1',
    productTitle: null,
    timestamp: '2026-01-01T00:00:00.000Z',
    status: 'success',
    errorMessage: null,
    raw: { invoiceId: 'invoice-1' },
  };
  const handler = lavatopRoutes(() => recurringEvent)['POST /'];

  resetState({
    id: 'parent',
    orderId: 'contract-parent',
    status: 'PAID',
    tariffId: 'tariff1',
    provider: 'lavatop',
  });

  await Promise.all([sendLavatop(handler), sendLavatop(handler)]);
  assert.equal(state.payments.length, 2, 'recurring renewal must create exactly one payment');
  assert.equal(state.activations, 1, 'recurring renewal must activate exactly once');
  assert.equal(state.payments[1].orderId, 'lavatop-rec-contract-parent-invoice-1');

  await sendLavatop(handler);
  assert.equal(state.payments.length, 2, 'repeated recurring webhook must not create another payment');
  assert.equal(state.activations, 1, 'repeated recurring webhook must not activate again');
}

async function runRecurringIdentityScenarios() {
  const event = { eventType: 'subscription.recurring.payment.success', contractId: 'contract-parent', parentContractId: 'contract-parent', amount: 100, currency: 'USD', status: 'success', timestamp: null, raw: {} };
  const handler = lavatopRoutes(() => event)['POST /'];
  const reset = () => resetState({ id: 'parent', orderId: 'contract-parent', status: 'PAID', tariffId: 'tariff1', provider: 'lavatop' });
  reset();
  for (let i = 0; i < 2; i++) assert.equal((await sendLavatop(handler)).statusCode, 200);
  assert.equal(state.payments.length, 1);
  assert.equal(state.activations, 0);
  assert.equal(quarantined.length, 2);
  assert.equal(quarantined[0].outcome, 'rejected_payload');
  quarantineFails = true;
  assert.equal((await sendLavatop(handler)).statusCode, 503);
  quarantineFails = false;
  for (const raw of [{ event_id: 'evt1' }, { invoice_id: 'invoice1' }]) {
    reset(); event.raw = raw;
    await Promise.all([sendLavatop(handler), sendLavatop(handler)]);
    await sendLavatop(handler);
    assert.equal(state.payments.length, 2);
    assert.equal(state.activations, 1);
  }
  reset(); event.raw = {}; event.timestamp = '2026-11-01T12:00:00Z';
  await Promise.all([sendLavatop(handler), sendLavatop(handler)]);
  assert.equal(state.payments.length, 2);
  event.timestamp = '2026-12-01T12:00:00Z';
  await sendLavatop(handler);
  assert.equal(state.payments.length, 3);
  reset(); event.timestamp = null; event.contractId = 'child-invoice';
  await Promise.all([sendLavatop(handler), sendLavatop(handler)]);
  assert.equal(state.payments.length, 2);
  assert.equal(state.activations, 1);
}

async function runRefundScenario() {
  const routes = refundRoutes();
  const handler = routes['POST /:id/refund'];
  assert.equal(typeof handler, 'function', 'refund handler missing');

  resetState({ status: 'PAID' });
  state.credits = [{ id: 'credit1', referrerId: 'referrer', paymentId: 'pay1', amount: 10 }];

  const call = async () => {
    const res = makeRes();
    let resolveDone;
    const done = new Promise((resolve) => { resolveDone = resolve; });
    let failure;
    res.json = function (body) { this.body = body; resolveDone(); return this; };
    handler(
      { params: { id: 'pay1' }, body: { refundToBalance: true, reverseReferrals: true } },
      res,
      (error) => { failure = error; resolveDone(); },
    );
    await done;
    if (failure) throw failure;
    return res;
  };

  const responses = await Promise.all([call(), call()]);
  assert.equal(state.balance, 100, 'refund must credit balance exactly once');
  assert.equal(responses.filter((r) => r.statusCode === 200).length, 1);
  assert.equal(responses.filter((r) => r.statusCode === 400).length, 1);
  assert.equal(state.payments[0].status, 'REFUNDED');
  assert.equal(state.credits.length, 0);

  const okResponse = responses.find((r) => r.statusCode === 200);
  assert.equal(okResponse.body.summary.creditedToBalance, 100);
  assert.equal(okResponse.body.summary.reversedReferralAmount, 10);
  assert.equal(okResponse.body.summary.reversedReferralCount, 1);

  const retry = await call();
  assert.equal(retry.statusCode, 400);
  assert.equal(state.balance, 100);
}

async function runMarkPaidScenario() {
  const { markPaymentPaid } = markPaidModule();
  const providers = [
    'cloudpayments', 'cryptopay', 'heleket', 'lava', 'lavatop',
    'overpay', 'paritypay', 'rollypay', 'yookassa', 'platega', 'yoomoney_form',
  ];

  for (const provider of providers) {
    resetState({ provider });
    const result = await markPaymentPaid('pay1');
    assert.equal(result.ok, true);
    assert.equal(result.balanceCredited, true, `${provider} top-up must credit balance`);
    assert.equal(state.balance, 100, `${provider} must credit balance`);
    assert.equal(state.payments[0].status, 'PAID');
    assert.equal(state.notifications, 1, `${provider} must notify once`);
  }

  resetState({ provider: 'cloudpayments' });
  await Promise.all(Array.from({ length: 8 }, () => markPaymentPaid('pay1')));
  assert.equal(state.balance, 100, 'concurrent markPaymentPaid must credit once');
  assert.equal(state.notifications, 1, 'concurrent markPaymentPaid must notify once');

  resetState({ provider: 'cloudpayments', metadata: JSON.stringify({ customBuild: { days: 30, devices: 1 } }) });
  const custom = await markPaymentPaid('pay1');
  assert.equal(custom.ok, true);
  assert.equal(state.balance, 0, 'customBuild markPaymentPaid must not credit balance');
  assert.equal(state.activations, 1, 'customBuild markPaymentPaid must activate the tariff');
}

(async () => {
  await runWebhookScenarios();
  await runRecurringScenario();
  await runRecurringIdentityScenarios();
  await runRefundScenario();
  await runMarkPaidScenario();
  console.log('PASS: webhook concurrency, customBuild detection, recurring dedup, atomic refund and provider-agnostic markPaymentPaid');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
