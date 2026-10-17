import assert from 'node:assert/strict';
import { test, before, after, mock } from 'node:test';
import { PrismaClient } from '@prisma/client';
const name = process.env.CLIENT_TELEGRAM_TEST_DATABASE;
if (!name || !/^issue72_test_[a-z0-9_]+$/.test(name)) throw Error('Dedicated test database required');
const url = new URL(process.env.DATABASE_URL); url.pathname = '/' + name;
const db = new PrismaClient({ datasourceUrl: url.href });
mock.module('../dist/db.js', { namedExports: { prisma: db } });
const { updateClientSchema, updateAdminClientProfile: update, ClientProfileError } = await import('../dist/modules/admin/client-profile.service.js');
const create = (id, data = {}) => db.client.create({ data: { id, email: `${id}@example.invalid`, passwordHash: 'test-hash', ...data } });
const pending = id => db.pendingTelegramLink.create({ data: { clientId: id, code: id, expiresAt: new Date(Date.now() + 600000) } });
const failure = status => e => e instanceof ClientProfileError && e.status === status;
before(async () => { assert.equal(await db.client.count(), 0); });
after(async () => { await db.$disconnect(); });

test('normalizes ID and rejects usernames, groups, decimals and oversized numbers', () => {
  for (const id of ['123', '4503599627370495']) assert.equal(updateClientSchema.parse({ telegramId: ` ${id} ` }).telegramId, id);
  for (const id of ['', '  ', null]) assert.equal(updateClientSchema.parse({ telegramId: id }).telegramId, null);
  assert.equal(updateClientSchema.parse({ balance: 12 }).telegramId, undefined);
  for (const id of ['@test', '-100123', '0', '00123', '1.2', '1e3', '4503599627370496', '12345678901234567', 123, {}]) assert.equal(updateClientSchema.safeParse({ telegramId: id }).success, false);
});

test('binds and changes Telegram without changing subscriptions, balance or referral identity', async () => {
  await create('link', { balance: 72, referralCode: 'ref72', remnawaveUuid: 'remna72' });
  let c = await update('link', { telegramId: '72001', expectedTelegramId: null });
  assert.equal(c.telegramId, '72001'); assert.equal(c.balance, 72); assert.equal(c.referralCode, 'ref72'); assert.equal(c.remnawaveUuid, 'remna72');
  await db.client.update({ where: { id: 'link' }, data: { telegramUsername: 'old_user', telegramUnreachable: true } });
  await pending('link');
  c = await update('link', { telegramId: '72002', expectedTelegramId: '72001' });
  assert.equal(c.telegramUsername, null); assert.equal(c.telegramId, '72002');
  assert.equal((await db.client.findUniqueOrThrow({ where: { id: 'link' } })).telegramUnreachable, false);
  assert.equal(await db.pendingTelegramLink.count({ where: { clientId: 'link' } }), 0);
  assert.equal(await db.subscription.count(), 0);
});

test('unchanged ID and unrelated edits preserve username and existing link codes', async () => {
  await create('same', { telegramId: '72003', telegramUsername: 'same_user', telegramUnreachable: true }); await pending('same');
  await update('same', { balance: 20 });
  const c = await update('same', { telegramId: '72003', expectedTelegramId: '72003' });
  assert.equal(c.telegramUsername, 'same_user'); assert.equal(c.balance, 20);
  assert.equal((await db.client.findUniqueOrThrow({ where: { id: 'same' } })).telegramUnreachable, true);
  assert.equal(await db.pendingTelegramLink.count({ where: { clientId: 'same' } }), 1);
});

test('duplicate ID rolls back every profile field and link-code deletion', async () => {
  await create('duplicate', { balance: 9 }); await pending('duplicate');
  await assert.rejects(update('duplicate', { telegramId: '72003', email: 'changed@example.invalid', balance: 999 }), e => failure(409)(e) && e.message.includes('Telegram'));
  const c = await db.client.findUniqueOrThrow({ where: { id: 'duplicate' } });
  assert.equal(c.email, 'duplicate@example.invalid'); assert.equal(c.telegramId, null); assert.equal(c.balance, 9);
  assert.equal(await db.pendingTelegramLink.count({ where: { clientId: 'duplicate' } }), 1);
});

test('two clients racing for the same Telegram cannot both bind it', async () => {
  await create('race-a'); await create('race-b');
  const results = await Promise.allSettled(['race-a','race-b'].map(id => update(id, { telegramId: '72004', expectedTelegramId: null })));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected' && failure(409)(r.reason)).length, 1);
  assert.equal(await db.client.count({ where: { telegramId: '72004' } }), 1);
});

test('concurrent stale forms cannot overwrite the same client binding', async () => {
  await create('stale');
  const results = await Promise.allSettled(['72005','72006'].map(telegramId => update('stale', { telegramId, expectedTelegramId: null })));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected' && failure(409)(r.reason)).length, 1);
});

test('unlink requires another login method and clears Telegram metadata', async () => {
  await create('tg-only', { email: null, passwordHash: null, telegramId: '72007', telegramUsername: 'only' });
  await assert.rejects(update('tg-only', { telegramId: null }), failure(400));
  assert.equal((await db.client.findUniqueOrThrow({ where: { id: 'tg-only' } })).telegramId, '72007');
  const c = await update('link', { telegramId: null, expectedTelegramId: '72002' });
  assert.equal(c.telegramId, null); assert.equal(c.telegramUsername, null);
});

test('email conflicts roll back Telegram; nonexistent clients return 404', async () => {
  await assert.rejects(update('duplicate', { email: 'same@example.invalid', telegramId: '72008' }), e => failure(409)(e) && e.message.includes('email'));
  assert.equal((await db.client.findUniqueOrThrow({ where: { id: 'duplicate' } })).telegramId, null);
  await assert.rejects(update('missing', { telegramId: '72008' }), failure(404));
});
