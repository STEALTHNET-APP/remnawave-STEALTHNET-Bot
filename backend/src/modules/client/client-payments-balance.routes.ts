import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { prisma, createPayment, assertActiveExtraOptionTargetForPayment, assertRenewalTargetForPayment, asPaymentUncheckedCreate } from "../../db.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { validateTariffDevices } from "../extra-options/device-limit.js";
import { getSystemConfig, checkTariffRestriction, validatePromoCode, type SellOptionTrafficProduct, type SellOptionDeviceProduct, type SellOptionServerProduct } from "./client.service.js";
import { requireRemnaOnline, requireRemnaPaymentOnline } from "./client.middleware.js";
import { activateTariffForClient, activateTariffByPaymentId, findConvertibleSubscription } from "../tariff/tariff-activation.service.js";
import { createProxySlotsByPaymentId } from "../proxy/proxy-slots-activation.service.js";
import { createSingboxSlotsByPaymentId } from "../singbox/singbox-slots-activation.service.js";
import { applyExtraOptionByPaymentId } from "../extra-options/extra-options.service.js";
import { buildPaymentIntentMetadata } from "../payment/payment-intent.js";
import { applyPersonalDiscount } from "./personal-discount.js";
import { isMultiSubscriptionsEnabled } from "./multi-subscriptions.js";
import { paymentSnapshotProduct } from "../bot/bot.service.js";
import { calculateDevicesProrataPriceCoefficient, calculateDevicesProrataPriceCoefficientForPrimary, getCustomBuildConfig } from "./client-checkout.util.js";

export const clientPaymentsBalanceRouter = Router();

// ——— Оплата тарифа или прокси-тарифа балансом ———

const payByBalanceSchema = z.object({
  tariffId: z.string().min(1).optional(),
  tariffPriceOptionId: z.string().min(1).optional(),
  deviceCount: z.number().int().min(0).max(100).optional(),
  proxyTariffId: z.string().min(1).optional(),
  singboxTariffId: z.string().min(1).optional(),
  promoCode: z.string().max(50).optional(),
  // продление существующей secondary подписки балансом.
  extendsSecondarySubId: z.string().min(1).max(64).optional(),
  // при активации платежа удалить все доп. устройства.
  removeExtrasOnActivate: z.boolean().optional(),
  // покупка ДОПОЛНИТЕЛЬНОЙ подписки балансом (не через gift/buy).
  // Раньше для этого использовали gift/buy → она ставила purchasedAsGift=true → подписки
  // ошибочно попадали в «🎁 Мои подарки». Теперь /payments/balance принимает asAdditional
  // и создаёт обычную доп. подписку с purchasedAsGift=false → в «📋 Мои подписки».
  asAdditional: z.boolean().optional(),
  // покупка подарочной подписки — будет создана с purchasedAsGift=true.
  asGift: z.boolean().optional(),
  // какой триал заменить этой покупкой (несколько триалов —
  // выбор юзера; без поля заменяется самый старый).
  replaceTrialSubId: z.string().min(1).max(64).optional(),
}).refine((d) => (d.tariffId ? 1 : 0) + (d.proxyTariffId ? 1 : 0) + (d.singboxTariffId ? 1 : 0) === 1, { message: "Укажите tariffId, proxyTariffId или singboxTariffId" });

clientPaymentsBalanceRouter.post("/payments/balance", requireRemnaPaymentOnline, asyncHandler(async (req, res) => {
  const clientRaw = (req as unknown as { client: { id: string; remnawaveUuid: string | null; email: string | null; telegramId: string | null } }).client;
  const parsed = payByBalanceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Проверьте введённые данные", errors: parsed.error.flatten() });

  const { tariffId, tariffPriceOptionId, deviceCount, proxyTariffId, singboxTariffId, promoCode: promoCodeStr, extendsSecondarySubId, removeExtrasOnActivate, asAdditional, replaceTrialSubId } = parsed.data;

  // T-tariff-restriction (портировано из WolfVPN): запрет покупки/продления тарифа клиенту (оплата балансом).
  // Внешние платёжки покрыты бэкстопом в db.ts createPayment; здесь — явная проверка до списания.
  if (tariffId) {
    const restr = await checkTariffRestriction(clientRaw.id, tariffId);
    if (!restr.allowed) return res.status(403).json({ message: restr.reason, code: "TARIFF_RESTRICTED" });
  }

  if (proxyTariffId) {
    const tariff = await prisma.proxyTariff.findUnique({ where: { id: proxyTariffId } });
    if (!tariff || !tariff.enabled) return res.status(400).json({ message: "Прокси-тариф не найден" });
    const clientDb = await prisma.client.findUnique({ where: { id: clientRaw.id } });
    if (!clientDb) return res.status(401).json({ message: "Требуется авторизация" });
    // Персональная скидка админа (баланс — такой же канал оплаты, как и другие).
    const pd = await applyPersonalDiscount(tariff.price, clientRaw.id);
    const finalProxyPrice = pd.amount;
    const snap = await paymentSnapshotProduct(clientRaw.id, finalProxyPrice);
    // Тут была классика: read balance → если хватает → списываем → создаём payment+слоты.
    // Между read и UPDATE — несколько мс. Юзеры угоняли до 30 параллельных запросов
    // и баланс уезжал глубоко в минус (на проде 100₽ → -2900₽ за подписку, см. отчёт).
    //
    // Чиним SQL'ной атомарностью: WHERE balance >= amount. Либо UPDATE прошёл (count=1)
    // и ты списан корректно, либо count=0 — иди говори что денег нет.
    const debit = await prisma.client.updateMany({
      where: { id: clientRaw.id, balance: { gte: snap.amount } },
      data: { balance: { decrement: snap.amount } },
    });
    if (debit.count === 0) {
      return res.status(400).json({ message: `Недостаточно средств. Баланс: ${clientDb.balance.toFixed(2)}, нужно: ${snap.amount.toFixed(2)}` });
    }
    const payment = await createPayment({
      data: asPaymentUncheckedCreate({
        clientId: clientRaw.id,
        orderId: randomUUID(),
        amount: snap.amount,
        currency: tariff.currency.toUpperCase(),
        status: "PAID",
        provider: "balance",
        proxyTariffId: tariff.id,
        paidAt: new Date(),
        metadata: pd.personalDiscountPercent > 0
          ? JSON.stringify({ personalDiscountPercent: pd.personalDiscountPercent, originalPrice: tariff.price })
          : null,
      }),
    });
    const proxyResult = await createProxySlotsByPaymentId(payment.id);
    if (!proxyResult.ok) {
      // Слоты не вылетели — возвращаем бабки на баланс.
      await prisma.client.update({ where: { id: clientRaw.id }, data: { balance: { increment: snap.amount } } }).catch(() => {});
      return res.status(proxyResult.status).json({ message: proxyResult.error });
    }
    const { distributeReferralRewards } = await import("../referral/referral.service.js");
    await distributeReferralRewards(payment.id).catch((e) => console.error("[referral] Error:", e));
    // сжигаем одноразовую скидку после покупки proxy.
    {
      const { extinguishOneTimeDiscount } = await import("./personal-discount.js");
      await extinguishOneTimeDiscount(clientRaw.id).catch(() => {});
    }
    const { notifyProxySlotsCreated } = await import("../notification/telegram-notify.service.js");
    await notifyProxySlotsCreated(clientRaw.id, proxyResult.slotIds, tariff.name).catch(() => {});
    const after = await prisma.client.findUnique({ where: { id: clientRaw.id }, select: { balance: true } });
    return res.json({
      message: `Прокси «${tariff.name}» оплачены! Списано ${snap.amount.toFixed(2)} ${tariff.currency.toUpperCase()} с баланса.`,
      newBalance: after?.balance ?? clientDb.balance - snap.amount,
    });
  }

  if (singboxTariffId) {
    const tariff = await prisma.singboxTariff.findUnique({ where: { id: singboxTariffId } });
    if (!tariff || !tariff.enabled) return res.status(400).json({ message: "Тариф Sing-box не найден" });
    const clientDb = await prisma.client.findUnique({ where: { id: clientRaw.id } });
    if (!clientDb) return res.status(401).json({ message: "Требуется авторизация" });
    const pd = await applyPersonalDiscount(tariff.price, clientRaw.id);
    const finalSingboxPrice = pd.amount;
    const singSnap = await paymentSnapshotProduct(clientRaw.id, finalSingboxPrice);
    const payment = await createPayment({
      data: asPaymentUncheckedCreate({
        clientId: clientRaw.id,
        orderId: randomUUID(),
        amount: singSnap.amount,
        currency: tariff.currency.toUpperCase(),
        status: "PAID",
        provider: "balance",
        singboxTariffId: tariff.id,
        paidAt: new Date(),
        metadata: pd.personalDiscountPercent > 0
          ? JSON.stringify({ personalDiscountPercent: pd.personalDiscountPercent, originalPrice: tariff.price })
          : null,
      }),
    }, true);
    const singboxResult = await createSingboxSlotsByPaymentId(payment.id).catch(() => ({ ok: false as const, status: 503, error: "Не удалось выдать доступ. Средства возвращены на баланс." }));
    if (!singboxResult.ok) {
      await prisma.$transaction(async tx => {
        const cancelled = await tx.payment.updateMany({ where: { id: payment.id, status: "PAID" }, data: { status: "FAILED" } });
        if (cancelled.count) await tx.client.update({ where: { id: clientRaw.id }, data: { balance: { increment: singSnap.amount } } });
      });
      return res.status(singboxResult.status).json({ message: singboxResult.error });
    }
    const { distributeReferralRewards } = await import("../referral/referral.service.js");
    await distributeReferralRewards(payment.id).catch((e) => console.error("[referral] Error:", e));
    // сжигаем одноразовую скидку после покупки singbox.
    {
      const { extinguishOneTimeDiscount } = await import("./personal-discount.js");
      await extinguishOneTimeDiscount(clientRaw.id).catch(() => {});
    }
    const { notifySingboxSlotsCreated } = await import("../notification/telegram-notify.service.js");
    await notifySingboxSlotsCreated(clientRaw.id, singboxResult.slotIds, tariff.name).catch(() => {});
    const after = await prisma.client.findUnique({ where: { id: clientRaw.id }, select: { balance: true } });
    return res.json({
      message: `Доступы «${tariff.name}» оплачены! Списано ${singSnap.amount.toFixed(2)} ${tariff.currency.toUpperCase()} с баланса.`,
      newBalance: after?.balance ?? clientDb.balance - singSnap.amount,
    });
  }

  const tariff = await prisma.tariff.findUnique({
    where: { id: tariffId! },
    include: { priceOptions: { orderBy: [{ sortOrder: "asc" }, { durationDays: "asc" }] } },
  });
  if (!tariff) return res.status(400).json({ message: "Тариф не найден" });

  // Проверяем владельца и тариф цели ДО списания с баланса. Повторная проверка
  // выполняется в createPayment для внешних провайдеров и других точек входа.
  await assertRenewalTargetForPayment({
    clientId: clientRaw.id,
    tariffId: tariff.id,
    metadata: buildPaymentIntentMetadata({ asAdditional, extendsSecondarySubId }),
  });

  // кулдаун ПРОДЛЕНИЯ существующей подписки.
  // Применяется только при продлении (extendsSecondarySubId) — новые покупки этого тарифа
  // (как доп. подписки) не ограничиваются.
  if (extendsSecondarySubId) {
    const { checkSubscriptionRenewalCooldown } = await import("../tariff/tariff-cooldown.service.js");
    const cd = await checkSubscriptionRenewalCooldown(extendsSecondarySubId!);
    if (!cd.ok) {
      return res.status(429).json({ message: cd.message, code: "TARIFF_COOLDOWN", daysLeft: cd.daysLeft });
    }
  }

  // Определяем выбранную опцию: явный priceOptionId → найти и проверить принадлежность тарифу.
  // Если не указан — fallback на legacy (tariff.price + tariff.durationDays).
  let selectedOption: { id: string; durationDays: number; price: number } | null = null;
  if (tariffPriceOptionId) {
    const opt = tariff.priceOptions.find((o) => o.id === tariffPriceOptionId);
    if (!opt) return res.status(400).json({ message: "Опция цены не найдена в этом тарифе" });
    selectedOption = { id: opt.id, durationDays: opt.durationDays, price: opt.price };
  } else if (tariff.priceOptions.length > 0) {
    // Если опции есть но не указали — берём минимальную цену по умолчанию (как в legacy)
    const sorted = [...tariff.priceOptions].sort((a, b) => a.price - b.price);
    selectedOption = { id: sorted[0].id, durationDays: sorted[0].durationDays, price: sorted[0].price };
  }

  // tariff.pricePerExtraDevice — это
  // ОТДЕЛЬНАЯ админская фича выбора устройств ПРИ покупке тарифа. К нашей логике
  // sell-options не относится. Цена дополнительных устройств подписки хранится
  // отдельно в Subscription.extraDevicesMonthlyPrice (берётся из sell-option-пакета).
  //
  // Формула при продлении:
  //   finalPrice = selectedOption.price + sub.extraDevicesMonthlyPrice × (days / 30)
  // При обычной покупке нового тарифа extras не учитываются (их ещё нет на новой подписке).
  const unitPrice = selectedOption?.price ?? tariff.price;
  const effectiveDays = selectedOption?.durationDays ?? tariff.durationDays;
  // Параметр deviceCount/requestedExtras в API остаётся для legacy/tariff-extras flow;
  // в нашем sell-options flow он = 0 (юзер докупает устройства отдельно через extra-options).
  const requestedExtras = Math.max(0, deviceCount ?? 0);
  await validateTariffDevices(prisma, clientRaw.id, tariff.id, requestedExtras, { extendsSecondarySubId, removeExtrasOnActivate });

  let extrasMonthlyPrice = 0;
  // T-extras-universal: при «убрать устройства» доплату за существующие extras не берём —
  // они удаляются при активации, юзер видел базовую цену.
  if (extendsSecondarySubId && removeExtrasOnActivate !== true) {
    const sub = await prisma.subscription.findUnique({
      where: { id: extendsSecondarySubId },
      select: { extraDevicesMonthlyPrice: true },
    });
    extrasMonthlyPrice = sub?.extraDevicesMonthlyPrice ?? 0;
  }
  const extrasTotal = extrasMonthlyPrice > 0 && effectiveDays > 0
    ? Math.round(extrasMonthlyPrice * (effectiveDays / 30) * 100) / 100
    : 0;
  // НОВЫЕ устройства, выбранные при покупке — для ЛЮБОЙ покупки (новая/конверт/продление):
  // цена из tariff.pricePerExtraDevice × deviceCount × tier × (days/30).
  // Раньше эта сумма игнорировалась — юзер видел общую цену с устройствами, а
  // списывали только базовую (см. баг-репорт о 149₽ вместо суммы с устройствами).
  let newExtrasTotal = 0;
  if (requestedExtras > 0) {
    const { calcExtrasPrice } = await import("../tariff/extras-pricing.js");
    const r = calcExtrasPrice(
      tariff.pricePerExtraDevice ?? 0,
      requestedExtras,
      tariff.deviceDiscountTiers,
      effectiveDays,
    );
    newExtrasTotal = r.extrasTotal;
  }
  let basePriceForTariff = unitPrice + extrasTotal + newExtrasTotal;

  // customPrice (T7c) DEPRECATED.
  // Раньше при докупе устройств цена накапливалась в Subscription.customPrice,
  // но эта схема ломалась при смене длительности продления.
  // Теперь количество устройств хранится в Subscription.extraDevices (Int),
  // а цена считается формулой выше: selectedOption.price + extraDevices × pricePerDevice × (days/30).
  let finalPrice = basePriceForTariff;

  // Персональная скидка админа — применяется первой.
  const pdTariff = await applyPersonalDiscount(finalPrice, clientRaw.id);
  finalPrice = pdTariff.amount;
  const tariffPersonalDiscount = pdTariff.personalDiscountPercent;

  // Промокод на скидку
  let promoCodeRecord: { id: string } | null = null;
  if (promoCodeStr?.trim()) {
    const result = await validatePromoCode(promoCodeStr.trim(), clientRaw.id);
    if (!result.ok) {
      const isStale = result.status === 404 || /истёк|not found/i.test(result.error);
      if (!isStale) return res.status(result.status).json({ message: result.error });
    } else {
      const promo = result.promo;
      if (promo.type !== "DISCOUNT") return res.status(400).json({ message: "Этот промокод не даёт скидку на оплату" });

      if (promo.discountPercent && promo.discountPercent > 0) {
        finalPrice = Math.max(0, finalPrice - finalPrice * promo.discountPercent / 100);
      }
      if (promo.discountFixed && promo.discountFixed > 0) {
        finalPrice = Math.max(0, finalPrice - promo.discountFixed);
      }
      finalPrice = Math.round(finalPrice * 100) / 100;
      promoCodeRecord = promo;
    }
  }

  // Проверяем баланс (с учётом наценки клона)
  const clientDb = await prisma.client.findUnique({ where: { id: clientRaw.id } });
  if (!clientDb) return res.status(401).json({ message: "Требуется авторизация" });
  const tariffPaySnap = await paymentSnapshotProduct(clientRaw.id, finalPrice);

  // Глобальный тумблер мульти-подписок (single-режим при выкл) — читаем ДО списания:
  // сбой конфига не должен ни включать мульти (лишняя user_<tg>_N), ни выключать его
  // (consolidate удалит подписки), ни оставлять клиента без денег.
  let balCfg: Awaited<ReturnType<typeof getSystemConfig>>;
  try {
    balCfg = await getSystemConfig();
  } catch (e) {
    console.error("[balance] system config unavailable:", e);
    return res.status(503).json({ message: "Настройки временно недоступны, повторите позже" });
  }
  const multiSubEnabledBal = isMultiSubscriptionsEnabled(balCfg);

  // Атомик debit ДО активации в Remna. Раньше было: проверили баланс, активировали
  // тариф, потом списали. Между check и debit юзер мог нажать "купить" 30 раз —
  // получал 30 продлений за 100₽. Теперь сначала списываем, и если Remna откажет —
  // откатываем взад.
  const debit = await prisma.client.updateMany({
    where: { id: clientRaw.id, balance: { gte: tariffPaySnap.amount } },
    data: { balance: { decrement: tariffPaySnap.amount } },
  });
  if (debit.count === 0) {
    return res.status(400).json({ message: `Недостаточно средств. Баланс: ${clientDb.balance.toFixed(2)}, нужно: ${tariffPaySnap.amount.toFixed(2)}` });
  }

  // УНИФИЦИРОВАННАЯ покупка балансом.
  //
  // 1. extendsSecondarySubId → явное продление конкретной подписки.
  // 2. ИНАЧЕ → ВСЕГДА новая подписка через createAdditionalSubscription.
  //    Старая ветка `activateTariffForClient` (которая продлевала Subscription[0]) удалена,
  //    потому что: «обычная покупка тарифа» должна создавать НОВУЮ подписку, а не складывать
  //    дни в primary. Хочешь продлить — нажми «Продлить подписку» (передаст extendsSecondarySubId).
  let activateResult: { ok: true; subscriptionId?: string; convertedDays?: number } | { ok: false; error: string; status: number };
  let isExtendingSecondary = false;
  // покупка сконвертировала существующую подписку
  // (режим «одна подписка из категории») вместо создания новой.
  let isConverted = false;
  // имя старого тарифа для админ-уведомления о конвертации.
  let convertedFromTariffName: string | null = null;
  let convertedDaysForNotify: number | null = null;
  let createdSubscriptionId: string | null = null;
  // легаси-триал (POST /trial) заменён покупкой на месте — для сообщения клиенту.
  let convertedLegacyTrial = false;

  if (extendsSecondarySubId) {
    const sec = await prisma.subscription.findUnique({
      where: { id: extendsSecondarySubId },
      select: { ownerId: true, giftedToClientId: true },
    });
    if (!sec || (sec.ownerId !== clientRaw.id && sec.giftedToClientId !== clientRaw.id)) {
      await prisma.client.update({ where: { id: clientRaw.id }, data: { balance: { increment: tariffPaySnap.amount } } }).catch(() => {});
      return res.status(403).json({ message: "Доп. подписка не принадлежит вам" });
    }
    const { extendSecondarySubscription } = await import("../tariff/tariff-activation.service.js");
    activateResult = await extendSecondarySubscription(
      extendsSecondarySubId,
      tariff,
      selectedOption ? { id: selectedOption.id, durationDays: selectedOption.durationDays, price: selectedOption.price } : undefined,
      requestedExtras,
      // «продлить без устройств» — обработка внутри extendSecondarySubscription
      // (обнуление счётчиков + кик HWID), отдельный helper-вызов ниже больше не нужен.
      removeExtrasOnActivate === true,
    );
    isExtendingSecondary = true;
    createdSubscriptionId = extendsSecondarySubId;
  } else {
    void asAdditional;
    // режим «одна подписка из категории»: если тариф из
    // single-категории и у клиента уже есть подписка с тарифом этой категории —
    // КОНВЕРТИРУЕМ её (pro-rata остатка + смена тарифа/сквадов), а не создаём вторую.
    // Балансовый путь активирует напрямую (мимо activateTariffByPaymentId), поэтому
    // конверт-ветка нужна и здесь.
    const { findConvertibleSubscription, extendSecondarySubscription } = await import("../tariff/tariff-activation.service.js");
    // Легаси-триал (trialId=null) конвертируется здесь же — на месте, тот же Remna-юзер/ссылка.
    const convertible = await findConvertibleSubscription(clientRaw.id, tariff.id, multiSubEnabledBal, {
      preferredSubId: replaceTrialSubId ?? null,
      trialSquadUuid: balCfg.trialSquadUuid,
    });
    if (convertible) {
      activateResult = await extendSecondarySubscription(
        convertible.id,
        tariff,
        selectedOption ? { id: selectedOption.id, durationDays: selectedOption.durationDays, price: selectedOption.price } : undefined,
        requestedExtras,
        // юзер выбрал убрать доп. устройства при конвертации —
        // их остаточная ценность уйдёт в дни нового тарифа.
        removeExtrasOnActivate === true,
        // тот же тариф → продление (стек); другой → convert (мульти вкл) / hardReplace (мульти выкл, дни сгорают).
        /* convertMode */ multiSubEnabledBal && !convertible.sameTariff,
        /* hardReplace */ !multiSubEnabledBal && !convertible.sameTariff,
        /* legacyTrial */ convertible.isLegacyTrial,
      );
      isConverted = activateResult.ok && !convertible.sameTariff;
      convertedLegacyTrial = isConverted && convertible.isLegacyTrial;
      isExtendingSecondary = isExtendingSecondary || (activateResult.ok && convertible.sameTariff);
      createdSubscriptionId = convertible.id;
      if (isConverted) {
        convertedFromTariffName = convertible.tariffName;
        convertedDaysForNotify = activateResult.ok ? (activateResult.convertedDays ?? null) : null;
      }
    } else {
      let replacingTrialId = replaceTrialSubId ?? null;
      if (replacingTrialId) {
        const target = await prisma.subscription.findFirst({
          where: { id: replacingTrialId, ownerId: clientRaw.id, trialId: { not: null }, purchasedAsGift: false },
          select: { id: true },
        });
        if (!target) replacingTrialId = null;
      }
      if (!replacingTrialId) {
        const oldestTrial = await prisma.subscription.findFirst({
          where: { ownerId: clientRaw.id, trialId: { not: null }, purchasedAsGift: false },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        });
        replacingTrialId = oldestTrial?.id ?? null;
      }
      // Любая «новая покупка тарифа» — через единый createAdditionalSubscription.
      // Для свежего клиента она получит subscriptionIndex=0 (= главная). Для уже имеющего
      // подписки — следующий свободный индекс. Без затирания/смешивания.
      const { createAdditionalSubscription } = await import("../gift/gift.service.js");
      const addResult = await createAdditionalSubscription(clientRaw.id, {
        id: tariff.id,
        name: tariff.name,
        // базовая цена опции/тарифа (НЕ итог платежа): extras теперь
        // фиксируются отдельно (extraDevicesMonthlyPrice), и customPrice/pricePerDay
        // должны отражать чистую ставку тарифа — иначе extras задвоятся при продлении.
        price: selectedOption?.price ?? tariff.price,
        durationDays: selectedOption?.durationDays ?? tariff.durationDays,
        trafficLimitBytes: tariff.trafficLimitBytes,
        deviceLimit: tariff.deviceLimit,
        includedDevices: tariff.includedDevices,
        pricePerExtraDevice: tariff.pricePerExtraDevice,
        maxExtraDevices: tariff.maxExtraDevices,
        deviceDiscountTiers: tariff.deviceDiscountTiers,
        internalSquadUuids: tariff.internalSquadUuids,
        trafficResetMode: tariff.trafficResetMode ?? undefined,
      }, { extraDevices: requestedExtras, skipConfigCheck: true, replacingSubscriptionId: replacingTrialId ?? undefined });
      activateResult = addResult.ok
        ? { ok: true, subscriptionId: addResult.data.subscriptionId }
        : { ok: false, error: addResult.error, status: addResult.status };
      if (addResult.ok) createdSubscriptionId = addResult.data.subscriptionId;
    }
  }
  if (!activateResult.ok) {
    // Remna послала — возвращаем бабки.
    await prisma.client.update({ where: { id: clientRaw.id }, data: { balance: { increment: tariffPaySnap.amount } } }).catch(() => {});
    return res.status(activateResult.status).json({ message: activateResult.error });
  }
  // NB: списание уже сделано атомарно выше — повторного decrement тут НЕ надо.

  // «продлить без устройств» теперь обрабатывается ВНУТРИ extendSecondarySubscription
  // (removeExtrasAfter): счётчики и HWID-лимит выставляются атомарно с активацией.
  // Отдельный removeAllExtraDevicesForSub здесь удалён — он обнулял бы и докупленные extras.

  // Создаём запись об оплате
  const orderId = randomUUID();
  const tariffMeta: Record<string, unknown> = {};
  if (promoCodeRecord) Object.assign(tariffMeta, { promoCodeId: promoCodeRecord.id, originalPrice: basePriceForTariff });
  if (tariffPersonalDiscount > 0) {
    tariffMeta.personalDiscountPercent = tariffPersonalDiscount;
    if (!tariffMeta.originalPrice) tariffMeta.originalPrice = basePriceForTariff;
  }
  // T7b: пишем маркер продления в metadata (для аудита и для re-activate если webhook).
  if (extendsSecondarySubId) tariffMeta.extendsSecondarySubId = extendsSecondarySubId;
  // маркер конвертации (single-категория) для отчётности.
  if (isConverted && createdSubscriptionId) {
    tariffMeta.convertedSubscriptionId = createdSubscriptionId;
    if (activateResult.ok && activateResult.convertedDays != null) tariffMeta.convertedDays = activateResult.convertedDays;
  }
  // флаг удаления доп. устройств при активации (продление ИЛИ конвертация).
  if (removeExtrasOnActivate === true) tariffMeta.removeExtrasOnActivate = true;
  // T-fix (11.05.2026): маркер покупки доп. подписки балансом (без gift).
  if (asAdditional && !extendsSecondarySubId) tariffMeta.isAdditionalSubscription = true;
  const payment = await createPayment({
    data: asPaymentUncheckedCreate({
      clientId: clientRaw.id,
      orderId,
      amount: tariffPaySnap.amount,
      currency: tariff.currency.toUpperCase(),
      status: "PAID",
      provider: "balance",
      tariffId,
      tariffPriceOptionId: selectedOption?.id ?? null,
      deviceCount: requestedExtras,
      paidAt: new Date(),
      metadata: Object.keys(tariffMeta).length > 0 ? JSON.stringify(tariffMeta) : null,
    }),
  });

  // Записываем использование промокода
  if (promoCodeRecord) {
    await prisma.promoCodeUsage.create({ data: { promoCodeId: promoCodeRecord.id, clientId: clientRaw.id } });
  }

  // Реферальные начисления
  const { distributeReferralRewards } = await import("../referral/referral.service.js");
  await distributeReferralRewards(payment.id).catch(() => {});

  // сразу после payment.create — линкуем subscriptionId
  // (для notifyTariffActivated и админ-аналитики). Бэк-веб-хуки делают это в activateTariffByPaymentId,
  // но в балансовой ветке мы сами создаём подписку → надо явно прокинуть.
  if (createdSubscriptionId) {
    await prisma.payment.update({ where: { id: payment.id }, data: { subscriptionId: createdSubscriptionId } }).catch(() => {});
  }

  // T-unify-purchase: красивое уведомление в TG-бот с кнопками — теперь и при оплате балансом.
  // Раньше бот сам показывал сухой текст из HTTP-ответа. Теперь шлём ту же rich-нотификацию,
  // что и при оплате картой / криптой / прочими провайдерами.
  const { notifyTariffActivated } = await import("../notification/telegram-notify.service.js");
  notifyTariffActivated(clientRaw.id, payment.id).catch((e) => {
    console.error("[balance-purchase] notifyTariffActivated failed:", e);
  });

  // уведомление админам: покупка КОНВЕРТИРОВАЛА существующую подписку (best-effort).
  if (isConverted) {
    import("../notification/telegram-notify.service.js")
      .then((m) => m.notifyAdminsAboutSubscriptionConverted(clientRaw.id, convertedFromTariffName, tariff.name, convertedDaysForNotify))
      .catch((e) => console.error("[balance-purchase] convert admin notify failed:", e));
  }

  // сжигаем одноразовую персональную скидку
  // после продуктовой покупки тарифа балансом.
  {
    const { extinguishOneTimeDiscount } = await import("./personal-discount.js");
    await extinguishOneTimeDiscount(clientRaw.id).catch(() => {});
  }

  // Single-режим (мульти выкл): оставляем РОВНО ОДНУ подписку — удаляем остальные (в т.ч. из других категорий).
  if (!multiSubEnabledBal && createdSubscriptionId) {
    try {
      const { consolidateToSingleSubscription } = await import("../tariff/tariff-activation.service.js");
      await consolidateToSingleSubscription(clientRaw.id, createdSubscriptionId);
    } catch (e) { console.error("[balance] consolidate failed:", e); }
  }

  // T7b: сообщение клиенту — конвертировано / продлено / активировано.
  const convertedDaysMsg = (activateResult.ok && activateResult.convertedDays && activateResult.convertedDays > 0)
    ? ` Остаток прежней подписки конвертирован: +${activateResult.convertedDays} дн.`
    : "";
  const okMessage = isConverted
    ? (convertedLegacyTrial
        ? `🔄 Пробный период заменён тарифом «${tariff.name}» — ссылка подписки прежняя. Списано ${tariffPaySnap.amount.toFixed(2)} ${tariff.currency.toUpperCase()} с баланса.`
        : !multiSubEnabledBal
        ? `🔄 Прежняя подписка заменена на тариф «${tariff.name}» — при выключённых мульти-подписках активна только одна подписка. Списано ${tariffPaySnap.amount.toFixed(2)} ${tariff.currency.toUpperCase()} с баланса.`
        : `🔄 У вас уже была подписка в этой категории — она обновлена до тарифа «${tariff.name}».${convertedDaysMsg} Списано ${tariffPaySnap.amount.toFixed(2)} ${tariff.currency.toUpperCase()} с баланса.`)
    : isExtendingSecondary
      ? `🔄 Подписка продлена на ${effectiveDays} дн.! Списано ${tariffPaySnap.amount.toFixed(2)} ${tariff.currency.toUpperCase()} с баланса.`
      : `Тариф «${tariff.name}» активирован! Списано ${tariffPaySnap.amount.toFixed(2)} ${tariff.currency.toUpperCase()} с баланса.`;
  return res.json({
    message: okMessage,
    paymentId: payment.id,
    newBalance: clientDb.balance - tariffPaySnap.amount,
  });
}));

// ——— Гибкий тариф (собери сам): расчёт и оплата балансом ———
const customBuildPayByBalanceSchema = z.object({
  days: z.number().int().min(1).max(360),
  devices: z.number().int().min(1).max(20),
  trafficGb: z.number().min(0).nullable().optional(),
  promoCode: z.string().max(50).optional(),
});

clientPaymentsBalanceRouter.post("/custom-build/pay-balance", requireRemnaOnline, asyncHandler(async (req, res) => {
  const clientRaw = (req as unknown as { client: { id: string } }).client;
  const parsed = customBuildPayByBalanceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Неверные параметры", errors: parsed.error.flatten() });

  const config = await getSystemConfig();
  const cfg = getCustomBuildConfig(config);
  if (!cfg) return res.status(400).json({ message: "Гибкий тариф отключён" });

  let { days, devices, trafficGb } = parsed.data;
  if (days > cfg.maxDays || devices > cfg.maxDevices) {
    return res.status(400).json({ message: `Дни: 1–${cfg.maxDays}, устройств: 1–${cfg.maxDevices}` });
  }
  const trafficLimitBytes =
    cfg.trafficMode === "per_gb"
      ? (trafficGb != null && trafficGb >= 0 ? BigInt(Math.round(trafficGb * 1024 ** 3)) : null)
      : null;

  let amount = days * cfg.pricePerDay + devices * cfg.pricePerDevice;
  if (cfg.trafficMode === "per_gb" && trafficGb != null && trafficGb > 0) {
    amount += trafficGb * cfg.pricePerGb;
  }

  let finalPrice = amount;

  // Персональная скидка админа применяется первой.
  const pdCustom = await applyPersonalDiscount(finalPrice, clientRaw.id);
  finalPrice = pdCustom.amount;
  const customPersonalDiscount = pdCustom.personalDiscountPercent;

  let promoCodeRecord: { id: string } | null = null;
  if (parsed.data.promoCode?.trim()) {
    const result = await validatePromoCode(parsed.data.promoCode.trim(), clientRaw.id);
    if (!result.ok) return res.status(result.status).json({ message: result.error });
    const promo = result.promo;
    if (promo.type !== "DISCOUNT") return res.status(400).json({ message: "Этот промокод не даёт скидку на оплату" });
    if (promo.discountPercent && promo.discountPercent > 0) {
      finalPrice = Math.max(0, finalPrice - finalPrice * promo.discountPercent / 100);
    }
    if (promo.discountFixed && promo.discountFixed > 0) {
      finalPrice = Math.max(0, finalPrice - promo.discountFixed);
    }
    finalPrice = Math.round(finalPrice * 100) / 100;
    promoCodeRecord = promo;
  }

  const clientDb = await prisma.client.findUnique({ where: { id: clientRaw.id } });
  if (!clientDb) return res.status(401).json({ message: "Требуется авторизация" });
  const customSnap = await paymentSnapshotProduct(clientRaw.id, finalPrice);

  // Тот же TOCTOU, что в /payments/balance: read balance → check → activate (Remna,
  // сотни мс) → write decrement. Параллельные запросы все проходят check со стейтом
  // ДО первого debit'а — баланс уезжал в минус. Чиним атомарным debit'ом ДО
  // activate; при ошибке активации — refund.
  const debit = await prisma.client.updateMany({
    where: { id: clientRaw.id, balance: { gte: customSnap.amount } },
    data: { balance: { decrement: customSnap.amount } },
  });
  if (debit.count === 0) {
    return res.status(400).json({
      message: `Недостаточно средств. Баланс: ${clientDb.balance.toFixed(2)}, нужно: ${customSnap.amount.toFixed(2)} ${cfg.currency.toUpperCase()}`,
    });
  }

  const metadata = JSON.stringify({
    customBuild: {
      durationDays: days,
      deviceLimit: devices,
      trafficLimitBytes: trafficLimitBytes != null ? Number(trafficLimitBytes) : null,
      internalSquadUuids: [cfg.squadUuid],
    },
    ...(promoCodeRecord && { promoCodeId: promoCodeRecord.id, originalPrice: amount }),
    ...(customPersonalDiscount > 0 && { personalDiscountPercent: customPersonalDiscount, originalPrice: amount }),
  });

  const orderId = randomUUID();
  const payment = await createPayment({
    data: asPaymentUncheckedCreate({
      clientId: clientRaw.id,
      orderId,
      amount: customSnap.amount,
      currency: cfg.currency.toUpperCase(),
      status: "PAID",
      provider: "balance",
      paidAt: new Date(),
      metadata,
    }),
  });

  const activation = await activateTariffByPaymentId(payment.id);
  if (!activation.ok) {
    // Активация провалилась — возвращаем бабки на баланс.
    await prisma.client.update({ where: { id: clientRaw.id }, data: { balance: { increment: customSnap.amount } } }).catch(() => {});
    await prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED" } });
    return res.status(activation.status).json({ message: activation.error });
  }

  // NB: списание уже сделано атомарно выше — повторного decrement тут НЕ надо.
  if (promoCodeRecord) {
    await prisma.promoCodeUsage.create({ data: { promoCodeId: promoCodeRecord.id, clientId: clientRaw.id } });
  }

  // сжигаем одноразовую персональную скидку
  // после продуктовой покупки кастомного билда балансом.
  {
    const { extinguishOneTimeDiscount } = await import("./personal-discount.js");
    await extinguishOneTimeDiscount(clientRaw.id).catch(() => {});
  }

  const { distributeReferralRewards } = await import("../referral/referral.service.js");
  await distributeReferralRewards(payment.id).catch((e) => console.error("[referral] Error:", e));

  const after = await prisma.client.findUnique({ where: { id: clientRaw.id }, select: { balance: true } });
  return res.json({
    message: `Подписка на ${days} дн., ${devices} ${devices === 1 ? "устройство" : "устройства"} активирована. Списано ${customSnap.amount.toFixed(2)} ${cfg.currency.toUpperCase()}.`,
    paymentId: payment.id,
    newBalance: after?.balance ?? clientDb.balance - customSnap.amount,
  });
}));

// ——— Оплата опции (доп. трафик/устройства/сервер) балансом ———
const payOptionByBalanceSchema = z.object({
  extraOption: z.object({ kind: z.enum(["traffic", "devices", "servers"]), productId: z.string().min(1) }),
  // к какой подписке применить опцию.
  // Если передан — apply к secondary с этим id (+ её customPrice += сумма опции).
  // Если null/undefined — apply к primary (как раньше) + client.customPrimaryPrice += сумма опции.
  targetSubscriptionId: z.string().min(1).max(64).optional(),
});
clientPaymentsBalanceRouter.post("/payments/balance/option", requireRemnaOnline, asyncHandler(async (req, res) => {
  const clientRaw = (req as unknown as { clientId: string }).clientId;
  const parsed = payOptionByBalanceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Проверьте введённые данные", errors: parsed.error.flatten() });

  const config = await getSystemConfig();
  if (!(config as { sellOptionsEnabled?: boolean }).sellOptionsEnabled) {
    return res.status(400).json({ message: "Продажа опций отключена" });
  }

  const cfg = config as {
    sellOptionsTrafficEnabled?: boolean; sellOptionsTrafficProducts?: SellOptionTrafficProduct[];
    sellOptionsDevicesEnabled?: boolean; sellOptionsDevicesProducts?: SellOptionDeviceProduct[];
    sellOptionsServersEnabled?: boolean; sellOptionsServersProducts?: SellOptionServerProduct[];
  };
  const { kind, productId } = parsed.data.extraOption;
  const targetSubscriptionId = parsed.data.targetSubscriptionId?.trim() || null;
  let price: number;
  let currency: string;
  let metadataExtra: Record<string, unknown>;

  if (kind === "traffic") {
    const product = cfg.sellOptionsTrafficEnabled && cfg.sellOptionsTrafficProducts?.find((p) => p.id === productId);
    if (!product) return res.status(400).json({ message: "Опция не найдена" });
    price = product.price;
    currency = product.currency;
    metadataExtra = { extraOption: { kind: "traffic", trafficBytes: Math.round(product.trafficGb * 1024 ** 3) } };
  } else if (kind === "devices") {
    const product = cfg.sellOptionsDevicesEnabled && cfg.sellOptionsDevicesProducts?.find((p) => p.id === productId);
    if (!product) return res.status(400).json({ message: "Опция не найдена" });
    // масштабируем цену по оставшимся дням подписки
    // Если targetSubscriptionId передан — используем его; иначе ищем primary
    let prorataCoef = 1;
    if (targetSubscriptionId) {
      prorataCoef = await calculateDevicesProrataPriceCoefficient(targetSubscriptionId);
    } else {
      prorataCoef = await calculateDevicesProrataPriceCoefficientForPrimary(clientRaw);
    }
    price = Math.floor(product.price * prorataCoef);
    currency = product.currency;
    metadataExtra = { extraOption: { kind: "devices", deviceCount: product.deviceCount, productPriceMonthly: product.price } };
  } else {
    const product = cfg.sellOptionsServersEnabled && cfg.sellOptionsServersProducts?.find((p) => p.id === productId);
    if (!product) return res.status(400).json({ message: "Опция не найдена" });
    price = product.price;
    currency = product.currency;
    metadataExtra = {
        extraOption: {
          kind: "servers",
          squadUuid: product.squadUuid,
          ...((product.trafficGb ?? 0) > 0 && { trafficBytes: Math.round((product.trafficGb ?? 0) * 1024 ** 3) }),
        },
      };
  }

  const clientDb = await prisma.client.findUnique({ where: { id: clientRaw } });
  if (!clientDb) return res.status(401).json({ message: "Требуется авторизация" });

  // валидируем, что secondary принадлежит клиенту.
  // Если targetSubscriptionId не передан — опция применится к primary (старое поведение).
  if (targetSubscriptionId) {
    const sec = await prisma.subscription.findUnique({
      where: { id: targetSubscriptionId },
      select: { ownerId: true, remnawaveUuid: true },
    });
    if (!sec || sec.ownerId !== clientDb.id || !sec.remnawaveUuid) {
      return res.status(400).json({ message: "Подписка для опции не найдена" });
    }
    metadataExtra.targetSubscriptionId = targetSubscriptionId;
  }

  // Balance списывается до createPayment, поэтому DB-бэкстоп запускаем заранее,
  // чтобы на неактивной подписке не пришлось возвращать деньги постфактум.
  await assertActiveExtraOptionTargetForPayment({
    clientId: clientDb.id,
    metadata: JSON.stringify(metadataExtra),
  });

  const pdOption = await applyPersonalDiscount(price, clientDb.id);
  const finalOptionPrice = pdOption.amount;
  const optSnap = await paymentSnapshotProduct(clientDb.id, finalOptionPrice);

  if (pdOption.personalDiscountPercent > 0) {
    (metadataExtra as Record<string, unknown>).personalDiscountPercent = pdOption.personalDiscountPercent;
    (metadataExtra as Record<string, unknown>).originalPrice = price;
  }

  const orderId = randomUUID();
  const payment = await createPayment({
    data: asPaymentUncheckedCreate({
      clientId: clientDb.id,
      orderId,
      amount: optSnap.amount,
      currency: currency.toUpperCase(),
      status: "PAID",
      provider: "balance",
      paidAt: new Date(),
      metadata: JSON.stringify(metadataExtra),
    }),
  }, true);

  const applyResult = await applyExtraOptionByPaymentId(payment.id);
  if (!applyResult.ok) {
    // Применение опции в Remna провалилось — возвращаем баланс.
    await prisma.client.update({ where: { id: clientDb.id }, data: { balance: { increment: optSnap.amount } } }).catch(() => {});
    await prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED" } });
    return res.status(applyResult.status).json({ message: (applyResult as { error?: string }).error || "Ошибка применения опции" });
  }

  if (applyResult.creditedToBalance) {
    return res.json({ message: "Лимит дополнительных устройств достигнут. Сумма возвращена на баланс.", creditedToBalance: true });
  }

  // NB: списание уже сделано атомарно выше — повторного decrement тут НЕ надо.

  // уведомляем клиента после успешной активации опции.
  const { notifyExtraOptionApplied } = await import("../notification/telegram-notify.service.js");
  notifyExtraOptionApplied(clientDb.id, payment.id).catch(() => {});

  // сжигаем одноразовую персональную скидку.
  {
    const { extinguishOneTimeDiscount } = await import("./personal-discount.js");
    await extinguishOneTimeDiscount(clientDb.id).catch(() => {});
  }

  const { distributeReferralRewards } = await import("../referral/referral.service.js");
  await distributeReferralRewards(payment.id).catch(() => {});

  const after = await prisma.client.findUnique({ where: { id: clientDb.id }, select: { balance: true } });
  return res.json({
    message: "Опция применена. Списано с баланса.",
    paymentId: payment.id,
    newBalance: after?.balance ?? clientDb.balance - optSnap.amount,
  });
}));
