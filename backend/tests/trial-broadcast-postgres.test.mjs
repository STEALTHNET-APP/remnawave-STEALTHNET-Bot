import assert from 'node:assert/strict';
import { test, mock, after } from 'node:test';
import { PrismaClient } from '@prisma/client';
const name = process.env.TRIAL_BROADCAST_TEST_DATABASE;
if (!name || !/^issue225_test_[a-z0-9_]+$/.test(name)) throw Error('Dedicated test database required');
const url = new URL(process.env.DATABASE_URL); url.pathname = '/' + name; process.env.DATABASE_URL = url.href;
const db = new PrismaClient({ datasourceUrl: url.href });
let deliveries = [], holdSend = null;
mock.module('../dist/db.js', { namedExports: { prisma: db } });
mock.module('../dist/modules/client/client.service.js', { namedExports: { getSystemConfig: async () => ({ telegramBotToken: 'test-token', trialDays: 3, serviceName: 'Test' }) } });
mock.module('../dist/modules/proxy-util/get-proxy-url.js', { namedExports: { getProxyUrl: async () => null } });
mock.module('../dist/modules/proxy-util/proxy-fetch.js', { namedExports: { proxyFetch: async (url, opts) => {
  assert.equal(String(url), 'https://api.telegram.org/bottest-token/sendMessage');
  deliveries.push(JSON.parse(opts.body));
  if (holdSend) await holdSend;
  return new Response(JSON.stringify({ ok: true, result: { message_id: deliveries.length } }));
} } });
mock.module('../dist/modules/email-unsubscribe/email-unsubscribe.service.js', { namedExports: { isEmailUnsubscribed: async () => false, subscribedEmailFilter: async () => ({ email: { not: null, notIn: ['unsubscribed@example.invalid'] } }), sendBroadcastEmail: async () => { throw Error('Unexpected email'); } } });
const { getEligibleTargets, catchupTrialBroadcastRule, runRule } = await import('../dist/modules/auto-broadcast/auto-broadcast.service.js');
const { syncExistingTrialUsagesFlag } = await import('../dist/modules/trial/trial.service.js');
const ago = days => new Date(Date.now() - days * 86400000);
const trial = await db.trial.create({ data: { name: 'Test trial', durationDays: 3 } });
const rule = await db.autoBroadcastRule.create({ data: { name: 'Test trial followup', triggerType: 'trial_used_never_paid', delayDays: 1, channel: 'telegram', enabled: true, message: 'Test' } });
async function client(id, days = 2, extra = {}) {
  await db.client.create({ data: { id, telegramId: id.replace(/\D/g, '') || '22500', createdAt: ago(90), ...extra } });
  const sub = await db.subscription.create({ data: { ownerId: id, subscriptionIndex: 0, trialId: trial.id, expireAt: ago(days) } });
  await db.clientTrialUsage.create({ data: { clientId: id, trialId: trial.id, subscriptionId: sub.id, activatedAt: ago(days + 3) } });
}
after(async () => db.$disconnect());

test('multi-trial expiry is used even without legacy flag and with old registration', async () => {
  await client('test22501');
  assert.deepEqual((await getEligibleTargets(rule.id)).map(x => x.clientId), ['test22501']);
});
test('active trials, payers and pending activations are excluded', async () => {
  await client('test22502', -2); await client('test22503');
  await db.payment.create({ data: { clientId: 'test22503', orderId: 'paid22503', amount: 10, currency: 'RUB', status: 'PAID' } });
  await db.client.create({ data: { id: 'test22504', telegramId: '22504' } });
  await db.clientTrialUsage.create({ data: { clientId: 'test22504', trialId: trial.id, activatedAt: ago(5) } });
  assert.deepEqual((await getEligibleTargets(rule.id)).map(x => x.clientId), ['test22501']);
  await syncExistingTrialUsagesFlag();
  assert.equal((await db.client.findUniqueOrThrow({ where: { id: 'test22504' } })).trialUsed, false);
  assert.equal((await db.client.findUniqueOrThrow({ where: { id: 'test22501' } })).trialUsed, true);
});
test('both-channel eligibility retains subscription opt-out filtering', async () => {
  await client('test22505', 2, { telegramId: null, email: 'unsubscribed@example.invalid' });
  await db.autoBroadcastRule.update({ where: { id: rule.id }, data: { channel: 'both' } });
  assert.ok(!(await getEligibleTargets(rule.id)).some(x => x.clientId === 'test22505'));
  await db.autoBroadcastRule.update({ where: { id: rule.id }, data: { channel: 'telegram' } });
});
test('catchup defaults to preview and respects delay and lookback', async () => {
  await client('test22506', 10); await client('test22507', 0.2); await client('test22508', 40);
  const preview = await catchupTrialBroadcastRule(rule.id, { sinceDays: 14 });
  assert.equal(preview.dryRun, true); assert.equal(preview.eligibleCount, 2); assert.equal(deliveries.length, 0);
  await assert.rejects(catchupTrialBroadcastRule(rule.id, { limit: NaN }));
});
test('cron and catchup share a database lock and cannot send the same message concurrently', async () => {
  let release; holdSend = new Promise(r => { release = r; });
  const cron = runRule(rule.id);
  try {
    for (let i = 0; i < 100 && deliveries.length === 0; i++) await new Promise(r => setTimeout(r, 10));
    assert.equal(deliveries.length, 1);
    const concurrent = await catchupTrialBroadcastRule(rule.id, { dryRun: false, sinceDays: 14 });
    assert.equal(concurrent.sentCount, 0); assert.ok(concurrent.errors.length > 0);
  } finally {
    release(); holdSend = null;
  }
  assert.equal((await cron).sent, 1);
  const next = await catchupTrialBroadcastRule(rule.id, { dryRun: false, sinceDays: 14 });
  assert.equal(next.sentCount, 1); assert.equal(deliveries.length, 2);
  assert.equal((await catchupTrialBroadcastRule(rule.id, { dryRun: false })).sentCount, 0);
  assert.equal(deliveries.length, 2);
});
