import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { test } from 'node:test';

function loadFunction(path, name, globals) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const node = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(node);
  const compiled = ts.transpileModule('(' + node.getText(ast).replace(/^export\s+/, '') + ')', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return vm.runInNewContext(compiled, globals);
}

for (const scenario of ['read-timeout', 'update-failure', 'lookup-failure', 'linked-profile', 'imported-primary', 'gift', 'new', 'legacy']) {
  test(scenario, async () => {
    let created = 0;
    let updated = 0;
    let stored;
    const existing = scenario === 'imported-primary';
    const rootUuid = ['read-timeout', 'update-failure', 'linked-profile', 'legacy'].includes(scenario) ? 'legacy-vpn' : null;
    const create = loadFunction('../src/modules/gift/gift.service.ts', 'createAdditionalSubscription', {
      console, Date, Math, Set,
      isRemnaConfigured: () => true,
      getSystemConfig: async () => ({ giftSubscriptionsEnabled: true, maxAdditionalSubscriptions: 10 }),
      getNextSubscriptionIndex: async (_, min = 0) => existing ? 1 : min,
      prisma: {
        client: { findUnique: async () => ({ id: 'client', telegramId: '123', remnawaveUuid: rootUuid }), findFirst: async () => null, update: async () => ({}) },
        subscription: { count: async () => existing ? 1 : 0, findFirst: async () => scenario === 'linked-profile' ? { id: 'other' } : null, create: async ({ data }) => { stored = data; return { id: 'new-sub' }; } },
      },
      remnaGetUserByTelegramId: async () => scenario === 'lookup-failure' ? { status: 503, error: 'offline' } : { status: 200, data: { users: [] } },
      remnaGetUser: async () => scenario === 'read-timeout' ? { status: 504, error: 'timeout' } : { status: 200, data: { uuid: rootUuid } },
      remnaUpdateUser: async () => { updated++; return scenario === 'update-failure' ? { status: 503, error: 'offline' } : { status: 200 }; },
      remnaCreateUser: async () => { created++; return { status: 200, data: { uuid: 'new-vpn' } }; },
      extractRemnaUuid: data => data?.uuid,
      extractCurrentExpireAt: () => new Date(Date.now() + 86400000),
      extractCurrentSquads: () => [],
      secondaryRemnaUsername: () => 'user_123', logGiftEvent: async () => {},
    });
    const result = await create('client', { id: 'tariff', durationDays: 30, trafficLimitBytes: null, deviceLimit: 2, internalSquadUuids: ['squad'] }, { purchasedAsGift: scenario === 'gift' });
    if (['read-timeout', 'update-failure', 'lookup-failure', 'linked-profile'].includes(scenario)) {
      assert.equal(result.ok, false);
      assert.equal(created, 0);
      assert.equal(stored, undefined);
    } else {
      assert.equal(result.ok, true);
      assert.equal(created, scenario === 'legacy' ? 0 : 1);
      assert.equal(updated, scenario === 'legacy' ? 1 : 0);
      assert.equal(stored.subscriptionIndex, existing || scenario === 'gift' ? 1 : 0);
      assert.equal(stored.remnawaveUuid, scenario === 'legacy' ? 'legacy-vpn' : 'new-vpn');
    }
  });
}

test('sync retains primary reference when importing another profile for the same Telegram user', async () => {
  const client = { id: 'client', telegramId: '123', remnawaveUuid: 'primary', telegramUsername: 'user' };
  const linked = [];
  const sync = loadFunction('../src/modules/sync/sync.service.ts', 'syncFromRemna', {
    Date, Math, String, PAGE_SIZE: 100,
    isRemnaConfigured: () => true, getSystemConfig: async () => ({}), getPrimaryBot: async () => ({}),
    remnaGetUsers: async () => ({ data: [{ uuid: 'primary', telegramId: 123 }, { uuid: 'secondary', telegramId: 123 }] }),
    extractRemnaUsers: data => data,
    prisma: {
      subscription: { findFirst: async () => null },
      client: {
        findFirst: async ({ where }) => where.id?.not ? null : (where.telegramId === '123' || where.remnawaveUuid === client.remnawaveUuid ? { ...client } : null),
        update: async ({ data }) => Object.assign(client, data),
      },
    },
    upsertSubscriptionByRemnaUuid: async (_, { remnawaveUuid }) => linked.push(remnawaveUuid),
  });
  const result = await sync();
  assert.equal(result.ok, true);
  assert.equal(client.remnawaveUuid, 'primary');
  assert.deepEqual(linked, ['primary', 'secondary']);
});
