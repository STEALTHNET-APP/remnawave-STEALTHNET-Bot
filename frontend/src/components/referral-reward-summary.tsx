import type { ClientReferralStats } from "@/lib/api";
export function referralRewardLabel(stats: ClientReferralStats) {
  if (stats.referralRewardMode === "days") return `${stats.referralRewardDays ?? 0} дн.`;
  if (stats.referralRewardMode === "balance") return `${stats.referralRewardAmount ?? 0} ${(stats.referralRewardCurrency ?? "RUB").toUpperCase()}`;
  return `${stats.referralPercent}%`;
}
export function referralRewardDescription(stats: ClientReferralStats) {
  if (!stats.referralRewardMode || stats.referralRewardMode === "percent") return "Приглашайте друзей — получайте процент от их оплат на свой баланс.";
  return `За каждого приглашённого друга — ${referralRewardLabel(stats)} после его первой успешной оплаты. Бонус начисляется один раз.`;
}
export function ReferralRewardSummary({ stats }: { stats: ClientReferralStats }) {
  const days = (stats.referralDaysEarned ?? 0) > 0 || stats.referralRewardMode === "days";
  if ((!stats.referralRewardMode || stats.referralRewardMode === "percent") && !days) return null;
  return <section className="rounded-xl border border-border bg-card p-4 space-y-2">
    <h3 className="font-semibold">Бонусы за приглашения</h3>
    <p className="text-sm">{referralRewardDescription(stats)}</p>
    {days && <>
      <p className="text-sm">Получено дней: <strong>{stats.referralDaysEarned ?? 0}</strong> · Ожидают начисления: <strong>{stats.referralDaysPending ?? 0}</strong></p>
      <p className="text-xs text-muted-foreground">Дни автоматически добавляются к основной подписке. Без подписки или при временной ошибке бонус сохраняется.</p>
    </>}
  </section>;
}
