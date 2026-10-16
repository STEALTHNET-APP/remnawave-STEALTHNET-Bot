import assert from 'node:assert/strict';
import { test, mock, after } from 'node:test';
import express from 'express';
const excludedId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const settings = new Map();
let remnaFailed = false;
let dbFailed = false;
let userName = 'service';
let numericIds = false;
const prisma = {
  systemSetting: {
    findMany: async () => { if (dbFailed) throw new Error('database unavailable'); return [...settings].map(([key, value]) => ({ key, value })); },
    upsert: async ({ where, create, update }) => settings.set(where.key, settings.has(where.key) ? update.value : create.value),
    deleteMany: async ({ where }) => settings.delete(where.key),
  },
  subscription: { findMany: async () => [] },
};
mock.module('../dist/db.js', { namedExports: { prisma } });
mock.module('../dist/modules/auth/middleware.js', { namedExports: {
  requireAuth: (req, res, next) => { if (!req.headers['x-role']) return res.sendStatus(401); req.adminRole = req.headers['x-role']; next(); },
  requireAdminSection: (_req, _res, next) => next(),
} });
mock.module('../dist/modules/audit/audit.service.js', { namedExports: { logAdmin: async () => {} } });
mock.module('../dist/modules/remna/remna.client.js', { namedExports: {
  isRemnaConfigured: () => true,
  extractRemnaUuid: user => user?.uuid ?? (user?.id == null ? null : String(user.id)),
  remnaGetUser: async uuid => remnaFailed ? { error: 'offline', status: 503 } : { data: { response: { ...(numericIds ? { id: Number(uuid) } : { uuid }), username: userName } } },
  remnaGetUsers: async () => ({ data: { response: { total: 3, users: [{ ...(numericIds ? { id: 2 } : { uuid: excludedId }), username: userName }, { uuid: otherId, username: 'normal' }, { uuid: '33333333-3333-4333-8333-333333333333', username: 'small' }] } } }),
  remnaGetNodes: async () => ({ data: { response: [{ uuid: 'node', name: 'node' }] } }),
  remnaGetNodeUsersUsage: async () => ({ data: { response: { topUsers: [{ username: userName, total: 10000 }, { username: 'normal', total: 100 }, { username: 'small', total: 10 }] } } }),
} });
const { trafficAbuseRouter } = await import('../dist/modules/admin/traffic-abuse.routes.js');
const { filterExcludedTraffic } = await import('../dist/modules/admin/traffic-exclusions.js');
const app = express();
app.use(express.json(), trafficAbuseRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
after(() => new Promise(resolve => server.close(resolve)));
const base = `http://127.0.0.1:${server.address().port}`;
const request = (url, method = 'GET', role = 'ADMIN') => fetch(base + url, { method, headers: { 'x-role': role } });

test('only admins may change exclusions; authentication is required', async () => {
  assert.equal((await request('/exclusions', 'GET', '')).status, 401);
  for (const method of ['PUT', 'DELETE']) assert.equal((await request('/exclusions/' + excludedId, method, 'MANAGER')).status, 403);
  assert.equal(settings.size, 0);
});
test('rejects malformed IDs and unavailable Remnawave without storing anything', async () => {
  assert.equal((await request('/exclusions/bad', 'PUT')).status, 400);
  remnaFailed = true;
  assert.equal((await request('/exclusions/' + excludedId, 'PUT')).status, 502);
  remnaFailed = false;
  assert.equal(settings.size, 0);
});
test('excludes traffic before calculating the global average and totals', async () => {
  assert.equal((await request('/exclusions/' + excludedId, 'PUT')).status, 200);
  const response = await request('/analytics?minBytes=1');
  const data = await response.json();
  assert.equal(data.stats.totalUsers, 2);
  assert.equal(data.stats.totalTrafficPeriod, 110);
  assert.equal(data.stats.excludedUsers, 1);
  assert.deepEqual(data.abusers.map(user => user.username), ['normal']);
  assert.equal((await (await request('/exclusions')).json()).items[0].uuid, excludedId);
});
test('UUID exclusion survives rename and does not hide a different account reusing the old name', async () => {
  userName = 'renamed-service';
  const data = await (await request('/analytics?minBytes=1')).json();
  assert.equal(data.stats.totalTrafficPeriod, 110);
  const usage = new Map([['service', 20], ['renamed-service', 1000]]);
  filterExcludedTraffic(usage, [{ uuid: otherId, username: 'service' }, { uuid: excludedId, username: 'renamed-service' }], [{ uuid: excludedId, username: 'service' }]);
  assert.deepEqual([...usage], [['service', 20]]);
});
test('database failure is reported instead of silently including excluded accounts', async () => {
  dbFailed = true;
  assert.equal((await request('/analytics?minBytes=1')).status, 500);
  dbFailed = false;
});
test('removing an exclusion restores the account to analytics', async () => {
  assert.equal((await request('/exclusions/' + excludedId, 'DELETE')).status, 200);
  const data = await (await request('/analytics?minBytes=1')).json();
  assert.equal(data.stats.totalTrafficPeriod, 10110);
  assert.equal(data.stats.totalUsers, 3);
  assert.deepEqual(data.abusers.map(user => user.username), ['renamed-service']);
});

test('Remnawave 3 numeric IDs can be excluded and restored', async () => {
  numericIds = true;
  assert.equal((await request('/exclusions/2', 'PUT')).status, 200);
  const data = await (await request('/analytics?minBytes=1')).json();
  assert.equal(data.stats.excludedUsers, 1);
  assert.equal(data.stats.totalTrafficPeriod, 110);
  assert.deepEqual(data.abusers.map(user => user.username), ['normal']);
  assert.equal((await request('/exclusions/2', 'DELETE')).status, 200);
});
