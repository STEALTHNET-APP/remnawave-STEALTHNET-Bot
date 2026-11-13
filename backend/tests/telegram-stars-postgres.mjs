import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { prisma } from '../dist/db.js';
const dist = process.env.QA_DIST || path.resolve(import.meta.dirname, '../dist');
const botId = 'qa-stars-' + Date.now();
const context = vm.createContext({ console, Date, JSON, Promise, Error, Number, Math, process: { env: { BOT_TOKEN: botId + ':test' } } });
const modules = new Map();
let enabled = true, deliveries = 0, refunds = 0, failDelivery = false, history = [], failRefund = false;
async function synthetic(key, exports) {
  if (modules.has(key)) return modules.get(key);
  const m = new vm.SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value); }, { context });
  modules.set(key, m); await m.link(() => {}); await m.evaluate(); return m;
}
async function deliver(id) {
  deliveries++;
  await new Promise(resolve => setTimeout(resolve, 20));
  if (failDelivery) throw Error('simulated network failure');
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id } });
  await prisma.payment.update({ where: { id }, data: { metadata: JSON.stringify({ ...JSON.parse(payment.metadata), activationMarker: 'preserved' }) } });
  return { ok: true };
}
const telegram = async (method, body) => {
  if (method === 'getStarTransactions') return { transactions: history.slice(body.offset, body.offset + body.limit) };
  assert.equal(method, 'refundStarPayment');
  if (failRefund) throw Error('simulated Telegram outage');
  refunds++; return true;
};
async function load(file) {
  if (modules.has(file)) return modules.get(file);
  const m = new vm.SourceTextModule(fs.readFileSync(file, 'utf8'), { context, identifier: file });
  modules.set(file, m);
  await m.link(async spec => {
    if (spec.endsWith('/personal-discount.js')) return synthetic('discount', { extinguishOneTimeDiscount: async () => {} });
    if (spec.endsWith('/telegram-notify.service.js')) return synthetic('notifications', Object.fromEntries(['notifyBalanceToppedUp','notifyTariffActivated','notifyTariffActivationFailed','notifyExtraOptionApplied','notifyProxySlotsCreated','notifySingboxSlotsCreated'].map(key => [key, async () => {}])));
    if (spec.endsWith('/db.js')) return synthetic('db', { prisma });
    if (spec.endsWith('/client.service.js')) return synthetic('config', { getSystemConfig: async () => ({ telegramStarsEnabled: enabled }) });
    if (spec.endsWith('/tariff-activation.service.js')) return synthetic('tariff', { activateTariffByPaymentId: deliver });
    if (spec.endsWith('/proxy-slots-activation.service.js')) return synthetic('proxy', { createProxySlotsByPaymentId: deliver });
    if (spec.endsWith('/singbox-slots-activation.service.js')) return synthetic('singbox', { createSingboxSlotsByPaymentId: deliver });
    if (spec.endsWith('/extra-options.service.js')) return synthetic('extra', { applyExtraOptionByPaymentId: deliver });
    if (spec.endsWith('/referral.service.js')) return synthetic('referral', { distributeReferralRewards: async () => {} });
    if (spec.endsWith('/promo-code-usage.util.js')) return synthetic('promo', { recordPromoCodeUsageFromPayment: async () => {} });
    if (spec === './stars-api.js') return synthetic('telegram', { starsApi: telegram });
    if (spec.endsWith('/proxy-fetch.js')) return synthetic('fetch', { proxyFetch: () => { throw Error('Unexpected network call'); } });
    if (spec.endsWith('/get-proxy-url.js')) return synthetic('proxyUrl', { getProxyUrl: async () => null });
    throw Error('Unexpected dependency ' + spec);
  });
  await m.evaluate(); return m;
}
const service = (await load(path.join(dist, 'modules/telegram-stars/stars.service.js'))).namespace;
const pricing = (await load(path.join(dist, 'modules/telegram-stars/stars-api.js'))).namespace;
const clients = [];
try {
  assert.equal(pricing.starsAmount(300, 1), 300);
  assert.equal(pricing.starsAmount(301, 2), 151);
  assert.equal(pricing.starsAmount(0.28, 0.01), 28);
  for (const [amount, rate] of [[0,1],[1,0],[1,-1],[NaN,1],[1,Infinity]]) assert.throws(() => pricing.starsAmount(amount, rate));
  const c = await prisma.client.create({ data: { email: randomUUID() + '@example.invalid', telegramId: '90' + Date.now(), balance: 0 } }); clients.push(c.id);
  const fresh = async (extra = {}) => prisma.payment.create({ data: { clientId: c.id, orderId: randomUUID(), provider: 'telegram_stars', amount: 100, currency: 'RUB', status: 'PENDING', metadata: JSON.stringify({ ...extra, stars: { total: 50, telegramId: c.telegramId, botId, expiresAt: Date.now() + 3600000 } }) } });
  const receipt = p => ({ paymentId: p.id, telegramId: c.telegramId, currency: 'XTR', totalAmount: 50, chargeId: randomUUID(), checkoutId: randomUUID() });
  const p = await fresh(), r = receipt(p);
  await service.checkStarsCheckout(r);
  await service.checkStarsCheckout(r);
  await assert.rejects(() => service.checkStarsCheckout({ ...r, checkoutId: randomUUID() }));
  for (const invalid of [{ telegramId: '2' }, { currency: 'RUB' }, { totalAmount: 49 }]) {
    await assert.rejects(() => service.checkStarsCheckout({ ...r, ...invalid }));
    await assert.rejects(() => service.receiveStarsPayment({ ...r, ...invalid }));
  }
  enabled = false; await assert.rejects(() => service.checkStarsCheckout(r)); enabled = true;
  await prisma.client.update({ where: { id: c.id }, data: { isBlocked: true } });
  await assert.rejects(() => service.checkStarsCheckout(r));
  await prisma.client.update({ where: { id: c.id }, data: { isBlocked: false } });
  const exp = await fresh();
  const expiredMeta = JSON.parse(exp.metadata); expiredMeta.stars.expiresAt = 1;
  await prisma.payment.update({ where: { id: exp.id }, data: { metadata: JSON.stringify(expiredMeta) } });
  await assert.rejects(() => service.checkStarsCheckout(receipt(exp)));
  await Promise.all(Array.from({ length: 8 }, () => service.receiveStarsPayment(r)));
  assert.equal((await prisma.client.findUnique({ where: { id: c.id } })).balance, 100);
  await assert.rejects(() => service.checkStarsCheckout(r));
  await assert.rejects(() => service.receiveStarsPayment({ ...r, chargeId: randomUUID() }));
  const other = await fresh();
  await assert.rejects(() => service.receiveStarsPayment({ ...r, paymentId: other.id }));
  const product = await fresh({ customBuild: { durationDays: 30 } }), productReceipt = receipt(product);
  await Promise.all(Array.from({ length: 8 }, () => service.receiveStarsPayment(productReceipt)));
  assert.equal(deliveries, 1);
  const deliveredMeta = JSON.parse((await prisma.payment.findUnique({ where: { id: product.id } })).metadata);
  assert.equal(deliveredMeta.activationMarker, 'preserved'); assert.equal(deliveredMeta.stars.delivery, 'delivered');
  failDelivery = true;
  const failed = await fresh({ customBuild: { durationDays: 30 } }), failedReceipt = receipt(failed);
  await service.receiveStarsPayment(failedReceipt); await service.receiveStarsPayment(failedReceipt);
  assert.equal(deliveries, 2);
  const failedRow = await prisma.payment.findUnique({ where: { id: failed.id } });
  assert.equal(failedRow.status, 'PAID'); assert.equal(JSON.parse(failedRow.metadata).stars.delivery, 'failed');
  failDelivery = false; failRefund = true;
  await assert.rejects(() => service.refundStarsPayment(p.id));
  assert.equal((await prisma.client.findUnique({ where: { id: c.id } })).balance, 100);
  failRefund = false;
  await Promise.all(Array.from({ length: 4 }, () => service.refundStarsPayment(p.id)));
  assert.equal(refunds, 1); assert.equal((await prisma.client.findUnique({ where: { id: c.id } })).balance, 0);
  await service.receiveStarsPayment(r);
  assert.equal((await prisma.client.findUnique({ where: { id: c.id } })).balance, 0);
  const recovered = await fresh(), recoveredReceipt = receipt(recovered);
  history = [{ id: 'unknown', amount: 50, source: { type: 'user', transaction_type: 'invoice_payment', user: { id: Number(c.telegramId) }, invoice_payload: 'snstars:missing' } }, { id: recoveredReceipt.chargeId, amount: 50, source: { type: 'user', transaction_type: 'invoice_payment', user: { id: Number(c.telegramId) }, invoice_payload: 'snstars:' + recovered.id } }];
  await service.reconcileStarsPayments(); await service.reconcileStarsPayments();
  assert.equal((await prisma.client.findUnique({ where: { id: c.id } })).balance, 100);
  history.push({ id: recoveredReceipt.chargeId, amount: -50, receiver: { type: 'user', user: { id: Number(c.telegramId) } } });
  await service.reconcileStarsPayments(); await service.reconcileStarsPayments();
  assert.equal((await prisma.client.findUnique({ where: { id: c.id } })).balance, 0); assert.equal(refunds, 1);
  assert.equal((await prisma.payment.findUnique({ where: { id: recovered.id } })).status, 'REFUNDED');
  console.log('PASS Stars PostgreSQL: pricing, checkout validation, concurrent receipts, charge reuse, single delivery, preserved metadata, durable failures, idempotent refunds and outage reconciliation');
} finally {
  for (const id of clients) { await prisma.payment.deleteMany({ where: { clientId: id } }); await prisma.client.delete({ where: { id } }); }
  await prisma.systemSetting.deleteMany({ where: { key: 'telegram_stars_offset_' + botId } });
  await prisma.$disconnect();
}
