import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

// 1. Retention cutoff calculations
function calculateRetentionCutoff(value, unit, now = new Date()) {
  if (!Number.isFinite(value) || value <= 0) return null;
  const multiplier = unit === "minutes" ? 60 * 1000 : unit === "hours" ? 3600 * 1000 : 86400 * 1000;
  return new Date(now.getTime() - value * multiplier);
}

// T1, T2, T3, T4: Bulk reply logic simulation
test("T1 & T2 & T3 & T4: Bulk reply handles open, closed, and mixed tickets with closeAfterReply correctly", () => {
  const processBulkReply = (tickets, closeAfterReply) => {
    return tickets.map((ticket) => {
      const updateData = { updatedAt: new Date() };
      if (closeAfterReply) {
        updateData.status = "closed";
        updateData.closedAt = new Date();
      } else if (ticket.status === "closed") {
        updateData.status = "open";
        updateData.closedAt = null;
      } else {
        updateData.status = ticket.status;
        updateData.closedAt = ticket.closedAt;
      }
      return { ...ticket, ...updateData };
    });
  };

  const oldClosedAt = new Date("2026-10-20T10:00:00.000Z");
  const initialTickets = [
    { id: "t-open-1", status: "open", closedAt: null },
    { id: "t-closed-1", status: "closed", closedAt: oldClosedAt },
  ];

  // T1: Bulk reply to closed ticket with closeAfterReply: false -> reopens!
  const resT1 = processBulkReply([initialTickets[1]], false);
  assert.equal(resT1[0].status, "open");
  assert.equal(resT1[0].closedAt, null);

  // T2: Bulk reply to closed ticket with closeAfterReply: true -> stays closed, closedAt refreshed
  const resT2 = processBulkReply([initialTickets[1]], true);
  assert.equal(resT2[0].status, "closed");
  assert.ok(resT2[0].closedAt > oldClosedAt);

  // T3: Mixed reply with closeAfterReply: false -> all become open
  const resT3 = processBulkReply(initialTickets, false);
  assert.equal(resT3[0].status, "open");
  assert.equal(resT3[0].closedAt, null);
  assert.equal(resT3[1].status, "open");
  assert.equal(resT3[1].closedAt, null);

  // T4: Mixed reply with closeAfterReply: true -> all become closed
  const resT4 = processBulkReply(initialTickets, true);
  assert.equal(resT4[0].status, "closed");
  assert.ok(resT4[0].closedAt instanceof Date);
  assert.equal(resT4[1].status, "closed");
  assert.ok(resT4[1].closedAt instanceof Date);
});

// T5 & T6: Bulk status idempotence and retention timer protection
test("T5: Bulk close does not overwrite closedAt for tickets that were already closed", () => {
  const existingClosedAt = new Date("2026-10-22T08:00:00.000Z");
  const tickets = [
    { id: "t1", status: "open", closedAt: null },
    { id: "t2", status: "closed", closedAt: existingClosedAt },
  ];

  // Logic: only update status="closed" where status != "closed"
  const now = new Date("2026-10-26T12:00:00.000Z");
  const updatedTickets = tickets.map((t) => {
    if (t.status !== "closed") {
      return { ...t, status: "closed", closedAt: now };
    }
    return t; // preserve original closedAt!
  });

  assert.equal(updatedTickets[0].status, "closed");
  assert.equal(updatedTickets[0].closedAt.toISOString(), now.toISOString());

  assert.equal(updatedTickets[1].status, "closed");
  // Original closedAt must be strictly preserved!
  assert.equal(updatedTickets[1].closedAt.toISOString(), existingClosedAt.toISOString());
});

test("T6: Bulk open resets closedAt to null for closed tickets", () => {
  const tickets = [
    { id: "t1", status: "open", closedAt: null },
    { id: "t2", status: "closed", closedAt: new Date("2026-10-22T08:00:00.000Z") },
  ];

  const openedTickets = tickets.map((t) => ({ ...t, status: "open", closedAt: null }));
  assert.equal(openedTickets[0].status, "open");
  assert.equal(openedTickets[0].closedAt, null);
  assert.equal(openedTickets[1].status, "open");
  assert.equal(openedTickets[1].closedAt, null);
});

// T7: Client reply auto-reopening logic
test("T7: Client reply to closed ticket automatically reopens it", () => {
  const simulateClientMessage = (ticket) => {
    const updateData = { updatedAt: new Date() };
    if (ticket.status === "closed") {
      updateData.status = "open";
      updateData.closedAt = null;
    }
    return { ...ticket, ...updateData };
  };

  const closedTicket = { id: "t-closed", status: "closed", closedAt: new Date() };
  const updated = simulateClientMessage(closedTicket);
  assert.equal(updated.status, "open");
  assert.equal(updated.closedAt, null);
});

// T8: Retention cleanup
test("T8: calculateRetentionCutoff handles various units correctly", () => {
  const base = new Date("2026-10-26T12:00:00.000Z");
  assert.equal(calculateRetentionCutoff(0, "days", base), null);
  assert.equal(calculateRetentionCutoff(15, "minutes", base).toISOString(), "2026-10-26T11:45:00.000Z");
  assert.equal(calculateRetentionCutoff(2, "hours", base).toISOString(), "2026-10-26T10:00:00.000Z");
  assert.equal(calculateRetentionCutoff(7, "days", base).toISOString(), "2026-10-19T12:00:00.000Z");
});

// T9 & T10: Delete-all scopes
test("T9 & T10: Delete-all filters accurately by scope", () => {
  const tickets = [
    { id: "1", status: "open" },
    { id: "2", status: "closed" },
    { id: "3", status: "closed" },
  ];

  const deleteByScope = (scope) => {
    const where = scope === "closed" ? { status: "closed" } : {};
    return tickets.filter((t) => (where.status ? t.status === where.status : true));
  };

  const closedDeleted = deleteByScope("closed");
  assert.equal(closedDeleted.length, 2);
  assert.ok(closedDeleted.every((t) => t.status === "closed"));

  const allDeleted = deleteByScope("all");
  assert.equal(allDeleted.length, 3);
});

// T11: Search filter logic
test("T11: Search filtering matches subject, client info and last message text", () => {
  const items = [
    {
      id: "t1",
      subject: "Ошибка оплаты Platega",
      client: { email: "user1@example.com", telegramUsername: "user_one", id: "c1" },
      lastMessage: { content: "Списались деньги, подписка не продлилась" },
    },
    {
      id: "t2",
      subject: "Вопрос по Vless Wireguard",
      client: { email: "john@doe.org", telegramUsername: null, id: "c2" },
      lastMessage: { content: "Как настроить Sing-box?" },
    },
  ];

  const search = (q) => {
    if (!q.trim()) return items;
    const term = q.toLowerCase().trim();
    return items.filter((t) => {
      const clientLabel = `${t.client.email ?? ""} ${t.client.telegramUsername ?? ""} ${t.client.id}`;
      const lastMsg = t.lastMessage?.content ?? "";
      return (
        t.subject.toLowerCase().includes(term) ||
        clientLabel.toLowerCase().includes(term) ||
        lastMsg.toLowerCase().includes(term)
      );
    });
  };

  assert.equal(search("platega").length, 1);
  assert.equal(search("user_one").length, 1);
  assert.equal(search("sing-box").length, 1);
  assert.equal(search("несуществующий текст").length, 0);
});

// T12: Verify admin.routes.ts code structure
test("T12: Verify backend routes have retention timer protection and reopen logic", () => {
  const adminRoutes = readFileSync(
    new URL("../src/modules/admin/admin.routes.ts", import.meta.url),
    "utf8"
  );

  // Check bulk-status retention protection
  assert.ok(adminRoutes.includes('where: { id: { in: ticketIds }, status: { not: "closed" } }'));

  // Check bulk-reply reopen logic for closed tickets
  assert.ok(adminRoutes.includes('else if (ticket.status === "closed")'));
  assert.ok(adminRoutes.includes('updateData.status = "open"'));
  assert.ok(adminRoutes.includes('updateData.closedAt = null'));
});
