import type { getReferralStats } from "./api.js";
type Stats = Awaited<ReturnType<typeof getReferralStats>>;
export function referralRewardLines(stats: Stats | null) {
  if (!stats || !stats.referralRewardMode || stats.referralRewardMode === "percent") return null;
  const reward = stats.referralRewardMode === "days"
    ? `${stats.referralRewardDays ?? 0} дн. подписки`
    : `${stats.referralRewardAmount ?? 0} ${(stats.referralRewardCurrency ?? "RUB").toUpperCase()} на баланс`;
  return [
    `За каждого приглашённого друга — ${reward} после его первой успешной оплаты.`,
    "Бонус начисляется один раз за человека.", "",
    `👥 Приглашено: ${stats.referralCount}`,
    `💰 Всего начислено на баланс: ${stats.totalEarned}`,
    ...((stats.referralDaysEarned ?? 0) > 0 || stats.referralRewardMode === "days" ? [
      `📅 Получено дней: ${stats.referralDaysEarned ?? 0}`,
      `⏳ Ожидают начисления: ${stats.referralDaysPending ?? 0}`,
      "Дни автоматически добавляются к основной подписке. Если её нет, бонус сохраняется.",
    ] : []), "",
  ];
}
