import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test, after } from 'node:test';

const url = process.env.REMNA_LINK_TEST_DATABASE_URL;
if (!url || !/^issue234_test(?:_|$)/.test(new URL(url).pathname.slice(1))) throw new Error('Use a dedicated issue234_test database');
const prisma = new PrismaClient({ datasourceUrl: url });
const source = readFileSync(new URL('../dist/modules/subscription/subscription.helpers.js', import.meta.url), 'utf8');
const start = source.indexOf('export async function upsertSubscriptionByRemnaUuid');
const link = vm.runInNewContext('(' + source.slice(start).replace(/^export /, '').replace(/\/\/# sourceMappingURL=.*$/, '') + ')', { prisma, Set, Error });
const prefix = `link-${process.pid}`;
after(async () => {
  await prisma.subscription.deleteMany({ where: { ownerId: { startsWith: prefix } } });
  await prisma.client.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.$disconnect();
});
test('concurrent linking preserves one mapping, separate profiles and ownership', async () => {
  const client = await prisma.client.create({ data: { id: prefix + '-a', referralCode: prefix + '-a' } });
  const other = await prisma.client.create({ data: { id: prefix + '-b', referralCode: prefix + '-b' } });
  const uuid = prefix + '-vpn';
  await Promise.all(Array.from({ length: 8 }, () => link(client.id, { remnawaveUuid: uuid })));
  assert.equal(await prisma.subscription.count({ where: { ownerId: client.id, remnawaveUuid: uuid } }), 1);
  await link(client.id, { remnawaveUuid: prefix + '-second' });
  assert.equal(await prisma.subscription.count({ where: { ownerId: client.id } }), 2);
  await assert.rejects(() => link(other.id, { remnawaveUuid: uuid }), /another client/);
  assert.equal(await prisma.subscription.count({ where: { ownerId: other.id } }), 0);
});
