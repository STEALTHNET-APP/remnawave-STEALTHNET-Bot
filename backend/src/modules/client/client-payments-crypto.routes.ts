import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { env } from "../../config/index.js";
import { prisma, createPayment, asPaymentUncheckedCreate } from "../../db.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { createCispayPayment } from "../cispay/cispay.service.js";
import { starsApi, starsAmount } from "../telegram-stars/stars-api.js";
import { createParitypayPayment, isParitypayConfigured } from "../paritypay/paritypay.service.js";
import { getSystemConfig, validatePromoCode, type SellOptionTrafficProduct, type SellOptionDeviceProduct, type SellOptionServerProduct } from "./client.service.js";
import { requireRemnaPaymentOnline } from "./client.middleware.js";
import { activateTariffByPaymentId } from "../tariff/tariff-activation.service.js";
import { saveRedirectAndBuildUrl } from "../payment-redirect/payment-redirect.util.js";
import { createCryptopayInvoice, isCryptopayConfigured } from "../cryptopay/cryptopay.service.js";
import { createHeleketInvoice, isHeleketConfigured } from "../heleket/heleket.service.js";
import { createRollypayPayment, isRollypayConfigured } from "../rollypay/rollypay.service.js";
import { createLavaInvoice, isLavaConfigured } from "../lava/lava.service.js";
import { createLavatopInvoice, isLavatopConfigured } from "../lavatop/lavatop.service.js";
import { createOverpayPayformOrder, isOverpayConfigured } from "../overpay/overpay.service.js";
import { applyPersonalDiscount } from "./personal-discount.js";
import { paymentSnapshotTopup, paymentSnapshotProduct } from "../bot/bot.service.js";
import { calculateDevicesProrataPriceCoefficient, calculateDevicesProrataPriceCoefficientForPrimary, getCustomBuildConfig, heleketCreatePaymentSchema } from "./client-checkout.util.js";

export const clientPaymentsCryptoRouter = Router();

const cryptopayCreatePaymentSchema = z.object({
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
clientPaymentsCryptoRouter.post(["/cryptopay/create-payment", "/telegram-stars/create-payment"], requireRemnaPaymentOnline, asyncHandler(async (req, res) => {
  try {
    const isStars = req.path === "/telegram-stars/create-payment";
    const clientId = (req as unknown as { clientId: string }).clientId;
    const parsed = cryptopayCreatePaymentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Неверные параметры", errors: parsed.error.flatten() });
    const config = await getSystemConfig();
    const cryptopayConfig = {
      apiToken: (config as { cryptopayApiToken?: string | null }).cryptopayApiToken ?? "",
      testnet: (config as { cryptopayTestnet?: boolean }).cryptopayTestnet ?? false,
    };
    if (!isStars && !isCryptopayConfigured(cryptopayConfig)) return res.status(503).json({ message: "Crypto Pay не настроен" });

    const starsClient = isStars ? await prisma.client.findUnique({ where: { id: clientId }, select: { telegramId: true, preferredCurrency: true } }) : null;
    if (isStars) {
      if (!config.telegramStarsEnabled || !(config.telegramStarsRubPerStar > 0) || !process.env.BOT_TOKEN?.trim()) return res.status(503).json({ message: "Оплата Stars не настроена" });
      if (!starsClient?.telegramId) return res.status(400).json({ message: "Привяжите Telegram к аккаунту для оплаты Stars" });
      const targets = [parsed.data.tariffId, parsed.data.proxyTariffId, parsed.data.singboxTariffId, parsed.data.extraOption, parsed.data.customBuild].filter(Boolean);
      if (targets.length > 1) return res.status(400).json({ message: "Выберите одну покупку" });
    }

    const { amount: amountBody, currency: currencyBody, tariffId: tariffIdBody, proxyTariffId: proxyTariffIdBody, singboxTariffId: singboxTariffIdBody, promoCode: promoCodeStr, extraOption, customBuild: customBuildBody, extendsSecondarySubId, removeExtrasOnActivate, asGift, asAdditional } = parsed.data;
    let amountRounded: number;
    let currencyUpper: string;
    let tariffIdToStore: string | null = null;
    let proxyTariffIdToStore: string | null = null;
    let singboxTariffIdToStore: string | null = null;
    let metadataObj: Record<string, unknown> = promoCodeStr ? { promoCode: promoCodeStr } : {};

    if (customBuildBody) {
      const cfg = getCustomBuildConfig(config);
      if (!cfg) return res.status(400).json({ message: "Гибкий тариф отключён" });
      let { days, devices, trafficGb } = customBuildBody;
      if (days > cfg.maxDays || devices > cfg.maxDevices) {
        return res.status(400).json({ message: `Дни: 1–${cfg.maxDays}, устройств: 1–${cfg.maxDevices}` });
      }
      const trafficLimitBytes =
        cfg.trafficMode === "per_gb" && trafficGb != null && trafficGb >= 0
          ? Math.round(trafficGb * 1024 ** 3)
          : null;
      amountRounded = days * cfg.pricePerDay + devices * cfg.pricePerDevice;
      if (cfg.trafficMode === "per_gb" && trafficGb != null && trafficGb > 0) amountRounded += trafficGb * cfg.pricePerGb;
      amountRounded = Math.round(amountRounded * 100) / 100;
      currencyUpper = cfg.currency.toUpperCase();
      metadataObj = {
        customBuild: {
          durationDays: days,
          deviceLimit: devices,
          trafficLimitBytes,
          internalSquadUuids: [cfg.squadUuid],
        },
      };
    } else if (extraOption) {
      const cfg = config as { sellOptionsEnabled?: boolean; sellOptionsTrafficEnabled?: boolean; sellOptionsTrafficProducts?: SellOptionTrafficProduct[]; sellOptionsDevicesEnabled?: boolean; sellOptionsDevicesProducts?: SellOptionDeviceProduct[]; sellOptionsServersEnabled?: boolean; sellOptionsServersProducts?: SellOptionServerProduct[] };
      if (!cfg.sellOptionsEnabled) return res.status(400).json({ message: "Продажа опций отключена" });
      if (extraOption.kind === "traffic") {
        const product = cfg.sellOptionsTrafficEnabled && cfg.sellOptionsTrafficProducts?.find((p) => p.id === extraOption.productId);
        if (!product) return res.status(400).json({ message: "Опция не найдена" });
        amountRounded = Math.round(product.price * 100) / 100;
        currencyUpper = product.currency.toUpperCase();
        metadataObj = { extraOption: { kind: "traffic", trafficBytes: Math.round(product.trafficGb * 1024 ** 3) } };
      } else if (extraOption.kind === "devices") {
        const product = cfg.sellOptionsDevicesEnabled && cfg.sellOptionsDevicesProducts?.find((p) => p.id === extraOption.productId);
        if (!product) return res.status(400).json({ message: "Опция не найдена" });
        // масштабируем цену для primary подписки
        const prorataCoef = extraOption.targetSubscriptionId ? await calculateDevicesProrataPriceCoefficient(extraOption.targetSubscriptionId) : await calculateDevicesProrataPriceCoefficientForPrimary(clientId);
        amountRounded = Math.floor(product.price * prorataCoef);
        currencyUpper = product.currency.toUpperCase();
        metadataObj = { extraOption: { kind: "devices", deviceCount: product.deviceCount, productPriceMonthly: product.price } };
      } else {
        const product = cfg.sellOptionsServersEnabled && cfg.sellOptionsServersProducts?.find((p) => p.id === extraOption.productId);
        if (!product) return res.status(400).json({ message: "Опция не найдена" });
        amountRounded = Math.round(product.price * 100) / 100;
        currencyUpper = product.currency.toUpperCase();
        metadataObj = { extraOption: { kind: "servers", squadUuid: product.squadUuid, ...((product.trafficGb ?? 0) > 0 && { trafficBytes: Math.round((product.trafficGb ?? 0) * 1024 ** 3) }) } };
      }
      if (parsed.data.extraOption?.targetSubscriptionId) {
        metadataObj = { ...metadataObj, targetSubscriptionId: parsed.data.extraOption.targetSubscriptionId };
      }
    } else {
      currencyUpper = (currencyBody ?? "USD").toUpperCase();
      if (tariffIdBody) {
        const tariff = await prisma.tariff.findUnique({
          where: { id: tariffIdBody },
          include: { priceOptions: true },
        });
        if (!tariff) return res.status(400).json({ message: "Тариф не найден" });
        if (isStars) currencyUpper = tariff.currency.toUpperCase();
        // кулдаун ПРОДЛЕНИЯ существующей подписки.
        // Применяется только при продлении (extendsSecondarySubId) — новые покупки этого
        // же тарифа как доп. подписок не блокируются.
        if ("extendsSecondarySubId" in parsed.data && parsed.data.extendsSecondarySubId) {
          const { checkSubscriptionRenewalCooldown } = await import("../tariff/tariff-cooldown.service.js");
          const cd = await checkSubscriptionRenewalCooldown(parsed.data.extendsSecondarySubId!);
          if (!cd.ok) return res.status(429).json({ message: cd.message, code: "TARIFF_COOLDOWN", daysLeft: cd.daysLeft });
        }
        tariffIdToStore = tariffIdBody;
        // честный расчёт цены тарифа.
        // Раньше: `amountBody ?? tariff.price` — игнорировались priceOption и extras (баг 149₽).
        // Теперь: priceOption + extras (новая покупка) или extrasMonthlyPrice (продление).
        let unitPriceCalc = tariff.price;
        let effectiveDaysCalc = tariff.durationDays;
        if (parsed.data.tariffPriceOptionId) {
          const opt = (tariff.priceOptions ?? []).find((p) => p.id === parsed.data.tariffPriceOptionId);
          if (isStars && !opt) return res.status(400).json({ message: "Период тарифа не найден" });
          if (opt) {
            unitPriceCalc = opt.price;
            effectiveDaysCalc = opt.durationDays;
          }
        }
        // доплата за СУЩЕСТВУЮЩИЕ extras подписки при продлении.
        // T-extras-universal: при «убрать устройства» (removeExtrasOnActivate) доплату НЕ берём —
        // устройства удаляются при активации, юзер видел базовую цену.
        if (parsed.data.extendsSecondarySubId && parsed.data.removeExtrasOnActivate !== true) {
          const sub = await prisma.subscription.findUnique({
            where: { id: parsed.data.extendsSecondarySubId },
            select: { extraDevicesMonthlyPrice: true },
          });
          const monthlyPrice = sub?.extraDevicesMonthlyPrice ?? 0;
          if (monthlyPrice > 0 && effectiveDaysCalc > 0) {
            unitPriceCalc += Math.round(monthlyPrice * (effectiveDaysCalc / 30) * 100) / 100;
          }
        }
        // НОВЫЕ устройства, выбранные при покупке — теперь для ЛЮБОЙ покупки
        // (новая/конверт/продление): activation их честно выдаёт, значит и цена честная.
        {
          const newExtrasCalc = Math.max(0, parsed.data.deviceCount ?? 0);
          if (newExtrasCalc > 0) {
            const { calcExtrasPrice } = await import("../tariff/extras-pricing.js");
            const r = calcExtrasPrice(
              tariff.pricePerExtraDevice ?? 0,
              newExtrasCalc,
              tariff.deviceDiscountTiers,
              effectiveDaysCalc,
            );
            unitPriceCalc += r.extrasTotal;
          }
        }
        amountRounded = Math.round(unitPriceCalc * 100) / 100;
      } else if (proxyTariffIdBody) {
        const proxyTariff = await prisma.proxyTariff.findUnique({ where: { id: proxyTariffIdBody } });
        if (!proxyTariff || !proxyTariff.enabled) return res.status(400).json({ message: "Прокси-тариф не найден" });
        proxyTariffIdToStore = proxyTariffIdBody;
        amountRounded = Math.round((isStars ? proxyTariff.price : amountBody ?? proxyTariff.price) * 100) / 100;
        if (isStars) currencyUpper = proxyTariff.currency.toUpperCase();
      } else if (singboxTariffIdBody) {
        const singboxTariff = await prisma.singboxTariff.findUnique({ where: { id: singboxTariffIdBody } });
        if (!singboxTariff || !singboxTariff.enabled) return res.status(400).json({ message: "Тариф Sing-box не найден" });
        singboxTariffIdToStore = singboxTariffIdBody;
        amountRounded = Math.round((isStars ? singboxTariff.price : amountBody ?? singboxTariff.price) * 100) / 100;
        if (isStars) currencyUpper = singboxTariff.currency.toUpperCase();
      } else {
        if (amountBody == null) return res.status(400).json({ message: "Укажите сумму" });
        amountRounded = Math.round(amountBody * 100) / 100;
      }
    }

    if (isStars && currencyUpper !== "RUB") return res.status(400).json({ message: "Оплата Stars доступна для цен в рублях" });
    const fiatSupported = ["USD", "RUB", "EUR", "UAH", "KZT", "BYN", "UZS", "GEL", "TRY", "AMD", "THB", "INR", "CNY", "GBP", "BRL", "IDR", "AZN", "AED", "PLN", "ILS"];
    if (!fiatSupported.includes(currencyUpper)) return res.status(400).json({ message: "Crypto Pay: поддерживаются USD, RUB, EUR и др. Укажите валюту из списка." });
    if (amountRounded < 0.5) return res.status(400).json({ message: "Минимальная сумма — 0.5" });

    // Персональная скидка админа — на продуктовые оплаты, не на чистое пополнение.
    const cryptoIsTopup = !tariffIdToStore && !proxyTariffIdToStore && !singboxTariffIdToStore && !customBuildBody && !extraOption;
    if (isStars && cryptoIsTopup && starsClient?.preferredCurrency?.toUpperCase() !== "RUB") return res.status(400).json({ message: "Для пополнения Stars выберите рублёвый баланс" });
    if (isStars && cryptoIsTopup && promoCodeStr) return res.status(400).json({ message: "Промокод применяется к покупке тарифа" });
    if (!cryptoIsTopup) {
      const originalBeforePersonal = amountRounded;
      const pd = await applyPersonalDiscount(amountRounded, clientId);
      if (pd.personalDiscountPercent > 0) {
        amountRounded = pd.amount;
        metadataObj = { ...metadataObj, personalDiscountPercent: pd.personalDiscountPercent, originalAmount: originalBeforePersonal };
      }
    }

    // Применяем промокод на скидку (не для опций и гибких тарифов)
    let promoCodeRecord: { id: string } | null = null;
    if (promoCodeStr?.trim() && !extraOption && !customBuildBody) {
      const result = await validatePromoCode(promoCodeStr.trim(), clientId);
      if (!result.ok) return res.status(result.status).json({ message: result.error });
      const promo = result.promo;
      if (promo.type !== "DISCOUNT") return res.status(400).json({ message: "Этот промокод не даёт скидку на оплату" });
      const originalAmount = (metadataObj as { originalAmount?: number }).originalAmount ?? amountRounded;
      if (promo.discountPercent && promo.discountPercent > 0) {
        amountRounded = Math.max(0, amountRounded - amountRounded * promo.discountPercent / 100);
      }
      if (promo.discountFixed && promo.discountFixed > 0) {
        amountRounded = Math.max(0, amountRounded - promo.discountFixed);
      }
      amountRounded = Math.round(amountRounded * 100) / 100;
      if (amountRounded <= 0) return res.status(400).json({ message: "Итоговая сумма не может быть 0" });
      promoCodeRecord = promo;
      metadataObj = { ...metadataObj, promoCodeId: promo.id, originalAmount };
    }

    const cpSnap = cryptoIsTopup ? await paymentSnapshotTopup(clientId, amountRounded) : await paymentSnapshotProduct(clientId, amountRounded);
    const cpCharge = cpSnap.amount;

    const totalStars = isStars ? starsAmount(cpCharge, config.telegramStarsRubPerStar) : 0;
    if (isStars) metadataObj.stars = { total: totalStars, telegramId: starsClient!.telegramId, botId: process.env.BOT_TOKEN!.split(":")[0], expiresAt: Date.now() + 3600000 };
    const orderId = randomUUID();
    const payment = await createPayment({
      data: asPaymentUncheckedCreate({
        clientId,
        orderId,
        amount: cpSnap.amount,
        currency: currencyUpper,
        status: "PENDING",
        provider: isStars ? "telegram_stars" : "cryptopay",
        tariffId: tariffIdToStore,
        tariffPriceOptionId: parsed.data.tariffPriceOptionId ?? null,
        deviceCount: parsed.data.deviceCount ?? null,
        proxyTariffId: proxyTariffIdToStore,
        singboxTariffId: singboxTariffIdToStore,
        // see yookassa endpoint for explanation.
        metadata: (() => {
          const meta = { ...metadataObj };
          if (asAdditional && tariffIdToStore) {
            meta.isAdditionalSubscription = true;
          }
          if (asGift) {
            meta.purchasedAsGift = true;
          }
          if (isStars && parsed.data.replaceTrialSubId) meta.replaceTrialSubId = parsed.data.replaceTrialSubId;
          if (extendsSecondarySubId) {
            meta.extendsSecondarySubId = extendsSecondarySubId;
            // флаг удаления доп. устройств при активации.
            if (removeExtrasOnActivate === true) {
              meta.removeExtrasOnActivate = true;
            }
            // замена выбранного триала при покупке.
            if (parsed.data.replaceTrialSubId) {
              meta.replaceTrialSubId = parsed.data.replaceTrialSubId;
            }
          }
          return Object.keys(meta).length > 0 ? JSON.stringify(meta) : null;
        })(),
      }),
    });

    const serviceName = config.serviceName?.trim() || "STEALTHNET";
    // добавляем tg:<id> в description для удобного поиска
    // платежей в кабинете CryptoPay (зеркалит логику YooKassa).
    const cryptoClient = await prisma.client.findUnique({
      where: { id: clientId },
      select: { telegramId: true },
    });
    const tgIdSuffix = cryptoClient?.telegramId ? ` tg:${cryptoClient.telegramId}` : "";
    const description = (tariffIdToStore
      ? `Тариф ${serviceName} #${orderId}`
      : proxyTariffIdToStore
        ? `Прокси ${serviceName} #${orderId}`
        : singboxTariffIdToStore
          ? `Доступы ${serviceName} #${orderId}`
          : customBuildBody
            ? `Гибкий тариф ${serviceName} #${orderId}`
            : extraOption
              ? `Опция ${serviceName} #${orderId}`
              : `Пополнение баланса ${serviceName} #${orderId}`) + tgIdSuffix;

    if (isStars) {
      try {
        const payUrl = await starsApi<string>("createInvoiceLink", {
          title: serviceName.slice(0, 32),
          description: description.slice(0, 255),
          payload: `snstars:${payment.id}`,
          provider_token: "",
          currency: "XTR",
          prices: [{ label: "Покупка", amount: totalStars }],
        });
        return res.status(201).json({ paymentId: payment.id, payUrl, starsAmount: totalStars });
      } catch {
        await prisma.payment.updateMany({ where: { id: payment.id, status: "PENDING" }, data: { status: "FAILED" } });
        return res.status(502).json({ message: "Не удалось создать счёт Telegram Stars. Попробуйте ещё раз." });
      }
    }

    const result = await createCryptopayInvoice({
      config: cryptopayConfig,
      amount: String(cpCharge),
      currencyType: "fiat",
      fiat: currencyUpper,
      description: description.slice(0, 1024),
      payload: payment.id,
    });

    if (!result.ok) {
      console.warn("[cryptopay/create-payment] invoice rejected", { paymentId: payment.id, status: result.status, providerCode: result.providerCode, providerError: result.providerError });
      await prisma.payment.delete({ where: { id: payment.id } }).catch(() => {});
      return res.status(500).json({ message: result.error });
    }

    const payUrl = await saveRedirectAndBuildUrl(payment.id, orderId, result.payUrl, config.publicAppUrl);

    return res.status(201).json({
      paymentId: payment.id,
      payUrl,
      miniAppPayUrl: result.miniAppPayUrl,
      webAppPayUrl: result.webAppPayUrl,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cryptopay/create-payment]", message, err);
    return res.status(500).json({ message: message || "Ошибка создания платежа" });
  }
}));

clientPaymentsCryptoRouter.post("/heleket/create-payment", requireRemnaPaymentOnline, asyncHandler(async (req, res) => {
  try {
    const clientId = (req as unknown as { clientId: string }).clientId;
    const parsed = heleketCreatePaymentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Неверные параметры", errors: parsed.error.flatten() });
    const config = await getSystemConfig();
    const heleketConfig = {
      merchantId: (config as { heleketMerchantId?: string | null }).heleketMerchantId ?? "",
      apiKey: (config as { heleketApiKey?: string | null }).heleketApiKey ?? "",
    };
    if (!isHeleketConfigured(heleketConfig)) return res.status(503).json({ message: "Heleket не настроен" });
    const { extendsSecondarySubId, removeExtrasOnActivate, asGift, asAdditional } = parsed.data;

    const { amount: amountBody, currency: currencyBody, tariffId: tariffIdBody, proxyTariffId: proxyTariffIdBody, singboxTariffId: singboxTariffIdBody, promoCode: promoCodeStr, extraOption, customBuild: customBuildBody } = parsed.data;
    let amountRounded: number;
    let currencyUpper: string;
    let tariffIdToStore: string | null = null;
    let proxyTariffIdToStore: string | null = null;
    let singboxTariffIdToStore: string | null = null;
    let metadataObj: Record<string, unknown> = promoCodeStr ? { promoCode: promoCodeStr } : {};

    if (customBuildBody) {
      const cfg = getCustomBuildConfig(config);
      if (!cfg) return res.status(400).json({ message: "Гибкий тариф отключён" });
      let { days, devices, trafficGb } = customBuildBody;
      if (days > cfg.maxDays || devices > cfg.maxDevices) {
        return res.status(400).json({ message: `Дни: 1–${cfg.maxDays}, устройств: 1–${cfg.maxDevices}` });
      }
      const trafficLimitBytes =
        cfg.trafficMode === "per_gb" && trafficGb != null && trafficGb >= 0
          ? Math.round(trafficGb * 1024 ** 3)
          : null;
      amountRounded = days * cfg.pricePerDay + devices * cfg.pricePerDevice;
      if (cfg.trafficMode === "per_gb" && trafficGb != null && trafficGb > 0) amountRounded += trafficGb * cfg.pricePerGb;
      amountRounded = Math.round(amountRounded * 100) / 100;
      currencyUpper = cfg.currency.toUpperCase();
      metadataObj = {
        customBuild: {
          durationDays: days,
          deviceLimit: devices,
          trafficLimitBytes,
          internalSquadUuids: [cfg.squadUuid],
        },
      };
    } else if (extraOption) {
      const cfg = config as { sellOptionsEnabled?: boolean; sellOptionsTrafficEnabled?: boolean; sellOptionsTrafficProducts?: SellOptionTrafficProduct[]; sellOptionsDevicesEnabled?: boolean; sellOptionsDevicesProducts?: SellOptionDeviceProduct[]; sellOptionsServersEnabled?: boolean; sellOptionsServersProducts?: SellOptionServerProduct[] };
      if (!cfg.sellOptionsEnabled) return res.status(400).json({ message: "Продажа опций отключена" });
      if (extraOption.kind === "traffic") {
        const product = cfg.sellOptionsTrafficEnabled && cfg.sellOptionsTrafficProducts?.find((p) => p.id === extraOption.productId);
        if (!product) return res.status(400).json({ message: "Опция не найдена" });
        amountRounded = Math.round(product.price * 100) / 100;
        currencyUpper = product.currency.toUpperCase();
        metadataObj = { extraOption: { kind: "traffic", trafficBytes: Math.round(product.trafficGb * 1024 ** 3) } };
      } else if (extraOption.kind === "devices") {
        const product = cfg.sellOptionsDevicesEnabled && cfg.sellOptionsDevicesProducts?.find((p) => p.id === extraOption.productId);
        if (!product) return res.status(400).json({ message: "Опция не найдена" });
        // масштабируем цену для primary подписки
        const prorataCoef = extraOption.targetSubscriptionId ? await calculateDevicesProrataPriceCoefficient(extraOption.targetSubscriptionId) : await calculateDevicesProrataPriceCoefficientForPrimary(clientId);
        amountRounded = Math.floor(product.price * prorataCoef);
        currencyUpper = product.currency.toUpperCase();
        metadataObj = { extraOption: { kind: "devices", deviceCount: product.deviceCount, productPriceMonthly: product.price } };
      } else {
        const product = cfg.sellOptionsServersEnabled && cfg.sellOptionsServersProducts?.find((p) => p.id === extraOption.productId);
        if (!product) return res.status(400).json({ message: "Опция не найдена" });
        amountRounded = Math.round(product.price * 100) / 100;
        currencyUpper = product.currency.toUpperCase();
        metadataObj = { extraOption: { kind: "servers", squadUuid: product.squadUuid, ...((product.trafficGb ?? 0) > 0 && { trafficBytes: Math.round((product.trafficGb ?? 0) * 1024 ** 3) }) } };
      }
    } else {
      currencyUpper = (currencyBody ?? "USD").toUpperCase();
      if (tariffIdBody) {
        const tariff = await prisma.tariff.findUnique({
          where: { id: tariffIdBody },
          include: { priceOptions: true },
        });
        if (!tariff) return res.status(400).json({ message: "Тариф не найден" });
        // кулдаун ПРОДЛЕНИЯ существующей подписки.
        // Применяется только при продлении (extendsSecondarySubId) — новые покупки этого
        // же тарифа как доп. подписок не блокируются.
        if ("extendsSecondarySubId" in parsed.data && parsed.data.extendsSecondarySubId) {
          const { checkSubscriptionRenewalCooldown } = await import("../tariff/tariff-cooldown.service.js");
          const cd = await checkSubscriptionRenewalCooldown(parsed.data.extendsSecondarySubId!);
          if (!cd.ok) return res.status(429).json({ message: cd.message, code: "TARIFF_COOLDOWN", daysLeft: cd.daysLeft });
        }
        tariffIdToStore = tariffIdBody;
        // честный расчёт цены тарифа.
        // Раньше: `amountBody ?? tariff.price` — игнорировались priceOption и extras (баг 149₽).
        // Теперь: priceOption + extras (новая покупка) или extrasMonthlyPrice (продление).
        let unitPriceCalc = tariff.price;
        let effectiveDaysCalc = tariff.durationDays;
        if (parsed.data.tariffPriceOptionId) {
          const opt = (tariff.priceOptions ?? []).find((p) => p.id === parsed.data.tariffPriceOptionId);
          if (opt) {
            unitPriceCalc = opt.price;
            effectiveDaysCalc = opt.durationDays;
          }
        }
        // доплата за СУЩЕСТВУЮЩИЕ extras подписки при продлении.
        // T-extras-universal: при «убрать устройства» (removeExtrasOnActivate) доплату НЕ берём —
        // устройства удаляются при активации, юзер видел базовую цену.
        if (parsed.data.extendsSecondarySubId && parsed.data.removeExtrasOnActivate !== true) {
          const sub = await prisma.subscription.findUnique({
            where: { id: parsed.data.extendsSecondarySubId },
            select: { extraDevicesMonthlyPrice: true },
          });
          const monthlyPrice = sub?.extraDevicesMonthlyPrice ?? 0;
          if (monthlyPrice > 0 && effectiveDaysCalc > 0) {
            unitPriceCalc += Math.round(monthlyPrice * (effectiveDaysCalc / 30) * 100) / 100;
          }
        }
        // НОВЫЕ устройства, выбранные при покупке — теперь для ЛЮБОЙ покупки
        // (новая/конверт/продление): activation их честно выдаёт, значит и цена честная.
        {
          const newExtrasCalc = Math.max(0, parsed.data.deviceCount ?? 0);
          if (newExtrasCalc > 0) {
            const { calcExtrasPrice } = await import("../tariff/extras-pricing.js");
            const r = calcExtrasPrice(
              tariff.pricePerExtraDevice ?? 0,
              newExtrasCalc,
              tariff.deviceDiscountTiers,
              effectiveDaysCalc,
            );
            unitPriceCalc += r.extrasTotal;
          }
        }
        amountRounded = Math.round(unitPriceCalc * 100) / 100;
      } else if (proxyTariffIdBody) {
        const proxyTariff = await prisma.proxyTariff.findUnique({ where: { id: proxyTariffIdBody } });
        if (!proxyTariff || !proxyTariff.enabled) return res.status(400).json({ message: "Прокси-тариф не найден" });
        proxyTariffIdToStore = proxyTariffIdBody;
        amountRounded = Math.round((amountBody ?? proxyTariff.price) * 100) / 100;
      } else if (singboxTariffIdBody) {
        const singboxTariff = await prisma.singboxTariff.findUnique({ where: { id: singboxTariffIdBody } });
        if (!singboxTariff || !singboxTariff.enabled) return res.status(400).json({ message: "Тариф Sing-box не найден" });
        singboxTariffIdToStore = singboxTariffIdBody;
        amountRounded = Math.round((amountBody ?? singboxTariff.price) * 100) / 100;
      } else {
        if (amountBody == null) return res.status(400).json({ message: "Укажите сумму" });
        amountRounded = Math.round(amountBody * 100) / 100;
      }
    }

    if (amountRounded < 1) return res.status(400).json({ message: "Минимальная сумма платежа — 1" });

    // Персональная скидка админа — на продуктовые оплаты, не на чистое пополнение.
    const heleketIsTopup = !tariffIdToStore && !proxyTariffIdToStore && !singboxTariffIdToStore && !customBuildBody && !extraOption;
    if (!heleketIsTopup) {
      const originalBeforePersonal = amountRounded;
      const pd = await applyPersonalDiscount(amountRounded, clientId);
      if (pd.personalDiscountPercent > 0) {
        amountRounded = pd.amount;
        metadataObj = { ...metadataObj, personalDiscountPercent: pd.personalDiscountPercent, originalAmount: originalBeforePersonal };
      }
    }

    // Применяем промокод на скидку (не для опций и гибких тарифов)
    let promoCodeRecord: { id: string } | null = null;
    if (promoCodeStr?.trim() && !extraOption && !customBuildBody) {
      const result = await validatePromoCode(promoCodeStr.trim(), clientId);
      if (!result.ok) return res.status(result.status).json({ message: result.error });
      const promo = result.promo;
      if (promo.type !== "DISCOUNT") return res.status(400).json({ message: "Этот промокод не даёт скидку на оплату" });
      const originalAmount = (metadataObj as { originalAmount?: number }).originalAmount ?? amountRounded;
      if (promo.discountPercent && promo.discountPercent > 0) {
        amountRounded = Math.max(0, amountRounded - amountRounded * promo.discountPercent / 100);
      }
      if (promo.discountFixed && promo.discountFixed > 0) {
        amountRounded = Math.max(0, amountRounded - promo.discountFixed);
      }
      amountRounded = Math.round(amountRounded * 100) / 100;
      if (amountRounded <= 0) return res.status(400).json({ message: "Итоговая сумма не может быть 0" });
      promoCodeRecord = promo;
      metadataObj = { ...metadataObj, promoCodeId: promo.id, originalAmount };
    }

    const hkSnap = heleketIsTopup ? await paymentSnapshotTopup(clientId, amountRounded) : await paymentSnapshotProduct(clientId, amountRounded);
    const hkCharge = hkSnap.amount;

    const orderId = randomUUID();
    const payment = await createPayment({
      data: asPaymentUncheckedCreate({
        clientId,
        orderId,
        amount: hkSnap.amount,
        currency: currencyUpper,
        status: "PENDING",
        provider: "heleket",
        tariffId: tariffIdToStore,
        tariffPriceOptionId: parsed.data.tariffPriceOptionId ?? null,
        deviceCount: parsed.data.deviceCount ?? null,
        proxyTariffId: proxyTariffIdToStore,
        singboxTariffId: singboxTariffIdToStore,
        // see yookassa endpoint for explanation.
        metadata: (() => {
          const meta = { ...metadataObj };
          if (asAdditional && tariffIdToStore) {
            meta.isAdditionalSubscription = true;
          }
          if (asGift) {
            meta.purchasedAsGift = true;
          }
          if (extendsSecondarySubId) {
            meta.extendsSecondarySubId = extendsSecondarySubId;
            // флаг удаления доп. устройств при активации.
            if (removeExtrasOnActivate === true) {
              meta.removeExtrasOnActivate = true;
            }
            // замена выбранного триала при покупке.
            if (parsed.data.replaceTrialSubId) {
              meta.replaceTrialSubId = parsed.data.replaceTrialSubId;
            }
          }
          return Object.keys(meta).length > 0 ? JSON.stringify(meta) : null;
        })(),
      }),
    });

    const serviceName = config.serviceName?.trim() || "STEALTHNET";
    const appUrl = (config.publicAppUrl || "").replace(/\/$/, "");
    const urlCallback = appUrl ? `${appUrl}/api/webhooks/heleket` : undefined;
    const urlSuccess = appUrl ? `${appUrl}/cabinet?heleket=success` : undefined;
    const urlReturn = appUrl ? `${appUrl}/cabinet?heleket=return` : undefined;

    const result = await createHeleketInvoice({
      config: heleketConfig,
      amount: String(hkCharge),
      currency: currencyUpper,
      orderId,
      urlCallback,
      urlSuccess,
      urlReturn,
      additionalData: payment.id,
      lifetime: 3600,
      toCurrency: "usdt",
    });

    if (!result.ok) {
      await prisma.payment.delete({ where: { id: payment.id } }).catch(() => {});
      return res.status(500).json({ message: result.error });
    }

    const payUrl = await saveRedirectAndBuildUrl(payment.id, orderId, result.url, config.publicAppUrl);

    return res.status(201).json({
      paymentId: payment.id,
      payUrl,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[heleket/create-payment]", message, err);
    return res.status(500).json({ message: message || "Ошибка создания платежа" });
  }
}));

clientPaymentsCryptoRouter.post(["/rollypay/create-payment", "/cispay/create-payment"], requireRemnaPaymentOnline, asyncHandler(async (req, res) => {
  try {
    const provider = req.path === "/cispay/create-payment" ? "cispay" : "rollypay";
    const clientId = (req as unknown as { clientId: string }).clientId;
    const parsed = heleketCreatePaymentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Неверные параметры", errors: parsed.error.flatten() });
    const config = await getSystemConfig();
    if (provider === "cispay" && (!config.cispayEnabled || !config.cispayShopId || !config.cispayApiKey)) return res.status(503).json({ message: "CisPay не настроен или отключён" });
    if (provider === "rollypay" && !config.rollypayEnabled) return res.status(503).json({ message: "RollyPay отключён" });
    const rollypayConfig = {
      apiKey: (config as { rollypayApiKey?: string | null }).rollypayApiKey ?? "",
      signingSecret: (config as { rollypaySigningSecret?: string | null }).rollypaySigningSecret ?? "",
      testMode: (config as { rollypayTestMode?: boolean }).rollypayTestMode === true,
    };
    if (provider === "rollypay" && !isRollypayConfigured(rollypayConfig)) return res.status(503).json({ message: "RollyPay не настроен" });
    const { extendsSecondarySubId, removeExtrasOnActivate, asGift, asAdditional } = parsed.data;

    const { amount: amountBody, currency: currencyBody, tariffId: tariffIdBody, proxyTariffId: proxyTariffIdBody, singboxTariffId: singboxTariffIdBody, promoCode: promoCodeStr, extraOption, customBuild: customBuildBody } = parsed.data;
    let amountRounded: number;
    let currencyUpper: string;
    let tariffIdToStore: string | null = null;
    let proxyTariffIdToStore: string | null = null;
    let singboxTariffIdToStore: string | null = null;
    let metadataObj: Record<string, unknown> = promoCodeStr ? { promoCode: promoCodeStr } : {};

    if (customBuildBody) {
      const cfg = getCustomBuildConfig(config);
      if (!cfg) return res.status(400).json({ message: "Гибкий тариф отключён" });
      let { days, devices, trafficGb } = customBuildBody;
      if (days > cfg.maxDays || devices > cfg.maxDevices) {
        return res.status(400).json({ message: `Дни: 1–${cfg.maxDays}, устройств: 1–${cfg.maxDevices}` });
      }
      const trafficLimitBytes =
        cfg.trafficMode === "per_gb" && trafficGb != null && trafficGb >= 0
          ? Math.round(trafficGb * 1024 ** 3)
          : null;
      amountRounded = days * cfg.pricePerDay + devices * cfg.pricePerDevice;
      if (cfg.trafficMode === "per_gb" && trafficGb != null && trafficGb > 0) amountRounded += trafficGb * cfg.pricePerGb;
      amountRounded = Math.round(amountRounded * 100) / 100;
      currencyUpper = cfg.currency.toUpperCase();
      metadataObj = {
        customBuild: {
          durationDays: days,
          deviceLimit: devices,
          trafficLimitBytes,
          internalSquadUuids: [cfg.squadUuid],
        },
      };
    } else if (extraOption) {
      const cfg = config as { sellOptionsEnabled?: boolean; sellOptionsTrafficEnabled?: boolean; sellOptionsTrafficProducts?: SellOptionTrafficProduct[]; sellOptionsDevicesEnabled?: boolean; sellOptionsDevicesProducts?: SellOptionDeviceProduct[]; sellOptionsServersEnabled?: boolean; sellOptionsServersProducts?: SellOptionServerProduct[] };
      if (!cfg.sellOptionsEnabled) return res.status(400).json({ message: "Продажа опций отключена" });
      if (extraOption.kind === "traffic") {
        const product = cfg.sellOptionsTrafficEnabled && cfg.sellOptionsTrafficProducts?.find((p) => p.id === extraOption.productId);
        if (!product) return res.status(400).json({ message: "Опция не найдена" });
        amountRounded = Math.round(product.price * 100) / 100;
        currencyUpper = product.currency.toUpperCase();
        metadataObj = { extraOption: { kind: "traffic", trafficBytes: Math.round(product.trafficGb * 1024 ** 3) } };
      } else if (extraOption.kind === "devices") {
        const product = cfg.sellOptionsDevicesEnabled && cfg.sellOptionsDevicesProducts?.find((p) => p.id === extraOption.productId);
        if (!product) return res.status(400).json({ message: "Опция не найдена" });
        // масштабируем цену для primary подписки
        const prorataCoef = extraOption.targetSubscriptionId ? await calculateDevicesProrataPriceCoefficient(extraOption.targetSubscriptionId) : await calculateDevicesProrataPriceCoefficientForPrimary(clientId);
        amountRounded = Math.floor(product.price * prorataCoef);
        currencyUpper = product.currency.toUpperCase();
        metadataObj = { extraOption: { kind: "devices", deviceCount: product.deviceCount, productPriceMonthly: product.price } };
      } else {
        const product = cfg.sellOptionsServersEnabled && cfg.sellOptionsServersProducts?.find((p) => p.id === extraOption.productId);
        if (!product) return res.status(400).json({ message: "Опция не найдена" });
        amountRounded = Math.round(product.price * 100) / 100;
        currencyUpper = product.currency.toUpperCase();
        metadataObj = { extraOption: { kind: "servers", squadUuid: product.squadUuid, ...((product.trafficGb ?? 0) > 0 && { trafficBytes: Math.round((product.trafficGb ?? 0) * 1024 ** 3) }) } };
      }
    } else {
      currencyUpper = (currencyBody ?? "USD").toUpperCase();
      if (tariffIdBody) {
        const tariff = await prisma.tariff.findUnique({
          where: { id: tariffIdBody },
          include: { priceOptions: true },
        });
        if (!tariff) return res.status(400).json({ message: "Тариф не найден" });
        // Валюту берём У ТАРИФА: мини-аппы её в запросе не передают, а дефолт
        // «USD» ломает RUB-only провайдера (RollyPay отвечает 400).
        currencyUpper = (tariff.currency ?? currencyUpper).toUpperCase();
        // кулдаун ПРОДЛЕНИЯ существующей подписки.
        // Применяется только при продлении (extendsSecondarySubId) — новые покупки этого
        // же тарифа как доп. подписок не блокируются.
        if ("extendsSecondarySubId" in parsed.data && parsed.data.extendsSecondarySubId) {
          const { checkSubscriptionRenewalCooldown } = await import("../tariff/tariff-cooldown.service.js");
          const cd = await checkSubscriptionRenewalCooldown(parsed.data.extendsSecondarySubId!);
          if (!cd.ok) return res.status(429).json({ message: cd.message, code: "TARIFF_COOLDOWN", daysLeft: cd.daysLeft });
        }
        tariffIdToStore = tariffIdBody;
        // честный расчёт цены тарифа.
        // Раньше: `amountBody ?? tariff.price` — игнорировались priceOption и extras (баг 149₽).
        // Теперь: priceOption + extras (новая покупка) или extrasMonthlyPrice (продление).
        let unitPriceCalc = tariff.price;
        let effectiveDaysCalc = tariff.durationDays;
        if (parsed.data.tariffPriceOptionId) {
          const opt = (tariff.priceOptions ?? []).find((p) => p.id === parsed.data.tariffPriceOptionId);
          if (!opt) return res.status(400).json({ message: "Срок тарифа не найден" });
          if (opt) {
            unitPriceCalc = opt.price;
            effectiveDaysCalc = opt.durationDays;
          }
        }
        // доплата за СУЩЕСТВУЮЩИЕ extras подписки при продлении.
        // T-extras-universal: при «убрать устройства» (removeExtrasOnActivate) доплату НЕ берём —
        // устройства удаляются при активации, юзер видел базовую цену.
        if (parsed.data.extendsSecondarySubId && parsed.data.removeExtrasOnActivate !== true) {
          const sub = await prisma.subscription.findUnique({
            where: { id: parsed.data.extendsSecondarySubId },
            select: { extraDevicesMonthlyPrice: true },
          });
          const monthlyPrice = sub?.extraDevicesMonthlyPrice ?? 0;
          if (monthlyPrice > 0 && effectiveDaysCalc > 0) {
            unitPriceCalc += Math.round(monthlyPrice * (effectiveDaysCalc / 30) * 100) / 100;
          }
        }
        // НОВЫЕ устройства, выбранные при покупке — теперь для ЛЮБОЙ покупки
        // (новая/конверт/продление): activation их честно выдаёт, значит и цена честная.
        {
          const newExtrasCalc = Math.max(0, parsed.data.deviceCount ?? 0);
          if (newExtrasCalc > 0) {
            const { calcExtrasPrice } = await import("../tariff/extras-pricing.js");
            const r = calcExtrasPrice(
              tariff.pricePerExtraDevice ?? 0,
              newExtrasCalc,
              tariff.deviceDiscountTiers,
              effectiveDaysCalc,
            );
            unitPriceCalc += r.extrasTotal;
          }
        }
        amountRounded = Math.round(unitPriceCalc * 100) / 100;
      } else if (proxyTariffIdBody) {
        const proxyTariff = await prisma.proxyTariff.findUnique({ where: { id: proxyTariffIdBody } });
        if (!proxyTariff || !proxyTariff.enabled) return res.status(400).json({ message: "Прокси-тариф не найден" });
        proxyTariffIdToStore = proxyTariffIdBody;
        amountRounded = Math.round(proxyTariff.price * 100) / 100;
        currencyUpper = proxyTariff.currency.toUpperCase();
      } else if (singboxTariffIdBody) {
        const singboxTariff = await prisma.singboxTariff.findUnique({ where: { id: singboxTariffIdBody } });
        if (!singboxTariff || !singboxTariff.enabled) return res.status(400).json({ message: "Тариф Sing-box не найден" });
        singboxTariffIdToStore = singboxTariffIdBody;
        amountRounded = Math.round(singboxTariff.price * 100) / 100;
        currencyUpper = singboxTariff.currency.toUpperCase();
      } else {
        if (amountBody == null) return res.status(400).json({ message: "Укажите сумму" });
        amountRounded = Math.round(amountBody * 100) / 100;
      }
    }

    if (provider === "cispay" && !["RUB", "USD"].includes(currencyUpper)) return res.status(400).json({ message: "CisPay принимает RUB и USD" });
    if (extraOption?.targetSubscriptionId && metadataObj.extraOption) metadataObj.targetSubscriptionId = extraOption.targetSubscriptionId;
    if (amountRounded < 1) return res.status(400).json({ message: "Минимальная сумма платежа — 1" });

    // Персональная скидка админа — на продуктовые оплаты, не на чистое пополнение.
    const rollypayIsTopup = !tariffIdToStore && !proxyTariffIdToStore && !singboxTariffIdToStore && !customBuildBody && !extraOption;
    if (!rollypayIsTopup) {
      const originalBeforePersonal = amountRounded;
      const pd = await applyPersonalDiscount(amountRounded, clientId);
      if (pd.personalDiscountPercent > 0) {
        amountRounded = pd.amount;
        metadataObj = { ...metadataObj, personalDiscountPercent: pd.personalDiscountPercent, originalAmount: originalBeforePersonal };
      }
    }

    // Применяем промокод на скидку (не для опций и гибких тарифов)
    let promoCodeRecord: { id: string } | null = null;
    if (promoCodeStr?.trim() && !extraOption && !customBuildBody) {
      const result = await validatePromoCode(promoCodeStr.trim(), clientId);
      if (!result.ok) return res.status(result.status).json({ message: result.error });
      const promo = result.promo;
      if (promo.type !== "DISCOUNT") return res.status(400).json({ message: "Этот промокод не даёт скидку на оплату" });
      const originalAmount = (metadataObj as { originalAmount?: number }).originalAmount ?? amountRounded;
      if (promo.discountPercent && promo.discountPercent > 0) {
        amountRounded = Math.max(0, amountRounded - amountRounded * promo.discountPercent / 100);
      }
      if (promo.discountFixed && promo.discountFixed > 0) {
        amountRounded = Math.max(0, amountRounded - promo.discountFixed);
      }
      amountRounded = Math.round(amountRounded * 100) / 100;
      if (amountRounded <= 0) return res.status(400).json({ message: "Итоговая сумма не может быть 0" });
      promoCodeRecord = promo;
      metadataObj = { ...metadataObj, promoCodeId: promo.id, originalAmount };
    }

    const rpSnap = rollypayIsTopup ? await paymentSnapshotTopup(clientId, amountRounded) : await paymentSnapshotProduct(clientId, amountRounded);
    const rpCharge = rpSnap.amount;

    const orderId = randomUUID();
    const payment = await createPayment({
      data: asPaymentUncheckedCreate({
        clientId,
        orderId,
        amount: rpSnap.amount,
        currency: currencyUpper,
        status: "PENDING",
        provider,
        tariffId: tariffIdToStore,
        tariffPriceOptionId: parsed.data.tariffPriceOptionId ?? null,
        deviceCount: parsed.data.deviceCount ?? null,
        proxyTariffId: proxyTariffIdToStore,
        singboxTariffId: singboxTariffIdToStore,
        // see yookassa endpoint for explanation.
        metadata: (() => {
          const meta: Record<string, unknown> = { ...metadataObj, ...(provider === "cispay" ? { cispaySandbox: config.cispaySandbox, cispayShopId: config.cispayShopId } : { rollypayTestMode: rollypayConfig.testMode === true }) };
          if (asAdditional && tariffIdToStore) {
            meta.isAdditionalSubscription = true;
          }
          if (asGift) {
            meta.purchasedAsGift = true;
          }
          if (extendsSecondarySubId) {
            meta.extendsSecondarySubId = extendsSecondarySubId;
            // флаг удаления доп. устройств при активации.
            if (removeExtrasOnActivate === true) {
              meta.removeExtrasOnActivate = true;
            }
            // замена выбранного триала при покупке.
            if (parsed.data.replaceTrialSubId) {
              meta.replaceTrialSubId = parsed.data.replaceTrialSubId;
            }
          }
          return Object.keys(meta).length > 0 ? JSON.stringify(meta) : null;
        })(),
      }),
    });

    const serviceName = config.serviceName?.trim() || "STEALTHNET";
    const appUrl = (config.publicAppUrl || "").replace(/\/$/, "");
    // Адрес вебхука у RollyPay задаётся в личном кабинете кассы, в запросе его нет:
    // указать нужно {publicAppUrl}/api/webhooks/rollypay
    const urlSuccess = appUrl ? `${appUrl}/cabinet?rollypay=success` : undefined;
    const urlFail = appUrl ? `${appUrl}/cabinet?rollypay=fail` : undefined;

    const result = provider === "cispay" ? await createCispayPayment({ config: { shopId: config.cispayShopId, apiKey: config.cispayApiKey }, amount: rpCharge, currency: currencyUpper, orderId, customerId: clientId, description: `${serviceName}: ${orderId}`, returnUrl: appUrl ? `${appUrl}/cabinet?cispay=return` : undefined }) : await createRollypayPayment({
      config: rollypayConfig,
      amount: String(rpCharge),
      currency: currencyUpper,
      orderId,
      description: `Оплата ${orderId}`,
      customerId: clientId,
      successRedirectUrl: urlSuccess,
      failRedirectUrl: urlFail,
      metadata: { paymentId: payment.id },
    });

    if (!result.ok) {
      await prisma.payment.updateMany({ where: { id: payment.id, status: "PENDING" }, data: { metadata: JSON.stringify({ ...JSON.parse(payment.metadata || "{}"), providerCreationError: result.error }) } });
      return res.status(502).json({ message: result.error, paymentId: payment.id });
    }

    if (result.paymentId) await prisma.payment.updateMany({ where: { id: payment.id, externalId: null }, data: { externalId: result.paymentId } });
    const payUrl = await saveRedirectAndBuildUrl(payment.id, orderId, result.url, config.publicAppUrl);

    return res.status(201).json({
      paymentId: payment.id,
      payUrl,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (["EXTRA_DEVICE_LIMIT", "SUBSCRIPTION_TARGET_INVALID", "SUBSCRIPTION_INACTIVE", "TARIFF_RESTRICTED"].includes((err as { code?: string })?.code ?? "")) return res.status(400).json({ message, code: (err as { code: string }).code });
    console.error("[hosted/create-payment]", message);
    return res.status(500).json({ message: message || "Ошибка создания платежа" });
  }
}));

clientPaymentsCryptoRouter.post("/paritypay/create-payment", requireRemnaPaymentOnline, asyncHandler(async (req, res) => {
  try {
    const clientId = (req as unknown as { clientId: string }).clientId;
    const parsed = heleketCreatePaymentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Неверные параметры", errors: parsed.error.flatten() });
    const config = await getSystemConfig();
    const paritypayConfig = {
      apiKey: (config as { paritypayApiKey?: string | null }).paritypayApiKey ?? "",
      signingSecret: (config as { paritypaySigningSecret?: string | null }).paritypaySigningSecret ?? "",
      shopId: config.paritypayShopId ?? "",
      enabled: config.paritypayEnabled,
    };
    if (!isParitypayConfigured(paritypayConfig)) return res.status(503).json({ message: "ParityPay не настроен" });
    const { extendsSecondarySubId, removeExtrasOnActivate, asGift, asAdditional } = parsed.data;

    const { amount: amountBody, currency: currencyBody, tariffId: tariffIdBody, proxyTariffId: proxyTariffIdBody, singboxTariffId: singboxTariffIdBody, promoCode: promoCodeStr, extraOption, customBuild: customBuildBody } = parsed.data;
    let amountRounded: number;
    let currencyUpper: string;
    let tariffIdToStore: string | null = null;
    let proxyTariffIdToStore: string | null = null;
    let singboxTariffIdToStore: string | null = null;
    let metadataObj: Record<string, unknown> = promoCodeStr ? { promoCode: promoCodeStr } : {};

    if (customBuildBody) {
      const cfg = getCustomBuildConfig(config);
      if (!cfg) return res.status(400).json({ message: "Гибкий тариф отключён" });
      let { days, devices, trafficGb } = customBuildBody;
      if (days > cfg.maxDays || devices > cfg.maxDevices) {
        return res.status(400).json({ message: `Дни: 1–${cfg.maxDays}, устройств: 1–${cfg.maxDevices}` });
      }
      const trafficLimitBytes =
        cfg.trafficMode === "per_gb" && trafficGb != null && trafficGb >= 0
          ? Math.round(trafficGb * 1024 ** 3)
          : null;
      amountRounded = days * cfg.pricePerDay + devices * cfg.pricePerDevice;
      if (cfg.trafficMode === "per_gb" && trafficGb != null && trafficGb > 0) amountRounded += trafficGb * cfg.pricePerGb;
      amountRounded = Math.round(amountRounded * 100) / 100;
      currencyUpper = cfg.currency.toUpperCase();
      metadataObj = {
        customBuild: {
          durationDays: days,
          deviceLimit: devices,
          trafficLimitBytes,
          internalSquadUuids: [cfg.squadUuid],
        },
      };
    } else if (extraOption) {
      const cfg = config as { sellOptionsEnabled?: boolean; sellOptionsTrafficEnabled?: boolean; sellOptionsTrafficProducts?: SellOptionTrafficProduct[]; sellOptionsDevicesEnabled?: boolean; sellOptionsDevicesProducts?: SellOptionDeviceProduct[]; sellOptionsServersEnabled?: boolean; sellOptionsServersProducts?: SellOptionServerProduct[] };
      if (!cfg.sellOptionsEnabled) return res.status(400).json({ message: "Продажа опций отключена" });
      if (extraOption.kind === "traffic") {
        const product = cfg.sellOptionsTrafficEnabled && cfg.sellOptionsTrafficProducts?.find((p) => p.id === extraOption.productId);
        if (!product) return res.status(400).json({ message: "Опция не найдена" });
        amountRounded = Math.round(product.price * 100) / 100;
        currencyUpper = product.currency.toUpperCase();
        metadataObj = { extraOption: { kind: "traffic", trafficBytes: Math.round(product.trafficGb * 1024 ** 3) } };
      } else if (extraOption.kind === "devices") {
        const product = cfg.sellOptionsDevicesEnabled && cfg.sellOptionsDevicesProducts?.find((p) => p.id === extraOption.productId);
        if (!product) return res.status(400).json({ message: "Опция не найдена" });
        // масштабируем цену для primary подписки
        const prorataCoef = extraOption.targetSubscriptionId ? await calculateDevicesProrataPriceCoefficient(extraOption.targetSubscriptionId) : await calculateDevicesProrataPriceCoefficientForPrimary(clientId);
        amountRounded = Math.floor(product.price * prorataCoef);
        currencyUpper = product.currency.toUpperCase();
        metadataObj = { extraOption: { kind: "devices", deviceCount: product.deviceCount, productPriceMonthly: product.price } };
      } else {
        const product = cfg.sellOptionsServersEnabled && cfg.sellOptionsServersProducts?.find((p) => p.id === extraOption.productId);
        if (!product) return res.status(400).json({ message: "Опция не найдена" });
        amountRounded = Math.round(product.price * 100) / 100;
        currencyUpper = product.currency.toUpperCase();
        metadataObj = { extraOption: { kind: "servers", squadUuid: product.squadUuid, ...((product.trafficGb ?? 0) > 0 && { trafficBytes: Math.round((product.trafficGb ?? 0) * 1024 ** 3) }) } };
      }
    } else {
      currencyUpper = (currencyBody ?? "USD").toUpperCase();
      if (tariffIdBody) {
        const tariff = await prisma.tariff.findUnique({
          where: { id: tariffIdBody },
          include: { priceOptions: true },
        });
        if (!tariff) return res.status(400).json({ message: "Тариф не найден" });
        // Валюту берём У ТАРИФА: мини-аппы её в запросе не передают, а дефолт
        // «USD» ломает RUB-only провайдера (ParityPay отвечает 400).
        currencyUpper = (tariff.currency ?? currencyUpper).toUpperCase();
        // кулдаун ПРОДЛЕНИЯ существующей подписки.
        // Применяется только при продлении (extendsSecondarySubId) — новые покупки этого
        // же тарифа как доп. подписок не блокируются.
        if ("extendsSecondarySubId" in parsed.data && parsed.data.extendsSecondarySubId) {
          const { checkSubscriptionRenewalCooldown } = await import("../tariff/tariff-cooldown.service.js");
          const cd = await checkSubscriptionRenewalCooldown(parsed.data.extendsSecondarySubId!);
          if (!cd.ok) return res.status(429).json({ message: cd.message, code: "TARIFF_COOLDOWN", daysLeft: cd.daysLeft });
        }
        tariffIdToStore = tariffIdBody;
        // честный расчёт цены тарифа.
        // Раньше: `amountBody ?? tariff.price` — игнорировались priceOption и extras (баг 149₽).
        // Теперь: priceOption + extras (новая покупка) или extrasMonthlyPrice (продление).
        let unitPriceCalc = tariff.price;
        let effectiveDaysCalc = tariff.durationDays;
        if (parsed.data.tariffPriceOptionId) {
          const opt = (tariff.priceOptions ?? []).find((p) => p.id === parsed.data.tariffPriceOptionId);
          if (opt) {
            unitPriceCalc = opt.price;
            effectiveDaysCalc = opt.durationDays;
          }
        }
        // доплата за СУЩЕСТВУЮЩИЕ extras подписки при продлении.
        // T-extras-universal: при «убрать устройства» (removeExtrasOnActivate) доплату НЕ берём —
        // устройства удаляются при активации, юзер видел базовую цену.
        if (parsed.data.extendsSecondarySubId && parsed.data.removeExtrasOnActivate !== true) {
          const sub = await prisma.subscription.findUnique({
            where: { id: parsed.data.extendsSecondarySubId },
            select: { extraDevicesMonthlyPrice: true },
          });
          const monthlyPrice = sub?.extraDevicesMonthlyPrice ?? 0;
          if (monthlyPrice > 0 && effectiveDaysCalc > 0) {
            unitPriceCalc += Math.round(monthlyPrice * (effectiveDaysCalc / 30) * 100) / 100;
          }
        }
        // НОВЫЕ устройства, выбранные при покупке — теперь для ЛЮБОЙ покупки
        // (новая/конверт/продление): activation их честно выдаёт, значит и цена честная.
        {
          const newExtrasCalc = Math.max(0, parsed.data.deviceCount ?? 0);
          if (newExtrasCalc > 0) {
            const { calcExtrasPrice } = await import("../tariff/extras-pricing.js");
            const r = calcExtrasPrice(
              tariff.pricePerExtraDevice ?? 0,
              newExtrasCalc,
              tariff.deviceDiscountTiers,
              effectiveDaysCalc,
            );
            unitPriceCalc += r.extrasTotal;
          }
        }
        amountRounded = Math.round(unitPriceCalc * 100) / 100;
      } else if (proxyTariffIdBody) {
        const proxyTariff = await prisma.proxyTariff.findUnique({ where: { id: proxyTariffIdBody } });
        if (!proxyTariff || !proxyTariff.enabled) return res.status(400).json({ message: "Прокси-тариф не найден" });
        proxyTariffIdToStore = proxyTariffIdBody;
        amountRounded = Math.round((amountBody ?? proxyTariff.price) * 100) / 100;
      } else if (singboxTariffIdBody) {
        const singboxTariff = await prisma.singboxTariff.findUnique({ where: { id: singboxTariffIdBody } });
        if (!singboxTariff || !singboxTariff.enabled) return res.status(400).json({ message: "Тариф Sing-box не найден" });
        singboxTariffIdToStore = singboxTariffIdBody;
        amountRounded = Math.round((amountBody ?? singboxTariff.price) * 100) / 100;
      } else {
        if (amountBody == null) return res.status(400).json({ message: "Укажите сумму" });
        amountRounded = Math.round(amountBody * 100) / 100;
      }
    }

    if (amountRounded < 1) return res.status(400).json({ message: "Минимальная сумма платежа — 1" });

    // Персональная скидка админа — на продуктовые оплаты, не на чистое пополнение.
    const paritypayIsTopup = !tariffIdToStore && !proxyTariffIdToStore && !singboxTariffIdToStore && !customBuildBody && !extraOption;
    if (!paritypayIsTopup) {
      const originalBeforePersonal = amountRounded;
      const pd = await applyPersonalDiscount(amountRounded, clientId);
      if (pd.personalDiscountPercent > 0) {
        amountRounded = pd.amount;
        metadataObj = { ...metadataObj, personalDiscountPercent: pd.personalDiscountPercent, originalAmount: originalBeforePersonal };
      }
    }

    // Применяем промокод на скидку (не для опций и гибких тарифов)
    let promoCodeRecord: { id: string } | null = null;
    if (promoCodeStr?.trim() && !extraOption && !customBuildBody) {
      const result = await validatePromoCode(promoCodeStr.trim(), clientId);
      if (!result.ok) return res.status(result.status).json({ message: result.error });
      const promo = result.promo;
      if (promo.type !== "DISCOUNT") return res.status(400).json({ message: "Этот промокод не даёт скидку на оплату" });
      const originalAmount = (metadataObj as { originalAmount?: number }).originalAmount ?? amountRounded;
      if (promo.discountPercent && promo.discountPercent > 0) {
        amountRounded = Math.max(0, amountRounded - amountRounded * promo.discountPercent / 100);
      }
      if (promo.discountFixed && promo.discountFixed > 0) {
        amountRounded = Math.max(0, amountRounded - promo.discountFixed);
      }
      amountRounded = Math.round(amountRounded * 100) / 100;
      if (amountRounded <= 0) return res.status(400).json({ message: "Итоговая сумма не может быть 0" });
      promoCodeRecord = promo;
      metadataObj = { ...metadataObj, promoCodeId: promo.id, originalAmount };
    }

    const rpSnap = paritypayIsTopup ? await paymentSnapshotTopup(clientId, amountRounded) : await paymentSnapshotProduct(clientId, amountRounded);
    const rpCharge = rpSnap.amount;

    const orderId = randomUUID();
    const payment = await createPayment({
      data: asPaymentUncheckedCreate({
        clientId,
        orderId,
        amount: rpSnap.amount,
        currency: currencyUpper,
        status: "PENDING",
        provider: "paritypay",
        tariffId: tariffIdToStore,
        tariffPriceOptionId: parsed.data.tariffPriceOptionId ?? null,
        deviceCount: parsed.data.deviceCount ?? null,
        proxyTariffId: proxyTariffIdToStore,
        singboxTariffId: singboxTariffIdToStore,
        // see yookassa endpoint for explanation.
        metadata: (() => {
          const meta = { ...metadataObj };
          if (asAdditional && tariffIdToStore) {
            meta.isAdditionalSubscription = true;
          }
          if (asGift) {
            meta.purchasedAsGift = true;
          }
          if (extendsSecondarySubId) {
            meta.extendsSecondarySubId = extendsSecondarySubId;
            // флаг удаления доп. устройств при активации.
            if (removeExtrasOnActivate === true) {
              meta.removeExtrasOnActivate = true;
            }
            // замена выбранного триала при покупке.
            if (parsed.data.replaceTrialSubId) {
              meta.replaceTrialSubId = parsed.data.replaceTrialSubId;
            }
          }
          return Object.keys(meta).length > 0 ? JSON.stringify(meta) : null;
        })(),
      }),
    });

    const serviceName = config.serviceName?.trim() || "STEALTHNET";
    const appUrl = (config.publicAppUrl || "").replace(/\/$/, "");
    // Pass the public callback URL for this invoice.
    const urlSuccess = appUrl ? `${appUrl}/cabinet?paritypay=success` : undefined;
    const urlFail = appUrl ? `${appUrl}/cabinet?paritypay=fail` : undefined;

    const result = await createParitypayPayment({
      config: paritypayConfig,
      amount: String(rpCharge),
      currency: currencyUpper,
      orderId,
      description: `Оплата ${orderId}`,
      customerId: clientId,
      successRedirectUrl: urlSuccess,
      failRedirectUrl: urlFail,
      callbackUrl: appUrl ? `${appUrl}/api/webhooks/paritypay` : undefined,
    });

    if (!result.ok) {
      // Keep the pending order: a timeout may still have created an invoice.
      return res.status(500).json({ message: result.error });
    }

    await prisma.payment.update({ where: { id: payment.id }, data: { externalId: result.paymentId } });
    const payUrl = await saveRedirectAndBuildUrl(payment.id, orderId, result.url, config.publicAppUrl);

    return res.status(201).json({
      paymentId: payment.id,
      payUrl,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[paritypay/create-payment]", message, err);
    return res.status(500).json({ message: message || "Ошибка создания платежа" });
  }
}));

// ═════════════════════════════════════════════════════════════════
// LAVA Business — счета (карты / СБП / СберPay) в рублях.
// API: POST https://api.lava.ru/business/invoice/create
// Подпись: HMAC-SHA256(JSON body, secretKey) → Signature header.
// Валюта Lava Business — только RUB. На нерублёвый тариф — ошибка.
// ═════════════════════════════════════════════════════════════════
const lavaCreatePaymentSchema = z.object({
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
clientPaymentsCryptoRouter.post("/lava/create-payment", requireRemnaPaymentOnline, asyncHandler(async (req, res) => {
  try {
    const clientId = (req as unknown as { clientId: string }).clientId;
    const parsed = lavaCreatePaymentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Неверные параметры", errors: parsed.error.flatten() });
    const config = await getSystemConfig();
    const lavaConfig = {
      shopId: (config as { lavaShopId?: string | null }).lavaShopId ?? "",
      secretKey: (config as { lavaSecretKey?: string | null }).lavaSecretKey ?? "",
    };
    if (!isLavaConfigured(lavaConfig)) return res.status(503).json({ message: "Lava не настроена" });
    const { extendsSecondarySubId, removeExtrasOnActivate, asGift, asAdditional } = parsed.data;

    const { amount: amountBody, currency: currencyBody, tariffId: tariffIdBody, proxyTariffId: proxyTariffIdBody, singboxTariffId: singboxTariffIdBody, promoCode: promoCodeStr, extraOption, customBuild: customBuildBody } = parsed.data;
    let amountRounded: number;
    let currencyUpper: string;
    let tariffIdToStore: string | null = null;
    let proxyTariffIdToStore: string | null = null;
    let singboxTariffIdToStore: string | null = null;
    let metadataObj: Record<string, unknown> = promoCodeStr ? { promoCode: promoCodeStr } : {};

    if (customBuildBody) {
      const cfg = getCustomBuildConfig(config);
      if (!cfg) return res.status(400).json({ message: "Гибкий тариф отключён" });
      const { days, devices, trafficGb } = customBuildBody;
      if (days > cfg.maxDays || devices > cfg.maxDevices) {
        return res.status(400).json({ message: `Дни: 1–${cfg.maxDays}, устройств: 1–${cfg.maxDevices}` });
      }
      const trafficLimitBytes =
        cfg.trafficMode === "per_gb" && trafficGb != null && trafficGb >= 0
          ? Math.round(trafficGb * 1024 ** 3)
          : null;
      amountRounded = days * cfg.pricePerDay + devices * cfg.pricePerDevice;
      if (cfg.trafficMode === "per_gb" && trafficGb != null && trafficGb > 0) amountRounded += trafficGb * cfg.pricePerGb;
      amountRounded = Math.round(amountRounded * 100) / 100;
      currencyUpper = cfg.currency.toUpperCase();
      metadataObj = {
        customBuild: {
          durationDays: days,
          deviceLimit: devices,
          trafficLimitBytes,
          internalSquadUuids: [cfg.squadUuid],
        },
      };
    } else if (extraOption) {
      const cfg = config as { sellOptionsEnabled?: boolean; sellOptionsTrafficEnabled?: boolean; sellOptionsTrafficProducts?: SellOptionTrafficProduct[]; sellOptionsDevicesEnabled?: boolean; sellOptionsDevicesProducts?: SellOptionDeviceProduct[]; sellOptionsServersEnabled?: boolean; sellOptionsServersProducts?: SellOptionServerProduct[] };
      if (!cfg.sellOptionsEnabled) return res.status(400).json({ message: "Продажа опций отключена" });
      if (extraOption.kind === "traffic") {
        const product = cfg.sellOptionsTrafficEnabled && cfg.sellOptionsTrafficProducts?.find((p) => p.id === extraOption.productId);
        if (!product) return res.status(400).json({ message: "Опция не найдена" });
        amountRounded = Math.round(product.price * 100) / 100;
        currencyUpper = product.currency.toUpperCase();
        metadataObj = { extraOption: { kind: "traffic", trafficBytes: Math.round(product.trafficGb * 1024 ** 3) } };
      } else if (extraOption.kind === "devices") {
        const product = cfg.sellOptionsDevicesEnabled && cfg.sellOptionsDevicesProducts?.find((p) => p.id === extraOption.productId);
        if (!product) return res.status(400).json({ message: "Опция не найдена" });
        // масштабируем цену для primary подписки
        const prorataCoef = extraOption.targetSubscriptionId ? await calculateDevicesProrataPriceCoefficient(extraOption.targetSubscriptionId) : await calculateDevicesProrataPriceCoefficientForPrimary(clientId);
        amountRounded = Math.floor(product.price * prorataCoef);
        currencyUpper = product.currency.toUpperCase();
        metadataObj = { extraOption: { kind: "devices", deviceCount: product.deviceCount, productPriceMonthly: product.price } };
      } else {
        const product = cfg.sellOptionsServersEnabled && cfg.sellOptionsServersProducts?.find((p) => p.id === extraOption.productId);
        if (!product) return res.status(400).json({ message: "Опция не найдена" });
        amountRounded = Math.round(product.price * 100) / 100;
        currencyUpper = product.currency.toUpperCase();
        metadataObj = { extraOption: { kind: "servers", squadUuid: product.squadUuid, ...((product.trafficGb ?? 0) > 0 && { trafficBytes: Math.round((product.trafficGb ?? 0) * 1024 ** 3) }) } };
      }
    } else {
      currencyUpper = (currencyBody ?? "RUB").toUpperCase();
      if (tariffIdBody) {
        const tariff = await prisma.tariff.findUnique({
          where: { id: tariffIdBody },
          include: { priceOptions: true },
        });
        if (!tariff) return res.status(400).json({ message: "Тариф не найден" });
        // кулдаун ПРОДЛЕНИЯ существующей подписки.
        // Применяется только при продлении (extendsSecondarySubId) — новые покупки этого
        // же тарифа как доп. подписок не блокируются.
        if ("extendsSecondarySubId" in parsed.data && parsed.data.extendsSecondarySubId) {
          const { checkSubscriptionRenewalCooldown } = await import("../tariff/tariff-cooldown.service.js");
          const cd = await checkSubscriptionRenewalCooldown(parsed.data.extendsSecondarySubId!);
          if (!cd.ok) return res.status(429).json({ message: cd.message, code: "TARIFF_COOLDOWN", daysLeft: cd.daysLeft });
        }
        tariffIdToStore = tariffIdBody;
        // честный расчёт цены тарифа.
        // Раньше: `amountBody ?? tariff.price` — игнорировались priceOption и extras (баг 149₽).
        // Теперь: priceOption + extras (новая покупка) или extrasMonthlyPrice (продление).
        let unitPriceCalc = tariff.price;
        let effectiveDaysCalc = tariff.durationDays;
        if (parsed.data.tariffPriceOptionId) {
          const opt = (tariff.priceOptions ?? []).find((p) => p.id === parsed.data.tariffPriceOptionId);
          if (opt) {
            unitPriceCalc = opt.price;
            effectiveDaysCalc = opt.durationDays;
          }
        }
        // доплата за СУЩЕСТВУЮЩИЕ extras подписки при продлении.
        // T-extras-universal: при «убрать устройства» (removeExtrasOnActivate) доплату НЕ берём —
        // устройства удаляются при активации, юзер видел базовую цену.
        if (parsed.data.extendsSecondarySubId && parsed.data.removeExtrasOnActivate !== true) {
          const sub = await prisma.subscription.findUnique({
            where: { id: parsed.data.extendsSecondarySubId },
            select: { extraDevicesMonthlyPrice: true },
          });
          const monthlyPrice = sub?.extraDevicesMonthlyPrice ?? 0;
          if (monthlyPrice > 0 && effectiveDaysCalc > 0) {
            unitPriceCalc += Math.round(monthlyPrice * (effectiveDaysCalc / 30) * 100) / 100;
          }
        }
        // НОВЫЕ устройства, выбранные при покупке — теперь для ЛЮБОЙ покупки
        // (новая/конверт/продление): activation их честно выдаёт, значит и цена честная.
        {
          const newExtrasCalc = Math.max(0, parsed.data.deviceCount ?? 0);
          if (newExtrasCalc > 0) {
            const { calcExtrasPrice } = await import("../tariff/extras-pricing.js");
            const r = calcExtrasPrice(
              tariff.pricePerExtraDevice ?? 0,
              newExtrasCalc,
              tariff.deviceDiscountTiers,
              effectiveDaysCalc,
            );
            unitPriceCalc += r.extrasTotal;
          }
        }
        amountRounded = Math.round(unitPriceCalc * 100) / 100;
      } else if (proxyTariffIdBody) {
        const proxyTariff = await prisma.proxyTariff.findUnique({ where: { id: proxyTariffIdBody } });
        if (!proxyTariff || !proxyTariff.enabled) return res.status(400).json({ message: "Прокси-тариф не найден" });
        proxyTariffIdToStore = proxyTariffIdBody;
        amountRounded = Math.round((amountBody ?? proxyTariff.price) * 100) / 100;
      } else if (singboxTariffIdBody) {
        const singboxTariff = await prisma.singboxTariff.findUnique({ where: { id: singboxTariffIdBody } });
        if (!singboxTariff || !singboxTariff.enabled) return res.status(400).json({ message: "Тариф Sing-box не найден" });
        singboxTariffIdToStore = singboxTariffIdBody;
        amountRounded = Math.round((amountBody ?? singboxTariff.price) * 100) / 100;
      } else {
        if (amountBody == null) return res.status(400).json({ message: "Укажите сумму" });
        amountRounded = Math.round(amountBody * 100) / 100;
      }
    }

    if (currencyUpper !== "RUB") {
      return res.status(400).json({ message: "Lava принимает только рубли. Выберите другой метод оплаты." });
    }
    if (amountRounded < 1) return res.status(400).json({ message: "Минимальная сумма платежа — 1 ₽" });

    // Персональная скидка админа — на продуктовые оплаты, не на чистое пополнение.
    const lavaIsTopup = !tariffIdToStore && !proxyTariffIdToStore && !singboxTariffIdToStore && !customBuildBody && !extraOption;
    if (!lavaIsTopup) {
      const originalBeforePersonal = amountRounded;
      const pd = await applyPersonalDiscount(amountRounded, clientId);
      if (pd.personalDiscountPercent > 0) {
        amountRounded = pd.amount;
        metadataObj = { ...metadataObj, personalDiscountPercent: pd.personalDiscountPercent, originalAmount: originalBeforePersonal };
      }
    }

    // Применяем промокод на скидку (не для опций и гибких тарифов)
    if (promoCodeStr?.trim() && !extraOption && !customBuildBody) {
      const result = await validatePromoCode(promoCodeStr.trim(), clientId);
      if (!result.ok) return res.status(result.status).json({ message: result.error });
      const promo = result.promo;
      if (promo.type !== "DISCOUNT") return res.status(400).json({ message: "Этот промокод не даёт скидку на оплату" });
      const originalAmount = (metadataObj as { originalAmount?: number }).originalAmount ?? amountRounded;
      if (promo.discountPercent && promo.discountPercent > 0) {
        amountRounded = Math.max(0, amountRounded - amountRounded * promo.discountPercent / 100);
      }
      if (promo.discountFixed && promo.discountFixed > 0) {
        amountRounded = Math.max(0, amountRounded - promo.discountFixed);
      }
      amountRounded = Math.round(amountRounded * 100) / 100;
      if (amountRounded <= 0) return res.status(400).json({ message: "Итоговая сумма не может быть 0" });
      metadataObj = { ...metadataObj, promoCodeId: promo.id, originalAmount };
    }

    const lavaSnap = lavaIsTopup ? await paymentSnapshotTopup(clientId, amountRounded) : await paymentSnapshotProduct(clientId, amountRounded);
    const lavaCharge = lavaSnap.amount;

    const orderId = randomUUID();
    const payment = await createPayment({
      data: asPaymentUncheckedCreate({
        clientId,
        orderId,
        amount: lavaSnap.amount,
        currency: currencyUpper,
        status: "PENDING",
        provider: "lava",
        tariffId: tariffIdToStore,
        tariffPriceOptionId: parsed.data.tariffPriceOptionId ?? null,
        deviceCount: parsed.data.deviceCount ?? null,
        proxyTariffId: proxyTariffIdToStore,
        singboxTariffId: singboxTariffIdToStore,
        // see yookassa endpoint for explanation.
        metadata: (() => {
          const meta = { ...metadataObj };
          if (asAdditional && tariffIdToStore) {
            meta.isAdditionalSubscription = true;
          }
          if (asGift) {
            meta.purchasedAsGift = true;
          }
          if (extendsSecondarySubId) {
            meta.extendsSecondarySubId = extendsSecondarySubId;
            // флаг удаления доп. устройств при активации.
            if (removeExtrasOnActivate === true) {
              meta.removeExtrasOnActivate = true;
            }
            // замена выбранного триала при покупке.
            if (parsed.data.replaceTrialSubId) {
              meta.replaceTrialSubId = parsed.data.replaceTrialSubId;
            }
          }
          return Object.keys(meta).length > 0 ? JSON.stringify(meta) : null;
        })(),
      }),
    });

    const serviceName = config.serviceName?.trim() || "STEALTHNET";
    const appUrl = (config.publicAppUrl || "").replace(/\/$/, "");
    const hookUrl = appUrl ? `${appUrl}/api/webhooks/lava` : undefined;
    const successUrl = appUrl ? `${appUrl}/cabinet/payment-wait?id=${payment.id}` : undefined;
    const failUrl = appUrl ? `${appUrl}/cabinet/payment-wait?id=${payment.id}` : undefined;

    const result = await createLavaInvoice({
      config: lavaConfig,
      amount: lavaCharge,
      orderId,
      hookUrl,
      successUrl,
      failUrl,
      expire: 300, // 5 часов — стандартный TTL Lava
      comment: `${serviceName} — ${payment.id}`.slice(0, 255),
    });

    if (!result.ok) {
      await prisma.payment.delete({ where: { id: payment.id } }).catch(() => {});
      return res.status(500).json({ message: result.error });
    }

    // Сохраняем invoiceId чтобы позже сверять с webhook'ом.
    await prisma.payment.update({ where: { id: payment.id }, data: { externalId: result.invoiceId } });

    const payUrl = await saveRedirectAndBuildUrl(payment.id, orderId, result.url, config.publicAppUrl);

    return res.status(201).json({
      paymentId: payment.id,
      payUrl,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[lava/create-payment]", message, err);
    return res.status(500).json({ message: message || "Ошибка создания платежа" });
  }
}));

// ═════════════════════════════════════════════════════════════════
// Lava.top — создание инвойса через product/offer модель.
// API: POST https://gate.lava.top/api/v2/invoice
// Auth: X-Api-Key header. У оператора в ЛК Lava.top создан product с
// несколькими offer'ами, мы передаём offerId (берём из тарифа.metadata
// или из system_settings.lavatop_default_offer_id) + email клиента.
// ═════════════════════════════════════════════════════════════════
const lavatopCreatePaymentSchema = z.object({
  amount: z.number().positive().optional(),
  currency: z.string().min(1).max(10).optional(),
  tariffId: z.string().min(1).optional(),
  tariffPriceOptionId: z.string().min(1).optional(),
  deviceCount: z.number().int().min(0).max(100).optional(),
  proxyTariffId: z.string().min(1).optional(),
  singboxTariffId: z.string().min(1).optional(),
  promoCode: z.string().max(50).optional(),
  /** Email клиента — Lava.top требует обязательно. Если не передан, берём из client.email */
  email: z.string().email().optional(),
  /** Кастомный offerId — переопределяет дефолтный из настроек */
  offerId: z.string().min(1).optional(),
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
clientPaymentsCryptoRouter.post("/lavatop/create-payment", requireRemnaPaymentOnline, asyncHandler(async (req, res) => {
  try {
    const clientId = (req as unknown as { clientId: string }).clientId;
    const parsed = lavatopCreatePaymentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Неверные параметры", errors: parsed.error.flatten() });
    const config = await getSystemConfig();
    const lavatopConfig = {
      apiKey: (config as { lavatopApiKey?: string | null }).lavatopApiKey ?? "",
      defaultOfferId: (config as { lavatopDefaultOfferId?: string | null }).lavatopDefaultOfferId ?? undefined,
    };
    if (!isLavatopConfigured(lavatopConfig)) return res.status(503).json({ message: "Lava.top не настроена" });
    const { extendsSecondarySubId, removeExtrasOnActivate, asGift, asAdditional } = parsed.data;

    const client = await prisma.client.findUnique({ where: { id: clientId }, select: { email: true } });
    // Lava.top требует валидный email. Если у клиента нет email (Telegram-only регистрация) —
    // генерим синтетический на основе домена сервиса (config.publicAppUrl). `.local` TLD
    // отклоняется как невалидный, поэтому используем реальный домен оператора.
    let buyerEmail = (parsed.data.email?.trim()) || client?.email?.trim() || "";
    if (!buyerEmail) {
      let domain = "lavatop-receipts.io";
      try {
        const u = new URL(config.publicAppUrl || "https://lavatop-receipts.io");
        if (u.hostname && u.hostname.includes(".") && !u.hostname.endsWith(".local")) domain = u.hostname;
      } catch { /* keep default */ }
      buyerEmail = `client-${clientId}@${domain}`;
    }

    const { amount: amountBody, currency: currencyBody, tariffId: tariffIdBody, proxyTariffId: proxyTariffIdBody, singboxTariffId: singboxTariffIdBody, promoCode: promoCodeStr, extraOption, customBuild: customBuildBody, offerId: customOfferId } = parsed.data;
    let amountRounded: number;
    let currencyUpper: string;
    let tariffIdToStore: string | null = null;
    let proxyTariffIdToStore: string | null = null;
    let singboxTariffIdToStore: string | null = null;
    let metadataObj: Record<string, unknown> = promoCodeStr ? { promoCode: promoCodeStr } : {};

    if (customBuildBody) {
      const cfg = getCustomBuildConfig(config);
      if (!cfg) return res.status(400).json({ message: "Гибкий тариф отключён" });
      const { days, devices, trafficGb } = customBuildBody;
      if (days > cfg.maxDays || devices > cfg.maxDevices) {
        return res.status(400).json({ message: `Дни: 1–${cfg.maxDays}, устройств: 1–${cfg.maxDevices}` });
      }
      const trafficLimitBytes =
        cfg.trafficMode === "per_gb" && trafficGb != null && trafficGb >= 0
          ? Math.round(trafficGb * 1024 ** 3)
          : null;
      amountRounded = days * cfg.pricePerDay + devices * cfg.pricePerDevice;
      if (cfg.trafficMode === "per_gb" && trafficGb != null && trafficGb > 0) amountRounded += trafficGb * cfg.pricePerGb;
      amountRounded = Math.round(amountRounded * 100) / 100;
      currencyUpper = cfg.currency.toUpperCase();
      metadataObj = {
        customBuild: {
          durationDays: days,
          deviceLimit: devices,
          trafficLimitBytes,
          internalSquadUuids: [cfg.squadUuid],
        },
      };
    } else if (extraOption) {
      const cfg = config as { sellOptionsEnabled?: boolean; sellOptionsTrafficEnabled?: boolean; sellOptionsTrafficProducts?: SellOptionTrafficProduct[]; sellOptionsDevicesEnabled?: boolean; sellOptionsDevicesProducts?: SellOptionDeviceProduct[]; sellOptionsServersEnabled?: boolean; sellOptionsServersProducts?: SellOptionServerProduct[] };
      if (!cfg.sellOptionsEnabled) return res.status(400).json({ message: "Продажа опций отключена" });
      if (extraOption.kind === "traffic") {
        const product = cfg.sellOptionsTrafficEnabled && cfg.sellOptionsTrafficProducts?.find((p) => p.id === extraOption.productId);
        if (!product) return res.status(400).json({ message: "Опция не найдена" });
        amountRounded = Math.round(product.price * 100) / 100;
        currencyUpper = product.currency.toUpperCase();
        metadataObj = { extraOption: { kind: "traffic", trafficBytes: Math.round(product.trafficGb * 1024 ** 3) } };
      } else if (extraOption.kind === "devices") {
        const product = cfg.sellOptionsDevicesEnabled && cfg.sellOptionsDevicesProducts?.find((p) => p.id === extraOption.productId);
        if (!product) return res.status(400).json({ message: "Опция не найдена" });
        // масштабируем цену для primary подписки
        const prorataCoef = extraOption.targetSubscriptionId ? await calculateDevicesProrataPriceCoefficient(extraOption.targetSubscriptionId) : await calculateDevicesProrataPriceCoefficientForPrimary(clientId);
        amountRounded = Math.floor(product.price * prorataCoef);
        currencyUpper = product.currency.toUpperCase();
        metadataObj = { extraOption: { kind: "devices", deviceCount: product.deviceCount, productPriceMonthly: product.price } };
      } else {
        const product = cfg.sellOptionsServersEnabled && cfg.sellOptionsServersProducts?.find((p) => p.id === extraOption.productId);
        if (!product) return res.status(400).json({ message: "Опция не найдена" });
        amountRounded = Math.round(product.price * 100) / 100;
        currencyUpper = product.currency.toUpperCase();
        metadataObj = { extraOption: { kind: "servers", squadUuid: product.squadUuid, ...((product.trafficGb ?? 0) > 0 && { trafficBytes: Math.round((product.trafficGb ?? 0) * 1024 ** 3) }) } };
      }
    } else {
      currencyUpper = (currencyBody ?? "RUB").toUpperCase();
      if (tariffIdBody) {
        const tariff = await prisma.tariff.findUnique({
          where: { id: tariffIdBody },
          include: { priceOptions: true },
        });
        if (!tariff) return res.status(400).json({ message: "Тариф не найден" });
        // кулдаун ПРОДЛЕНИЯ существующей подписки.
        // Применяется только при продлении (extendsSecondarySubId) — новые покупки этого
        // же тарифа как доп. подписок не блокируются.
        if ("extendsSecondarySubId" in parsed.data && parsed.data.extendsSecondarySubId) {
          const { checkSubscriptionRenewalCooldown } = await import("../tariff/tariff-cooldown.service.js");
          const cd = await checkSubscriptionRenewalCooldown(parsed.data.extendsSecondarySubId!);
          if (!cd.ok) return res.status(429).json({ message: cd.message, code: "TARIFF_COOLDOWN", daysLeft: cd.daysLeft });
        }
        tariffIdToStore = tariffIdBody;
        // честный расчёт цены тарифа.
        // Раньше: `amountBody ?? tariff.price` — игнорировались priceOption и extras (баг 149₽).
        // Теперь: priceOption + extras (новая покупка) или extrasMonthlyPrice (продление).
        let unitPriceCalc = tariff.price;
        let effectiveDaysCalc = tariff.durationDays;
        if (parsed.data.tariffPriceOptionId) {
          const opt = (tariff.priceOptions ?? []).find((p) => p.id === parsed.data.tariffPriceOptionId);
          if (opt) {
            unitPriceCalc = opt.price;
            effectiveDaysCalc = opt.durationDays;
          }
        }
        // доплата за СУЩЕСТВУЮЩИЕ extras подписки при продлении.
        // T-extras-universal: при «убрать устройства» (removeExtrasOnActivate) доплату НЕ берём —
        // устройства удаляются при активации, юзер видел базовую цену.
        if (parsed.data.extendsSecondarySubId && parsed.data.removeExtrasOnActivate !== true) {
          const sub = await prisma.subscription.findUnique({
            where: { id: parsed.data.extendsSecondarySubId },
            select: { extraDevicesMonthlyPrice: true },
          });
          const monthlyPrice = sub?.extraDevicesMonthlyPrice ?? 0;
          if (monthlyPrice > 0 && effectiveDaysCalc > 0) {
            unitPriceCalc += Math.round(monthlyPrice * (effectiveDaysCalc / 30) * 100) / 100;
          }
        }
        // НОВЫЕ устройства, выбранные при покупке — теперь для ЛЮБОЙ покупки
        // (новая/конверт/продление): activation их честно выдаёт, значит и цена честная.
        {
          const newExtrasCalc = Math.max(0, parsed.data.deviceCount ?? 0);
          if (newExtrasCalc > 0) {
            const { calcExtrasPrice } = await import("../tariff/extras-pricing.js");
            const r = calcExtrasPrice(
              tariff.pricePerExtraDevice ?? 0,
              newExtrasCalc,
              tariff.deviceDiscountTiers,
              effectiveDaysCalc,
            );
            unitPriceCalc += r.extrasTotal;
          }
        }
        amountRounded = Math.round(unitPriceCalc * 100) / 100;
      } else if (proxyTariffIdBody) {
        const proxyTariff = await prisma.proxyTariff.findUnique({ where: { id: proxyTariffIdBody } });
        if (!proxyTariff || !proxyTariff.enabled) return res.status(400).json({ message: "Прокси-тариф не найден" });
        proxyTariffIdToStore = proxyTariffIdBody;
        amountRounded = Math.round((amountBody ?? proxyTariff.price) * 100) / 100;
      } else if (singboxTariffIdBody) {
        const singboxTariff = await prisma.singboxTariff.findUnique({ where: { id: singboxTariffIdBody } });
        if (!singboxTariff || !singboxTariff.enabled) return res.status(400).json({ message: "Тариф Sing-box не найден" });
        singboxTariffIdToStore = singboxTariffIdBody;
        amountRounded = Math.round((amountBody ?? singboxTariff.price) * 100) / 100;
      } else {
        if (amountBody == null) return res.status(400).json({ message: "Укажите сумму" });
        amountRounded = Math.round(amountBody * 100) / 100;
      }
    }

    if (!["RUB", "USD", "EUR"].includes(currencyUpper)) {
      return res.status(400).json({ message: "Lava.top принимает только RUB / USD / EUR" });
    }
    if (amountRounded < 1) return res.status(400).json({ message: "Минимальная сумма платежа — 1" });

    // Персональная скидка / промокод
    const lavatopIsTopup = !tariffIdToStore && !proxyTariffIdToStore && !singboxTariffIdToStore && !customBuildBody && !extraOption;
    // Lava.top — только подписка на тариф (MONTHLY auto-renew). Топ-ап баланса
    // отклоняем — для пополнения используются другие провайдеры (LAVA, ЮKassa, ЮMoney и т.д.).
    if (lavatopIsTopup) {
      return res.status(400).json({ message: "Lava.top доступен только для покупки тарифа (подписка с авто-списанием). Для пополнения баланса используйте другой способ оплаты." });
    }
    if (!lavatopIsTopup) {
      const originalBeforePersonal = amountRounded;
      const pd = await applyPersonalDiscount(amountRounded, clientId);
      if (pd.personalDiscountPercent > 0) {
        amountRounded = pd.amount;
        metadataObj = { ...metadataObj, personalDiscountPercent: pd.personalDiscountPercent, originalAmount: originalBeforePersonal };
      }
    }
    if (promoCodeStr?.trim() && !extraOption && !customBuildBody) {
      const result = await validatePromoCode(promoCodeStr.trim(), clientId);
      if (!result.ok) return res.status(result.status).json({ message: result.error });
      const promo = result.promo;
      if (promo.type !== "DISCOUNT") return res.status(400).json({ message: "Этот промокод не даёт скидку на оплату" });
      const originalAmount = (metadataObj as { originalAmount?: number }).originalAmount ?? amountRounded;
      if (promo.discountPercent && promo.discountPercent > 0) amountRounded = Math.max(0, amountRounded - amountRounded * promo.discountPercent / 100);
      if (promo.discountFixed && promo.discountFixed > 0) amountRounded = Math.max(0, amountRounded - promo.discountFixed);
      amountRounded = Math.round(amountRounded * 100) / 100;
      if (amountRounded <= 0) return res.status(400).json({ message: "Итоговая сумма не может быть 0" });
      metadataObj = { ...metadataObj, promoCodeId: promo.id, originalAmount };
    }

    // Определяем offerId. Приоритет:
    //   1) req.body.offerId (явно передан клиентом — для расширенных интеграций)
    //   2) tariff.lavatopOfferId (per-tariff offer, заданный оператором в админке)
    //   3) settings.lavatop_default_offer_id (фолбэк для топ-апа баланса)
    let offerId = customOfferId?.trim() || "";
    if (!offerId && tariffIdToStore) {
      const tariff = await prisma.tariff.findUnique({
        where: { id: tariffIdToStore },
        select: { lavatopOfferId: true },
      });
      if (tariff?.lavatopOfferId?.trim()) offerId = tariff.lavatopOfferId.trim();
    }
    if (!offerId) offerId = (lavatopConfig.defaultOfferId ?? "").trim();
    if (!offerId) {
      return res.status(400).json({ message: "Lava.top: не задан offerId. Укажите его в редактировании тарифа (поле «Lava.top Offer ID») или Default Offer ID в настройках." });
    }

    const lavatopSnap = lavatopIsTopup ? await paymentSnapshotTopup(clientId, amountRounded) : await paymentSnapshotProduct(clientId, amountRounded);
    const orderId = randomUUID();
    const payment = await createPayment({
      data: asPaymentUncheckedCreate({
        clientId,
        orderId,
        amount: lavatopSnap.amount,
        currency: currencyUpper,
        status: "PENDING",
        provider: "lavatop",
        tariffId: tariffIdToStore,
        tariffPriceOptionId: parsed.data.tariffPriceOptionId ?? null,
        deviceCount: parsed.data.deviceCount ?? null,
        proxyTariffId: proxyTariffIdToStore,
        singboxTariffId: singboxTariffIdToStore,
        // see yookassa endpoint for explanation.
        metadata: (() => {
          const meta = { ...metadataObj };
          if (asAdditional && tariffIdToStore) {
            meta.isAdditionalSubscription = true;
          }
          if (asGift) {
            meta.purchasedAsGift = true;
          }
          if (extendsSecondarySubId) {
            meta.extendsSecondarySubId = extendsSecondarySubId;
            // флаг удаления доп. устройств при активации.
            if (removeExtrasOnActivate === true) {
              meta.removeExtrasOnActivate = true;
            }
            // замена выбранного триала при покупке.
            if (parsed.data.replaceTrialSubId) {
              meta.replaceTrialSubId = parsed.data.replaceTrialSubId;
            }
          }
          return Object.keys(meta).length > 0 ? JSON.stringify(meta) : null;
        })(),
      }),
    });

    const appUrl = (config.publicAppUrl || "").replace(/\/$/, "");
    const redirectUrl = appUrl ? `${appUrl}/cabinet/payment-wait?id=${payment.id}` : undefined;
    const failUrl = appUrl ? `${appUrl}/cabinet/payment-wait?id=${payment.id}` : undefined;

    // Для покупки тарифа используем подписку MONTHLY — Lava.top будет авто-списывать
    // ежемесячно, и при каждом списании webhook продлит тариф у клиента (см. lavatop
    // webhook handler: subscription.recurring.payment.success → activateTariffByPaymentId
    // создаёт новый payment + extends subscription).
    // Топ-ап баланса (без tariffId/proxyTariffId/etc) — разовая оплата ONE_TIME.
    const periodicity: "ONE_TIME" | "MONTHLY" = lavatopIsTopup ? "ONE_TIME" : "MONTHLY";

    const result = await createLavatopInvoice({
      config: lavatopConfig,
      email: buyerEmail,
      offerId,
      currency: currencyUpper as "RUB" | "USD" | "EUR",
      contractId: orderId,
      periodicity,
      redirectUrl,
      failUrl,
      buyerLanguage: "RU",
    });

    if (!result.ok) {
      await prisma.payment.delete({ where: { id: payment.id } }).catch(() => {});
      return res.status(500).json({ message: result.error });
    }

    await prisma.payment.update({ where: { id: payment.id }, data: { externalId: result.contractId } });
    const payUrl = await saveRedirectAndBuildUrl(payment.id, orderId, result.paymentUrl, config.publicAppUrl);
    return res.status(201).json({ paymentId: payment.id, payUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[lavatop/create-payment]", message, err);
    return res.status(500).json({ message: message || "Ошибка создания платежа Lava.top" });
  }
}));

// ═════════════════════════════════════════════════════════════════
// Overpay — платёжная форма (карты / СБП) через композит preflight.
// API: POST {apiUrl}/api/orders/preflight  (HTTP Basic Auth)
// Ответ: { id, resultUrl } — URL хостовой формы, куда редиректим клиента.
// Валюта — как указано в projectId (обычно RUB).
// ═════════════════════════════════════════════════════════════════
const overpayCreatePaymentSchema = z.object({
  amount: z.number().positive().optional(),
  currency: z.string().min(1).max(10).optional(),
  tariffId: z.string().min(1).optional(),
  tariffPriceOptionId: z.string().min(1).optional(),
  deviceCount: z.number().int().min(0).max(100).optional(),
  proxyTariffId: z.string().min(1).optional(),
  singboxTariffId: z.string().min(1).optional(),
  promoCode: z.string().max(50).optional(),
  // для единообразия с другими провайдерами — поддержка extendsSecondarySubId.
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
clientPaymentsCryptoRouter.post("/overpay/create-payment", requireRemnaPaymentOnline, asyncHandler(async (req, res) => {
  try {
    const clientId = (req as unknown as { clientId: string }).clientId;
    const parsed = overpayCreatePaymentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Неверные параметры", errors: parsed.error.flatten() });
    const config = await getSystemConfig();
    const overpayConfig = {
      apiUrl: (config as { overpayApiUrl?: string | null }).overpayApiUrl ?? "",
      projectId: (config as { overpayProjectId?: string | null }).overpayProjectId ?? "",
      login: (config as { overpayLogin?: string | null }).overpayLogin ?? "",
      password: (config as { overpayPassword?: string | null }).overpayPassword ?? "",
    };
    if (!isOverpayConfigured(overpayConfig)) return res.status(503).json({ message: "Overpay не настроен" });

    const {
      amount: amountBody,
      currency: currencyBody,
      tariffId: tariffIdBody,
      proxyTariffId: proxyTariffIdBody,
      singboxTariffId: singboxTariffIdBody,
      promoCode: promoCodeStr,
      extraOption,
      customBuild: customBuildBody,
    } = parsed.data;
    let amountRounded: number;
    let currencyUpper: string;
    let tariffIdToStore: string | null = null;
    let proxyTariffIdToStore: string | null = null;
    let singboxTariffIdToStore: string | null = null;
    let metadataObj: Record<string, unknown> = promoCodeStr ? { promoCode: promoCodeStr } : {};

    if (customBuildBody) {
      const cfg = getCustomBuildConfig(config);
      if (!cfg) return res.status(400).json({ message: "Гибкий тариф отключён" });
      const { days, devices, trafficGb } = customBuildBody;
      if (days > cfg.maxDays || devices > cfg.maxDevices) {
        return res.status(400).json({ message: `Дни: 1–${cfg.maxDays}, устройств: 1–${cfg.maxDevices}` });
      }
      const trafficLimitBytes =
        cfg.trafficMode === "per_gb" && trafficGb != null && trafficGb >= 0
          ? Math.round(trafficGb * 1024 ** 3)
          : null;
      amountRounded = days * cfg.pricePerDay + devices * cfg.pricePerDevice;
      if (cfg.trafficMode === "per_gb" && trafficGb != null && trafficGb > 0) amountRounded += trafficGb * cfg.pricePerGb;
      amountRounded = Math.round(amountRounded * 100) / 100;
      currencyUpper = cfg.currency.toUpperCase();
      metadataObj = {
        customBuild: {
          durationDays: days,
          deviceLimit: devices,
          trafficLimitBytes,
          internalSquadUuids: [cfg.squadUuid],
        },
      };
    } else if (extraOption) {
      const cfg = config as { sellOptionsEnabled?: boolean; sellOptionsTrafficEnabled?: boolean; sellOptionsTrafficProducts?: SellOptionTrafficProduct[]; sellOptionsDevicesEnabled?: boolean; sellOptionsDevicesProducts?: SellOptionDeviceProduct[]; sellOptionsServersEnabled?: boolean; sellOptionsServersProducts?: SellOptionServerProduct[] };
      if (!cfg.sellOptionsEnabled) return res.status(400).json({ message: "Продажа опций отключена" });
      if (extraOption.kind === "traffic") {
        const product = cfg.sellOptionsTrafficEnabled && cfg.sellOptionsTrafficProducts?.find((p) => p.id === extraOption.productId);
        if (!product) return res.status(400).json({ message: "Опция не найдена" });
        amountRounded = Math.round(product.price * 100) / 100;
        currencyUpper = product.currency.toUpperCase();
        metadataObj = { extraOption: { kind: "traffic", trafficBytes: Math.round(product.trafficGb * 1024 ** 3) } };
      } else if (extraOption.kind === "devices") {
        const product = cfg.sellOptionsDevicesEnabled && cfg.sellOptionsDevicesProducts?.find((p) => p.id === extraOption.productId);
        if (!product) return res.status(400).json({ message: "Опция не найдена" });
        // масштабируем цену для primary подписки
        const prorataCoef = extraOption.targetSubscriptionId ? await calculateDevicesProrataPriceCoefficient(extraOption.targetSubscriptionId) : await calculateDevicesProrataPriceCoefficientForPrimary(clientId);
        amountRounded = Math.floor(product.price * prorataCoef);
        currencyUpper = product.currency.toUpperCase();
        metadataObj = { extraOption: { kind: "devices", deviceCount: product.deviceCount, productPriceMonthly: product.price } };
      } else {
        const product = cfg.sellOptionsServersEnabled && cfg.sellOptionsServersProducts?.find((p) => p.id === extraOption.productId);
        if (!product) return res.status(400).json({ message: "Опция не найдена" });
        amountRounded = Math.round(product.price * 100) / 100;
        currencyUpper = product.currency.toUpperCase();
        metadataObj = { extraOption: { kind: "servers", squadUuid: product.squadUuid, ...((product.trafficGb ?? 0) > 0 && { trafficBytes: Math.round((product.trafficGb ?? 0) * 1024 ** 3) }) } };
      }
    } else {
      currencyUpper = (currencyBody ?? "RUB").toUpperCase();
      if (tariffIdBody) {
        const tariff = await prisma.tariff.findUnique({
          where: { id: tariffIdBody },
          include: { priceOptions: true },
        });
        if (!tariff) return res.status(400).json({ message: "Тариф не найден" });
        // кулдаун ПРОДЛЕНИЯ существующей подписки.
        // Применяется только при продлении (extendsSecondarySubId) — новые покупки этого
        // же тарифа как доп. подписок не блокируются.
        if ("extendsSecondarySubId" in parsed.data && parsed.data.extendsSecondarySubId) {
          const { checkSubscriptionRenewalCooldown } = await import("../tariff/tariff-cooldown.service.js");
          const cd = await checkSubscriptionRenewalCooldown(parsed.data.extendsSecondarySubId!);
          if (!cd.ok) return res.status(429).json({ message: cd.message, code: "TARIFF_COOLDOWN", daysLeft: cd.daysLeft });
        }
        tariffIdToStore = tariffIdBody;
        // честный расчёт цены тарифа.
        // Раньше: `amountBody ?? tariff.price` — игнорировались priceOption и extras (баг 149₽).
        // Теперь: priceOption + extras (новая покупка) или extrasMonthlyPrice (продление).
        let unitPriceCalc = tariff.price;
        let effectiveDaysCalc = tariff.durationDays;
        if (parsed.data.tariffPriceOptionId) {
          const opt = (tariff.priceOptions ?? []).find((p) => p.id === parsed.data.tariffPriceOptionId);
          if (opt) {
            unitPriceCalc = opt.price;
            effectiveDaysCalc = opt.durationDays;
          }
        }
        // доплата за СУЩЕСТВУЮЩИЕ extras подписки при продлении.
        // T-extras-universal: при «убрать устройства» (removeExtrasOnActivate) доплату НЕ берём —
        // устройства удаляются при активации, юзер видел базовую цену.
        if (parsed.data.extendsSecondarySubId && parsed.data.removeExtrasOnActivate !== true) {
          const sub = await prisma.subscription.findUnique({
            where: { id: parsed.data.extendsSecondarySubId },
            select: { extraDevicesMonthlyPrice: true },
          });
          const monthlyPrice = sub?.extraDevicesMonthlyPrice ?? 0;
          if (monthlyPrice > 0 && effectiveDaysCalc > 0) {
            unitPriceCalc += Math.round(monthlyPrice * (effectiveDaysCalc / 30) * 100) / 100;
          }
        }
        // НОВЫЕ устройства, выбранные при покупке — теперь для ЛЮБОЙ покупки
        // (новая/конверт/продление): activation их честно выдаёт, значит и цена честная.
        {
          const newExtrasCalc = Math.max(0, parsed.data.deviceCount ?? 0);
          if (newExtrasCalc > 0) {
            const { calcExtrasPrice } = await import("../tariff/extras-pricing.js");
            const r = calcExtrasPrice(
              tariff.pricePerExtraDevice ?? 0,
              newExtrasCalc,
              tariff.deviceDiscountTiers,
              effectiveDaysCalc,
            );
            unitPriceCalc += r.extrasTotal;
          }
        }
        amountRounded = Math.round(unitPriceCalc * 100) / 100;
      } else if (proxyTariffIdBody) {
        const proxyTariff = await prisma.proxyTariff.findUnique({ where: { id: proxyTariffIdBody } });
        if (!proxyTariff || !proxyTariff.enabled) return res.status(400).json({ message: "Прокси-тариф не найден" });
        proxyTariffIdToStore = proxyTariffIdBody;
        amountRounded = Math.round((amountBody ?? proxyTariff.price) * 100) / 100;
      } else if (singboxTariffIdBody) {
        const singboxTariff = await prisma.singboxTariff.findUnique({ where: { id: singboxTariffIdBody } });
        if (!singboxTariff || !singboxTariff.enabled) return res.status(400).json({ message: "Тариф Sing-box не найден" });
        singboxTariffIdToStore = singboxTariffIdBody;
        amountRounded = Math.round((amountBody ?? singboxTariff.price) * 100) / 100;
      } else {
        if (amountBody == null) return res.status(400).json({ message: "Укажите сумму" });
        amountRounded = Math.round(amountBody * 100) / 100;
      }
    }

    if (amountRounded < 1) return res.status(400).json({ message: "Минимальная сумма платежа — 1" });

    const overpayIsTopup = !tariffIdToStore && !proxyTariffIdToStore && !singboxTariffIdToStore && !customBuildBody && !extraOption;
    if (!overpayIsTopup) {
      const originalBeforePersonal = amountRounded;
      const pd = await applyPersonalDiscount(amountRounded, clientId);
      if (pd.personalDiscountPercent > 0) {
        amountRounded = pd.amount;
        metadataObj = { ...metadataObj, personalDiscountPercent: pd.personalDiscountPercent, originalAmount: originalBeforePersonal };
      }
    }

    if (promoCodeStr?.trim() && !extraOption && !customBuildBody) {
      const result = await validatePromoCode(promoCodeStr.trim(), clientId);
      if (!result.ok) return res.status(result.status).json({ message: result.error });
      const promo = result.promo;
      if (promo.type !== "DISCOUNT") return res.status(400).json({ message: "Этот промокод не даёт скидку на оплату" });
      const originalAmount = (metadataObj as { originalAmount?: number }).originalAmount ?? amountRounded;
      if (promo.discountPercent && promo.discountPercent > 0) {
        amountRounded = Math.max(0, amountRounded - amountRounded * promo.discountPercent / 100);
      }
      if (promo.discountFixed && promo.discountFixed > 0) {
        amountRounded = Math.max(0, amountRounded - promo.discountFixed);
      }
      amountRounded = Math.round(amountRounded * 100) / 100;
      if (amountRounded <= 0) return res.status(400).json({ message: "Итоговая сумма не может быть 0" });
      metadataObj = { ...metadataObj, promoCodeId: promo.id, originalAmount };
    }

    const opSnap = overpayIsTopup ? await paymentSnapshotTopup(clientId, amountRounded) : await paymentSnapshotProduct(clientId, amountRounded);
    const opCharge = opSnap.amount;

    const orderId = randomUUID();
    const payment = await createPayment({
      data: asPaymentUncheckedCreate({
        clientId,
        orderId,
        amount: opSnap.amount,
        currency: currencyUpper,
        status: "PENDING",
        provider: "overpay",
        tariffId: tariffIdToStore,
        tariffPriceOptionId: parsed.data.tariffPriceOptionId ?? null,
        deviceCount: parsed.data.deviceCount ?? null,
        proxyTariffId: proxyTariffIdToStore,
        singboxTariffId: singboxTariffIdToStore,
        metadata: Object.keys(metadataObj).length > 0 ? JSON.stringify(metadataObj) : null,
      }),
    });

    const serviceName = config.serviceName?.trim() || "STEALTHNET";
    const appUrl = (config.publicAppUrl || "").replace(/\/$/, "");
    const returnUrl = appUrl ? `${appUrl}/cabinet/payment-wait?id=${payment.id}` : undefined;

    const clientRow = await prisma.client.findUnique({
      where: { id: clientId },
      select: { email: true, telegramUsername: true },
    });

    const result = await createOverpayPayformOrder({
      config: overpayConfig,
      amount: opCharge,
      currency: currencyUpper,
      orderId,
      description: `${serviceName} — ${payment.id}`.slice(0, 200),
      returnUrl,
      livetimeMinutes: 300,
      client: clientRow
        ? {
            email: clientRow.email ?? null,
            name: clientRow.telegramUsername ?? null,
          }
        : undefined,
    });

    if (!result.ok) {
      await prisma.payment.delete({ where: { id: payment.id } }).catch(() => {});
      return res.status(500).json({ message: result.error });
    }

    await prisma.payment.update({ where: { id: payment.id }, data: { externalId: result.id } });

    const payUrl = await saveRedirectAndBuildUrl(payment.id, orderId, result.url, config.publicAppUrl);

    return res.status(201).json({
      paymentId: payment.id,
      payUrl,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[overpay/create-payment]", message, err);
    return res.status(500).json({ message: message || "Ошибка создания платежа" });
  }
}));
