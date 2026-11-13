import { extinguishOneTimeDiscount } from "../client/personal-discount.js";
import { notifyBalanceToppedUp, notifyTariffActivated, notifyTariffActivationFailed, notifyExtraOptionApplied, notifyProxySlotsCreated, notifySingboxSlotsCreated } from "../notification/telegram-notify.service.js";
import { prisma } from "../../db.js";
import { getSystemConfig } from "../client/client.service.js";
import { activateTariffByPaymentId } from "../tariff/tariff-activation.service.js";
import { createProxySlotsByPaymentId } from "../proxy/proxy-slots-activation.service.js";
import { createSingboxSlotsByPaymentId } from "../singbox/singbox-slots-activation.service.js";
import { applyExtraOptionByPaymentId } from "../extra-options/extra-options.service.js";
import { distributeReferralRewards } from "../referral/referral.service.js";
import { recordPromoCodeUsageFromPayment } from "../payment/promo-code-usage.util.js";
import { starsApi } from "./stars-api.js";

type StarsMetadata = { total: number; telegramId: string; botId: string; expiresAt: number; checkoutId?: string; delivery?: string; balanceCredited?: boolean; error?: string };
export type StarsReceipt = { paymentId: string; telegramId: string; currency: string; totalAmount: number; chargeId?: string; checkoutId?: string };
function metadata(raw: string | null): Record<string, unknown> & { stars: StarsMetadata } {
  const data = JSON.parse(raw || "{}");
  if (!data.stars || !Number.isSafeInteger(data.stars.total) || data.stars.total < 1) throw new Error("Счёт Stars не найден");
  return data;
}
function matches(payment: { provider: string | null; metadata: string | null }, receipt: StarsReceipt) {
  const meta = metadata(payment.metadata);
  if (payment.provider !== "telegram_stars" || receipt.currency !== "XTR" || receipt.totalAmount !== meta.stars.total || receipt.telegramId !== meta.stars.telegramId || meta.stars.botId !== process.env.BOT_TOKEN?.split(":")[0]) {
    throw new Error("Получатель или сумма счёта не совпадают");
  }
  return meta;
}
export async function checkStarsCheckout(receipt: StarsReceipt) {
  const config = await getSystemConfig();
  if (!config.telegramStarsEnabled) throw new Error("Оплата Stars временно отключена");
  if (!receipt.checkoutId) throw new Error("Отсутствует запрос подтверждения Telegram");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM payments WHERE id = ${receipt.paymentId} FOR UPDATE`;
    const payment = await tx.payment.findUnique({ where: { id: receipt.paymentId }, include: { client: true } });
    if (!payment) throw new Error("Счёт не найден");
    const meta = matches(payment, receipt);
    if (payment.status !== "PENDING" || meta.stars.expiresAt < Date.now()) throw new Error("Счёт уже оплачен или истёк. Создайте новый.");
    if (payment.client.isBlocked || payment.client.telegramId !== receipt.telegramId) throw new Error("Оплата для этого аккаунта недоступна");
    if (meta.stars.checkoutId && meta.stars.checkoutId !== receipt.checkoutId) throw new Error("Этот счёт уже подтверждается. Если оплату отменили, создайте новый.");
    meta.stars.checkoutId = receipt.checkoutId;
    await tx.payment.update({ where: { id: payment.id }, data: { metadata: JSON.stringify(meta) } });
    return { ok: true };
  });
}
export async function receiveStarsPayment(receipt: StarsReceipt) {
  if (!receipt.chargeId) throw new Error("Отсутствует идентификатор оплаты Telegram");
  const accepted = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"stars-charge:" + receipt.chargeId}, 0))`;
    await tx.$queryRaw`SELECT id FROM payments WHERE id = ${receipt.paymentId} FOR UPDATE`;
    const payment = await tx.payment.findUnique({ where: { id: receipt.paymentId } });
    if (!payment) throw new Error("Счёт не найден");
    const meta = matches(payment, receipt);
    if (payment.externalId && payment.externalId !== receipt.chargeId) throw new Error("Счёт уже оплачен другим платежом");
    if (await tx.payment.findFirst({ where: { provider: "telegram_stars", externalId: receipt.chargeId, id: { not: payment.id } } })) throw new Error("Оплата уже относится к другому счёту");
    if (payment.status === "PAID" || payment.status === "REFUNDED") return { payment, fresh: false };
    const topup = !payment.tariffId && !payment.proxyTariffId && !payment.singboxTariffId && !meta.extraOption && !meta.customBuild;
    meta.stars = { ...meta.stars, delivery: topup ? "delivered" : "pending", balanceCredited: topup };
    if (topup) await tx.client.update({ where: { id: payment.clientId }, data: { balance: { increment: payment.amount } } });
    const updated = await tx.payment.update({ where: { id: payment.id }, data: { status: "PAID", externalId: receipt.chargeId, paidAt: new Date(), metadata: JSON.stringify(meta) } });
    return { payment: updated, fresh: true };
  });
  if (accepted.payment.status === "REFUNDED") return { ok: true, delivery: "refunded" };
  const delivery = await deliverStarsPayment(accepted.payment.id);
  if (accepted.fresh && metadata(accepted.payment.metadata).stars.balanceCredited) {
    await notifyBalanceToppedUp(accepted.payment.clientId, accepted.payment.amount, accepted.payment.currency, "Telegram Stars").catch(() => {});
  }
  await recordPromoCodeUsageFromPayment(accepted.payment.id).catch(() => {});
  await distributeReferralRewards(accepted.payment.id).catch(() => {});
  return { ok: true, delivery };
}
async function deliverStarsPayment(id: string): Promise<string> {
  const claimed = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM payments WHERE id = ${id} FOR UPDATE`;
    const payment = await tx.payment.findUniqueOrThrow({ where: { id } });
    const meta = metadata(payment.metadata);
    if (payment.status !== "PAID" || meta.stars.delivery !== "pending") return { payment, meta, claimed: false };
    meta.stars.delivery = "processing";
    await tx.payment.update({ where: { id }, data: { metadata: JSON.stringify(meta) } });
    return { payment, meta, claimed: true };
  });
  if (!claimed.claimed) return claimed.meta.stars.delivery || "pending";
  let error: string | undefined;
  let balanceCredited = false;
  let slotIds: string[] = [];
  try {
    const p = claimed.payment;
    const result = claimed.meta.extraOption ? await applyExtraOptionByPaymentId(id)
      : p.proxyTariffId ? await createProxySlotsByPaymentId(id)
      : p.singboxTariffId ? await createSingboxSlotsByPaymentId(id)
      : await activateTariffByPaymentId(id);
    if ("slotIds" in result) slotIds = result.slotIds;
    balanceCredited = "creditedToBalance" in result && Boolean(result.creditedToBalance);
    if (!result.ok) error = result.error || "Не удалось выдать покупку";
  } catch {
    error = "Оплата получена, выдача требует проверки администратора";
  }
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM payments WHERE id = ${id} FOR UPDATE`;
    const latest = await tx.payment.findUniqueOrThrow({ where: { id } });
    const meta = metadata(latest.metadata);
    meta.stars = { ...meta.stars, delivery: error ? "failed" : "delivered", error, balanceCredited };
    await tx.payment.update({ where: { id }, data: { metadata: JSON.stringify(meta) } });
  });
  const p = claimed.payment;
  if (error) await notifyTariffActivationFailed(p.clientId, id, error).catch(() => {});
  else {
    await extinguishOneTimeDiscount(p.clientId).catch(() => {});
    if (claimed.meta.extraOption) await notifyExtraOptionApplied(p.clientId, id).catch(() => {});
    else if (p.proxyTariffId) await notifyProxySlotsCreated(p.clientId, slotIds).catch(() => {});
    else if (p.singboxTariffId) await notifySingboxSlotsCreated(p.clientId, slotIds).catch(() => {});
    else await notifyTariffActivated(p.clientId, id).catch(() => {});
  }
  return error ? "failed" : "delivered";
}
export async function refundStarsPayment(id: string, confirmed?: StarsReceipt) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM payments WHERE id = ${id} FOR UPDATE`;
    const payment = await tx.payment.findUniqueOrThrow({ where: { id } });
    if (payment.provider !== "telegram_stars" || !payment.externalId) throw new Error("Оплата Stars не найдена");
    const meta = metadata(payment.metadata);
    if (meta.stars.botId !== process.env.BOT_TOKEN?.split(":")[0]) throw new Error("Этот платёж относится к другому боту");
    if (confirmed) {
      matches(payment, confirmed);
      if (payment.externalId !== confirmed.chargeId) throw new Error("Идентификатор возврата не совпадает");
    }
    if (payment.status === "REFUNDED") return payment;
    if (payment.status !== "PAID" || meta.stars.delivery === "processing") throw new Error("Дождитесь завершения обработки платежа");
    try {
      if (!confirmed) await starsApi("refundStarPayment", { user_id: Number(meta.stars.telegramId), telegram_payment_charge_id: payment.externalId });
    } catch (e) {
      if (!(e instanceof Error) || !e.message.includes("CHARGE_ALREADY_REFUNDED")) throw e;
    }
    if (meta.stars.balanceCredited) await tx.client.update({ where: { id: payment.clientId }, data: { balance: { decrement: payment.amount } } });
    const credits = await tx.referralCredit.findMany({ where: { paymentId: id } });
    for (const credit of credits) if (credit.amount > 0) await tx.client.update({ where: { id: credit.referrerId }, data: { balance: { decrement: credit.amount } } });
    await tx.referralCredit.deleteMany({ where: { paymentId: id } });
    return tx.payment.update({ where: { id }, data: { status: "REFUNDED" } });
  }, { timeout: 25000 });
}
let reconciling = false;
export async function reconcileStarsPayments() {
  if (reconciling || !process.env.BOT_TOKEN) return;
  reconciling = true;
  try {
    if (!await prisma.payment.findFirst({ where: { provider: "telegram_stars" } })) return;
    const key = `telegram_stars_offset_${process.env.BOT_TOKEN.split(":")[0]}`;
    let offset = Number((await prisma.systemSetting.findUnique({ where: { key } }))?.value || 0);
    if (!Number.isSafeInteger(offset) || offset < 0) offset = 0;
    for (let page = 0; page < 10; page++) {
      const result = await starsApi<{ transactions: Array<{ id: string; amount: number; source?: { type: string; transaction_type?: string; user?: { id: number }; invoice_payload?: string }; receiver?: { type: string; user?: { id: number } } }> }>("getStarTransactions", { offset, limit: 100 });
      for (const entry of result.transactions) {
        const source = entry.source;
        if (source?.type === "user" && source.transaction_type === "invoice_payment" && source.invoice_payload?.startsWith("snstars:")) {
          const paymentId = source.invoice_payload.slice(8);
          if (await prisma.payment.findUnique({ where: { id: paymentId }, select: { id: true } })) {
            await receiveStarsPayment({ paymentId, telegramId: String(source.user?.id), currency: "XTR", totalAmount: entry.amount, chargeId: entry.id });
          }
        } else if (entry.receiver?.type === "user") {
          const payment = await prisma.payment.findFirst({ where: { provider: "telegram_stars", externalId: entry.id } });
          if (payment) await refundStarsPayment(payment.id, { paymentId: payment.id, telegramId: String(entry.receiver.user?.id), currency: "XTR", totalAmount: Math.abs(entry.amount), chargeId: entry.id });
        }
        offset++;
        await prisma.systemSetting.upsert({ where: { key }, create: { key, value: String(offset) }, update: { value: String(offset) } });
      }
      if (result.transactions.length < 100) break;
    }
  } finally { reconciling = false; }
}
