import { prisma } from "../../db.js";
import { remnaGetUser } from "../remna/remna.client.js";
import { excludeLegacyAutoRenewSubs } from "../payment/legacy-auto-renew-scope.js";

type ReminderRule = { id: string; triggerType: string; delayDays: number };

export function subscriptionReminderWindow(rule: ReminderRule, now = Date.now()) {
  const amount = Math.max(0, rule.delayDays);
  const day = 86400000;
  if (rule.triggerType === "subscription_expired") {
    return { gte: new Date(now - (amount + 7) * day), lte: new Date(now - amount * day) };
  }
  if (rule.triggerType === "subscription_ending_minutes") {
    const offset = Math.max(1, amount);
    const catchUp = Math.max(5, offset * 0.25);
    return { gt: new Date(now + Math.max(0, offset - catchUp) * 60000), lte: new Date(now + offset * 60000) };
  }
  const days = Math.max(1, amount);
  return { gt: new Date(now + (days - 1) * day), lte: new Date(now + days * day) };
}

export async function verifySubscriptionReminder(rule: ReminderRule, subscriptionId: string, clientId: string) {
  const eligibility = {
    id: subscriptionId, ownerId: clientId, purchasedAsGift: false,
    autoRenewEnabled: false, tariffId: { not: null },
    owner: { isBlocked: false }, ...excludeLegacyAutoRenewSubs(),
  };
  const sub = await prisma.subscription.findFirst({ where: eligibility, include: { tariff: { select: { name: true } } } });
  if (!sub?.remnawaveUuid) return null;
  const result = await remnaGetUser(sub.remnawaveUuid);
  if (result.error) throw new Error("Не удалось проверить срок подписки в Remnawave");
  const raw = result.data as { response?: { expireAt?: unknown }; expireAt?: unknown } | undefined;
  const value = (raw?.response ?? raw)?.expireAt;
  const expireAt = typeof value === "string" ? new Date(value) : null;
  if (!expireAt || !Number.isFinite(expireAt.getTime())) throw new Error("Remnawave не вернул срок подписки");
  const updated = await prisma.subscription.updateMany({
    where: { ...eligibility, remnawaveUuid: sub.remnawaveUuid, expireAt: sub.expireAt },
    data: { expireAt, remnaSyncedAt: new Date() },
  });
  if (!updated.count) return null;
  const window = subscriptionReminderWindow(rule);
  const time = expireAt.getTime();
  if (time > window.lte.getTime() || (window.gt ? time <= window.gt.getTime() : time < window.gte!.getTime())) return null;
  const sent = await prisma.autoBroadcastLog.findFirst({ where: { ruleId: rule.id, subscriptionId, expireAtSnapshot: expireAt }, select: { id: true } });
  if (sent) return null;
  return { clientId, subscriptionId, subExpireAt: expireAt, tariffName: sub.tariff?.name };
}
