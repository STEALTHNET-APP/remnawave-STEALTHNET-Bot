import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const API = "https://api.cispay.app";
export type CispayConfig = { shopId: string; apiKey: string };
export const cispayStatusSchema = z.object({
  id: z.string().uuid(), order_id: z.string(), status: z.enum(["PENDING", "PAID", "FAILED", "EXPIRED", "REFUNDED"]),
  amount: z.number().int().positive(), charged_amount: z.number().int().nonnegative(), currency: z.string().default("RUB"),
  is_sandbox: z.boolean().default(false), payment_method: z.string().nullable().optional(),
  source_amount: z.number().int().positive().nullable().optional(), source_currency: z.string().nullable().optional(),
  block_reason: z.string().nullable().optional(),
});
export type CispayStatus = z.infer<typeof cispayStatusSchema>;
export function verifyCispaySignature(secret: string, raw: Buffer, signature: string | undefined) {
  if (!secret || !signature || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  return timingSafeEqual(createHmac("sha256", secret).update(raw).digest(), Buffer.from(signature, "hex"));
}
export function cispayMatchesPayment(status: CispayStatus, payment: { orderId: string; amount: number; currency: string; externalId: string | null }, sandbox: boolean) {
  const converted = status.payment_method === "CRYPTO" && status.currency === "USD" && status.source_currency === "RUB";
  const currency = converted ? status.source_currency : status.currency;
  const amount = converted ? status.source_amount : status.amount;
  return status.order_id === payment.orderId && (!payment.externalId || payment.externalId === status.id)
    && currency?.toUpperCase() === payment.currency.toUpperCase() && amount === Math.round(payment.amount * 100) && status.is_sandbox === sandbox && !status.block_reason;
}
async function request(config: CispayConfig, path: string, body?: unknown) {
  const response = await fetch(API + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "X-Shop-ID": config.shopId, "X-Api-Key": config.apiKey, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`CisPay: HTTP ${response.status}. Проверьте настройки магазина и статус счёта.`);
  return response.json();
}
export async function getCispayStatus(config: CispayConfig, orderId: string) {
  return cispayStatusSchema.parse(await request(config, `/payments/status?order_id=${encodeURIComponent(orderId)}`));
}
export async function createCispayPayment(params: { config: CispayConfig; amount: number; currency: string; orderId: string; customerId: string; description: string; returnUrl?: string }) {
  const minor = Math.round(params.amount * 100);
  if (!Number.isSafeInteger(minor) || minor <= 0 || !["RUB", "USD"].includes(params.currency)) return { ok: false as const, error: "CisPay принимает счета в RUB и USD." };
  try {
    const result = z.object({ id: z.string().uuid(), order_id: z.string(), payment_url: z.string().url() }).parse(await request(params.config, "/payments", {
      amount: minor, currency: params.currency, order_id: params.orderId, customer_id: params.customerId.slice(0, 40),
      description: params.description.slice(0, 512), redirect_success_url: params.returnUrl, redirect_fail_url: params.returnUrl,
    }));
    if (result.order_id !== params.orderId || new URL(result.payment_url).protocol !== "https:") throw Error("CisPay вернул некорректный счёт");
    return { ok: true as const, url: result.payment_url, paymentId: result.id };
  } catch {
    return { ok: false as const, error: "Не удалось подтвердить создание счёта CisPay. Запись сохранена; проверьте её статус перед повторной оплатой." };
  }
}

export async function refundCispayPayment(config: CispayConfig, id: string, chargedAmount: number) {
  return request(config, `/payments/refund?id=${encodeURIComponent(id)}`, { confirm_amount: chargedAmount });
}
