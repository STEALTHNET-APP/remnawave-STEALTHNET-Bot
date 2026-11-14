import cron, { type ScheduledTask } from "node-cron";
import { prisma } from "../../db.js";
import { getSystemConfig } from "../client/client.service.js";
import { syncFromRemna, syncSubscriptionsMirror } from "./sync.service.js";

let task: ScheduledTask | null = null;
let running = false;
export async function runScheduledRemnaSync() {
  if (running) return;
  running = true;
  try {
    const config = await getSystemConfig();
    if (!config.remnaAutoSyncEnabled) return;
    await prisma.$transaction(async tx => {
      const locks = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(4414501) AS locked`;
      if (!locks[0]?.locked) return;
      const previous = await tx.systemSetting.findUnique({ where: { key: "remna_auto_sync_last_attempt" } });
      const last = previous ? Date.parse(previous.value) : 0;
      if (Number.isFinite(last) && Date.now() - last < config.remnaAutoSyncIntervalMinutes * 60000) return;
      const started = new Date().toISOString();
      let summary: string;
      try {
        const clients = await syncFromRemna();
        if (!clients.ok) throw new Error(`Импорт клиентов: ${clients.errors.length} ошибок`);
        const subscriptions = await syncSubscriptionsMirror();
        if (!subscriptions.ok) throw new Error(`Импорт подписок: ${subscriptions.errors.length} ошибок`);
        summary = JSON.stringify({ ok: true, finishedAt: new Date().toISOString(), clients, subscriptions });
      } catch (error) {
        console.warn("[remna-sync]", error instanceof Error ? error.message : "Sync failed");
        summary = JSON.stringify({ ok: false, finishedAt: new Date().toISOString() });
      }
      for (const [key, value] of [["remna_auto_sync_last_attempt", started], ["remna_auto_sync_last_result", summary]]) {
        await tx.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
      }
    }, { timeout: 600000, maxWait: 5000 });
  } finally { running = false; }
}
export function startRemnaSyncScheduler() {
  task?.stop();
  task = cron.schedule("* * * * *", () => runScheduledRemnaSync().catch(error => console.error("[remna-sync]", error)), { noOverlap: true });
}
export function stopRemnaSyncScheduler() { task?.stop(); task = null; }
