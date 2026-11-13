import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { cloudTrialUsed } from "../cloudpayments/cloudpayments-trial.js";
import { readSubscriptionDevices, usesLegacyDeviceFallback } from "./subscription-devices.js";
import { getSystemConfig } from "./client.service.js";
import { remnaUpdateUser, isRemnaConfigured, remnaGetUser, remnaGetUserByTelegramId, extractRemnaUuid, remnaGetUserHwidDevices, remnaDeleteUserHwidDevice, encryptSubscriptionUrlInPlace, remnaRevokeUserSubscription } from "../remna/remna.client.js";
import { offlineSubscriptionSnapshot } from "../remna/offline-snapshot.js";
import { activateTariffForClient } from "../tariff/tariff-activation.service.js";
import { upsertSubscriptionByRemnaUuid } from "../subscription/subscription.helpers.js";
import { autoRenewPrefsFromLastPayment } from "../payment/secondary-renew-plan.js";
import { requireRemnaOnline } from "./client.middleware.js";
import { toClientShape } from "./client-auth.routes.js";
import { fetchAvailableTrialsForClient } from "./client-trials-promo.routes.js";

export const clientSubscriptionsRouter = Router();

/** Определить отображаемое имя тарифа: Триал, название с сайта или «Тариф не выбран».
 *  Поддерживает activeInternalSquads как массив строк (uuid) или объектов { uuid }.
 *  Приоритет: сначала ищем совпадение с оплаченным тарифом, затем — триал. */
async function resolveTariffDisplayName(remnaUserData: unknown): Promise<string> {
  const raw = remnaUserData as { response?: { activeInternalSquads?: unknown[] }; activeInternalSquads?: unknown[] };
  const user = raw?.response ?? raw;
  const ais = user?.activeInternalSquads;
  const squadUuids: string[] = [];
  if (Array.isArray(ais)) {
    for (const s of ais) {
      const u = s != null && typeof s === "object" && "uuid" in s ? (s as { uuid: unknown }).uuid : s;
      if (typeof u === "string") squadUuids.push(u);
    }
  }
  if (squadUuids.length === 0) return "Тариф не выбран";
  const config = await getSystemConfig();
  const trialUuid = config.trialSquadUuid?.trim() || null;
  const tariffs = await prisma.tariff.findMany({ select: { name: true, internalSquadUuids: true } });
  for (const squadUuid of squadUuids) {
    if (trialUuid === squadUuid) continue;
    const match = tariffs.find((t) => t.internalSquadUuids.includes(squadUuid));
    if (match?.name) return match.name;
  }
  if (trialUuid && squadUuids.includes(trialUuid)) return "Тест";
  return "Тариф не выбран";
}

clientSubscriptionsRouter.get("/subscription", async (req, res) => {
  const client = (req as unknown as { client: { id: string; remnawaveUuid: string | null } }).client;
  // T-uuid-resync : резолвим активную подписку из таблицы subscriptions (root, index 0),
  // а НЕ по clients.remnawaveUuid — оно рассинхронивается при перевыпуске/продлении (указывает на старого
  // EXPIRED Remna-юзера, тогда как subscriptions хранит актуального). Бот берёт из subscriptions — кабинет теперь тоже.
  const rootSub = await prisma.subscription.findFirst({
    where: { ownerId: client.id, subscriptionIndex: 0, remnawaveUuid: { not: null } },
    select: { remnawaveUuid: true, trialId: true, expireAt: true, bannedUntil: true, banReason: true, tariff: { select: { name: true } }, trial: { select: { name: true, convertEnabled: true } } },
  });
  const effectiveUuid = rootSub?.remnawaveUuid ?? client.remnawaveUuid;
  if (!effectiveUuid) {
    return res.json({ subscription: null, tariffDisplayName: null, currentPricePerDay: null, message: "Подписка не привязана" });
  }
  // Self-heal: clients.remnawaveUuid разошёлся с актуальной подпиской → чиним (влияет на устройства, доп.подписки и пр.).
  if (rootSub?.remnawaveUuid && rootSub.remnawaveUuid !== client.remnawaveUuid) {
    prisma.client.update({ where: { id: client.id }, data: { remnawaveUuid: rootSub.remnawaveUuid } }).catch(() => {});
  }
  const result = await remnaGetUser(effectiveUuid);
  if (result.error) {
    // подписка не должна «пропадать», если Remna недоступна
    // или юзер там удалён: отдаём синтетический EXPIRED-объект из данных БД,
    // чтобы кабинет показал карточку с бейджем «Истекла» вместо «Нет подписки».
    if (rootSub) {
      const dbName = (rootSub.trialId ? rootSub.trial?.name?.trim() : undefined) ?? rootSub.tariff?.name?.trim() ?? null;
      return res.json({
        subscription: {
          status: "EXPIRED",
          expireAt: rootSub.expireAt?.toISOString() ?? null,
        },
        tariffDisplayName: dbName,
        currentPricePerDay: null,
        isTrial: Boolean(rootSub.trialId),
        trialName: rootSub.trialId ? (rootSub.trial?.name ?? null) : null,
        trialConvertEnabled: rootSub.trialId ? (rootSub.trial?.convertEnabled ?? true) : true,
        isBanned: !!(rootSub.bannedUntil && rootSub.bannedUntil.getTime() > Date.now()),
        banReason: rootSub.banReason ?? null,
        bannedUntil: rootSub.bannedUntil?.toISOString() ?? null,
        message: null,
      });
    }
    return res.json({ subscription: null, tariffDisplayName: null, currentPricePerDay: null, message: result.error });
  }

  // Опциональное шифрование subscriptionUrl в happ://crypt4/... — настройка happCryptEnabled.
  // По умолчанию выключено: crypt4-ссылка длинная (1500+ символов).
  const subCfg = await getSystemConfig();
  if (subCfg.happCryptEnabled) {
    await encryptSubscriptionUrlInPlace(result.data);
  }

  // Берём currentTariffId + currentPricePerDay (для UI отображения и для расчёта конвертации в warn-модалке)
  const dbClient = await prisma.client.findUnique({
    where: { id: client.id },
    select: {
      currentTariff: { select: { name: true } },
      currentPricePerDay: true,
      autoRenewEnabled: true,
      autoRenewTariffId: true,
      autoRenewPriceOptionId: true,
      autoRenewExtraDevices: true,
      autoRenewPromoCode: true,
      personalDiscountPercent: true,
      autoRenewTariff: { select: { id: true, price: true, durationDays: true, currency: true, pricePerExtraDevice: true, deviceDiscountTiers: true } },
    },
  });
  let tariffDisplayName: string;
  // имя тарифа в первую очередь из АКТУАЛЬНОЙ root-подписки
  // (subscription.tariffId обновляется при конвертации/продлении), и только потом —
  // из легаси Client.currentTariffId (его обновлял только старый activateTariffForClient,
  // поэтому после конвертации кабинет показывал имя СТАРОГО тарифа).
  // триальная подписка показывает имя ТРИАЛА (лейбл TRIAL — на фронте).
  if (rootSub?.trialId && rootSub.trial?.name?.trim()) {
    tariffDisplayName = rootSub.trial.name.trim();
  } else if (rootSub?.tariff?.name?.trim()) {
    tariffDisplayName = rootSub.tariff.name.trim();
  } else if (dbClient?.currentTariff?.name?.trim()) {
    tariffDisplayName = dbClient.currentTariff.name.trim();
  } else {
    tariffDisplayName = await resolveTariffDisplayName(result.data ?? null);
    if (tariffDisplayName === "Тест" || tariffDisplayName === "Тариф не выбран") {
      const lastPaidTariff = await prisma.payment.findFirst({
        where: { clientId: client.id, status: "PAID", tariffId: { not: null } },
        orderBy: { paidAt: "desc" },
        select: { tariff: { select: { name: true } } },
      });
      const name = lastPaidTariff?.tariff?.name?.trim();
      if (name) tariffDisplayName = name;
    }
  }

  // Автопродление: считаем следующее списание (сумма + дата) если включено.
  let autoRenewNextChargeAmount: number | null = null;
  let autoRenewNextChargeAt: string | null = null;
  let autoRenewCurrency: string | null = null;
  if (dbClient?.autoRenewEnabled && dbClient.autoRenewTariff) {
    try {
      const { applyExtraDevicesPrice, parseDeviceDiscountTiers } = await import("../tariff/tariff-activation.service.js");
      // Опция длительности
      let opt: { id: string; durationDays: number; price: number } | null = null;
      if (dbClient.autoRenewPriceOptionId) {
        const savedOpt = await prisma.tariffPriceOption.findFirst({
          where: { id: dbClient.autoRenewPriceOptionId, tariffId: dbClient.autoRenewTariff.id },
        });
        if (savedOpt) opt = { id: savedOpt.id, durationDays: savedOpt.durationDays, price: savedOpt.price };
      }
      if (!opt) {
        const fallback = await prisma.tariffPriceOption.findFirst({
          where: { tariffId: dbClient.autoRenewTariff.id },
          orderBy: { price: "asc" },
        });
        if (fallback) opt = { id: fallback.id, durationDays: fallback.durationDays, price: fallback.price };
      }
      const unitPrice = opt?.price ?? dbClient.autoRenewTariff.price;
      const durationDays = opt?.durationDays ?? dbClient.autoRenewTariff.durationDays;
      const tiers = parseDeviceDiscountTiers(dbClient.autoRenewTariff.deviceDiscountTiers);
      const { extrasTotal } = applyExtraDevicesPrice(
        dbClient.autoRenewTariff.pricePerExtraDevice ?? 0,
        dbClient.autoRenewExtraDevices ?? 0,
        tiers,
        durationDays,
      );
      let nextAmount = unitPrice + extrasTotal;
      // Персональная скидка
      if (typeof dbClient.personalDiscountPercent === "number" && dbClient.personalDiscountPercent > 0) {
        const pct = Math.min(100, dbClient.personalDiscountPercent);
        nextAmount = Math.round(nextAmount * (100 - pct)) / 100;
      }
      autoRenewNextChargeAmount = nextAmount;
      autoRenewCurrency = dbClient.autoRenewTariff.currency.toUpperCase();

      // Дата = expireAt − autoRenewDaysBeforeExpiry дней (config, default 1).
      const respObj = (result.data as Record<string, unknown> | null);
      const remnaResp = (respObj?.response ?? respObj) as Record<string, unknown> | null;
      const expireRaw = remnaResp?.expireAt;
      if (typeof expireRaw === "string") {
        const expDate = new Date(expireRaw);
        if (!Number.isNaN(expDate.getTime())) {
          const cfg = await getSystemConfig();
          const daysBefore = cfg.autoRenewDaysBeforeExpiry ?? 1;
          const chargeDate = new Date(expDate.getTime() - daysBefore * 24 * 60 * 60 * 1000);
          autoRenewNextChargeAt = chargeDate.toISOString();
        }
      }
    } catch (e) {
      console.warn("[subscription] failed to compute auto-renew next charge:", e instanceof Error ? e.message : e);
    }
  }

  return res.json({
    subscription: result.data ?? null,
    tariffDisplayName,
    currentPricePerDay: dbClient?.currentPricePerDay ?? null,
    autoRenewNextChargeAmount,
    autoRenewNextChargeAt,
    autoRenewCurrency,
    // карточка триала: лейбл «TRIAL» + кнопка «Конвертировать»
    // (или вообще без кнопки, если конвертация триала запрещена в админке).
    isTrial: Boolean(rootSub?.trialId),
    trialName: rootSub?.trialId ? (rootSub.trial?.name ?? null) : null,
    trialConvertEnabled: rootSub?.trialId ? (rootSub.trial?.convertEnabled ?? true) : true,
    isBanned: !!(rootSub?.bannedUntil && rootSub.bannedUntil.getTime() > Date.now()),
    banReason: rootSub?.banReason ?? null,
    bannedUntil: rootSub?.bannedUntil?.toISOString() ?? null,
  });
});

/**
 * GET /api/client/subscription/by-uuid/:uuid — Подписка по Remnawave UUID.
 * Используется на /cabinet/subscribe?uuid=xxx для secondary подписок.
 */
clientSubscriptionsRouter.get("/subscription/by-uuid/:uuid", async (req, res) => {
  const client = (req as unknown as { client: { id: string; remnawaveUuid: string | null } }).client;
  const clientId = (req as unknown as { clientId: string }).clientId;
  const { uuid } = req.params;
  if (!uuid || typeof uuid !== "string") {
    return res.status(400).json({ subscription: null, tariffDisplayName: null, message: "UUID не указан" });
  }

  // Проверяем принадлежность: root или secondary подписка
  const isRoot = client.remnawaveUuid === uuid;
  if (!isRoot) {
    const secondarySub = await prisma.subscription.findFirst({
      where: { ownerId: clientId, remnawaveUuid: uuid },
    });
    if (!secondarySub) {
      return res.status(404).json({ subscription: null, tariffDisplayName: null, message: "Подписка не найдена" });
    }
  }

  const result = await remnaGetUser(uuid);
  if (result.error) {
    return res.json({ subscription: null, tariffDisplayName: null, message: result.error });
  }
  const subUuidCfg = await getSystemConfig();
  if (subUuidCfg.happCryptEnabled) {
    await encryptSubscriptionUrlInPlace(result.data);
  }
  const tariffDisplayName = await resolveTariffDisplayName(result.data ?? null);
  return res.json({ subscription: result.data ?? null, tariffDisplayName });
});

export type ClientSubInfo = {
  type: "root" | "secondary";
  id: string;
  subscriptionIndex: number | null;
  subscription: unknown;
  tariffDisplayName: string;
  customName: string | null;
  remnawaveUuid: string | null;
  tariffId: string | null;
  trialId: string | null;
  autoRenewEnabled: boolean;
  tariffMenuEmoji: string | null;
  extraDevices: number;
  extraDevicesMonthlyPrice: number;
  convertTariffIds: string[];
  trialName: string | null;
  trialConvertEnabled: boolean;
  trialConvertAllTariffs: boolean;
  isBanned: boolean;
  banReason: string | null;
  bannedUntil: string | null;
  isOfflineSnapshot?: boolean;
};

async function doFetchClientSubscriptionsAll(clientId: string): Promise<{ items: ClientSubInfo[] }> {
  const subAllCfg = await getSystemConfig();
  const cryptOn = subAllCfg.happCryptEnabled;

  const allSubs = await prisma.subscription.findMany({
    where: {
      OR: [
        { ownerId: clientId, purchasedAsGift: false },
        { giftedToClientId: clientId, giftStatus: "GIFTED" },
      ],
    },
    select: {
      id: true,
      customName: true,
      remnawaveUuid: true,
      subscriptionIndex: true,
      trialId: true,
      giftStatus: true,
      autoRenewEnabled: true,
      extraDevices: true,
      extraDevicesMonthlyPrice: true,
      bannedUntil: true,
      banReason: true,
      shortUuid: true,
      expireAt: true,
      remnaStatus: true,
      trafficUsedBytes: true,
      trafficLimitBytes: true,
      tariff: { select: { id: true, name: true, menuEmoji: true, trafficLimitBytes: true, includedDevices: true, deviceLimit: true } },
      trial: { select: { name: true, convertEnabled: true, convertAllTariffs: true, convertTariffIds: true } },
    },
    orderBy: { subscriptionIndex: "asc" },
  });

  const visible = allSubs.filter((s) => {
    const gs = s.giftStatus ?? "";
    return gs !== "GIFT_RESERVED" && gs !== "GIFT_CODE_ACTIVE";
  });

  if (allSubs.length === 0) {
    const cl = await prisma.client.findUnique({
      where: { id: clientId },
      select: { remnawaveUuid: true, telegramId: true },
    });
    let uuidToHeal = cl?.remnawaveUuid;
    if (!uuidToHeal && cl?.telegramId && isRemnaConfigured()) {
      try {
        const byTg = await remnaGetUserByTelegramId(cl.telegramId);
        uuidToHeal = extractRemnaUuid(byTg.data);
        if (uuidToHeal) {
          await upsertSubscriptionByRemnaUuid(clientId, { remnawaveUuid: uuidToHeal });
          await prisma.client.update({ where: { id: clientId }, data: { remnawaveUuid: uuidToHeal } });
        }
      } catch { uuidToHeal = null; }
    }
    if (uuidToHeal) {
      const healed = await upsertSubscriptionByRemnaUuid(clientId, { remnawaveUuid: uuidToHeal }).catch(() => null);
      const healedSub = await prisma.subscription.findFirst({
        where: { id: healed?.id ?? "", ownerId: clientId, purchasedAsGift: false, giftStatus: null },
        select: {
          id: true,
          customName: true,
          remnawaveUuid: true,
          subscriptionIndex: true,
          trialId: true,
          giftStatus: true,
          autoRenewEnabled: true,
          extraDevices: true,
          extraDevicesMonthlyPrice: true,
          bannedUntil: true,
          banReason: true,
          shortUuid: true,
          expireAt: true,
          remnaStatus: true,
          trafficUsedBytes: true,
          trafficLimitBytes: true,
          tariff: { select: { id: true, name: true, menuEmoji: true, trafficLimitBytes: true, includedDevices: true, deviceLimit: true } },
          trial: { select: { name: true, convertEnabled: true, convertAllTariffs: true, convertTariffIds: true } },
        },
      });
      if (healedSub) visible.push(healedSub);
    }
  }

  const items: ClientSubInfo[] = await Promise.all(
    visible.map(async (sub) => {
      let remnaPayload: unknown = null;
      let isOfflineSnapshot = false;
      let tariffName = (sub.trialId ? sub.trial?.name?.trim() : undefined) ?? sub.tariff?.name?.trim() ?? "";
      if (sub.remnawaveUuid) {
        let r: { data?: unknown; error?: string; status: number } | null = null;
        try {
          r = await remnaGetUser(sub.remnawaveUuid);
        } catch {
          r = null;
        }
        if (r?.data) {
          if (cryptOn) await encryptSubscriptionUrlInPlace(r.data);
          remnaPayload = r.data ?? null;
          if (!tariffName) tariffName = await resolveTariffDisplayName(r.data ?? null);
        } else if (!r || r.status >= 500 || r.status === 429) {
          isOfflineSnapshot = true;
          remnaPayload = offlineSubscriptionSnapshot(sub);
        }
      }
      if (!tariffName) tariffName = "Тариф не выбран";

      return {
        type: sub.subscriptionIndex === 0 ? "root" : "secondary",
        id: sub.id,
        subscriptionIndex: sub.subscriptionIndex,
        subscription: remnaPayload,
        isOfflineSnapshot,
        tariffDisplayName: tariffName,
        customName: sub.customName,
        remnawaveUuid: sub.remnawaveUuid,
        tariffId: sub.tariff?.id ?? null,
        trialId: sub.trialId ?? null,
        autoRenewEnabled: sub.autoRenewEnabled === true,
        tariffMenuEmoji: sub.tariff?.menuEmoji?.trim() || null,
        extraDevices: sub.extraDevices ?? 0,
        extraDevicesMonthlyPrice: sub.extraDevicesMonthlyPrice ?? 0,
        isBanned: !!(sub.bannedUntil && sub.bannedUntil.getTime() > Date.now()),
        banReason: sub.banReason ?? null,
        bannedUntil: sub.bannedUntil?.toISOString() ?? null,
        convertTariffIds: (() => {
          if (!sub.trialId || !sub.trial?.convertTariffIds) return [];
          try {
            const parsed = JSON.parse(sub.trial.convertTariffIds) as unknown;
            return Array.isArray(parsed) ? parsed.map((x) => String(x)) : [];
          } catch { return []; }
        })(),
        trialName: sub.trialId ? (sub.trial?.name ?? null) : null,
        trialConvertEnabled: sub.trialId ? (sub.trial?.convertEnabled ?? true) : true,
        trialConvertAllTariffs: sub.trialId ? (sub.trial?.convertAllTariffs ?? false) : false,
      };
    })
  );

  return { items };
}

export async function fetchClientSubscriptionsAll(clientId: string): Promise<{ items: ClientSubInfo[] }> {
  return doFetchClientSubscriptionsAll(clientId);
}

/**
 * GET /api/client/subscription/all — Все подписки клиента (root + secondary).
 * Возвращает массив с Remnawave-данными для каждой подписки.
 */
clientSubscriptionsRouter.get("/subscription/all", async (req, res) => {
  const clientId = (req as unknown as { clientId: string }).clientId;
  const result = await fetchClientSubscriptionsAll(clientId);
  console.log(`[subscription/all] client=${clientId} total=${result.items.length}`);
  return res.json(result);
});

/**
 * GET /api/client/bot-bootstrap — данные профиля, подписок и триалов для главного меню бота.
 * Собирает профиль клиента, основную подписку, список всех подписок и доступные триалы за 1 вызов.
 */
clientSubscriptionsRouter.get("/bot-bootstrap", async (req, res) => {
  const clientId = (req as unknown as { clientId: string }).clientId;
  const [full, subsResult, trialsResult, paidTrialUsed] = await Promise.all([
    prisma.client.findUnique({
      where: { id: clientId },
      select: {
        id: true, email: true, telegramId: true, telegramUsername: true, preferredLang: true, preferredCurrency: true,
        balance: true, referralCode: true, referralPercent: true, remnawaveUuid: true, trialUsed: true, isBlocked: true,
        autoRenewEnabled: true, autoRenewTariffId: true, autoRenewPromoCode: true, yoomoneyAccessToken: true,
        totpEnabled: true, createdAt: true, yookassaPaymentMethodTitle: true, onboardingCompleted: true, passwordHash: true,
        currentTariffId: true,
        currentTariff: { select: { id: true, name: true, categoryId: true } },
        personalDiscountPercent: true,
      },
    }),
    fetchClientSubscriptionsAll(clientId),
    fetchAvailableTrialsForClient(clientId),
    cloudTrialUsed(clientId),
  ]);

  if (!full) {
    return res.status(401).json({ message: "Client not found" });
  }

  const client = toClientShape(full);
  const rootItem = subsResult.items.find((s) => s.subscriptionIndex === 0 || s.type === "root") ?? subsResult.items[0];
  const primarySubscription = rootItem ? {
    subscription: rootItem.subscription,
    tariffDisplayName: rootItem.tariffDisplayName,
    isTrial: Boolean(rootItem.trialId),
    trialName: rootItem.trialName,
    trialConvertEnabled: rootItem.trialConvertEnabled,
    isBanned: rootItem.isBanned,
    banReason: rootItem.banReason,
  } : {
    subscription: null,
    tariffDisplayName: null,
    currentPricePerDay: null,
    message: "Подписка не привязана",
  };

  return res.json({
    cloudTrialAvailable: !paidTrialUsed,
    client,
    subscription: primarySubscription,
    allSubscriptions: subsResult,
    availableTrials: trialsResult,
  });
});

clientSubscriptionsRouter.patch("/subscription/:id/name", async (req, res) => {
  const clientId = (req as unknown as { clientId: string }).clientId;
  const body = z.object({ name: z.string().trim().min(1).max(60).refine(value => !/[\u0000-\u001f\u007f]/.test(value)) }).strict().safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Название должно содержать от 1 до 60 символов" });
  const result = await prisma.subscription.updateMany({
    where: { id: req.params.id, OR: [
      { ownerId: clientId, purchasedAsGift: false, giftedToClientId: null, giftStatus: { notIn: ["GIFT_RESERVED", "GIFT_CODE_ACTIVE", "GIFTED"] } },
      { ownerId: clientId, purchasedAsGift: false, giftedToClientId: null, giftStatus: null },
      { giftedToClientId: clientId, giftStatus: "GIFTED" },
    ] },
    data: { customName: body.data.name },
  });
  if (!result.count) return res.status(404).json({ message: "Подписка не найдена" });
  return res.json({ customName: body.data.name });
});

/**
 * pre-check кулдауна продления для конкретной подписки.
 * Бот дёргает перед отрисовкой кнопки «💰 Продлить» и при клике на неё — чтобы сразу выдать
 * сообщение «нельзя ещё N дней», не дожидаясь экрана выбора провайдера.
 *
 * Принимает `subscriptionId` (= Subscription.id). Возвращает:
 *   { blocked: false } — продление доступно
 *   { blocked: true, daysLeft, message, tariffName, cooldownDays } — заблокировано
 */
clientSubscriptionsRouter.get("/subscription/:id/cooldown", async (req, res) => {
  const clientId = (req as unknown as { clientId: string }).clientId;
  const subId = req.params.id;
  // Проверяем что подписка принадлежит клиенту (или подарена ему).
  const sub = await prisma.subscription.findUnique({
    where: { id: subId },
    select: { id: true, ownerId: true, giftedToClientId: true },
  });
  if (!sub || (sub.ownerId !== clientId && sub.giftedToClientId !== clientId)) {
    return res.status(404).json({ blocked: false, error: "subscription_not_found" });
  }
  const { checkSubscriptionRenewalCooldown } = await import("../tariff/tariff-cooldown.service.js");
  const cd = await checkSubscriptionRenewalCooldown(subId);
  if (cd.ok) return res.json({ blocked: false });
  return res.json({
    blocked: true,
    daysLeft: cd.daysLeft,
    message: cd.message,
    tariffName: cd.tariffName,
    cooldownDays: cd.cooldownDays,
    nextAvailableAt: cd.nextAvailableAt.toISOString(),
  });
});

/**
 * batch-проверка кулдаунов для нескольких подписок сразу.
 * Используется в боте на экране выбора подписки для продления (renew_pick) — чтобы пометить
 * каждую подписку либо доступной, либо иконкой 🚫 «нельзя ещё N дней».
 *
 * Body: { ids: string[] }
 * Возвращает: { items: Array<{ subscriptionId, blocked, daysLeft?, message? }> }
 */
clientSubscriptionsRouter.post("/subscriptions/cooldown-check", async (req, res) => {
  const clientId = (req as unknown as { clientId: string }).clientId;
  const body = req.body as { ids?: unknown };
  if (!Array.isArray(body.ids)) return res.status(400).json({ message: "ids должен быть массивом" });
  const ids = body.ids.filter((v): v is string => typeof v === "string" && v.length > 0).slice(0, 50);
  if (ids.length === 0) return res.json({ items: [] });
  const subs = await prisma.subscription.findMany({
    where: {
      id: { in: ids },
      OR: [{ ownerId: clientId }, { giftedToClientId: clientId }],
    },
    select: { id: true },
  });
  const { checkSubscriptionRenewalCooldown } = await import("../tariff/tariff-cooldown.service.js");
  const items = await Promise.all(subs.map(async (s) => {
    const cd = await checkSubscriptionRenewalCooldown(s.id);
    if (cd.ok) return { subscriptionId: s.id, blocked: false };
    return {
      subscriptionId: s.id,
      blocked: true,
      daysLeft: cd.daysLeft,
      cooldownDays: cd.cooldownDays,
      tariffName: cd.tariffName,
      message: cd.message,
    };
  }));
  return res.json({ items });
});

/**
 * POST /api/client/subscription/:type/:id/reissue
 * «Обновление подписки» (скрин 8 эталона) — перевыпуск subscription URL.
 *
 * Что делает: вызывает Remnawave POST /api/users/{uuid}/actions/revoke,
 * который генерирует новый shortUuid → старая ссылка перестаёт работать,
 * выдаётся новая. Срок (expireAt), тариф, лимиты, устройства — НЕ меняются.
 *
 * type = "root"      → `id` это clientId, берём client.remnawaveUuid
 * type = "secondary" → `id` это secondarySubscription.id, берём её remnawaveUuid
 *
 * Зачем: клиент мог поделиться ссылкой / его конфиг засветился. Даём перевыпустить.
 */
clientSubscriptionsRouter.post("/subscription/:type/:id/reissue", requireRemnaOnline, async (req, res) => {
  if (!isRemnaConfigured()) return res.status(503).json({ message: "Remna API не настроен" });
  const subType = req.params.type;
  const subId = req.params.id;
  if (subType !== "root" && subType !== "secondary") {
    return res.status(400).json({ message: "Неверный тип подписки" });
  }
  const clientId = (req as unknown as { clientId: string }).clientId;

  // резолвим подписку через унифицированную таблицу.
  // type=root → ищем primary (subscriptionIndex=0). type=secondary → ищем по id.
  const sub = subType === "root"
    ? await prisma.subscription.findUnique({
        where: { ownerId_subscriptionIndex: { ownerId: clientId, subscriptionIndex: 0 } },
        select: { id: true, ownerId: true, giftedToClientId: true, remnawaveUuid: true },
      })
    : await prisma.subscription.findUnique({
        where: { id: subId },
        select: { id: true, ownerId: true, giftedToClientId: true, remnawaveUuid: true },
      });
  if (!sub && subType === "secondary") return res.status(404).json({ message: "Подписка не найдена" });
  if (sub && sub.ownerId !== clientId && sub.giftedToClientId !== clientId) {
    return res.status(403).json({ message: "Нет доступа" });
  }
  let targetUuid = sub?.remnawaveUuid ?? null;
  if (!targetUuid && subType === "root") {
    const legacy = await prisma.client.findUnique({
      where: { id: clientId },
      select: { remnawaveUuid: true },
    });
    targetUuid = legacy?.remnawaveUuid ?? null;
  }
  if (!targetUuid) return res.status(404).json({ message: "Подписка не привязана к Remnawave" });

  try {
    await remnaRevokeUserSubscription(targetUuid);
    // Достаём свежий subscription URL.
    const fresh = await remnaGetUser(targetUuid);
    const inner = (fresh.data as { response?: Record<string, unknown>; data?: Record<string, unknown> } | null)?.response
      ?? (fresh.data as { response?: Record<string, unknown>; data?: Record<string, unknown> } | null)?.data
      ?? (fresh.data as Record<string, unknown> | null);
    const newUrl = (inner as { subscriptionUrl?: string } | null)?.subscriptionUrl ?? null;
    return res.json({ ok: true, subscriptionUrl: newUrl });
  } catch (e) {
    console.error("[reissue] error:", e);
    return res.status(500).json({ message: e instanceof Error ? e.message : "Ошибка обновления" });
  }
});

/**
 * POST /api/client/subscription/:type/:id/auto-renew
 * Включить/выключить автосписание для конкретной подписки (root или secondary).
 *  - type=root      → обновляет client.autoRenewEnabled (legacy логика, как было)
 *  - type=secondary → обновляет secondary_subscriptions.auto_renew_enabled (новая логика)
 *
 * Body: { enabled: boolean }
 * При включении: проверяем что у клиента баланс > 0 (минимум на одну оплату) — иначе предупреждаем.
 */
clientSubscriptionsRouter.post("/subscription/:type/:id/auto-renew", async (req, res) => {
  const subType = req.params.type;
  const subId = req.params.id;
  if (subType !== "root" && subType !== "secondary") {
    return res.status(400).json({ message: "Неверный тип подписки" });
  }
  const enabled = req.body?.enabled === true;
  const client = (req as unknown as { client: { id: string; balance: number; remnawaveUuid: string | null } }).client;
  const clientId = (req as unknown as { clientId: string }).clientId;

  // Предупреждение если включается без баланса И без сохранённой карты YooKassa.
  // Если есть карта + YK-recurring включён — баланс пустой не критично, спишется с карты.
  if (enabled && (client.balance ?? 0) <= 0) {
    const cfg = await getSystemConfig();
    const ykRecurringOn = cfg.yookassaRecurringEnabled === true && !!cfg.yookassaShopId?.trim() && !!cfg.yookassaSecretKey?.trim();
    const dbClient = await prisma.client.findUnique({ where: { id: clientId }, select: { yookassaPaymentMethodId: true } });
    const hasYkCard = !!dbClient?.yookassaPaymentMethodId;
    if (!(ykRecurringOn && hasYkCard)) {
      return res.status(400).json({
        message: "Баланс пустой. Сначала пополните баланс или получите реферальные начисления.",
        code: "EMPTY_BALANCE",
      });
    }
    // Иначе разрешаем — спишется с карты при наступлении срока.
  }

  // единая логика для root и secondary — обе живут в Subscription.
  // type=root → находим primary (subscriptionIndex=0), type=secondary → по id.
  const sub = subType === "root"
    ? await prisma.subscription.findUnique({
        where: { ownerId_subscriptionIndex: { ownerId: clientId, subscriptionIndex: 0 } },
        select: { id: true, ownerId: true, giftedToClientId: true, tariffId: true },
      })
    : await prisma.subscription.findUnique({
        where: { id: subId },
        select: { id: true, ownerId: true, giftedToClientId: true, tariffId: true },
      });
  if (!sub || (sub.ownerId !== clientId && sub.giftedToClientId !== clientId)) {
    return res.status(404).json({ message: "Подписка не найдена" });
  }
  if (enabled && await prisma.cloudPaymentAgreement.count({ where: { subscriptionId: sub.id, state: { in: ["PENDING", "ACTIVE", "PAST_DUE", "CANCEL_PENDING"] } } })) {
    return res.status(409).json({ message: "Для подписки настроен CloudPayments. Управление автоплатежом доступно в профиле." });
  }
  if (enabled && !sub.tariffId) {
    return res.status(400).json({ message: "К подписке не привязан тариф — автосписание невозможно" });
  }

  // Если включаем — подтягиваем последний оплаченный тариф/опцию/устройства для удобства.
  const updates: { autoRenewEnabled: boolean; autoRenewTariffId?: string | null; autoRenewPriceOptionId?: string | null; autoRenewExtraDevices?: number } = {
    autoRenewEnabled: enabled,
  };
  if (enabled && sub.tariffId) {
    // Только платёж ЭТОЙ подписки (subscriptionId или metadata.extendsSecondarySubId) по её
    // текущему тарифу — иначе в подписку попадал тариф/опция другой подписки клиента.
    const lastPaid = await prisma.payment.findFirst({
      where: {
        clientId,
        status: "PAID",
        tariffId: sub.tariffId,
        OR: [{ subscriptionId: sub.id }, { metadata: { contains: `"extendsSecondarySubId":"${sub.id}"` } }],
      },
      orderBy: { paidAt: "desc" },
      select: { tariffId: true, tariffPriceOptionId: true, deviceCount: true, tariffPriceOption: { select: { tariffId: true } } },
    });
    Object.assign(updates, autoRenewPrefsFromLastPayment(sub.tariffId, lastPaid, lastPaid?.tariffPriceOption?.tariffId ?? null));
  }
  await prisma.subscription.update({ where: { id: sub.id }, data: updates });
  return res.json({ ok: true, enabled, type: subType });
});

/**
 * POST /api/client/subscription/:type/:id/remove-extra-devices
 * Убирает ВСЕ доп. устройства с подписки. extraDevices → 0, hwidDeviceLimit в Remna →
 * tariff.includedDevices. Если активных HWID было больше нового лимита — жёстко kick
 * лишних (вариант Б, согласовано с юзером 14.05.2026).
 * Возврата денег НЕТ — устройства уже отработали до текущего expireAt подписки.
 */
clientSubscriptionsRouter.post("/subscription/:type/:id/remove-extra-devices", requireRemnaOnline, async (req, res) => {
  if (!isRemnaConfigured()) return res.status(503).json({ message: "Remna API не настроен" });
  const subType = req.params.type;
  const subId = req.params.id;
  if (subType !== "root" && subType !== "secondary") {
    return res.status(400).json({ message: "Неверный тип подписки" });
  }
  const clientId = (req as unknown as { clientId: string }).clientId;

  const sub = subType === "root"
    ? await prisma.subscription.findUnique({
        where: { ownerId_subscriptionIndex: { ownerId: clientId, subscriptionIndex: 0 } },
        select: { id: true, ownerId: true, giftedToClientId: true, remnawaveUuid: true, tariffId: true, extraDevices: true },
      })
    : await prisma.subscription.findUnique({
        where: { id: subId },
        select: { id: true, ownerId: true, giftedToClientId: true, remnawaveUuid: true, tariffId: true, extraDevices: true },
      });
  if (!sub) return res.status(404).json({ message: "Подписка не найдена" });
  if (sub.ownerId !== clientId && sub.giftedToClientId !== clientId) {
    return res.status(403).json({ message: "Нет доступа" });
  }
  if (!sub.remnawaveUuid) return res.status(400).json({ message: "Подписка не привязана к Remnawave" });
  if ((sub.extraDevices ?? 0) === 0) {
    return res.status(400).json({ message: "У этой подписки нет докупленных устройств" });
  }

  const tariff = sub.tariffId
    ? await prisma.tariff.findUnique({ where: { id: sub.tariffId }, select: { includedDevices: true, deviceLimit: true } })
    : null;
  const includedDevices = tariff?.includedDevices ?? tariff?.deviceLimit ?? 1;

  // Список активных HWID — вариант Б: жёстко удалить лишние.
  let removedHwids = 0;
  try {
    const devicesRes = await remnaGetUserHwidDevices(sub.remnawaveUuid);
    const devicesData = devicesRes.data as { response?: { devices?: Array<{ hwid: string; createdAt?: string }> } } | undefined;
    const activeDevices = devicesData?.response?.devices ?? [];
    if (activeDevices.length > includedDevices) {
      // Сортируем по createdAt asc — старые удаляем первыми, новые сохраняем.
      const sorted = [...activeDevices].sort((a, b) => {
        const aT = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bT = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return aT - bT;
      });
      const toRemove = sorted.slice(0, activeDevices.length - includedDevices);
      for (const dev of toRemove) {
        await remnaDeleteUserHwidDevice(sub.remnawaveUuid, dev.hwid).catch((e) => {
          console.error("[remove-extra-devices] kick HWID failed:", dev.hwid, e);
        });
        removedHwids += 1;
      }
    }
  } catch (e) {
    console.error("[remove-extra-devices] devices kick error:", e);
  }

  // Уменьшаем лимит в Remna до базы.
  const updateRes = await remnaUpdateUser({
    uuid: sub.remnawaveUuid,
    hwidDeviceLimit: includedDevices,
  });
  if (updateRes.error) {
    return res.status(updateRes.status >= 400 ? updateRes.status : 500).json({ message: updateRes.error });
  }

  // Обнуляем счётчик + monthlyPrice в БД.
  await prisma.subscription.update({
    where: { id: sub.id },
    data: { extraDevices: 0, extraDevicesMonthlyPrice: 0 },
  });

  return res.json({
    ok: true,
    extraDevicesRemoved: sub.extraDevices ?? 0,
    hwidKicked: removedHwids,
    newDeviceLimit: includedDevices,
  });
});

/** GET /api/client/devices — список устройств (HWID) пользователя в Remna */
clientSubscriptionsRouter.get("/devices", async (req, res) => {
  const client = (req as unknown as { client: { id: string; remnawaveUuid: string | null } }).client;
  if (!client.remnawaveUuid) {
    return res.json({ total: 0, devices: [] });
  }
  const result = await remnaGetUserHwidDevices(client.remnawaveUuid);
  if (result.error) {
    return res.status(result.status >= 500 ? 503 : 400).json({ message: result.error });
  }
  const data = result.data as { response?: { total?: number; devices?: Array<{ hwid: string; platform?: string; deviceModel?: string; createdAt?: string }> } } | undefined;
  const resp = data?.response;
  const devices = Array.isArray(resp?.devices) ? resp.devices : [];
  const total = typeof resp?.total === "number" ? resp.total : devices.length;
  return res.json({ total, devices });
});

/** Scoped list shared by the bot's counter and device management screen. */
clientSubscriptionsRouter.get("/devices/by-subscription/:id", async (req, res) => {
  const clientId = (req as unknown as { clientId: string }).clientId;
  try {
    const result = await readSubscriptionDevices(clientId, req.params.id, {
      findSubscription: (id) => prisma.subscription.findUnique({
        where: { id },
        select: { ownerId: true, giftedToClientId: true, remnawaveUuid: true },
      }),
      getDevices: remnaGetUserHwidDevices,
    });
    return res.status(result.status).json(result.body);
  } catch {
    return res.status(503).json({ message: "Не удалось загрузить устройства. Попробуйте ещё раз." });
  }
});

// схема расширена subscriptionType/subscriptionId — теперь устройство
// можно удалить с конкретной подписки (root или secondary). Раньше endpoint использовал только
// client.remnawaveUuid (root) → удаление с secondary возвращало «HWID device not found».
const deleteDeviceSchema = z.object({
  hwid: z.string().min(1).max(500),
  subscriptionType: z.enum(["root", "secondary"]).optional(),
  subscriptionId: z.string().min(1).max(64).optional(),
});

/** POST /api/client/devices/delete — удалить устройство по HWID */
clientSubscriptionsRouter.post("/devices/delete", requireRemnaOnline, async (req, res) => {
  const client = (req as unknown as { client: { id: string; remnawaveUuid: string | null } }).client;
  const clientId = (req as unknown as { clientId: string }).clientId;
  const body = deleteDeviceSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Проверьте введённые данные", errors: body.error.flatten() });

  // Определяем UUID подписки откуда удалять.
  // резолвим uuid ВСЕГДА по subscriptionId, если он передан
  // (бот шлёт его и для root, и для secondary). Раньше root-ветка брала client.remnawaveUuid —
  // после унификации это legacy-поле рассинхронено с subscriptions[idx0].remnawaveUuid у 18560
  // клиентов → Remna отвечал "HWID device not found" и устройство не удалялось.
  let targetUuid: string | null = null;
  if (body.data.subscriptionId) {
    // Удаление из конкретной подписки (root или secondary — едины после унификации). Проверяем ownership.
    const sub = await prisma.subscription.findUnique({
      where: { id: body.data.subscriptionId },
      select: { ownerId: true, giftedToClientId: true, remnawaveUuid: true },
    });
    if (!sub || (sub.ownerId !== clientId && sub.giftedToClientId !== clientId)) {
      return res.status(404).json({ message: "Подписка не найдена" });
    }
    if (!sub.remnawaveUuid) {
      return res.status(400).json({ message: "Подписка не привязана к VPN" });
    }
    targetUuid = sub.remnawaveUuid;
  } else {
    // Back-compat: старые версии бота шлют только hwid без subscriptionId → root-поле клиента.
    if (!client.remnawaveUuid) {
      return res.status(400).json({ message: "Подписка не привязана" });
    }
    targetUuid = client.remnawaveUuid;
  }

  // Только полностью неадресный legacy-запрос может искать по всем подпискам.
  // Это для back-compat: старые версии бота шлют только hwid, без указания подписки.
  if (usesLegacyDeviceFallback(body.data)) {
    // Сначала root.
    const rootResult = await remnaDeleteUserHwidDevice(targetUuid, body.data.hwid);
    if (!rootResult.error) {
      return res.json({ ok: true, message: "Устройство удалено" });
    }
    // Если в root не нашли — перебираем все secondary этого клиента.
    const secs = await prisma.subscription.findMany({
      where: { ownerId: clientId, remnawaveUuid: { not: null } },
      select: { remnawaveUuid: true },
    });
    for (const s of secs) {
      if (!s.remnawaveUuid) continue;
      const r = await remnaDeleteUserHwidDevice(s.remnawaveUuid, body.data.hwid);
      if (!r.error) {
        return res.json({ ok: true, message: "Устройство удалено" });
      }
    }
    // Нигде не нашли — возвращаем ошибку с понятным текстом.
    return res.status(404).json({ message: "Устройство не найдено ни в одной из ваших подписок" });
  }

  // subscriptionType задан → целенаправленное удаление.
  const result = await remnaDeleteUserHwidDevice(targetUuid, body.data.hwid);
  if (result.error) {
    return res.status(result.status >= 500 ? 503 : 400).json({ message: result.error });
  }
  return res.json({ ok: true, message: "Устройство удалено" });
});

/**
 * GET /api/client/devices/all
 * Все устройства всех подписок клиента (root + secondary), с пометкой откуда.
 * Бот показывает единый список с подписью «Подписка #N — тариф».
 */
clientSubscriptionsRouter.get("/devices/all", async (req, res) => {
  const clientId = (req as unknown as { clientId: string }).clientId;

  type DeviceItem = {
    hwid: string;
    platform?: string;
    deviceModel?: string;
    appName?: string;
    createdAt?: string;
    /**
     * миграция — все подписки живут в Subscription.
     * Тип `subscriptionType` устарел, но оставлен для back-compat с UI бота/кабинета.
     * Считаем по subscriptionIndex: 0 = «root» (главная), иначе «secondary».
     */
    subscriptionType: "root" | "secondary";
    subscriptionId: string;
    subscriptionIndex: number;
    tariffName: string | null;
  };
  const items: DeviceItem[] = [];

  const extractDevices = (data: unknown): { hwid: string; platform?: string; deviceModel?: string; appName?: string; createdAt?: string }[] => {
    const raw = data as { response?: { devices?: Record<string, unknown>[] } } | undefined;
    const devs = Array.isArray(raw?.response?.devices) ? raw.response.devices : [];
    return devs.map((d) => {
      const obj = d as Record<string, unknown>;
      const appName = (obj.appName ?? obj.clientName ?? obj.userAgent ?? obj.app ?? null) as string | null;
      return {
        hwid: String(obj.hwid ?? ""),
        platform: obj.platform ? String(obj.platform) : undefined,
        deviceModel: obj.deviceModel ? String(obj.deviceModel) : undefined,
        appName: appName?.toString().trim() || undefined,
        createdAt: obj.createdAt ? String(obj.createdAt) : undefined,
      };
    });
  };

  // ВСЕ подписки клиента — из Subscription.
  // legacy `client.remnawaveUuid` не используется. Дедуп по UUID — на случай дубля записей.
  const subs = await prisma.subscription.findMany({
    where: {
      OR: [
        { ownerId: clientId, purchasedAsGift: false, giftStatus: null },
        { ownerId: clientId, purchasedAsGift: false, giftStatus: "" },
        { ownerId: clientId, purchasedAsGift: false, giftStatus: "ACTIVATED_SELF" },
        { ownerId: clientId, purchasedAsGift: false, giftStatus: "GIFTED" },
        { giftedToClientId: clientId, giftStatus: "GIFTED" },
      ],
      remnawaveUuid: { not: null },
    },
    select: {
      id: true,
      remnawaveUuid: true,
      subscriptionIndex: true,
      tariff: { select: { name: true } },
    },
    orderBy: { subscriptionIndex: "asc" },
  });
  const seenUuids = new Set<string>();
  for (const sub of subs) {
    if (!sub.remnawaveUuid) continue;
    if (seenUuids.has(sub.remnawaveUuid)) continue;
    seenUuids.add(sub.remnawaveUuid);
    const r = await remnaGetUserHwidDevices(sub.remnawaveUuid);
    if (r.error || !r.data) continue;
    for (const d of extractDevices(r.data)) {
      items.push({
        ...d,
        subscriptionType: sub.subscriptionIndex === 0 ? "root" : "secondary",
        subscriptionId: sub.id,
        subscriptionIndex: sub.subscriptionIndex,
        tariffName: sub.tariff?.name ?? null,
      });
    }
  }

  return res.json({ total: items.length, items });
});
