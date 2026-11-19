import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { test } from 'node:test';
import { z } from 'zod';
import { diskUsageFromStats, backupDiskLine, getBackupDiskUsage } from '../dist/modules/backup/backup-disk.js';

function source(path) {
  return ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
}
function evaluate(node, ast, globals) {
  const js = ts.transpileModule('(' + node.getText(ast).replace(/^export\s+/, '') + ')', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return vm.runInNewContext(js, globals);
}
function func(path, name, globals) {
  const ast = source(path);
  const node = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.ok(node, name);
  return evaluate(node, ast, globals);
}
function route(path, method, url, globals) {
  const ast = source(path);
  const statement = ast.statements.find(n => ts.isExpressionStatement(n) && ts.isCallExpression(n.expression)
    && n.expression.expression.name?.text === method && n.expression.arguments[0]?.text === url);
  assert.ok(statement, `${method} ${url}`);
  let node = statement.expression.arguments.at(-1);
  if (ts.isCallExpression(node)) node = node.arguments[0];
  return evaluate(node, ast, globals);
}
function response() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

test('disabled marketplace permits its authenticated settings controls but blocks other operations', async () => {
  const guard = func('../src/app.ts', 'requireMarketplaceEnabled', { getMarketplaceRuntime: async () => ({ enabled: false }) });
  for (const [method, path, permitted] of [['GET', '/status', true], ['PATCH', '/settings', true], ['POST', '/connect', false], ['GET', '/settings', false]]) {
    const res = response(); let passed = false;
    await guard({ method, path }, res, () => { passed = true; });
    assert.equal(passed, permitted);
    assert.equal(res.statusCode, permitted ? 200 : 404);
  }
  const router = readFileSync(new URL('../src/modules/marketplace/marketplace.client.routes.ts', import.meta.url), 'utf8');
  assert.match(router, /marketplaceClientRouter\.use\(requireAuth\)/);
});

test('backup disk usage accounts for reserved blocks without reporting them as used', async () => {
  const usage = diskUsageFromStats({ blocks: 100, bfree: 70, bavail: 65, bsize: 1024 ** 3 });
  assert.equal(usage.usedPercent, 30);
  assert.equal(usage.availableBytes, 65 * 1024 ** 3);
  assert.match(backupDiskLine(usage), /30.0 ГБ из 100.0 ГБ \(30%\), доступно 65.0 ГБ/);
  assert.equal(diskUsageFromStats({ blocks: 0, bfree: 0, bavail: 0, bsize: 4096 }), null);
  assert.equal(await getBackupDiskUsage('/nonexistent-maintenance-test/dump.sql.gz'), null);
  assert.match(backupDiskLine(null), /нет данных/);
});

test('only a confirmed 404 means the remote profile is missing', () => {
  const missing = func('../src/modules/remna/remna.client.ts', 'isRemnaNotFoundError', {});
  assert.equal(missing(404), true);
  for (const status of [400, 401, 403, 429, 500, 503]) assert.equal(missing(status, 'user not found'), false);
});

const secondaryPath = '../src/modules/admin/secondary-subscriptions.routes.ts';
function deletion({ configured = true, remoteStatus = 200, shared = false } = {}) {
  const subscriptions = [{ id: 'one', ownerId: 'owner', remnawaveUuid: 'vpn' }];
  let remoteCalls = 0;
  const history = [], removed = [];
  const db = {
    client: { updateMany: async () => ({ count: 1 }) },
    subscription: {
      findUnique: async () => subscriptions[0], findMany: async () => subscriptions,
      delete: async ({ where }) => removed.push(where.id),
      deleteMany: async ({ where }) => removed.push(...where.id.in),
    },
    giftHistory: { create: async ({ data }) => history.push(data), createMany: async ({ data }) => history.push(...data) },
  };
  db.$transaction = async callback => callback(db);
  const globals = {
    prisma: db, console, isRemnaConfigured: () => configured, remnaUuidInUse: async () => shared,
    remnaDeleteUser: async () => { remoteCalls++; return remoteStatus === 200 ? { status: 200 } : { status: remoteStatus, error: 'remote failure' }; },
    isRemnaNotFoundError: status => status === 404, normalizeClientSubscriptionSlots: async () => {},
  };
  return { globals, history, removed, calls: () => remoteCalls };
}

test('bulk delete is routed before the dynamic subscription ID', () => {
  const s = readFileSync(new URL(secondaryPath, import.meta.url), 'utf8');
  assert.ok(s.indexOf('.delete("/bulk"') < s.indexOf('.delete("/:id"'));
});
for (const bulk of [false, true]) {
  for (const remoteStatus of [400, 503]) test(`${bulk ? 'bulk' : 'single'} delete preserves local mapping when Remna answers ${remoteStatus}`, async () => {
    const t = deletion({ remoteStatus }), res = response();
    await route(secondaryPath, 'delete', bulk ? '/bulk' : '/:id', t.globals)({ params: { id: 'one' }, query: { deleteRemnaUser: 'true' }, body: { ids: ['one'] } }, res);
    assert.equal(t.removed.length, 0);
    assert.equal(t.history.length, 0);
    if (bulk) assert.deepEqual(Array.from(res.body.failedIds), ['one']);
    else assert.ok(res.statusCode >= 400);
  });
  test(`${bulk ? 'bulk' : 'single'} default deletion leaves Remna alone and records the detached UUID`, async () => {
    const t = deletion(), res = response();
    await route(secondaryPath, 'delete', bulk ? '/bulk' : '/:id', t.globals)({ params: { id: 'one' }, query: {}, body: { ids: ['one'] } }, res);
    assert.deepEqual(t.removed, ['one']);
    assert.equal(t.calls(), 0);
    assert.equal(t.history[0].metadata.remnawaveUuid, 'vpn');
  });
  test(`${bulk ? 'bulk' : 'single'} explicit remote deletion preserves shared profiles`, async () => {
    const t = deletion({ shared: true }), res = response();
    await route(secondaryPath, 'delete', bulk ? '/bulk' : '/:id', t.globals)({ params: { id: 'one' }, query: { deleteRemnaUser: 'true' }, body: { ids: ['one'] } }, res);
    assert.deepEqual(t.removed, ['one']);
    assert.equal(t.calls(), 0);
  });
}

for (const scenario of ['first', 'existing', 'concurrent']) test(`setting the first password: ${scenario}`, async () => {
  let stored = scenario === 'existing' ? 'old-hash' : null;
  const handler = route('../src/modules/client/client-profile.routes.ts', 'post', '/set-password', {
    setPasswordSchema: z.object({ newPassword: z.string().min(6) }),
    canSetPasswordWithoutCurrent: value => !value?.trim(),
    hashPassword: async () => { if (scenario === 'concurrent') stored = 'concurrent-hash'; return 'new-hash'; },
    prisma: { client: {
      findUnique: async () => ({ passwordHash: stored }),
      updateMany: async ({ where, data }) => {
        if (stored !== where.passwordHash) return { count: 0 };
        stored = data.passwordHash; return { count: 1 };
      },
    } },
  });
  const res = response();
  await handler({ client: { id: 'owner' }, body: { newPassword: 'secret-password' } }, res);
  assert.equal(stored, scenario === 'first' ? 'new-hash' : scenario === 'existing' ? 'old-hash' : 'concurrent-hash');
  assert.equal(res.statusCode, scenario === 'first' ? 200 : scenario === 'existing' ? 400 : 409);
});

test('card withdrawals require bank and recipient before debiting and retain both in the request', async () => {
  const path = '../src/modules/client/client-referrals.routes.ts';
  const ast = source(path);
  const declaration = ast.statements.filter(ts.isVariableStatement).flatMap(s => Array.from(s.declarationList.declarations)).find(n => n.name.text === 'withdrawCreateSchema');
  const schema = evaluate(declaration.initializer, ast, { z });
  let debits = 0, saved;
  const db = {
    client: { updateMany: async () => { debits++; return { count: 1 }; } },
    withdrawalRequest: { create: async ({ data }) => { saved = data; return { id: 'withdrawal', status: 'PENDING' }; } },
  };
  db.$transaction = async callback => callback(db);
  const handler = route(path, 'post', '/withdrawals', {
    withdrawCreateSchema: schema, prisma: db, console,
    getSystemConfig: async () => ({ withdrawalMinAmount: 100, withdrawalMethods: ['card'] }),
    normalizeCardDetails: raw => raw.replace(/\s/g, ''),
  });
  for (const extra of [{}, { bankName: 'Bank' }, { recipientName: 'User' }]) {
    const res = response();
    await handler({ clientId: 'owner', body: { amount: 100, method: 'card', details: '4111111111111111', ...extra } }, res);
    assert.equal(res.statusCode, 400);
  }
  assert.equal(debits, 0);
  const res = response();
  await handler({ clientId: 'owner', body: { amount: 100, method: 'card', details: '4111111111111111', bankName: ' Bank ', recipientName: ' User ' } }, res);
  assert.equal(debits, 1);
  assert.equal(saved.bankName, 'Bank');
  assert.equal(saved.recipientName, 'User');
  assert.equal(res.body.bankName, 'Bank');
});
