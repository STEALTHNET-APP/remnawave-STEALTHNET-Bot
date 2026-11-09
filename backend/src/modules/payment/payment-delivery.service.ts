import { prisma } from "../../db.js";
import { activateTariffByPaymentId } from "../tariff/tariff-activation.service.js";
import { createProxySlotsByPaymentId } from "../proxy/proxy-slots-activation.service.js";
import { createSingboxSlotsByPaymentId } from "../singbox/singbox-slots-activation.service.js";
import { applyExtraOptionByPaymentId } from "../extra-options/extra-options.service.js";
import { distributeReferralRewards } from "../referral/referral.service.js";
import { recordPromoCodeUsageFromPayment } from "./promo-code-usage.util.js";
import { extinguishOneTimeDiscount } from "../client/personal-discount.js";
import { handlePaymentActivationResult } from "./payment-fulfillment.util.js";
import { notifyBalanceToppedUp, notifyExtraOptionApplied, notifyProxySlotsCreated, notifySingboxSlotsCreated } from "../notification/telegram-notify.service.js";

function metadata(raw: string | null): Record<string, unknown> {
  try { const m = JSON.parse(raw || "{}"); return m && typeof m === "object" && !Array.isArray(m) ? m : {}; } catch { return {}; }
}

export async function acceptPaidPayment(paymentId: string, provider: string, externalId: string) {
  const result = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM payments WHERE id = ${paymentId} FOR UPDATE`;
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    if (payment.provider !== provider) throw new Error("Payment provider mismatch");
    const meta = metadata(payment.metadata);
    const product = !!(payment.tariffId || payment.proxyTariffId || payment.singboxTariffId || meta.extraOption || meta.customBuild);
    const claim = await tx.payment.updateMany({ where: { id: paymentId, status: { in: ["PENDING", "FAILED"] } }, data: {
      status: "PAID", paidAt: new Date(), externalId,
      ...(product ? { metadata: JSON.stringify({ ...meta, activationError: "Оплата получена. Выдача покупки ожидает обработки.", activationFailedAt: new Date().toISOString() }) } : {}),
    } });
    if (!claim.count) return { payment, accepted: false, product };
    if (product) await tx.paymentDelivery.create({ data: { paymentId } });
    else await tx.client.update({ where: { id: payment.clientId }, data: { balance: { increment: payment.amount } } });
    return { payment, accepted: true, product };
  });
  if (result.accepted && !result.product) {
    await notifyBalanceToppedUp(result.payment.clientId, result.payment.amount, result.payment.currency, provider).catch(() => {});
    await distributeReferralRewards(paymentId).catch(() => {});
  }
  return result;
}

export async function processPaymentDelivery(paymentId: string): Promise<void> {
  const startedAt = new Date();
  const claim = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM payments WHERE id = ${paymentId} FOR UPDATE`;
    const payment = await tx.payment.findUnique({ where: { id: paymentId } });
    if (payment?.status !== "PAID") return { count: 0 };
    return tx.paymentDelivery.updateMany({ where: { paymentId, state: "PENDING" }, data: { state: "PROCESSING", startedAt } });
  });
  if (!claim.count) return;
  const p = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
  const meta = metadata(p.metadata);
  let result: { ok: boolean; error?: string };
  try {
    if (p.status !== "PAID") throw new Error("Статус платежа изменён. Нужна ручная сверка.");
    if (meta.extraOption) {
      result = await applyExtraOptionByPaymentId(p.id);
      if (result.ok) await notifyExtraOptionApplied(p.clientId, p.id).catch(() => {});
    } else if (p.proxyTariffId) {
      const r = await createProxySlotsByPaymentId(p.id); result = r;
      if (r.ok) await notifyProxySlotsCreated(p.clientId, r.slotIds).catch(() => {});
    } else if (p.singboxTariffId) {
      const r = await createSingboxSlotsByPaymentId(p.id); result = r;
      if (r.ok) await notifySingboxSlotsCreated(p.clientId, r.slotIds).catch(() => {});
    } else {
      result = await activateTariffByPaymentId(p.id);
    }
  } catch (e) { result = { ok: false, error: e instanceof Error ? e.message : "Неизвестный результат выдачи покупки" }; }
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM payments WHERE id = ${paymentId} FOR UPDATE`;
    const saved = await tx.paymentDelivery.updateMany({ where: { paymentId, state: "PROCESSING", startedAt }, data: { state: result.ok ? "DONE" : "REVIEW", error: result.error ?? null, completedAt: result.ok ? new Date() : null } });
    if (!saved.count) return;
    const fresh = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, select: { metadata: true } });
    const m = metadata(fresh.metadata);
    if (result.ok) { delete m.activationError; delete m.activationFailedAt; }
    else { m.activationError = result.error || "Не удалось выдать покупку"; m.activationFailedAt = new Date().toISOString(); }
    await tx.payment.update({ where: { id: paymentId }, data: { metadata: JSON.stringify(m) } });
  });
  if (result.ok) {
    await recordPromoCodeUsageFromPayment(paymentId).catch(() => {});
    await extinguishOneTimeDiscount(p.clientId).catch(() => {});
    await distributeReferralRewards(paymentId).catch(() => {});
  }
  if (!result.ok || p.tariffId || meta.customBuild) await handlePaymentActivationResult({ paymentId, clientId: p.clientId, amount: p.amount, currency: p.currency, provider: p.provider || "", activation: result });
}

export async function processPaymentDeliveries() {
  const stale = new Date(Date.now() - 10 * 60_000);
  await prisma.paymentDelivery.updateMany({ where: { state: "PROCESSING", startedAt: { lt: stale } }, data: { state: "REVIEW", error: "Обработка прервана. Сверьте выдачу с VPN-сервером перед повтором." } });
  const jobs = await prisma.paymentDelivery.findMany({ where: { state: "PENDING" }, orderBy: { createdAt: "asc" }, take: 20, select: { paymentId: true } });
  for (const job of jobs) await processPaymentDelivery(job.paymentId).catch(e => console.error("[payment-delivery]", job.paymentId, e instanceof Error ? e.message : "failed"));
}

export function startPaymentDeliveryScheduler() {
  let busy = false;
  const tick = async () => { if (busy) return; busy = true; try { await processPaymentDeliveries(); } catch (e) { console.error("[payment-delivery] scheduler failed", e); } finally { busy = false; } };
  const timer = setInterval(() => { void tick(); }, 15_000); timer.unref(); void tick();
}
