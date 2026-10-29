import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mock, test } from 'node:test';
import express from 'express';

if (process.env.CABINET_AUTH_TEST !== '1' || new URL(process.env.DATABASE_URL).pathname !== '/cabinetqa') throw Error('Isolated cabinetqa database required');
process.env.BOT_TOKEN = '123456:isolated-auth-fixture-not-a-real-bot';
const notifications = await import('../dist/modules/notification/telegram-notify.service.js');
mock.module('../dist/modules/notification/telegram-notify.service.js', {
  namedExports: Object.fromEntries(Object.keys(notifications).map(key => [key, async () => {}])),
});
const { prisma } = await import('../dist/db.js');
const { clientAuthRouter, clientRouter } = await import('../dist/modules/client/client.routes.js');
const { signClientToken } = await import('../dist/modules/client/client.service.js');
const app = express();
app.use(express.json());
app.use('/auth', clientAuthRouter);
app.use('/client', clientRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const clients = [];
const tokens = [];
const newTelegramId = String(800000000000 + Math.floor(Math.random() * 1000000000));
async function request(path, body, headers = {}, method = body === undefined ? 'GET' : 'POST') {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, data: await res.json() };
}
async function issue() {
  const r = await request('/auth/telegram-login-token', {});
  assert.equal(r.status, 200);
  assert.match(r.data.token, /^[a-f0-9]{32}$/);
  assert.ok(Date.parse(r.data.expiresAt) > Date.now());
  tokens.push(r.data.token);
  return r.data.token;
}
const check = token => request(`/auth/telegram-login-check?token=${token}`);
const confirm = (token, telegramId, credential = process.env.BOT_TOKEN) => request('/auth/telegram-login-confirm', { token, telegramId, telegramUsername: 'cabinet_test' }, { 'x-telegram-bot-token': credential });
async function client(extra = {}) {
  const c = await prisma.client.create({ data: { email: `auth-${randomUUID()}@example.invalid`, telegramId: String(810000000000 + Math.floor(Math.random() * 1000000000)), ...extra } });
  clients.push(c.id);
  return c;
}

try {
  await test('pending login exposes no client or session; bot authentication and valid IDs are required', async () => {
    const token = await issue();
    assert.deepEqual((await check(token)).data, { confirmed: false });
    assert.equal((await confirm(token, newTelegramId, 'wrong')).status, 403);
    assert.equal((await confirm(token, 'not-an-id')).status, 400);
    assert.deepEqual((await check(token)).data, { confirmed: false });
  });
  await test('existing account logs in with its balance and subscriptions intact', async () => {
    const c = await client({ balance: 123.45, onboardingCompleted: true });
    const subscription = await prisma.subscription.create({ data: { ownerId: c.id, subscriptionIndex: 0, customName: 'My laptop' } });
    const token = await issue();
    assert.equal((await confirm(token, c.telegramId)).status, 200);
    assert.equal((await confirm(token, newTelegramId)).status, 409);
    const result = await check(token);
    assert.equal(result.status, 200);
    assert.equal(result.data.client.id, c.id);
    assert.equal(result.data.client.balance, 123.45);
    assert.ok(result.data.token);
    assert.equal(result.data.requires2FA, undefined);
    assert.equal((await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } })).customName, 'My laptop');
    assert.equal((await check(token)).status, 404);
  });
  await test('new Telegram account is created once and sent to onboarding without issuing a VPN subscription', async () => {
    const token = await issue();
    await confirm(token, newTelegramId);
    const result = await check(token);
    assert.equal(result.status, 200, JSON.stringify(result.data));
    clients.push(result.data.client.id);
    assert.equal(result.data.justCreated, true);
    assert.equal(result.data.client.onboardingCompleted, false);
    assert.equal(await prisma.subscription.count({ where: { ownerId: result.data.client.id } }), 0);
    const next = await issue();
    await confirm(next, newTelegramId);
    assert.equal((await check(next)).data.client.id, result.data.client.id);
    assert.equal(await prisma.client.count({ where: { telegramId: newTelegramId } }), 1);
  });
  await test('blocked users cannot log in; two-factor accounts receive only a pending token', async () => {
    for (const extra of [{ isBlocked: true }, { totpEnabled: true }]) {
      const c = await client(extra);
      const token = await issue();
      await confirm(token, c.telegramId);
      const result = await check(token);
      assert.equal(result.data.token, undefined);
      if (extra.isBlocked) assert.equal(result.status, 403);
      else { assert.equal(result.data.requires2FA, true); assert.ok(result.data.tempToken); }
    }
  });
  await test('expired tokens cannot be confirmed or exchanged', async () => {
    for (const operation of [check, token => confirm(token, newTelegramId)]) {
      const token = await issue();
      await prisma.telegramAuthToken.update({ where: { token }, data: { expiresAt: new Date(Date.now() - 1000) } });
      assert.equal((await operation(token)).status, 410);
    }
  });
  await test('concurrent confirmations have one winner and concurrent exchanges issue one session', async () => {
    const c = await client();
    const token = await issue();
    const results = await Promise.all([confirm(token, c.telegramId), confirm(token, c.telegramId)]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    const checks = await Promise.all([check(token), check(token)]);
    assert.equal(checks.filter(r => r.status === 200).length, 1);
    assert.equal(checks.filter(r => r.status === 404 || r.status === 410).length, 1);
  });
  await test('public registration cannot impersonate a Telegram account', async () => {
    const c = await client();
    const result = await request('/auth/register', { telegramId: c.telegramId });
    assert.equal(result.status, 401);
    assert.equal(result.data.token, undefined);
  });
  await test('subscription renaming requires ownership and validates names', async () => {
    const owner = await client();
    const other = await client();
    const sub = await prisma.subscription.create({ data: { ownerId: owner.id, subscriptionIndex: 0 } });
    const route = `/client/subscription/${sub.id}/name`;
    assert.equal((await request(route, { name: 'Laptop' }, {}, 'PATCH')).status, 401);
    assert.equal((await request(route, { name: 'Laptop' }, { Authorization: `Bearer ${signClientToken(other.id)}` }, 'PATCH')).status, 404);
    const headers = { Authorization: `Bearer ${signClientToken(owner.id)}` };
    for (const name of ['', ' ', 'a'.repeat(61), 'bad\nname']) assert.equal((await request(route, { name }, headers, 'PATCH')).status, 400);
    assert.equal((await request(route, { name: '  Laptop  ' }, headers, 'PATCH')).status, 200);
    assert.equal((await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } })).customName, 'Laptop');
  });
} finally {
  await prisma.telegramAuthToken.deleteMany({ where: { token: { in: tokens } } });
  await prisma.subscription.deleteMany({ where: { ownerId: { in: clients } } });
  await prisma.client.deleteMany({ where: { OR: [{ id: { in: clients } }, { telegramId: newTelegramId }] } });
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await prisma.$disconnect();
}
