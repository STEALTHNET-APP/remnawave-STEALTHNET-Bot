import type { Prisma } from "@prisma/client";

/**
 * Клиенты, которых обрабатывает legacy-цикл автопродления (`processAutoRenewals`,
 * клиентский уровень: Client.autoRenewEnabled + Remnawave-пользователь клиента).
 * Цикл дополнительно пропускает клиента, у которого Subscription[0].autoRenewEnabled === true.
 */
export const LEGACY_AUTO_RENEW_CLIENT_WHERE = {
  autoRenewEnabled: true,
  autoRenewTariffId: { not: null },
  remnawaveUuid: { not: null },
  isBlocked: false,
} satisfies Prisma.ClientWhereInput;

/**
 * Фильтр подписок для авто-рассылок об истечении: исключает Subscription[0] клиентов из
 * legacy-цикла (они уже получают свои напоминания автосписания). Вместе с условием
 * `autoRenewEnabled: false` у подписки множества не пересекаются: legacy-цикл берёт только
 * подписки с Subscription[0].autoRenewEnabled !== true.
 */
export function excludeLegacyAutoRenewSubs(): Prisma.SubscriptionWhereInput {
  return { NOT: { subscriptionIndex: 0, owner: LEGACY_AUTO_RENEW_CLIENT_WHERE } };
}
