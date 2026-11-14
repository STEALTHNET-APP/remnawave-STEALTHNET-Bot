export type SubscriptionPurchaseCandidate = {
  tariffId?: string | null;
};

export function shouldShowPurchaseChoice(input: {
  tariffId: string;
  subscriptions: SubscriptionPurchaseCandidate[];
  isBypass: boolean;
  isSingleCategory: boolean;
  multiSubscriptionsEnabled: boolean;
}): boolean {
  if (!input.multiSubscriptionsEnabled || input.isBypass || input.isSingleCategory) return false;
  return input.subscriptions.some((subscription) => subscription.tariffId === input.tariffId);
}

export function purchaseChoiceText(subscriptions: { tariffDisplayName?: string; subscription?: unknown }[], now = Date.now()): string {
  const lines = subscriptions.slice(0, 3).map(sub => {
    const envelope = sub.subscription as Record<string, unknown> | null;
    const payload = (envelope?.response ?? envelope?.data ?? envelope) as Record<string, unknown> | null;
    const user = (payload?.user ?? payload) as Record<string, unknown> | null;
    const expiry = typeof user?.expireAt === "string" ? Date.parse(user.expireAt) : NaN;
    const date = Number.isFinite(expiry) ? ` — ${expiry > now ? "до" : "истекла"} ${new Date(expiry).toLocaleDateString("ru-RU", {timeZone:"UTC"})}` : "";
    return `${(sub.tariffDisplayName || "Подписка").replace(/[\r\n]/g, " ").slice(0, 100)}${date}`;
  });
  return ["У вас уже есть подписка.", "", ...lines, ...(subscriptions.length > 3 ? [`И ещё: ${subscriptions.length - 3}`] : []), "", "Продление сохранит текущую ссылку подключения. Отдельная подписка получит новую ссылку и будет оплачиваться отдельно."].join("\n");
}
