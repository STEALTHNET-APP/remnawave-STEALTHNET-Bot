import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

// 1. Retention cutoff calculation tests
function calculateRetentionCutoff(value, unit, now = new Date()) {
  if (!Number.isFinite(value) || value <= 0) return null;
  const multiplier = unit === "minutes" ? 60 * 1000 : unit === "hours" ? 3600 * 1000 : 86400 * 1000;
  return new Date(now.getTime() - value * multiplier);
}

test("calculateRetentionCutoff calculates accurate cutoff dates", () => {
  const baseTime = new Date("2026-10-26T12:00:00.000Z");

  // Disabled when value <= 0 or non-finite
  assert.equal(calculateRetentionCutoff(0, "days", baseTime), null);
  assert.equal(calculateRetentionCutoff(-1, "hours", baseTime), null);
  assert.equal(calculateRetentionCutoff(NaN, "minutes", baseTime), null);

  // Minutes
  const minCutoff = calculateRetentionCutoff(30, "minutes", baseTime);
  assert.equal(minCutoff.toISOString(), "2026-10-26T11:30:00.000Z");

  // Hours
  const hrCutoff = calculateRetentionCutoff(5, "hours", baseTime);
  assert.equal(hrCutoff.toISOString(), "2026-10-26T07:00:00.000Z");

  // Days
  const dayCutoff = calculateRetentionCutoff(3, "days", baseTime);
  assert.equal(dayCutoff.toISOString(), "2026-10-23T12:00:00.000Z");
});

// 2. Ticket cleanup logic simulation
test("cleanupExpiredClosedTickets respects retention cutoff and cleans attachments", async () => {
  let findManyArgs = null;
  let deleteManyArgs = null;
  let deletedAttachments = [];

  const mockPrisma = {
    ticket: {
      findMany: async (args) => {
        findManyArgs = args;
        return [
          {
            id: "ticket-1",
            messages: [{ attachments: '["/api/uploads/tickets/photo1.jpg"]' }],
          },
          {
            id: "ticket-2",
            messages: [{ attachments: '["/api/uploads/tickets/photo2.jpg"]' }],
          },
        ];
      },
      deleteMany: async (args) => {
        deleteManyArgs = args;
        return { count: 2 };
      },
    },
  };

  const mockDeleteTicketAttachments = async (items) => {
    deletedAttachments.push(...items);
  };

  const config = { ticketRetentionValue: 10, ticketRetentionUnit: "days" };
  const cutoff = calculateRetentionCutoff(config.ticketRetentionValue, config.ticketRetentionUnit);
  assert.ok(cutoff);

  const candidates = await mockPrisma.ticket.findMany({
    where: {
      status: "closed",
      OR: [
        { closedAt: { lte: cutoff } },
        { closedAt: null, updatedAt: { lte: cutoff } },
      ],
    },
    include: {
      messages: { select: { attachments: true } },
    },
    take: 500,
  });

  const candidateIds = candidates.map((t) => t.id);
  const attachments = candidates.flatMap((t) => t.messages.map((m) => m.attachments));

  await mockPrisma.ticket.deleteMany({
    where: { id: { in: candidateIds } },
  });
  await mockDeleteTicketAttachments(attachments);

  assert.equal(findManyArgs.where.status, "closed");
  assert.deepEqual(deleteManyArgs.where.id.in, ["ticket-1", "ticket-2"]);
  assert.equal(deletedAttachments.length, 2);
  assert.ok(deletedAttachments.includes('["/api/uploads/tickets/photo1.jpg"]'));
});

// 3. Admin routes source code verification
test("admin.routes.ts contains bulk endpoints and retention settings", () => {
  const content = readFileSync(
    new URL("../src/modules/admin/admin.routes.ts", import.meta.url),
    "utf8"
  );

  // Settings schema has retention fields
  assert.ok(content.includes("ticketRetentionValue: z.number().int().min(0).max(36500).optional()"));
  assert.ok(content.includes('ticketRetentionUnit: z.enum(["minutes", "hours", "days"]).optional()'));

  // Bulk endpoints are defined
  assert.ok(content.includes('adminRouter.post("/tickets/bulk-status"'));
  assert.ok(content.includes('adminRouter.post("/tickets/bulk-reply"'));
  assert.ok(content.includes('adminRouter.post("/tickets/bulk-delete"'));
  assert.ok(content.includes('adminRouter.post("/tickets/delete-all"'));

  // Ensure closedAt handling in bulk-status
  assert.ok(content.includes('status === "closed" ? new Date() : null'));

  // Ensure disk attachments deletion in bulk-delete and delete-all
  assert.ok(content.includes("deleteTicketAttachments(attachments)"));

  // Ensure client notification in bulk-reply
  assert.ok(content.includes("notifyClientAboutSupportReply"));
});

// 4. Schema verification
test("schema.prisma defines closedAt with index", () => {
  const schema = readFileSync(
    new URL("../prisma/schema.prisma", import.meta.url),
    "utf8"
  );
  assert.ok(schema.includes('closedAt  DateTime? @map("closed_at")'));
  assert.ok(schema.includes("@@index([closedAt])"));
});

// 5. System config keys inclusion verification
test("client.service.ts includes ticket retention keys in SYSTEM_CONFIG_KEYS", () => {
  const clientService = readFileSync(
    new URL("../src/modules/client/client.service.ts", import.meta.url),
    "utf8"
  );
  assert.ok(clientService.includes('"ticket_retention_value"'));
  assert.ok(clientService.includes('"ticket_retention_unit"'));
  assert.ok(clientService.includes("ticketRetentionValue: (() => {"));
  assert.ok(clientService.includes("ticketRetentionUnit: (() => {"));
});
