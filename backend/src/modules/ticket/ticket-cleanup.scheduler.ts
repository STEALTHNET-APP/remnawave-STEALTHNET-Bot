import cron from "node-cron";
import { prisma } from "../../db.js";
import { getSystemConfig } from "../client/client.service.js";
import { deleteTicketAttachments } from "./attachments.js";

let task: cron.ScheduledTask | null = null;

export function calculateRetentionCutoff(
  value: number,
  unit: "minutes" | "hours" | "days",
  now = new Date(),
): Date | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const multiplier = unit === "minutes" ? 60 * 1000 : unit === "hours" ? 3600 * 1000 : 86400 * 1000;
  return new Date(now.getTime() - value * multiplier);
}

export async function cleanupExpiredClosedTickets(): Promise<{ prunedCount: number }> {
  try {
    const config = await getSystemConfig();
    const cutoff = calculateRetentionCutoff(config.ticketRetentionValue, config.ticketRetentionUnit);
    if (!cutoff) return { prunedCount: 0 };

    const candidates = await prisma.ticket.findMany({
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

    if (candidates.length === 0) return { prunedCount: 0 };

    const candidateIds = candidates.map((t) => t.id);
    const attachments = candidates.flatMap((t) => t.messages.map((m) => m.attachments));

    await prisma.ticket.deleteMany({
      where: { id: { in: candidateIds } },
    });

    await deleteTicketAttachments(attachments);

    console.log(
      `[ticket-cleanup] Pruned ${candidateIds.length} closed ticket(s) older than ${config.ticketRetentionValue} ${config.ticketRetentionUnit}`,
    );
    return { prunedCount: candidateIds.length };
  } catch (error) {
    console.error("[ticket-cleanup] Error during ticket retention cleanup:", error);
    return { prunedCount: 0 };
  }
}

/**
 * Запуск фонового планировщика очистки закрытых тикетов (раз в 5 минут).
 */
export function startTicketCleanupScheduler(): void {
  if (task) {
    task.stop();
    task = null;
  }
  // Проверяем каждые 5 минут
  task = cron.schedule("*/5 * * * *", async () => {
    await cleanupExpiredClosedTickets();
  });
  console.log("[ticket-cleanup] Scheduler started: runs every 5 minutes");
}

export function stopTicketCleanupScheduler(): void {
  if (task) {
    task.stop();
    task = null;
    console.log("[ticket-cleanup] Scheduler stopped");
  }
}
