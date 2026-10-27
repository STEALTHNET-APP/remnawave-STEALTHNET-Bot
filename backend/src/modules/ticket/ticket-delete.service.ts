import { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import { deleteTicketAttachments } from "./attachments.js";

export async function deleteTickets(where: Prisma.TicketWhereInput, take?: number): Promise<number> {
  const candidates = await prisma.ticket.findMany({ where, select: { id: true }, orderBy: { id: "asc" }, take });
  if (!candidates.length) return 0;
  const removed = await prisma.$transaction(async tx => {
    const ids = candidates.map(ticket => ticket.id);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM tickets WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`);
    const tickets = await tx.ticket.findMany({
      where: { AND: [where, { id: { in: ids } }] },
      include: { messages: { select: { attachments: true } } },
    });
    const result = await tx.ticket.deleteMany({ where: { id: { in: tickets.map(ticket => ticket.id) } } });
    return { count: result.count, attachments: tickets.flatMap(ticket => ticket.messages.map(message => message.attachments)) };
  }, { timeout: 30_000 });
  await deleteTicketAttachments(removed.attachments);
  return removed.count;
}
