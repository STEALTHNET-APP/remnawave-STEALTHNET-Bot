/**
 * Разбор Remnawave-подписки из ответов клиентского API.
 *
 * Ответы приходят в разных обёртках (`response`, `data.response`, «плоский»
 * объект) в зависимости от эндпоинта и версии панели, поэтому все экраны
 * Aurora читают поля только через этот модуль.
 */

export interface RemnaSubscriptionInfo {
  status: string | null;
  expireAt: string | null;
  trafficUsed: number | null;
  trafficLimitBytes: number | null;
  deviceLimit: number | null;
  subscriptionUrl: string | null;
  productName: string | null;
  username: string | null;
}

export function remnaPayload(sub: unknown): Record<string, unknown> | null {
  if (!sub || typeof sub !== "object") return null;
  const raw = sub as Record<string, unknown>;
  if (raw.response && typeof raw.response === "object") return raw.response as Record<string, unknown>;
  if (raw.data && typeof raw.data === "object") {
    const data = raw.data as Record<string, unknown>;
    if (data.response && typeof data.response === "object") return data.response as Record<string, unknown>;
  }
  return raw;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function remnaInfo(sub: unknown): RemnaSubscriptionInfo {
  const payload = remnaPayload(sub);
  if (!payload) {
    return {
      status: null,
      expireAt: null,
      trafficUsed: null,
      trafficLimitBytes: null,
      deviceLimit: null,
      subscriptionUrl: null,
      productName: null,
      username: null,
    };
  }
  const traffic = payload.userTraffic && typeof payload.userTraffic === "object"
    ? (payload.userTraffic as Record<string, unknown>)
    : null;
  return {
    status: str(payload.status),
    expireAt: str(payload.expireAt),
    trafficUsed: num(traffic?.usedTrafficBytes) ?? num(payload.trafficUsed),
    trafficLimitBytes: num(payload.trafficLimitBytes),
    deviceLimit: num(payload.hwidDeviceLimit),
    subscriptionUrl: str(payload.subscriptionUrl),
    productName: str(payload.productName) ?? str(payload.subscriptionProductName),
    username: str(payload.username),
  };
}

/** Дней до окончания подписки (0 — уже истекла). */
export function remnaDaysLeft(expireAt: string | null): number | null {
  if (!expireAt) return null;
  const time = new Date(expireAt).getTime();
  if (Number.isNaN(time)) return null;
  return Math.max(0, Math.ceil((time - Date.now()) / 86_400_000));
}

export function remnaIsActive(info: RemnaSubscriptionInfo, daysLeft: number | null): boolean {
  if (info.status) {
    if (info.status === "ACTIVE") return true;
    if (info.status === "EXPIRED" || info.status === "DISABLED" || info.status === "LIMITED") return false;
  }
  return (daysLeft ?? 0) > 0;
}

export function formatTraffic(bytes: number | null, units: string[] = ["Б", "КБ", "МБ", "ГБ", "ТБ"]): string {
  if (bytes == null) return "—";
  if (bytes <= 0) return `0 ${units[0]}`;
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const rounded = Math.round(value * 10) / 10;
  return `${rounded} ${units[index]}`;
}
