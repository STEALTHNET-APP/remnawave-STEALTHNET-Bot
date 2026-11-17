import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const source = ts.transpileModule(await readFile(new URL('../src/modules/client/telegram-subscriptions.service.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const user = (uuid, telegramId = 123) => ({ uuid, telegramId });
const page = (users, hasMore = false, nextCursor = null) => ({ status: 200, data: { response: { users, hasMore, nextCursor } } });
const remote = (remnawaveUuid, status = 'ACTIVE', expireAt = null) => ({ remnawaveUuid, status, expireAt });

async function setup({ responses = [page([])], configured = true, clients = [], subscriptions = [], race = false, history = [], remotes = {} } = {}) {
  clients = structuredClone(clients); subscriptions = structuredClone(subscriptions);
  const requests = [], writes = [];
  const db = {
    client: {
      findMany: async ({ where }) => clients.filter(c => where.remnawaveUuid.in.includes(c.remnawaveUuid)),
      updateMany: async ({ where, data }) => {
        writes.push(data);
        for (const client of clients) if (client.id === where.id && client.remnawaveUuid === null) Object.assign(client, data);
      },
    },
    subscription: {
      findMany: async ({ where }) => subscriptions.filter(s =>
        where.ownerId ? s.ownerId === where.ownerId : where.remnawaveUuid.in.includes(s.remnawaveUuid)),
    },
    giftHistory: { findMany: async () => structuredClone(history) },
  };
  const dependencies = {
    '../../db.js': { prisma: db },
    '../remna/remna.client.js': {
      isRemnaConfigured: () => configured,
      remnaFetch: async path => { requests.push(path); assert.ok(responses.length, 'unexpected request'); return responses.shift(); },
      remnaGetUser: async uuid => remotes[uuid] ?? { status: 404, error: 'not found' },
      extractRemnaUuid: value => value?.uuid ?? (value?.id == null ? null : String(value.id)),
    },
    '../subscription/subscription.helpers.js': {
      upsertSubscriptionByRemnaUuid: async (ownerId, { remnawaveUuid }) => {
        if (race) throw new Error('VPN profile belongs to another client');
        const existing = subscriptions.find(s => s.remnawaveUuid === remnawaveUuid);
        if (existing) { assert.equal(existing.ownerId, ownerId); return existing; }
        const used = subscriptions.filter(s => s.ownerId === ownerId).map(s => s.subscriptionIndex);
        let subscriptionIndex = 0; while (used.includes(subscriptionIndex)) subscriptionIndex++;
        subscriptions.push({ ownerId, remnawaveUuid, subscriptionIndex, tariffId: null });
      },
    },
  };
  const context = vm.createContext({ URLSearchParams, Error });
  const module = new vm.SourceTextModule(source, { context });
  await module.link(async key => {
    const exports = dependencies[key]; assert.ok(exports, key);
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
    }, { context });
  });
  await module.evaluate();
  return { ...module.namespace, requests, clients, subscriptions, writes };
}

test('loads every matching profile across cursor pages and deduplicates IDs', async () => {
  const t = await setup({ responses: [page([user('first'), user('second')], true, '42'), page([user('second'), { id: 99, telegramId: '123' }])] });
  assert.deepEqual(Array.from(await t.findTelegramSubscriptions('123')).map(sub => sub.remnawaveUuid), ['first', 'second', '99']);
  assert.equal(t.requests[0], '/api/users/stream?telegramId=123&size=100');
  assert.match(t.requests[1], /cursor=42/);
});

test('old Remna uses its Telegram lookup endpoint and accepts an explicit empty result', async () => {
  for (const status of [400, 404]) {
    const t = await setup({ responses: [{ status, error: 'old route' }, { status: 200, data: { response: [user('old')] } }] });
    assert.deepEqual(Array.from(await t.findTelegramSubscriptions('123')).map(sub => sub.remnawaveUuid), ['old']);
    assert.equal(t.requests[1], '/api/users/by-telegram-id/123');
  }
  const empty = await setup({ responses: [{ status: 404 }, { status: 200, data: { response: [] } }] });
  assert.deepEqual(Array.from(await empty.findTelegramSubscriptions('123')), []);
});

test('network and authorization failures never become a successful empty lookup', async () => {
  for (const status of [401, 403, 429, 500, 503, 504]) {
    const t = await setup({ responses: [{ status, error: 'private provider error' }] });
    await assert.rejects(t.findTelegramSubscriptions('123'), error => error.status === 503 && !error.message.includes('private'));
    assert.equal(t.requests.length, 1);
    assert.equal(t.writes.length, 0);
  }
});

test('rejects an ignored filter, missing identity, malformed pages and repeated cursors', async () => {
  for (const data of [null, {}, { response: null }, { response: { users: {} } }, { response: { users: [user('other', 456)], hasMore: false } },
    { response: { users: [{ uuid: 'unknown' }], hasMore: false } }, { response: { users: [null], hasMore: false } },
    { response: { users: [], hasMore: true, nextCursor: null } }]) {
    const t = await setup({ responses: [{ status: 200, data }] });
    await assert.rejects(t.findTelegramSubscriptions('123'), error => error.status === 503);
  }
  const loop = await setup({ responses: [page([], true, '1'), page([], true, '1')] });
  await assert.rejects(loop.findTelegramSubscriptions('123'), error => error.status === 503);
});

test('imports all profiles on repeated starts without changing the primary or existing tariff', async () => {
  const client = { id: 'owner', remnawaveUuid: 'primary', trialUsed: false };
  const t = await setup({ clients: [client], subscriptions: [{ ownerId: 'owner', remnawaveUuid: 'primary', subscriptionIndex: 0, tariffId: 'paid' }] });
  await t.restoreTelegramSubscriptions(client, [remote('second'), remote('primary')]);
  await t.restoreTelegramSubscriptions(client, [remote('primary'), remote('second')]);
  assert.equal(t.subscriptions.length, 2);
  assert.equal(t.subscriptions[0].tariffId, 'paid');
  assert.equal(t.clients[0].remnawaveUuid, 'primary');
  assert.equal(t.clients[0].trialUsed, false);
});

test('restores the legacy primary before importing additional profiles', async () => {
  const client = { id: 'owner', remnawaveUuid: 'primary' };
  const t = await setup({ clients: [client] });
  await t.restoreTelegramSubscriptions(client, [remote('second')]);
  assert.deepEqual(t.subscriptions.map(s => [s.remnawaveUuid, s.subscriptionIndex]), [['primary', 0], ['second', 1]]);
});

test('does not adopt a website account or move its VPN profile', async () => {
  for (const foreign of [
    { subscriptions: [{ ownerId: 'website-owner', remnawaveUuid: 'vpn' }] },
    { clients: [{ id: 'website-owner', remnawaveUuid: 'vpn' }] },
  ]) {
    const t = await setup(foreign);
    await assert.rejects(t.checkTelegramSubscriptionOwners(['vpn']), error => error.status === 409);
    await assert.rejects(t.restoreTelegramSubscriptions({ id: 'telegram-owner', remnawaveUuid: null }, [remote('vpn')]), error => error.status === 409);
    assert.equal(t.writes.length, 0);
  }
});

test('ownership conflict during import never assigns the primary UUID', async () => {
  const client = { id: 'owner', remnawaveUuid: null };
  const t = await setup({ clients: [client], race: true });
  await assert.rejects(t.restoreTelegramSubscriptions(client, [remote('vpn')]), error => error.status === 409);
  assert.equal(t.clients[0].remnawaveUuid, null);
});

test('expired and disabled Remna profiles are not restored as new slots', async () => {
  const client = { id: 'owner', remnawaveUuid: null };
  const t = await setup({
    clients: [client],
    subscriptions: [{ ownerId: 'owner', remnawaveUuid: 'active', subscriptionIndex: 0, tariffId: 'paid', expireAt: new Date(Date.now() + 86_400_000) }],
  });
  await t.restoreTelegramSubscriptions(client, [
    remote('active'),
    remote('expired', 'EXPIRED'),
    remote('disabled', 'DISABLED'),
    remote('past', 'ACTIVE', new Date(Date.now() - 86_400_000).toISOString()),
  ]);
  assert.deepEqual(t.subscriptions.map(sub => sub.remnawaveUuid), ['active']);
});

test('a first login keeps only the freshest profile when every Remna profile is dead', async () => {
  const client = { id: 'owner', remnawaveUuid: null };
  const t = await setup({ clients: [client] });
  await t.restoreTelegramSubscriptions(client, [
    remote('older', 'EXPIRED', new Date(Date.now() - 86_400_000).toISOString()),
    remote('newer', 'EXPIRED', new Date(Date.now() - 3_600_000).toISOString()),
    remote('oldest', 'EXPIRED', new Date(Date.now() - 172_800_000).toISOString()),
  ]);
  assert.deepEqual(t.subscriptions.map(sub => sub.remnawaveUuid), ['newer']);
});

test('profiles deleted or unlinked by an administrator are not resurrected on login', async () => {
  const client = { id: 'owner', remnawaveUuid: null };
  const t = await setup({
    clients: [client],
    history: [
      { metadata: { deletedBy: 'admin', remnawaveUuid: 'deleted' } },
      { metadata: { unlinkedBy: 'admin', remnawaveUuid: 'unlinked' } },
      { metadata: { deletedBy: 'client', remnawaveUuid: 'client-choice' } },
    ],
  });
  await t.restoreTelegramSubscriptions(client, [remote('deleted'), remote('unlinked'), remote('client-choice')]);
  assert.deepEqual(t.subscriptions.map(sub => sub.remnawaveUuid), ['client-choice']);
});

test('installations without Remna do not call its API', async () => {
  const t = await setup({ configured: false });
  assert.deepEqual(Array.from(await t.findTelegramSubscriptions('123')), []);
  assert.equal(t.requests.length, 0);
});
