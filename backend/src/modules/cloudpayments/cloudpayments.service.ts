import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { prisma } from "../../db.js";
import { env } from "../../config/index.js";
import { getSystemConfig } from "../client/client.service.js";
import { applyPercent } from "../client/personal-discount.js";
import { paymentSnapshotProduct } from "../bot/bot.service.js";
import { cloudRequest, money, subscriptionPrice, type CloudSubscription } from "./cloudpayments-api.js";

export const DAY = 86_400_000;
export function readMetadata(value: string | null): Record<string, any> {
  try { return JSON.parse(value || "{}"); } catch { return {}; }
}
export function encryptCardToken(token: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(env.JWT_SECRET + ":cloudpayments").digest(), nonce);
  const data = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [nonce, cipher.getAuthTag(), data].map(v => v.toString("base64url")).join(".");
}
function decryptCardToken(token: string): string {
  const [nonce, tag, data] = token.split(".").map(v => Buffer.from(v, "base64url"));
  const cipher = createDecipheriv("aes-256-gcm", createHash("sha256").update(env.JWT_SECRET + ":cloudpayments").digest(), nonce);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(data), cipher.final()]).toString("utf8");
}
export async function cloudConfig() {
  const config = await getSystemConfig();
  return { ...config, publicId: config.cloudpaymentsPublicId, apiSecret: config.cloudpaymentsApiSecret };
}
export async function currentAgreementPrice(id: string) {
  const agreement = await prisma.cloudPaymentAgreement.findUniqueOrThrow({ where: { id }, include: { subscription: true } });
  if (agreement.nextChargeAt && agreement.subscription?.tariffId !== agreement.tariffId) throw new Error("Тариф подписки изменился: требуется новое согласие на автоплатёж");
  const tariff = await prisma.tariff.findUniqueOrThrow({ where: { id: agreement.tariffId }, include: { priceOptions: true } });
  const option = agreement.priceOptionId ? tariff.priceOptions.find(p => p.id === agreement.priceOptionId) : null;
  if (agreement.priceOptionId && !option) throw new Error("Период тарифа удалён: автоплатёж требует перенастройки");
  if (tariff.currency.toUpperCase() !== agreement.currency) throw new Error("Валюта тарифа изменилась: требуется новое согласие");
  const days = option?.durationDays ?? tariff.durationDays;
  if (days !== agreement.periodDays) throw new Error("Период тарифа изменился: требуется новое согласие");
  const amount = subscriptionPrice(option?.price ?? tariff.price, agreement.subscription?.extraDevicesMonthlyPrice ?? 0, days);
  const client = await prisma.client.findUniqueOrThrow({ where: { id: agreement.clientId } });
  const discounted = client.personalDiscountIsOneTime ? amount : applyPercent(amount, client.personalDiscountPercent ?? 0);
  const snapshot = await paymentSnapshotProduct(agreement.clientId, discounted);
  if (snapshot.amount < 1) throw new Error("Сумма автоплатежа меньше 1");
  return { amount: money(snapshot.amount), days, tariff, agreement };
}

export async function cancelCloudAgreement(id: string, clientId?: string) {
  const agreement = await prisma.cloudPaymentAgreement.findUniqueOrThrow({ where: { id } });
  if (clientId && agreement.clientId !== clientId) throw new Error("Подписка не найдена");
  if (["CANCELLED", "COMPLETED", "EXPIRED"].includes(agreement.state)) return;
  await prisma.cloudPaymentAgreement.update({ where: { id }, data: { state: "CANCEL_PENDING" } });
  await syncCloudAgreement(id);
}

export async function syncCloudAgreement(id: string) {
  const cfg = await cloudConfig();
  const row = await prisma.cloudPaymentAgreement.findUniqueOrThrow({ where: { id }, include: { subscription: true } });
  if (row.terminalId !== cfg.publicId) throw new Error("Терминал CloudPayments изменён");
  if (["CANCELLED", "COMPLETED", "REJECTED"].includes(row.state)) return;
  let provider: CloudSubscription | undefined;
  if (row.providerId) provider = await cloudRequest<CloudSubscription>(cfg, "subscriptions/get", { Id: row.providerId });
  else if (row.createRequestedAt) {
    const plans = await cloudRequest<CloudSubscription[]>(cfg, "subscriptions/find", { AccountId: row.id });
    if (plans.length > 1) throw new Error("Найдено несколько автоплатежей: требуется проверка");
    provider = plans[0];
    if (provider) await prisma.cloudPaymentAgreement.update({ where: { id }, data: { providerId: provider.Id } });
  }
  if (provider && provider.AccountId !== row.id) throw new Error("CloudPayments account mismatch");
  if (provider && ["Cancelled", "Completed", "Rejected"].includes(provider.Status)) {
    await prisma.cloudPaymentAgreement.update({ where: { id }, data: { state: provider.Status.toUpperCase(), tokenEncrypted: null } });
    if (provider.Status === "Cancelled" || row.state === "CANCEL_PENDING") await applyCloudCancellation(id);
    return;
  }
  if (row.state === "CANCEL_PENDING") {
    if (provider) await cloudRequest(cfg, "subscriptions/cancel", { Id: provider.Id }, `cancel-${id}`);
    else if (row.createRequestedAt) throw new Error("Создание автоплатежа ещё сверяется с CloudPayments");
    await prisma.cloudPaymentAgreement.update({ where: { id }, data: { state: "CANCELLED", tokenEncrypted: null } });
    await applyCloudCancellation(id);
    return;
  }
  if (!row.subscriptionId || !row.nextChargeAt) return;
  if (row.subscription && row.subscription.tariffId !== row.tariffId) {
    await prisma.cloudPaymentAgreement.update({ where: { id }, data: { state: "CANCEL_PENDING", trialEndsAt: null, graceEndsAt: null, lastError: "Тариф подписки изменён. Для нового тарифа требуется новое согласие." } });
    await syncCloudAgreement(id);
    return;
  }
  if (!row.graceEndsAt && row.state === "ACTIVE" && row.subscription?.expireAt && row.subscription.expireAt.getTime() > row.nextChargeAt.getTime() + 60_000) {
    row.nextChargeAt = row.subscription.expireAt;
    row.trialEndsAt = null;
    await prisma.cloudPaymentAgreement.update({ where: { id }, data: { nextChargeAt: row.nextChargeAt, trialEndsAt: null } });
  }
  if (!row.tokenEncrypted) throw new Error("CloudPayments не передал токен карты. Проверьте сохранение токена в настройках терминала.");
  const quote = await currentAgreementPrice(id);
  if (!provider) {
    if (row.createRequestedAt && Date.now() - row.createRequestedAt.getTime() > 55 * 60_000) throw new Error("Неопределённый результат создания автоплатежа: требуется сверка");
    const started = row.createRequestedAt ?? new Date();
    await prisma.cloudPaymentAgreement.update({ where: { id }, data: { createRequestedAt: started } });
    provider = await cloudRequest<CloudSubscription>(cfg, "subscriptions/create", {
      Token: decryptCardToken(row.tokenEncrypted), AccountId: id,
      Description: `${quote.tariff.name}: каждые ${quote.days} дней`, Amount: quote.amount,
      Currency: row.currency, RequireConfirmation: false,
      StartDate: new Date(Math.max(row.nextChargeAt.getTime(), started.getTime() + 60_000)).toISOString(),
      Interval: "Day", Period: quote.days,
    }, `agreement-${id}`);
  } else {
    const dateText = provider.NextTransactionDateIso;
    const providerDate = dateText ? new Date(/[zZ]|[+-]\d{2}:\d{2}$/.test(dateText) ? dateText : `${dateText}Z`).getTime() : NaN;
    const adjustDate = row.nextChargeAt.getTime() > Date.now() + 60_000 && Number.isFinite(providerDate) && Math.abs(providerDate - row.nextChargeAt.getTime()) > 60_000;
    if (money(provider.Amount) !== quote.amount || adjustDate) {
      if (provider.Status !== "Active" && provider.Status !== "PastDue") throw new Error("Автоплатёж не активен");
      provider = await cloudRequest<CloudSubscription>(cfg, "subscriptions/update", { Id: provider.Id, Amount: quote.amount, ...(adjustDate ? { StartDate: row.nextChargeAt.toISOString() } : {}) }, `price-${id}-${quote.amount}-${row.nextChargeAt.getTime()}`);
    }
  }
  const latest = await prisma.cloudPaymentAgreement.findUniqueOrThrow({ where: { id } });
  if (latest.state === "CANCEL_PENDING" || latest.state === "CANCELLED") {
    await prisma.cloudPaymentAgreement.update({ where: { id }, data: { providerId: provider.Id, state: "CANCEL_PENDING" } });
    await cloudRequest(cfg, "subscriptions/cancel", { Id: provider.Id }, `cancel-${id}`);
    await prisma.cloudPaymentAgreement.update({ where: { id }, data: { state: "CANCELLED", tokenEncrypted: null } });
    await applyCloudCancellation(id);
    return;
  }
  await prisma.cloudPaymentAgreement.update({ where: { id }, data: {
    providerId: provider.Id, amount: quote.amount, state: provider.Status === "PastDue" ? "PAST_DUE" : "ACTIVE", lastError: null,
  } });
}

export async function applyCloudCancellation(id: string) {
  const row = await prisma.cloudPaymentAgreement.findUniqueOrThrow({ where: { id }, include: { subscription: true } });
  const sub = row.subscription;
  if (!sub) return;
  await prisma.subscription.update({ where: { id: sub.id }, data: { autoRenewEnabled: false } });
  if (!row.trialEndsAt) return;
  if (!sub.remnawaveUuid) return;
  const { remnaUpdateUser } = await import("../remna/remna.client.js");
  const result = await remnaUpdateUser({ uuid: sub.remnawaveUuid, expireAt: new Date().toISOString(), status: "DISABLED" });
  if (result.error) throw new Error("Не удалось остановить пробный доступ");
  await prisma.subscription.update({ where: { id: sub.id }, data: { expireAt: new Date(), remnaStatus: "DISABLED" } });
  await prisma.cloudPaymentAgreement.update({ where: { id }, data: { trialEndsAt: null, graceEndsAt: null } });
}
