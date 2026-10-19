import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
const source = fs.readFileSync(new URL('../dist/modules/client/client.routes.js', import.meta.url), 'utf8');
const routes = new Map();
const noop = () => {};
const router = new Proxy({}, { get: (_, method) => (route, ...handlers) => { if (method === 'post') for (const key of Array.isArray(route) ? route : [route]) routes.set(key, handlers.at(-1)); } });
let config = { telegramStarsEnabled: true, telegramStarsRubPerStar: 2, serviceName: 'Test' };
let client = { telegramId: '123456789', preferredCurrency: 'RUB' }, invoice, created, failed = false;
const tariff = { id: 'tariff', price: 300, currency: 'RUB', durationDays: 30, priceOptions: [{ id: 'period', price: 501, durationDays: 60 }] };
const overrides = {
  Router: () => router, z, randomUUID,
  env: {}, uploadTicketAttachment: { array: () => noop },
  getSystemConfig: async () => config,
  prisma: { client: { findUnique: async () => client }, tariff: { findUnique: async () => tariff }, proxyTariff: { findUnique: async () => ({ price: 301, currency: 'RUB', enabled: true }) }, singboxTariff: { findUnique: async () => ({ price: 303, currency: 'RUB', enabled: true }) }, payment: { updateMany: async () => { failed = true; } } },
  applyPersonalDiscount: async amount => ({ amount, personalDiscountPercent: 0 }),
  paymentSnapshotProduct: async (_, amount) => ({ amount }), paymentSnapshotTopup: async (_, amount) => ({ amount }),
  asPaymentUncheckedCreate: data => data,
  createPayment: async ({ data }) => { created = { ...data, id: 'invoice-id' }; return created; },
  starsAmount: (amount, rate) => Math.ceil(amount / rate),
  starsApi: async (method, body) => { assert.equal(method, 'createInvoiceLink'); invoice = body; return 'https://t.me/$qa'; },
};
const context = vm.createContext({ console, Date, Math, Number, JSON, Map, Set, URL, process: { env: { BOT_TOKEN: '123:test' } } });
const definitions = new Map();
for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g)) {
  const names = definitions.get(match[2]) || new Set();
  for (const part of match[1].split(',')) if (part.trim()) names.add(part.trim().split(/\s+as\s+/)[0]);
  definitions.set(match[2], names);
}
const loaded = new Map();
const module = new vm.SourceTextModule(source, { context });
await module.link(async spec => {
  if (loaded.has(spec)) return loaded.get(spec);
  const names = [...definitions.get(spec)];
  const child = new vm.SyntheticModule(names, function () { for (const name of names) this.setExport(name, overrides[name] ?? noop); }, { context });
  loaded.set(spec, child); await child.link(() => {}); await child.evaluate(); return child;
});
await module.evaluate();
const handler = routes.get('/telegram-stars/create-payment'); assert(handler);
async function request(body) {
  const response = { code: 200, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
  await handler({ path: '/telegram-stars/create-payment', clientId: 'client', body }, response); return response;
}
let r = await request({ tariffId: 'tariff', tariffPriceOptionId: 'period', amount: 1, currency: 'USD', asGift: true, asAdditional: true });
assert.equal(r.code, 201); assert.equal(invoice.prices[0].amount, 251); assert.equal(invoice.currency, 'XTR'); assert.equal(invoice.provider_token, '');
assert.equal(created.amount, 501); assert.equal(created.currency, 'RUB'); assert.equal(created.status, 'PENDING');
assert.equal(JSON.parse(created.metadata).purchasedAsGift, true); assert.equal(JSON.parse(created.metadata).isAdditionalSubscription, true);
for (const key of ['proxyTariffId','singboxTariffId']) { r = await request({ [key]: 'id', amount: 1, currency: 'USD' }); assert.equal(r.code, 201); assert(invoice.prices[0].amount > 150); }
assert.equal((await request({ tariffId: 'tariff', tariffPriceOptionId: 'not-this-tariff' })).code, 400);
assert.equal((await request({ tariffId: 'tariff', proxyTariffId: 'id' })).code, 400);
assert.equal((await request({ amount: 100, currency: 'USD' })).code, 400);
client = { ...client, telegramId: null }; assert.equal((await request({ amount: 100, currency: 'RUB' })).code, 400);
client = { ...client, telegramId: '123456789' }; config.telegramStarsEnabled = false;
assert.equal((await request({ amount: 100, currency: 'RUB' })).code, 503);
config.telegramStarsEnabled = true; config.telegramStarsRubPerStar = 0;
assert.equal((await request({ amount: 100, currency: 'RUB' })).code, 503);
console.log('PASS Stars invoices: server tariff/period/proxy/singbox prices override client values; gift intent preserved; mixed products, invalid period, currency, unlinked account and disabled provider rejected');
