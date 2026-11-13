/**
 * Применение купленных опций (доп. трафик, устройства, серверы) к пользователю Remna после оплаты.
 */

import { prisma } from "../../db.js";
import type { Prisma } from "@prisma/client";
import { deviceOptionMetadata, lockDevicePurchases, validateDevicePurchase } from "./device-limit.js";
import { remnaGetUser, remnaUpdateUser, isRemnaConfigured } from "../remna/remna.client.js";

export type ApplyExtraOptionResult = { ok: true; creditedToBalance?: boolean } | { ok: false; error: string; status: number };

type ExtraOptionPayload =
  | { kind: "traffic"; trafficBytes: number }
  | { kind: "devices"; deviceCount: number }
  | { kind: "servers"; squadUuid: string; trafficBytes?: number };

function parseMetadataExtraOption(metadata: string | null): ExtraOptionPayload | null {
  if (!metadata?.trim()) return null;
  try {
    const obj = JSON.parse(metadata) as Record<string, unknown>;
    const extra = obj?.extraOption as Record<string, unknown> | undefined;
    if (!extra || typeof extra !== "object") return null;
    const kind = extra.kind as string;
    if (kind === "traffic" && typeof extra.trafficBytes === "number" && extra.trafficBytes > 0) {
      return { kind: "traffic", trafficBytes: extra.trafficBytes };
    }
    if (kind === "devices" && typeof extra.deviceCount === "number" && extra.deviceCount > 0) {
      return { kind: "devices", deviceCount: extra.deviceCount };
    }
    if (kind === "servers" && typeof extra.squadUuid === "string" && extra.squadUuid.length > 0) {
      const trafficBytes = typeof extra.trafficBytes === "number" && extra.trafficBytes > 0 ? extra.trafficBytes : undefined;
      return { kind: "servers", squadUuid: extra.squadUuid, ...(trafficBytes !== undefined && { trafficBytes }) };
    }
  } catch {
    // ignore
  }
  return null;
}

/** Извлечь текущие trafficLimitBytes и hwidDeviceLimit из ответа Remna GET /api/users/{uuid} */
function getRemnaLimits(data: unknown): { trafficLimitBytes: number; hwidDeviceLimit: number | null } {
  if (!data || typeof data !== "object") return { trafficLimitBytes: 0, hwidDeviceLimit: null };
  const resp = (data as Record<string, unknown>).response ?? (data as Record<string, unknown>).data ?? data;
  const r = resp as Record<string, unknown>;
  const traffic = r?.trafficLimitBytes;
  const devices = r?.hwidDeviceLimit;
  return {
    trafficLimitBytes: typeof traffic === "number" ? traffic : 0,
    hwidDeviceLimit: typeof devices === "number" ? devices : (devices != null ? Number(devices) : null),
  };
}

/** Извлечь activeInternalSquads (uuid[]) из ответа Remna */
function getRemnaSquads(data: unknown): string[] {
  if (!data || typeof data !== "object") return [];
  const resp = (data as Record<string, unknown>).response ?? (data as Record<string, unknown>).data ?? data;
  const ais = (resp as Record<string, unknown>)?.activeInternalSquads;
  if (!Array.isArray(ais)) return [];
  const out: string[] = [];
  for (const s of ais) {
    const u = s && typeof s === "object" && "uuid" in s ? (s as Record<string, unknown>).uuid : s;
    if (typeof u === "string") out.push(u);
  }
  return out;
}

/**
 * Применить опцию по оплате: прочитать Payment.metadata.extraOption,
 * получить клиента и remnawaveUuid, обновить пользователя в Remna (добавить трафик/устройства/сквад).
 */
/**
 * извлечь targetSubscriptionId из metadata платежа.
 * Если задан — extra-option применяется к этой конкретной secondary; иначе — primary клиента.
 * После apply мы также увеличиваем custom_price подписки на стоимость опции (для будущих продлений).
 */
function getTargetSubscriptionId(metadata: string | null): string | null {
  if (!metadata?.trim()) return null;
  try {
    const o = JSON.parse(metadata) as Record<string, unknown>;
    const id = o?.targetSubscriptionId;
    return typeof id === "string" && id.trim() ? id.trim() : null;
  } catch {
    return null;
  }
}

export async function applyExtraOptionByPaymentId(paymentId: string): Promise<ApplyExtraOptionResult> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, select: { clientId: true, metadata: true } });
  if (!payment || !deviceOptionMetadata(payment.metadata)) return applyExtraOption(paymentId, prisma);
  return prisma.$transaction(async (tx) => {
    await lockDevicePurchases(tx, payment.clientId);
    const current = await tx.payment.findUnique({ where: { id: paymentId }, select: { status: true, metadata: true, amount: true } });
    if (!current || current.status !== "PAID") return { ok: false, error: "Платёж не оплачен", status: 409 };
    const meta = deviceOptionMetadata(current.metadata);
    if (meta?.extraOptionBalanceCreditAt) return { ok: true, creditedToBalance: true };
    try {
      await validateDevicePurchase(tx, payment.clientId, current.metadata);
    } catch (error) {
      if ((error as { code?: string }).code !== "EXTRA_DEVICE_LIMIT") throw error;
      if (meta?.extraOptionAppliedAt) return { ok: true };
      await tx.client.update({ where: { id: payment.clientId }, data: { balance: { increment: current.amount } } });
      await tx.payment.update({ where: { id: paymentId }, data: { metadata: JSON.stringify({ ...meta, extraOptionBalanceCreditAt: new Date().toISOString() }) } });
      return { ok: true, creditedToBalance: true };
    }
    if (meta?.extraOptionAppliedAt) return { ok: true };
    const result = await applyExtraOption(paymentId, tx);
    if (result.ok) await tx.payment.update({ where: { id: paymentId }, data: { metadata: JSON.stringify({ ...meta, extraOptionAppliedAt: new Date().toISOString() }) } });
    return result;
  }, { maxWait: 15000, timeout: 45000 });
}

async function applyExtraOption(paymentId: string, db: Prisma.TransactionClient): Promise<ApplyExtraOptionResult> {
  if (!isRemnaConfigured()) return { ok: false, error: "Remna API не настроен", status: 503 };

  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    select: { clientId: true, metadata: true, amount: true },
  });
  if (!payment) return { ok: false, error: "Платёж не найден", status: 404 };

  const option = parseMetadataExtraOption(payment.metadata);
  if (!option) return { ok: false, error: "Платёж не является покупкой опции", status: 400 };

  // УНИФИЦИРОВАННЫЙ резолв целевой подписки.
  // После унификации все подписки клиента живут в одной таблице Subscription. Primary =
  // subscriptionIndex=0, secondary = 1..N — но логически они равноправны.
  //
  // Алгоритм:
  //   1. Если в metadata указан targetSubscriptionId — ищем эту подписку (любой index).
  //   2. Иначе — fallback на subscriptionIndex=0 клиента (бывш. primary).
  //
  // Старая ветка через client.remnawaveUuid (legacy) — больше не используется.
  // Это исправляет кейс: юзер выбирал secondary, но extra-option применялась к primary
  // потому что бот не пробрасывал targetSubscriptionId в платёжных хэндлерах.
  const targetSecondaryId = getTargetSubscriptionId(payment.metadata);
  let targetSub: { id: string; remnawaveUuid: string | null; ownerId: string; customPrice: number | null; subscriptionIndex: number; expireAt: Date | null; extraDevices: number; tariff: { maxExtraDevices: number; includedDevices: number; deviceLimit: number | null } | null } | null = null;
  if (targetSecondaryId) {
    targetSub = await db.subscription.findUnique({
      where: { id: targetSecondaryId },
      select: { id: true, remnawaveUuid: true, ownerId: true, customPrice: true, subscriptionIndex: true, expireAt: true, extraDevices: true, tariff: { select: { maxExtraDevices: true, includedDevices: true, deviceLimit: true } } },
    });
    if (!targetSub || targetSub.ownerId !== payment.clientId) {
      return { ok: false, error: "Подписка для опции не найдена / не принадлежит клиенту", status: 404 };
    }
  } else {
    // Fallback: primary подписка клиента (subscriptionIndex=0).
    targetSub = await db.subscription.findUnique({
      where: { ownerId_subscriptionIndex: { ownerId: payment.clientId, subscriptionIndex: 0 } },
      select: { id: true, remnawaveUuid: true, ownerId: true, customPrice: true, subscriptionIndex: true, expireAt: true, extraDevices: true, tariff: { select: { maxExtraDevices: true, includedDevices: true, deviceLimit: true } } },
    });
    if (!targetSub) {
      return { ok: false, error: "У клиента нет подписки для применения опции. Сначала оформите подписку.", status: 400 };
    }
  }
  if (!targetSub.remnawaveUuid) {
    return { ok: false, error: "Подписка не привязана к VPN", status: 400 };
  }
  if (targetSub.expireAt && targetSub.expireAt.getTime() <= Date.now()) {
    return { ok: false, error: "Нельзя применить опцию к истёкшей подписке. Сначала продлите подписку.", status: 409 };
  }
  const uuid = targetSub.remnawaveUuid;
  // Для совместимости с существующей логикой bumpCustomPrice/extraDevices ниже —
  // обе ветки (primary/secondary) теперь используют один объект подписки.
  const secondaryDb = targetSub;

  const userRes = await remnaGetUser(uuid);
  if (userRes.error) {
    return { ok: false, error: userRes.error, status: userRes.status >= 400 ? userRes.status : 500 };
  }
  const remnaOuter = userRes.data as Record<string, unknown> | null;
  const remnaUser = (remnaOuter?.response ?? remnaOuter) as Record<string, unknown> | null;
  const remnaStatus = typeof remnaUser?.status === "string" ? remnaUser.status.toUpperCase() : null;
  const remnaExpireRaw = remnaUser?.expireAt ?? remnaUser?.expire_at;
  const remnaExpireAt = typeof remnaExpireRaw === "string" || typeof remnaExpireRaw === "number"
    ? new Date(typeof remnaExpireRaw === "number" && remnaExpireRaw < 1_000_000_000_000 ? remnaExpireRaw * 1000 : remnaExpireRaw)
    : null;
  if ((remnaStatus && remnaStatus !== "ACTIVE") || (remnaExpireAt && !Number.isNaN(remnaExpireAt.getTime()) && remnaExpireAt.getTime() <= Date.now())) {
    return { ok: false, error: "Нельзя применить опцию к неактивной подписке. Сначала продлите подписку.", status: 409 };
  }

  // после apply увеличиваем custom_price выбранной подписки на цену опции.
  // Используется при следующем продлении: tariff-activation вместо базовой tariff.price берёт custom_price.
  // Стоимость опции = payment.amount (это итоговая сумма с учётом скидок/акций — то что юзер заплатил).
  // bumpCustomPrice работает только с конкретной
  // подпиской (раньше была отдельная ветка для primary через client.customPrimaryPrice —
  // больше не нужна, primary тоже Subscription с subscriptionIndex=0).
  const optionAmount = payment.amount ?? 0;
  const bumpCustomPrice = async () => {
    if (optionAmount <= 0) return;
    const newPrice = (secondaryDb.customPrice ?? 0) + optionAmount;
    await db.subscription.update({
      where: { id: secondaryDb.id },
      data: { customPrice: newPrice },
    }).catch(() => {});
  };

  if (option.kind === "traffic") {
    const limits = getRemnaLimits(userRes.data);
    const newTraffic = limits.trafficLimitBytes + option.trafficBytes;
    const updateRes = await remnaUpdateUser({
      uuid,
      trafficLimitBytes: newTraffic,
    });
    if (updateRes.error) {
      return { ok: false, error: updateRes.error, status: updateRes.status >= 400 ? updateRes.status : 500 };
    }
    await bumpCustomPrice();
    return { ok: true };
  }

  if (option.kind === "devices") {
    const maximum = Math.max(0, targetSub.tariff?.maxExtraDevices ?? 0);
    if (!Number.isSafeInteger(option.deviceCount) || targetSub.extraDevices + option.deviceCount > maximum) {
      return { ok: false, error: "Превышен лимит дополнительных устройств тарифа", status: 409 };
    }
    const included = targetSub.tariff?.includedDevices ?? targetSub.tariff?.deviceLimit ?? 0;
    const newDevices = included + targetSub.extraDevices + option.deviceCount;
    const updateRes = await remnaUpdateUser({
      uuid,
      hwidDeviceLimit: newDevices,
    });
    if (updateRes.error) {
      return { ok: false, error: updateRes.error, status: updateRes.status >= 400 ? updateRes.status : 500 };
    }
    // запоминаем количество + цену за 30 дней.
    // цена должна быть БАЗОВОЙ (productPriceMonthly из metadata),
    // а не payment.amount (которая может быть масштабирована). Для пакета «+2 за 99» это всегда 99,
    // вне зависимости от pro-rata коэффициента который применялся при оплате.
    // При продлении: finalPrice = option.price + monthlyPrice × (days/30).
    let pkgPrice = payment.amount ?? 0;
    try {
      const meta = payment.metadata ? JSON.parse(payment.metadata) as Record<string, unknown> : null;
      const extraMeta = meta?.extraOption as Record<string, unknown> | undefined;
      const monthly = typeof extraMeta?.productPriceMonthly === "number" ? extraMeta.productPriceMonthly : null;
      if (monthly != null && monthly > 0) pkgPrice = monthly;
    } catch {
      // ignore parse errors
    }
    // secondaryDb теперь всегда задан (primary
    // тоже Subscription). Раньше была отдельная ветка с findFirst по remnawaveUuid —
    // больше не нужна.
    await db.subscription.update({
      where: { id: secondaryDb.id },
      data: {
        extraDevices: { increment: option.deviceCount },
        extraDevicesMonthlyPrice: { increment: pkgPrice },
      },
    });
    return { ok: true };
  }

  if (option.kind === "servers") {
    const limits = getRemnaLimits(userRes.data);
    const currentSquads = getRemnaSquads(userRes.data);
    let trafficLimitBytes = limits.trafficLimitBytes;
    if (option.trafficBytes && option.trafficBytes > 0) {
      trafficLimitBytes += option.trafficBytes;
    }
    const newSquads = currentSquads.includes(option.squadUuid) ? currentSquads : [...currentSquads, option.squadUuid];
    const updatePayload: { uuid: string; activeInternalSquads: string[]; trafficLimitBytes?: number } = {
      uuid,
      activeInternalSquads: newSquads,
    };
    if (trafficLimitBytes !== limits.trafficLimitBytes) {
      updatePayload.trafficLimitBytes = trafficLimitBytes;
    }
    const updateRes = await remnaUpdateUser(updatePayload);
    if (updateRes.error) {
      return { ok: false, error: updateRes.error, status: updateRes.status >= 400 ? updateRes.status : 500 };
    }
    await bumpCustomPrice();
    return { ok: true };
  }

  return { ok: false, error: "Неизвестный тип опции", status: 400 };
}
