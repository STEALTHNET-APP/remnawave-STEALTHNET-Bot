import { createHmac, timingSafeEqual } from "node:crypto";

export type CloudPaymentsConfig = { publicId: string; apiSecret: string };
export type CloudSubscription = {
  Id: string; AccountId: string; Status: string; Amount: number; Currency: string;
  Interval: string; Period: number; NextTransactionDateIso?: string;
  FailedTransactionsNumber?: number; SuccessfulTransactionsNumber?: number;
};

export function verifyCloudPaymentsSignature(raw: Buffer, signature: string | undefined, secret: string): boolean {
  if (!secret || !signature || !/^[A-Za-z0-9+/]{43}=$/.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(raw).digest();
  const supplied = Buffer.from(signature, "base64");
  return supplied.length === expected.length && timingSafeEqual(expected, supplied);
}

export function money(value: unknown): number {
  if (typeof value !== "number" && (typeof value !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(value))) throw new Error("Некорректная сумма");
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 100_000_000) throw new Error("Некорректная сумма");
  return Math.round(amount * 100) / 100;
}

export function sameAmount(left: unknown, right: unknown): boolean {
  try { return money(left) === money(right); } catch { return false; }
}

export async function cloudRequest<T>(config: CloudPaymentsConfig, method: string, body: Record<string, unknown>, requestId?: string): Promise<T> {
  if (!config.publicId || !config.apiSecret) throw new Error("CloudPayments не настроен");
  const response = await fetch(`https://api.cloudpayments.ru/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.publicId}:${config.apiSecret}`).toString("base64")}`,
      "Content-Type": "application/json",
      ...(requestId ? { "X-Request-ID": requestId } : {}),
    },
    body: JSON.stringify(body), signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`CloudPayments HTTP ${response.status}`);
  const result = await response.json() as { Success?: boolean; Model?: T };
  if (result.Success !== true) throw new Error("CloudPayments отклонил запрос");
  return result.Model as T;
}

export function parseCloudNotification(raw: Buffer, contentType: string): Record<string, unknown> {
  if (contentType.includes("application/json")) {
    const body = JSON.parse(raw.toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid notification");
    return body;
  }
  const params = new URLSearchParams(raw.toString("utf8"));
  const body: Record<string, unknown> = {};
  for (const [key, value] of params) {
    if (key in body) throw new Error("Duplicate notification field");
    body[key] = value;
  }
  return body;
}

export function subscriptionPrice(base: number, extrasMonthly: number, days: number): number {
  return money(base + extrasMonthly * days / 30);
}

export function proratedDevicePrice(monthly: number, expiresAt: Date, now = new Date()): number {
  return money(monthly * Math.max(0, expiresAt.getTime() - now.getTime()) / (30 * 86_400_000));
}
