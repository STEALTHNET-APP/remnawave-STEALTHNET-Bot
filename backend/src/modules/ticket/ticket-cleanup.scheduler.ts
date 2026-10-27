import cron from "node-cron";
import { getSystemConfig } from "../client/client.service.js";
import { deleteTickets } from "./ticket-delete.service.js";

let task: cron.ScheduledTask | null = null;

export { calculateRetentionCutoff } from "./ticket-retention.js";
import { calculateRetentionCutoff } from "./ticket-retention.js";

export async function cleanupExpiredClosedTickets(): Promise<{ prunedCount: number }> {
  try {
    const config = await getSystemConfig();
    const cutoff = calculateRetentionCutoff(config.ticketRetentionValue, config.ticketRetentionUnit);
    if (!cutoff) return { prunedCount: 0 };

    const count = await deleteTickets({
      status: "closed",
      OR: [{ closedAt: { lte: cutoff } }, { closedAt: null, updatedAt: { lte: cutoff } }],
    }, 500);
    return { prunedCount: count };
  } catch (error) {
    console.error("[ticket-cleanup] Error during ticket retention cleanup:", error);
    return { prunedCount: 0 };
  }
}

export function startTicketCleanupScheduler(): void {
  if (task) {
    task.stop();
    task = null;
  }
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
