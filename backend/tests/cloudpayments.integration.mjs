import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';

if (!process.env.DATABASE_URL?.includes('/cloudpayments_test')) throw Error('Use an isolated cloudpayments_test database');
process.env.JWT_SECRET ||= 'cloudpayments-isolated-test-secret-32-characters';
process.env.NODE_ENV = 'test';
const { prisma } = await import('../dist/db.js');
const { invalidateSystemConfigCache } = await import('../dist/modules/client/client.service.js');
const { verifyCloudPaymentsSignature, parseCloudNotification, sameAmount, subscriptionPrice, proratedDevicePrice } = await import('../dist/modules/cloudpayments/cloudpayments-api.js');
const { syncCloudAgreement, cancelCloudAgreement, DAY } = await import('../dist/modules/cloudpayments/cloudpayments.service.js');
const { processCloudPayments } = await import('../dist/modules/cloudpayments/cloudpayments.worker.js');
const { cloudWebhooksRouter, validateCloudPayment } = await import('../dist/modules/cloudpayments/cloudpayments.webhooks.js');
const { cloudPublicRouter, prepareCloudCheckout } = await import('../dist/modules/cloudpayments/cloudpayments.routes.js');
const { setRemnaRuntimeConfig } = await import('../dist/modules/remna/remna.client.js');
const { default: express } = await import('express');
const realFetch = globalThis.fetch;
const users = new Map();
const plans = new Map();
const calls = [];
let down = false, loseCreate = false, losePlan = false;
let server, origin, tariff, serial = 700000;
const txid = () => String(++serial);
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (input, options = {}) => {
  const url = String(input);
  if (url.startsWith('http://127.0.0.1:')) return realFetch(input, options);
  const body = JSON.parse(options.body || '{}');
  calls.push({ url, body, requestId: options.headers?.['X-Request-ID'] });
  if (url.startsWith('https://api.cloudpayments.ru/')) {
    const method = url.replace('https://api.cloudpayments.ru/', '');
    let result;
    if (method === 'subscriptions/create') {
      result = { ...body, Id: randomUUID(), Status: 'Active' };
      plans.set(result.Id, result);
      if (losePlan) { losePlan = false; throw Error('Connection lost after create'); }
    } else if (method === 'subscriptions/find') result = [...plans.values()].filter(p => p.AccountId === body.AccountId);
    else if (method === 'subscriptions/get') result = plans.get(body.Id);
    else if (method === 'subscriptions/update') { result = plans.get(body.Id); assert.ok(['Active', 'PastDue'].includes(result.Status)); Object.assign(result, body); }
    else if (method === 'subscriptions/cancel') { result = plans.get(body.Id); result.Status = 'Cancelled'; }
    else if (method === 'payments/refund') result = { TransactionId: txid() };
    else throw Error(`Unexpected provider call: ${method}`);
    return json({ Success: true, Model: result });
  }
  if (url.startsWith('https://remna.invalid/')) {
    if (down) return json({ message: 'Unavailable' }, 503);
    const path = new URL(url).pathname;
    let user;
    if (path.includes('/by-username/')) user = [...users.values()].find(u => u.username === path.split('/').at(-1));
    else if (path === '/api/users' && options.method === 'POST') {
      assert.equal([...users.values()].filter(u => u.username === body.username).length, 0);
      user = { ...body, uuid: randomUUID() };
      users.set(user.uuid, user);
      if (loseCreate) { loseCreate = false; throw Error('Connection lost after create'); }
    } else if (path === '/api/users' && options.method === 'PATCH') {
      user = users.get(body.uuid); assert.ok(user); Object.assign(user, body);
    } else if (path.includes('/actions/reset-traffic')) {
      user = users.get(path.split('/')[3]); assert.ok(user); user.lastTrafficResetAt = new Date().toISOString();
    } else user = users.get(path.split('/').at(-1));
    return user ? json({ response: user }) : json({ message: 'Not found' }, 404);
  }
  throw Error(`External traffic blocked by test: ${url}`);
};
async function settings(values) {
  for (const [key, value] of Object.entries(values)) await prisma.systemSetting.upsert({ where: { key }, update: { value: String(value) }, create: { key, value: String(value) } });
  invalidateSystemConfigCache();
}
async function makeOrder({ trial = false, topup = false, client, ...data } = {}) {
  client ||= await prisma.client.create({ data: {} });
  const p = await prisma.payment.create({ data: { clientId: client.id, orderId: randomUUID(), provider: 'cloudpayments', amount: topup ? 100 : 300, currency: 'RUB', ...(!topup ? { tariffId: tariff.id } : {}), ...data } });
  await prepareCloudCheckout(p.id, trial);
  return { p: await prisma.payment.findUniqueOrThrow({ where: { id: p.id } }), client };
}
async function start(p, recurring) {
  const response = await realFetch(`${origin}/api/cloudpayments/checkout/${p.orderId}/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recurring }) });
  return { response, data: await response.json() };
}
async function notify(kind, fields, valid = true) {
  const body = new URLSearchParams(Object.entries(fields).map(([k,v]) => [k,String(v)])).toString();
  const hmac = createHmac('sha256', 'test-api-secret').update(body).digest('base64');
  return realFetch(`${origin}/api/cloudpayments/webhook/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-HMAC': valid ? hmac : hmac.slice(1) }, body });
}
const payBody = (p, account, extra = {}) => ({ TransactionId: txid(), InvoiceId: p.orderId, AccountId: account, Amount: p.amount, Currency: 'RUB', TestMode: '1', OperationType: 'Payment', Status: 'Completed', DateTime: new Date().toISOString(), ...extra });
async function paidTrial(opts = {}) {
  const { p, client } = await makeOrder({ trial: true, ...opts });
  const { response, data } = await start(p, true); assert.equal(response.status, 200);
  const id = data.widget.userInfo.accountId;
  const body = payBody(p, id, { Token: 'secret-test-token' });
  assert.equal((await notify('pay', body)).status, 200);
  await processCloudPayments();
  return { p, client, id, body, agreement: await prisma.cloudPaymentAgreement.findUniqueOrThrow({ where: { id }, include: { subscription: true } }) };
}
before(async () => {
  await prisma.cloudPaymentJob.deleteMany(); await prisma.cloudPaymentEvent.deleteMany(); await prisma.cloudPaymentAgreement.deleteMany();
  await prisma.payment.deleteMany(); await prisma.subscription.deleteMany(); await prisma.client.deleteMany(); await prisma.tariff.deleteMany(); await prisma.tariffCategory.deleteMany(); await prisma.systemSetting.deleteMany();
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "cloudpayment_agreements_active_subscription_key" ON "cloudpayment_agreements"("subscription_id") WHERE "state" IN ('PENDING', 'ACTIVE', 'PAST_DUE', 'CANCEL_PENDING')`);
  const category = await prisma.tariffCategory.create({ data: { name: 'CloudPayments tests' } });
  tariff = await prisma.tariff.create({ data: { categoryId: category.id, name: 'Test tariff', durationDays: 30, price: 300, currency: 'RUB', includedDevices: 3, maxExtraDevices: 10, internalSquadUuids: [] } });
  await settings({ remna_api_url: "https://remna.invalid", remna_admin_token: "test", cloudpayments_enabled: true, cloudpayments_public_id: 'test-terminal', cloudpayments_api_secret: 'test-api-secret', cloudpayments_test_mode: true, cloudpayments_trial_days: 3, cloudpayments_trial_amount: 1, cloudpayments_trial_tariff_id: tariff.id, cloudpayments_grace_days: 2, public_app_url: 'http://localhost:5191', max_additional_subscriptions: 5 });
  setRemnaRuntimeConfig({ apiUrl: 'https://remna.invalid', adminToken: 'test', secretKey: '', source: 'env' });
  const app = express();
  app.use('/api/cloudpayments/webhook', express.raw({ type: ['application/json', 'application/x-www-form-urlencoded'] }), cloudWebhooksRouter);
  app.use(express.json()); app.use('/api/cloudpayments', cloudPublicRouter);
  app.use((err, req, res, next) => res.status(400).json({ message: err.message }));
  server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { globalThis.fetch = realFetch; await new Promise(resolve => server.close(resolve)); await prisma.$disconnect(); });
test('HMAC covers raw bytes, rejects tampering and ambiguous amounts/fields', () => {
  const body = Buffer.from('AccountId=%D0%A2%D0%B5%D1%81%D1%82&Amount=1.00');
  const signature = createHmac('sha256', 's').update(body).digest('base64');
  assert.equal(verifyCloudPaymentsSignature(body, signature, 's'), true);
  assert.equal(verifyCloudPaymentsSignature(Buffer.concat([body, Buffer.from('0')]), signature, 's'), false);
  assert.equal(sameAmount(null, 0), false); assert.equal(sameAmount('', 0), false); assert.equal(sameAmount('1.01', 1.01), true);
  assert.throws(() => parseCloudNotification(Buffer.from('Amount=1&Amount=2'), 'form'));
  assert.equal(subscriptionPrice(300, 250, 30), 550);
  assert.equal(proratedDevicePrice(250, new Date(15 * DAY), new Date(0)), 125);
});
test('wrong signature, amount, account and production mode cannot create receipts', async () => {
  const { p, client } = await makeOrder({ topup: true }); await start(p, false);
  const b = payBody(p, client.id);
  assert.equal((await notify('pay', b, false)).status, 401);
  for (const patch of [{ Amount: 1 }, { AccountId: 'other' }, { TestMode: 0 }, { OperationType: 'Refund' }]) assert.equal((await notify('pay', { ...b, TransactionId: txid(), ...patch })).status, 200);
  assert.equal(await prisma.cloudPaymentEvent.count(), 4);
  assert.equal((await prisma.client.findUnique({ where: { id: client.id } })).balance, 0);
  assert.equal(await prisma.cloudPaymentJob.count(), 0);
  await prisma.cloudPaymentEvent.deleteMany();
});
test('parallel Check claims one transaction; repeated Pay credits balance once while VPN is down', async () => {
  const { p, client } = await makeOrder({ topup: true }); await start(p, false);
  const a = payBody(p, client.id), b = payBody(p, client.id);
  const codes = await Promise.all([a,b].map(async body => (await (await notify('check', body)).json()).code));
  assert.deepEqual([...codes].sort((a,b) => a-b), [0,13]);
  const accepted = codes[0] === 0 ? a : b;
  down = true;
  await Promise.all(Array.from({ length: 6 }, async () => assert.equal((await notify('pay', accepted)).status, 200)));
  await Promise.all([processCloudPayments(), processCloudPayments()]);
  assert.equal((await prisma.client.findUnique({ where: { id: client.id } })).balance, 100);
  assert.equal(await prisma.cloudPaymentJob.count({ where: { paymentId: p.id } }), 1);
  down = false;
});
test('paid trial requires explicit consent and quotes regular undiscounted renewal', async () => {
  const client = await prisma.client.create({ data: { personalDiscountPercent: 50, personalDiscountIsOneTime: true } });
  const { p } = await makeOrder({ trial: true, client, amount: 150 });
  assert.equal((await start(p, false)).response.status, 400);
  const { response, data } = await start(p, true); assert.equal(response.status, 200);
  const a = await prisma.cloudPaymentAgreement.findUniqueOrThrow({ where: { id: data.widget.userInfo.accountId } });
  assert.equal(p.amount, 1); assert.equal(a.amount, 300); assert.match(a.consentText, /300 RUB/);
  await cancelCloudAgreement(a.id);
});
test('lost VPN creation response is reconciled; paid receipt persists and trial is only issued once', async () => {
  loseCreate = true;
  const result = await paidTrial();
  assert.equal((await prisma.payment.findUnique({ where: { id: result.p.id } })).status, 'PAID');
  assert.equal((await prisma.cloudPaymentJob.findUnique({ where: { paymentId: result.p.id } })).state, 'PENDING');
  await processCloudPayments();
  const a = await prisma.cloudPaymentAgreement.findUniqueOrThrow({ where: { id: result.id }, include: { subscription: true } });
  assert.equal(a.state, 'ACTIVE'); assert.ok(a.trialEndsAt);
  assert.ok(Math.abs((a.subscription.expireAt.getTime() - Date.now()) / DAY - 3) < .01);
  const expiry = a.subscription.expireAt.toISOString();
  await notify('pay', result.body); await processCloudPayments();
  assert.equal((await prisma.subscription.findUnique({ where: { id: a.subscriptionId } })).expireAt.toISOString(), expiry);
  assert.equal([...users.values()].filter(u => u.username === `cp_${a.subscriptionId}`).length, 1);
  assert.equal(await prisma.client.findUnique({ where: { id: result.client.id } }).then(c => c.trialUsed), true);
  await assert.rejects(makeOrder({ trial: true, client: result.client }), /использован/);
});
test('uncertain recurring plan creation is found by account without a duplicate', async () => {
  losePlan = true;
  const { id } = await paidTrial();
  assert.equal([...plans.values()].filter(p => p.AccountId === id).length, 1);
  await processCloudPayments();
  assert.equal((await prisma.cloudPaymentAgreement.findUnique({ where: { id } })).state, 'ACTIVE');
  assert.equal([...plans.values()].filter(p => p.AccountId === id).length, 1);
});
test('tariff price and devices update next debit; provider cancellation never gets reactivated', async () => {
  const { id, agreement: a } = await paidTrial();
  await prisma.tariff.update({ where: { id: tariff.id }, data: { price: 22 } });
  await syncCloudAgreement(id); assert.equal(plans.get(a.providerId).Amount, 22);
  await prisma.tariff.update({ where: { id: tariff.id }, data: { price: 300 } });
  await prisma.subscription.update({ where: { id: a.subscriptionId }, data: { extraDevicesMonthlyPrice: 250, extraDevices: 1 } });
  await syncCloudAgreement(id); assert.equal(plans.get(a.providerId).Amount, 550);
  plans.get(a.providerId).Status = 'Cancelled';
  const before = calls.filter(c => c.url.endsWith('/subscriptions/update')).length;
  await syncCloudAgreement(id);
  assert.equal(calls.filter(c => c.url.endsWith('/subscriptions/update')).length, before);
  assert.equal(users.get(a.subscription.remnawaveUuid).status, 'DISABLED');
});
test('failed recurring payment grants grace once; recovery issues full paid period without free grace carry-over', async () => {
  const { id, agreement: a } = await paidTrial();
  const due = new Date(Date.now() - DAY);
  await prisma.cloudPaymentAgreement.update({ where: { id }, data: { nextChargeAt: due, trialEndsAt: due } });
  users.get(a.subscription.remnawaveUuid).expireAt = due.toISOString();
  const failure = { TransactionId: txid(), SubscriptionId: a.providerId, AccountId: id, DateTime: new Date().toISOString(), ReasonCode: 5001 };
  plans.get(a.providerId).Status = 'PastDue';
  await notify('fail', failure); await processCloudPayments();
  let agreement = await prisma.cloudPaymentAgreement.findUnique({ where: { id } });
  assert.equal(agreement.graceEndsAt.getTime(), due.getTime() + 2 * DAY);
  await notify('fail', failure); await processCloudPayments();
  assert.equal((await prisma.cloudPaymentAgreement.findUnique({ where: { id } })).graceEndsAt.getTime(), agreement.graceEndsAt.getTime());
  const recurring = payBody({ orderId: '', amount: 300 }, id, { SubscriptionId: a.providerId });
  const competing = { ...recurring, TransactionId: txid() };
  const codes = await Promise.all([recurring, competing].map(b => validateCloudPayment(b, true)));
  assert.deepEqual([...codes].sort((a,b) => a-b), [0,13]);
  const accepted = codes[0] === 0 ? recurring : competing;
  plans.get(a.providerId).Status = 'Active';
  await notify('pay', accepted); await processCloudPayments();
  agreement = await prisma.cloudPaymentAgreement.findUnique({ where: { id }, include: { subscription: true } });
  assert.equal(agreement.trialEndsAt, null); assert.equal(agreement.graceEndsAt, null);
  assert.ok(Math.abs((agreement.subscription.expireAt.getTime() - Date.now()) / DAY - 30) < .01);
  const expiry = agreement.subscription.expireAt.toISOString();
  await notify('pay', accepted); await processCloudPayments();
  assert.equal((await prisma.subscription.findUnique({ where: { id: agreement.subscriptionId } })).expireAt.toISOString(), expiry);
  await cancelCloudAgreement(id);
  assert.equal(users.get(agreement.subscription.remnawaveUuid).status, 'ACTIVE');
  assert.equal(await validateCloudPayment(accepted, true), 13);
});
test('device purchase changes the device limit once and the next recurring amount to 550', async () => {
  const { agreement: a, client } = await paidTrial();
  const expiresAt = new Date(Date.now() + 15 * DAY);
  await prisma.subscription.update({ where: { id: a.subscriptionId }, data: { expireAt: expiresAt } });
  users.get(a.subscription.remnawaveUuid).expireAt = expiresAt.toISOString();
  const { p } = await makeOrder({ client, topup: true, amount: 125, metadata: JSON.stringify({ extraOption: { kind: 'devices', deviceCount: 1, productPriceMonthly: 250 }, targetSubscriptionId: a.subscriptionId }) });
  await start(p, false);
  const body = payBody(p, client.id);
  await notify('pay', body); await processCloudPayments();
  await notify('pay', body); await processCloudPayments();
  const sub = await prisma.subscription.findUnique({ where: { id: a.subscriptionId } });
  assert.equal(sub.extraDevices, 1); assert.equal(sub.extraDevicesMonthlyPrice, 250);
  assert.equal(users.get(sub.remnawaveUuid).hwidDeviceLimit, 4);
  assert.equal(plans.get(a.providerId).Amount, 550);
});
test('partial and full refunds use the original payment id and reverse money only once', async () => {
  const referrer = await prisma.client.create({ data: {} });
  const client = await prisma.client.create({ data: { referrerId: referrer.id } });
  await settings({ default_referral_percent: 10 });
  const { p } = await makeOrder({ topup: true, client }); await start(p, false);
  const body = payBody(p, client.id);
  await notify('pay', body); await processCloudPayments();
  const before = (await prisma.client.findUnique({ where: { id: referrer.id } })).balance;
  const partial = { TransactionId: txid(), PaymentTransactionId: body.TransactionId, AccountId: client.id, OperationType: 'Refund', Amount: 25 };
  await Promise.all([notify('refund', partial), notify('refund', partial)]); await processCloudPayments();
  assert.equal((await prisma.client.findUnique({ where: { id: client.id } })).balance, 75);
  assert.equal((await prisma.client.findUnique({ where: { id: referrer.id } })).balance, before * .75);
  await notify('refund', partial); await processCloudPayments();
  assert.equal((await prisma.client.findUnique({ where: { id: client.id } })).balance, 75);
  await notify('refund', { ...partial, TransactionId: txid(), Amount: 75 }); await processCloudPayments();
  assert.equal((await prisma.client.findUnique({ where: { id: client.id } })).balance, 0);
  assert.equal((await prisma.client.findUnique({ where: { id: referrer.id } })).balance, 0);
  assert.equal((await prisma.payment.findUnique({ where: { id: p.id } })).status, 'REFUNDED');
});
test('signed cancellation notification stops trial without waiting for another payment', async () => {
  const { id, agreement: a } = await paidTrial();
  await notify('recurrent', { Id: a.providerId, AccountId: id, Status: 'Cancelled' });
  await processCloudPayments();
  assert.equal(plans.get(a.providerId).Status, 'Cancelled');
  assert.equal(users.get(a.subscription.remnawaveUuid).status, 'DISABLED');
});

test('single-subscription mode refuses a second automatic debit plan before payment', async () => {
  const { client, p } = await makeOrder();
  assert.equal((await start(p, true)).response.status, 200);
  const second = await makeOrder({ client });
  assert.equal((await start(second.p, true)).response.status, 400);
  const pending = await prisma.cloudPaymentAgreement.findFirst({ where: { clientId: client.id } });
  await cancelCloudAgreement(pending.id);
  const active = await paidTrial();
  const renewal = await makeOrder({ client: active.client });
  assert.equal((await start(renewal.p, true)).response.status, 400);
});
test('account merge preserves recurring ownership and a previously opened checkout', async () => {
  const { mergeClients } = await import('../dist/modules/client/merge-clients.service.js');
  const { id, client, agreement } = await paidTrial();
  const topup = await makeOrder({ client, topup: true }); await start(topup.p, false);
  const target = await prisma.client.create({ data: {} });
  await mergeClients(target.id, client.id);
  assert.equal((await prisma.cloudPaymentAgreement.findUnique({ where: { id } })).clientId, target.id);
  assert.equal((await prisma.subscription.findUnique({ where: { id: agreement.subscriptionId } })).ownerId, target.id);
  const body = payBody(topup.p, client.id);
  assert.equal(await validateCloudPayment(body, true), 0);
  await notify('pay', body); await processCloudPayments();
  assert.equal((await prisma.client.findUnique({ where: { id: target.id } })).balance, 100);
});

test('manual extension moves the next debit; changing tariff cancels the old plan without removing access', async () => {
  const { id, agreement: a } = await paidTrial();
  const extended = new Date(Date.now() + 60 * DAY);
  await prisma.subscription.update({ where: { id: a.subscriptionId }, data: { expireAt: extended } });
  plans.get(a.providerId).NextTransactionDateIso = a.nextChargeAt.toISOString();
  await syncCloudAgreement(id);
  assert.equal((await prisma.cloudPaymentAgreement.findUnique({ where: { id } })).nextChargeAt.toISOString(), extended.toISOString());
  assert.equal(plans.get(a.providerId).StartDate, extended.toISOString());
  const replacement = await prisma.tariff.create({ data: { categoryId: tariff.categoryId, name: 'Replacement', price: 500, durationDays: 30 } });
  await prisma.subscription.update({ where: { id: a.subscriptionId }, data: { tariffId: replacement.id } });
  await syncCloudAgreement(id);
  assert.equal(plans.get(a.providerId).Status, 'Cancelled');
  assert.equal((await prisma.cloudPaymentAgreement.findUnique({ where: { id } })).state, 'CANCELLED');
  assert.equal(users.get(a.subscription.remnawaveUuid).status, 'ACTIVE');
});
test('reopening an unpaid renewal reuses consent and preserves the purchased duration', async () => {
  const client = await prisma.client.create({ data: {} });
  const sub = await prisma.subscription.create({ data: { ownerId: client.id, subscriptionIndex: 0, tariffId: tariff.id } });
  const { p } = await makeOrder({ client, metadata: JSON.stringify({ extendsSecondarySubId: sub.id }) });
  const first = await start(p, true);
  assert.equal(first.response.status, 200);
  assert.ok(first.data.widget.restrictedPaymentMethods.includes("Sbp"));
  await prisma.tariff.update({ where: { id: tariff.id }, data: { durationDays: 90 } });
  const second = await start(p, true);
  assert.equal(second.response.status, 200);
  assert.equal(first.data.widget.userInfo.accountId, second.data.widget.userInfo.accountId);
  assert.equal((await prisma.cloudPaymentAgreement.findUnique({ where: { id: first.data.widget.userInfo.accountId } })).periodDays, 30);
  await prisma.tariff.update({ where: { id: tariff.id }, data: { durationDays: 30 } });
});

test('checkout rejects a price option from another tariff and excess devices', async () => {
  const foreign = await prisma.tariff.create({ data: { categoryId: tariff.categoryId, name: 'Foreign', price: 1, durationDays: 365 } });
  const option = await prisma.tariffPriceOption.create({ data: { tariffId: foreign.id, durationDays: 365, price: 1 } });
  const client = await prisma.client.create({ data: {} });
  const p = await prisma.payment.create({ data: { clientId: client.id, orderId: randomUUID(), provider: 'cloudpayments', amount: 300, currency: 'RUB', tariffId: tariff.id, tariffPriceOptionId: option.id } });
  await assert.rejects(prepareCloudCheckout(p.id, false), /Период не принадлежит/);
  await prisma.payment.update({ where: { id: p.id }, data: { tariffPriceOptionId: null, deviceCount: 11 } });
  await assert.rejects(prepareCloudCheckout(p.id, false), /лимит дополнительных/);
});

test('admin refund retries use the same request key and await the bank notification', async () => {
  const { requestCloudRefund } = await import('../dist/modules/cloudpayments/cloudpayments-refund.js');
  const { p, client } = await makeOrder({ topup: true }); await start(p, false);
  const body = payBody(p, client.id);
  await notify('pay', body); await processCloudPayments();
  await Promise.all([requestCloudRefund(p.id), requestCloudRefund(p.id)]);
  const requests = calls.filter(c => c.url.endsWith('/payments/refund') && c.body.TransactionId === body.TransactionId);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].requestId, requests[1].requestId);
  assert.equal((await prisma.payment.findUnique({ where: { id: p.id } })).status, 'PAID');
  await notify('refund', { TransactionId: txid(), PaymentTransactionId: body.TransactionId, OperationType: 'Refund', Amount: 100, AccountId: client.id });
  await processCloudPayments();
  assert.equal((await prisma.payment.findUnique({ where: { id: p.id } })).status, 'REFUNDED');
  assert.equal((await prisma.client.findUnique({ where: { id: client.id } })).balance, 0);
});
