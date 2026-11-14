const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function scenario({ reuse = false, replacing = false, fail = true } = {}) {
  const deleted = [];
  const persisted = [];
  const original = { id: 'trial', subscriptionIndex: 0, remnawaveUuid: 'old-trial-profile' };
  const prisma = {
    client: { findUnique: async () => ({ id: 'c', remnawaveUuid: reuse ? 'existing-paid-profile' : null }), findFirst: async () => null, update: async () => ({}) },
    subscription: {
      count: async () => 0,
      findFirst: async ({ where }) => where.id === 'trial' ? original : null,
      create: async ({ data }) => { if (fail) throw Error('database unavailable'); persisted.push(data); return { id: 'new-sub', subscriptionIndex: 0 }; },
      delete: async () => ({}),
    },
    giftHistory: { create: async () => ({}) },
    cloudPaymentAgreement: { updateMany: async () => ({ count: 0 }) },
    $transaction: async fn => fn(prisma),
  };
  const mocks = {
    '../../db.js': { prisma },
    './telegram-notify.js': {},
    '../remna/remna.client.js': {
      isRemnaConfigured: () => true,
      remnaGetUser: async () => ({ data: { expireAt: '2030-01-01T00:00:00Z' } }),
      remnaUpdateUser: async () => ({ data: {} }),
      remnaCreateUser: async () => ({ data: { uuid: 'new-profile' } }),
      extractRemnaUuid: data => data?.uuid,
      remnaUsernameFromClient: () => 'fixture',
      remnaDeleteUser: async id => deleted.push(id),
    },
    '../client/client.service.js': { getSystemConfig: async () => ({ giftSubscriptionsEnabled: true, maxAdditionalSubscriptions: 10 }) },
    '../subscription/subscription.helpers.js': { getNextSubscriptionIndex: async () => 0 },
    '../tariff/extras-pricing.js': {},
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/modules/gift/gift.service.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: name => mocks[name] ?? require(name), console: { log() {}, warn() {}, error() {} }, Date, Math, Set });
  return { deleted, persisted, run: () => exports.createAdditionalSubscription('c', {
    id: 'paid', durationDays: 30, trafficLimitBytes: null, deviceLimit: 1, internalSquadUuids: [],
  }, replacing ? { replacingSubscriptionId: 'trial' } : undefined) };
}

test('a failed database save never deletes a reused VPN profile', async () => {
  const s = scenario({ reuse: true });
  assert.equal((await s.run()).ok, false);
  assert.deepEqual(s.deleted, []);
});
test('a newly created profile is cleaned up after a failed database save', async () => {
  const s = scenario();
  assert.equal((await s.run()).ok, false);
  assert.deepEqual(s.deleted, ['new-profile']);
});
test('a failed trial replacement preserves the old profile', async () => {
  const s = scenario({ replacing: true });
  assert.equal((await s.run()).ok, false);
  assert.deepEqual(s.deleted, ['new-profile']);
});
test('a committed trial replacement deletes only the replaced profile', async () => {
  const s = scenario({ replacing: true, fail: false });
  assert.equal((await s.run()).ok, true);
  assert.equal(s.persisted[0].remnawaveUuid, 'new-profile');
  assert.deepEqual(s.deleted, ['old-trial-profile']);
});
