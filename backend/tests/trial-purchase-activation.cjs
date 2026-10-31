// Runs without database/Remnawave. Real activateTariffByPaymentId / findConvertibleSubscription /
// extendSecondarySubscription control flow; prisma, Remnawave and gift.service are in-memory fakes.
// Run from backend/: node tests/trial-purchase-activation.cjs
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict'), ts = require('typescript');

function load(rel, requireFn) {
  const src = fs.readFileSync(path.join('src', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { exports: mod.exports, module: mod, require: requireFn, console, Date, Math, JSON, Promise, Number, String, Array, Set, Map, Object, BigInt, Error }, { filename: rel });
  return mod.exports;
}
const pureRequire = (name) => { throw Error('unexpected require ' + name); };
const target = load('modules/tariff/subscription-target.ts', pureRequire);
const multi = load('modules/client/multi-subscriptions.ts', pureRequire);
const deviceLimits = load('modules/extra-options/device-limit.ts', pureRequire);

const DAY = 86_400_000;
const TRIAL_SQUAD = 'sq-trial';
let state;
function reset({ multiRaw = 'true', configFails = false } = {}) {
  state = {
    multiRaw, configFails,
    subs: [], remnaUsers: {}, calls: [], payments: {}, paidLinks: [],
    tariffs: { paid: { id: 'paid', name: 'Paid', price: 300, durationDays: 30, trafficLimitBytes: null, deviceLimit: 3, includedDevices: 1, pricePerExtraDevice: 0, maxExtraDevices: 0, deviceDiscountTiers: null, internalSquadUuids: ['sq-paid'], trafficResetMode: null, categoryId: null, category: null } },
  };
}
function addSub(s) {
  const row = { ownerId: 'c1', subscriptionIndex: state.subs.length, tariffId: null, trialId: null, purchasedAsGift: false, giftStatus: null, customPrice: null, currentPricePerDay: null, extraDevices: 0, extraDevicesMonthlyPrice: 0, expireAt: null, createdAt: new Date(state.subs.length), ...s };
  state.subs.push(row);
  state.remnaUsers[row.remnawaveUuid] = { uuid: row.remnawaveUuid, expireAt: row.expireAt?.toISOString() ?? null, activeInternalSquads: s.squads ?? [], trafficLimitBytes: 0, userTraffic: { usedTrafficBytes: 0 } };
  return row;
}
function matches(row, where = {}) {
  for (const [k, v] of Object.entries(where)) {
    if (v && typeof v === 'object' && !(v instanceof Date) && 'not' in v) { if (row[k] === v.not || (v.not === null && row[k] == null)) return false; continue; }
    if (row[k] !== v) return false;
  }
  return true;
}
const withTariff = (r) => ({ ...r, tariff: r.tariffId ? { name: state.tariffs[r.tariffId]?.name ?? r.tariffId, categoryId: state.tariffs[r.tariffId]?.categoryId ?? null } : null });
const prisma = {
  $transaction: async fn => fn(prisma),
  $executeRaw: async () => 1,
  payment: {
    findUnique: async ({ where }) => state.payments[where.id] ?? null,
    findMany: async ({ where }) => state.paidLinks.filter((l) => where.status === 'PAID' && where.subscriptionId.in.includes(l)).map((subscriptionId) => ({ subscriptionId })),
    update: async ({ where, data }) => { state.calls.push(['payment.update', where.id, data]); return {}; },
  },
  client: {
    findUnique: async () => ({ id: 'c1', remnawaveUuid: state.clientUuid ?? null, currentPricePerDay: state.clientPricePerDay ?? null, email: null, telegramId: '42', telegramUsername: null }),
    update: async ({ data }) => { state.calls.push(['client.update', data]); return {}; },
    updateMany: async () => ({ count: 0 }),
  },
  tariff: {
    findUnique: async ({ where }) => state.tariffs[where.id] ?? null,
    findMany: async () => Object.values(state.tariffs),
  },
  subscription: {
    findMany: async ({ where }) => state.subs.filter((r) => matches(r, where)).map(withTariff),
    findFirst: async ({ where }) => state.subs.filter((r) => matches(r, where)).map(withTariff)[0] ?? null,
    findUnique: async ({ where }) => { const r = state.subs.find((x) => x.id === where.id); return r ? withTariff(r) : null; },
    update: async ({ where, data }) => { const r = state.subs.find((x) => x.id === where.id); Object.assign(r, data); state.calls.push(['sub.update', where.id, data]); return r; },
    delete: async ({ where }) => { state.calls.push(['sub.delete', where.id]); state.subs = state.subs.filter((x) => x.id !== where.id); return {}; },
  },
};
const remna = {
  isRemnaConfigured: () => true,
  remnaGetUser: async (uuid) => { state.calls.push(['remna.get', uuid]); const u = state.remnaUsers[uuid]; return u ? { data: { response: u } } : { error: 'not found', status: 404 }; },
  remnaUpdateUser: async (body) => { state.calls.push(['remna.update', body]); return { data: {} }; },
  remnaResetUserTraffic: async () => ({ data: {} }),
  remnaDeleteUser: async (uuid) => { state.calls.push(['remna.delete', uuid]); return {}; },
  remnaCreateUser: async () => { throw Error('remnaCreateUser must not be called'); },
  remnaGetUserByTelegramId: async () => ({}), remnaGetUserByEmail: async () => ({}),
  extractRemnaUuid: () => null, remnaUsernameFromClient: () => 'user',
};
const svc = load('modules/tariff/tariff-activation.service.ts', (name) => {
  if (name.endsWith('/db.js')) return { prisma };
  if (name.endsWith('/device-limit.js')) return deviceLimits;
  if (name.includes('remna.client')) return remna;
  if (name.includes('gift.service')) return {
    createAdditionalSubscription: async (clientId, tariff, opts) => { state.calls.push(['create', clientId, tariff.id, opts]); return { ok: true, data: { subscriptionId: 'new', subscriptionIndex: state.subs.length } }; },
    deleteSubscription: async (clientId, id) => { state.calls.push(['consolidate.delete', id]); return { ok: true }; },
  };
  if (name.includes('client.service')) return { getSystemConfig: async () => { if (state.configFails) throw Error('db down'); return { multiSubscriptionsEnabled: multi.parseMultiSubscriptionsEnabled(state.multiRaw), trialSquadUuid: TRIAL_SQUAD }; } };
  if (name.includes('multi-subscriptions')) return multi;
  if (name.includes('subscription-target')) return target;
  if (name.includes('subscription.helpers')) return { upsertSubscriptionByRemnaUuid: async () => ({}) };
  if (name.includes('telegram-notify')) return { notifyAdminsAboutSubscriptionConverted: async () => {} };
  throw Error('unexpected require ' + name);
});

function pay(metadata) { state.payments.p1 = { id: 'p1', tariffId: 'paid', tariffPriceOptionId: null, deviceCount: 0, clientId: 'c1', metadata: metadata ? JSON.stringify(metadata) : null, tariffPriceOption: null }; return svc.activateTariffByPaymentId('p1'); }
const kinds = () => state.calls.map((c) => c[0]);
const remnaUpdates = () => state.calls.filter((c) => c[0] === 'remna.update').map((c) => c[1]);
const legacy = () => addSub({ id: 'L', remnawaveUuid: 'u-L', squads: [TRIAL_SQUAD], expireAt: new Date(Date.now() + 2 * DAY) });

const cases = [
  ['legacy auto-renew extends the same VPN user and keeps device count', async () => {
    reset({ multiRaw: 'true' });
    state.clientUuid = 'u-paid'; state.clientPricePerDay = 4;
    Object.assign(state.tariffs.paid, { price: 100, pricePerExtraDevice: 20, maxExtraDevices: 5 });
    const expires = new Date(Date.now() + DAY);
    addSub({ id: 'P', tariffId: 'paid', remnawaveUuid: 'u-paid', extraDevices: 1, extraDevicesMonthlyPrice: 20, expireAt: expires, squads: ['sq-paid'] });
    state.payments.p1 = { id: 'p1', tariffId: 'paid', tariffPriceOptionId: null, deviceCount: 1, clientId: 'c1', metadata: JSON.stringify({ autoRenew: true }), tariffPriceOption: null };
    const r = await svc.activateTariffByPaymentId('p1');
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(!kinds().includes('create'), 'auto-renew must not buy an additional subscription');
    const [update] = remnaUpdates();
    assert.equal(update.uuid, 'u-paid');
    assert.equal(update.hwidDeviceLimit, 2);
    assert.ok(Math.abs(new Date(update.expireAt) - expires - 30 * DAY) < 1000);
  }],
  ['multi ON: legacy trial converted in place, no _1', async () => {
    reset({ multiRaw: 'true' }); legacy();
    const r = await pay();
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(!kinds().includes('create'), 'must not create user_<tg>_1');
    assert.ok(!kinds().includes('remna.delete'), 'trial link must survive');
    const [u] = remnaUpdates(); assert.equal(u.uuid, 'u-L'); assert.deepEqual(u.activeInternalSquads, ['sq-paid']);
    assert.equal(state.subs.find((s) => s.id === 'L').tariffId, 'paid');
    assert.ok(state.calls.some((c) => c[0] === 'payment.update' && c[2].subscriptionId === 'L'));
  }],
  ['multi ON: tariff-less sub NOT on trial squad is not treated as a trial', async () => {
    reset({ multiRaw: 'true' }); addSub({ id: 'Z', remnawaveUuid: 'u-Z', squads: ['sq-old'] });
    assert.equal((await pay()).ok, true); assert.ok(kinds().includes('create'));
  }],
  ['multi ON: paid sub + legacy trial → trial converted, paid untouched', async () => {
    reset({ multiRaw: 'true' }); addSub({ id: 'P0', tariffId: 'paid', remnawaveUuid: 'u-P0', squads: ['sq-paid'], expireAt: new Date(Date.now() + 9 * DAY) }); legacy();
    assert.equal((await pay({ isAdditionalSubscription: true })).ok, true);
    assert.ok(!kinds().includes('create')); assert.deepEqual(remnaUpdates().map((u) => u.uuid), ['u-L']);
  }],
  ['multi ON: paid sub only → explicit additional sub is still created', async () => {
    reset({ multiRaw: 'true' }); addSub({ id: 'P0', tariffId: 'paid', remnawaveUuid: 'u-P0', squads: ['sq-paid'], expireAt: new Date(Date.now() + 9 * DAY) });
    assert.equal((await pay({ isAdditionalSubscription: true })).ok, true); assert.ok(kinds().includes('create')); assert.equal(remnaUpdates().length, 0);
  }],
  ['multi ON: gift purchase never converts the trial', async () => {
    reset({ multiRaw: 'true' }); legacy();
    assert.equal((await pay({ purchasedAsGift: true })).ok, true); assert.ok(kinds().includes('create')); assert.equal(remnaUpdates().length, 0);
  }],
  ['"0" / "False" means single mode (legacy trial hard-replaced in place)', async () => {
    for (const raw of ['0', 'False']) {
      reset({ multiRaw: raw }); legacy();
      assert.equal((await pay()).ok, true); assert.ok(!kinds().includes('create'), raw);
      assert.deepEqual(remnaUpdates().map((u) => u.uuid), ['u-L']);
    }
  }],
  ['multi OFF: leftovers _1/_2 → paid sub kept, trial consolidated away', async () => {
    reset({ multiRaw: 'false' }); legacy();
    addSub({ id: 'S1', tariffId: 'paid', remnawaveUuid: 'u-S1', squads: ['sq-paid'], expireAt: new Date(Date.now() + DAY) });
    addSub({ id: 'S2', tariffId: 'paid', remnawaveUuid: 'u-S2', squads: ['sq-paid'], expireAt: new Date(Date.now() + 5 * DAY) });
    assert.equal((await pay()).ok, true); assert.ok(!kinds().includes('create'));
    assert.deepEqual(remnaUpdates().map((u) => u.uuid), ['u-S2']);
    assert.deepEqual(state.calls.filter((c) => c[0] === 'consolidate.delete').map((c) => c[1]).sort(), ['L', 'S1']);
  }],
  ['multi OFF: explicit replaceTrialSubId (trial) wins over expireAt of another tariff', async () => {
    reset({ multiRaw: 'false' }); legacy();
    addSub({ id: 'S1', tariffId: 'other', remnawaveUuid: 'u-S1', squads: ['sq-paid'], expireAt: new Date(Date.now() + 20 * DAY) });
    assert.equal((await pay({ replaceTrialSubId: 'L' })).ok, true);
    assert.deepEqual(remnaUpdates().map((u) => u.uuid), ['u-L']);
  }],
  ['multi OFF: replaceTrialSubId does not override a paid sub of the same tariff', async () => {
    reset({ multiRaw: 'false' }); legacy();
    addSub({ id: 'S1', tariffId: 'paid', remnawaveUuid: 'u-S1', squads: ['sq-paid'], expireAt: new Date(Date.now() + 20 * DAY) });
    assert.equal((await pay({ replaceTrialSubId: 'L' })).ok, true);
    assert.deepEqual(remnaUpdates().map((u) => u.uuid), ['u-S1']);
    assert.deepEqual(state.calls.filter((c) => c[0] === 'consolidate.delete').map((c) => c[1]), ['L']);
  }],
  ['paid sub without tariff on trial squad keeps remaining days', async () => {
    reset({ multiRaw: 'true' }); addSub({ id: 'N', remnawaveUuid: 'u-N', squads: [TRIAL_SQUAD], expireAt: new Date(Date.now() + 10 * DAY + 3600_000) });
    assert.equal((await pay()).ok, true); assert.ok(!kinds().includes('create'));
    const [u] = remnaUpdates(); assert.equal(u.uuid, 'u-N');
    const days = Math.round((new Date(u.expireAt).getTime() - Date.now()) / DAY);
    assert.equal(days, 40, 'purchased 30 + remaining 10');
  }],
  ['sub with a PAID payment linked is never a legacy trial', async () => {
    reset({ multiRaw: 'true' }); addSub({ id: 'N', remnawaveUuid: 'u-N', squads: [TRIAL_SQUAD], expireAt: new Date(Date.now() + 10 * DAY) });
    state.paidLinks.push('N');
    assert.equal((await pay()).ok, true); assert.ok(kinds().includes('create')); assert.equal(remnaUpdates().length, 0);
  }],
  ['config load failure → retryable error, nothing touched', async () => {
    reset({ configFails: true }); legacy();
    const r = await pay();
    assert.equal(r.ok, false); assert.equal(r.status, 503);
    assert.ok(!kinds().some((k) => k === 'create' || k === 'remna.update' || k === 'consolidate.delete'));
  }],
  ['trial replacement is delegated to createAdditionalSubscription, not deleted upfront', async () => {
    reset({ multiRaw: 'true' });
    addSub({ id: 'T0', trialId: 'trial-x', remnawaveUuid: null, subscriptionIndex: 0 });
    assert.equal((await pay()).ok, true);
    const create = state.calls.find((c) => c[0] === 'create');
    assert.ok(create, 'subscription is created');
    assert.equal(create[3].replacingSubscriptionId, 'T0');
    assert.ok(!kinds().includes('remna.delete'));
  }],
  ['replaceTrialSubId pointing at a paid subscription is not forwarded', async () => {
    reset({ multiRaw: 'true' });
    addSub({ id: 'P0', tariffId: 'paid', remnawaveUuid: 'u-P0', expireAt: new Date(Date.now() + 9 * DAY) });
    assert.equal((await pay({ replaceTrialSubId: 'P0' })).ok, true);
    const create = state.calls.find((c) => c[0] === 'create');
    assert.ok(create, 'subscription is created');
    assert.equal(create[3].replacingSubscriptionId, undefined);
  }],
];
(async () => {
  let failed = 0;
  for (const [name, fn] of cases) {
    try { await fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e && e.message)); }
  }
  console.log(`${cases.length - failed}/${cases.length} passed`);
  if (failed) process.exitCode = 1;
})();
