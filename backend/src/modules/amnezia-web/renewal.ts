import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import { isWebPanel } from "./api.js";
import { applyPercent } from "../client/personal-discount.js";

export class WebRenewalError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

async function renewalQuote(tx: Prisma.TransactionClient, clientId: string, slotId: string) {
  const slot = await tx.singboxSlot.findFirst({ where: { id: slotId, clientId }, include: { node: true, singboxTariff: true, client: true } });
  if (!slot || !isWebPanel(slot.node.protocol)) throw new WebRenewalError("Доступ не найден", 404);
  if (slot.client.isBlocked || slot.status !== "ACTIVE" || slot.node.status === "DISABLED") throw new WebRenewalError("Продление этого доступа недоступно");
  const original = slot.sourcePaymentId ? await tx.payment.findUnique({ where: { id: slot.sourcePaymentId } }) : null;
  if (original?.status !== "PAID") throw new WebRenewalError("Исходная покупка отменена");
  const tariff = slot.singboxTariff;
  if (!tariff?.enabled || tariff.protocol !== slot.node.protocol || tariff.slotCount < 1 || tariff.durationDays < 1) throw new WebRenewalError("Тариф больше недоступен для продления");
  const price = Math.ceil(tariff.price * 100 / tariff.slotCount) / 100;
  const percent = Math.max(0, Math.min(100, slot.client.personalDiscountPercent || 0));
  const amount = applyPercent(price, percent);
  if (!Number.isFinite(amount) || amount < 0) throw new WebRenewalError("Некорректная цена тарифа");
  const quote = { slotId, tariffId: tariff.id, name: tariff.name, amount, currency: tariff.currency.toUpperCase(), durationDays: tariff.durationDays, trafficBytes: tariff.trafficLimitBytes?.toString() ?? null, personalDiscountPercent: percent };
  const quoteHash = createHash("sha256").update(JSON.stringify(quote)).digest("hex");
  return { slot, quote: { ...quote, quoteHash, balance: slot.client.balance } };
}

export async function quoteWebRenewal(clientId: string, slotId: string) {
  return (await renewalQuote(prisma, clientId, slotId)).quote;
}

export async function refreshWebEntitlements(nodeId: string) {
  const slots = await prisma.singboxSlot.findMany({ where: { nodeId, renewalBaseExpiresAt: { not: null } }, include: { renewals: { include: { payment: { select: { status: true } } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] } } });
  for (const slot of slots) {
    let expires = slot.renewalBaseExpiresAt!.getTime();
    let limit = slot.renewalBaseTrafficLimitBytes;
    for (const grant of slot.renewals) {
      if (grant.payment.status !== "PAID") continue;
      expires = Math.max(expires, grant.createdAt.getTime()) + grant.durationDays * 86400000;
      limit = !limit || !grant.trafficBytes ? null : limit + grant.trafficBytes;
    }
    expires += slot.renewalAdjustmentMs;
    if (expires !== slot.expiresAt.getTime() || limit !== slot.trafficLimitBytes) await prisma.singboxSlot.update({ where: { id: slot.id }, data: { expiresAt: new Date(expires), trafficLimitBytes: limit, syncPending: true } });
  }
}

export async function buyWebRenewal(clientId: string, slotId: string, requestId: string, quoteHash: string) {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(741963)`;
    const orderId = `awp-renew:${clientId}:${requestId}`;
    const previous = await tx.payment.findUnique({ where: { orderId }, include: { singboxRenewal: true } });
    if (previous) {
      if (previous.singboxRenewal?.slotId !== slotId || previous.status !== "PAID") throw new WebRenewalError("Этот запрос уже использован для другой или отменённой операции", 409);
      return { paymentId: previous.id, repeated: true };
    }
    const { slot, quote } = await renewalQuote(tx, clientId, slotId);
    if (quote.quoteHash !== quoteHash) throw new WebRenewalError("Цена или параметры изменились. Откройте продление заново", 409);
    const debited = await tx.client.updateMany({ where: { id: clientId, isBlocked: false, balance: { gte: quote.amount }, personalDiscountPercent: slot.client.personalDiscountPercent }, data: { balance: { decrement: quote.amount } } });
    if (debited.count !== 1) throw new WebRenewalError("Недостаточно средств или изменилась скидка. Обновите страницу", 409);
    const payment = await tx.payment.create({ data: { clientId, orderId, amount: quote.amount, currency: quote.currency, status: "PAID", provider: "balance", paidAt: new Date(), singboxTariffId: slot.singboxTariffId, metadata: JSON.stringify({ awpRenewal: true, slotId, personalDiscountPercent: quote.personalDiscountPercent }) } });
    await tx.singboxRenewal.create({ data: { slotId, paymentId: payment.id, durationDays: quote.durationDays, trafficBytes: slot.singboxTariff!.trafficLimitBytes } });
    await tx.singboxSlot.update({ where: { id: slotId }, data: { ...(slot.renewalBaseExpiresAt ? {} : { renewalBaseExpiresAt: slot.expiresAt, renewalBaseTrafficLimitBytes: slot.trafficLimitBytes }), syncPending: true } });
    if (slot.client.personalDiscountIsOneTime) await tx.client.update({ where: { id: clientId }, data: { personalDiscountPercent: 0, personalDiscountIsOneTime: false } });
    return { paymentId: payment.id, repeated: false };
  }, { maxWait: 10000, timeout: 30000 });
}

export async function refundWebRenewal(paymentId: string, refundToBalance: boolean, reverseReferrals: boolean) {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(741963)`;
    const payment = await tx.payment.findUnique({ where: { id: paymentId }, include: { singboxRenewal: true } });
    if (!payment?.singboxRenewal || payment.status !== "PAID") throw new WebRenewalError("Продление уже отменено или не оплачено", 409);
    let reversedReferralAmount = 0;
    let reversedReferralCount = 0;
    if (reverseReferrals) {
      const credits = await tx.referralCredit.findMany({ where: { paymentId } });
      for (const credit of credits) {
        if (credit.amount > 0) {
          await tx.client.update({ where: { id: credit.referrerId }, data: { balance: { decrement: credit.amount } } });
          reversedReferralAmount += credit.amount;
          reversedReferralCount++;
        }
      }
      await tx.referralCredit.deleteMany({ where: { paymentId } });
    }
    if (refundToBalance) await tx.client.update({ where: { id: payment.clientId }, data: { balance: { increment: payment.amount } } });
    await tx.singboxSlot.update({ where: { id: payment.singboxRenewal.slotId }, data: { syncPending: true } });
    const updated = await tx.payment.update({ where: { id: paymentId }, data: { status: "REFUNDED" } });
    return { ok: true, payment: updated, summary: { creditedToBalance: refundToBalance ? payment.amount : 0, reversedReferralAmount, reversedReferralCount } };
  }, { maxWait: 10000, timeout: 30000 });
}
