import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const source = ts.transpileModule(await readFile(new URL('../src/modules/sync/sync.service.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;

async function sync(users, initialClients = [], initialSubscriptions = []) {
  const clients = structuredClone(initialClients);
  const subscriptions = structuredClone(initialSubscriptions);
  const defaults = { remnawaveUuid: null, telegramId: null, email: null, telegramUsername: null };
  const clone = value => structuredClone(value);
  const matches = (row, where) => Object.entries(where).every(([key, condition]) => condition.in.includes(row[key]));
  function validate(client) {
    for (const key of ['telegramId', 'email']) {
      if (client[key] && clients.some(other => other.id !== client.id && other[key] === client[key])) throw new Error(`Unique ${key}`);
    }
  }
  const prisma = {
    client: {
      findMany: async ({ where }) => clone(clients.filter(client => matches(client, where))),
      create: async ({ data }) => {
        const client = { ...defaults, ...data, id: `client-${clients.length + 1}` };
        validate(client); clients.push(client); return clone(client);
      },
      update: async ({ where, data }) => {
        const index = clients.findIndex(client => client.id === where.id);
        const client = { ...clients[index], ...data };
        validate(client); clients[index] = client; return clone(client);
      },
    },
    subscription: {
      findMany: async ({ where }) => subscriptions.filter(sub => matches(sub, where)).map(sub => ({ ...clone(sub), owner: clone(clients.find(client => client.id === sub.ownerId)) })),
    },
  };
  const remna = {
    isRemnaConfigured: () => true,
    remnaGetUsers: async () => ({ data: users }),
  };
  for (const name of ['remnaGetUser', 'remnaUpdateUser', 'remnaCreateUser', 'remnaGetUserByTelegramId', 'remnaGetUserByEmail', 'remnaGetUserByUsername', 'extractRemnaUuid', 'remnaUsernameFromClient']) remna[name] = () => { throw new Error(`Unexpected ${name}`); };
  const dependencies = {
    '../../db.js': { prisma },
    '../remna/remna.client.js': remna,
    '../client/client.service.js': { getSystemConfig: async () => ({ defaultLanguage: 'ru', defaultCurrency: 'rub' }) },
    '../bot/bot.service.js': { getPrimaryBot: async () => ({ id: 'fixture-bot' }) },
    '../subscription/subscription.helpers.js': {
      upsertSubscriptionByRemnaUuid: async (ownerId, { remnawaveUuid }) => {
        const existing = subscriptions.find(sub => sub.remnawaveUuid === remnawaveUuid);
        if (existing) { assert.equal(existing.ownerId, ownerId); return clone(existing); }
        const sub = { id: `sub-${subscriptions.length + 1}`, ownerId, remnawaveUuid, subscriptionIndex: subscriptions.filter(sub => sub.ownerId === ownerId).length };
        subscriptions.push(sub); return clone(sub);
      },
    },
  };
  const context = vm.createContext({ console, setTimeout });
  const module = new vm.SourceTextModule(source, { context });
  await module.link(async specifier => {
    const exports = dependencies[specifier];
    assert.ok(exports, `Unexpected dependency ${specifier}`);
    const stub = new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context });
    await stub.link(() => {}); await stub.evaluate(); return stub;
  });
  await module.evaluate();
  const result = await module.namespace.syncFromRemna();
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  return { result, clients, subscriptions };
}

test('imports two new profiles sharing a Telegram ID into one client without dropping the secondary', async () => {
  const { result, clients, subscriptions } = await sync([{ uuid: 'vpn-a', telegramId: 123 }, { uuid: 'vpn-b', telegramId: 123 }]);
  assert.equal(result.created, 1); assert.equal(result.updated, 1);
  assert.equal(clients.length, 1); assert.equal(clients[0].remnawaveUuid, 'vpn-a');
  assert.deepEqual(subscriptions.map(sub => [sub.ownerId, sub.subscriptionIndex]), [['client-1', 0], ['client-1', 1]]);
});

test('keeps the first primary UUID when several already-linked subscriptions share an owner', async () => {
  const client = { id: 'owner', remnawaveUuid: null, telegramId: '123', email: null, telegramUsername: null };
  const { clients, subscriptions } = await sync([{ uuid: 'vpn-a', telegramId: 123 }, { uuid: 'vpn-b', telegramId: 123 }], [client], [
    { id: 'a', ownerId: 'owner', remnawaveUuid: 'vpn-a', subscriptionIndex: 0 },
    { id: 'b', ownerId: 'owner', remnawaveUuid: 'vpn-b', subscriptionIndex: 1 },
  ]);
  assert.equal(clients[0].remnawaveUuid, 'vpn-a'); assert.equal(subscriptions.length, 2);
});

test('assigns the primary only once when an existing client has no subscription records', async () => {
  const { clients, subscriptions } = await sync([{ uuid: 'vpn-a', telegramId: 123 }, { uuid: 'vpn-b', telegramId: 123 }], [
    { id: 'owner', remnawaveUuid: null, telegramId: '123', email: null, telegramUsername: null },
  ]);
  assert.equal(clients[0].remnawaveUuid, 'vpn-a');
  assert.deepEqual(subscriptions.map(sub => sub.remnawaveUuid), ['vpn-a', 'vpn-b']);
});

test('releases old email lookup after an identity update within the same page', async () => {
  const { clients, subscriptions } = await sync([{ uuid: 'vpn-a', email: 'new@example.test' }, { uuid: 'vpn-b', email: 'old@example.test' }], [
    { id: 'owner', remnawaveUuid: 'vpn-a', telegramId: null, email: 'old@example.test', telegramUsername: null },
  ]);
  assert.equal(clients.length, 2);
  assert.equal(clients.find(client => client.id === 'owner').email, 'new@example.test');
  assert.notEqual(subscriptions[0].ownerId, subscriptions[1].ownerId);
});

test('imports repeated UUIDs without creating a second client or moving their subscription', async () => {
  const { clients, subscriptions } = await sync([{ uuid: 'vpn-a' }, { uuid: 'vpn-a' }]);
  assert.equal(clients.length, 1); assert.equal(subscriptions.length, 1);
});
