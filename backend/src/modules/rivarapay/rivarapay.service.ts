import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const API = "https://api.rivarapay.io/api/v1";
export type RivarapayConfig = { apiKey: string; webhookSecret: string; sandbox: boolean; franchise?: { type: string; address: string; owner_telegram_id: string; owner_telegram_username?: string } };
const money = z.object({ amount: z.string().regex(/^\d+$/), currency: z.string() });
export const rivarapayStatusSchema = z.object({
  id: z.string().min(1), merchantOrderId: z.string(), livemode: z.boolean(),
  status: z.enum(["CREATED", "PENDING", "PROCESSING", "SUCCEEDED", "FAILED", "CANCELED", "EXPIRED", "REFUNDED", "PARTIALLY_REFUNDED"]),
  amount: money, refunded: money.optional(), checkoutUrl: z.string().url().optional(),
});
export type RivarapayStatus = z.infer<typeof rivarapayStatusSchema>;
export function decimalMinor(value: string): bigint | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}
export function verifyRivarapaySignature(secret: string, raw: Buffer, signature: string | undefined, timestamp: string | undefined, now = Date.now()) {
  if (!secret || !signature || !/^[a-f0-9]{64}$/i.test(signature) || !timestamp || !/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac("sha256", secret).update(timestamp + ".").update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}
export function rivarapayMatchesPayment(status: RivarapayStatus, payment: { orderId: string; amount: number; currency: string; externalId: string | null }, sandbox: boolean) {
  return status.merchantOrderId === payment.orderId && (!payment.externalId || payment.externalId === status.id)
    && status.amount.currency === payment.currency && BigInt(status.amount.amount) === decimalMinor(payment.amount.toFixed(2)) && status.livemode === !sandbox;
}
export function rivarapayIdentity(client: { email: string | null; telegramId: string | null; telegramUsername: string | null }) {
  if (client.telegramId && /^[1-9]\d*$/.test(client.telegramId)) {
    const username = client.telegramUsername?.replace(/^@/, "").toLowerCase();
    return { customerEmail: client.email && z.string().email().safeParse(client.email).success ? client.email : `${client.telegramId}@telegram.org`, userIdentity: { type: "telegram_id", value: client.telegramId, ...(username && /^[a-z][a-z0-9_]{4,31}$/.test(username) ? { telegramUsername: username } : {}) } };
  }
  if (client.email && z.string().email().safeParse(client.email).success) return { customerEmail: client.email, userIdentity: { type: "email", value: client.email } };
  return null;
}
export function rivarapayConfigurationError(config: RivarapayConfig): string | null {
  if (config.apiKey.startsWith("test_") !== config.sandbox || !/^(test|live)_/.test(config.apiKey)) return "Режим RivaraPay не соответствует API-ключу";
  if (config.franchise && (!config.franchise.address || !/^[1-9]\d*$/.test(config.franchise.owner_telegram_id))) return "Заполните адрес филиала и числовой Telegram ID владельца в настройках RivaraPay";
  return null;
}
async function request(config: RivarapayConfig, path: string, body?: unknown, key?: string) {
  const error = rivarapayConfigurationError(config);
  if (error) throw Error(error);
  const response = await fetch(API + path, {
    method: body === undefined ? "GET" : "POST", headers: { "X-API-Key": config.apiKey, "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw Error(`RivaraPay: HTTP ${response.status}. Проверьте ключ, лимиты и настройки магазина.`);
  return response.json();
}
export async function getRivarapayStatus(config: RivarapayConfig, id: string) {
  return rivarapayStatusSchema.parse(await request(config, `/payment-intents/${encodeURIComponent(id)}`));
}
export async function createRivarapayPayment(params: { config: RivarapayConfig; amount: number; currency: string; orderId: string; client: { email: string | null; telegramId: string | null; telegramUsername: string | null }; description: string; returnUrl?: string }) {
  const identity = rivarapayIdentity(params.client);
  const minor = decimalMinor(params.amount.toFixed(2));
  if (!identity || !minor || minor <= 0n || params.currency !== "RUB") return { ok: false as const, error: "RivaraPay: нужна почта или Telegram ID плательщика, сумма больше нуля и валюта RUB." };
  try {
    const status = rivarapayStatusSchema.parse(await request(params.config, "/payment-intents", {
      amount: minor.toString(), currency: params.currency, merchantOrderId: params.orderId,
      ...identity, description: params.description.slice(0, 500), returnUrl: params.returnUrl,
      ...(params.config.franchise ? { franchise: params.config.franchise } : {}),
    }, params.orderId));
    if (!rivarapayMatchesPayment(status, { orderId: params.orderId, amount: params.amount, currency: params.currency, externalId: null }, params.config.sandbox) || !status.checkoutUrl || new URL(status.checkoutUrl).protocol !== "https:") throw Error("Invalid invoice");
    return { ok: true as const, url: status.checkoutUrl, paymentId: status.id };
  } catch {
    return { ok: false as const, error: "Не удалось подтвердить создание счёта RivaraPay. Запись сохранена; проверьте платёж в кабинете RivaraPay перед повторной оплатой." };
  }
}
export function rivarapayConfig(config: { rivarapayApiKey: string; rivarapayWebhookSecret: string; rivarapaySandbox: boolean; rivarapayFranchiseType: string; rivarapayFranchiseAddress: string; rivarapayFranchiseOwnerId: string; rivarapayFranchiseOwnerUsername: string }): RivarapayConfig {
  return { apiKey: config.rivarapayApiKey, webhookSecret: config.rivarapayWebhookSecret, sandbox: config.rivarapaySandbox,
    ...(config.rivarapayFranchiseType ? { franchise: { type: config.rivarapayFranchiseType, address: config.rivarapayFranchiseAddress, owner_telegram_id: config.rivarapayFranchiseOwnerId, ...(config.rivarapayFranchiseOwnerUsername ? { owner_telegram_username: config.rivarapayFranchiseOwnerUsername.replace(/^@/, "").toLowerCase() } : {}) } } : {}),
  };
}
