import { buildCloudReceipt, receiptEmail } from "./cloudpayments-receipt.js";
import { cloudTrialUsed } from "./cloudpayments-trial.js";
import { cloudRequest } from "./cloudpayments-api.js";
import { Router } from "express";
import { randomUUID, createHash } from "node:crypto";
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
    if (await cloudTrialUsed(payment.clientId)) throw new Error("Пробный период уже использован");
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
  const needsEmail = meta.cloudAcceptedAt ? !!meta.cloudReceipt : cfg.cloudpaymentsReceipt.enabled;
  const nonce = randomUUID();
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Content-Security-Policy", `default-src 'self'; script-src 'self' 'nonce-${nonce}' https://widget.cloudpayments.ru; style-src 'unsafe-inline'; frame-src https://*.cloudpayments.ru; connect-src 'self' https://*.cloudpayments.ru; img-src 'self' data: https://*.cloudpayments.ru; base-uri 'none'; frame-ancestors 'none'`);
  return res.type("html").send(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Оплата — ${escapeHtml(cfg.serviceName)}</title><style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#171818;color:#f5f5f5;font:16px system-ui}main{width:min(440px,calc(100% - 48px));padding:28px 0}h1{font-size:28px;letter-spacing:-.04em}p{color:#b5b9bb;line-height:1.6}.amount{font-size:40px;color:inherit}label{display:flex;align-items:flex-start;gap:12px;line-height:1.6;margin:24px 0}input{margin-top:7px}button{width:100%;padding:16px;border:0;border-radius:12px;font:600 16px system-ui;cursor:pointer}button:disabled{opacity:.5}a{color:inherit}#status{min-height:24px}</style><main><p>${escapeHtml(cfg.serviceName)}</p><h1>${escapeHtml(payment.tariff?.name || "Оплата заказа")}</h1><p class="amount">${payment.amount} ₽</p>${meta.cloudTrialDays ? `<p>Пробный период: ${meta.cloudTrialDays} дн.</p>` : ""}${recurring ? `<label><input id="recurring" type="checkbox"><span>${escapeHtml(terms)}</span></label>` : ""}${needsEmail ? `<label>Email для чека <input id="receipt-email" type="email" autocomplete="email" required></label>` : ""}<button id="pay">Оплатить</button><p id="status" role="status"></p><a href="/cabinet/dashboard">Вернуться в кабинет</a></main><script src="https://widget.cloudpayments.ru/bundles/cloudpayments.js"></script><script nonce="${nonce}">const b=document.getElementById('pay'),s=document.getElementById('status');b.onclick=async()=>{b.disabled=true;s.textContent='';try{const r=await fetch(location.pathname+'/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:document.getElementById('receipt-email')?.value,recurring:document.getElementById('recurring')?.checked===true})});const data=await r.json();if(!r.ok)throw Error(data.message);await new cp.CloudPayments().start(data.widget);s.textContent='Проверяем оплату. Подтверждение появится в истории платежей кабинета.';}catch(e){s.textContent=e.message||'Оплата не завершена';}finally{b.disabled=false}};</script></html>`);
}));

async function startCheckout(payment: NonNullable<Awaited<ReturnType<typeof checkoutOrder>>>, recurring: boolean, email?: string) {
  const cfg = await cloudConfig();
  if (!cfg.cloudpaymentsEnabled) throw new Error("CloudPayments отключён");
  const meta = readMetadata(payment.metadata);
  if (meta.cloudTrialDays && !recurring) throw new Error("Для платного пробного периода нужно согласие на автоплатёж. Обычный тариф доступен без автоплатежа.");
  if (recurring && (!payment.tariffId || meta.purchasedAsGift)) throw new Error("Автоплатёж недоступен для этого заказа");
  if (meta.cloudAcceptedAt && meta.cloudReceipt && receiptEmail(email) !== meta.cloudReceipt.email) throw new Error("Email уже закреплён за счётом. Используйте исходный email; для его изменения нужен новый счёт.");
  let receipt = meta.cloudAcceptedAt ? meta.cloudReceipt ?? null : buildCloudReceipt(cfg.cloudpaymentsReceipt, payment.amount, payment.tariff?.name || "Оплата заказа", email);
  const days = meta.cloudPeriodDays ?? payment.tariffPriceOption?.durationDays ?? payment.tariff?.durationDays ?? 30;
  let agreementId: string | null = null;
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${payment.clientId}))`;
    const latest = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
    const latestMeta = readMetadata(latest.metadata);
    if (latest.status !== "PENDING") throw new Error("Счёт уже оплачен");
    if (latestMeta.cloudAcceptedAt) {
      receipt = latestMeta.cloudReceipt ?? null;
      if (receipt && receiptEmail(email) !== receipt.email) throw new Error("Email уже закреплён за счётом. Используйте исходный email.");
    }
    if (meta.cloudTrialDays && await cloudTrialUsed(payment.clientId, tx)) throw new Error("Пробный период уже использован");
    if (latestMeta.cloudAgreementId) {
      if (!recurring) throw new Error("Для изменения условий создайте новый счёт");
      const existing = await tx.cloudPaymentAgreement.findUniqueOrThrow({ where: { id: latestMeta.cloudAgreementId } });
      if (existing.state !== "PENDING" || existing.nextChargeAt || existing.createRequestedAt) throw new Error("Согласие уже использовано или отменено. Создайте новый счёт.");
      agreementId = latestMeta.cloudAgreementId;
      return;
    }
    if (latestMeta.cloudAcceptedAt) {
      if (recurring) throw new Error("Для изменения условий создайте новый счёт");
      return;
    }
    if (recurring) {
      if (!isMultiSubscriptionsEnabled(cfg) && await tx.cloudPaymentAgreement.count({ where: { clientId: payment.clientId, subscriptionId: null, state: { in: ["PENDING", "ACTIVE", "PAST_DUE", "CANCEL_PENDING"] }, createdAt: { gte: new Date(Date.now() - 86_400_000) } } })) throw new Error("Сначала завершите или отмените предыдущий заказ с автоплатежом");
      if (meta.cloudTrialDays) {
        const others = await tx.cloudPaymentAgreement.findMany({ where: { clientId: payment.clientId, trialDays: { gt: 0 } } });
        for (const other of others) {
          const reserved = await tx.payment.findFirst({ where: { clientId: payment.clientId, provider: "cloudpayments", metadata: { contains: other.id }, status: { in: ["PENDING", "PAID"] } } });
          if (other.nextChargeAt || reserved?.status === "PAID" || reserved?.externalId || reserved && Date.now() - reserved.createdAt.getTime() < 86_400_000 && other.state === "PENDING") throw new Error("Пробный период уже заказан. Откройте предыдущий счёт в истории платежей.");
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
        receiptJson: receipt ? JSON.stringify(receipt) : null,
        consentText: `${payment.amount} RUB сейчас; ${amount} RUB каждые ${days} дней; пробный период ${meta.cloudTrialDays ?? 0} дней. Сумма зависит от текущей цены тарифа и устройств. Отмена пробного периода прекращает доступ.`,
      } });
      agreementId = agreement.id;
    }
    await tx.payment.update({ where: { id: payment.id }, data: { metadata: JSON.stringify({ ...latestMeta, cloudAgreementId: agreementId, cloudAccountId: agreementId || payment.clientId, cloudAcceptedAt: new Date().toISOString(), cloudTerminalId: cfg.publicId, cloudTestMode: cfg.cloudpaymentsTestMode, cloudReceipt: receipt }) } });
  });
  return { widget: { publicTerminalId: cfg.publicId, paymentSchema: "Single", currency: payment.currency, amount: payment.amount,
    description: payment.tariff?.name || "Оплата заказа", externalId: payment.orderId, culture: "ru-RU", skin: "modern",
    userInfo: { accountId: agreementId || payment.clientId, ...(receipt ? { email: receipt.email } : {}) },
    ...(receipt ? { receipt } : {}),
    ...(recurring ? { restrictedPaymentMethods: ["TcsInstallment", "Sbp", "TinkoffPay", "MirPay", "Dolyame", "ForeignCard", "SberPay"] } : {}),
  } };
}

cloudPublicRouter.post("/checkout/:orderId/start", asyncHandler(async (req, res) => {
  const payment = await checkoutOrder(req.params.orderId);
  if (!payment) return res.status(404).json({ message: "Счёт недоступен" });
  try { return res.json(await startCheckout(payment, req.body.recurring === true, req.body.email)); }
  catch (e) { return res.status(400).json({ message: e instanceof Error ? e.message : "Не удалось подготовить оплату" }); }
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

async function ownedCheckout(id: string, clientId: string) {
  const payment = await prisma.payment.findFirst({ where: { id, clientId, provider: "cloudpayments" } });
  if (!payment) return null;
  const meta = readMetadata(payment.metadata);
  if (meta.cloudAgreementId) {
    const agreement = await prisma.cloudPaymentAgreement.findUnique({ where: { id: meta.cloudAgreementId } });
    if (!agreement || agreement.state !== "PENDING") return null;
  }
  return checkoutOrder(payment.orderId);
}
async function checkoutQuote(payment: NonNullable<Awaited<ReturnType<typeof checkoutOrder>>>) {
  const cfg = await cloudConfig();
  const meta = readMetadata(payment.metadata);
  const recurring = !!payment.tariffId && !meta.purchasedAsGift;
  const terms = recurring ? `${payment.amount} ₽ сейчас${meta.cloudTrialDays ? ` за ${meta.cloudTrialDays} дн.` : ""}. Далее ${meta.cloudRegularAmount ?? payment.amount} ₽ каждые ${meta.cloudPeriodDays ?? 30} дней. При изменении тарифа или устройств сумма изменится. Отмена — в разделе «Автоплатежи» бота, в кабинете или на my.cloudpayments.ru. Отмена во время пробного периода сразу закрывает доступ.` : `${payment.amount} ₽. Разовая оплата, без автоплатежа.`;
  const quote = { product: payment.tariff?.name || "Оплата заказа", amount: payment.amount, currency: payment.currency, recurring, requiredRecurring: !!meta.cloudTrialDays, terms, receiptRequired: meta.cloudAcceptedAt ? !!meta.cloudReceipt : cfg.cloudpaymentsReceipt.enabled };
  return { ...quote, revision: meta.cloudHostedRevision || createHash("sha256").update(JSON.stringify([payment.id, quote, meta.cloudAcceptedAt ? meta.cloudReceipt : cfg.cloudpaymentsReceipt])).digest("hex").slice(0, 16) };
}
cloudClientRouter.get("/checkout/:id", asyncHandler(async (req, res) => {
  const payment = await ownedCheckout(req.params.id, (req as unknown as { clientId: string }).clientId);
  if (!payment) return res.status(404).json({ message: "Счёт недоступен" });
  return res.json(await checkoutQuote(payment));
}));
cloudClientRouter.post("/checkout/:id/hosted", asyncHandler(async (req, res) => {
  const clientId = (req as unknown as { clientId: string }).clientId;
  const payment = await ownedCheckout(req.params.id, clientId);
  if (!payment) return res.status(404).json({ message: "Счёт недоступен" });
  const cfg = await cloudConfig();
  if (!cfg.cloudpaymentsBotDirect || !cfg.cloudpaymentsEnabled) return res.status(403).json({ message: "Прямая оплата отключена администратором" });
  const quote = await checkoutQuote(payment);
  const oldMeta = readMetadata(payment.metadata);
  if (!oldMeta.cloudHostedRequest && req.body.revision !== quote.revision) return res.status(409).json({ message: "Условия изменились. Откройте оплату заново и подтвердите новые условия." });
  try {
    if (oldMeta.cloudHostedRequest && !!oldMeta.cloudAgreementId !== (req.body.recurring === true)) throw new Error("Условия уже закреплены за счётом. Для изменения автоплатежа создайте новый счёт.");
    if (oldMeta.cloudHostedRequest && oldMeta.cloudReceipt && receiptEmail(req.body.email) !== oldMeta.cloudReceipt.email) throw new Error("Email уже закреплён за счётом. Используйте исходный email.");
    if (!oldMeta.cloudHostedRequest) await startCheckout(payment, req.body.recurring === true, req.body.email);
    const request = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cloud-hosted:${payment.id}`}))`;
      const latest = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
      if (latest.status !== "PENDING") throw new Error("Счёт уже оплачен");
      const meta = readMetadata(latest.metadata);
      if (meta.cloudHostedUrl) return { url: String(meta.cloudHostedUrl), body: null };
      if (meta.cloudHostedRequestedAt && Date.now() - Date.parse(meta.cloudHostedRequestedAt) > 55 * 60_000) throw new Error("Результат создания ссылки требует проверки. Обратитесь в поддержку; новый платёж не создан.");
      const body = meta.cloudHostedRequest || {
        Amount: latest.amount, Currency: latest.currency, InvoiceId: latest.orderId,
        AccountId: meta.cloudAccountId, Description: quote.product + ". " + (meta.cloudAgreementId ? quote.terms : "Разовая оплата без автоплатежа."),
        RequireConfirmation: false, SendEmail: false, CultureName: "ru-RU",
        ...(meta.cloudReceipt ? { Email: meta.cloudReceipt.email, JsonData: { cloudpayments: { CustomerReceipt: meta.cloudReceipt } } } : {}),
      };
      await tx.payment.update({ where: { id: latest.id }, data: { metadata: JSON.stringify({ ...meta, cloudHostedRequest: body, cloudHostedRevision: quote.revision, cloudHostedRequestedAt: meta.cloudHostedRequestedAt || new Date().toISOString() }) } });
      return { url: null, body };
    });
    if (request.url) return res.json({ payUrl: request.url });
    const order = await cloudRequest<{ Id: string; Url: string }>(cfg, "orders/create", request.body, `checkout-${payment.id}`);
    const url = new URL(order.Url);
    if (url.protocol !== "https:" || url.hostname !== "orders.cloudpayments.ru") throw new Error("CloudPayments вернул неизвестный адрес оплаты");
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cloud-hosted:${payment.id}`}))`;
      const latest = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
      await tx.payment.update({ where: { id: payment.id }, data: { metadata: JSON.stringify({ ...readMetadata(latest.metadata), cloudHostedUrl: order.Url, cloudHostedId: order.Id }) } });
    });
    return res.json({ payUrl: order.Url });
  } catch (e) { return res.status(400).json({ message: e instanceof Error ? e.message : "Не удалось создать ссылку оплаты" }); }
}));
