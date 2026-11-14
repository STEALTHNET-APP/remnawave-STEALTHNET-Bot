import cron, { type ScheduledTask } from "node-cron";
import { processReferralDayRewards } from "./referral-rewards.service.js";
let task: ScheduledTask | null = null;
export function startReferralRewardsScheduler() {
  task?.stop();
  task = cron.schedule("* * * * *", async () => {
    try { await processReferralDayRewards(); }
    catch (error) { console.error("[referral-days] Scheduler failed", error); }
  }, { noOverlap: true });
}
export function stopReferralRewardsScheduler() { task?.stop(); task = null; }
