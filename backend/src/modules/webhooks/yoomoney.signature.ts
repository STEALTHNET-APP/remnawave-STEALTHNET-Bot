/**
 * backend/src/modules/webhooks/yoomoney.signature.ts
 * Утилиты проверки подлинности HTTP-уведомлений ЮMoney.
 */

import { createHash, createHmac } from "node:crypto";

export function pickFirst(val: unknown): string {
  if (val == null) return "";
  if (Array.isArray(val)) return String(val[0] ?? "").trim();
  return String(val).trim();
}

/**
 * Валидация новой подписи ЮMoney по HMAC-SHA256:
 * 1. Исключаем поле sign
 * 2. Сортируем параметры по алфавиту ключей
 * 3. Формируем строку key=encodeURIComponent(value) через &
 * 4. Сравниваем вычисленный HMAC-SHA256 с полученным sign (регистронезависимо)
 */
export function verifyYooMoneyHmacSign(body: Record<string, unknown>, secret: string): boolean {
  let receivedSign = pickFirst(body.sign);
  if (!receivedSign) {
    for (const [k, v] of Object.entries(body)) {
      if (k.toLowerCase() === "sign") {
        receivedSign = pickFirst(v);
        break;
      }
    }
  }
  if (!receivedSign) return false;

  const params: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (key.toLowerCase() === "sign") continue;
    params[key] = value;
  }

  const sortedKeys = Object.keys(params).sort();
  const dataString = sortedKeys
    .map((key) => {
      const value = pickFirst(params[key]);
      return `${key}=${encodeURIComponent(value)}`;
    })
    .join("&");

  const computedSign = createHmac("sha256", secret)
    .update(dataString, "utf8")
    .digest("hex");

  return computedSign.toLowerCase() === receivedSign.toLowerCase();
}

/**
 * Валидация легаси-подписи ЮMoney по SHA-1
 */
export function computeYooMoneySha1(
  notificationType: string,
  operationId: string,
  amount: string,
  currency: string,
  datetime: string,
  sender: string,
  codepro: string,
  notificationSecret: string,
  label: string
): string {
  const str = [
    notificationType,
    operationId,
    amount,
    currency,
    datetime,
    sender,
    codepro,
    notificationSecret,
    label,
  ].join("&");
  return createHash("sha1").update(str, "utf8").digest("hex");
}
