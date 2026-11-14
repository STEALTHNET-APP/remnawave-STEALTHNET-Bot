import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

let active = { apiUrl: 'https://first.invalid', adminToken: 'first-token', secretKey: 'gate=one:two', source: 'database' };
let failConfig = false;
let botToken = 'new-token';
let remna;
mock.module('../dist/config/index.js', { namedExports: { env: { REMNA_API_URL: 'https://env.invalid', REMNA_ADMIN_TOKEN: 'old-token' } } });
mock.module('../dist/modules/client/client.service.js', { namedExports: {
  getSystemConfig: async () => {
    if (failConfig) throw new Error('database unavailable');
    remna.setRemnaRuntimeConfig(active);
    return { telegramBotToken: botToken };
  },
} });
remna = await import('../dist/modules/remna/remna.client.js');
const bots = await import('../dist/modules/bot/bot.service.js');

test('each Remna request refreshes settings, clears cookie explicitly, and fails closed on config errors', async () => {
  const requests = [];
  const fetch = mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, headers: options.headers });
    return new Response(JSON.stringify({ response: { users: [] } }), { status: 200 });
  });
  try {
    assert.equal((await remna.remnaGetUsers()).status, 200);
    assert.equal(requests[0].url, 'https://first.invalid/api/users');
    assert.equal(requests[0].headers.Authorization, 'Bearer first-token');
    assert.equal(requests[0].headers.Cookie, 'gate=one:two');
    active = { ...active, apiUrl: 'https://second.invalid///', adminToken: 'second-token', secretKey: '' };
    await remna.remnaGetUsers();
    assert.equal(requests[1].url, 'https://second.invalid/api/users');
    assert.equal(requests[1].headers.Authorization, 'Bearer second-token');
    assert.equal(requests[1].headers.Cookie, undefined);
    failConfig = true;
    assert.equal((await remna.remnaGetUsers()).status, 503);
    assert.equal(requests.length, 2);
  } finally { failConfig = false; fetch.mock.restore(); }
});

test('previous environment bot token is not accepted after replacement or database failure', async () => {
  const old = process.env.BOT_TOKEN;
  process.env.BOT_TOKEN = 'old-token';
  try {
    assert.equal(await bots.getBotByToken('old-token'), null);
    assert.equal((await bots.getBotByToken('new-token')).token, 'new-token');
    failConfig = true;
    assert.equal(await bots.getBotByToken('old-token'), null);
    assert.equal(await bots.getBotByToken('new-token'), null);
  } finally {
    failConfig = false;
    if (old === undefined) delete process.env.BOT_TOKEN; else process.env.BOT_TOKEN = old;
  }
});

test('cookie separators preserve colons inside values', () => {
  assert.equal(remna.remnaSecretCookieHeader('cookie=part:rest'), 'cookie=part:rest');
  assert.equal(remna.remnaSecretCookieHeader('cookie:part=rest'), 'cookie=part=rest');
  assert.equal(remna.remnaSecretCookieHeader(''), null);
});

test('connection checks report rejection without treating it as a working API', async () => {
  const fetch = mock.method(globalThis, 'fetch', async (_, options) => {
    assert.equal(options.redirect, 'error');
    return new Response('', { status: 401 });
  });
  try {
    const result = await remna.testRemnaApiConnection({ apiUrl: 'https://test.invalid', adminToken: 'wrong', secretKey: '' });
    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
  } finally { fetch.mock.restore(); }
});
