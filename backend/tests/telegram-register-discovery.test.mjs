import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = await readFile(new URL('../src/modules/client/client-auth.routes.ts', import.meta.url), 'utf8');
const tree = ts.createSourceFile('routes.ts', source, ts.ScriptTarget.Latest, true);
let callback;
function walk(node) {
  if (ts.isCallExpression(node) && node.expression.getText(tree) === 'clientAuthRouter.post' && node.arguments[0]?.text === '/register') callback = node.arguments[1].getText(tree);
  ts.forEachChild(node, walk);
}
walk(tree);
assert.ok(callback);
const compiled = ts.transpileModule(`(${callback})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
class CheckError extends Error { constructor(status) { super(status === 409 ? 'Привяжите Telegram в профиле' : 'Недоступно'); this.status = status; } }

async function run({ existing = true, lookupError, conflict = false, ids = ['vpn-a', 'vpn-b'], authenticated = true } = {}) {
  let record = existing ? { id: 'existing', telegramId: '123', remnawaveUuid: 'vpn-a', isBlocked: false, trialUsed: false } : null;
  let created = 0, checks = 0; const restored = [];
  const context = {
    Error, Object, TelegramSubscriptionCheckError: CheckError,
    registerSchema: { safeParse: req => ({ success: true, data: req }) },
    resolveRegisterRoute: () => 'telegram',
    resolveBotForClientRequest: async () => ({ id: 'bot' }),
    extractBotTokenFromRequest: () => authenticated ? 'valid' : null,
    getBotByToken: async () => authenticated ? { id: 'bot' } : null,
    asClientWhere: value => value,
    asClientUncheckedCreate: value => value,
    signClientToken: id => `token-for-${id}`,
    toClientShape: value => value,
    getSystemConfig: async () => ({ blacklistEnabled: false }),
    findTelegramSubscriptions: async () => { checks++; if (lookupError) throw new CheckError(lookupError); return ids; },
    checkTelegramSubscriptionOwners: async () => { if (conflict) throw new CheckError(409); },
    restoreTelegramSubscriptions: async (client, found) => {
      restored.push([...found]);
      if (conflict) throw new CheckError(409);
      if (!record.remnawaveUuid && found.length) record.remnawaveUuid = found[0];
    },
    prisma: { client: {
      findFirst: async () => record,
      findUniqueOrThrow: async () => ({ remnawaveUuid: record.remnawaveUuid, trialUsed: record.trialUsed }),
      create: async ({ data }) => { created++; record = { id: 'new', ...data }; return record; },
    } },
    generateReferralCode: () => 'fixture', getRequestIp: () => null,
    notifyAdminsAboutNewClient: async () => {},
  };
  const handler = vm.runInNewContext(compiled, context);
  const response = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ body: { telegramId: '123', preferredLang: 'ru', preferredCurrency: 'rub' }, headers: {} }, response);
  return { ...response, created, restored, record, checks };
}

test('every start checks remote profiles even when the client already has a primary', async () => {
  const result = await run();
  assert.equal(result.code, 200);
  assert.equal(result.checks, 1);
  assert.deepEqual(result.restored, [['vpn-a', 'vpn-b']]);
  assert.equal(result.body.client.id, 'existing');
  assert.equal(result.body.subscriptionCheckPending, false);
  assert.equal(result.created, 0);
});

test('new Telegram client imports every verified profile before authentication completes', async () => {
  const result = await run({ existing: false });
  assert.equal(result.code, 201);
  assert.deepEqual(result.restored, [['vpn-a', 'vpn-b']]);
  assert.equal(result.body.client.remnawaveUuid, 'vpn-a');
  assert.equal(result.body.isNewClient, true);
});

test('remote outage preserves access to independent services but marks VPN discovery as pending', async () => {
  for (const existing of [false, true]) {
    const result = await run({ existing, lookupError: 503 });
    assert.equal(result.code, existing ? 200 : 201);
    assert.equal(result.body.subscriptionCheckPending, true);
    assert.ok(result.body.token);
    assert(!result.restored.some(ids => ids.length));
  }
});

test('ownership conflict never creates or authenticates a duplicate website account', async () => {
  for (const existing of [false, true]) {
    const result = await run({ existing, conflict: true });
    assert.equal(result.code, 409);
    assert.equal(result.body.token, undefined);
    assert.equal(result.created, 0);
  }
});

test('unauthenticated requests cannot query Telegram profiles', async () => {
  const result = await run({ authenticated: false });
  assert.equal(result.code, 401);
  assert.equal(result.checks, 0);
  assert.equal(result.created, 0);
});
