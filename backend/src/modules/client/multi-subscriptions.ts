/**
 * Единое чтение настройки `multi_subscriptions_enabled`.
 *
 * Строго: включено ТОЛЬКО "true" или "1" (trim, без учёта регистра). Всё остальное,
 * включая отсутствие ключа, "0", "False", "off" — single-режим. Раньше парсер
 * `!== "false"` считал "0"/"False" включёнными, а потребители подставляли `?? true`
 * при сбое чтения конфига — и мульти-режим включался там, где оператор его выключил.
 */
export function parseMultiSubscriptionsEnabled(raw: string | null | undefined): boolean {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "true" || v === "1";
}

/** Флаг из уже загруженного системного конфига. Нет конфига/флага → OFF (никогда не ON по умолчанию). */
export function isMultiSubscriptionsEnabled(
  config: { multiSubscriptionsEnabled?: boolean | null } | null | undefined,
): boolean {
  return config?.multiSubscriptionsEnabled === true;
}
