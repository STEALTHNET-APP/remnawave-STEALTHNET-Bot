/**
 * Platega.io — создание платежей и обработка callback
 * https://docs.platega.io/
 */

import { proxyFetch } from "../proxy-util/proxy-fetch.js";
import { getProxyUrl } from "../proxy-util/get-proxy-url.js";

const PLATEGA_API_BASE = "https://app.platega.io";

export type PlategaConfig = {
  merchantId: string;
  secret: string;
};

export function isPlategaConfigured(config: PlategaConfig | null): boolean {
  return Boolean(config?.merchantId?.trim() && config?.secret?.trim());
}

/**
 * Создать транзакцию в Platega, получить ссылку на оплату
 * paymentMethod: 2=СБП, 11=Карты, 12=Международный, 13=Криптовалюта
 */
export async function createPlategaTransaction(
  config: PlategaConfig,
  params: {
    amount: number;
    currency: string;
    orderId: string;
    paymentMethod: number;
    returnUrl: string;
    failedUrl: string;
    description?: string;
  }
): Promise<{ paymentUrl: string; transactionId: string } | { error: string }> {
  const { amount, currency, orderId, paymentMethod, returnUrl, failedUrl, description } = params;
  const url = `${PLATEGA_API_BASE}/transaction/process`;
  const body: Record<string, unknown> = {
    paymentMethod: Number(paymentMethod) || 2,
    paymentDetails: { amount: Number(amount), currency: currency.toUpperCase() },
    description: description || `Оплата заказа ${orderId}`,
    return: returnUrl,
    failedUrl,
    payload: orderId, // orderId передаём через payload — единственное кастомное поле в API Platega
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-MerchantId": config.merchantId.trim(),
    "X-Secret": config.secret.trim(),
  };

  try {
    const proxy = await getProxyUrl("payments");
    const res = await proxyFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }, proxy);

    const text = await res.text();
    let data: Record<string, unknown>;
    try {
      data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      return { error: `Platega: invalid response (${res.status})` };
    }

    if (res.status === 401) {
      return { error: "Platega: неверный Merchant ID или секрет" };
    }
    if (res.status !== 200) {
      const msg = (data.message as string) || (data.error as string) || text?.slice(0, 200);
      return { error: `Platega: ${msg}` };
    }

    const paymentUrl = (data.redirect as string) || (data.url as string) || (data.paymentUrl as string);
    const transactionId = (data.transactionId as string) || (data.id as string);

    if (!paymentUrl) {
      return { error: "Platega не вернул ссылку на оплату" };
    }

    return { paymentUrl, transactionId: transactionId || "" };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { error: `Platega: ${message}` };
  }
}

/**
 * Проверка статуса транзакции через Platega API.
 * Используется как двойная защита webhook'а: даже если атакер прислал поддельный
 * webhook с правильным transactionId — Platega API вернёт реальный статус, и
 * мы пометим платёж только если API подтверждает.
 *
 * Endpoint: `POST /transaction/status` с `{ transactionId }` в теле и
 * `X-MerchantId` + `X-Secret` в заголовках. Если у Platega окажется другой
 * формат (`GET /transaction/{id}` или `GET /transactions/:id`) — fallback
 * пробует и его.
 */
export async function getPlategaTransactionStatus(
  config: PlategaConfig,
  transactionId: string,
): Promise<
  | { ok: true; status: string; id?: string; amount?: number; currency?: string; payload?: string; raw: Record<string, unknown> }
  | { error: string; status?: number }
> {
  if (!transactionId.trim()) return { error: "transactionId required" };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-MerchantId": config.merchantId.trim(),
    "X-Secret": config.secret.trim(),
  };
  const proxy = await getProxyUrl("payments");

  // 1) Основной endpoint — POST /transaction/status (как в openapi-style API).
  const candidates: { url: string; method: "GET" | "POST"; body?: string }[] = [
    { url: `${PLATEGA_API_BASE}/transaction/status`, method: "POST", body: JSON.stringify({ id: transactionId }) },
    { url: `${PLATEGA_API_BASE}/transaction/${encodeURIComponent(transactionId)}`, method: "GET" },
    { url: `${PLATEGA_API_BASE}/transactions/${encodeURIComponent(transactionId)}`, method: "GET" },
  ];

  let lastErr = "no candidates tried";
  let lastStatus: number | undefined;

  for (const c of candidates) {
    try {
      const res = await proxyFetch(c.url, {
        method: c.method,
        headers,
        body: c.body,
      }, proxy);
      lastStatus = res.status;
      const text = await res.text();

      // Если 401/403 — креды неверные, дальше пробовать бесполезно.
      if (res.status === 401 || res.status === 403) {
        return { error: "Platega: неверные креды merchantId/secret", status: res.status };
      }
      // Если 404/405 — этот endpoint не существует, пробуем следующий.
      if (res.status === 404 || res.status === 405) {
        lastErr = `${c.method} ${c.url} → ${res.status}`;
        continue;
      }
      if (!res.ok) {
        lastErr = `${c.method} ${c.url} → ${res.status} ${text?.slice(0, 200)}`;
        continue;
      }

      let data: Record<string, unknown> = {};
      try {
        data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        return { error: "Platega: невалидный JSON в ответе" };
      }

      // Извлекаем status из разных возможных полей (как делает webhook handler).
      const tx = (data.transaction && typeof data.transaction === "object")
        ? (data.transaction as Record<string, unknown>)
        : {};
      const statusStr = String(
        data.status ?? tx.status ?? data.state ?? data.paymentStatus ?? data.payment_status ?? "",
      ).trim();
      if (!statusStr) {
        return { error: "Platega: API ответил без status" };
      }

      // Документированный ответ Platega: `paymentDetails: { amount, currency }` и `payload`
      // (то же, что мы шлём в /transaction/process). Плоские поля — для совместимости.
      const details = (data.paymentDetails && typeof data.paymentDetails === "object")
        ? (data.paymentDetails as Record<string, unknown>)
        : {};
      const amountRaw = details.amount ?? data.amount ?? tx.amount;
      const currencyRaw = details.currency ?? data.currency ?? tx.currency;
      const amountNum = typeof amountRaw === "number" ? amountRaw : typeof amountRaw === "string" ? Number(amountRaw) : NaN;
      const amount = Number.isFinite(amountNum) ? amountNum : undefined;
      const currency = typeof currencyRaw === "string" && currencyRaw.trim() ? currencyRaw.trim() : undefined;
      const payloadRaw = data.payload ?? tx.payload;
      const payload = typeof payloadRaw === "string" && payloadRaw.trim() ? payloadRaw.trim() : undefined;
      const idRaw = data.id ?? data.transactionId ?? tx.id;
      const id = typeof idRaw === "string" && idRaw.trim() ? idRaw.trim() : undefined;

      return { ok: true, status: statusStr, id, amount, currency, payload, raw: data };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }

  return { error: `Platega API status check failed: ${lastErr}`, status: lastStatus };
}

export type PlategaBindingPayment = {
  orderId: string;
  externalId: string | null;
  amount: number;
  currency: string;
};

export type PlategaApiTransaction = {
  id?: string;
  amount?: number;
  currency?: string;
  payload?: string;
};

export type PlategaBindingResult = { ok: true } | { ok: false; reason: string };

/** Допуск на округление при сравнении суммы (в рублях — те же единицы, что в /transaction/process). */
const PLATEGA_AMOUNT_TOLERANCE = 0.01;

function storedPlategaTxId(payment: PlategaBindingPayment): string | null {
  const id = payment.externalId?.trim();
  return id ? id : null;
}

/**
 * Id транзакции, которую надо проверять через API: выданный Platega при создании
 * нашего платежа (externalId), а для старых платежей без него — id из webhook'а.
 */
export function plategaTxIdToVerify(payment: PlategaBindingPayment, webhookTxId: string | null): string | null {
  return storedPlategaTxId(payment) ?? (webhookTxId?.trim() || null);
}

/** Webhook должен ссылаться на ту же транзакцию, что Platega выдала при создании платежа. */
export function checkPlategaWebhookTxId(payment: PlategaBindingPayment, webhookTxId: string | null): PlategaBindingResult {
  const stored = storedPlategaTxId(payment);
  const incoming = webhookTxId?.trim();
  if (stored && incoming && incoming !== stored) {
    return { ok: false, reason: `transaction id mismatch: webhook=${incoming} stored=${stored}` };
  }
  return { ok: true };
}

/**
 * Проверка, что подтверждённая Platega API транзакция относится к этому платежу:
 * тот же id, тот же payload (orderId), та же сумма и валюта.
 * Без сохранённого id (старые платежи) payload из ответа API обязателен.
 */
export function checkPlategaBinding(
  payment: PlategaBindingPayment,
  webhookTxId: string | null,
  apiTx: PlategaApiTransaction,
): PlategaBindingResult {
  const idCheck = checkPlategaWebhookTxId(payment, webhookTxId);
  if (!idCheck.ok) return idCheck;

  const expectedId = plategaTxIdToVerify(payment, webhookTxId);
  if (apiTx.id && expectedId && apiTx.id !== expectedId) {
    return { ok: false, reason: `api transaction id mismatch: api=${apiTx.id} expected=${expectedId}` };
  }

  if (apiTx.payload !== undefined) {
    if (apiTx.payload !== payment.orderId) {
      return { ok: false, reason: `payload mismatch: api=${apiTx.payload} orderId=${payment.orderId}` };
    }
  } else if (!storedPlategaTxId(payment)) {
    return { ok: false, reason: "no stored transaction id and api returned no payload" };
  }

  if (apiTx.amount !== undefined && Math.abs(apiTx.amount - payment.amount) > PLATEGA_AMOUNT_TOLERANCE) {
    return { ok: false, reason: `amount mismatch: api=${apiTx.amount} expected=${payment.amount}` };
  }

  if (apiTx.currency && payment.currency && apiTx.currency.toUpperCase() !== payment.currency.toUpperCase()) {
    return { ok: false, reason: `currency mismatch: api=${apiTx.currency} expected=${payment.currency}` };
  }

  return { ok: true };
}
