const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(new URL('../src/modules/client/client.routes.ts', `file://${__filename}`), 'utf8');
const slice = (from, to) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));
const actual = slice('function toClientShape(', '/** Если у клиента включена 2FA') + slice('export async function fetchAvailableTrialsForClient(', 'clientRouter.get("/trials/available"') + slice('export type ClientSubInfo =', 'clientRouter.patch("/subscription/:id/name"');
const js = ts.transpileModule(actual, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture() {
  const handlers = new Map(); let missing = false, outage = false, parallel = 0, peak = 0;
  const subs = [0, 1].map(i => ({ id: `sub${i}`, subscriptionIndex: i, remnawaveUuid: `vpn${i}`, customName: `Device ${i}`, autoRenewEnabled: true, extraDevices: 2, extraDevicesMonthlyPrice: 100, tariff: { id: 'paid', name: 'Paid' }, trialId: null }));
  subs.push({ id: 'gift', subscriptionIndex: 2, giftStatus: 'GIFT_RESERVED' });
  const client = { id: 'owner', preferredLang: 'ru', preferredCurrency: 'RUB', balance: 77.25, passwordHash: 'password-secret', yoomoneyAccessToken: 'wallet-secret', personalDiscountPercent: 10 };
  const scope = { exports: {}, console, Date, JSON, Boolean, Promise, Set,
    clientRouter: { get: (path, handler) => handlers.set(path, handler) },
    prisma: {
      client: { findUnique: async () => missing ? null : client },
      subscription: { findMany: async ({ where }) => { assert.equal(where.OR[0].ownerId, 'owner'); return subs; } },
      trial: { findMany: async () => [{ id: 'used' }, { id: 'available', name: 'Trial', price: 5, trafficLimitBytes: 100n }] },
      clientTrialUsage: { findMany: async () => [{ trialId: 'used' }] },
    },
    getSystemConfig: async () => ({ happCryptEnabled: false }),
    remnaGetUser: async uuid => { parallel++; peak = Math.max(peak, parallel); await new Promise(resolve => setImmediate(resolve)); parallel--; return outage ? { status: 503 } : { status: 200, data: { uuid, status: 'ACTIVE' } }; },
    offlineSubscriptionSnapshot: sub => ({ uuid: sub.remnawaveUuid, status: 'OFFLINE_SNAPSHOT' }),
  };
  vm.runInNewContext(js, scope);
  return { handlers, subs, peak: () => peak, missing: () => { missing = true; }, outage: () => { outage = true; } };
}
async function request(f) {
  let body, status = 200;
  const res = { json: value => { body = JSON.parse(JSON.stringify(value)); }, status: value => { status = value; return res; } };
  await f.handlers.get('/bot-bootstrap')({ clientId: 'owner' }, res);
  return { body, status };
}
test('real bootstrap route aggregates subscriptions and trials, preserves custom names and omits credentials', async () => {
  const f = fixture(); const { body, status } = await request(f);
  assert.equal(status, 200);
  assert.equal(body.client.balance, 77.25);
  assert.equal(body.client.personalDiscountPercent, 10);
  assert.equal(JSON.stringify(body).includes('secret'), false);
  assert.equal(body.allSubscriptions.items.length, 2);
  assert.equal(body.allSubscriptions.items[1].customName, 'Device 1');
  assert.equal(body.allSubscriptions.items[0].extraDevices, 2);
  assert.equal(body.subscription.subscription.uuid, 'vpn0');
  assert.deepEqual(body.availableTrials.items.map(t => t.id), ['available']);
  assert.equal(body.availableTrials.items[0].trafficLimitBytes, '100');
  assert.equal(f.peak(), 2);
});
test('fresh subscription response reflects changes immediately and preserves outage snapshots', async () => {
  const f = fixture(); await request(f);
  f.subs[0].customName = 'Renamed'; f.subs[0].autoRenewEnabled = false;
  const fresh = await request(f);
  assert.equal(fresh.body.allSubscriptions.items[0].customName, 'Renamed');
  assert.equal(fresh.body.allSubscriptions.items[0].autoRenewEnabled, false);
  f.outage(); const offline = await request(f);
  assert.equal(offline.body.allSubscriptions.items[0].isOfflineSnapshot, true);
});
test('missing client does not receive a bootstrap profile', async () => {
  const f = fixture(); f.missing(); assert.equal((await request(f)).status, 401);
});
