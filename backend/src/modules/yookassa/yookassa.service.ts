/**
 * ЮKassa API - создание платежа (redirect на страницу оплаты).
 * Документация: https://yookassa.ru/developers/api#create_payment
 */

import { proxyFetch } from "../proxy-util/proxy-fetch.js";
import { getProxyUrl } from "../proxy-util/get-proxy-url.js";

const YOOKASSA_API = "https://api.yookassa.ru/v3";

/**
 * Placeholder-email для receipts, когда юзер отказался от чека.
 */
const PLACEHOLDER_DOMAINS = [
  "gmail.com", "mail.ru", "yandex.ru", "outlook.com",
  "icloud.com", "hotmail.com", "rambler.ru", "bk.ru",
  "list.ru", "inbox.ru", "yahoo.com",
];

function generatePlaceholderEmail(tgUsername?: string | null): string {
  const domain = PLACEHOLDER_DOMAINS[Math.floor(Math.random() * PLACEHOLDER_DOMAINS.length)];
  if (tgUsername && typeof tgUsername === "string") {
    const cleaned = tgUsername.toLowerCase().replace(/[^a-z0-9_.]/g, "").slice(0, 24);
    if (cleaned.length >= 3) {
      const suffix = Math.floor(Math.random() * 9000) + 100;
      return `${cleaned}${suffix}@${domain}`;
    }
  }
  const a = Math.random().toString(36).slice(2, 10);
  const b = Math.random().toString(36).slice(2, 6);
  return `${a}${b}@${domain}`;
}

export type CreatePaymentParams = {
  shopId: string;
  secretKey: string;
  amount: number;
  currency: string;
  returnUrl: string;
  description: string;
  metadata: Record<string, string>;
  customerEmail?: string | null;
  customerTelegramUsername?: string | null;
  savePaymentMethod?: boolean;
};

export type CreatePaymentResult =
  | { ok: true; paymentId: string; confirmationUrl: string; status: string }
  | { ok: false; error: string; status?: number };

/**
 * Создаёт платёж в ЮKassa с защитой от залипания сокетов и автоповтором.
 */
export async function createYookassaPayment(params: CreatePaymentParams): Promise<CreatePaymentResult> {
  const { shopId, secretKey, amount, currency, returnUrl, description, metadata, customerEmail, customerTelegramUsername, savePaymentMethod } = params;
  if (!shopId?.trim() || !secretKey?.trim()) {
    return { ok: false, error: "YooKassa not configured" };
  }

  const valueStr = amount.toFixed(2);
  const currencyUpper = currency.toUpperCase();

  const receipt = {
    customer: {
      email: (customerEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail))
        ? customerEmail.trim()
        : generatePlaceholderEmail(customerTelegramUsername),
    },
    tax_system_code: 2,
    items: [
      {
        description: description.slice(0, 128) || "Оплата подписки",
        quantity: "1.00",
        amount: { value: valueStr, currency: currencyUpper },
        vat_code: 7,
        payment_subject: "service" as const,
        payment_mode: "full_payment" as const,
      },
    ],
  };

  const body: Record<string, unknown> = {
    amount: { value: valueStr, currency: currencyUpper },
    capture: true,
    confirmation: { type: "redirect" as const, return_url: returnUrl },
    description: description.slice(0, 128),
    metadata,
    receipt,
  };

  if (savePaymentMethod) {
    body.save_payment_method = true;
  }

  const idempotenceKey = `${metadata.payment_id ?? "pay"}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const auth = Buffer.from(`${shopId.trim()}:${secretKey.trim()}`).toString("base64");

  let res: Response | null = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const proxy = await getProxyUrl("payments");
      res = await proxyFetch(`${YOOKASSA_API}/payments`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "Idempotence-Key": idempotenceKey,
          Authorization: `Basic ${auth}`,
          Connection: "close",
        },
        body: JSON.stringify(body),
      }, proxy);
      clearTimeout(timeoutId);
      break;
    } catch (e) {
      clearTimeout(timeoutId);
      lastError = e;
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        continue;
      }
    }
  }

  if (!res) {
    const message = lastError instanceof Error ? lastError.message : String(lastError);
    const isNetwork =
      message === "fetch failed" ||
      message.includes("ECONNREFUSED") ||
      message.includes("ENOTFOUND") ||
      message.includes("ETIMEDOUT") ||
      message.includes("network") ||
      (lastError instanceof Error && lastError.name === "AbortError");
    if (isNetwork) {
      return {
        ok: false,
        error:
          "Сервер не может подключиться к ЮKassa (api.yookassa.ru). Проверьте доступ в интернет, firewall и DNS на сервере.",
      };
    }
    return { ok: false, error: message };
  }

  let data: {
    id?: string;
    status?: string;
    confirmation?: { confirmation_url?: string };
    description?: string;
    code?: string;
    parameter?: string;
    [key: string]: unknown;
  };

  try {
    data = (await res.json()) as typeof data;
  } catch {
    return { ok: false, error: `YooKassa: ответ не JSON (${res.status})`, status: res.status };
  }

  if (!res.ok) {
    const parts = [data.description ?? data.code ?? res.statusText ?? "YooKassa error"];
    if (data.parameter) parts.push(`Параметр: ${data.parameter}`);
    return { ok: false, error: parts.join(". "), status: res.status };
  }

  const confirmationUrl = data.confirmation?.confirmation_url;
  if (!data.id || !confirmationUrl) {
    return { ok: false, error: "No id or confirmation_url in response" };
  }

  return {
    ok: true,
    paymentId: data.id,
    confirmationUrl,
    status: data.status ?? "pending",
  };
}

export function isYookassaConfigured(shopId: string | null, secretKey: string | null): boolean {
  return Boolean(shopId?.trim() && secretKey?.trim());
}

// ────────────────────────────────────────────
// Автоплатёж по сохранённому способу оплаты
// ────────────────────────────────────────────

export type AutopaymentParams = {
  shopId: string;
  secretKey: string;
  amount: number;
  currency: string;
  paymentMethodId: string;
  description: string;
  metadata: Record<string, string>;
  customerEmail?: string | null;
  customerTelegramUsername?: string | null;
};

export type AutopaymentResult =
  | { ok: true; paymentId: string; status: string }
  | { ok: false; error: string; reason?: string };

export async function createYookassaAutopayment(params: AutopaymentParams): Promise<AutopaymentResult> {
  const { shopId, secretKey, amount, currency, paymentMethodId, description, metadata, customerEmail, customerTelegramUsername } = params;
  if (!shopId?.trim() || !secretKey?.trim()) {
    return { ok: false, error: "YooKassa not configured" };
  }

  const valueStr = amount.toFixed(2);
  const currencyUpper = currency.toUpperCase();

  const receipt = {
    customer: {
      email: (customerEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail))
        ? customerEmail.trim()
        : generatePlaceholderEmail(customerTelegramUsername),
    },
    tax_system_code: 2,
    items: [
      {
        description: description.slice(0, 128) || "Автопродление подписки",
        quantity: "1.00",
        amount: { value: valueStr, currency: currencyUpper },
        vat_code: 7,
        payment_subject: "service" as const,
        payment_mode: "full_payment" as const,
      },
    ],
  };

  const body = {
    amount: { value: valueStr, currency: currencyUpper },
    capture: true,
    payment_method_id: paymentMethodId,
    description: description.slice(0, 128),
    metadata,
    receipt,
  };

  const idempotenceKey = `autopay-${metadata.payment_id ?? "pay"}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const auth = Buffer.from(`${shopId.trim()}:${secretKey.trim()}`).toString("base64");

  let res: Response | null = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const proxy = await getProxyUrl("payments");
      res = await proxyFetch(`${YOOKASSA_API}/payments`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "Idempotence-Key": idempotenceKey,
          Authorization: `Basic ${auth}`,
          Connection: "close",
        },
        body: JSON.stringify(body),
      }, proxy);
      clearTimeout(timeoutId);
      break;
    } catch (e) {
      clearTimeout(timeoutId);
      lastError = e;
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        continue;
      }
    }
  }

  if (!res) {
    const message = lastError instanceof Error ? lastError.message : String(lastError);
    const isNetwork =
      message === "fetch failed" ||
      message.includes("ECONNREFUSED") ||
      message.includes("ENOTFOUND") ||
      message.includes("ETIMEDOUT") ||
      message.includes("network") ||
      (lastError instanceof Error && lastError.name === "AbortError");
    if (isNetwork) {
      return { ok: false, error: "Сервер не может подключиться к ЮKassa" };
    }
    return { ok: false, error: message };
  }

  let data: {
    id?: string;
    status?: string;
    cancellation_details?: { party?: string; reason?: string };
    description?: string;
    code?: string;
    [key: string]: unknown;
  };

  try {
    data = (await res.json()) as typeof data;
  } catch {
    return { ok: false, error: `YooKassa: ответ не JSON (${res.status})` };
  }

  if (!res.ok) {
    return { ok: false, error: data.description ?? data.code ?? res.statusText ?? "YooKassa error" };
  }

  if (!data.id) {
    return { ok: false, error: "No payment id in response" };
  }

  if (data.status === "succeeded") {
    return { ok: true, paymentId: data.id, status: data.status };
  }

  if (data.status === "canceled") {
    const reason = data.cancellation_details?.reason ?? "unknown";
    return { ok: false, error: `Автоплатёж отклонён: ${reason}`, reason };
  }

  return {
    ok: false,
    error: `Автоплатёж не завершён (статус: ${data.status ?? "unknown"})`,
    reason: data.status ?? undefined,
  };
}

/**
 * Статус платежа по данным самой ЮKassa (с поддержкой proxyFetch).
 */
export async function getYookassaPaymentStatus(
  shopId: string,
  secretKey: string,
  yookassaPaymentId: string,
): Promise<{ status: string | null; amount: string | null }> {
  if (!shopId?.trim() || !secretKey?.trim() || !yookassaPaymentId?.trim()) {
    return { status: null, amount: null };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const auth = Buffer.from(`${shopId.trim()}:${secretKey.trim()}`).toString("base64");
    const proxy = await getProxyUrl("payments");
    const res = await proxyFetch(
      `${YOOKASSA_API}/payments/${encodeURIComponent(yookassaPaymentId.trim())}`,
      {
        method: "GET",
        headers: {
          Authorization: `Basic ${auth}`,
          Connection: "close",
        },
        signal: ctrl.signal,
      },
      proxy
    );
    if (!res.ok) return { status: null, amount: null };
    const data = (await res.json()) as { status?: string; amount?: { value?: string } };
    return { status: data?.status ?? null, amount: data?.amount?.value ?? null };
  } catch {
    return { status: null, amount: null };
  } finally {
    clearTimeout(timer);
  }
}
