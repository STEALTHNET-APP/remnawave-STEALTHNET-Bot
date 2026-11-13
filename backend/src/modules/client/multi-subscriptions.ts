/**
 * Единое чтение настройки `multi_subscriptions_enabled`.
 *
 * Строго: включено ТОЛЬКО "true" или "1" (trim, без учёта регистра). Всё остальное,
 * включая отсутствие ключа, "0", "False", "off" — single-режим. Раньше парсер
 * `!== "false"` считал "0"/"False" включёнными, а потребители подставляли `?? true`
 * при сбое чтения конфига — и мульти-режим включался там, где оператор его выключил.
 */
export function parseMultiSubscriptionsEnabled(raw: string | null | undefined): boolean {
  const { enabled, recognised } = describeMultiSubscriptionsRaw(raw);
  if (!recognised) {
    console.warn(`[settings] multi_subscriptions_enabled=${JSON.stringify(raw)} не распознано — считаем ВЫКЛ (single-режим). Допустимо: true/1/false/0.`);
  }
  return enabled;
}

/** Разбор без побочных эффектов: recognised=false для непустых значений вне true/1/false/0. */
export function describeMultiSubscriptionsRaw(raw: string | null | undefined): { enabled: boolean; recognised: boolean } {
  const v = (raw ?? "").trim().toLowerCase();
  const enabled = v === "true" || v === "1";
  return { enabled, recognised: enabled || v === "" || v === "false" || v === "0" };
}

/** Флаг из уже загруженного системного конфига. Нет конфига/флага → OFF (никогда не ON по умолчанию). */
export function isMultiSubscriptionsEnabled(
  config: { multiSubscriptionsEnabled?: boolean | null } | null | undefined,
): boolean {
  return config?.multiSubscriptionsEnabled === true;
}
