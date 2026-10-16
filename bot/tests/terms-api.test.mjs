import assert from 'node:assert/strict';
import { test } from 'node:test';
process.env.API_URL = 'https://api.example.invalid';
process.env.BOT_TOKEN = 'bot-test';
const { getBotTerms, acceptBotTerms } = await import('../dist/api.js');
const status = { required: true, accepted: false, documents: [], version: 'a'.repeat(32), completed: false, pendingStart: null };

test('consent API carries bot authentication, Telegram ID and pending link', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.example.invalid/api/bot/terms/status');
    assert.equal(options.headers['X-Telegram-Bot-Token'], 'bot-test');
    assert.deepEqual(JSON.parse(options.body), { telegramId: '123', pendingStart: 'ref_ABC' });
    return Response.json(status);
  });
  assert.deepEqual(await getBotTerms(123, 'ref_ABC'), status);
});
test('outdated consent reloads current documents instead of admitting the user', async (t) => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return requests.length === 1 ? Response.json({}, { status: 409 }) : Response.json(status);
  });
  assert.deepEqual(await acceptBotTerms(123, 'b'.repeat(32)), status);
  assert.deepEqual(requests.map(r => r.url.split('/').at(-1)), ['accept', 'status']);
  assert.deepEqual(requests[0].body, { telegramId: '123', version: 'b'.repeat(32) });
});
test('failed reads and writes remain errors', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({}, { status: 503 }));
  await assert.rejects(getBotTerms(123));
  await assert.rejects(acceptBotTerms(123, status.version));
});
