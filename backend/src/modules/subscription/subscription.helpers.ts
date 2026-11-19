/**
 * Helper-функции для работы с унифицированной таблицей Subscription.
 *
 * Архитектура (см. план в чате):
 * - У клиента 0..N подписок в таблице `subscriptions`.
 * - subscriptionIndex=0 — «главная» (бывш. root, ранее жила в Client.remnawaveUuid+currentTariffId+autoRenew*).
 * - subscriptionIndex=1..N — дополнительные (бывш. SecondarySubscription).
 * - Все подписки в одной модели — никаких отдельных функций для root и secondary.
 *
 * Правило: «Первая созданная подписка любого типа (покупка / триал / подарок) получает index=0».
 * После «обнуления» (admin revoke / fail продления / истечение без auto-renew) запись index=0
 * остаётся, у неё tariffId=null. Следующая покупка продлевает её — снова главная.
 */

import type { Prisma, Subscription } from "@prisma/client";
import { prisma } from "../../db.js";
import { isPrimaryEligible, planSubscriptionSlotOrder } from "./subscription-slots.js";

export type SubscriptionWithRelations = Awaited<ReturnType<typeof getPrimarySubscription>>;

/**
 * Получить главную подписку клиента (subscriptionIndex=0) или null если ещё не создана.
 * Используется ВСЮДУ где раньше читали client.remnawaveUuid / client.currentTariffId / client.autoRenewEnabled.
 */
export async function getPrimarySubscription(clientId: string) {
  return prisma.subscription.findUnique({
    where: { ownerId_subscriptionIndex: { ownerId: clientId, subscriptionIndex: 0 } },
    include: {
      tariff: { select: { id: true, name: true, menuEmoji: true, durationDays: true, trafficLimitBytes: true, deviceLimit: true, includedDevices: true, pricePerExtraDevice: true, maxExtraDevices: true, deviceDiscountTiers: true, internalSquadUuids: true, trafficResetMode: true, price: true, currency: true } },
      autoRenewTariff: { select: { id: true, name: true } },
    },
  });
}

/**
 * Получить ВСЕ подписки клиента (отсортированные по subscriptionIndex).
 * Заменяет паттерн «root от Remna + findMany secondary».
 */
export async function getAllClientSubscriptions(clientId: string) {
  return prisma.subscription.findMany({
    where: { ownerId: clientId },
    orderBy: { subscriptionIndex: "asc" },
    include: {
      tariff: { select: { id: true, name: true, menuEmoji: true, trafficLimitBytes: true, price: true, currency: true } },
    },
  });
}

/**
 * следующий subscriptionIndex — ПЕРВЫЙ СВОБОДНЫЙ слот с 0.
 *
 * Простая и правильная логика: проходим 0, 1, 2... и возвращаем первый незанятый.
 *   - У клиента нет подписок → 0
 *   - Подписки [0, 1, 2] → 3
 *   - Подписки [0, 2, 3] → 1 (был gap)
 *   - Подписки [1, 2] → 0 (primary освободился — заполняем!)
 *
 * Раньше было max+1 — после удаления primary новые покупки уезжали в [N+1] и [0] навсегда
 * оставался пустым. Это и был баг «не создаётся 0 после удаления всех подписок».
 */
export async function getNextSubscriptionIndex(clientId: string, minIndex = 0): Promise<number> {
  const subs = await prisma.subscription.findMany({
    where: { ownerId: clientId },
    select: { subscriptionIndex: true },
    orderBy: { subscriptionIndex: "asc" },
  });
  const used = new Set(subs.map((s) => s.subscriptionIndex));
  // T-gift-index-fix : minIndex — нижняя граница поиска. Для подарочных/доп.
  // подписок передаём 1, чтобы не занять primary-слот (0) и найти ПЕРВЫЙ СВОБОДНЫЙ ≥minIndex
  // (а не тупо 1 — иначе у клиента с дырой на index 0 и занятым index 1 был UNIQUE-конфликт
  // (ownerId, subscriptionIndex) и активация подарка после оплаты падала с 500).
  // Защита от бесконечного цикла — 10_000 потолок (реально лимит подписок ≤ 100).
  for (let i = minIndex; i < 10_000; i++) {
    if (!used.has(i)) return i;
  }
  return Math.max(subs.length, minIndex);
}

/**
 * Проверить — есть ли у клиента хоть одна подписка (включая главную).
 * Заменяет проверки `client.remnawaveUuid != null`.
 */
export async function hasAnySubscription(clientId: string): Promise<boolean> {
  const count = await prisma.subscription.count({ where: { ownerId: clientId } });
  return count > 0;
}

/**
 * Получить remnawaveUuid главной подписки клиента (или null).
 * Заменяет прямое чтение `client.remnawaveUuid` в кодовых местах,
 * которые работают с «основной» подпиской.
 */
export async function getPrimaryRemnawaveUuid(clientId: string): Promise<string | null> {
  const primary = await prisma.subscription.findUnique({
    where: { ownerId_subscriptionIndex: { ownerId: clientId, subscriptionIndex: 0 } },
    select: { remnawaveUuid: true },
  });
  return primary?.remnawaveUuid ?? null;
}

/**
 * Найти подписку клиента по её remnawaveUuid (главная или доп).
 * Заменяет логику «если client.remnawaveUuid==uuid → root, иначе ищем в secondary».
 */
export async function findSubscriptionByRemnawaveUuid(uuid: string) {
  return prisma.subscription.findFirst({
    where: { remnawaveUuid: uuid },
    include: { tariff: true },
  });
}

/**
 * Тип подписки относительно клиента: главная (index=0) или дополнительная.
 * Используется для условий «если главная — обновляй currentTariffId, иначе...».
 * В новой модели обоим случаям применяется одна и та же функция.
 */
export function isPrimary(subscription: { subscriptionIndex: number }): boolean {
  return subscription.subscriptionIndex === 0;
}

/**
 * универсальный upsert главной подписки клиента.
 *
 * Гарантирует что у клиента ВСЕГДА появляется Subscription[0] при любом первом контакте
 * с VPN — будь то триал, обычная покупка тарифа, или редкий кейс «первая покупка = подарочная,
 * нет ещё primary».
 *
 * Правило: запись с subscriptionIndex=0 — единственная primary. Если она уже есть — UPDATE.
 * Если нет — CREATE с idx=0 (НЕЗАВИСИМО от того, сколько у клиента уже доп. подписок).
 * Это исправляет старый баг: раньше при наличии Subscription[1+] новая «главная» уходила в
 * idx=max+1 вместо 0, и primary никогда не материализовалась.
 *
 * @param clientId — владелец
 * @param data — поля для записи (remnawaveUuid обязателен, остальное опционально)
 * @returns id созданной/обновлённой подписки
 */
export async function upsertPrimarySubscription(
  clientId: string,
  data: {
    remnawaveUuid: string;
    tariffId?: string | null;
    trialId?: string | null;
    customPrice?: number | null;
    currentPricePerDay?: number | null;
    autoRenewTariffId?: string | null;
    autoRenewPriceOptionId?: string | null;
    autoRenewExtraDevices?: number;
    autoRenewEnabled?: boolean;
  },
): Promise<{ id: string; created: boolean }> {
  const existing = await prisma.subscription.findUnique({
    where: { ownerId_subscriptionIndex: { ownerId: clientId, subscriptionIndex: 0 } },
    select: { id: true },
  });

  if (existing) {
    await prisma.subscription.update({
      where: { id: existing.id },
      data: {
        remnawaveUuid: data.remnawaveUuid,
        // tariffId передаём только если явно указан (включая null → сброс).
        // Trial не должен затирать tariffId предыдущей платной подписки клиента.
        ...(data.tariffId !== undefined ? { tariffId: data.tariffId } : {}),
        ...(data.trialId !== undefined ? { trialId: data.trialId } : {}),
        ...(data.customPrice !== undefined ? { customPrice: data.customPrice } : {}),
        ...(data.currentPricePerDay !== undefined ? { currentPricePerDay: data.currentPricePerDay } : {}),
        ...(data.autoRenewTariffId !== undefined ? { autoRenewTariffId: data.autoRenewTariffId } : {}),
        ...(data.autoRenewPriceOptionId !== undefined ? { autoRenewPriceOptionId: data.autoRenewPriceOptionId } : {}),
        ...(data.autoRenewExtraDevices !== undefined ? { autoRenewExtraDevices: data.autoRenewExtraDevices } : {}),
        ...(data.autoRenewEnabled !== undefined ? { autoRenewEnabled: data.autoRenewEnabled } : {}),
      },
    });
    return { id: existing.id, created: false };
  }

  // Создаём ВСЕГДА как idx=0 — primary-слот может быть занят только одной записью.
  // Если параллельный запрос успеет создать первой — поймаем ошибку уникальности и
  // повторим как UPDATE.
  try {
    const created = await prisma.subscription.create({
      data: {
        ownerId: clientId,
        subscriptionIndex: 0,
        remnawaveUuid: data.remnawaveUuid,
        tariffId: data.tariffId ?? null,
        trialId: data.trialId ?? null,
        customPrice: data.customPrice ?? null,
        currentPricePerDay: data.currentPricePerDay ?? null,
        autoRenewTariffId: data.autoRenewTariffId ?? null,
        autoRenewPriceOptionId: data.autoRenewPriceOptionId ?? null,
        autoRenewExtraDevices: data.autoRenewExtraDevices ?? 0,
        autoRenewEnabled: data.autoRenewEnabled ?? false,
      },
      select: { id: true },
    });
    return { id: created.id, created: true };
  } catch (e) {
    // Race condition: между findUnique и create кто-то ещё создал [0]. Делаем update.
    const again = await prisma.subscription.findUnique({
      where: { ownerId_subscriptionIndex: { ownerId: clientId, subscriptionIndex: 0 } },
      select: { id: true },
    });
    if (!again) throw e;
    await prisma.subscription.update({
      where: { id: again.id },
      data: { remnawaveUuid: data.remnawaveUuid },
    });
    return { id: again.id, created: false };
  }
}

export type PromoteSubscriptionResult = {
  id: string;
  ownerId: string;
  previousPrimaryId: string | null;
  remnawaveUuid: string | null;
};

export class SubscriptionEditError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}

async function lockOwner(db: Prisma.TransactionClient, ownerId: string) {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"subscription-owner:" + ownerId}, 0))`;
  await db.$queryRaw`SELECT id FROM clients WHERE id = ${ownerId} FOR UPDATE`;
  await db.$queryRaw`SELECT id FROM subscriptions WHERE owner_id = ${ownerId} ORDER BY id FOR UPDATE`;
}

async function checkUuid(db: Prisma.TransactionClient, ownerId: string, subId: string, uuid: string | null) {
  if (!uuid) return;
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"subscription-remna:" + uuid}, 0))`;
  const linked = await db.subscription.findFirst({ where: { remnawaveUuid: uuid, id: { not: subId } } });
  const legacy = await db.client.findFirst({ where: { remnawaveUuid: uuid, id: { not: ownerId } } });
  if (linked || legacy) throw new SubscriptionEditError("Этот Remna UUID уже привязан к другой подписке или клиенту");
}

async function mirrorPrimary(db: Prisma.TransactionClient, sub: Subscription, resetRenewal = false) {
  await checkUuid(db, sub.ownerId, sub.id, sub.remnawaveUuid);
  await db.client.update({ where: { id: sub.ownerId }, data: {
    remnawaveUuid: sub.remnawaveUuid,
    currentTariffId: sub.tariffId,
    customPrimaryPrice: sub.customPrice,
    currentPricePerDay: sub.currentPricePerDay,
    autoRenewEnabled: sub.autoRenewEnabled,
    autoRenewTariffId: sub.autoRenewTariffId,
    autoRenewPriceOptionId: sub.autoRenewPriceOptionId,
    autoRenewExtraDevices: sub.autoRenewExtraDevices,
    ...(resetRenewal ? { autoRenewRetryCount: 0, autoRenewNotifiedAt: null, lastArnNotifiedKey: null, autoRenewPromoCode: null } : {}),
  } });
}

export async function promoteSubscriptionToPrimary(subId: string): Promise<PromoteSubscriptionResult | null> {
  return prisma.$transaction(async db => {
    const target = await db.subscription.findUnique({ where: { id: subId } });
    if (!target) return null;
    await lockOwner(db, target.ownerId);
    const fresh = await db.subscription.findUnique({ where: { id: subId } });
    if (!fresh) return null;
    if (fresh.ownerId !== target.ownerId) throw new SubscriptionEditError("Владелец подписки изменился. Обновите страницу");
    if (!isPrimaryEligible(fresh)) throw new SubscriptionEditError("Неактивированный или переданный подарок нельзя сделать основной подпиской");
    const subs = await db.subscription.findMany({ where: { ownerId: fresh.ownerId } });
    const owner = await db.client.findUniqueOrThrow({ where: { id: fresh.ownerId } });
    if (owner.remnawaveUuid && !subs.some(s => s.remnawaveUuid === owner.remnawaveUuid)) {
      throw new SubscriptionEditError("Сначала восстановите запись существующей основной подписки: у клиента есть отдельная legacy-привязка");
    }
    const current = subs.find(s => s.subscriptionIndex === 0);
    if (fresh.subscriptionIndex !== 0) {
      const temporary = Math.min(0, ...subs.map(s => s.subscriptionIndex)) - 1;
      await db.subscription.update({ where: { id: subId }, data: { subscriptionIndex: temporary } });
      if (current) await db.subscription.update({ where: { id: current.id }, data: { subscriptionIndex: fresh.subscriptionIndex } });
      await db.subscription.update({ where: { id: subId }, data: { subscriptionIndex: 0 } });
    }
    await mirrorPrimary(db, fresh, current?.id !== fresh.id);
    return { id: subId, ownerId: fresh.ownerId, previousPrimaryId: current?.id === subId ? null : current?.id ?? null, remnawaveUuid: fresh.remnawaveUuid };
  }, { timeout: 20_000 });
}

export type SubscriptionDbEdit = {
  customName?: string | null;
  tariffId?: string | null;
  remnawaveUuid?: string | null;
  expireAt?: string | null;
  customPrice?: number | null;
  autoRenewEnabled?: boolean;
  extraDevices?: number;
  syncToClient?: boolean;
};

export async function updateSubscriptionDb(subId: string, input: SubscriptionDbEdit) {
  return prisma.$transaction(async db => {
    const target = await db.subscription.findUnique({ where: { id: subId } });
    if (!target) throw new SubscriptionEditError("Подписка не найдена", 404);
    await lockOwner(db, target.ownerId);
    const fresh = await db.subscription.findUnique({ where: { id: subId } });
    if (!fresh || fresh.ownerId !== target.ownerId) throw new SubscriptionEditError("Подписка изменилась. Обновите страницу");
    if (input.syncToClient && fresh.subscriptionIndex !== 0) throw new SubscriptionEditError("Сначала сделайте подписку основной отдельной кнопкой");
    if (input.tariffId && !await db.tariff.findUnique({ where: { id: input.tariffId } })) throw new SubscriptionEditError("Тариф не найден", 404);
    if (input.remnawaveUuid !== undefined) await checkUuid(db, fresh.ownerId, subId, input.remnawaveUuid);
    const { syncToClient, expireAt, ...fields } = input;
    if (Object.keys(fields).length === 0 && expireAt === undefined) throw new SubscriptionEditError("Нет полей для обновления", 400);
    const updated = await db.subscription.update({ where: { id: subId }, data: {
      ...fields,
      ...(input.remnawaveUuid !== undefined && input.remnawaveUuid !== fresh.remnawaveUuid ? {
        shortUuid: null, remnaStatus: null, trafficUsedBytes: null, trafficLimitBytes: null,
        remnaSyncedAt: null, lastTrafficResetAt: null, subRevokedAt: null, expireAt: null,
      } : {}),
      ...(expireAt !== undefined ? { expireAt: expireAt === null ? null : new Date(expireAt) } : {}),
    } });
    if (updated.subscriptionIndex === 0) {
      if (!isPrimaryEligible(updated)) throw new SubscriptionEditError("Сначала исправьте основной слот подарочной подписки");
      await mirrorPrimary(db, updated, updated.remnawaveUuid !== fresh.remnawaveUuid || updated.tariffId !== fresh.tariffId);
    }
    return updated;
  }, { timeout: 20_000 });
}

export type NormalizedSubscriptionSlots = {
  primaryId: string | null;
  primaryRemnawaveUuid: string | null;
  promotedId: string | null;
  reindexed: boolean;
};

export async function normalizeClientSubscriptionSlots(clientId: string, removedUuids: string[] = []): Promise<NormalizedSubscriptionSlots> {
  return prisma.$transaction(async db => {
    await lockOwner(db, clientId);
    const owner = await db.client.findUniqueOrThrow({ where: { id: clientId } });
    const subs = await db.subscription.findMany({ where: { ownerId: clientId }, orderBy: [{ subscriptionIndex: "asc" }, { createdAt: "asc" }] });
    const untouched = { primaryId: null, primaryRemnawaveUuid: owner.remnawaveUuid, promotedId: null, reindexed: false };
    let current = subs;
    let phantomsRemoved = 0;
    const removed = new Set(removedUuids);
    if (subs.some(sub => !!sub.tariffId || !!sub.expireAt || !!sub.trialId)) {
      const phantoms = subs.filter(sub =>
        !!sub.remnawaveUuid && !sub.tariffId && !sub.expireAt && !sub.trialId
        && !sub.giftStatus && !sub.purchasedAsGift && !sub.giftedToClientId);
      if (phantoms.length) {
        const giftCodes = await db.giftCode.findMany({
          where: { subscriptionId: { in: phantoms.map(sub => sub.id) } },
          select: { subscriptionId: true },
        });
        const withGifts = new Set(giftCodes.map(code => code.subscriptionId));
        const removable = phantoms.filter(sub => !withGifts.has(sub.id));
        if (removable.length) {
          await db.subscription.deleteMany({ where: { id: { in: removable.map(sub => sub.id) } } });
          for (const sub of removable) if (sub.remnawaveUuid) removed.add(sub.remnawaveUuid);
          phantomsRemoved = removable.length;
          current = await db.subscription.findMany({ where: { ownerId: clientId }, orderBy: [{ subscriptionIndex: "asc" }, { createdAt: "asc" }] });
        }
      }
    }
    if (!phantomsRemoved && owner.remnawaveUuid && !removed.has(owner.remnawaveUuid) && !current.some(s => s.remnawaveUuid === owner.remnawaveUuid)) return untouched;
    const { ordered, promotedId, reindexed } = planSubscriptionSlotOrder(current);
    if (!ordered.length) {
      if (owner.remnawaveUuid && removed.has(owner.remnawaveUuid)) {
        await db.client.update({ where: { id: clientId }, data: { remnawaveUuid: null, currentTariffId: null, autoRenewEnabled: false, autoRenewTariffId: null, autoRenewPriceOptionId: null, autoRenewExtraDevices: 0, customPrimaryPrice: null, currentPricePerDay: null } });
        return { ...untouched, primaryRemnawaveUuid: null };
      }
      return untouched;
    }
    if (reindexed) {
      const temporary = Math.min(0, ...current.map(s => s.subscriptionIndex)) - 1;
      for (let i = 0; i < ordered.length; i++) await db.subscription.update({ where: { id: ordered[i].id }, data: { subscriptionIndex: temporary - i } });
      for (let i = 0; i < ordered.length; i++) await db.subscription.update({ where: { id: ordered[i].id }, data: { subscriptionIndex: i } });
    }
    await mirrorPrimary(db, ordered[0], ordered[0].subscriptionIndex !== 0);
    return { primaryId: ordered[0].id, primaryRemnawaveUuid: ordered[0].remnawaveUuid, promotedId, reindexed };
  }, { timeout: 20_000 });
}

export async function healMissingPrimarySlot(clientId: string): Promise<string | null> {
  const primary = await getPrimarySubscription(clientId);
  if (primary && isPrimaryEligible(primary)) return null;
  try {
    return (await normalizeClientSubscriptionSlots(clientId)).promotedId;
  } catch (error) {
    console.warn("[subscription self-heal] failed:", error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * следующий index для ДОП. подписки (НЕ primary).
 * Первый свободный слот, но **никогда не 0**. Если [0] свободен — пропускаем, берём 1.
 * Используется для подарочных подписок (они не должны занимать primary-слот).
 */
export async function getNextAdditionalSubscriptionIndex(clientId: string): Promise<number> {
  const subs = await prisma.subscription.findMany({
    where: { ownerId: clientId },
    select: { subscriptionIndex: true },
  });
  const used = new Set(subs.map((s) => s.subscriptionIndex));
  for (let i = 1; i < 10_000; i++) {
    if (!used.has(i)) return i;
  }
  return subs.length + 1;
}

/**
 * универсальный upsert по первому свободному слоту.
 *
 * Используется когда нужно «приземлить» Remna-юзера (UUID) в подписку клиента,
 * НЕ привязываясь к конкретному index. Берём первый свободный (0, 1, 2…) и пишем туда.
 *
 * Если у клиента уже есть подписка с этим remnawaveUuid → UPDATE (а не дубль).
 * Это важно для триала: триал может несколько раз обновлять Remna-юзера в рамках одной
 * подписки клиента, не плодя записи.
 */
export async function upsertSubscriptionByRemnaUuid(
  clientId: string,
  data: {
    remnawaveUuid: string;
    tariffId?: string | null;
    trialId?: string | null;
    customPrice?: number | null;
    currentPricePerDay?: number | null;
    autoRenewEnabled?: boolean;
    expireAt?: Date | null;
  },
): Promise<{ id: string; subscriptionIndex: number; created: boolean }> {
  return prisma.$transaction(async db => {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"subscription-owner:" + clientId}, 0))`;
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"subscription-remna:" + data.remnawaveUuid}, 0))`;
    const byUuid = await db.subscription.findFirst({
      where: { remnawaveUuid: data.remnawaveUuid },
      select: { id: true, ownerId: true, subscriptionIndex: true },
    });
    if (byUuid && byUuid.ownerId !== clientId) throw new Error("VPN profile belongs to another client");
    const otherClient = await db.client.findFirst({
      where: { remnawaveUuid: data.remnawaveUuid, id: { not: clientId } },
      select: { id: true },
    });
    if (otherClient) throw new Error("VPN profile belongs to another client");
    if (byUuid) {
      await db.subscription.update({ where: { id: byUuid.id }, data });
      return { id: byUuid.id, subscriptionIndex: byUuid.subscriptionIndex, created: false };
    }
    const subs = await db.subscription.findMany({ where: { ownerId: clientId }, select: { subscriptionIndex: true } });
    const used = new Set(subs.map(sub => sub.subscriptionIndex));
    let subscriptionIndex = 0;
    while (used.has(subscriptionIndex)) subscriptionIndex++;
    const created = await db.subscription.create({
      data: { ownerId: clientId, subscriptionIndex, ...data },
      select: { id: true, subscriptionIndex: true },
    });
    return { ...created, created: true };
  });
}
