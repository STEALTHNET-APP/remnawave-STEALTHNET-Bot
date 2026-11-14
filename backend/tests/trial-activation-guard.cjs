const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
let state;
const reset = () => state = { usages: new Map(), calls: 0, mode: 'ok', enabled: true, subscriptions: 0, multi: true, price: 0, balance: 100, payments: new Map() };
const key = where => `${where.clientId_trialId.clientId}:${where.clientId_trialId.trialId}`;
const prisma = {
  $executeRaw: async () => 1,
  trial: { findUnique: async () => ({ id: 'trial', name: 'Trial', price: state.price, enabled: state.enabled, tariffId: null, squadUuids: '["squad"]', durationDays: 2, deviceLimit: 1, tariff: null }) },
  clientTrialUsage: {
    findFirst: async () => [...state.usages.values()].find(row => row.subscriptionId === null) ?? null,
    findUnique: async ({where}) => state.usages.get(key(where)) ?? null,
    create: async ({data}) => {
      const id = `${data.clientId}:${data.trialId}`;
      if (state.usages.has(id)) throw Object.assign(new Error('duplicate'), {code: 'P2002'});
      state.usages.set(id, {...data, subscriptionId: null});
    },
    update: async ({where, data}) => Object.assign(state.usages.get(key(where)), data),
    delete: async ({where}) => state.usages.delete(key(where)),
  },
  subscription: {
    count: async () => state.subscriptions,
    update: async () => ({}),
    findUnique: async () => ({remnawaveUuid: 'vpn'}),
  },
  client: {
    updateMany: async ({where, data}) => { if (state.balance < where.balance.gte) return {count: 0}; state.balance -= data.balance.decrement; return {count: 1}; },
    update: async ({data}) => { if (data.balance?.increment) state.balance += data.balance.increment; return {}; },
  },
  payment: {
    create: async ({data}) => { const row = {id: 'payment', ...data}; state.payments.set(row.id, row); return row; },
    update: async ({where, data}) => Object.assign(state.payments.get(where.id), data),
    updateMany: async ({where, data}) => { const row = state.payments.get(where.id); if (row?.status !== where.status) return {count: 0}; Object.assign(row, data); return {count: 1}; },
  },
  $transaction: async fn => {
    const balance = state.balance;
    const usages = new Map([...state.usages].map(([k,v]) => [k,{...v}]));
    const payments = new Map([...state.payments].map(([k,v]) => [k,{...v}]));
    try { return await fn(prisma); } catch (error) {
      if (error.code !== 'P2002' && error.message !== 'TRIAL_ACTIVATION_PENDING') { state.balance = balance; state.usages = usages; state.payments = payments; }
      throw error;
    }
  },
};
const dependencies = {
  '../../db.js': {prisma},
  'node:crypto': require('node:crypto'),
  '../client/client.service.js': {getSystemConfig: async () => ({multiSubscriptionsEnabled: state.multi})},
  '../client/multi-subscriptions.js': {isMultiSubscriptionsEnabled: config => config?.multi === true},
  '../remna/remna.client.js': {isRemnaConfigured: () => true, remnaGetUser: async () => ({data: {response: {subscriptionUrl: 'https://example.invalid/sub'}}})},
  '../gift/gift.service.js': {createAdditionalSubscription: async () => {
    state.calls++;
    await Promise.resolve();
    if (state.mode === 'throw') throw new Error('ambiguous timeout');
    if (typeof state.mode === 'number') return {ok: false, status: state.mode, error: 'failed'};
    return {ok: true, data: {subscriptionId: 'sub', subscriptionIndex: 0}};
  }},
  '../notification/telegram-notify.service.js': {notifyAdminsAboutTrialActivated: async () => {}},
};
const filename = path.join(__dirname, '../src/modules/trial/trial.service.ts');
const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
const mod = {exports: {}};
vm.runInNewContext(code, {module: mod, exports: mod.exports, require: name => {
  if (!dependencies[name]) throw new Error(name);
  return dependencies[name];
}, console, JSON, Promise, Error, Date});
const activate = mod.exports.activateTrial;
(async () => {
  reset();
  const results = await Promise.all(Array.from({length: 8}, () => activate('client', 'trial')));
  assert.equal(results.filter(r => r.status === 200).length, 1);
  assert.equal(results.filter(r => r.status === 409).length, 7);
  assert.equal(state.calls, 1);
  assert.equal(state.usages.get('client:trial').subscriptionId, 'sub');
  assert.equal((await activate('client', 'trial')).status, 409);
  assert.equal(state.calls, 1);
  reset(); state.mode = 400;
  assert.equal((await activate('client', 'trial')).status, 400);
  assert.equal(state.usages.size, 0);
  state.mode = 'ok';
  assert.equal((await activate('client', 'trial')).status, 200);
  reset(); state.mode = 502;
  assert.equal((await activate('client', 'trial')).status, 502);
  assert.equal((await activate('client', 'trial')).status, 409);
  assert.equal(state.calls, 1);
  reset(); state.mode = 'throw';
  assert.equal((await activate('client', 'trial')).status, 502);
  assert.equal((await activate('client', 'trial')).status, 409);
  reset(); state.enabled = false;
  assert.equal((await activate('client', 'trial')).status, 404);
  assert.equal(state.calls, 0);
  reset(); state.multi = false; state.subscriptions = 1;
  assert.equal((await activate('client', 'trial')).status, 400);
  assert.equal(state.calls, 0);
  reset(); state.price = 10;
  assert.equal((await activate('client', 'trial')).status, 409);
  assert.equal(state.balance, 100);
  const paid = await Promise.all(Array.from({length: 5}, () => activate('client', 'trial', 10)));
  assert.equal(paid.filter(r => r.status === 200).length, 1);
  assert.equal(state.balance, 90);
  assert.equal(state.payments.get('payment').status, 'PAID');
  reset(); state.price = 150;
  assert.equal((await activate('client', 'trial', 150)).body.code, 'INSUFFICIENT_BALANCE');
  assert.equal(state.balance, 100);
  assert.equal(state.usages.size, 0);
  reset(); state.price = 10; state.mode = 400;
  assert.equal((await activate('client', 'trial', 10)).status, 400);
  assert.equal(state.balance, 100);
  assert.equal(state.payments.get('payment').status, 'FAILED');
  reset(); state.price = 10; state.mode = 'throw';
  assert.equal((await activate('client', 'trial', 10)).status, 502);
  assert.equal(state.balance, 90);
  assert.equal(state.payments.get('payment').status, 'PROCESSING');
  assert.equal((await activate('client', 'trial', 10)).status, 409);
  assert.equal(state.balance, 90);
  console.log('trial activation: concurrent requests, retries, ambiguous failures and eligibility passed');
})().catch(error => {console.error(error); process.exitCode = 1;});
