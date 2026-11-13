import assert from 'node:assert/strict';
import { test, before, beforeEach, after, mock } from 'node:test';
import { PrismaClient } from '@prisma/client';
const name = process.env.REFERRAL_TEST_DATABASE;
if (!name || !/^issue149_test_[a-z0-9_]+$/.test(name)) throw Error('Dedicated test database required');
const url = new URL(process.env.DATABASE_URL); url.pathname = '/' + name;
const db = new PrismaClient({ datasourceUrl: url.href });
let config, remote, requests, failAfterUpdate, counter;
mock.module('../dist/db.js', { namedExports: { prisma: db } });
mock.module('../dist/modules/client/client.service.js', { namedExports: { getSystemConfig: async () => config } });
mock.module('../dist/modules/remna/remna.client.js', { namedExports: {
 remnaGetUser: async id => remote.has(id) ? { status: 200, data: { response: remote.get(id) } } : { status: 503, error: 'offline' },
 remnaUpdateUser: async patch => { requests.push(patch); remote.set(patch.uuid, { ...remote.get(patch.uuid), ...patch }); return failAfterUpdate ? { status: 504, error: 'lost response' } : { status: 200, data: { response: remote.get(patch.uuid) } }; },
} });
const { distributeReferralRewards: distribute } = await import('../dist/modules/referral/referral.service.js');
const { applyReferralDays: applyDays, processReferralDayRewards: processDays } = await import('../dist/modules/referral/referral-rewards.service.js');
const day = 86400000;
async function payment(id, extra = {}) { return db.payment.create({ data: { id, orderId: id, clientId: 'friend', provider: 'platega', amount: 500, currency: 'RUB', status: 'PAID', paidAt: new Date(Date.now() + counter++), ...extra } }); }
async function setup() {
 await db.client.create({ data: { id: 'owner', balance: 0 } });
 await db.client.create({ data: { id: 'friend', referrerId: 'owner' } });
}
async function sub(id = 'primary', index = 0, extra = {}) {
 const expiry = new Date(Date.now() + 10 * day);
 remote.set(id, { expireAt: expiry.toISOString(), status: 'ACTIVE' });
 return db.subscription.create({ data: { id, ownerId: 'owner', subscriptionIndex: index, remnawaveUuid: id, expireAt: expiry, ...extra } });
}
async function award(id = 'paid') { await payment(id); await distribute(id); return db.referralReward.findUniqueOrThrow({ where: { refereeId: 'friend' } }); }
before(async () => { assert.equal(await db.client.count(), 0); });
beforeEach(async () => {
 await db.referralReward.deleteMany(); await db.referralCredit.deleteMany(); await db.payment.deleteMany(); await db.subscription.deleteMany(); await db.client.updateMany({ data: { referrerId: null } }); await db.client.deleteMany();
 config = { referralRewardMode: 'balance', referralRewardAmount: 50, referralRewardDays: 3, defaultCurrency: 'RUB', defaultReferralPercent: 10, referralPercentLevel2: 5, referralPercentLevel3: 2, referralRewardEnabledAt: new Date(Date.now() - day).toISOString() };
 remote = new Map(); requests = []; failAfterUpdate = false; counter = 0; await setup();
});
after(async () => { await db.$disconnect(); });

test('fixed reward is given once on the first external payment; later payments and duplicate delivery do not pay again', async () => {
 await payment('p1'); await distribute('p1'); await distribute('p1'); await payment('p2'); await distribute('p2');
 assert.equal((await db.client.findUniqueOrThrow({ where: { id: 'owner' } })).balance, 50);
 assert.equal(await db.referralReward.count(), 1); assert.equal(await db.referralCredit.count(), 1);
});

test('two concurrent payments and two calls for the same payment produce one reward', async () => {
 await payment('p1'); await payment('p2');
 await Promise.all([distribute('p1'), distribute('p1'), distribute('p2')]);
 assert.equal((await db.client.findUniqueOrThrow({ where: { id: 'owner' } })).balance, 50);
 assert.equal(await db.referralReward.count(), 1); assert.equal(await db.referralCredit.count(), 1);
});

test('internal, free, unpaid and mixed payments with no external amount never earn a reward', async () => {
 for (const [id, data] of Object.entries({ internal: { provider: 'balance' }, admin: { provider: 'admin_grant' }, free: { amount: 0 }, pending: { status: 'PENDING' }, mixed: { metadata: JSON.stringify({ cardPortion: 0 }) } })) { await payment(id, data); await distribute(id); }
 assert.equal(await db.referralReward.count(), 0); assert.equal(await db.referralCredit.count(), 0);
 await payment('real', { metadata: JSON.stringify({ cardPortion: 100 }) }); await distribute('real');
 assert.equal((await db.client.findUniqueOrThrow({ where: { id: 'owner' } })).balance, 50);
});

test('old payments and already-paying referrals are not rewarded retroactively after enabling the mode', async () => {
 await payment('old', { paidAt: new Date(Date.now() - 2 * day) }); await distribute('old');
 await payment('new'); await distribute('new');
 assert.equal(await db.referralReward.count(), 0); assert.equal((await db.client.findUniqueOrThrow({ where: { id: 'owner' } })).balance, 0);
});

test('blocked referrers and self-referrals do not receive a bonus', async () => {
 await db.client.update({ where: { id: 'owner' }, data: { isBlocked: true } }); await payment('blocked'); await distribute('blocked');
 await db.client.update({ where: { id: 'friend' }, data: { referrerId: 'friend' } }); await payment('self'); await distribute('self');
 assert.equal(await db.referralReward.count(), 0);
});

test('percentage mode keeps three levels and the personal first-level override', async () => {
 config.referralRewardMode = 'percent';
 await db.client.create({ data: { id: 'third' } }); await db.client.create({ data: { id: 'second', referrerId: 'third', referralPercent: 99 } });
 await db.client.update({ where: { id: 'owner' }, data: { referrerId: 'second', referralPercent: 20 } });
 await payment('percent'); await distribute('percent'); await distribute('percent');
 const credits = await db.referralCredit.findMany({ orderBy: { level: 'asc' } });
 assert.deepEqual(credits.map(c => [c.level, c.amount]), [[1, 100], [2, 25], [3, 10]]); assert.equal(await db.referralReward.count(), 0);
});

test('days are stored without a subscription and later extend only the primary subscription', async () => {
 config.referralRewardMode = 'days'; const reward = await award();
 assert.equal(await applyDays(reward.id), false); assert.equal(requests.length, 0);
 const primary = await sub(); const secondary = await sub('secondary', 1);
 assert.equal(await applyDays(reward.id), true); assert.equal(await applyDays(reward.id), false);
 assert.equal(Date.parse(remote.get('primary').expireAt), primary.expireAt.getTime() + 3 * day);
 assert.equal(Date.parse(remote.get('secondary').expireAt), secondary.expireAt.getTime());
 assert.equal((await db.client.findUniqueOrThrow({ where: { id: 'owner' } })).balance, 0);
});

test('an ambiguous Remna failure is retried with the same target expiry, never adding days twice', async () => {
 config.referralRewardMode = 'days'; const reward = await award(); const primary = await sub(); failAfterUpdate = true;
 await assert.rejects(applyDays(reward.id));
 const pending = await db.referralReward.findUniqueOrThrow({ where: { id: reward.id } }); assert.equal(pending.appliedAt, null); assert.ok(pending.targetExpireAt);
 failAfterUpdate = false; assert.equal(await applyDays(reward.id), true);
 assert.equal(Date.parse(remote.get('primary').expireAt), primary.expireAt.getTime() + 3 * day); assert.equal(requests[0].expireAt, requests[1].expireAt);
});

test('simultaneous delivery attempts apply one reward once', async () => {
 config.referralRewardMode = 'days'; const reward = await award(); const primary = await sub();
 await Promise.all([applyDays(reward.id), applyDays(reward.id)]);
 assert.equal(requests.length, 1); assert.equal(Date.parse(remote.get('primary').expireAt), primary.expireAt.getTime() + 3 * day);
});

test('several saved rewards stack days and keep their original size when settings change', async () => {
 config.referralRewardMode = 'days'; await award();
 await db.client.create({ data: { id: 'friend2', referrerId: 'owner' } }); config.referralRewardDays = 5;
 await payment('second-friend', { clientId: 'friend2' }); await distribute('second-friend');
 config.referralRewardMode = 'balance'; const primary = await sub(); await processDays(); await processDays();
 assert.equal(Date.parse(remote.get('primary').expireAt), primary.expireAt.getTime() + 8 * day); assert.equal(await db.referralReward.count({ where: { appliedAt: null } }), 0);
});

test('banned, gifted, revoked and remotely disabled subscriptions do not consume days', async () => {
 config.referralRewardMode = 'days'; const reward = await award(); await sub();
 for (const patch of [{ bannedUntil: new Date(Date.now() + day) }, { purchasedAsGift: true }, { subRevokedAt: new Date() }]) {
   await db.subscription.update({ where: { id: 'primary' }, data: { bannedUntil: null, purchasedAsGift: false, subRevokedAt: null, ...patch } });
   assert.equal(await applyDays(reward.id), false);
 }
 await db.subscription.update({ where: { id: 'primary' }, data: { bannedUntil: null, purchasedAsGift: false, subRevokedAt: null } }); remote.get('primary').status = 'DISABLED';
 assert.equal(await applyDays(reward.id), false); assert.equal(requests.length, 0);
});

test('a saved reward never follows a subscription transferred to a different client', async () => {
 config.referralRewardMode = 'days'; const reward = await award(); await sub(); failAfterUpdate = true; await assert.rejects(applyDays(reward.id));
 await db.subscription.update({ where: { id: 'primary' }, data: { ownerId: 'friend' } }); failAfterUpdate = false;
 assert.equal(await applyDays(reward.id), false); assert.equal(requests.length, 1); assert.equal((await db.referralReward.findUniqueOrThrow({ where: { id: reward.id } })).appliedAt, null);
});
