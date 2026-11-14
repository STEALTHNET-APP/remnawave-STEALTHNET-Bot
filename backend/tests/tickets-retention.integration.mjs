import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access, writeFile, rm } from 'node:fs/promises';
import { test } from 'node:test';
if (process.env.RELEASE682_TEST_DATABASE !== '1' || !new URL(process.env.DATABASE_URL).pathname.includes('updaterqa')) throw Error('Isolated updaterqa database required');
const { prisma } = await import('../dist/db.js');
const { deleteTickets } = await import('../dist/modules/ticket/ticket-delete.service.js');
const client = await prisma.client.create({ data: { email: `tickets-${randomUUID()}@example.invalid` } });
const past = new Date(Date.now() - 2 * 86400000);
const where = { clientId: client.id, status: 'closed', closedAt: { lte: new Date(Date.now() - 86400000) } };
const exists = p => access(p).then(() => true, () => false);
const filename = `${randomUUID()}.png`;
const file = `/app/uploads/tickets/${filename}`;
try {
  await test('a ticket reopened after candidate selection is not deleted', async () => {
    const ticket = await prisma.ticket.create({ data: { clientId: client.id, subject: 'race', status: 'closed', closedAt: past } });
    const original = prisma.ticket.findMany;
    let intercepted = false;
    prisma.ticket.findMany = async function(args) {
      const rows = await original.call(this, args);
      if (!intercepted) { intercepted = true; await prisma.ticket.update({ where: { id: ticket.id }, data: { status: 'open', closedAt: null } }); }
      return rows;
    };
    try { assert.equal(await deleteTickets(where, 500), 0); }
    finally { prisma.ticket.findMany = original; }
    assert.equal((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).status, 'open');
  });
  await test('shared bulk attachments remain until their final ticket is removed', async () => {
    await writeFile(file, 'image fixture');
    const attachments = JSON.stringify([{ url: `/api/uploads/tickets/${filename}`, mime: 'image/png', size: 13 }]);
    const tickets = [];
    for (let i = 0; i < 2; i++) tickets.push(await prisma.ticket.create({ data: { clientId: client.id, subject: 'shared', messages: { create: { authorType: 'support', content: 'reply', attachments } } } }));
    assert.equal(await deleteTickets({ id: tickets[0].id }), 1);
    assert.ok(await exists(file));
    assert.equal(await deleteTickets({ id: tickets[1].id }), 1);
    assert.equal(await exists(file), false);
  });
  await test('expired closed tickets are deleted but open and recent tickets stay', async () => {
    await prisma.ticket.create({ data: { clientId: client.id, subject: 'expired', status: 'closed', closedAt: past } });
    const recent = await prisma.ticket.create({ data: { clientId: client.id, subject: 'recent', status: 'closed', closedAt: new Date() } });
    assert.equal(await deleteTickets(where, 500), 1);
    assert.ok(await prisma.ticket.findUnique({ where: { id: recent.id } }));
  });
} finally {
  await prisma.client.delete({ where: { id: client.id } });
  await rm(file, { force: true });
  await prisma.$disconnect();
}
