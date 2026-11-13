import assert from 'node:assert/strict';
import { mock, test, before, after, beforeEach } from 'node:test';
import { PrismaClient } from '@prisma/client';

const url = process.env.AUTO_RENEW_TEST_DATABASE_URL;
if (!url || !/^issue93_test(?:_|$)/.test(new URL(url).pathname.slice(1))) throw new Error('Use a dedicated issue93_test database');
const database = new PrismaClient({ datasourceUrl: url });
let synchronizedReads = 0;
let readBarrier;
let releaseReads;
let failMarkerWrite = false;
let failActivation = false;
async function synchronizeMarkerRead(row) {
  if (synchronizedReads > 0) {
    synchronizedReads--;
    if (synchronizedReads === 0) releaseReads();
    await readBarrier;
  }
  return row;
}
const prisma = database.$extends({ query: {
  subscription: {
    async findUnique({ args, query }) {
      const row = await query(args);
      return args.select?.lastNotifiedKey ? synchronizeMarkerRead(row) : row;
    },
    async updateMany({ args, query }) {
      if (failMarkerWrite && args.data.lastNotifiedKey) throw new Error('Marker write failed');
      return query(args);
    },
  },
  client: {
    async findUnique({ args, query }) {
      const row = await query(args);
      return args.select?.lastArnNotifiedKey ? synchronizeMarkerRead(row) : row;
    },
    async updateMany({ args, query }) {
      if (failMarkerWrite && args.data.lastArnNotifiedKey) throw new Error('Marker write failed');
      return query(args);
    },
  },
} });
const noop = async () => {};
const remote = new Map();
const activationCalls = [];
const notificationNames = ['notifyAutoRenewSuccess','notifyAutoRenewFailed','notifyAutoRenewUpcoming','notifyAutoRenewRetry','notifyAutoRenewYookassaSuccess','notifyAutoRenewYookassaFailed','notifyAdminsAboutAutoRenewFailed','sendTelegramToUser'];
mock.module('../dist/db.js', { namedExports: { prisma } });
mock.module('../dist/modules/client/client.service.js', { namedExports: { getSystemConfig: async () => ({ autoRenewDaysBeforeExpiry: 1, autoRenewNotifyDaysBefore: 3, yookassaRecurringEnabled: false }) } });
mock.module('../dist/modules/notification/telegram-notify.service.js', { namedExports: Object.fromEntries(notificationNames.map(n => [n, noop])) });
mock.module('../dist/modules/yookassa/yookassa.service.js', { namedExports: { createYookassaAutopayment: async () => { throw new Error('Unexpected card request'); } } });
mock.module('../dist/modules/referral/referral.service.js', { namedExports: { distributeReferralRewards: noop } });
mock.module('../dist/modules/remna/remna.client.js', { namedExports: {
  isRemnaConfigured: () => true,
  remnaGetUser: async uuid => { assert.ok(remote.has(uuid)); return { data: { expireAt: remote.get(uuid).toISOString() } }; },
} });
mock.module('../dist/modules/tariff/tariff-activation.service.js', { namedExports: {
  parseDeviceDiscountTiers: () => [],
  applyExtraDevicesPrice: (price, extras, tiers, days) => ({ extrasTotal: price * extras * days / 30 }),
  activateTariffByPaymentId: async id => {
    activationCalls.push(id);
    if (failActivation) return { ok: false, error: "Test activation failure" };
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id }, include: { client: true } });
    remote.set(payment.client.remnawaveUuid, new Date(Date.now() + 30 * 86400000));
    return { ok: true };
  },
  extendSecondarySubscription: async (id, tariff) => {
    activationCalls.push(id);
    if (failActivation) return { ok: false, error: "Test activation failure" };
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { id } });
    remote.set(sub.remnawaveUuid, new Date(Date.now() + tariff.durationDays * 86400000));
    return { ok: true };
  },
} });
const { processAutoRenewals } = await import('../dist/modules/payment/auto-renew.cron.js');
const { tryMarkSubDedup, tryMarkClientDedup } = await import('../dist/modules/notification/auto-renew-notifications.service.js');
const prefix = `issue93-${process.pid}`;
let tariff;
let client;
let sub;
before(async () => {
  assert.equal(await database.client.count(), 0, 'Database must contain no clients');
  const category = await database.tariffCategory.create({ data: { id: prefix, name: 'Test' } });
  tariff = await database.tariff.create({ data: { id: prefix, categoryId: category.id, name: 'Test', price: 100, durationDays: 30, currency: 'RUB', includedDevices: 1, maxExtraDevices: 5, pricePerExtraDevice: 20, internalSquadUuids: [] } });
  await database.tariffPriceOption.create({ data: { id: prefix, tariffId: tariff.id, price: 100, durationDays: 30 } });
});
beforeEach(async () => {
  await database.client.deleteMany({ where: { id: { startsWith: prefix } } });
  remote.clear(); activationCalls.length = 0; synchronizedReads = 0; failMarkerWrite = false; failActivation = false;
  client = await database.client.create({ data: { id: `${prefix}-client`, balance: 1000, remnawaveUuid: `${prefix}-vpn`, autoRenewEnabled: true, autoRenewTariffId: tariff.id, autoRenewPriceOptionId: prefix, autoRenewExtraDevices: 1 } });
  sub = await database.subscription.create({ data: { id: `${prefix}-sub`, ownerId: client.id, subscriptionIndex: 0, tariffId: tariff.id, autoRenewEnabled: true, remnawaveUuid: client.remnawaveUuid, autoRenewPriceOptionId: prefix, customPrice: 120, extraDevices: 1, extraDevicesMonthlyPrice: 20 } });
  remote.set(client.remnawaveUuid, new Date(Date.now() + 3600000));
});
after(async () => {
  await database.client.deleteMany({ where: { id: { startsWith: prefix } } });
  await database.tariffCategory.deleteMany({ where: { id: prefix } });
  await database.$disconnect();
});
async function assertOneRenewal() {
  assert.equal((await database.client.findUniqueOrThrow({ where: { id: client.id } })).balance, 880);
  const payments = await database.payment.findMany({ where: { clientId: client.id, status: 'PAID' } });
  assert.equal(payments.length, 1);
  assert.equal(payments[0].amount, 120);
  assert.equal(JSON.parse(payments[0].metadata).autoRenew, true);
  assert.equal(activationCalls.length, 1);
}
test('base tariff plus one device is charged once when both auto-renew flags are enabled', async () => {
  await processAutoRenewals();
  await processAutoRenewals();
  await assertOneRenewal();
});
test('legacy renewal includes extras once', async () => {
  await database.subscription.update({ where: { id: sub.id }, data: { autoRenewEnabled: false } });
  await processAutoRenewals();
  await assertOneRenewal();
});
test('two concurrent jobs must not debit the same subscription twice', async () => {
  synchronizedReads = 2;
  readBarrier = new Promise(resolve => { releaseReads = resolve; });
  await Promise.all([processAutoRenewals(), processAutoRenewals()]);
  await assertOneRenewal();
});
test('missing subscriptions never acquire a renewal marker', async () => {
  assert.equal(await tryMarkSubDedup('missing-subscription', 'sec_renew_attempt', 3600000), false);
});

test('parallel legacy jobs debit the client only once', async () => {
  await database.subscription.update({ where: { id: sub.id }, data: { autoRenewEnabled: false } });
  synchronizedReads = 2;
  readBarrier = new Promise(resolve => { releaseReads = resolve; });
  await Promise.all([processAutoRenewals(), processAutoRenewals()]);
  await assertOneRenewal();
});
test('concurrent independent markers are preserved and same-marker attempts are denied', async () => {
  synchronizedReads = 2;
  readBarrier = new Promise(resolve => { releaseReads = resolve; });
  assert.deepEqual(await Promise.all([
    tryMarkSubDedup(sub.id, 'first', 3600000),
    tryMarkSubDedup(sub.id, 'second', 3600000),
  ]), [true, true]);
  const saved = await database.subscription.findUniqueOrThrow({ where: { id: sub.id } });
  assert.deepEqual(Object.keys(JSON.parse(saved.lastNotifiedKey)).sort(), ['first', 'second']);
  assert.equal(await tryMarkSubDedup(sub.id, 'first', 3600000), false);
});
test('failed marker writes cannot authorize a balance debit', async () => {
  failMarkerWrite = true;
  await processAutoRenewals();
  assert.equal((await database.client.findUniqueOrThrow({ where: { id: client.id } })).balance, 1000);
  assert.equal(await database.payment.count({ where: { clientId: client.id } }), 0);
  assert.equal(activationCalls.length, 0);
  await assert.rejects(tryMarkClientDedup(client.id, 'root_renew_attempt', 3600000), /Marker write failed/);
});
test('failed activation refunds the debit and is not retried immediately', async () => {
  failActivation = true;
  await processAutoRenewals();
  await processAutoRenewals();
  assert.equal((await database.client.findUniqueOrThrow({ where: { id: client.id } })).balance, 1000);
  const payments = await database.payment.findMany({ where: { clientId: client.id } });
  assert.equal(payments.length, 1);
  assert.equal(payments[0].status, 'FAILED');
  assert.equal(activationCalls.length, 1);
});
