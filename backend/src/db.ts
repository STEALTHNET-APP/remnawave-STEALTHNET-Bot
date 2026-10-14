import { PrismaClient, Prisma } from "@prisma/client";
import { isRenewalTargetTariffAllowed, parsePaymentIntentMetadata } from "./modules/payment/payment-intent.js";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

const basePrisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = basePrisma;

type ExtraOptionPaymentTarget = {
  clientId: string;
  metadata: unknown;
};

function paymentTargetError(message: string, code: "SUBSCRIPTION_TARGET_INVALID" | "SUBSCRIPTION_INACTIVE") {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  return error;
}

/**
 * Последний DB-бэкстоп перед созданием платежа за опцию. Внешние платёжные
 * провайдеры вызываются только после createPayment, поэтому здесь ещё можно
 * безопасно остановить оплату на истёкшую/чужую подписку.
 */
export async function assertActiveExtraOptionTargetForPayment({ clientId, metadata }: ExtraOptionPaymentTarget): Promise<void> {
  let parsed: Record<string, unknown> | null = null;
  try {
    const value = typeof metadata === "string" ? JSON.parse(metadata) : metadata;
    if (value && typeof value === "object" && !Array.isArray(value)) parsed = value as Record<string, unknown>;
  } catch {
    return;
  }
  if (!parsed?.extraOption || typeof parsed.extraOption !== "object") return;

  const targetId = typeof parsed.targetSubscriptionId === "string" && parsed.targetSubscriptionId.trim()
    ? parsed.targetSubscriptionId.trim()
    : null;
  const target = targetId
    ? await basePrisma.subscription.findFirst({
        where: { id: targetId, ownerId: clientId },
        select: { remnawaveUuid: true, expireAt: true },
      })
    : await basePrisma.subscription.findUnique({
        where: { ownerId_subscriptionIndex: { ownerId: clientId, subscriptionIndex: 0 } },
        select: { remnawaveUuid: true, expireAt: true },
      });

  if (!target?.remnawaveUuid) {
    throw paymentTargetError("Подписка для опции не найдена или не принадлежит вам.", "SUBSCRIPTION_TARGET_INVALID");
  }
  if (target.expireAt && target.expireAt.getTime() <= Date.now()) {
    throw paymentTargetError("Нельзя купить опцию для истёкшей подписки. Сначала продлите подписку.", "SUBSCRIPTION_INACTIVE");
  }
}

export async function assertRenewalTargetForPayment(params: {
  clientId: string;
  tariffId: string | null | undefined;
  metadata: unknown;
}): Promise<void> {
  const intent = parsePaymentIntentMetadata(params.metadata);
  if (!intent.renewalTargetId) return;
  if (!params.tariffId) {
    throw paymentTargetError("Для продления не указан тариф.", "SUBSCRIPTION_TARGET_INVALID");
  }

  const target = await basePrisma.subscription.findFirst({
    where: {
      id: intent.renewalTargetId,
      OR: [{ ownerId: params.clientId }, { giftedToClientId: params.clientId }],
    },
    select: { tariffId: true, trialId: true },
  });
  if (!target) {
    throw paymentTargetError("Подписка для продления не найдена или не принадлежит вам.", "SUBSCRIPTION_TARGET_INVALID");
  }
  if (!isRenewalTargetTariffAllowed(target, params.tariffId)) {
    throw paymentTargetError("Продление возможно только для текущего тарифа подписки.", "SUBSCRIPTION_TARGET_INVALID");
  }
}

/**
 * Обёртка над prisma.payment.create. После выпила multi-bot (v5.0.0) botId-подстановки нет.
 * T-tariff-restriction (портировано из WolfVPN): бэкстоп — не создаём платёж за тариф,
 * запрещённый клиенту. Покрывает ВСЕ внешние платёжки (они создают pending-платёж здесь).
 * app.ts ловит code "TARIFF_RESTRICTED" → 403.
 */
export async function createPayment(args: Prisma.PaymentCreateArgs) {
  const data = args.data as Prisma.PaymentUncheckedCreateInput;
  if (typeof data.clientId === "string") {
    await assertActiveExtraOptionTargetForPayment({ clientId: data.clientId, metadata: data.metadata });
    await assertRenewalTargetForPayment({
      clientId: data.clientId,
      tariffId: typeof data.tariffId === "string" ? data.tariffId : null,
      metadata: data.metadata,
    });
  }
  if (data.tariffId && typeof data.clientId === "string") {
    const cl = await basePrisma.client.findUnique({
      where: { id: data.clientId },
      select: { restrictedTariffIds: true, tariffRestrictionReason: true },
    });
    if (cl?.restrictedTariffIds) {
      let ids: string[] = [];
      try {
        const p = JSON.parse(cl.restrictedTariffIds);
        if (Array.isArray(p)) ids = p.map((x) => String(x));
      } catch { /* битый JSON → ограничений нет */ }
      if (ids.includes(String(data.tariffId))) {
        let reason = (cl.tariffRestrictionReason ?? "").trim();
        if (!reason) {
          const s = await basePrisma.systemSetting.findUnique({ where: { key: "tariff_restriction_message" } });
          reason = (s?.value ?? "").trim() || "Покупка этого тарифа ограничена в связи с нарушением условий оферты. Выберите другой тариф.";
        }
        const err = new Error(reason) as Error & { code?: string };
        err.code = "TARIFF_RESTRICTED";
        throw err;
      }
    }
  }
  return basePrisma.payment.create(args);
}

export const prisma = basePrisma;

// ── Тонкие обёртки для литералов Prisma: часть IDE/анализаторов отстаёт от `prisma generate`.
// Литерал сначала совместим с Record<string, unknown>, затем приводится к сгенерированному типу Prisma.
export function asClientUncheckedCreate(data: Record<string, unknown>): Prisma.ClientUncheckedCreateInput {
  return data as Prisma.ClientUncheckedCreateInput;
}

export function asClientWhere(where: Record<string, unknown>): Prisma.ClientWhereInput {
  return where as Prisma.ClientWhereInput;
}

export function asClientSelect(select: Record<string, unknown>): Prisma.ClientSelect {
  return select as Prisma.ClientSelect;
}

export function asPaymentUncheckedCreate(data: Record<string, unknown>): Prisma.PaymentUncheckedCreateInput {
  return data as Prisma.PaymentUncheckedCreateInput;
}

export function asTelegramAuthUpdate(data: Record<string, unknown>): Prisma.TelegramAuthTokenUpdateInput {
  return data as Prisma.TelegramAuthTokenUpdateInput;
}

export type TelegramAuthTokenRecord = {
  id: string;
  token: string;
  expiresAt: Date;
  createdAt: Date;
  confirmedTelegramId: string | null;
  confirmedUsername: string | null;
};

/** Строка Client после findFirst с select для слияния «пустого» клона */
export type ClientEmptyCloneRow = {
  id: string;
  email: string | null;
  passwordHash: string | null;
  googleId: string | null;
  appleId: string | null;
  remnawaveUuid: string | null;
  balance: number;
  _count: { payments: number; ownedSubscriptions: number };
};
