/**
 * RollyPay — приём рублёвых платежей (СБП, карты, крипта) с конвертацией в USDT.
 *
 * Документация: https://docs.rollypay.io
 *   • создание платежа — POST {base}/api/v1/payments
 *   • статус         — GET  {base}/api/v1/payments/{paymentID}
 *   • аутентификация — заголовки X-API-Key (ключ кассы) и X-Nonce (уникальный
 *     на запрос; повтор в течение 10 минут → 401 «nonce already used»)
 *   • вебхуки        — подпись HMAC-SHA256 по строке `timestamp + "." + rawBody`,
 *     приходит в X-Signature, время — в X-Timestamp
 *
 * Подписи самих запросов у RollyPay нет — signing_secret нужен только для
 * проверки вебхуков.
 */

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const API_BASE = "https://rollypay.io";
const REQUEST_TIMEOUT_MS = 15_000;
/** Насколько старым может быть X-Timestamp вебхука (защита от переигрывания). */
const WEBHOOK_MAX_AGE_SEC = 15 * 60;

export type RollypayConfig = {
  apiKey: string;
  signingSecret: string;
  /** true — платежи создаются в песочнице (поле `test` в запросе) */
  testMode?: boolean;
};

export function isRollypayConfigured(config: RollypayConfig | null): boolean {
  return Boolean(config?.apiKey?.trim() && config?.signingSecret?.trim());
}

export type CreateRollypayPaymentParams = {
  config: RollypayConfig;
  /** Сумма в фиате строкой, например "1500.00" */
  amount: string;
  /** Код валюты платежа, по умолчанию RUB */
  currency: string;
  orderId: string;
  description?: string;
  customerId?: string;
  successRedirectUrl?: string;
  failRedirectUrl?: string;
  metadata?: Record<string, unknown>;
};

export type CreateRollypayPaymentResult =
  | { ok: true; url: string; paymentId: string | null }
  | { ok: false; error: string };

interface RollypayPaymentResponse {
  payment_id?: string;
  order_id?: string;
  status?: string;
  pay_url?: string;
  message?: string;
  error?: string;
}

/** Ошибку провайдера показываем как есть — админу так понятнее, что не так с кассой. */
function describeError(status: number, body: RollypayPaymentResponse | null, raw: string): string {
  const detail = body?.message ?? body?.error ?? raw.slice(0, 200);
  if (status === 401) return `RollyPay: неверный ключ кассы или повтор nonce (${detail})`;
  return `RollyPay вернул ${status}: ${detail || "без описания"}`;
}

export async function createRollypayPayment(
  params: CreateRollypayPaymentParams,
): Promise<CreateRollypayPaymentResult> {
  const { config } = params;
  if (!isRollypayConfigured(config)) return { ok: false, error: "RollyPay не настроен" };

  // RollyPay принимает сумму строкой с двумя знаками.
  const amount = Number(params.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "Некорректная сумма платежа" };

  // RollyPay — рублёвый шлюз. Отправить другую валюту нельзя: он ответит 400,
  // а если молча подставить RUB, клиент заплатит долларовую цену рублями.
  const currency = (params.currency || "RUB").toUpperCase();
  if (currency !== "RUB") {
    return { ok: false, error: `RollyPay принимает только рубли, а цена указана в ${currency}` };
  }

  const payload: Record<string, unknown> = {
    amount: amount.toFixed(2),
    payment_currency: currency,
    order_id: params.orderId,
    ...(params.description ? { description: params.description } : {}),
    ...(params.customerId ? { customer_id: params.customerId } : {}),
    ...(params.successRedirectUrl ? { success_redirect_url: params.successRedirectUrl } : {}),
    ...(params.failRedirectUrl ? { fail_redirect_url: params.failRedirectUrl } : {}),
    ...(params.metadata ? { metadata: params.metadata } : {}),
    ...(config.testMode ? { test: true } : {}),
  };

  // Способ оплаты (sbp/card/crypto) намеренно не задаём — клиент выбирает его
  // на странице RollyPay, у нас в интерфейсе одна кнопка.

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/api/v1/payments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": config.apiKey.trim(),
        "X-Nonce": randomUUID(),
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });

    const raw = await res.text();
    let body: RollypayPaymentResponse | null = null;
    try {
      body = raw ? (JSON.parse(raw) as RollypayPaymentResponse) : null;
    } catch {
      /* не-JSON ответ обработаем ниже как ошибку */
    }

    if (!res.ok) return { ok: false, error: describeError(res.status, body, raw) };

    const url = body?.pay_url?.trim();
    if (!url) return { ok: false, error: "RollyPay не вернул ссылку на оплату" };

    return { ok: true, url, paymentId: body?.payment_id ?? null };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { ok: false, error: "RollyPay не ответил вовремя" };
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Проверка подписи вебхука.
 *
 * Подписывается СЫРОЕ тело: `timestamp + "." + rawBody`. Разбирать и снова
 * сериализовать JSON нельзя — порядок ключей и пробелы изменятся, и подпись
 * перестанет сходиться.
 */
export function verifyRollypayWebhookSignature(
  signingSecret: string,
  rawBody: string,
  timestamp: string | undefined,
  signature: string | undefined,
): boolean {
  const secret = signingSecret?.trim();
  const ts = timestamp?.trim();
  const sig = signature?.trim();
  if (!secret || !ts || !sig) return false;

  // Слишком старый вебхук не принимаем: иначе перехваченный запрос можно
  // переиграть в любой момент.
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) return false;
  const ageSec = Math.abs(Date.now() / 1000 - tsNum);
  if (ageSec > WEBHOOK_MAX_AGE_SEC) return false;

  const expected = createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(sig.toLowerCase(), "utf8");
  // timingSafeEqual падает на разной длине — сравниваем её отдельно.
  return a.length === b.length && timingSafeEqual(a, b);
}
