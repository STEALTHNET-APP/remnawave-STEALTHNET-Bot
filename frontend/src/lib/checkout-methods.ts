import type { PublicConfig } from "./api";

/**
 * Справочник способов оплаты для экранов Aurora.
 *
 * Модуль намеренно не импортирует API-клиент: список методов и форматирование
 * сумм — чистые функции, которые можно покрывать юнит-тестами в Node.
 */

export type CheckoutMethodKind =
  | "balance"
  | "platega"
  | "yookassa"
  | "yoomoney"
  | "telegram_stars"
  | "cryptopay"
  | "heleket"
  | "rollypay"
  | "paritypay"
  | "cloudpayments"
  | "lava"
  | "overpay";

export interface CheckoutMethod {
  id: string;
  kind: CheckoutMethodKind;
  label: string;
  subLabel?: string;
  plategaId?: number;
}

const DEFAULT_ORDER: CheckoutMethodKind[] = [
  "platega",
  "yookassa",
  "yoomoney",
  "telegram_stars",
  "cryptopay",
  "heleket",
  "rollypay",
  "paritypay",
  "cloudpayments",
  "lava",
  "overpay",
];

const YOOMONEY_FALLBACK_TITLE = "ЮMoney";

function isRub(currency: string): boolean {
  return currency.trim().toUpperCase() === "RUB";
}

/** Список способов оплаты с учётом флагов public config и валюты товара. */
export function checkoutMethods(
  config: PublicConfig | null,
  currency: string,
  opts: {
    balanceAvailable?: boolean;
    balanceLabel?: string;
    hasTelegram?: boolean;
  } = {},
): CheckoutMethod[] {
  const list: CheckoutMethod[] = [];
  const rub = isRub(currency);

  if (opts.balanceAvailable) {
    list.push({ id: "balance", kind: "balance", label: opts.balanceLabel ?? "Оплатить с баланса" });
  }
  if (!config) return list;

  const labels = new Map((config.paymentProviders ?? []).map((p) => [p.id, p.label]));
  const label = (id: string, fallback: string) => labels.get(id)?.trim() || fallback;

  for (const m of config.plategaMethods ?? []) {
    list.push({ id: `platega_${m.id}`, kind: "platega", label: m.label, plategaId: m.id });
  }
  if (config.yookassaEnabled && rub) {
    list.push({ id: "yookassa", kind: "yookassa", label: label("yookassa", "Карта / СБП"), subLabel: "ЮKassa" });
  }
  if (config.yoomoneyEnabled && rub) {
    list.push({ id: "yoomoney", kind: "yoomoney", label: label("yoomoney", YOOMONEY_FALLBACK_TITLE), subLabel: "Кошелёк или карта" });
  }
  if (config.telegramStarsEnabled && rub && opts.hasTelegram !== false) {
    list.push({ id: "telegram_stars", kind: "telegram_stars", label: "Telegram Stars", subLabel: "Оплата звёздами" });
  }
  if (config.cryptopayEnabled) {
    list.push({ id: "cryptopay", kind: "cryptopay", label: label("cryptopay", "Crypto Bot"), subLabel: "USDT, TON, BTC" });
  }
  if (config.heleketEnabled) {
    list.push({ id: "heleket", kind: "heleket", label: label("heleket", "Heleket"), subLabel: "Криптовалюта" });
  }
  if (config.rollypayEnabled && rub) {
    list.push({ id: "rollypay", kind: "rollypay", label: label("rollypay", "RollyPay"), subLabel: "Банковские карты" });
  }
  if (config.paritypayEnabled && rub) {
    list.push({ id: "paritypay", kind: "paritypay", label: label("paritypay", "ParityPay"), subLabel: "Банковские карты" });
  }
  if (config.cloudpaymentsEnabled && rub) {
    list.push({ id: "cloudpayments", kind: "cloudpayments", label: label("cloudpayments", "CloudPayments"), subLabel: "Банковские карты" });
  }
  if (config.lavaEnabled && rub) {
    list.push({ id: "lava", kind: "lava", label: label("lava", "LAVA"), subLabel: "Карты и кошельки" });
  }
  if (config.overpayEnabled) {
    list.push({ id: "overpay", kind: "overpay", label: label("overpay", "Overpay"), subLabel: "Карты и платёжные системы" });
  }

  const order = new Map((config.paymentProviders ?? []).map((p, i) => [p.id, p.sortOrder ?? i]));
  const fallback = new Map(DEFAULT_ORDER.map((id, i) => [id, 100 + i]));
  return list.sort((a, b) => {
    if (a.kind === "balance") return -1;
    if (b.kind === "balance") return 1;
    const rank = (m: CheckoutMethod) => order.get(m.kind) ?? fallback.get(m.kind) ?? 999;
    return rank(a) - rank(b);
  });
}

export function currencySymbol(currency: string): string {
  const code = currency.trim().toUpperCase();
  if (code === "RUB") return "₽";
  if (code === "USD") return "$";
  if (code === "EUR") return "€";
  return code;
}

export function formatCheckoutAmount(amount: number, currency: string, language: string): string {
  try {
    return new Intl.NumberFormat(language, {
      style: "currency",
      currency: currency.trim().toUpperCase(),
      minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount} ${currencySymbol(currency)}`;
  }
}
