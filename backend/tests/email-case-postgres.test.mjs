import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import ts from 'typescript';
import express, { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const url = new URL(process.env.DATABASE_URL);
if (!/^\/email_case_test(?:_[a-z0-9]+)?$/.test(url.pathname)) throw Error('Dedicated email_case_test database required');
const prisma = new PrismaClient({ datasourceUrl: url.href });
const env = { JWT_SECRET: 'email-case-test-secret-only', JWT_ACCESS_EXPIRES_IN: '15m', JWT_REFRESH_EXPIRES_IN: '7d' };
const scope = { prisma, env, z, Router, bcrypt, jwt, randomBytes, randomUUID, SALT_ROUNDS: 4 };

function load(file, names) {
  const source = ts.createSourceFile(file, readFileSync(new URL('../src/' + file, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const nodes = source.statements.filter(node => !ts.isImportDeclaration(node) && (!names || names.includes(node.name?.text)));
  const text = nodes.map(node => node.getText(source)).join('\n');
  const js = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(js, { ...scope, exports, Date, URL, URLSearchParams, Buffer, console, process }, { filename: file });
  return exports;
}

Object.assign(scope, load('modules/auth/email-identity.ts'));
Object.assign(scope, load('modules/client/email-registration.ts'));
Object.assign(scope, load('modules/auth/auth.service.ts'));
Object.assign(scope, load('modules/client/client.service.ts', ['hashPassword', 'verifyPassword', 'signClientToken', 'signClient2FAPendingToken', 'generateReferralCode']));
const sent = [];
const telegram = [];
let settings = {};
let merges = 0;
Object.assign(scope, {
  asClientUncheckedCreate: x => x,
  asClientWhere: x => x,
  asTelegramAuthUpdate: x => x,
  requireClientAuth: (_req, _res, next) => next(),
  requireAuth: (_req, _res, next) => next(),
  getSystemConfig: async () => settings,
  getPrimaryBot: async () => ({ id: 'fixture-bot' }),
  extractBotTokenFromRequest: () => null,
  notifyAdminsAboutNewClient: async () => {},
  isRemnaConfigured: () => false,
  mailConfigFromSystem: x => x,
  isMailConfigured: () => true,
  isSystemSmtpConfigured: () => true,
  renderEmailTemplate: async (kind, values) => kind === 'welcome' ? null : { subject: kind, body: JSON.stringify(values) },
  sendEmail: async (_config, to, kind, body) => { sent.push({ to, kind, values: JSON.parse(body) }); return { ok: true }; },
  notifyClientPasswordReset: async (client, link) => { telegram.push({ clientId: client.id, link }); },
  mergeClients: async () => { merges++; throw Error('Unexpected account merge'); },
});
const auth = load('modules/client/client-auth.routes.ts');
Object.assign(scope, auth);
const profile = load('modules/client/client-profile.routes.ts');
const admin = load('modules/auth/auth.routes.ts');
const app = express();
app.use(express.json());
app.use('/client', auth.clientAuthRouter);
app.use('/profile', async (req, res, next) => {
  req.client = await prisma.client.findUnique({ where: { id: req.get('x-fixture-client') || 'missing' } });
  if (!req.client) return res.sendStatus(401);
  next();
}, profile.clientProfileRouter);
app.use('/admin', admin.authRouter);
let server;
let base;
let passwordHash;
const password = 'OriginalPassword42';
const defaults = { skipEmailVerification: true, signupProtectionEnabled: false, publicAppUrl: 'https://fixture.invalid' };
async function post(path, body, clientId) {
  const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(clientId ? { 'x-fixture-client': clientId } : {}) }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
const create = (id, email, extra = {}) => prisma.client.create({ data: { id, email, passwordHash, registrationSource: 'web', ...extra } });
const login = (email, pwd = password) => post('/client/login', { email, password: pwd });
const forgot = email => post('/client/forgot-password', { email });
const pending = (email, extra = {}) => prisma.pendingEmailRegistration.create({ data: { email, passwordHash, verificationToken: randomUUID(), expiresAt: new Date(Date.now() + 600000), ...extra } });
const verify = token => post('/client/verify-email', { token });
const tokenFromMail = () => new URL(sent.at(-1).values.resetUrl).searchParams.get('token');

before(async () => {
  assert.equal(await prisma.client.count(), 0);
  assert.equal(await prisma.admin.count(), 0);
  passwordHash = await scope.hashPassword(password);
  settings = { ...defaults };
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) await new Promise(resolve => server.close(resolve)); await prisma.$disconnect(); });

test('legacy mixed-case email logs in without changing account, balance, Telegram or subscription', async () => {
  await create('legacy', 'Legacy.User@Example.COM', { balance: 123.45, telegramId: '1234567', referralCode: 'old-ref', remnawaveUuid: 'old-remna' });
  await prisma.subscription.create({ data: { id: 'old-sub', ownerId: 'legacy', subscriptionIndex: 0, remnawaveUuid: 'old-remna' } });
  const before = await prisma.client.findUniqueOrThrow({ where: { id: 'legacy' } });
  const subscription = await prisma.subscription.findUniqueOrThrow({ where: { id: 'old-sub' } });
  for (const email of ['legacy.user@example.com', 'LEGACY.USER@EXAMPLE.COM', ' Legacy.User@Example.COM ']) {
    const response = await login(email);
    assert.equal(response.status, 200);
    assert.equal(response.body.client.id, 'legacy');
    assert.equal(jwt.verify(response.body.token, env.JWT_SECRET).clientId, 'legacy');
    assert.equal(response.body.client.passwordHash, undefined);
  }
  assert.deepEqual(await prisma.client.findUniqueOrThrow({ where: { id: 'legacy' } }), before);
  assert.deepEqual(await prisma.subscription.findUniqueOrThrow({ where: { id: 'old-sub' } }), subscription);
  assert.equal((await login('LEGACY.USER@EXAMPLE.COM', 'wrong')).status, 401);
});

test('registration rejects every spelling of an existing address and canonicalizes new addresses', async () => {
  for (const skipEmailVerification of [true, false]) {
    settings = { ...defaults, skipEmailVerification };
    const response = await post('/client/register', { email: ' LEGACY.USER@EXAMPLE.COM ', password });
    assert.equal(response.status, 400);
  }
  settings = { ...defaults };
  const response = await post('/client/register', { email: ' New.User@Example.COM ', password });
  assert.equal(response.status, 201);
  assert.equal(response.body.client.email, 'new.user@example.com');
  assert.equal((await login('NEW.USER@EXAMPLE.COM')).body.client.id, response.body.client.id);
});

test('concurrent case variants create only one account', async () => {
  const results = await Promise.all(['Race@Example.com', 'RACE@EXAMPLE.COM'].map(email => post('/client/register', { email, password })));
  assert.deepEqual(results.map(x => x.status).sort(), [201, 400]);
  assert.equal(await prisma.client.count({ where: scope.emailWhere('race@example.com') }), 1);
});

test('confirmation, old mixed-case links and replay keep a single account and never reuse a session', async () => {
  settings = { ...defaults, skipEmailVerification: false };
  const response = await post('/client/register', { email: ' Confirm@Example.COM ', password });
  assert.equal(response.status, 201);
  const row = await prisma.pendingEmailRegistration.findFirstOrThrow({ where: { email: 'confirm@example.com' } });
  assert.equal(sent.at(-1).to, 'confirm@example.com');
  const first = await verify(row.verificationToken);
  assert.equal(first.status, 201);
  const replay = await verify(row.verificationToken);
  assert.equal(replay.body.alreadyVerified, true);
  assert.equal(replay.body.token, undefined);
  const old = await pending('Old.Pending@Example.COM');
  assert.equal((await verify(old.verificationToken)).body.client.email, 'old.pending@example.com');
  const collision = await pending('LEGACY.USER@EXAMPLE.COM');
  const collisionResponse = await verify(collision.verificationToken);
  assert.equal(collisionResponse.body.alreadyVerified, true);
  assert.equal(collisionResponse.body.token, undefined);
  assert.equal(await prisma.client.count({ where: scope.emailWhere('legacy.user@example.com') }), 1);
  settings = { ...defaults };
});

test('two legacy confirmation links racing in different cases create one account', async () => {
  const rows = await Promise.all(['Pending.Race@Example.COM', 'pending.race@example.com'].map(email => pending(email)));
  const responses = await Promise.all(rows.map(row => verify(row.verificationToken)));
  assert.deepEqual(responses.map(x => x.status).sort(), [200, 201]);
  assert.equal(responses.filter(x => x.body.token).length, 1);
});

test('recovery finds the legacy account, changes its password once and preserves its identity', async () => {
  const response = await forgot(' LEGACY.USER@EXAMPLE.COM ');
  assert.deepEqual(response.body, { ok: true });
  assert.equal(sent.at(-1).to, 'Legacy.User@Example.COM');
  const token = tokenFromMail();
  assert.equal(jwt.verify(token, env.JWT_SECRET).clientId, 'legacy');
  assert.equal(telegram.at(-1).clientId, 'legacy');
  assert.equal((await post('/client/reset-password', { token, password: 'NewPassword43' })).status, 200);
  assert.equal((await post('/client/reset-password', { token, password: 'AnotherPassword44' })).status, 400);
  assert.equal((await login('legacy.user@example.com', 'NewPassword43')).body.client.id, 'legacy');
  assert.equal((await login('legacy.user@example.com')).status, 401);
  const client = await prisma.client.findUniqueOrThrow({ where: { id: 'legacy' } });
  assert.equal(client.email, 'Legacy.User@Example.COM');
  assert.equal(client.balance, 123.45);
  assert.equal(await prisma.subscription.count({ where: { ownerId: 'legacy' } }), 1);
});

test('blocked and unknown addresses have the same recovery response; 2FA still gates login', async () => {
  await create('blocked', 'Blocked@Example.COM', { isBlocked: true });
  await create('twofa', 'TwoFactor@Example.COM', { totpEnabled: true });
  const count = sent.length;
  assert.deepEqual((await forgot('BLOCKED@example.com')).body, (await forgot('missing@example.com')).body);
  assert.equal(sent.length, count);
  assert.equal((await login('BLOCKED@example.com')).status, 401);
  const response = await login('TWOFACTOR@example.com');
  assert.equal(response.body.requires2FA, true);
  assert.equal(response.body.token, undefined);
  assert.equal(jwt.verify(response.body.tempToken, env.JWT_SECRET).type, 'client_2fa_pending');
});

test('legacy case-colliding accounts retain exact login and recovery; ambiguous variants cannot select or merge', async () => {
  await create('duplicate-a', 'Duplicate@Example.com', { balance: 11 });
  await create('duplicate-b', 'duplicate@example.com', { balance: 22 });
  assert.equal((await login('Duplicate@Example.com')).body.client.id, 'duplicate-a');
  assert.equal((await login('duplicate@example.com')).body.client.id, 'duplicate-b');
  assert.equal((await login('DUPLICATE@EXAMPLE.COM')).status, 401);
  const count = sent.length;
  assert.equal((await forgot('DUPLICATE@EXAMPLE.COM')).status, 200);
  assert.equal(sent.length, count);
  await forgot('Duplicate@Example.com');
  assert.equal(jwt.verify(tokenFromMail(), env.JWT_SECRET).clientId, 'duplicate-a');
  assert.equal((await scope.resolveClientEmail('duplicate@example.com')).ambiguous, true);
  await create('linker', null, { telegramId: '7654321' });
  const request = await post('/profile/link-email-request', { email: 'DUPLICATE@example.com' }, 'linker');
  assert.equal(request.status, 409);
  const row = await prisma.pendingEmailLink.create({ data: { clientId: 'linker', email: 'duplicate@example.com', verificationToken: randomUUID(), expiresAt: new Date(Date.now() + 600000) } });
  assert.equal((await post('/client/verify-link-email', { token: row.verificationToken })).status, 409);
  assert.equal(merges, 0);
  assert.equal((await prisma.client.findUniqueOrThrow({ where: { id: 'duplicate-b' } })).balance, 22);
});

test('linking blocks existing case variants and accepts a new address after confirmation', async () => {
  assert.equal((await post('/profile/link-email-direct', { email: 'LEGACY.USER@example.com' }, 'linker')).status, 400);
  assert.equal((await post('/profile/link-email-request', { email: 'LEGACY.USER@example.com' }, 'linker')).status, 400);
  assert.equal((await post('/profile/link-email-request', { email: ' Linked.New@Example.COM ' }, 'linker')).status, 200);
  const row = await prisma.pendingEmailLink.findFirstOrThrow({ where: { clientId: 'linker' } });
  assert.equal(row.email, 'linked.new@example.com');
  assert.equal((await post('/client/verify-link-email', { token: row.verificationToken })).body.client.id, 'linker');
  assert.equal((await login('LINKED.NEW@EXAMPLE.COM')).body.client.id, 'linker');
});

test('email punctuation is literal, not a wildcard matching another account', async () => {
  await create('punctuation', 'a_b@example.com');
  await create('punctuation-other', 'axb@example.com');
  assert.equal((await login('A_B@EXAMPLE.COM')).body.client.id, 'punctuation');
  assert.equal((await forgot('A_B@EXAMPLE.COM')).status, 200);
  assert.equal(jwt.verify(tokenFromMail(), env.JWT_SECRET).clientId, 'punctuation');
  await create('percent', 'percent%tag@example.com');
  await create('percent-other', 'percent123tag@example.com');
  assert.equal((await scope.resolveClientEmail('PERCENT%TAG@EXAMPLE.COM')).client.id, 'percent');
  assert.equal((await login('a__@example.com')).status, 401);
});

test('admin login accepts case variants and preserves exact access to legacy duplicates', async () => {
  await prisma.admin.create({ data: { id: 'admin-one', email: 'Admin@Example.COM', passwordHash, totpEnabled: true } });
  const response = await post('/admin/login', { email: ' ADMIN@example.com ', password });
  assert.equal(response.status, 200);
  assert.equal(response.body.requires2FA, true);
  assert.equal(jwt.verify(response.body.tempToken, env.JWT_SECRET).adminId, 'admin-one');
  await prisma.admin.create({ data: { id: 'admin-two', email: 'admin@example.com', passwordHash, totpEnabled: true } });
  assert.equal((await post('/admin/login', { email: 'ADMIN@EXAMPLE.COM', password })).status, 401);
  const exact = await post('/admin/login', { email: 'Admin@Example.COM', password });
  assert.equal(jwt.verify(exact.body.tempToken, env.JWT_SECRET).adminId, 'admin-one');
});
