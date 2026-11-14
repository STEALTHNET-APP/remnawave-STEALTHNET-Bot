import cron, { type ScheduledTask } from "node-cron";
import { registerCron, unregisterCron, wrapCronTick } from "../diagnostics/cron-registry.js";
import { runTrialCleanup } from "./trial-cleanup.service.js";

const CRON_EXPRESSION = "0 4 * * *";
const CRON_NAME = "trial-cleanup";

let task: ScheduledTask | null = null;

export function startTrialCleanupScheduler(): void {
  task?.stop();
  task = cron.schedule(CRON_EXPRESSION, wrapCronTick(CRON_NAME, async () => {
    await runTrialCleanup();
  }), { noOverlap: true });
  registerCron({
    name: CRON_NAME,
    cron: CRON_EXPRESSION,
    description: "Очистка пользователей с истекшим триалом без покупок",
    trigger: () => runTrialCleanup(),
  });
  console.log("[trial-cleanup] Scheduler started: daily at 04:00");
}

export function stopTrialCleanupScheduler(): void {
  if (task) {
    task.stop();
    task = null;
  }
  unregisterCron(CRON_NAME);
}
