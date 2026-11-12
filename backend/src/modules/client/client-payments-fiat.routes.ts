import { Router, type Request, type Response } from "express";
import { createHmac, randomUUID } from "crypto";
import { z } from "zod";
import { env } from "../../config/index.js";
import { prisma, createPayment, asPaymentUncheckedCreate } from "../../db.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { cloudTrialUsed } from "../cloudpayments/cloudpayments-trial.js";
import { prepareCloudCheckout } from "../cloudpayments/cloudpayments.routes.js";
import { getSystemConfig, validatePromoCode, type PromoCodeRow, type SellOptionTrafficProduct, type SellOptionDeviceProduct, type SellOptionServerProduct } from "./client.service.js";
import { requireRemnaPaymentOnline } from "./client.middleware.js";
import { createPlategaTransaction, isPlategaConfigured } from "../platega/platega.service.js";
import { activateTariffForClient, activateTariffByPaymentId } from "../tariff/tariff-activation.service.js";
import { saveRedirectAndBuildUrl } from "../payment-redirect/payment-redirect.util.js";
import { buildPaymentIntentMetadata } from "../payment/payment-intent.js";
import { getAuthUrl, exchangeCodeForToken, requestPayment, processPayment } from "../yoomoney/yoomoney.service.js";
import { createYookassaPayment } from "../yookassa/yookassa.service.js";
import { applyPersonalDiscount } from "./personal-discount.js";
import { paymentSnapshotTopup, paymentSnapshotProduct } from "../bot/bot.service.js";
import { toClientShape } from "./client-auth.routes.js";
import { calculateDevicesProrataPriceCoefficient, calculateDevicesProrataPriceCoefficientForPrimary, getCustomBuildConfig, heleketCreatePaymentSchema } from "./client-checkout.util.js";

function yoomoneyStateSign(clientId: string): string {
  const payload = JSON.stringify({ clientId });
  const sig = createHmac("sha256", env.JWT_SECRET).update(payload).digest("base64url");
  return Buffer.from(payload, "utf8").toString("base64url") + "." + sig;
}
function yoomoneyStateVerify(state: string): string | null {
  const dot = state.indexOf(".");
  if (dot <= 0) return null;
  const payloadB64 = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as { clientId?: string };
    if (!payload?.clientId) return null;
    const expected = createHmac("sha256", env.JWT_SECRET).update(JSON.stringify({ clientId: payload.clientId })).digest("base64url");
    if (sig !== expected) return null;
    return payload.clientId;
  } catch {
    return null;
  }
}


export async function handleYoomoneyCallback(req: Request, res: Response) {
  const code = typeof req.query.code === "string" ? req.query.code : null;
  const state = typeof req.query.state === "string" ? req.query.state : null;
  const config = await getSystemConfig();
  const appUrl = (config.publicAppUrl || "").replace(/\/$/, "");
  const redirectFail = appUrl ? `${appUrl}/cabinet?yoomoney=error` : "/";
  if (!code?.trim() || !state?.trim()) {
    return res.redirect(302, redirectFail);
  }
  const clientId = yoomoneyStateVerify(state);
  if (!clientId) {
    return res.redirect(302, redirectFail);
  }
  const redirectUri = appUrl ? `${appUrl}/api/client/yoomoney/callback` : "";
  if (!redirectUri) {
    return res.redirect(302, redirectFail);
  }
  const result = await exchangeCodeForToken({
    code: code.trim(),
    clientId: config.yoomoneyClientId || "",
    redirectUri,
    clientSecret: config.yoomoneyClientSecret,
  });
  if ("error" in result) {
    return res.redirect(302, appUrl ? `${appUrl}/cabinet?yoomoney=error&reason=${encodeURIComponent(result.error)}` : redirectFail);
  }
  await prisma.client.update({
    where: { id: clientId },
    data: { yoomoneyAccessToken: result.access_token },
  });
  const redirectOk = appUrl ? `${appUrl}/cabinet?yoomoney=connected` : redirectFail;
  return res.redirect(302, redirectOk);
}

export const clientPaymentsFiatRouter = Router();

const createPlategaPaymentSchema = z.object({
  amount: z.number().positive().optional(),
  currency: z.string().min(1).max(10).optional(),
  paymentMethod: z.number().int().min(2).max(13),
  description: z.string().max(500).optional(),
  tariffId: z.string().min(1).optional(),
  tariffPriceOptionId: z.string().min(1).optional(),
  deviceCount: z.number().int().min(0).max(100).optional(),
  proxyTariffId: z.string().min(1).optional(),
  singboxTariffId: z.string().min(1).optional(),
  promoCode: z.string().max(50).optional(),
  // покупка как доп. подписка — см. yookassa-схему ниже.
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
  extraOption: z.object({ kind: z.enum(["traffic", "devices", "servers"]), productId: z.string().min(1), targetSubscriptionId: z.string().min(1).optional() }).optional(),
  customBuild: z.object({ days: z.number().int().min(1).max(360), devices: z.number().int().min(1).max(20), trafficGb: z.number().min(0).nullable().optional() }).optional(),
});
clientPaymentsFiatRouter.post("/payments/platega", requireRemnaPaymentOnline, asyncHandler(async (req, res) => {
  const clientId = (req as unknown as { clientId: string }).clientId;
  const parsed = createPlategaPaymentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Проверьте введённые данные", errors: parsed.error.flatten() });
  }
  const { amount: originalAmount, currency, paymentMethod, description, tariffId, proxyTariffId, singboxTariffId, promoCode: promoCodeStr, extraOption, customBuild: customBuildBody } = parsed.data;

  let tariffIdToStore: string | null = null;
  let proxyTariffIdToStore: string | null = null;
  let singboxTariffIdToStore: string | null = null;
  let finalAmount: number;
  let currencyToUse: string;
  let metadataExtra: Record<string, unknown> | null = null;

  if (customBuildBody) {
    const configForCb = await getSystemConfig();
    const cfg = getCustomBuildConfig(configForCb);
    if (!cfg) return res.status(400).json({ message: "Гибкий тариф отключён" });
    let { days, devices, trafficGb } = customBuildBody;
    if (days > cfg.maxDays || devices > cfg.maxDevices) {
      return res.status(400).json({ message: `Дни: 1–${cfg.maxDays}, устройств: 1–${cfg.maxDevices}` });
    }
    const trafficLimitBytes =
      cfg.trafficMode === "per_gb" && trafficGb != null && trafficGb >= 0
        ? Math.round(trafficGb * 1024 ** 3)
        : null;
    finalAmount = days * cfg.pricePerDay + devices * cfg.pricePerDevice;
    if (cfg.trafficMode === "per_gb" && trafficGb != null && trafficGb > 0) finalAmount += trafficGb * cfg.pricePerGb;
    finalAmount = Math.round(finalAmount * 100) / 100;
    currencyToUse = cfg.currency.toUpperCase();
    metadataExtra = {
      customBuild: {
        durationDays: days,
        deviceLimit: devices,
        trafficLimitBytes,
        internalSquadUuids: [cfg.squadUuid],
      },
    };
  } else if (extraOption) {
    const config = await getSystemConfig();
    if (!(config as { sellOptionsEnabled?: boolean }).sellOptionsEnabled) {
      return res.status(400).json({ message: "Продажа опций отключена" });
    }
    const cfg = config as {
      sellOptionsTrafficEnabled?: boolean; sellOptionsTrafficProducts?: SellOptionTrafficProduct[];
      sellOptionsDevicesEnabled?: boolean; sellOptionsDevicesProducts?: SellOptionDeviceProduct[];
      sellOptionsServersEnabled?: boolean; sellOptionsServersProducts?: SellOptionServerProduct[];
    };
    if (extraOption.kind === "traffic") {
      const product = cfg.sellOptionsTrafficEnabled && cfg.sellOptionsTrafficProducts?.find((p) => p.id === extraOption.productId);
      if (!product) return res.status(400).json({ message: "Опция не найдена" });
      finalAmount = product.price;
      currencyToUse = product.currency.toUpperCase();
      metadataExtra = { extraOption: { kind: "traffic", trafficBytes: Math.round(product.trafficGb * 1024 ** 3) } };
    } else if (extraOption.kind === "devices") {
      const product = cfg.sellOptionsDevicesEnabled && cfg.sellOptionsDevicesProducts?.find((p) => p.id === extraOption.productId);
      if (!product) return res.status(400).json({ message: "Опция не найдена" });
      // для primary подписки (sub_index=0) — масштабируем цену по оставшимся дням
      const clientForProrata = await prisma.client.findUnique({
        where: { id: clientId },
        select: { remnawaveUuid: true },
      });
      let prorataCoef = 1;
      if (clientForProrata?.remnawaveUuid) {
        const primarySub = await prisma.subscription.findFirst({
          where: { ownerId: clientId, remnawaveUuid: clientForProrata.remnawaveUuid },
          select: { expireAt: true },
        });
        if (primarySub?.expireAt) {
          const daysLeft = (primarySub.expireAt.getTime() - Date.now()) / 86_400_000;
          prorataCoef = Math.max(1, daysLeft) / 30;
        }
      }
      finalAmount = Math.floor(product.price * prorataCoef);
      currencyToUse = product.currency.toUpperCase();
      metadataExtra = { extraOption: { kind: "devices", deviceCount: product.deviceCount, productPriceMonthly: product.price } };
    } else {
      const product = cfg.sellOptionsServersEnabled && cfg.sellOptionsServersProducts?.find((p) => p.id === extraOption.productId);
      if (!product) return res.status(400).json({ message: "Опция не найдена" });
      finalAmount = product.price;
      currencyToUse = product.currency.toUpperCase();
      metadataExtra = {
        extraOption: {
          kind: "servers",
          squadUuid: product.squadUuid,
          ...((product.trafficGb ?? 0) > 0 && { trafficBytes: Math.round((product.trafficGb ?? 0) * 1024 ** 3) }),
        },
      };
    }
    if (parsed.data.extraOption?.targetSubscriptionId) {
      metadataExtra = { ...metadataExtra, targetSubscriptionId: parsed.data.extraOption.targetSubscriptionId };
    }
  } else {
    // Если передан tariffId / proxyTariffId / singboxTariffId — цену+валюту берём
    // из тарифа в БД (приоритет: tariffPriceOption → tariff). Если ни одного
    // продуктового id не передано — это чистый top-up балансом, тогда обязателен
    // явный amount+currency.
    finalAmount = originalAmount ?? 0;
    currencyToUse = (currency ?? "").toUpperCase();
    if (tariffId) {
      const tariff = await prisma.tariff.findUnique({
        where: { id: tariffId },
        include: { priceOptions: true },
      });
      if (!tariff) return res.status(400).json({ message: "Тариф не найден" });
      // кулдаун ПРОДЛЕНИЯ существующей подписки.
      // Применяется только при продлении (extendsSecondarySubId) — новые покупки этого тарифа
      // (как доп. подписки) не ограничиваются.
      if (parsed.data.extendsSecondarySubId) {
        const { checkSubscriptionRenewalCooldown } = await import("../tariff/tariff-cooldown.service.js");
        const cd = await checkSubscriptionRenewalCooldown(parsed.data.extendsSecondarySubId);
        if (!cd.ok) return res.status(429).json({ message: cd.message, code: "TARIFF_COOLDOWN", daysLeft: cd.daysLeft });
      }
      tariffIdToStore = tariffId;
      // Цена: priceOption если выбран, иначе tariff.price
      let unitPrice = tariff.price;
      let effectiveDays = tariff.durationDays;
      if (parsed.data.tariffPriceOptionId) {
        const opt = (tariff.priceOptions ?? []).find((p) => p.id === parsed.data.tariffPriceOptionId);
        if (opt) {
          unitPrice = opt.price;
          effectiveDays = opt.durationDays;
        }
      }
      // при продлении добавляем
      // extraDevicesMonthlyPrice × (days/30). Цена устройств хранится в подписке
      // (накапливается из sell-options-пакетов при докупке). НЕ из тарифа.
      // T-extras-universal: при «убрать устройства» доплату не берём.
      if (parsed.data.extendsSecondarySubId && parsed.data.removeExtrasOnActivate !== true) {
        const sub = await prisma.subscription.findUnique({
          where: { id: parsed.data.extendsSecondarySubId },
          select: { extraDevicesMonthlyPrice: true },
        });
        const monthlyPrice = sub?.extraDevicesMonthlyPrice ?? 0;
        if (monthlyPrice > 0 && effectiveDays > 0) {
          unitPrice += Math.round(monthlyPrice * (effectiveDays / 30) * 100) / 100;
        }
      }
      // НОВЫЕ устройства, выбранные при покупке — для ЛЮБОЙ покупки
      // (новая/конверт/продление): tariff.pricePerExtraDevice × deviceCount × tier × (days/30).
      const newExtras = Math.max(0, parsed.data.deviceCount ?? 0);
      if (newExtras > 0) {
        const { calcExtrasPrice } = await import("../tariff/extras-pricing.js");
        const r = calcExtrasPrice(
          tariff.pricePerExtraDevice ?? 0,
          newExtras,
          tariff.deviceDiscountTiers,
          effectiveDays,
        );
        unitPrice += r.extrasTotal;
      }
      // Бэк сам считает финальную сумму — игнорируем фронтовый originalAmount
      // (защита от подделки цены).
      finalAmount = unitPrice;
      if (!currency) currencyToUse = tariff.currency.toUpperCase();
    }
    if (proxyTariffId) {
      const proxyTariff = await prisma.proxyTariff.findUnique({ where: { id: proxyTariffId } });
      if (!proxyTariff || !proxyTariff.enabled) return res.status(400).json({ message: "Прокси-тариф не найден" });
      proxyTariffIdToStore = proxyTariffId;
      if (originalAmount == null) finalAmount = proxyTariff.price;
      if (!currency) currencyToUse = proxyTariff.currency.toUpperCase();
    }
    if (singboxTariffId) {
      const singboxTariff = await prisma.singboxTariff.findUnique({ where: { id: singboxTariffId } });
      if (!singboxTariff || !singboxTariff.enabled) return res.status(400).json({ message: "Тариф Sing-box не найден" });
      singboxTariffIdToStore = singboxTariffId;
      if (originalAmount == null) finalAmount = singboxTariff.price;
      if (!currency) currencyToUse = singboxTariff.currency.toUpperCase();
    }
    // После всех попыток — если до сих пор пусто, значит ни тариф ни amount не пришли = top-up без суммы
    if (finalAmount <= 0 || !currencyToUse) {
      return res.status(400).json({ message: "Укажите сумму и валюту" });
    }
  }

  if (finalAmount < 1) {
    return res.status(400).json({ message: "Минимальная сумма платежа — 1" });
  }

  // Персональная скидка клиента (админ мог выдать). Применяется к продуктовым
  // оплатам (тариф/прокси/singbox/кастомный билд/опции), но НЕ к чистому пополнению.
  const isTopupOnlyPlatega = !tariffIdToStore && !proxyTariffIdToStore && !singboxTariffIdToStore && !customBuildBody && !extraOption;
  let personalDiscountPercent = 0;
  if (!isTopupOnlyPlatega) {
    const pd = await applyPersonalDiscount(finalAmount, clientId);
    if (pd.personalDiscountPercent > 0) {
      finalAmount = pd.amount;
      personalDiscountPercent = pd.personalDiscountPercent;
    }
  }

  // Применяем промокод на скидку (не для опций по умолчанию, можно разрешить — тогда скидка с опции)
  let promoCodeRecord: { id: string } | null = null;
  if (promoCodeStr?.trim() && !extraOption) {
    const result = await validatePromoCode(promoCodeStr.trim(), clientId);
    if (!result.ok) return res.status(result.status).json({ message: result.error });
    const promo = result.promo;
    if (promo.type !== "DISCOUNT") return res.status(400).json({ message: "Этот промокод не даёт скидку на оплату" });

    if (promo.discountPercent && promo.discountPercent > 0) {
      finalAmount = Math.max(0, finalAmount - finalAmount * promo.discountPercent / 100);
    }
    if (promo.discountFixed && promo.discountFixed > 0) {
      finalAmount = Math.max(0, finalAmount - promo.discountFixed);
    }
    finalAmount = Math.round(finalAmount * 100) / 100;
    if (finalAmount <= 0) return res.status(400).json({ message: "Итоговая сумма не может быть 0" });
    promoCodeRecord = promo;
  }

  const config = await getSystemConfig();
  const plategaConfig = {
    merchantId: config.plategaMerchantId || "",
    secret: config.plategaSecret || "",
  };
  if (!isPlategaConfigured(plategaConfig)) {
    return res.status(503).json({ message: "Platega не настроен" });
  }

  const methods = config.plategaMethods || [];
  const allowed = methods.find((m) => m.id === paymentMethod && m.enabled);
  if (!allowed) {
    return res.status(400).json({ message: "Метод оплаты недоступен" });
  }

  const serviceName = config.serviceName?.trim() || "STEALTHNET";
  const orderId = randomUUID();
  const paymentKind = tariffIdToStore ? "tariff" : proxyTariffIdToStore ? "proxy" : singboxTariffIdToStore ? "singbox" : metadataExtra ? "option" : "topup";
  const appUrl = (config.publicAppUrl || "").replace(/\/$/, "");
  // добавляем tg:<id> в description для удобного поиска
  // в кабинете Plategá (зеркалит логику YooKassa/CryptoPay).
  const plategaClient = await prisma.client.findUnique({
    where: { id: clientId },
    select: { telegramId: true, email: true },
  });
  const plategaTgSuffix = plategaClient?.telegramId ? ` tg:${plategaClient.telegramId}` : "";
  const plategaDescription = (tariffIdToStore
    ? `Тариф ${serviceName} #${orderId}`
    : proxyTariffIdToStore
      ? `Прокси ${serviceName} #${orderId}`
      : singboxTariffIdToStore
        ? `Доступы ${serviceName} #${orderId}`
        : metadataExtra
      ? `Опция ${serviceName} #${orderId}`
      : `Пополнение баланса ${serviceName} #${orderId}`) + plategaTgSuffix;

  const personalDiscountMeta = personalDiscountPercent > 0 ? { personalDiscountPercent } : null;
  const paymentMetaObj: Record<string, unknown> = {};
  if (metadataExtra) Object.assign(paymentMetaObj, metadataExtra);
  if (promoCodeRecord) {
    paymentMetaObj.promoCodeId = promoCodeRecord.id;
    paymentMetaObj.originalAmount = metadataExtra ? finalAmount : (originalAmount ?? finalAmount);
  }
  if (personalDiscountMeta) Object.assign(paymentMetaObj, personalDiscountMeta);
  // Активация читает намерение только из metadata. Продление имеет приоритет над
  // флагом новой подписки, чтобы один клик не мог породить параллельный доступ.
  Object.assign(paymentMetaObj, buildPaymentIntentMetadata({
    asAdditional: parsed.data.asAdditional && !!tariffIdToStore,
    asGift: parsed.data.asGift,
    extendsSecondarySubId: parsed.data.extendsSecondarySubId,
    removeExtrasOnActivate: parsed.data.removeExtrasOnActivate,
    replaceTrialSubId: parsed.data.replaceTrialSubId,
  }));
  const paymentMeta = Object.keys(paymentMetaObj).length > 0 ? paymentMetaObj : null;
  const snap = isTopupOnlyPlatega ? await paymentSnapshotTopup(clientId, finalAmount) : await paymentSnapshotProduct(clientId, finalAmount);
  const payment = await createPayment({
    data: asPaymentUncheckedCreate({
      clientId,
      orderId,
      amount: snap.amount,
      currency: currencyToUse,
      status: "PENDING",
      provider: "platega",
      tariffId: tariffIdToStore,
      tariffPriceOptionId: parsed.data.tariffPriceOptionId ?? null,
      deviceCount: parsed.data.deviceCount ?? null,
      proxyTariffId: proxyTariffIdToStore,
      singboxTariffId: singboxTariffIdToStore,
      metadata: paymentMeta ? JSON.stringify(paymentMeta) : null,
    }),
  });

  // T-pay-wait: после оплаты/отмены Platega ведём на страницу ожидания (polling + API-reconciliation),
  // НЕ на дашборд. id=payment.id — фронт поллит статус именно этого платежа.
  const returnUrl = appUrl ? `${appUrl}/cabinet/payment-wait?id=${payment.id}&kind=${paymentKind}` : "";
  const failedUrl = appUrl ? `${appUrl}/cabinet/payment-wait?id=${payment.id}&kind=${paymentKind}` : "";

  const result = await createPlategaTransaction(plategaConfig, {
    amount: snap.amount,
    currency: currencyToUse,
    orderId,
    paymentMethod,
    returnUrl,
    failedUrl,
    description: plategaDescription,
    email: plategaClient?.email,
  });

  if ("error" in result) {
    await prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED" } });
    return res.status(502).json({ message: result.error });
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: { externalId: result.transactionId },
  });

  const paymentUrl = await saveRedirectAndBuildUrl(payment.id, orderId, result.paymentUrl, config.publicAppUrl);

  return res.status(201).json({
    paymentUrl,
    orderId,
    paymentId: payment.id,
    discountApplied: promoCodeRecord ? true : false,
    finalAmount: snap.amount,
  });
}));

// ——— ЮMoney: пополнение баланса ———

clientPaymentsFiatRouter.get("/yoomoney/auth-url", async (req, res) => {
  const clientId = (req as unknown as { clientId: string }).clientId;
  const config = await getSystemConfig();
  const appUrl = (config.publicAppUrl || "").replace(/\/$/, "");
  if (!config.yoomoneyClientId?.trim() || !appUrl) {
    return res.status(503).json({ message: "ЮMoney не настроен или не указан URL приложения" });
  }
  const redirectUri = `${appUrl}/api/client/yoomoney/callback`;
  const state = yoomoneyStateSign(clientId);
  const url = getAuthUrl({ clientId: config.yoomoneyClientId, redirectUri, state });
  return res.json({ url });
});

const yoomoneyRequestTopupSchema = z.object({ amount: z.number().positive().max(1e7) });
clientPaymentsFiatRouter.post("/yoomoney/request-topup", asyncHandler(async (req, res) => {
  const client = (req as unknown as { client: { id: string; yoomoneyAccessToken?: string | null } }).client;
  const parsed = yoomoneyRequestTopupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Укажите сумму", errors: parsed.error.flatten() });
  const { amount } = parsed.data;
  if (!client.yoomoneyAccessToken?.trim()) {
    return res.status(400).json({ message: "Сначала подключите кошелёк ЮMoney" });
  }
  const config = await getSystemConfig();
  const receiver = config.yoomoneyReceiverWallet?.trim();
  if (!receiver) return res.status(503).json({ message: "ЮMoney не настроен" });

  const serviceName = config.serviceName?.trim() || "STEALTHNET";
  const amountRounded = Math.round(amount * 100) / 100;
  const orderId = randomUUID();
  const topSnap = await paymentSnapshotTopup(client.id, amountRounded);
  const payment = await createPayment({
    data: asPaymentUncheckedCreate({
      clientId: client.id,
      orderId,
      amount: topSnap.amount,
      currency: "RUB",
      status: "PENDING",
      provider: "yoomoney",
      metadata: JSON.stringify({ type: "balance_topup" }),
    }),
  });

  const result = await requestPayment(client.yoomoneyAccessToken, {
    to: receiver,
    amount_due: topSnap.amount,
    label: payment.id,
    message: `Пополнение баланса ${serviceName}. Заказ ${orderId}`,
    comment: `Пополнение баланса`,
  });

  if (result.status === "refused") {
    await prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED" } });
    return res.status(400).json({ message: result.error_description ?? result.error });
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: { metadata: JSON.stringify({ type: "balance_topup", request_id: result.request_id }) },
  });

  return res.json({
    paymentId: payment.id,
    request_id: result.request_id,
    money_source: result.money_source,
    contract_amount: result.contract_amount,
  });
}));

const yoomoneyProcessPaymentSchema = z.object({
  paymentId: z.string().min(1),
  request_id: z.string().min(1),
  money_source: z.string().optional(),
  csc: z.string().max(10).optional(),
});
clientPaymentsFiatRouter.post("/yoomoney/process-payment", async (req, res) => {
  const client = (req as unknown as { client: { id: string; yoomoneyAccessToken?: string | null } }).client;
  const parsed = yoomoneyProcessPaymentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Неверные параметры", errors: parsed.error.flatten() });
  const { paymentId, request_id, money_source, csc } = parsed.data;

  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, clientId: client.id, status: "PENDING", provider: "yoomoney" },
  });
  if (!payment) return res.status(404).json({ message: "Платёж не найден или уже обработан" });
  if (!client.yoomoneyAccessToken?.trim()) return res.status(400).json({ message: "Кошелёк ЮMoney не подключён" });

  const result = await processPayment(client.yoomoneyAccessToken, { request_id, money_source, csc });

  if (result.status === "in_progress") {
    return res.status(202).json({ status: "in_progress", message: "Платёж обрабатывается, повторите запрос через минуту" });
  }
  if (result.status === "ext_auth_required") {
    return res.status(200).json({ status: "ext_auth_required", acs_uri: result.acs_uri, acs_params: result.acs_params });
  }
  if (result.status === "refused") {
    return res.status(400).json({ message: result.error });
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: "PAID", paidAt: new Date(), externalId: result.payment_id ?? undefined },
  });
  const updated = await prisma.client.update({
    where: { id: client.id },
    data: { balance: { increment: payment.amount } },
    select: { balance: true },
  });

  const { distributeReferralRewards } = await import("../referral/referral.service.js");
  await distributeReferralRewards(payment.id).catch((e) => console.error("[referral] yoomoney process-payment:", e));

  return res.json({ message: "Баланс пополнен", newBalance: updated.balance });
});

// ——— ЮMoney: форма перевода (оплата картой). Пополнение баланса, тариф или опция ———
const yoomoneyFormPaymentSchema = z.object({
  amount: z.number().positive().max(1e7).optional(),
  paymentType: z.enum(["PC", "AC"]), // PC = с кошелька, AC = с карты
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
  extraOption: z.object({ kind: z.enum(["traffic", "devices", "servers"]), productId: z.string().min(1), targetSubscriptionId: z.string().min(1).optional() }).optional(),
  customBuild: z.object({ days: z.number().int().min(1).max(360), devices: z.number().int().min(1).max(20), trafficGb: z.number().min(0).nullable().optional() }).optional(),
});
clientPaymentsFiatRouter.post("/yoomoney/create-form-payment", requireRemnaPaymentOnline, asyncHandler(async (req, res) => {
  const clientId = (req as unknown as { clientId: string }).clientId;
  const parsed = yoomoneyFormPaymentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Укажите сумму и способ оплаты", errors: parsed.error.flatten() });
  const { amount: amountBody, paymentType, tariffId: tariffIdBody, proxyTariffId: proxyTariffIdBody, singboxTariffId: singboxTariffIdBody, promoCode: promoCodeStr, extraOption, customBuild: customBuildBody } = parsed.data;
  const config = await getSystemConfig();
  const receiver = config.yoomoneyReceiverWallet?.trim();
  if (!receiver) return res.status(503).json({ message: "ЮMoney не настроен" });

  let tariffIdToStore: string | null = null;
  let proxyTariffIdToStore: string | null = null;
  let singboxTariffIdToStore: string | null = null;
  let amountRounded: number;
  let metadataObj: Record<string, unknown> = { paymentType };
  let yoomoneyPromoRecord: PromoCodeRow | null = null;
  let yoomoneyOriginalAmount: number | null = null;

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
    metadataObj = {
      paymentType,
      customBuild: {
        durationDays: days,
        deviceLimit: devices,
        trafficLimitBytes,
        internalSquadUuids: [cfg.squadUuid],
      },
    };
  } else if (extraOption) {
    if (!(config as { sellOptionsEnabled?: boolean }).sellOptionsEnabled) {
      return res.status(400).json({ message: "Продажа опций отключена" });
    }
    const cfg = config as {
      sellOptionsTrafficEnabled?: boolean; sellOptionsTrafficProducts?: SellOptionTrafficProduct[];
      sellOptionsDevicesEnabled?: boolean; sellOptionsDevicesProducts?: SellOptionDeviceProduct[];
      sellOptionsServersEnabled?: boolean; sellOptionsServersProducts?: SellOptionServerProduct[];
    };
    if (extraOption.kind === "traffic") {
      const product = cfg.sellOptionsTrafficEnabled && cfg.sellOptionsTrafficProducts?.find((p) => p.id === extraOption.productId);
      if (!product) return res.status(400).json({ message: "Опция не найдена" });
      amountRounded = Math.round(product.price * 100) / 100;
      metadataObj = { paymentType, extraOption: { kind: "traffic", trafficBytes: Math.round(product.trafficGb * 1024 ** 3) } };
    } else if (extraOption.kind === "devices") {
      const product = cfg.sellOptionsDevicesEnabled && cfg.sellOptionsDevicesProducts?.find((p) => p.id === extraOption.productId);
      if (!product) return res.status(400).json({ message: "Опция не найдена" });
      // масштабируем цену для primary подписки
      const prorataCoef = extraOption.targetSubscriptionId ? await calculateDevicesProrataPriceCoefficient(extraOption.targetSubscriptionId) : await calculateDevicesProrataPriceCoefficientForPrimary(clientId);
      amountRounded = Math.floor(product.price * prorataCoef);
      metadataObj = { paymentType, extraOption: { kind: "devices", deviceCount: product.deviceCount, productPriceMonthly: product.price } };
    } else {
      const product = cfg.sellOptionsServersEnabled && cfg.sellOptionsServersProducts?.find((p) => p.id === extraOption.productId);
      if (!product) return res.status(400).json({ message: "Опция не найдена" });
      amountRounded = Math.round(product.price * 100) / 100;
      metadataObj = {
        paymentType,
        extraOption: {
          kind: "servers",
          squadUuid: product.squadUuid,
          ...((product.trafficGb ?? 0) > 0 && { trafficBytes: Math.round((product.trafficGb ?? 0) * 1024 ** 3) }),
        },
      };
    }
    if (parsed.data.extraOption?.targetSubscriptionId) {
      metadataObj = { ...metadataObj, targetSubscriptionId: parsed.data.extraOption.targetSubscriptionId };
    }
  } else {
    if (amountBody == null && !tariffIdBody && !proxyTariffIdBody && !singboxTariffIdBody) return res.status(400).json({ message: "Укажите сумму" });
    if (tariffIdBody) {
      const tariff = await prisma.tariff.findUnique({ where: { id: tariffIdBody }, include: { priceOptions: true } });
      if (!tariff) return res.status(400).json({ message: "Тариф не найден" });
      // кулдаун ПРОДЛЕНИЯ существующей подписки.
      // Применяется только при продлении (extendsSecondarySubId) — новые покупки этого тарифа
      // (как доп. подписки) не ограничиваются.
      if (parsed.data.extendsSecondarySubId) {
        const { checkSubscriptionRenewalCooldown } = await import("../tariff/tariff-cooldown.service.js");
        const cd = await checkSubscriptionRenewalCooldown(parsed.data.extendsSecondarySubId);
        if (!cd.ok) return res.status(429).json({ message: cd.message, code: "TARIFF_COOLDOWN", daysLeft: cd.daysLeft });
      }
      tariffIdToStore = tariffIdBody;
      // Цена: priceOption если выбран, иначе tariff.price
      let unitPrice = tariff.price;
      const optId = (parsed.data as { tariffPriceOptionId?: string }).tariffPriceOptionId;
      if (optId) {
        const opt = (tariff.priceOptions ?? []).find((p) => p.id === optId);
        if (opt) unitPrice = opt.price;
      }
      amountRounded = Math.round((amountBody ?? unitPrice) * 100) / 100;
      if (promoCodeStr?.trim()) {
        const result = await validatePromoCode(promoCodeStr.trim(), clientId);
        if (result.ok && result.promo.type === "DISCOUNT") {
          const promo = result.promo;
          yoomoneyOriginalAmount = amountRounded;
          yoomoneyPromoRecord = promo;
          if (promo.discountPercent && promo.discountPercent > 0) amountRounded = Math.max(0, amountRounded - amountRounded * promo.discountPercent / 100);
          if (promo.discountFixed && promo.discountFixed > 0) amountRounded = Math.max(0, amountRounded - promo.discountFixed);
          amountRounded = Math.round(amountRounded * 100) / 100;
        }
      }
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
      amountRounded = Math.round((amountBody ?? 0) * 100) / 100;
    }
  }

  if (amountRounded < 1) {
    return res.status(400).json({ message: "Минимальная сумма платежа — 1" });
  }

  // Персональная скидка админа — на продуктовые оплаты, не на чистое пополнение.
  const yoomoneyIsTopup = !tariffIdToStore && !proxyTariffIdToStore && !singboxTariffIdToStore && !customBuildBody && !extraOption;
  let yoomoneyPersonalDiscount = 0;
  if (!yoomoneyIsTopup) {
    const originalBeforePersonal = amountRounded;
    const pd = await applyPersonalDiscount(amountRounded, clientId);
    if (pd.personalDiscountPercent > 0) {
      amountRounded = pd.amount;
      yoomoneyPersonalDiscount = pd.personalDiscountPercent;
      if (yoomoneyOriginalAmount == null) yoomoneyOriginalAmount = originalBeforePersonal;
    }
  }

  if (yoomoneyPromoRecord != null && yoomoneyOriginalAmount != null) {
    metadataObj = { ...metadataObj, promoCodeId: yoomoneyPromoRecord.id, originalAmount: yoomoneyOriginalAmount };
  }
  if (yoomoneyPersonalDiscount > 0) {
    metadataObj = { ...metadataObj, personalDiscountPercent: yoomoneyPersonalDiscount, ...(yoomoneyOriginalAmount != null ? { originalAmount: yoomoneyOriginalAmount } : {}) };
  }

  const yoomoneySnap = yoomoneyIsTopup ? await paymentSnapshotTopup(clientId, amountRounded) : await paymentSnapshotProduct(clientId, amountRounded);
  const yoomoneyCharge = yoomoneySnap.amount;

  const orderId = randomUUID();
  const payment = await createPayment({
    data: asPaymentUncheckedCreate({
      clientId,
      orderId,
      amount: yoomoneySnap.amount,
      currency: "RUB",
      status: "PENDING",
      provider: "yoomoney_form",
      tariffId: tariffIdToStore,
      tariffPriceOptionId: parsed.data.tariffPriceOptionId ?? null,
      deviceCount: parsed.data.deviceCount ?? null,
      proxyTariffId: proxyTariffIdToStore,
      singboxTariffId: singboxTariffIdToStore,
      // see yookassa endpoint for explanation.
      metadata: (parsed.data.asAdditional && tariffIdToStore)
        ? JSON.stringify({ ...metadataObj, isAdditionalSubscription: true, ...(parsed.data.asGift ? { purchasedAsGift: true } : {}), ...(parsed.data.extendsSecondarySubId ? { extendsSecondarySubId: parsed.data.extendsSecondarySubId } : {}) })
        : JSON.stringify(parsed.data.extendsSecondarySubId ? { ...metadataObj, extendsSecondarySubId: parsed.data.extendsSecondarySubId } : metadataObj),
    }),
  });

  const serviceName = config.serviceName?.trim() || "STEALTHNET";
  const appUrl = (config.publicAppUrl || "").replace(/\/$/, "");
  const successURL = appUrl ? `${appUrl}/cabinet/payment-wait?id=${payment.id}` : "";
  const targets = tariffIdToStore
    ? `Тариф ${serviceName} #${orderId}`
    : proxyTariffIdToStore
      ? `Прокси ${serviceName} #${orderId}`
      : singboxTariffIdToStore
        ? `Доступы ${serviceName} #${orderId}`
        : customBuildBody
          ? `Гибкий тариф ${serviceName} #${orderId}`
          : extraOption
            ? `Опция ${serviceName} #${orderId}`
            : `Пополнение баланса ${serviceName} #${orderId}`;
  const params = new URLSearchParams({
    receiver,
    "quickpay-form": "shop",
    targets,
    sum: String(yoomoneyCharge),
    paymentType,
    label: payment.id.slice(0, 64),
    successURL,
  });
  const rawPaymentUrl = `https://yoomoney.ru/quickpay/confirm.xml?${params.toString()}`;
  const paymentUrl = await saveRedirectAndBuildUrl(payment.id, orderId, rawPaymentUrl, config.publicAppUrl);

  return res.status(201).json({
    paymentId: payment.id,
    paymentUrl,
    form: {
      receiver,
      sum: yoomoneyCharge,
      label: payment.id,
      paymentType,
      successURL,
    },
    successURL,
  });
}));

clientPaymentsFiatRouter.get("/yoomoney/form-payment/:paymentId", async (req, res) => {
  const clientId = (req as unknown as { clientId: string }).clientId;
  const paymentId = typeof req.params.paymentId === "string" ? req.params.paymentId : "";
  if (!paymentId) return res.status(400).json({ message: "Требуется paymentId" });

  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, clientId, status: "PENDING", provider: "yoomoney_form" },
    select: { id: true, amount: true, metadata: true },
  });
  if (!payment) return res.status(404).json({ message: "Платёж не найден или уже оплачен" });

  const config = await getSystemConfig();
  const receiver = config.yoomoneyReceiverWallet?.trim();
  if (!receiver) return res.status(503).json({ message: "ЮMoney не настроен" });

  let paymentType = "PC";
  try {
    const meta = payment.metadata ? JSON.parse(payment.metadata) as { paymentType?: string } : {};
    if (meta.paymentType === "AC" || meta.paymentType === "PC") paymentType = meta.paymentType;
  } catch { /* ignore */ }

  const appUrl = (config.publicAppUrl || "").replace(/\/$/, "");
  const successURL = appUrl ? `${appUrl}/cabinet/payment-wait?id=${payment.id}` : "";

  return res.json({
    receiver,
    sum: payment.amount,
    label: payment.id,
    paymentType,
    successURL,
  });
});

// ——— ЮKassa API: создание платежа (тариф, пополнение или опция), редирект на confirmation_url ———
const yookassaCreatePaymentSchema = z.object({
  amount: z.number().positive().max(1e7).optional(),
  currency: z.string().min(1).max(10).optional(),
  tariffId: z.string().min(1).optional(),
  tariffPriceOptionId: z.string().min(1).optional(),
  deviceCount: z.number().int().min(0).max(100).optional(),
  proxyTariffId: z.string().min(1).optional(),
  singboxTariffId: z.string().min(1).optional(),
  promoCode: z.string().optional(),
  // покупка тарифа как ДОП. подписки (а не модификация основной).
  // На webhook'е activateTariffByPaymentId увидит metadata.isAdditionalSubscription и
  // вызовет createAdditionalSubscription. Игнорируется без tariffId.
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
  customBuild: z.object({
    days: z.number().int().min(1).max(360),
    devices: z.number().int().min(1).max(20),
    trafficGb: z.number().min(0).nullable().optional(),
  }).optional(),
  // 54-ФЗ-чек: email юзера, которому ЮКасса отправит чек.
  // Если задан и валиден — переопределяет client.email; пустая строка значит «без чека»
  // (используется рандомный placeholder вида randomname@gmail.com — см. yookassa.service.ts).
  // Если client.email пустой, а тут пришёл валидный — сохраним в clients.email.
  receiptEmail: z.string().max(254).optional(),
});
clientPaymentsFiatRouter.post("/yookassa/create-payment", requireRemnaPaymentOnline, asyncHandler(async (req, res) => {
  try {
    const clientId = (req as unknown as { clientId: string }).clientId;
    const parsed = yookassaCreatePaymentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Неверные параметры", errors: parsed.error.flatten() });
    const { amount: amountBody, currency: currencyBody, tariffId: tariffIdBody, proxyTariffId: proxyTariffIdBody, singboxTariffId: singboxTariffIdBody, promoCode, extraOption, customBuild: customBuildBody, extendsSecondarySubId, removeExtrasOnActivate, asGift, asAdditional } = parsed.data;
    const config = await getSystemConfig();
    const shopId = config.yookassaShopId?.trim();
    const secretKey = config.yookassaSecretKey?.trim();
    if (!shopId || !secretKey) return res.status(503).json({ message: "ЮKassa не настроена" });

    let amountRounded: number;
    let currencyUpper: string;
    let tariffIdToStore: string | null = null;
    let proxyTariffIdToStore: string | null = null;
    let singboxTariffIdToStore: string | null = null;
    let metadataObj: Record<string, unknown> = promoCode ? { promoCode } : {};

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
      if (currencyUpper !== "RUB") return res.status(400).json({ message: "ЮKassa принимает только рубли (RUB)" });
    } else if (extraOption) {
      if (!(config as { sellOptionsEnabled?: boolean }).sellOptionsEnabled) {
        return res.status(400).json({ message: "Продажа опций отключена" });
      }
      const cfg = config as {
        sellOptionsTrafficEnabled?: boolean;
        sellOptionsTrafficProducts?: SellOptionTrafficProduct[];
        sellOptionsDevicesEnabled?: boolean;
        sellOptionsDevicesProducts?: SellOptionDeviceProduct[];
        sellOptionsServersEnabled?: boolean;
        sellOptionsServersProducts?: SellOptionServerProduct[];
      };
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
        metadataObj = {
        extraOption: {
          kind: "servers",
          squadUuid: product.squadUuid,
          ...((product.trafficGb ?? 0) > 0 && { trafficBytes: Math.round((product.trafficGb ?? 0) * 1024 ** 3) }),
        },
      };
      }
      if (parsed.data.extraOption?.targetSubscriptionId) {
        metadataObj = { ...metadataObj, targetSubscriptionId: parsed.data.extraOption.targetSubscriptionId };
      }
      if (currencyUpper !== "RUB") return res.status(400).json({ message: "ЮKassa принимает только рубли (RUB)" });
    } else {
      currencyUpper = (currencyBody ?? "RUB").toUpperCase();
      if (currencyUpper !== "RUB") return res.status(400).json({ message: "ЮKassa принимает только рубли (RUB)" });
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

    if (amountRounded < 1) {
      return res.status(400).json({ message: "Минимальная сумма платежа — 1" });
    }

    // Персональная скидка админа — на продуктовые оплаты, не на чистое пополнение.
    const yookassaIsTopup = !tariffIdToStore && !proxyTariffIdToStore && !singboxTariffIdToStore && !customBuildBody && !extraOption;
    if (!yookassaIsTopup) {
      const originalBeforePersonal = amountRounded;
      const pd = await applyPersonalDiscount(amountRounded, clientId);
      if (pd.personalDiscountPercent > 0) {
        amountRounded = pd.amount;
        metadataObj = { ...metadataObj, personalDiscountPercent: pd.personalDiscountPercent, originalAmount: originalBeforePersonal };
      }
    }

    // Применяем промокод на скидку (не для опций и гибких тарифов)
    let promoCodeRecord: { id: string } | null = null;
    if (promoCode?.trim() && !extraOption && !customBuildBody) {
      const result = await validatePromoCode(promoCode.trim(), clientId);
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

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      // добавили telegramId: используем в description платежа
      // YooKassa, чтобы админ мог быстро искать платежи по tg_id в кабинете провайдера.
      select: { email: true, telegramUsername: true, telegramId: true },
    });
    // 3 случая для customerEmail (54-ФЗ-чек):
    //   • receiptEmail отсутствует в body (undefined)  → legacy fallback на client.email
    //     (для совместимости с autopay/cron которые вообще про email-prompt не знают).
    //   • receiptEmail === ""                          → юзер явно нажал "Нет, продолжить"
    //     в боте → НЕ слать чек, оставить placeholder.
    //   • receiptEmail = валидный                      → использовать его, сохранить
    //     в client.email если email ещё пустой.
    const receiptEmailKey = parsed.data.receiptEmail;
    let customerEmail: string | null;
    if (typeof receiptEmailKey === "string") {
      // Явный выбор от бота.
      const trimmed = receiptEmailKey.trim();
      const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
      customerEmail = isValidEmail ? trimmed : null; // пустая строка → null → без чека
      if (isValidEmail && !client?.email) {
        await prisma.client.update({
          where: { id: clientId },
          data: { email: trimmed },
        }).catch((e) => console.warn(`[yookassa] failed to save client.email: ${e}`));
      }
    } else {
      // Ключ не передан — legacy путь (например autopay): берём сохранённый.
      customerEmail = client?.email?.trim() || null;
    }

    const ykSnap = yookassaIsTopup ? await paymentSnapshotTopup(clientId, amountRounded) : await paymentSnapshotProduct(clientId, amountRounded);
    const ykCharge = ykSnap.amount;

    const orderId = randomUUID();
    const payment = await createPayment({
      data: asPaymentUncheckedCreate({
        clientId,
        orderId,
        amount: ykSnap.amount,
        currency: currencyUpper,
        status: "PENDING",
        provider: "yookassa",
        tariffId: tariffIdToStore,
        tariffPriceOptionId: parsed.data.tariffPriceOptionId ?? null,
        deviceCount: parsed.data.deviceCount ?? null,
        proxyTariffId: proxyTariffIdToStore,
        singboxTariffId: singboxTariffIdToStore,
        // mark Payment as additional-subscription if requested AND
        // a tariff is being purchased. activateTariffByPaymentId reads this flag from
        // metadata.isAdditionalSubscription on the webhook and routes activation to
        // createAdditionalSubscription instead of activateTariffForClient.
        // asGift=true → создаём подписку с purchasedAsGift=true (для подарка).
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
    // T-pay-wait (портировано из WolfVPN): после оплаты ЮKassa возвращаем на страницу ожидания (polling статуса).
    const returnUrl = appUrl ? `${appUrl}/cabinet/payment-wait?id=${payment.id}` : "";
    // добавляем tg:<id> в description, чтобы админ мог
    // быстро искать платежи по telegram_id в кабинете YooKassa (раньше там был
    // только orderId UUID, который никак не связать с клиентом без БД).
    const idDesc = (client?.email?.trim() || customerEmail || "").trim();
    // для веб/email-юзеров (без telegramId) кладём email в
    // description, иначе платёж в кабинете YooKassa не связать с клиентом.
    const tgIdSuffix = client?.telegramId ? ` tg:${client.telegramId}` : (idDesc ? ` ${idDesc}` : "");
    const description = (tariffIdToStore
      ? `Тариф ${serviceName} #${orderId}`
      : proxyTariffIdToStore
        ? `Прокси ${serviceName} #${orderId}`
        : singboxTariffIdToStore
          ? `Доступы ${serviceName} #${orderId}`
        : extraOption
          ? `Опция ${serviceName} #${orderId}`
          : `Пополнение баланса ${serviceName} #${orderId}`) + tgIdSuffix;

    const result = await createYookassaPayment({
      shopId,
      secretKey,
      amount: ykCharge,
      currency: currencyUpper,
      returnUrl,
      description,
      metadata: { payment_id: payment.id },
      customerEmail,
      customerTelegramUsername: client?.telegramUsername ?? null,
      savePaymentMethod: config.yookassaRecurringEnabled,
    });

    if (!result.ok) {
      await prisma.payment.delete({ where: { id: payment.id } }).catch(() => {});
      return res.status(500).json({ message: result.error });
    }

    const confirmationUrl = await saveRedirectAndBuildUrl(payment.id, orderId, result.confirmationUrl, config.publicAppUrl);

    return res.status(201).json({
      paymentId: payment.id,
      confirmationUrl,
      yookassaPaymentId: result.paymentId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[yookassa/create-payment]", message, err);
    return res.status(500).json({ message: message || "Ошибка создания платежа" });
  }
}));

// --- Отвязка сохранённого способа оплаты ЮKassa ---
clientPaymentsFiatRouter.post("/yookassa/unlink-payment-method", async (req, res) => {
  try {
    const clientId = (req as unknown as { clientId: string }).clientId;
    const cl = await prisma.client.findUnique({ where: { id: clientId }, select: { yookassaPaymentMethodId: true } });
    if (!cl?.yookassaPaymentMethodId) {
      return res.status(400).json({ message: "Нет привязанного способа оплаты" });
    }
    const updated = await prisma.client.update({
      where: { id: clientId },
      data: { yookassaPaymentMethodId: null, yookassaPaymentMethodTitle: null },
      select: { id: true, email: true, telegramId: true, telegramUsername: true, preferredLang: true, preferredCurrency: true, balance: true, referralCode: true, referralPercent: true, remnawaveUuid: true, trialUsed: true, isBlocked: true, autoRenewEnabled: true, autoRenewTariffId: true, yoomoneyAccessToken: true, totpEnabled: true, createdAt: true, yookassaPaymentMethodTitle: true, onboardingCompleted: true, passwordHash: true },
    });
    return res.json({ client: toClientShape(updated as Parameters<typeof toClientShape>[0]) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[yookassa/unlink-payment-method]", message, err);
    return res.status(500).json({ message: "Ошибка отвязки способа оплаты" });
  }
});

clientPaymentsFiatRouter.post("/cloudpayments/create-payment", asyncHandler(async (req, res) => {
  try {
    const clientId = (req as unknown as { clientId: string }).clientId;
    const parsed = heleketCreatePaymentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Неверные параметры", errors: parsed.error.flatten() });
    const config = await getSystemConfig();
    if (!config.cloudpaymentsEnabled || !config.cloudpaymentsPublicId || !config.cloudpaymentsApiSecret) return res.status(503).json({ message: "CloudPayments не настроен" });
    if (req.body?.paidTrial === true) {
      if (await cloudTrialUsed(clientId)) return res.status(400).json({ message: "Пробный период уже использован" });
      const pending = await prisma.payment.findMany({ where: { clientId, provider: "cloudpayments", status: "PENDING", tariffId: config.cloudpaymentsTrialTariffId, createdAt: { gte: new Date(Date.now() - 86_400_000) }, metadata: { contains: '"cloudTrialDays"' } }, orderBy: { createdAt: "desc" }, take: 10 });
      for (const p of pending) {
        const meta = JSON.parse(p.metadata || "{}");
        if (!meta.cloudTrialDays) continue;
        if (meta.cloudAgreementId) {
          const agreement = await prisma.cloudPaymentAgreement.findUnique({ where: { id: meta.cloudAgreementId } });
          if (!agreement || agreement.state !== "PENDING") continue;
        }
        return res.json({ paymentId: p.id, payUrl: `${config.publicAppUrl?.replace(/\/$/, "")}/api/cloudpayments/checkout/${p.orderId}` });
      }
    }
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
      if (extraOption.targetSubscriptionId) {
        const owned = await prisma.subscription.findFirst({ where: { id: extraOption.targetSubscriptionId, ownerId: clientId } });
        if (!owned) return res.status(404).json({ message: "Подписка не найдена" });
      }
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
        const prorataCoef = extraOption.targetSubscriptionId ? await calculateDevicesProrataPriceCoefficient(extraOption.targetSubscriptionId) : await calculateDevicesProrataPriceCoefficientForPrimary(clientId);
        amountRounded = Math.round(product.price * prorataCoef * 100) / 100;
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
        currencyUpper = (tariff.currency ?? currencyUpper).toUpperCase();
        if ("extendsSecondarySubId" in parsed.data && parsed.data.extendsSecondarySubId) {
          const { checkSubscriptionRenewalCooldown } = await import("../tariff/tariff-cooldown.service.js");
          const cd = await checkSubscriptionRenewalCooldown(parsed.data.extendsSecondarySubId!);
          if (!cd.ok) return res.status(429).json({ message: cd.message, code: "TARIFF_COOLDOWN", daysLeft: cd.daysLeft });
        }
        tariffIdToStore = tariffIdBody;
        let unitPriceCalc = tariff.price;
        let effectiveDaysCalc = tariff.durationDays;
        if (parsed.data.tariffPriceOptionId) {
          const opt = (tariff.priceOptions ?? []).find((p) => p.id === parsed.data.tariffPriceOptionId);
          if (opt) {
            unitPriceCalc = opt.price;
            effectiveDaysCalc = opt.durationDays;
          }
        }
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
        currencyUpper = proxyTariff.currency.toUpperCase();
        amountRounded = Math.round((proxyTariff.price) * 100) / 100;
      } else if (singboxTariffIdBody) {
        const singboxTariff = await prisma.singboxTariff.findUnique({ where: { id: singboxTariffIdBody } });
        if (!singboxTariff || !singboxTariff.enabled) return res.status(400).json({ message: "Тариф Sing-box не найден" });
        singboxTariffIdToStore = singboxTariffIdBody;
        currencyUpper = singboxTariff.currency.toUpperCase();
        amountRounded = Math.round((singboxTariff.price) * 100) / 100;
      } else {
        if (amountBody == null) return res.status(400).json({ message: "Укажите сумму" });
        amountRounded = Math.round(amountBody * 100) / 100;
      }
    }

    if (amountRounded < 1) return res.status(400).json({ message: "Минимальная сумма платежа — 1" });

    const cloudpaymentsIsTopup = !tariffIdToStore && !proxyTariffIdToStore && !singboxTariffIdToStore && !customBuildBody && !extraOption;
    if (!cloudpaymentsIsTopup) {
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

    if (extraOption?.targetSubscriptionId) metadataObj.targetSubscriptionId = extraOption.targetSubscriptionId;
    const rpSnap = cloudpaymentsIsTopup ? await paymentSnapshotTopup(clientId, amountRounded) : await paymentSnapshotProduct(clientId, amountRounded);

    const orderId = randomUUID();
    const payment = await createPayment({
      data: asPaymentUncheckedCreate({
        clientId,
        orderId,
        amount: rpSnap.amount,
        currency: currencyUpper,
        status: "PENDING",
        provider: "cloudpayments",
        tariffId: tariffIdToStore,
        tariffPriceOptionId: parsed.data.tariffPriceOptionId ?? null,
        deviceCount: parsed.data.deviceCount ?? null,
        proxyTariffId: proxyTariffIdToStore,
        singboxTariffId: singboxTariffIdToStore,
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
            if (removeExtrasOnActivate === true) {
              meta.removeExtrasOnActivate = true;
            }
          }
          if (parsed.data.replaceTrialSubId) meta.replaceTrialSubId = parsed.data.replaceTrialSubId;
          if (removeExtrasOnActivate === true) meta.removeExtrasOnActivate = true;
          return Object.keys(meta).length > 0 ? JSON.stringify(meta) : null;
        })(),
      }),
    });

    const payUrl = await prepareCloudCheckout(payment.id, req.body?.paidTrial === true);
    return res.status(201).json({ paymentId: payment.id, payUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cloudpayments/create-payment]", message, err);
    return res.status(500).json({ message: message || "Ошибка создания платежа" });
  }
}));

clientPaymentsFiatRouter.get("/payments", async (req, res) => {
  const clientId = (req as unknown as { clientId: string }).clientId;
  const payments = await prisma.payment.findMany({
    where: { clientId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, orderId: true, amount: true, currency: true, status: true, createdAt: true, paidAt: true },
  });
  return res.json({
    items: payments.map((p) => ({
      id: p.id,
      orderId: p.orderId,
      amount: p.amount,
      currency: p.currency,
      status: p.status,
      createdAt: p.createdAt.toISOString(),
      paidAt: p.paidAt?.toISOString() ?? null,
    })),
  });
});

// T-pay-wait (портировано из WolfVPN): статус конкретного платежа для polling на странице ожидания оплаты.
// active reconciliation Platega УДАЛЁН по просьбе владельца:
// статус платежа меняет ТОЛЬКО webhook (см. platega.webhooks.routes.ts) — без
// постоянных опросов Platega API при каждом poll'е страницы ожидания. Webhook
// должен быть включён в кабинете Platega.
clientPaymentsFiatRouter.get("/payments/:id/status", async (req, res) => {
  const clientId = (req as unknown as { clientId: string }).clientId;
  const p = await prisma.payment.findFirst({
    where: { id: req.params.id, clientId },
    select: { id: true, status: true, amount: true, currency: true, paidAt: true },
  });
  if (!p) return res.status(404).json({ message: "Платёж не найден" });

  return res.json({
    id: p.id,
    status: p.status,
    amount: p.amount,
    currency: p.currency,
    paidAt: p.paidAt?.toISOString() ?? null,
  });
});
