import test, { mock, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
if (!process.env.DATABASE_URL?.includes('/updaterqa_review')) throw Error('Requires isolated updaterqa_review database');
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'isolated-payment-delivery-test-123456789';
let activations = 0, outcome = { ok: true };
const noop = async () => {};
const mocked = {
  'tariff/tariff-activation.service.js': { activateTariffByPaymentId: async () => { activations++; if (outcome instanceof Error) throw outcome; return outcome; } },
  'proxy/proxy-slots-activation.service.js': { createProxySlotsByPaymentId: async () => ({ ok: true, slotIds: [] }) },
  'singbox/singbox-slots-activation.service.js': { createSingboxSlotsByPaymentId: async () => ({ ok: true, slotIds: [] }) },
  'extra-options/extra-options.service.js': { applyExtraOptionByPaymentId: noop },
  'referral/referral.service.js': { distributeReferralRewards: noop },
  'payment/promo-code-usage.util.js': { recordPromoCodeUsageFromPayment: noop },
  'client/personal-discount.js': { extinguishOneTimeDiscount: noop },
  'payment/payment-fulfillment.util.js': { handlePaymentActivationResult: noop },
  'notification/telegram-notify.service.js': { notifyBalanceToppedUp: noop, notifyExtraOptionApplied: noop, notifyProxySlotsCreated: noop, notifySingboxSlotsCreated: noop },
};
for (const [path, namedExports] of Object.entries(mocked)) mock.module(new URL('../dist/modules/' + path, import.meta.url), { namedExports });
const { prisma } = await import('../dist/db.js');
const { acceptPaidPayment, processPaymentDelivery, processPaymentDeliveries } = await import('../dist/modules/payment/payment-delivery.service.js');
const clients = [];
async function fixture(product = true, status = 'PENDING') {
 const client = await prisma.client.create({ data: {} }); clients.push(client.id);
 return prisma.payment.create({ data: { clientId: client.id, orderId: randomUUID(), amount: 260, currency: 'RUB', provider: 'rollypay', status, metadata: product ? JSON.stringify({ customBuild: { days: 30 }, keep: 'unchanged' }) : null } });
}
after(async () => { await prisma.client.deleteMany({ where: { id: { in: clients } } }); await prisma.$disconnect(); });
test('concurrent paid notifications create one durable delivery and one fulfillment', async () => {
 const p = await fixture(); activations = 0;
 const receipts = await Promise.all(Array.from({ length: 8 }, () => acceptPaidPayment(p.id, 'rollypay', 'remote-id')));
 assert.equal(receipts.filter(r => r.accepted).length, 1);
 assert.equal(await prisma.paymentDelivery.count({ where: { paymentId: p.id } }), 1);
 assert.equal((await prisma.payment.findUnique({ where: { id: p.id } })).status, 'PAID');
 await Promise.all(Array.from({ length: 8 }, () => processPaymentDelivery(p.id)));
 assert.equal(activations, 1);
 assert.equal((await prisma.paymentDelivery.findUnique({ where: { paymentId: p.id } })).state, 'DONE');
 assert.deepEqual(JSON.parse((await prisma.payment.findUnique({ where: { id: p.id } })).metadata), { customBuild: { days: 30 }, keep: 'unchanged' });
});
test('returned activation failure stays paid and requires review; duplicate webhook cannot reapply', async () => {
 const p = await fixture(); outcome = { ok: false, error: 'Device cap exceeded' }; activations = 0;
 await acceptPaidPayment(p.id, 'rollypay', 'failed-id'); await processPaymentDelivery(p.id);
 assert.equal((await prisma.paymentDelivery.findUnique({ where: { paymentId: p.id } })).state, 'REVIEW');
 const row = await prisma.payment.findUnique({ where: { id: p.id } }); assert.equal(row.status, 'PAID'); assert.equal(JSON.parse(row.metadata).activationError, outcome.error);
 await acceptPaidPayment(p.id, 'rollypay', 'failed-id'); await processPaymentDeliveries(); assert.equal(activations, 1); outcome = { ok: true };
});
test('uncertain remote exception goes to review without automatic retry', async () => {
 const p = await fixture(); outcome = Error('Lost response after applying renewal'); activations = 0;
 await acceptPaidPayment(p.id, 'rollypay', 'timeout-id'); await processPaymentDelivery(p.id); await processPaymentDeliveries();
 assert.equal(activations, 1); assert.equal((await prisma.paymentDelivery.findUnique({ where: { paymentId: p.id } })).state, 'REVIEW'); outcome = { ok: true };
});
test('concurrent balance receipts credit once; refund and duplicate receipt never re-credit', async () => {
 const p = await fixture(false);
 await Promise.all(Array.from({ length: 8 }, () => acceptPaidPayment(p.id, 'rollypay', 'balance-id')));
 assert.equal((await prisma.client.findUnique({ where: { id: p.clientId } })).balance, 260);
 await prisma.payment.update({ where: { id: p.id }, data: { status: 'REFUNDED' } });
 assert.equal((await acceptPaidPayment(p.id, 'rollypay', 'balance-id')).accepted, false);
 assert.equal((await prisma.client.findUnique({ where: { id: p.clientId } })).balance, 260);
});
test('stale processing is sent to manual reconciliation, never retried automatically', async () => {
 const p = await fixture(); await acceptPaidPayment(p.id, 'rollypay', 'stale-id');
 await prisma.paymentDelivery.update({ where: { paymentId: p.id }, data: { state: 'PROCESSING', startedAt: new Date(Date.now() - 700000) } });
 activations = 0; await processPaymentDeliveries(); assert.equal(activations, 0);
 assert.equal((await prisma.paymentDelivery.findUnique({ where: { paymentId: p.id } })).state, 'REVIEW');
});
test('refund before worker claim prevents fulfillment', async () => {
 const p = await fixture(); await acceptPaidPayment(p.id, 'rollypay', 'refund-id');
 await prisma.payment.update({ where: { id: p.id }, data: { status: 'REFUNDED' } });
 activations = 0; await processPaymentDelivery(p.id); assert.equal(activations, 0);
});
test('RollyPay verifies signature, amount and sandbox before durable acceptance', async () => {
 const { createHmac } = await import('node:crypto');
 mock.module(new URL('../dist/modules/client/client.service.js', import.meta.url), { namedExports: { getSystemConfig: async () => ({ rollypaySigningSecret: 'isolated-signing-secret', rollypayTestMode: true }) } });
 const { default: express } = await import('express');
 const { rollypayWebhooksRouter } = await import('../dist/modules/webhooks/rollypay.webhooks.routes.js');
 const app = express(); app.use(express.raw({ type: '*/*' })); app.use(rollypayWebhooksRouter);
 const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
 const p = await fixture(false);
 async function send(changes = {}, validSignature = true) {
  const raw = JSON.stringify({ event_type: 'payment.paid', payment_id: 'rp-transaction', order_id: p.orderId, status: 'paid', amount: '260.00', currency: 'RUB', test: true, ...changes });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', validSignature ? 'isolated-signing-secret' : 'wrong').update(timestamp + '.' + raw).digest('hex');
  return fetch(`http://127.0.0.1:${server.address().port}/`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Timestamp': timestamp, 'X-Signature': signature }, body: raw });
 }
 try {
  assert.equal((await send({}, false)).status, 401);
  assert.equal((await send({ amount: '1.00' })).status, 400);
  assert.equal((await send({ test: false })).status, 400);
  assert.equal((await prisma.client.findUnique({ where: { id: p.clientId } })).balance, 0);
  const responses = await Promise.all([send(), send(), send()]); assert.ok(responses.every(r => r.status === 200));
  assert.equal((await prisma.client.findUnique({ where: { id: p.clientId } })).balance, 260);
  assert.equal((await send({ payment_id: 'other-transaction' })).status, 400);
 } finally { await new Promise(resolve => server.close(resolve)); }
});
