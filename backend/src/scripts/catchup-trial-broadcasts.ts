/**
 * CLI-утилита для безопасного догона (catch-up) пропущенных уведомлений триала.
 *
 * Использование:
 *   npx tsx src/scripts/catchup-trial-broadcasts.ts --dry-run
 *   npx tsx src/scripts/catchup-trial-broadcasts.ts --execute --since-days=14 --limit=100
 */

import { prisma } from "../db.js";
import { catchupTrialBroadcastRule } from "../modules/auto-broadcast/auto-broadcast.service.js";

async function main() {
  const args = process.argv.slice(2);
  const isExecute = args.includes("--execute");
  const dryRun = !isExecute || args.includes("--dry-run");

  let sinceDays = 14;
  let limit = 100;

  for (const arg of args) {
    if (arg.startsWith("--since-days=")) {
      sinceDays = parseInt(arg.split("=")[1], 10) || 14;
    } else if (arg.startsWith("--limit=")) {
      limit = parseInt(arg.split("=")[1], 10) || 100;
    }
  }

  console.log(`[catchup-trial-broadcasts] Starting (${dryRun ? "DRY RUN" : "EXECUTE MODE"}), sinceDays=${sinceDays}, limit=${limit}...`);

  const rules = await prisma.autoBroadcastRule.findMany({
    where: { triggerType: "trial_used_never_paid", enabled: true },
    select: { id: true, name: true, delayDays: true, channel: true },
  });

  if (rules.length === 0) {
    console.log("[catchup-trial-broadcasts] No enabled rules with trigger 'trial_used_never_paid' found.");
    process.exit(0);
  }

  for (const rule of rules) {
    console.log(`\n--- Rule: "${rule.name}" (${rule.id}), delay=${rule.delayDays}d, channel=${rule.channel} ---`);
    const result = await catchupTrialBroadcastRule(rule.id, {
      sinceDays,
      dryRun,
      limit,
    });

    console.log(`  Total trial candidates in period: ${result.totalCandidates}`);
    console.log(`  Already sent previously: ${result.alreadySent}`);
    console.log(`  Eligible to receive: ${result.eligibleCount}`);

    if (dryRun) {
      console.log(`  [DRY RUN] Would send to ${Math.min(result.eligibleCount, limit)} clients.`);
      if (result.sampleRecipients.length > 0) {
        console.log(`  Sample recipients:`, result.sampleRecipients);
      }
    } else {
      console.log(`  [EXECUTE] Sent: ${result.sentCount}, Errors: ${result.errors.length}`);
      if (result.errors.length > 0) {
        console.error(`  Errors:`, result.errors.slice(0, 5));
      }
    }
  }

  console.log("\n[catchup-trial-broadcasts] Done.");
}

main()
  .catch((e) => {
    console.error("[catchup-trial-broadcasts] Fatal error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
