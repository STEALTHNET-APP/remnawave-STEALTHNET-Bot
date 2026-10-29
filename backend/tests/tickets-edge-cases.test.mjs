import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
if (process.env.RELEASE682_TEST_DATABASE !== '1' || !new URL(process.env.DATABASE_URL).pathname.includes('updaterqa')) throw Error('Isolated updaterqa database required');
const { prisma } = await import('../dist/db.js');
const { signAccessToken } = await import('../dist/modules/auth/auth.service.js');
const { signClientToken } = await import('../dist/modules/client/client.service.js');
const admin = await prisma.admin.findFirstOrThrow();
const token = signAccessToken({ adminId: admin.id, email: admin.email }, process.env.JWT_SECRET, '10m');
const client = await prisma.client.create({ data: { email: `http-${randomUUID()}@example.invalid` } });
const other = await prisma.client.create({ data: { email: `other-${randomUUID()}@example.invalid` } });
const base = 'http://127.0.0.1:5000/api';
async function request(route, body, method = 'POST', credential = token) {
  const form = body instanceof FormData;
  const response = await fetch(base + route, { method, headers: { Authorization: `Bearer ${credential}`, ...(form ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : form ? body : JSON.stringify(body) });
  const data = await response.json();
  return { status: response.status, data };
}
const ids = [];
try {
  const settings = await request('/admin/settings', { ticketsEnabled: true, ticketRetentionValue: 0, backupRetentionValue: 0, backupRetentionUnit: 'hours' }, 'PATCH');
  assert.equal(settings.status, 200, JSON.stringify(settings.data));
  for (const status of ['open', 'closed']) ids.push((await prisma.ticket.create({ data: { clientId: client.id, subject: 'API fixture', status, closedAt: status === 'closed' ? new Date('2026-10-20') : null } })).id);
  await test('bulk status is idempotent and preserves the old close date', async () => {
    const before = await prisma.ticket.findUniqueOrThrow({ where: { id: ids[1] } });
    const result = await request('/admin/tickets/bulk-status', { ticketIds: ids, status: 'closed' });
    assert.equal(result.status, 200);
    const after = await prisma.ticket.findUniqueOrThrow({ where: { id: ids[1] } });
    assert.equal(after.closedAt.getTime(), before.closedAt.getTime());
    const openAfter = await prisma.ticket.findUniqueOrThrow({ where: { id: ids[0] } });
    assert.equal(openAfter.status, 'closed');
    assert.ok(openAfter.closedAt instanceof Date);
  });
  await test('bulk reply reopens all recipients and creates one message per ticket', async () => {
    const form = new FormData();
    form.append('ticketIds', JSON.stringify([...ids, ids[0]]));
    form.append('content', 'Support reply');
    form.append('closeAfterReply', 'false');
    const result = await request('/admin/tickets/bulk-reply', form);
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.count, 2);
    for (const id of ids) {
      const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id }, include: { messages: true } });
      assert.equal(ticket.status, 'open');
      assert.equal(ticket.closedAt, null);
      assert.equal(ticket.messages.length, 1);
    }
  });
  await test('bulk reply with boolean closeAfterReply in JSON closes all tickets and records closedAt', async () => {
    const result = await request('/admin/tickets/bulk-reply', {
      ticketIds: ids,
      content: 'Mass response with closing',
      closeAfterReply: true,
    });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.closedAfterReply, true);
    for (const id of ids) {
      const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id } });
      assert.equal(ticket.status, 'closed');
      assert.ok(ticket.closedAt instanceof Date);
    }
  });
  await test('client reply atomically reopens a closed ticket; another client cannot delete it', async () => {
    await request('/admin/tickets/bulk-status', { ticketIds: [ids[0]], status: 'closed' });
    const form = new FormData(); form.append('content', 'Still need help');
    const reply = await request(`/client/tickets/${ids[0]}/messages`, form, 'POST', signClientToken(client.id));
    assert.equal(reply.status, 201, JSON.stringify(reply.data));
    assert.equal((await prisma.ticket.findUniqueOrThrow({ where: { id: ids[0] } })).status, 'open');
    const denied = await request(`/client/tickets/${ids[0]}`, undefined, 'DELETE', signClientToken(other.id));
    assert.equal(denied.status, 404);
  });
  await test('delete closed leaves open tickets intact and rejects invalid scope', async () => {
    assert.equal((await request('/admin/tickets/delete-all', { scope: 'invalid' })).status, 400);
    const result = await request('/admin/tickets/delete-all', { scope: 'closed' });
    assert.equal(result.status, 200);
    assert.equal(await prisma.ticket.count({ where: { id: { in: ids } } }), 2);
  });
  await test('backup deletion requires explicit confirmation and settings round-trip', async () => {
    assert.equal((await request('/admin/backup/delete-all', {})).status, 400);
    const config = await request('/admin/settings', undefined, 'GET');
    assert.equal(config.data.backupRetentionValue, 0);
    assert.equal(config.data.backupRetentionUnit, 'hours');
    assert.equal(config.data.ticketRetentionValue, 0);
  });
} finally {
  await prisma.client.deleteMany({ where: { id: { in: [client.id, other.id] } } });
  await prisma.$disconnect();
}
