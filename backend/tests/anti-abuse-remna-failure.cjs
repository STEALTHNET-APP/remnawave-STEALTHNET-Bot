const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
function load(name, deps) {
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '../src/modules/anti-abuse', name), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  }}).outputText, { exports: module.exports, Date, Set, Map, Error,
    console: { log() {}, error() {}, warn() {} },
    require(id) { if (id in deps) return deps[id]; throw Error(`Unexpected import: ${id}`); }
  });
  return module.exports;
}
const failures = [
  async () => ({ status: 504, error: 'timeout' }),
  async () => ({ status: 503 }),
  async () => { throw Error('connection reset'); },
];
const common = { 'node-cron': {}, '../diagnostics/cron-registry.js': {} };
async function testUnban(failure) {
  let pending = true, resets = 0, calls = 0, fail = true;
  const events = [];
  const prisma = {
    subscription: {
      findMany: async () => pending ? [{ id: 'sub', remnawaveUuid: 'uuid', banRuleId: 'rule' }] : [],
      update: async () => { pending = false; },
    },
    trafficAbuseState: { updateMany: async () => { resets++; } },
    trafficAbuseEvent: { create: async ({data}) => events.push(data.eventType) },
  };
  const scheduler = load('anti-abuse.scheduler.ts', { ...common, '../../db.js': {prisma},
    '../remna/remna.client.js': { remnaEnableUser: async () => { calls++; return fail ? failure() : {status: 200}; } },
    './anti-abuse.usage.js': {}, './anti-abuse.notify.js': {},
  });
  await scheduler.runAutoUnban();
  assert.equal(pending, true); assert.equal(resets, 0); assert.deepEqual(events, []);
  fail = false;
  await scheduler.runAutoUnban();
  await scheduler.runAutoUnban();
  assert.equal(pending, false); assert.equal(calls, 2); assert.equal(resets, 1);
  assert.deepEqual(events, ['UNBAN']);
}
async function testBan(failure, rolling) {
  let fail = true, updates = 0, snapshots = 0, notifications = 0;
  const events = [];
  const rule = {id:'rule', enabled:true, name:'test', action:'BAN', limitBytes:10n,
    windowKind:rolling ? 'rolling' : 'day', scopeKind:'all', priority:0, createdAt:new Date(), channels:{}};
  const prisma = {
    systemSetting: {findUnique: async ({where}) => ({value:where.key === 'anti_abuse_enabled' ? 'true' : '500'})},
    trafficAbuseRule: {findUnique:async () => rule, findMany:async () => [], update:async () => {}},
    subscription: {
      findMany:async () => [{id:'sub', remnawaveUuid:'uuid', owner:{id:'client'}, subscriptionIndex:0}],
      update:async () => {updates++;},
    },
    trafficAbuseState: {findUnique:async () => ({lastLifetimeBytes:0n}), upsert:async () => {snapshots++;}},
    trafficAbuseEvent: {create:async ({data}) => events.push(data.eventType)},
  };
  const scheduler = load('anti-abuse.scheduler.ts', {...common, '../../db.js':{prisma},
    '../remna/remna.client.js':{remnaDisableUser:async () => fail ? failure() : {status:200}},
    './anti-abuse.notify.js':{sendAbuseNotification:async () => {notifications++; return {}; }},
    './anti-abuse.usage.js':{
      resolveWindow:() => ({kind:rule.windowKind, windowKey:'window'}), windowHours:() => 24,
      collectUsageForWindow:async () => new Map([['uuid',{uuid:'uuid',periodBytes:100,lifetimeBytes:100}]])},
  });
  await scheduler.runRuleTick('rule');
  assert.equal(updates,0); assert.equal(snapshots,0); assert.equal(notifications,0);
  assert.deepEqual(events,['ERROR']);
  fail=false;
  await scheduler.runRuleTick('rule');
  assert.equal(updates,1); assert.equal(snapshots,rolling ? 1 : 0); assert.equal(notifications,1);
  assert.deepEqual(events,['ERROR','BAN']);
}
async function testManual(failure, action) {
  let fail=true, writes=0;
  const handlers={};
  const router={use(){},get(){},put(){},patch(){},delete(){},post(route, handler){handlers[route]=handler;}};
  const prisma={subscription:{findUnique:async () => ({id:'sub',remnawaveUuid:'uuid'}),update:async () => {writes++;}},
    trafficAbuseState:{updateMany:async () => {writes++;}},trafficAbuseEvent:{create:async () => {writes++;}}};
  load('anti-abuse.routes.ts',{'express':{Router:() => router},'zod':require('zod'),'../../db.js':{prisma},
    '../auth/middleware.js':{},'../audit/audit.service.js':{logAdmin:async () => {}},
    '../remna/remna.client.js':{
      remnaEnableUser:async () => fail ? failure() : {status:200},
      remnaDisableUser:async () => fail ? failure() : {status:200}},
    './anti-abuse.scheduler.js':{},
  });
  const req={params:{subscriptionId:'sub'},body:{reason:'test',durationHours:1}};
  let status=200;
  const res={status(value){status=value;return this;},json(value){return value;}};
  await handlers[`/${action}/:subscriptionId`](req,res);
  assert.equal(status,502); assert.equal(writes,0);
  fail=false;status=200;
  const result=await handlers[`/${action}/:subscriptionId`](req,res);
  assert.equal(status,200); assert.equal(result.ok,true); assert.equal(writes,3);
}
(async () => {
  for (const failure of failures) {
    await testUnban(failure);
    await testBan(failure,false); await testBan(failure,true);
    await testManual(failure,'ban'); await testManual(failure,'unban');
  }
  console.log('PASS: 15 anti-abuse failure/retry scenarios (automatic + manual ban/unban)');
})().catch(error => {console.error(error);process.exitCode=1;});
