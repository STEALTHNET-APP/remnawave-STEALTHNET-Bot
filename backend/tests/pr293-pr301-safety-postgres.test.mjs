import assert from 'node:assert/strict';
import { test, before, beforeEach, after, mock } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaClient } from '@prisma/client';
const url = new URL(process.env.DATABASE_URL);
if (url.pathname !== '/pr293_pr301_test' || process.env.PR_SAFETY_TEST !== '1') throw Error('Dedicated disposable test database required');
const db = new PrismaClient();
const remote = new Map();
let calls = [], getHook = null, deleteHook = null, configured = true;
const config = { trialCleanupEnabled: true, trialCleanupDays: 90 };
mock.module('../dist/db.js', { namedExports: { prisma: db } });
mock.module('../dist/modules/client/client.service.js', { namedExports: { getSystemConfig: async () => config } });
mock.module('../dist/modules/remna/remna.client.js', { namedExports: {
  isRemnaConfigured: () => configured,
  remnaGetUser: async uuid => { calls.push(['get', uuid]); if (getHook) await getHook(uuid); return remote.get(uuid) ?? { status: 404, error: 'not found' }; },
  remnaDeleteUser: async uuid => { calls.push(['delete', uuid]); if (deleteHook) return deleteHook(uuid); remote.delete(uuid); return { status: 200, data: { response: { isDeleted: true } } }; },
} });
const { promoteSubscriptionToPrimary: promote, normalizeClientSubscriptionSlots: normalize, healMissingPrimarySlot: heal, updateSubscriptionDb: edit, upsertSubscriptionByRemnaUuid: upsert } = await import('../dist/modules/subscription/subscription.helpers.js');
const { runTrialCleanup: cleanup, deleteTrialClient: remove, findTrialCleanupCandidates: candidates } = await import('../dist/modules/trial/trial-cleanup.service.js');
const old = new Date('2020-01-01'), future = new Date('2100-01-01'), cutoff = new Date('2021-01-01');
const client = (id, data = {}) => db.client.create({ data: { id, ...data } });
const sub = (ownerId, id, index, data = {}) => db.subscription.create({ data: { id, ownerId, subscriptionIndex: index, ...data } });
const payment = (id, clientId, status = 'PENDING') => db.payment.create({ data: { id, clientId, orderId: id, amount: 100, currency: 'RUB', status } });
async function trial(id = 'c', data = {}) {
  await client(id, { trialUsed: true, remnawaveUuid: id + '-vpn' });
  await sub(id, id + '-sub', 0, { trialId: 'trial', remnawaveUuid: id + '-vpn', expireAt: old, ...data });
  remote.set(id + '-vpn', { status: 200, data: { response: { expireAt: old.toISOString(), status: 'EXPIRED' } } });
}
const getClient = id => db.client.findUniqueOrThrow({ where: { id } });
const getSub = id => db.subscription.findUniqueOrThrow({ where: { id } });
before(async () => assert.equal(await db.client.count(), 0));
beforeEach(async () => {
  await db.payment.deleteMany(); await db.subscription.deleteMany(); await db.client.deleteMany(); await db.trial.deleteMany(); await db.tariff.deleteMany(); await db.tariffCategory.deleteMany();
  await db.trial.create({ data: { id: 'trial', name: 'Free trial', durationDays: 3 } });
  await db.tariff.create({ data: { id: 'paid', name: 'Paid', durationDays: 30, price: 100, currency: 'RUB', category: { create: { name: 'Test' } } } });
  remote.clear(); calls = []; getHook = null; deleteHook = null; configured = true; config.trialCleanupEnabled = true;
});
after(async () => db.$disconnect());

test('promotion swaps slots atomically and clears stale tariff and renewal fields', async () => {
  await client('c', { remnawaveUuid: 'one', currentTariffId: 'paid', autoRenewEnabled: true, autoRenewTariffId: 'paid', customPrimaryPrice: 300 });
  await sub('c', 'a', 0, { remnawaveUuid: 'one', tariffId: 'paid' });
  await sub('c', 'b', 2, { remnawaveUuid: 'two' });
  assert.equal((await promote('b')).previousPrimaryId, 'a');
  assert.equal((await getSub('a')).subscriptionIndex, 2); assert.equal((await getSub('b')).subscriptionIndex, 0);
  const c = await getClient('c'); assert.equal(c.remnawaveUuid, 'two'); assert.equal(c.currentTariffId, null); assert.equal(c.autoRenewEnabled, false); assert.equal(c.autoRenewTariffId, null); assert.equal(c.customPrimaryPrice, null);
});

test('promotion copies the selected subscription billing preferences', async () => {
  await client('c'); await sub('c', 'a', 3, { tariffId: 'paid', autoRenewEnabled: true, autoRenewTariffId: 'paid', autoRenewExtraDevices: 2, customPrice: 220 });
  await promote('a'); const c = await getClient('c'); assert.equal(c.autoRenewEnabled, true); assert.equal(c.autoRenewExtraDevices, 2); assert.equal(c.customPrimaryPrice, 220);
});

test('reserved and unactivated gifts cannot be primary', async () => {
  await client('c'); await sub('c', 'gift', 1, { giftStatus: 'GIFT_RESERVED' });
  await assert.rejects(promote('gift'), /подарок/);
  await db.subscription.update({ where: { id: 'gift' }, data: { giftStatus: null, purchasedAsGift: true } });
  await assert.rejects(promote('gift'), /подарок/); assert.equal(await heal('c'), null);
});

test('a gift received by its current owner may be primary', async () => {
  await client('c'); await sub('c', 'gift', 1, { giftStatus: 'GIFTED', giftedToClientId: 'c' });
  await promote('gift'); assert.equal((await getSub('gift')).subscriptionIndex, 0);
});

test('normalization and self-heal retain an unrepresented legacy subscription', async () => {
  await client('c', { remnawaveUuid: 'legacy', currentTariffId: 'paid' });
  await normalize('c'); assert.equal((await getClient('c')).remnawaveUuid, 'legacy');
  await sub('c', 'b', 2); assert.equal(await heal('c'), null); await assert.rejects(promote('b'), /legacy/);
  assert.equal((await getSub('b')).subscriptionIndex, 2); assert.equal((await getClient('c')).currentTariffId, 'paid');
});

test('known deleted primary is replaced and nullable tariff is mirrored', async () => {
  await client('c', { remnawaveUuid: 'deleted', currentTariffId: 'paid' }); await sub('c', 'b', 4, { remnawaveUuid: 'two' });
  const result = await normalize('c', ['deleted']); assert.equal(result.promotedId, 'b'); assert.equal((await getClient('c')).currentTariffId, null); assert.equal((await getClient('c')).remnawaveUuid, 'two');
});

test('known final deletion clears its legacy reference while unrelated UUIDs do not', async () => {
  await client('c', { remnawaveUuid: 'old', currentTariffId: 'paid' }); await normalize('c', ['different']); assert.equal((await getClient('c')).remnawaveUuid, 'old');
  await normalize('c', ['old']); assert.equal((await getClient('c')).remnawaveUuid, null); assert.equal((await getClient('c')).currentTariffId, null);
});

test('self-heal synchronizes both tariff and UUID', async () => {
  await client('c', { currentTariffId: 'paid' }); await sub('c', 'b', 3, { remnawaveUuid: 'two' });
  assert.equal(await heal('c'), 'b'); assert.equal((await getClient('c')).currentTariffId, null); assert.equal((await getClient('c')).remnawaveUuid, 'two');
});

test('simultaneous promotions leave exactly one coherent primary', async () => {
  await client('c'); await sub('c', 'a', 1, { remnawaveUuid: 'one' }); await sub('c', 'b', 2, { remnawaveUuid: 'two', tariffId: 'paid' });
  await Promise.all([promote('a'), promote('b')]);
  const primary = await db.subscription.findFirstOrThrow({ where: { ownerId: 'c', subscriptionIndex: 0 } }); const c = await getClient('c');
  assert.equal(c.remnawaveUuid, primary.remnawaveUuid); assert.equal(c.currentTariffId, primary.tariffId); assert.equal(await db.subscription.count({ where: { subscriptionIndex: { lt: 0 } } }), 0);
});

test('additional subscription edit does not overwrite primary; syncToClient is rejected', async () => {
  await client('c', { remnawaveUuid: 'one', currentTariffId: 'paid' }); await sub('c', 'a', 0, { remnawaveUuid: 'one', tariffId: 'paid' }); await sub('c', 'b', 1);
  await edit('b', { remnawaveUuid: 'two', tariffId: null }); assert.equal((await getClient('c')).remnawaveUuid, 'one');
  await assert.rejects(edit('b', { syncToClient: true, tariffId: null }), /основной/); assert.equal((await getClient('c')).currentTariffId, 'paid');
});

test('primary editor rejects UUIDs held in legacy client references', async () => {
  await client('c'); await client('other', { remnawaveUuid: 'owned' }); await sub('c', 'a', 0);
  await assert.rejects(edit('a', { remnawaveUuid: 'owned' }), /привязан/); assert.equal((await getSub('a')).remnawaveUuid, null);
});

test('editor rejects duplicate UUID on another subscription of the same owner', async () => {
  await client('c'); await sub('c', 'a', 0, { remnawaveUuid: 'one' }); await sub('c', 'b', 1);
  await assert.rejects(edit('b', { remnawaveUuid: 'one' }), /привязан/);
});

test('concurrent UUID claims by different owners allow only one owner', async () => {
  await client('a'); await client('b'); await sub('a', 'sa', 0); await sub('b', 'sb', 0);
  const result = await Promise.allSettled([edit('sa', { remnawaveUuid: 'shared' }), edit('sb', { remnawaveUuid: 'shared' })]);
  assert.equal(result.filter(r => r.status === 'fulfilled').length, 1); assert.equal(await db.subscription.count({ where: { remnawaveUuid: 'shared' } }), 1); assert.equal(await db.client.count({ where: { remnawaveUuid: 'shared' } }), 1);
});

test('editor and subscription import share the UUID claim lock', async () => {
  await client('a'); await client('b'); await sub('a', 'sa', 0);
  const result = await Promise.allSettled([edit('sa', { remnawaveUuid: 'shared' }), upsert('b', { remnawaveUuid: 'shared' })]);
  assert.equal(result.filter(r => r.status === 'fulfilled').length, 1); assert.equal(await db.subscription.count({ where: { remnawaveUuid: 'shared' } }), 1);
});

test('changing UUID invalidates the old VPN cache and mirrors nullable tariff', async () => {
  await client('c', { remnawaveUuid: 'old', currentTariffId: 'paid' }); await sub('c', 'a', 0, { tariffId: 'paid', remnawaveUuid: 'old', shortUuid: 'old-link', remnaStatus: 'ACTIVE', expireAt: future, trafficUsedBytes: 42 });
  await edit('a', { remnawaveUuid: 'new', tariffId: null }); const s = await getSub('a'); assert.equal(s.shortUuid, null); assert.equal(s.expireAt, null); assert.equal(s.remnaStatus, null); assert.equal(s.trafficUsedBytes, null); assert.equal((await getClient('c')).currentTariffId, null);
});

test('disabled cleanup and dry-run never mutate data or call Remna', async () => {
  await trial(); config.trialCleanupEnabled = false; assert.equal((await cleanup()).deletedCount, 0);
  const preview = await cleanup({ dryRun: true }); assert.equal(preview.candidateCount, 1); assert.equal(preview.deletedCount, 0); assert.equal(calls.length, 0); assert.equal(await db.client.count(), 1);
});

test('confirmed expired trial is removed locally and remotely', async () => {
  await trial(); const result = await cleanup(); assert.equal(result.deletedCount, 1); assert.equal(await db.client.count(), 0); assert.equal(await db.subscription.count(), 0); assert.equal(remote.size, 0);
});

test('imported tariff-less subscription is never inferred to be a trial', async () => {
  await trial('c', { trialId: null, tariffId: null }); assert.equal((await candidates()).length, 0); assert.equal(await remove('c', cutoff), false); assert.equal(calls.length, 0);
});

test('unknown expiry and legacy-only trial are retained', async () => {
  await trial('c', { expireAt: null }); assert.equal((await cleanup()).deletedCount, 0); await db.subscription.deleteMany(); assert.equal(await remove('c', cutoff), false); assert.equal(await db.client.count(), 1);
});

for (const status of ['PENDING', 'PAID', 'FAILED', 'REFUNDED']) test(`any ${status} invoice protects the account and payment history`, async () => {
  await trial(); await payment('p', 'c', status); assert.equal((await cleanup()).deletedCount, 0); assert.equal(await remove('c', cutoff), false); assert.equal(await db.payment.count(), 1); assert.equal(calls.length, 0);
});

test('invoice created after candidate selection protects the client on recheck', async () => {
  await trial(); assert.equal((await candidates()).length, 1); await payment('p', 'c', 'PAID'); assert.equal(await remove('c', cutoff), false); assert.equal(await db.client.count(), 1);
});

test('a concurrent payment transaction wins before cleanup acquires its row lock', async () => {
  await trial(); let release, locked; const ready = new Promise(r => locked = r); const gate = new Promise(r => release = r);
  const paying = db.$transaction(async tx => { await tx.$queryRaw`SELECT id FROM clients WHERE id = 'c' FOR UPDATE`; locked(); await gate; await tx.payment.create({ data: { clientId: 'c', orderId: 'race', amount: 100, currency: 'RUB', status: 'PAID' } }); });
  await ready; const removing = remove('c', cutoff); await delay(50); release(); await paying;
  assert.equal(await removing, false); assert.equal(await db.payment.count(), 1); assert.equal(calls.length, 0);
});

test('payment insertion cannot pass while cleanup owns the client lock', async () => {
  await trial(); let pending, settled = false;
  getHook = async () => { pending = payment('p', 'c').then(() => { settled = true; }); await delay(80); assert.equal(settled, false); throw Error('abort cleanup to retain account'); };
  await assert.rejects(remove('c', cutoff), /abort cleanup/); await pending; assert.equal(await db.payment.count(), 1); assert.equal(await db.client.count(), 1); assert.equal(calls.some(c => c[0] === 'delete'), false);
});

test('Remna timeout leaves local client and subscription for a retry', async () => {
  await trial(); deleteHook = async () => { throw Error('timeout'); }; const result = await cleanup(); assert.equal(result.failedCount, 1); assert.equal(result.deletedCount, 0); assert.equal(await db.client.count(), 1); assert.equal(await db.subscription.count(), 1);
  deleteHook = null; assert.equal((await cleanup()).deletedCount, 1);
});

test('uncertain remote deletion reconciles not-found on the next run', async () => {
  await trial(); deleteHook = async uuid => { remote.delete(uuid); throw Error('response lost'); }; assert.equal((await cleanup()).failedCount, 1); assert.equal(await db.client.count(), 1);
  deleteHook = async () => ({ status: 404, error: 'not found' }); assert.equal((await cleanup()).deletedCount, 1);
});

test('remote expiry newer than cached expiry and unknown status prevent deletion', async () => {
  await trial(); remote.set('c-vpn', { status: 200, data: { response: { expireAt: future.toISOString(), status: 'ACTIVE' } } }); assert.equal(await remove('c', cutoff), false);
  remote.set('c-vpn', { status: 200, data: { response: { expireAt: old.toISOString() } } }); assert.equal(await remove('c', cutoff), false); assert.equal(calls.some(c => c[0] === 'delete'), false);
});

test('unconfigured and unavailable Remna never delete the local account', async () => {
  await trial(); configured = false; assert.equal((await cleanup()).failedCount, 1); configured = true; remote.set('c-vpn', { status: 503, error: 'offline' }); assert.equal((await cleanup()).failedCount, 1); assert.equal(await db.client.count(), 1);
});

test('shared legacy VPN ownership is retained', async () => {
  await trial(); await client('other', { remnawaveUuid: 'c-vpn' }); assert.equal(await remove('c', cutoff), false); assert.equal(calls.length, 0);
});

test('overlapping cleanup runs delete each remote profile only once', async () => {
  await trial(); const results = await Promise.all([remove('c', cutoff), remove('c', cutoff)]); assert.equal(results.filter(Boolean).length, 1); assert.equal(calls.filter(c => c[0] === 'delete').length, 1);
});

test('cosmetic primary edit retains renewal promo and notification state', async () => {
  await client('c', { autoRenewPromoCode: 'KEEP', autoRenewRetryCount: 2 }); await sub('c', 'a', 0);
  await edit('a', { customName: 'Renamed' }); const c = await getClient('c'); assert.equal(c.autoRenewPromoCode, 'KEEP'); assert.equal(c.autoRenewRetryCount, 2);
});

test('paid trial definition is never cleaned automatically', async () => {
  await trial(); await db.trial.update({ where: { id: 'trial' }, data: { price: 1 } }); assert.equal((await candidates()).length, 0); assert.equal(await remove('c', cutoff), false); assert.equal(calls.length, 0);
});

test('a 200 deletion response without actual deletion preserves local mapping', async () => {
  await trial(); deleteHook = async () => ({ status: 200, data: { response: { isDeleted: false } } }); assert.equal((await cleanup()).failedCount, 1); assert.equal(await db.client.count(), 1); assert.equal((await getSub('c-sub')).remnawaveUuid, 'c-vpn');
});

test('gift-only, unknown legacy and current trial clients are excluded', async () => {
  await trial('gift', { purchasedAsGift: true }); await trial('current', { expireAt: future }); await trial('legacy'); await db.client.update({ where: { id: 'legacy' }, data: { remnawaveUuid: 'untracked' } });
  assert.equal((await candidates()).length, 0); assert.equal((await cleanup()).deletedCount, 0); assert.equal(calls.length, 0);
});

test('normalization moves a reserved gift behind usable subscriptions', async () => {
  await client('c'); await sub('c', 'gift', 0, { purchasedAsGift: true }); await sub('c', 'usable', 3, { remnawaveUuid: 'real', tariffId: 'paid' });
  await normalize('c'); assert.equal((await getSub('usable')).subscriptionIndex, 0); assert.equal((await getSub('gift')).subscriptionIndex, 1); assert.equal((await getClient('c')).remnawaveUuid, 'real');
});
