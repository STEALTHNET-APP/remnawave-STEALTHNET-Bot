import assert from 'node:assert/strict';
import { test, mock, after } from 'node:test';
import express from 'express';

let config = {};
let fail = false;
const deliveries = [];
const audits = [];
mock.module('../dist/modules/client/client.service.js', { namedExports: { getSystemConfig: async () => config } });
mock.module('../dist/modules/audit/audit.service.js', { namedExports: { logAdmin: async (...args) => audits.push(args.slice(1)) } });
mock.module('nodemailer', { defaultExport: { createTransport: options => ({ sendMail: async mail => {
  if (fail) throw new Error('SMTP auth failed: secret-password');
  deliveries.push({ options, mail });
} }) } });
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (String(url) === 'https://api.resend.com/emails') {
    if (fail) return new Response('secret-api-key', { status: 401 });
    deliveries.push({ resend: JSON.parse(options.body) });
    return new Response('{}');
  }
  return nativeFetch(url, options);
};
const { mailTestRouter } = await import('../dist/modules/mail/mail-test.routes.js');
const app = express();
app.use(express.json());
app.use((req, res, next) => { req.adminRole = req.headers['x-role']; req.adminId = req.headers['x-admin'] || 'admin'; next(); });
app.use('/settings/mail-test', mailTestRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const url = `http://127.0.0.1:${server.address().port}/settings/mail-test`;
after(async () => { globalThis.fetch = nativeFetch; await new Promise(resolve => server.close(resolve)); });
async function send(body, id, role = 'ADMIN') {
  const response = await nativeFetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-role': role, 'x-admin': id }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}

test('unauthenticated and manager requests cannot send mail', async () => {
  for (const role of ['', 'MANAGER']) assert.equal((await send({ toEmail: 'test@example.com' }, 'denied', role)).status, 403);
  assert.equal(deliveries.length, 0);
});
test('invalid address and injected settings are rejected', async () => {
  for (const body of [{}, { toEmail: 'bad' }, { toEmail: 'a@example.com,b@example.com' }, { toEmail: 'a@example.com', smtpHost: 'other-host' }]) {
    assert.equal((await send(body, 'invalid')).status, 400);
  }
  assert.equal(deliveries.length, 0);
});
test('unconfigured selected provider does not send', async () => {
  config = { mailProvider: 'resend', smtpHost: 'smtp.example.test', smtpFromEmail: 'sender@example.test' };
  assert.equal((await send({ toEmail: 'test@example.com' }, 'unconfigured')).status, 400);
  assert.equal(deliveries.length, 0);
});
test('SMTP uses saved transport and sends only fixed test content to one recipient', async () => {
  config = { smtpHost: 'smtp.example.test', smtpPort: 587, smtpUser: 'sender', smtpPassword: 'saved-password', smtpFromEmail: 'sender@example.test' };
  const result = await send({ toEmail: ' test@example.com ' }, 'smtp');
  assert.equal(result.status, 200);
  assert.equal(deliveries.at(-1).options.auth.pass, 'saved-password');
  assert.equal(deliveries.at(-1).mail.to, 'test@example.com');
  assert.equal(deliveries.at(-1).mail.subject, 'Проверка отправки почты');
  assert.equal(audits.at(-1)[0], 'mail.send_test');
  assert.ok(!JSON.stringify(result).includes('saved-password'));
});
test('Resend is selected instead of SMTP', async () => {
  config = { mailProvider: 'resend', resendApiKey: 'saved-api-key', resendFromEmail: 'sender@example.test' };
  assert.equal((await send({ toEmail: 'test@example.com' }, 'resend')).status, 200);
  assert.deepEqual(deliveries.at(-1).resend.to, ['test@example.com']);
});
test('provider failures are not reported as delivery success and do not expose credentials', async () => {
  fail = true;
  for (const provider of ['smtp', 'resend']) {
    config = { mailProvider: provider, smtpHost: 'smtp.example.test', smtpFromEmail: 'sender@example.test', resendApiKey: 'secret-api-key' };
    const result = await send({ toEmail: 'test@example.com' }, 'failure-' + provider);
    assert.equal(result.status, 502);
    assert.ok(!JSON.stringify(result).includes('secret'));
  }
  fail = false;
});
test('limits repeated sends per administrator', async () => {
  for (let n = 0; n < 5; n++) assert.equal((await send({ toEmail: 'test@example.com' }, 'rate-limit')).status, 200);
  const before = deliveries.length;
  assert.equal((await send({ toEmail: 'test@example.com' }, 'rate-limit')).status, 429);
  assert.equal(deliveries.length, before);
});
