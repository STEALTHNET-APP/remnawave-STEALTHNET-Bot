import { createHmac, timingSafeEqual } from "node:crypto";

/** ParityPay API v2: https://docs.paritypay.net/. Amounts are RUB. */
export type ParitypayConfig = { shopId: string; apiKey: string; signingSecret: string; enabled?: boolean };
export function isParitypayConfigured(config: ParitypayConfig | null): boolean {
  return Boolean(config?.enabled && config.shopId.trim() && config.apiKey.trim() && config.signingSecret.trim());
}
export function verifyParitypayWebhookSignature(secret: string, body: Record<string, unknown>, signature?: string): boolean {
  if (!secret.trim() || !signature || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  // Provider's documented canonicalization: sorted keys, null => empty string.
  if (Object.values(body).some(v => v !== null && typeof v === "object")) return false;
  const canonical = Object.keys(body).sort().map(key => body[key] === null ? "" : String(body[key])).join("");
  const expected = createHmac("sha256", secret.trim()).update(canonical).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}
export type ParitypayInvoice = { id: string; order_id: string; shop_id: string; amount: number | string; status: string; link?: string };
async function request(config: ParitypayConfig, path: string, payload?: Record<string, unknown>): Promise<ParitypayInvoice> {
  const response = await fetch(`https://api.paritypay.net/v2/invoice/${path}`, {
    method: payload ? "POST" : "GET",
    headers: { "Content-Type": "application/json", "X-ShopId": config.shopId.trim(), "X-SecretKey": config.apiKey.trim() },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json() as ParitypayInvoice & { error?: string };
  if (!response.ok || body.error) throw new Error(`ParityPay: ${body.error || `HTTP ${response.status}`}`);
  if (!body.id || !body.order_id || !body.shop_id || !body.status) throw new Error("ParityPay: неполный ответ API");
  return body;
}
export async function getParitypayInvoice(config: ParitypayConfig, orderId: string): Promise<ParitypayInvoice> {
  return request(config, `status?order_id=${encodeURIComponent(orderId)}`);
}
export function matchesParitypayInvoice(invoice: ParitypayInvoice, expected: { orderId: string; shopId: string; amount: number; externalId?: string | null }): boolean {
  const amount = Number(invoice.amount);
  return invoice.shop_id === expected.shopId && invoice.order_id === expected.orderId &&
    (!expected.externalId || invoice.id === expected.externalId) && Number.isFinite(amount) && amount > 0 &&
    Math.round(amount * 100) === Math.round(expected.amount * 100);
}
export async function createParitypayPayment(params: {
  config: ParitypayConfig; amount: string; currency: string; orderId: string; description?: string;
  customerId?: string; successRedirectUrl?: string; failRedirectUrl?: string; callbackUrl?: string; metadata?: Record<string, unknown>;
}): Promise<{ ok: true; url: string; paymentId: string } | { ok: false; error: string }> {
  if (!isParitypayConfigured(params.config)) return { ok: false, error: "ParityPay выключен или не настроен" };
  const amount = Number(params.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "Некорректная сумма платежа" };
  if (params.currency.toUpperCase() !== "RUB") return { ok: false, error: "ParityPay принимает только рубли" };
  try {
    const body = await request(params.config, "create", {
      order_id: params.orderId, amount: Math.round(amount * 100) / 100,
      ...(params.description ? { comment: params.description.slice(0,255) } : {}),
      ...(params.successRedirectUrl ? { success_url: params.successRedirectUrl } : {}),
      ...(params.failRedirectUrl ? { fail_url: params.failRedirectUrl } : {}),
      ...(params.callbackUrl ? { callback_url: params.callbackUrl } : {}),
    });
    if (!matchesParitypayInvoice(body,{ orderId: params.orderId, shopId: params.config.shopId.trim(), amount })) throw new Error("ParityPay: ответ не соответствует заказу");
    const url = new URL(body.link || "");
    if (url.protocol !== "https:" || url.hostname !== "pay.paritypay.net") throw new Error("ParityPay: некорректная ссылка на оплату");
    return { ok: true, url: url.href, paymentId: body.id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Ошибка ParityPay" };
  }
}
