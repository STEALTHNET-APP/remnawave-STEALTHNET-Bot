import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Bot } from 'grammy';
import { createTermsGate } from '../dist/terms.js';

const version = 'a'.repeat(32);
const blocked = { required: true, accepted: false, documents: [
  { kind: 'agreement', url: 'https://example.com/terms' },
  { kind: 'offer', url: 'https://example.com/offer' },
  { kind: 'refund', url: 'https://example.com/refund' },
], version, completed: false, pendingStart: null };
const user = { id: 123, is_bot: false, first_name: 'Test', language_code: 'ru' };
let id = 0;
function update(text, callback, extra = {}) {
  const message = { message_id: ++id, date: 1, chat: { id: 123, type: 'private' }, from: user, ...extra };
  return { update_id: id, ...(callback ? { callback_query: { id: String(id), from: user, chat_instance: 'test', data: callback, message } } : { message: { ...message, ...(text ? { text, entities: text.startsWith('/') ? [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }] : [] } : {}) } }) };
}
function setup(api) {
  const calls = [], passed = [], resumed = [];
  const bot = new Bot('123:test', { botInfo: { id: 456, is_bot: true, first_name: 'Test', username: 'test_bot', can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false } });
  bot.api.config.use(async (_previous, method, payload) => { calls.push({ method, payload }); return { ok: true, result: method === 'sendMessage' ? { message_id: 1, chat: { id: 123, type: 'private' }, date: 1, text: payload.text } : true }; });
  bot.use(createTermsGate(api, async (_ctx, payload) => { resumed.push(payload); }));
  bot.on(['message', 'callback_query'], (ctx) => { passed.push(ctx.update); });
  return { bot, calls, passed, resumed };
}

test('blocks commands, old callback buttons, text and photos before consent', async () => {
  const h = setup({ getBotTerms: async () => blocked });
  for (const u of [update('/start ref_ABC'), update('/subscriptions'), update('PROMO'), update(null, 'pay_tariff:abc'), update(null, null, { photo: [{ file_id: 'photo', file_unique_id: 'photo', width: 1, height: 1 }] })]) await h.bot.handleUpdate(u);
  assert.equal(h.passed.length, 0);
  assert.equal(h.resumed.length, 0);
  const messages = h.calls.filter(c => c.method === 'sendMessage');
  assert.equal(messages.length, 5);
  assert.deepEqual(messages[0].payload.reply_markup.inline_keyboard.map(row => row[0].text), ['Пользовательское соглашение', 'Публичная оферта', 'Политика возврата', 'Принимаю']);
  assert.ok(Buffer.byteLength(messages[0].payload.reply_markup.inline_keyboard.at(-1)[0].callback_data) <= 64);
});
test('preserves referral, promo, gift, renew, login and account-link payloads', async () => {
  const pending = [];
  const h = setup({ getBotTerms: async (_id, p) => { pending.push(p); return blocked; } });
  for (const text of ['/start ref_ABC', '/start promo_ABC', '/start gift_ABC', '/start renew_ABC', '/start auth_ABC', '/start link_ABC', '/link ABC', '/start@test_bot c_vk_test']) await h.bot.handleUpdate(update(text));
  assert.deepEqual(pending, ['ref_ABC', 'promo_ABC', 'gift_ABC', 'renew_ABC', 'auth_ABC', 'link_ABC', 'link_ABC', 'c_vk_test']);
});
test('resumes original deep link once and does not replay on a repeated acceptance', async () => {
  let completed = true;
  const h = setup({ acceptBotTerms: async (telegramId, v) => { assert.equal(telegramId, 123); assert.equal(v, version); const result = { ...blocked, accepted: true, completed, pendingStart: completed ? 'gift_ABC' : null }; completed = false; return result; } });
  await h.bot.handleUpdate(update(null, `terms:accept:${version}`));
  await h.bot.handleUpdate(update(null, `terms:accept:${version}`));
  assert.deepEqual(h.resumed, ['gift_ABC']);
  assert.equal(h.passed.length, 0);
});
test('accepted users and installations without documents continue normally', async () => {
  for (const required of [true, false]) {
    const h = setup({ getBotTerms: async () => ({ ...blocked, required, accepted: true }) });
    await h.bot.handleUpdate(update('/start'));
    assert.equal(h.passed.length, 1);
    assert.equal(h.calls.length, 0);
  }
});
test('stale consent prompts again; API errors never admit users or resume actions', async () => {
  const h = setup({ acceptBotTerms: async () => blocked, getBotTerms: async () => { throw Error('offline'); } });
  await h.bot.handleUpdate(update(null, `terms:accept:${version}`));
  await h.bot.handleUpdate(update('/start'));
  assert.equal(h.passed.length, 0);
  assert.equal(h.resumed.length, 0);
  assert.equal(h.calls.filter(c => c.method === 'sendMessage').length, 2);
});
test('group messages cannot register users or accept terms', async () => {
  const h = setup({ getBotTerms: async () => { throw Error('should not run'); } });
  await h.bot.handleUpdate(update('/start', null, { chat: { id: -123, type: 'group' } }));
  assert.equal(h.passed.length, 0);
  assert.equal(h.calls.length, 0);
});
