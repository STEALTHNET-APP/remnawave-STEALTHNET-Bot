import type { ClientReferralStats } from "@/lib/api";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n/init";

export function referralRewardLabel(stats: ClientReferralStats) {
  if (stats.referralRewardMode === "days") return i18n.t("aurora.days_short", { count: stats.referralRewardDays ?? 0 });
  if (stats.referralRewardMode === "balance") return `${stats.referralRewardAmount ?? 0} ${(stats.referralRewardCurrency ?? "RUB").toUpperCase()}`;
  return `${stats.referralPercent}%`;
}

export function referralRewardDescription(stats: ClientReferralStats) {
  if (!stats.referralRewardMode || stats.referralRewardMode === "percent") return i18n.t("aurora.referral_reward_percent");
  return i18n.t("aurora.referral_reward_fixed", { reward: referralRewardLabel(stats) });
}

export function ReferralRewardSummary({ stats }: { stats: ClientReferralStats }) {
  const { t } = useTranslation();
  const days = (stats.referralDaysEarned ?? 0) > 0 || stats.referralRewardMode === "days";
  if ((!stats.referralRewardMode || stats.referralRewardMode === "percent") && !days) return null;
  const reward = referralRewardLabel(stats);
  return <section className="rounded-xl border border-border bg-card p-4 space-y-2">
    <h3 className="font-semibold">{t("aurora.referral_bonus_title")}</h3>
    <p className="text-sm">{t("aurora.referral_reward_fixed", { reward })}</p>
    {days && <>
      <p className="text-sm">{t("aurora.referral_days_earned", { earned: stats.referralDaysEarned ?? 0, pending: stats.referralDaysPending ?? 0 })}</p>
      <p className="text-xs text-muted-foreground">{t("aurora.referral_days_note")}</p>
    </>}
  </section>;
}
