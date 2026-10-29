import type { SubscriptionListItem } from "./api.js";
import { menuWebAppUrl } from "./menu-web-app.js";

export function renewableSubscriptions(items: SubscriptionListItem[], tariffId?: string): SubscriptionListItem[] {
  return items.filter(item => (!tariffId || item.tariffId === tariffId)
    && !(item.trialId && item.trialConvertEnabled === false)
    && Boolean(item.tariffId || (item.trialId && (item.trialConvertAllTariffs || item.convertTariffIds?.length))));
}

function subscriptionUser(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object") return null;
  const envelope = payload as Record<string, unknown>;
  const value = envelope.response ?? envelope.data ?? envelope;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return record.user && typeof record.user === "object" ? record.user as Record<string, unknown> : record;
}

export function connectableSubscriptions(items: SubscriptionListItem[], now = Date.now()): SubscriptionListItem[] {
  return items.filter(item => {
    if (item.isBanned || (item.bannedUntil && Date.parse(item.bannedUntil) > now)) return false;
    const user = subscriptionUser(item.subscription);
    if (!user) return false;
    const status = String(user.status ?? user.userStatus ?? "").toUpperCase();
    if (status && status !== "ACTIVE") return false;
    const expiry = user.expireAt ?? user.expiresAt;
    if (expiry != null) {
      const timestamp = Date.parse(String(expiry));
      if (!Number.isFinite(timestamp) || timestamp <= now) return false;
    }
    return Boolean(item.remnawaveUuid || user.subscriptionUrl || user.subscription_url);
  });
}

export function directConnectionTarget(
  items: SubscriptionListItem[],
  appUrl?: string | null,
  useRemna = false,
): { url: string } | { web_app: { url: string } } | undefined {
  const available = connectableSubscriptions(items);
  if (available.length !== 1) return undefined;
  const only = available[0];
  const user = subscriptionUser(only.subscription);
  const rawUrl = user?.subscriptionUrl ?? user?.subscription_url;
  const url = typeof rawUrl === "string" && /^https?:\/\//i.test(rawUrl) ? rawUrl : undefined;
  if (useRemna && url) return { url };
  const base = menuWebAppUrl(appUrl ?? "", "vpn");
  if (base) {
    if (only.type !== "root" && !only.remnawaveUuid) return undefined;
    const target = new URL(base);
    if (only.remnawaveUuid) target.searchParams.set("uuid", only.remnawaveUuid);
    return { web_app: { url: target.toString() } };
  }
  return url ? { url } : undefined;
}
