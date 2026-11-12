import { createCispayPayment } from "../cispay/cispay.service.js";
import { cloudTrialUsed } from "../cloudpayments/cloudpayments-trial.js";
import { prepareCloudCheckout, cloudClientRouter } from "../cloudpayments/cloudpayments.routes.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { webClientRouter } from "../amnezia-web/client.routes.js";
import { isWebPanel, WEB_PROTOCOLS } from "../amnezia-web/api.js";
import { starsApi, starsAmount } from "../telegram-stars/stars-api.js";
import { validateTariffDevices } from "../extra-options/device-limit.js";
import { createParitypayPayment, isParitypayConfigured } from "../paritypay/paritypay.service.js";
import { createHmac, randomUUID } from "crypto";
import { env } from "../../config/index.js";
import { Router } from "express";
import { z } from "zod";
import { prisma, createPayment, assertActiveExtraOptionTargetForPayment, assertRenewalTargetForPayment, asPaymentUncheckedCreate } from "../../db.js";
import {
  getSystemConfig,
  getPublicConfig,
  type SellOptionTrafficProduct,
  type SellOptionDeviceProduct,
  type SellOptionServerProduct,
  validatePromoCode,
  type PromoCodeRow,
} from "./client.service.js";
import { requireClientAuth, requireRemnaOnline, requireRemnaPaymentOnline } from "./client.middleware.js";
export { requireRemnaOnline };
export { requireRemnaPaymentOnline };
import { remnaGetUser } from "../remna/remna.client.js";
import { calculateDevicesProrataPriceCoefficient, calculateDevicesProrataPriceCoefficientForPrimary, getCustomBuildConfig, heleketCreatePaymentSchema } from "./client-checkout.util.js";

import { createPlategaTransaction, isPlategaConfigured } from "../platega/platega.service.js";
import { activateTariffForClient, activateTariffByPaymentId, findConvertibleSubscription } from "../tariff/tariff-activation.service.js";
import { saveRedirectAndBuildUrl } from "../payment-redirect/payment-redirect.util.js";
import { createProxySlotsByPaymentId } from "../proxy/proxy-slots-activation.service.js";
import { createSingboxSlotsByPaymentId } from "../singbox/singbox-slots-activation.service.js";
import { buildSingboxSlotSubscriptionLink } from "../singbox/singbox-link.js";
import { applyExtraOptionByPaymentId } from "../extra-options/extra-options.service.js";
import { buildPaymentIntentMetadata } from "../payment/payment-intent.js";
import { getAuthUrl, exchangeCodeForToken, requestPayment, processPayment } from "../yoomoney/yoomoney.service.js";
import { createYookassaPayment } from "../yookassa/yookassa.service.js";
import { createCryptopayInvoice, isCryptopayConfigured } from "../cryptopay/cryptopay.service.js";
import { createHeleketInvoice, isHeleketConfigured } from "../heleket/heleket.service.js";
import { createRollypayPayment, isRollypayConfigured } from "../rollypay/rollypay.service.js";
import { createLavaInvoice, isLavaConfigured } from "../lava/lava.service.js";
import { createLavatopInvoice, isLavatopConfigured } from "../lavatop/lavatop.service.js";
import { createOverpayPayformOrder, isOverpayConfigured } from "../overpay/overpay.service.js";
import { applyPersonalDiscount } from "./personal-discount.js";
import { checkTariffRestriction } from "./client.service.js";
import { isMultiSubscriptionsEnabled } from "./multi-subscriptions.js";
import { paymentSnapshotTopup, paymentSnapshotProduct } from "../bot/bot.service.js";
import { clientAuthRouter, toClientShape } from "./client-auth.routes.js";
import { clientProfileRouter } from "./client-profile.routes.js";
import { clientReferralsRouter } from "./client-referrals.routes.js";
import { clientTrialsPromoRouter, extractCurrentExpireAt } from "./client-trials-promo.routes.js";
import { clientSubscriptionsRouter } from "./client-subscriptions.routes.js";
import { clientTicketsRouter } from "./client-tickets.routes.js";
export { fetchAvailableTrialsForClient } from "./client-trials-promo.routes.js";

// Единый роутер /api/client: /auth (логин, регистрация, me) + кабинет (подписка, платежи)
export const clientRouter = Router();
clientRouter.use("/auth", clientAuthRouter);

// ЮMoney OAuth callback — без авторизации клиента (редирект с ЮMoney)
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

clientRouter.get("/yoomoney/callback", async (req, res) => {
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
});

// ——— Tour Steps (публичные, без авторизации — ПЕРЕД requireClientAuth!) ———
clientRouter.get("/tour-steps", async (_req, res) => {
  try {
    const steps = await prisma.tourStep.findMany({
      where: { isActive: true },
      include: { mascot: { include: { emotions: true } } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return res.json({
      items: steps.map(s => ({
        id: s.id,
        target: s.target,
        targetLabel: s.targetLabel,
        title: s.title,
        content: s.content,
        videoUrl: s.videoUrl,
        placement: s.placement,
        route: s.route,
        mascotId: s.mascotId,
        mood: s.mood,
        sortOrder: s.sortOrder,
        mascot: s.mascot ? {
          id: s.mascot.id, name: s.mascot.name, imageUrl: s.mascot.imageUrl,
          emotions: (s.mascot.emotions ?? []).map((e: { id: string; mood: string; imageUrl: string }) => ({
            id: e.id, mood: e.mood, imageUrl: e.imageUrl,
          })),
        } : null,
      })),
    });
  } catch (e) {
    console.error("GET /tour-steps error:", e);
    return res.status(500).json({ message: "Ошибка загрузки шагов тура" });
  }
});

clientRouter.use(requireClientAuth);
clientRouter.use("/cloudpayments", cloudClientRouter);
clientRouter.use(clientProfileRouter);

clientRouter.use(clientReferralsRouter);
clientRouter.use(clientTrialsPromoRouter);

clientRouter.get("/proxy-slots", async (req, res) => {
  const client = (req as unknown as { client: { id: string } }).client;
  const now = new Date();
  const slots = await prisma.proxySlot.findMany({
    where: { clientId: client.id, status: "ACTIVE", expiresAt: { gt: now } },
    select: {
      id: true,
      login: true,
      password: true,
      expiresAt: true,
      trafficLimitBytes: true,
      trafficUsedBytes: true,
      connectionLimit: true,
      node: { select: { publicHost: true, socksPort: true, httpPort: true } },
    },
    orderBy: { expiresAt: "asc" },
  });
  return res.json({
    slots: slots.map((s) => ({
      id: s.id,
      login: s.login,
      password: s.password,
      expiresAt: s.expiresAt.toISOString(),
      trafficLimitBytes: s.trafficLimitBytes?.toString() ?? null,
      trafficUsedBytes: s.trafficUsedBytes.toString(),
      connectionLimit: s.connectionLimit,
      host: s.node.publicHost ?? "host",
      socksPort: s.node.socksPort,
      httpPort: s.node.httpPort,
    })),
  });
});

clientRouter.use(webClientRouter);

clientRouter.get("/singbox-slots", async (req, res) => {
  res.set("Cache-Control", "no-store");
  const client = (req as unknown as { client: { id: string } }).client;
  const now = new Date();
  const slots = await prisma.singboxSlot.findMany({
    where: { clientId: client.id, OR: [{ status: "ACTIVE", expiresAt: { gt: now } }, ...(req.query.includeInactive === "true" ? [{ node: { protocol: { in: [...WEB_PROTOCOLS] } }, status: { in: ["ACTIVE", "PROVISIONING"] } }] : [])] },
    select: {
      id: true,
      status: true,
      syncPending: true,
      sourcePaymentId: true,
      singboxTariff: { select: { enabled: true } },
      userIdentifier: true,
      secret: true,
      expiresAt: true,
      trafficLimitBytes: true,
      trafficUsedBytes: true,
      node: { select: { status: true, publicHost: true, port: true, protocol: true, tlsEnabled: true, customConfigJson: true } },
    },
    orderBy: { expiresAt: "asc" },
  });
  const payments = await prisma.payment.findMany({ where: { id: { in: slots.map(s => s.sourcePaymentId).filter((id): id is string => !!id) } }, select: { id: true, status: true } });
  const paid = new Set(payments.filter(p => p.status === "PAID").map(p => p.id));
  return res.json({
    slots: slots.filter(s => !isWebPanel(s.node.protocol) || (s.sourcePaymentId && paid.has(s.sourcePaymentId))).map((s) => {
      const link = s.status === "ACTIVE" && s.expiresAt > now ? buildSingboxSlotSubscriptionLink(
        {
          publicHost: s.node.publicHost ?? "",
          port: s.node.port ?? 443,
          protocol: s.node.protocol ?? "VLESS",
          tlsEnabled: s.node.tlsEnabled,
          customConfigJson: s.node.customConfigJson,
        },
        { userIdentifier: s.userIdentifier, secret: s.secret },
        `slot-${s.id.slice(-8)}`
      ) : "";
      return {
        id: s.id,
        status: s.syncPending || s.status === "PROVISIONING" ? "PENDING" : s.expiresAt <= now ? "EXPIRED" : s.trafficLimitBytes && s.trafficUsedBytes >= s.trafficLimitBytes ? "TRAFFIC_LIMIT" : s.node.status === "DISABLED" ? "DISABLED" : "ACTIVE",
        nodeOnline: s.node.status === "ONLINE",
        canRenew: isWebPanel(s.node.protocol) && s.status === "ACTIVE" && s.node.status !== "DISABLED" && !!s.singboxTariff?.enabled && !s.syncPending,
        subscriptionLink: link,
        expiresAt: s.expiresAt.toISOString(),
        trafficLimitBytes: s.trafficLimitBytes?.toString() ?? null,
        trafficUsedBytes: s.trafficUsedBytes.toString(),
        protocol: s.node.protocol ?? "VLESS",
      };
    }),
  });
});

clientRouter.use(clientSubscriptionsRouter);

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
clientRouter.post("/payments/platega", requireRemnaPaymentOnline, asyncHandler(async (req, res) => {
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

clientRouter.post("/payments/balance", requireRemnaPaymentOnline, asyncHandler(async (req, res) => {
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

clientRouter.post("/custom-build/pay-balance", requireRemnaOnline, asyncHandler(async (req, res) => {
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
clientRouter.post("/payments/balance/option", requireRemnaOnline, asyncHandler(async (req, res) => {
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

// ——— ЮMoney: пополнение баланса ———

clientRouter.get("/yoomoney/auth-url", async (req, res) => {
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
clientRouter.post("/yoomoney/request-topup", asyncHandler(async (req, res) => {
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
clientRouter.post("/yoomoney/process-payment", async (req, res) => {
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
clientRouter.post("/yoomoney/create-form-payment", requireRemnaPaymentOnline, asyncHandler(async (req, res) => {
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

clientRouter.get("/yoomoney/form-payment/:paymentId", async (req, res) => {
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
clientRouter.post("/yookassa/create-payment", requireRemnaPaymentOnline, asyncHandler(async (req, res) => {
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
clientRouter.post("/yookassa/unlink-payment-method", async (req, res) => {
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
clientRouter.post(["/cryptopay/create-payment", "/telegram-stars/create-payment"], requireRemnaPaymentOnline, asyncHandler(async (req, res) => {
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

clientRouter.post("/heleket/create-payment", requireRemnaPaymentOnline, asyncHandler(async (req, res) => {
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

clientRouter.post(["/rollypay/create-payment", "/cispay/create-payment"], requireRemnaPaymentOnline, asyncHandler(async (req, res) => {
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

clientRouter.post("/paritypay/create-payment", requireRemnaPaymentOnline, asyncHandler(async (req, res) => {
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

clientRouter.post("/cloudpayments/create-payment", asyncHandler(async (req, res) => {
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
clientRouter.post("/lava/create-payment", requireRemnaPaymentOnline, asyncHandler(async (req, res) => {
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
clientRouter.post("/lavatop/create-payment", requireRemnaPaymentOnline, asyncHandler(async (req, res) => {
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
clientRouter.post("/overpay/create-payment", requireRemnaPaymentOnline, asyncHandler(async (req, res) => {
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

const aiChatSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant", "system"]),
    content: z.string()
  })).max(50),
});

clientRouter.post("/ai/chat", async (req, res) => {
  try {
    const client = (req as unknown as { client: { id: string; remnawaveUuid: string | null } }).client;

    const parsed = aiChatSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Неверный формат сообщений", errors: parsed.error.flatten() });
    }

    const config = await getSystemConfig();
    const publicConfig = await getPublicConfig();
    if ((publicConfig as { aiChatEnabled?: boolean }).aiChatEnabled === false) {
      return res.status(403).json({ message: "AI-чат отключён" });
    }

    const apiKey = (config as { groqApiKey?: string | null }).groqApiKey?.trim();
    if (!apiKey) {
      // Заглушка, если API ключ не настроен
      return res.json({
        reply: "Извините, AI-ассистент пока не настроен. Пожалуйста, обратитесь в поддержку или настройте Groq API Key в админ-панели."
      });
    }

    const primaryModel = (config as { groqModel?: string | null }).groqModel?.trim() || "llama3-8b-8192";
    const fallback1 = (config as { groqFallback1?: string | null }).groqFallback1?.trim();
    const fallback2 = (config as { groqFallback2?: string | null }).groqFallback2?.trim();
    const fallback3 = (config as { groqFallback3?: string | null }).groqFallback3?.trim();
    
    const modelsToTry = [primaryModel];
    if (fallback1) modelsToTry.push(fallback1);
    if (fallback2) modelsToTry.push(fallback2);
    if (fallback3) modelsToTry.push(fallback3);

    const systemPromptText = (config as { aiSystemPrompt?: string | null }).aiSystemPrompt?.trim() || "Ты — лучший менеджер техподдержки VPN-сервиса. Твоя цель — вежливо, быстро и точно помогать пользователям с настройкой VPN, тарифами и решением технических проблем. Отвечай кратко и по делу.";

    const vpnTariffs = await prisma.tariff.findMany({ orderBy: { price: 'asc' } });
    const proxyTariffs = await prisma.proxyTariff.findMany({ where: { enabled: true }, orderBy: { price: 'asc' } });
    const singboxTariffs = await prisma.singboxTariff.findMany({ where: { enabled: true }, orderBy: { price: 'asc' } });

    let tariffsContext = "\n\nАКТУАЛЬНАЯ ИНФОРМАЦИЯ О ТАРИФАХ ДЛЯ ПОЛЬЗОВАТЕЛЯ:\nОбязательно используй только эти тарифы, если пользователь спрашивает про цены.\n";
    if (vpnTariffs.length > 0) tariffsContext += "VPN Тарифы: " + vpnTariffs.map(t => `${t.name} (${t.price} ${t.currency.toUpperCase()} на ${t.durationDays} дней)`).join(", ") + ".\n";
    if (proxyTariffs.length > 0) tariffsContext += "Прокси: " + proxyTariffs.map(t => `${t.name} (${t.price} ${t.currency.toUpperCase()} на ${t.durationDays} дней)`).join(", ") + ".\n";
    if (singboxTariffs.length > 0) tariffsContext += "Sing-box: " + singboxTariffs.map(t => `${t.name} (${t.price} ${t.currency.toUpperCase()} на ${t.durationDays} дней)`).join(", ") + ".\n";

    const paymentMethods = [];
    if (publicConfig.yookassaEnabled) paymentMethods.push("YooKassa (Банковские карты, СБП и др.)");
    if (publicConfig.yoomoneyEnabled) paymentMethods.push("YooMoney (Кошелек, Карты)");
    if (publicConfig.cryptopayEnabled) paymentMethods.push("Crypto Pay (Криптовалюта в Telegram)");
    if (publicConfig.heleketEnabled) paymentMethods.push("Heleket (Криптовалюта)");
    if ((publicConfig as { rollypayEnabled?: boolean }).rollypayEnabled) paymentMethods.push("RollyPay (СБП, карты, крипта)");
    if (publicConfig.plategaMethods && publicConfig.plategaMethods.length > 0) {
      paymentMethods.push("Platega (" + publicConfig.plategaMethods.map(m => m.label).join(", ") + ")");
    }

    let paymentContext = "\n\nДОСТУПНЫЕ СПОСОБЫ ОПЛАТЫ НА САЙТЕ:\n";
    if (paymentMethods.length > 0) {
      paymentContext += "Пользователь может оплатить следующими способами:\n- " + paymentMethods.join("\n- ") + "\nЕсли спрашивают как оплатить, перечисли ТОЛЬКО эти способы. Не выдумывай Сбербанк Онлайн, QIWI, WebMoney, PayPal и т.д., если их нет в списке.\n";
    } else {
      paymentContext += "В данный момент на сайте не настроено автоматических способов оплаты.\n";
    }

    const instructionsContext = `\n\nИНСТРУКЦИЯ ПО ПОДКЛЮЧЕНИЮ:
Если пользователь спрашивает, как подключиться или настроить VPN, отвечай СТРОГО по следующему алгоритму (не придумывай свои методы):
1. В личном кабинете на сайте нажать кнопку "Подключить VPN".
2. Выбрать свою платформу и скачать предложенное приложение.
3. Вернуться на сайт и нажать кнопку "Добавить подписку" (оная автоматически добавит конфигурацию в приложение) либо отсканировать QR-код.

ПРАВИЛА ОТВЕТА О ЛИМИТАХ И ТАРИФАХ:
Если пользователь спрашивает "какой у меня тариф", "сколько осталось дней", "какой лимит трафика", "сколько устройств", "какой у меня баланс" и т.д., ВСЕГДА используй данные из блока "ИНФОРМАЦИЯ О ТЕКУЩЕМ ПОЛЬЗОВАТЕЛЕ" ниже. НИКОГДА не говори, что ты не можешь найти информацию. Просто прочитай её из блока и ответь пользователю.\n`;

    let userInfoContext = "\n\nИНФОРМАЦИЯ О ТЕКУЩЕМ ПОЛЬЗОВАТЕЛЕ:\nИспользуй эти данные, если пользователь спрашивает про свои текущие подписки или лимиты. Если написано, что чего-то нет, прямо скажи пользователю, что у него этого нет.\n";
    try {
      const dbClient = await prisma.client.findUnique({
        where: { id: client.id },
        include: {
          proxySlots: { where: { status: 'ACTIVE' }, include: { proxyTariff: true } },
          singboxSlots: { where: { status: 'ACTIVE' }, include: { singboxTariff: true } }
        }
      });
      
      userInfoContext += `- Баланс: ${dbClient?.balance || 0} ${(dbClient?.preferredCurrency || 'usd').toUpperCase()}\n`;

      let vpnInfo = "У пользователя НЕТ активной подписки VPN";
      if (client.remnawaveUuid) {
        const u = await remnaGetUser(client.remnawaveUuid);
        if (u && !u.error && u.data) {
          const exp = extractCurrentExpireAt(u.data);
          if (exp && exp > new Date()) {
             const resp = ((u.data as any).response ?? (u.data as any).data ?? u.data) as any;
             const tLimitRaw = resp?.trafficLimitBytes ?? resp?.trafficLimit;
             const tLimit = (tLimitRaw != null && tLimitRaw > 0) ? (Number(tLimitRaw) / 1024**3).toFixed(2) + " GB" : "Безлимит";
             const tUsedRaw = resp?.trafficUsedBytes ?? resp?.trafficUsed;
             const tUsed = tUsedRaw != null ? (Number(tUsedRaw) / 1024**3).toFixed(2) + " GB" : "0 GB";
             const dLimitRaw = resp?.hwidDeviceLimit ?? resp?.deviceLimit;
             const dLimit = (dLimitRaw != null && dLimitRaw > 0) ? dLimitRaw : "Безлимит";
             vpnInfo = `Активна до ${exp.toISOString().split('T')[0]}, Трафик: ${tUsed} / ${tLimit}, Лимит устройств: ${dLimit}`;
          }
        }
      }
      userInfoContext += `- VPN: ${vpnInfo}\n`;
      
      if (dbClient?.proxySlots?.length) {
        userInfoContext += `- Прокси: ${dbClient.proxySlots.map((s: any) => `${s.proxyTariff?.name || 'Слот'} (до ${s.expiresAt.toISOString().split('T')[0]})`).join(', ')}\n`;
      } else {
        userInfoContext += `- Прокси: У пользователя НЕТ прокси\n`;
      }
      
      if (dbClient?.singboxSlots?.length) {
        userInfoContext += `- Sing-box: ${dbClient.singboxSlots.map((s: any) => `${s.singboxTariff?.name || 'Слот'} (до ${s.expiresAt.toISOString().split('T')[0]})`).join(', ')}\n`;
      } else {
        userInfoContext += `- Sing-box: У пользователя НЕТ подписок Sing-box\n`;
      }
    } catch (e) {
      console.error("[ai/chat] Error fetching user info:", e);
    }

    const systemPrompt = systemPromptText + tariffsContext + paymentContext + instructionsContext + userInfoContext;

    const messages = [
      { role: "system", content: systemPrompt },
      ...parsed.data.messages
    ];

    let lastErrorDetails = "";
    let lastStatus = 500;

    const { proxyFetch } = await import("../proxy-util/proxy-fetch.js");
    const { getProxyUrl } = await import("../proxy-util/get-proxy-url.js");
    const aiProxy = await getProxyUrl("ai");

    for (const model of modelsToTry) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        const groqRes = await proxyFetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages,
            temperature: 0.5,
            max_tokens: 1024,
          }),
          signal: controller.signal,
        }, aiProxy);
        
        clearTimeout(timeoutId);

        if (groqRes.ok) {
          const data = await groqRes.json() as any;
          const reply = data.choices?.[0]?.message?.content || "Не удалось получить ответ.";
          return res.json({ reply });
        }

        // Если ошибка (например, 429 Rate Limit), пробуем следующую модель
        const errText = await groqRes.text().catch(() => "");
        console.error(`[ai/chat] Groq error (model: ${model}):`, groqRes.status, errText);
        lastStatus = groqRes.status;
        lastErrorDetails = errText;
        
        // Если это не 429 Rate Limit или 5xx, возможно стоит прервать, но лучше попробовать следующую
      } catch (err) {
        console.error(`[ai/chat] Network/Abort error with model ${model}:`, err);
        lastErrorDetails = err instanceof Error ? err.message : String(err);
      }
    }

    // Если все модели не сработали
    return res.status(502).json({ message: "Ошибка сервиса AI или превышены лимиты", details: lastErrorDetails });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ai/chat]", message, err);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
});

clientRouter.get("/payments", async (req, res) => {
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
clientRouter.get("/payments/:id/status", async (req, res) => {
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

clientRouter.use(clientTicketsRouter);

export { publicConfigRouter } from "./client-public.routes.js";
