import { z } from "zod";
import { prisma } from "../../db.js";
import { getSystemConfig } from "./client.service.js";
import { remnaGetUser } from "../remna/remna.client.js";

/**
 * вычисляет коэффициент масштабирования цены для доп. устройств.
 * Если в подписке осталось > 30 дней → цена = basePrice × (remainingDays / 30).
 * Иначе минимум = basePrice.
 * Если targetSubId не передан или sub не найдена → коэффициент = 1 (полная цена).
 */
// T-extras-prorata-fix (портировано из WolfVPN): expireAt из Remna, если в БД пусто
// (частый рассинхрон для primary #0 — иначе coef=1 и цена за полный месяц вместо pro-rata).
export function extractRemnaExpireAt(data: unknown): Date | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const inner = (d.response && typeof d.response === "object" ? d.response : d) as Record<string, unknown>;
  const raw = inner.expireAt ?? inner.expire_at;
  if (typeof raw === "string" || typeof raw === "number") {
    const dt = new Date(raw);
    if (!isNaN(dt.getTime())) return dt;
  }
  return null;
}

export async function resolveSubExpireAt(expireAtDb: Date | null, remnawaveUuid: string | null | undefined): Promise<Date | null> {
  if (expireAtDb) return expireAtDb;
  if (!remnawaveUuid) return null;
  const u = await remnaGetUser(remnawaveUuid).catch(() => null);
  if (!u || u.error || !u.data) return null;
  return extractRemnaExpireAt(u.data);
}

export async function calculateDevicesProrataPriceCoefficient(targetSubId: string | null | undefined): Promise<number> {
  if (!targetSubId) return 1;
  const sub = await prisma.subscription.findUnique({
    where: { id: targetSubId },
    select: { expireAt: true, remnawaveUuid: true },
  }).catch(() => null);
  if (!sub) return 1;
  const expireAt = await resolveSubExpireAt(sub.expireAt, sub.remnawaveUuid);
  if (!expireAt) return 1;
  const daysLeft = (expireAt.getTime() - Date.now()) / 86_400_000;
  if (daysLeft <= 0) {
    const error = new Error("Нельзя купить опцию для истёкшей подписки. Сначала продлите подписку.") as Error & { code?: string };
    error.code = "SUBSCRIPTION_INACTIVE";
    throw error;
  }
  return Math.max(1, daysLeft) / 30;
}

/**
 * вычисляет коэффициент для primary подписки клиента.
 * Используется когда targetSubscriptionId не передан и нужно применить опцию к primary.
 */
export async function calculateDevicesProrataPriceCoefficientForPrimary(clientId: string): Promise<number> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { remnawaveUuid: true },
  }).catch(() => null);
  if (!client?.remnawaveUuid) return 1;
  const primarySub = await prisma.subscription.findFirst({
    where: { ownerId: clientId, remnawaveUuid: client.remnawaveUuid },
    select: { expireAt: true, remnawaveUuid: true },
  }).catch(() => null);
  // Даже если primarySub не найдена / expireAt пуст — берём дату из Remna по uuid клиента.
  const expireAt = await resolveSubExpireAt(primarySub?.expireAt ?? null, primarySub?.remnawaveUuid ?? client.remnawaveUuid);
  if (!expireAt) return 1;
  const daysLeft = (expireAt.getTime() - Date.now()) / 86_400_000;
  if (daysLeft <= 0) {
    const error = new Error("Нельзя купить опцию для истёкшей подписки. Сначала продлите подписку.") as Error & { code?: string };
    error.code = "SUBSCRIPTION_INACTIVE";
    throw error;
  }
  return Math.max(1, daysLeft) / 30;
}

// ——— Гибкий тариф (собери сам): расчёт и оплата балансом ———
export function getCustomBuildConfig(config: Awaited<ReturnType<typeof getSystemConfig>>) {
  const c = config as {
    customBuildEnabled?: boolean;
    customBuildPricePerDay?: number;
    customBuildPricePerDevice?: number;
    customBuildTrafficMode?: string;
    customBuildPricePerGb?: number;
    customBuildSquadUuid?: string | null;
    customBuildCurrency?: string;
    customBuildMaxDays?: number;
    customBuildMaxDevices?: number;
  };
  if (!c.customBuildEnabled || !c.customBuildSquadUuid?.trim()) return null;
  return {
    pricePerDay: c.customBuildPricePerDay ?? 0,
    pricePerDevice: c.customBuildPricePerDevice ?? 0,
    trafficMode: c.customBuildTrafficMode === "per_gb" ? "per_gb" as const : "unlimited" as const,
    pricePerGb: c.customBuildPricePerGb ?? 0,
    squadUuid: c.customBuildSquadUuid.trim(),
    currency: (c.customBuildCurrency || "rub").toLowerCase(),
    maxDays: Math.min(360, Math.max(1, c.customBuildMaxDays ?? 360)),
    maxDevices: Math.min(20, Math.max(1, c.customBuildMaxDevices ?? 10)),
  };
}

export const heleketCreatePaymentSchema = z.object({
  amount: z.number().positive().optional(),
  currency: z.string().min(1).max(10).optional(),
  tariffId: z.string().min(1).optional(),
  tariffPriceOptionId: z.string().min(1).optional(),
  deviceCount: z.number().int().min(0).max(100).optional(),
  proxyTariffId: z.string().min(1).optional(),
  singboxTariffId: z.string().min(1).optional(),
  promoCode: z.string().max(50).optional(),
  // покупка как доп. подписка — см. yookassa-схему выше.
  asAdditional: z.boolean().optional(),
  // покупка подарочной подписки — будет создана с purchasedAsGift=true.
  asGift: z.boolean().optional(),
  // какой триал заменить этой покупкой (несколько триалов —
  // выбор юзера; без поля заменяется самый старый).
  replaceTrialSubId: z.string().min(1).max(64).optional(),
  // продление существующей secondary (вместо создания новой).
  extendsSecondarySubId: z.string().min(1).max(64).optional(),
  // при активации платежа удалить все доп. устройства.
  removeExtrasOnActivate: z.boolean().optional(),
  extraOption: z.object({
    kind: z.enum(["traffic", "devices", "servers"]),
    productId: z.string().min(1),
    targetSubscriptionId: z.string().min(1).optional(),
  }).optional(),
  customBuild: z.object({ days: z.number().int().min(1).max(360), devices: z.number().int().min(1).max(20), trafficGb: z.number().min(0).nullable().optional() }).optional(),
});
