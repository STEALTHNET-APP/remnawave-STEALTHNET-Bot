/**
 * Чистый расчёт плана автопродления доп. подписки (issue #195).
 *
 * Цена и длительность всегда берутся из ОДНОГО источника: либо из опции тарифа,
 * либо из legacy-полей самого тарифа. Смешивать (цена 31-дневной опции + дни
 * самой дешёвой) нельзя — именно это и было багом.
 */

export interface RenewPlanSubscription {
  tariffId: string | null;
  autoRenewTariffId: string | null;
  autoRenewPriceOptionId: string | null;
  customPrice: number | null;
  extraDevicesMonthlyPrice: number | null;
}

export interface RenewPlanTariff {
  id: string;
  price: number;
  durationDays: number;
}

export interface RenewPlanOption {
  id: string;
  tariffId: string;
  durationDays: number;
  price: number;
}

export interface SecondaryRenewPlan {
  tariffId: string;
  /** null — опция не определена, используются legacy price/durationDays тарифа. */
  optionId: string | null;
  durationDays: number;
  basePrice: number;
}

const PRICE_EPSILON = 0.005;

/** schema.prisma: autoRenewTariffId — тариф автопродления; null → продлеваем текущий tariffId. */
export function resolveSecondaryRenewTariffId(
  sub: Pick<RenewPlanSubscription, "tariffId" | "autoRenewTariffId">,
): string | null {
  return sub.autoRenewTariffId ?? sub.tariffId ?? null;
}

export function resolveSecondaryRenewPlan(
  sub: RenewPlanSubscription,
  tariff: RenewPlanTariff,
  options: readonly RenewPlanOption[],
): SecondaryRenewPlan {
  const own = options.filter((o) => o.tariffId === tariff.id);
  const fromOption = (o: RenewPlanOption): SecondaryRenewPlan => ({
    tariffId: tariff.id,
    optionId: o.id,
    durationDays: o.durationDays,
    basePrice: o.price,
  });

  const saved = sub.autoRenewPriceOptionId
    ? own.find((o) => o.id === sub.autoRenewPriceOptionId)
    : undefined;
  if (saved) return fromOption(saved);

  const customPrice = sub.customPrice != null && sub.customPrice > 0 ? sub.customPrice : null;
  if (customPrice != null) {
    const byPrice = own.find((o) => Math.abs(o.price - customPrice) < PRICE_EPSILON);
    if (byPrice) return fromOption(byPrice);
  }

  const durationDays = tariff.durationDays || 30;
  // У тарифа без опций customPrice родился из этого же тарифа (покупка по tariff.price,
  // старый накопитель доп. опций) — сохраняем прежнее поведение. Если опции есть, а
  // customPrice ни с одной не совпал, он мог прийти из другой опции — берём тариф целиком.
  const hasExtras = (sub.extraDevicesMonthlyPrice ?? 0) > 0;
  const basePrice = own.length === 0 && !hasExtras && customPrice != null ? customPrice : tariff.price;
  return { tariffId: tariff.id, optionId: null, durationDays, basePrice };
}

/** Итог к списанию: база + доп. устройства за период + персональная скидка (формула как была). */
export function computeSecondaryRenewPrice(
  plan: SecondaryRenewPlan,
  extraDevicesMonthlyPrice: number,
  personalDiscountPercent: number,
): number {
  const extrasForPeriod = extraDevicesMonthlyPrice > 0
    ? Math.floor(extraDevicesMonthlyPrice * (plan.durationDays / 30))
    : 0;
  const priceBeforeDiscount = plan.basePrice + extrasForPeriod;
  const priceRaw = personalDiscountPercent > 0
    ? Math.max(0, Math.floor(priceBeforeDiscount * (1 - personalDiscountPercent / 100)))
    : priceBeforeDiscount;
  return Math.round(priceRaw * 100) / 100;
}
