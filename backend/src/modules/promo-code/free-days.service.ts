import type { Prisma } from '@prisma/client';
import { prisma } from '../../db.js';
import { extractRemnaUuid, isRemnaConfigured, remnaCreateUser, remnaGetUser, remnaUpdateUser, remnaUsernameFromClient } from '../remna/remna.client.js';

type Db = Prisma.TransactionClient;
export class PromoCodeError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

type FreeDaysInput = {
  tariffId?: string | null;
  tariffPriceOptionId?: string | null;
  durationDays?: number | null;
  squadUuid?: string | null;
};

/** Old squad-only codes can be used only when their tariff is unambiguous. */
export async function resolveFreeDaysPlan(input: FreeDaysInput, db: Db = prisma, allowLegacy = false) {
  let tariffId = input.tariffId;
  if (!tariffId && allowLegacy && input.squadUuid) {
    const matches = await db.tariff.findMany({ where: { internalSquadUuids: { has: input.squadUuid } }, take: 2 });
    if (matches.length === 1) tariffId = matches[0].id;
  }
  if (!tariffId) throw new PromoCodeError('Выберите тариф для промокода «Бесплатные дни»');
  const tariff = await db.tariff.findUnique({ where: { id: tariffId } });
  if (!tariff || !tariff.internalSquadUuids.length) throw new PromoCodeError('Тариф не найден или у него не настроены сквады');
  const option = input.tariffPriceOptionId
    ? await db.tariffPriceOption.findUnique({ where: { id: input.tariffPriceOptionId } }) : null;
  if (input.tariffPriceOptionId && (!option || option.tariffId !== tariff.id)) {
    throw new PromoCodeError('Опция длительности не принадлежит выбранному тарифу');
  }
  const durationDays = input.durationDays ?? option?.durationDays ?? tariff.durationDays;
  if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 3650) {
    throw new PromoCodeError('Укажите срок от 1 до 3650 дней');
  }
  return { tariff, option, durationDays };
}

/** Snapshot the selected duration; limits and squads always come from the tariff. */
export async function freeDaysSettings(input: FreeDaysInput) {
  const { tariff, option, durationDays } = await resolveFreeDaysPlan(input);
  return {
    tariffId: tariff.id, tariffPriceOptionId: option?.id ?? null,
    durationDays: option?.durationDays ?? durationDays,
    squadUuid: null, trafficLimitBytes: null, deviceLimit: null,
  };
}

function unwrapUser(data: unknown): Record<string, unknown> {
  let value = data;
  for (let depth = 0; depth < 5; depth++) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) break;
    const obj = value as Record<string, unknown>;
    if ('expireAt' in obj || 'uuid' in obj || 'id' in obj) return obj;
    value = obj.response ?? obj.data;
  }
  return {};
}

/** Add days to the primary subscription, without converting a customer's paid tariff. */
export async function activateFreeDaysPromo(clientId: string, code: string) {
  if (!isRemnaConfigured()) throw new PromoCodeError('Сервис временно недоступен', 503);
  return prisma.$transaction(async (db) => {
    // Serialize activation limits across API processes, and different codes for one client.
    await db.$queryRaw`SELECT id FROM promo_codes WHERE code = ${code.trim()} FOR UPDATE`;
    await db.$queryRaw`SELECT id FROM clients WHERE id = ${clientId} FOR UPDATE`;
    const promo = await db.promoCode.findUnique({ where: { code: code.trim() } });
    if (!promo || !promo.isActive) throw new PromoCodeError('Промокод не найден или неактивен', 404);
    if (promo.type !== 'FREE_DAYS') throw new PromoCodeError('Промокод на скидку применяется при оплате тарифа');
    if (promo.expiresAt && promo.expiresAt < new Date()) throw new PromoCodeError('Срок действия промокода истёк');
    if (promo.maxUses > 0 && await db.promoCodeUsage.count({ where: { promoCodeId: promo.id } }) >= promo.maxUses) {
      throw new PromoCodeError('Лимит использований промокода исчерпан');
    }
    if (await db.promoCodeUsage.count({ where: { promoCodeId: promo.id, clientId } }) >= promo.maxUsesPerClient) {
      throw new PromoCodeError('Вы уже использовали этот промокод');
    }
    const { tariff, durationDays } = await resolveFreeDaysPlan(promo, db, true);
    const client = await db.client.findUnique({ where: { id: clientId } });
    if (!client) throw new PromoCodeError('Клиент не найден', 404);
    const primary = await db.subscription.findUnique({ where: { ownerId_subscriptionIndex: { ownerId: clientId, subscriptionIndex: 0 } } });
    if (primary?.purchasedAsGift || primary?.giftStatus) throw new PromoCodeError('Основная подписка зарезервирована под подарок');
    // The unified subscription is authoritative. The client field is only a legacy fallback.
    let uuid = primary?.remnawaveUuid ?? client.remnawaveUuid;
    let user: Record<string, unknown> = {};
    let base = Date.now();
    if (uuid) {
      const other = await db.subscription.findFirst({ where: { remnawaveUuid: uuid, ...(primary ? { id: { not: primary.id } } : {}) } });
      if (other) throw new PromoCodeError('VPN-пользователь уже привязан к другой подписке', 409);
      const response = await remnaGetUser(uuid);
      if (response.error || response.status >= 400) throw new PromoCodeError('Не удалось получить подписку из Remnawave. Повторите позже.', 502);
      user = unwrapUser(response.data);
      const remoteDate = typeof user.expireAt === 'string' ? Date.parse(user.expireAt) : NaN;
      // Never reset a live subscription after an incomplete/malformed upstream response.
      const currentDate = Number.isFinite(remoteDate) ? remoteDate : primary?.expireAt?.getTime();
      if (currentDate == null || !Number.isFinite(currentDate)) throw new PromoCodeError('Remnawave не вернул срок подписки', 502);
      base = Math.max(base, currentDate);
    }
    const expireAt = new Date(base + durationDays * 86400000);
    if (uuid) {
      // Days-only patch preserves paid squads, traffic, devices and manual blocking.
      const response = await remnaUpdateUser({ uuid, expireAt: expireAt.toISOString(), ...(user.status === 'EXPIRED' ? { status: 'ACTIVE' } : {}) });
      if (response.error || response.status >= 400) throw new PromoCodeError('Не удалось продлить подписку в Remnawave', 502);
      if (user.status === 'EXPIRED') user.status = 'ACTIVE';
    } else {
      const response = await remnaCreateUser({
        username: remnaUsernameFromClient({ ...client, clientIdFallback: client.id }),
        expireAt: expireAt.toISOString(), status: 'ACTIVE',
        activeInternalSquads: tariff.internalSquadUuids,
        trafficLimitBytes: Number(tariff.trafficLimitBytes ?? 0),
        trafficLimitStrategy: tariff.trafficResetMode === 'monthly' ? 'MONTH' : tariff.trafficResetMode === 'monthly_rolling' ? 'MONTH_ROLLING' : 'NO_RESET',
        hwidDeviceLimit: tariff.includedDevices,
        ...(client.telegramId && { telegramId: Number(client.telegramId) }),
        ...(client.email && { email: client.email }),
      });
      uuid = extractRemnaUuid(response.data);
      if (response.error || response.status >= 400 || !uuid) throw new PromoCodeError('Не удалось создать подписку в Remnawave', 502);
      user = unwrapUser(response.data);
    }
    const subscription = await db.subscription.upsert({
      where: { ownerId_subscriptionIndex: { ownerId: clientId, subscriptionIndex: 0 } },
      create: { ownerId: clientId, subscriptionIndex: 0, remnawaveUuid: uuid, tariffId: client.currentTariffId ?? tariff.id, expireAt, promoGranted: !client.currentTariffId,
        remnaStatus: typeof user.status === 'string' ? user.status : 'ACTIVE' },
      update: { remnawaveUuid: uuid, expireAt,
        // A paid or trial subscription keeps its tariff and all renewal settings.
        ...(!primary?.tariffId && !primary?.trialId ? { tariffId: client.currentTariffId ?? tariff.id, promoGranted: !client.currentTariffId } : {}),
        ...(typeof user.status === 'string' ? { remnaStatus: user.status } : {}),
      },
    });
    await db.client.update({ where: { id: clientId }, data: { remnawaveUuid: uuid } });
    await db.promoCodeUsage.create({ data: { promoCodeId: promo.id, clientId } });
    return { subscriptionId: subscription.id, durationDays, code: promo.code };
  }, { maxWait: 5000, timeout: 60000 });
}
