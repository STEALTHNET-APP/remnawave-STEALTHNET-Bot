import { Router } from "express";
import { randomUUID } from "node:crypto";
import { findConvertibleSubscription } from "../tariff/tariff-activation.service.js";
import { isMultiSubscriptionsEnabled } from "../client/multi-subscriptions.js";
import { calcExtrasMonthlyPrice } from "../tariff/extras-pricing.js";
import { applyPercent } from "../client/personal-discount.js";
import { paymentSnapshotProduct } from "../bot/bot.service.js";
import { subscriptionPrice } from "./cloudpayments-api.js";
import { prisma } from "../../db.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { cloudConfig, readMetadata, cancelCloudAgreement } from "./cloudpayments.service.js";

export const cloudPublicRouter = Router();
export const cloudClientRouter = Router();
const escapeHtml = (value: unknown) => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export async function prepareCloudCheckout(paymentId: string, paidTrial: boolean): Promise<string> {
  const cfg = await cloudConfig();
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { tariff: true, tariffPriceOption: true } });
  const meta = readMetadata(payment.metadata);
  if (payment.currency.toUpperCase() !== "RUB") throw new Error("CloudPayments: выберите тариф в рублях");
  if (payment.tariffPriceOptionId && payment.tariffPriceOption?.tariffId !== payment.tariffId) throw new Error("Период не принадлежит выбранному тарифу");
  if (payment.tariff) {
    const client = await prisma.client.findUniqueOrThrow({ where: { id: payment.clientId } });
    const target = meta.extendsSecondarySubId ? await prisma.subscription.findFirst({ where: { id: meta.extendsSecondarySubId, ownerId: payment.clientId } }) : null;
    if (meta.extendsSecondarySubId && !target) throw new Error("Подписка не принадлежит плательщику");
    if ((meta.removeExtrasOnActivate ? 0 : target?.extraDevices ?? 0) + (payment.deviceCount ?? 0) > payment.tariff.maxExtraDevices) throw new Error("Превышен лимит дополнительных устройств");
    const monthly = (meta.removeExtrasOnActivate ? 0 : target?.extraDevicesMonthlyPrice ?? 0) + calcExtrasMonthlyPrice(payment.tariff.pricePerExtraDevice, payment.deviceCount ?? 0, payment.tariff.deviceDiscountTiers);
    const regular = subscriptionPrice(payment.tariffPriceOption?.price ?? payment.tariff.price, monthly, payment.tariffPriceOption?.durationDays ?? payment.tariff.durationDays);
    const discounted = client.personalDiscountIsOneTime ? regular : applyPercent(regular, client.personalDiscountPercent ?? 0);
    meta.cloudPeriodDays = payment.tariffPriceOption?.durationDays ?? payment.tariff.durationDays;
    meta.cloudRegularAmount = (await paymentSnapshotProduct(payment.clientId, discounted)).amount;
  }
  if (paidTrial) {
    if (!payment.tariffId || payment.tariffId !== cfg.cloudpaymentsTrialTariffId || cfg.cloudpaymentsTrialDays < 1 || meta.purchasedAsGift || meta.extendsSecondarySubId || payment.deviceCount) throw new Error("Платный пробный период недоступен для этого заказа");
    const used = await prisma.cloudPaymentAgreement.findFirst({ where: { clientId: payment.clientId, trialDays: { gt: 0 }, subscriptionId: { not: null } } });
    if (used || await prisma.payment.count({ where: { clientId: payment.clientId, status: "PAID", tariffId: { not: null } } })) throw new Error("Пробный период уже использован");
    meta.cloudTrialDays = cfg.cloudpaymentsTrialDays;

    await prisma.payment.update({ where: { id: payment.id }, data: { amount: cfg.cloudpaymentsTrialAmount, metadata: JSON.stringify(meta) } });
  }
  if (!paidTrial) await prisma.payment.update({ where: { id: payment.id }, data: { metadata: JSON.stringify(meta) } });
  const appUrl = cfg.publicAppUrl?.replace(/\/$/, "");
  if (!appUrl) throw new Error("Укажите публичный адрес панели");
  return `${appUrl}/api/cloudpayments/checkout/${payment.orderId}`;
}

async function checkoutOrder(orderId: string) {
  const payment = await prisma.payment.findFirst({ where: { orderId, provider: "cloudpayments" }, include: { tariff: true, tariffPriceOption: true } });
  if (!payment || payment.status !== "PENDING" || Date.now() - payment.createdAt.getTime() > 86_400_000) return null;
  return payment;
}

cloudPublicRouter.get("/checkout/:orderId", asyncHandler(async (req, res) => {
  const payment = await checkoutOrder(req.params.orderId);
  if (!payment) return res.status(404).send("Счёт оплачен или срок ссылки истёк. Вернитесь в кабинет.");
  const cfg = await cloudConfig();
  const meta = readMetadata(payment.metadata);
  const days = meta.cloudPeriodDays ?? payment.tariffPriceOption?.durationDays ?? payment.tariff?.durationDays ?? 30;
  const regular = meta.cloudRegularAmount ?? payment.amount;
  const recurring = !!payment.tariffId && !meta.purchasedAsGift;
  const terms = recurring ? `Автоплатёж: ${regular} ₽ каждые ${days} дней${meta.cloudTrialDays ? ` после пробного периода (${meta.cloudTrialDays} дн.)` : ""}. При изменении цены тарифа или числа устройств сумма следующего платежа изменится. Отмена — в кабинете или на my.cloudpayments.ru. При отмене во время пробного периода доступ закрывается сразу.` : "";
  const nonce = randomUUID();
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Content-Security-Policy", `default-src 'self'; script-src 'self' 'nonce-${nonce}' https://widget.cloudpayments.ru; style-src 'unsafe-inline'; frame-src https://*.cloudpayments.ru; connect-src 'self' https://*.cloudpayments.ru; img-src 'self' data: https://*.cloudpayments.ru; base-uri 'none'; frame-ancestors 'none'`);
  return res.type("html").send(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Оплата — ${escapeHtml(cfg.serviceName)}</title><style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#171818;color:#f5f5f5;font:16px system-ui}main{width:min(440px,calc(100% - 48px));padding:28px 0}h1{font-size:28px;letter-spacing:-.04em}p{color:#b5b9bb;line-height:1.6}.amount{font-size:40px;color:inherit}label{display:flex;align-items:flex-start;gap:12px;line-height:1.6;margin:24px 0}input{margin-top:7px}button{width:100%;padding:16px;border:0;border-radius:12px;font:600 16px system-ui;cursor:pointer}button:disabled{opacity:.5}a{color:inherit}#status{min-height:24px}</style><main><p>${escapeHtml(cfg.serviceName)}</p><h1>${escapeHtml(payment.tariff?.name || "Оплата заказа")}</h1><p class="amount">${payment.amount} ₽</p>${meta.cloudTrialDays ? `<p>Пробный период: ${meta.cloudTrialDays} дн.</p>` : ""}${recurring ? `<label><input id="recurring" type="checkbox"><span>${escapeHtml(terms)}</span></label>` : ""}<button id="pay">Оплатить</button><p id="status" role="status"></p><a href="/cabinet/dashboard">Вернуться в кабинет</a></main><script src="https://widget.cloudpayments.ru/bundles/cloudpayments.js"></script><script nonce="${nonce}">const b=document.getElementById('pay'),s=document.getElementById('status');b.onclick=async()=>{b.disabled=true;s.textContent='';try{const r=await fetch(location.pathname+'/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recurring:document.getElementById('recurring')?.checked===true})});const data=await r.json();if(!r.ok)throw Error(data.message);await new cp.CloudPayments().start(data.widget);s.textContent='Проверяем оплату. Подтверждение появится в истории платежей кабинета.';}catch(e){s.textContent=e.message||'Оплата не завершена';}finally{b.disabled=false}};</script></html>`);
}));

cloudPublicRouter.post("/checkout/:orderId/start", asyncHandler(async (req, res) => {
  const payment = await checkoutOrder(req.params.orderId);
  if (!payment) return res.status(404).json({ message: "Счёт недоступен" });
  const cfg = await cloudConfig();
  if (!cfg.cloudpaymentsEnabled) return res.status(503).json({ message: "CloudPayments отключён" });
  const meta = readMetadata(payment.metadata);
  const recurring = req.body.recurring === true;
  if (meta.cloudTrialDays && !recurring) return res.status(400).json({ message: "Для платного пробного периода нужно согласие на автоплатёж. Обычный тариф доступен без автоплатежа." });
  if (recurring && (!payment.tariffId || meta.purchasedAsGift)) return res.status(400).json({ message: "Автоплатёж недоступен для этого заказа" });
  const days = meta.cloudPeriodDays ?? payment.tariffPriceOption?.durationDays ?? payment.tariff?.durationDays ?? 30;
  let agreementId: string | null = null;
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${payment.clientId}))`;
    const latest = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
    const latestMeta = readMetadata(latest.metadata);
    if (latest.status !== "PENDING") throw new Error("Счёт уже оплачен");
    if (latestMeta.cloudAgreementId) {
      if (!recurring) throw new Error("Для изменения условий создайте новый счёт");
      const existing = await tx.cloudPaymentAgreement.findUniqueOrThrow({ where: { id: latestMeta.cloudAgreementId } });
      if (existing.state !== "PENDING" || existing.nextChargeAt || existing.createRequestedAt) throw new Error("Согласие уже использовано или отменено. Создайте новый счёт.");
      agreementId = latestMeta.cloudAgreementId;
      return;
    }
    if (recurring) {
      if (!isMultiSubscriptionsEnabled(cfg) && await tx.cloudPaymentAgreement.count({ where: { clientId: payment.clientId, subscriptionId: null, state: { in: ["PENDING", "ACTIVE", "PAST_DUE", "CANCEL_PENDING"] }, createdAt: { gte: new Date(Date.now() - 86_400_000) } } })) throw new Error("Сначала завершите или отмените предыдущий заказ с автоплатежом");
      if (meta.cloudTrialDays) {
        const others = await tx.cloudPaymentAgreement.findMany({ where: { clientId: payment.clientId, trialDays: { gt: 0 } } });
        for (const other of others) {
          const reserved = await tx.payment.findFirst({ where: { clientId: payment.clientId, provider: "cloudpayments", metadata: { contains: other.id }, status: { in: ["PENDING", "PAID"] } } });
          if (other.subscriptionId || reserved?.status === "PAID" || reserved?.externalId || reserved && Date.now() - reserved.createdAt.getTime() < 86_400_000 && other.state === "PENDING") throw new Error("Пробный период уже заказан. Откройте предыдущий счёт в истории платежей.");
          await tx.cloudPaymentAgreement.update({ where: { id: other.id }, data: { state: "EXPIRED", tokenEncrypted: null } });
        }
      }
      const convertible = meta.extendsSecondarySubId ? null : await findConvertibleSubscription(payment.clientId, payment.tariffId!, isMultiSubscriptionsEnabled(cfg), { preferredSubId: meta.replaceTrialSubId, trialSquadUuid: cfg.trialSquadUuid });
      const target = (meta.extendsSecondarySubId || convertible?.id) as string | undefined;
      if (target && await tx.cloudPaymentAgreement.count({ where: { subscriptionId: target, state: { in: ["PENDING", "ACTIVE", "PAST_DUE", "CANCEL_PENDING"] } } })) throw new Error("Для этой подписки уже настроен автоплатёж");
      const amount = meta.cloudRegularAmount ?? payment.amount;
      const agreement = await tx.cloudPaymentAgreement.create({ data: {
        clientId: payment.clientId, subscriptionId: target ?? null, terminalId: cfg.publicId, tariffId: payment.tariffId!, priceOptionId: payment.tariffPriceOptionId,
        amount, currency: payment.currency, periodDays: days, trialDays: meta.cloudTrialDays ?? 0,
        consentText: `${payment.amount} RUB сейчас; ${amount} RUB каждые ${days} дней; пробный период ${meta.cloudTrialDays ?? 0} дней. Сумма зависит от текущей цены тарифа и устройств. Отмена пробного периода прекращает доступ.`,
      } });
      agreementId = agreement.id;
    }
    await tx.payment.update({ where: { id: payment.id }, data: { metadata: JSON.stringify({ ...latestMeta, cloudAgreementId: agreementId, cloudAccountId: agreementId || payment.clientId, cloudAcceptedAt: new Date().toISOString(), cloudTerminalId: cfg.publicId, cloudTestMode: cfg.cloudpaymentsTestMode }) } });
  });
  return res.json({ widget: { publicTerminalId: cfg.publicId, paymentSchema: "Single", currency: payment.currency, amount: payment.amount,
    description: payment.tariff?.name || "Оплата заказа", externalId: payment.orderId, culture: "ru-RU", skin: "modern",
    userInfo: { accountId: agreementId || payment.clientId },
    ...(recurring ? { restrictedPaymentMethods: ["TcsInstallment", "Sbp", "TinkoffPay", "MirPay", "Dolyame", "ForeignCard", "SberPay"] } : {}),
  } });
}));

cloudClientRouter.get("/subscriptions", asyncHandler(async (req, res) => {
  const clientId = (req as unknown as { clientId: string }).clientId;
  const rows = await prisma.cloudPaymentAgreement.findMany({ where: { clientId }, select: { id: true, subscriptionId: true, state: true, amount: true, currency: true, periodDays: true, nextChargeAt: true, trialEndsAt: true, graceEndsAt: true } });
  res.json({ subscriptions: rows });
}));
cloudClientRouter.post("/subscriptions/:id/cancel", asyncHandler(async (req, res) => {
  const clientId = (req as unknown as { clientId: string }).clientId;
  const row = await prisma.cloudPaymentAgreement.findFirst({ where: { id: req.params.id, clientId } });
  if (!row) return res.status(404).json({ message: "Подписка не найдена" });
  await cancelCloudAgreement(row.id, clientId);
  return res.json({ ok: true });
}));
