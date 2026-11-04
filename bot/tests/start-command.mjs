import assert from 'node:assert/strict';
import { Composer } from 'grammy';

process.env.API_URL = 'https://api.example.invalid';
process.env.BOT_TOKEN = 'bot-test';

const start = await import('../dist/handlers/start.js');
const admin = await import('../dist/handlers/admin.js');
const tariffs = await import('../dist/handlers/tariffs.js');
const subscriptions = await import('../dist/handlers/subscriptions.js');
const gifts = await import('../dist/handlers/gifts.js');
const payments = await import('../dist/handlers/payments.js');
const profile = await import('../dist/handlers/profile.js');
const support = await import('../dist/handlers/support.js');

const config = {
  serviceName: 'Cabinet',
  defaultCurrency: 'RUB',
  defaultLanguage: 'ru',
  publicAppUrl: 'https://example.com',
  forceSubscribeEnabled: false,
  ticketsEnabled: false,
};

const calls = [];
globalThis.fetch = async (url) => {
  const value = String(url);
  calls.push(value);
  if (value.includes('/api/public/config')) return Response.json(config);
  if (value.includes('/api/client/auth/register')) {
    return Response.json({ token: 'fixture-token', client: { id: 'client', preferredLang: 'ru', preferredCurrency: 'RUB', balance: 0, trialUsed: false } });
  }
  if (value.includes('/api/client/bot-bootstrap')) {
    return Response.json({
      cloudTrialAvailable: false,
      client: { id: 'client', preferredLang: 'ru', preferredCurrency: 'RUB', balance: 0, trialUsed: false },
      subscription: { subscription: null },
      allSubscriptions: { items: [] },
      availableTrials: { items: [], hasAnyEnabled: false },
    });
  }
  if (value.includes('/api/public/proxy-tariffs') || value.includes('/api/public/singbox-tariffs')) {
    return Response.json({ items: [] });
  }
  return Response.json({});
};

const composer = new Composer();
for (const factory of [
  start.createStartHandlers,
  admin.createAdminHandlers,
  tariffs.createTariffHandlers,
  subscriptions.createSubscriptionHandlers,
  gifts.createGiftHandlers,
  payments.createPaymentEmailHandlers,
  payments.createPaymentCustomTopupHandlers,
  profile.createProfileHandlers,
  payments.createPaymentHandlers,
  support.createSupportHandlers,
  payments.createPaymentNumericHandlers,
]) {
  composer.use(factory());
}

const message = {
  message_id: 1,
  date: 1,
  chat: { id: 555, type: 'private' },
  from: { id: 555, is_bot: false, first_name: 'User', username: 'user' },
  text: '/start',
  entities: [{ type: 'bot_command', offset: 0, length: 6 }],
};
const ctx = {
  update: { update_id: 1, message },
  message,
  from: message.from,
  chat: message.chat,
  reply: async () => {},
  answerCallbackQuery: async () => {},
  api: {},
};

await composer.middleware()(ctx, async () => {}).catch(() => {});
assert(calls.some((url) => url.includes('/api/client/auth/register')), 'текстовые middleware не должны перехватывать /start');
console.log('PASS /start reaches the command handler through the text middleware chain');
