/**
 * Отметить платёж как оплаченный: обновление статуса, начисление баланса (топ-ап),
 * активация тарифа/прокси/singbox, реферальные бонусы.
 * Используется в веб-админке и в бот-админке.
 */

import { prisma } from "../../db.js";
import { distributeReferralRewards } from "../referral/referral.service.js";
import { activateTariffByPaymentId } from "../tariff/tariff-activation.service.js";
import { createProxySlotsByPaymentId } from "../proxy/proxy-slots-activation.service.js";
import { createSingboxSlotsByPaymentId } from "../singbox/singbox-slots-activation.service.js";
import { applyExtraOptionByPaymentId } from "../extra-options/extra-options.service.js";
import { notifyProxySlotsCreated, notifySingboxSlotsCreated, notifyBalanceToppedUp } from "../notification/telegram-notify.service.js";
import { auditPaymentClientBotAlignment } from "./payment-webhook-audit.util.js";
import { extinguishOneTimeDiscount } from "../client/personal-discount.js";

function parseMetadata(raw: string | null): Record<string, unknown> {
  if (!raw?.trim()) return {};
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
}

export type MarkPaymentPaidResult = {
  ok: boolean;
  payment: Awaited<ReturnType<typeof prisma.payment.findUnique>>;
  referral?: Awaited<ReturnType<typeof distributeReferralRewards>>;
  activation?: { ok: boolean; error?: string };
  proxySlots?: { ok: boolean; slotsCreated?: number; error?: string };
  balanceCredited?: boolean;
  error?: string;
};

export async function markPaymentPaid(paymentId: string): Promise<MarkPaymentPaidResult> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) {
    return { ok: false, payment: null, error: "Payment not found" };
  }
  if (payment.provider === "telegram_stars") return { ok: false, payment, error: "Оплату Stars подтверждает только Telegram" };
  await auditPaymentClientBotAlignment({
    id: payment.id,
    clientId: payment.clientId,
  });
  if (payment.status === "PAID") {
    const result = await distributeReferralRewards(paymentId);
    const updated = await prisma.payment.findUnique({ where: { id: paymentId } });
    return { ok: true, payment: updated ?? payment, referral: result };
  }
  const now = new Date();
  const meta = parseMetadata(payment.metadata);
  const isExtraOption = Boolean(meta.extraOption);
  const isCustomBuild = Boolean(meta.customBuild);
  const isTopUp = !payment.tariffId && !payment.proxyTariffId && !payment.singboxTariffId && !isExtraOption && !isCustomBuild;

  let claimed = false;
  if (isTopUp) {
    claimed = await prisma.$transaction(async (tx) => {
      const flip = await tx.payment.updateMany({
        where: { id: paymentId, status: "PENDING" },
        data: { status: "PAID", paidAt: now },
      });
      if (flip.count > 0) {
        await tx.client.update({
          where: { id: payment.clientId },
          data: { balance: { increment: payment.amount } },
        });
      }
      return flip.count > 0;
    });
  } else {
    const flip = await prisma.payment.updateMany({
      where: { id: paymentId, status: "PENDING" },
      data: { status: "PAID", paidAt: now },
    });
    claimed = flip.count > 0;
  }

  if (!claimed) {
    const updated = await prisma.payment.findUnique({ where: { id: paymentId } });
    const result = await distributeReferralRewards(paymentId);
    return { ok: true, payment: updated ?? payment, referral: result };
  }

  if (isTopUp) {
    await notifyBalanceToppedUp(payment.clientId, payment.amount, payment.currency || "RUB", payment.provider || "Manual").catch(() => {});
  }

  let activation: { ok: boolean; error?: string } = { ok: false, error: "no tariff" };
  let proxySlots: { ok: boolean; slotsCreated?: number; error?: string } = { ok: false };
  if (isExtraOption) {
    const extraResult = await applyExtraOptionByPaymentId(paymentId);
    activation = extraResult.ok ? { ok: true } : { ok: false, error: (extraResult as { error?: string }).error };
    if (extraResult.ok && payment.clientId) {
      const { notifyExtraOptionApplied } = await import("../notification/telegram-notify.service.js");
      await notifyExtraOptionApplied(payment.clientId, paymentId).catch(() => {});
    }
  } else if (payment.tariffId || isCustomBuild) {
    activation = await activateTariffByPaymentId(paymentId);
  } else if (payment.proxyTariffId) {
    const proxyResult = await createProxySlotsByPaymentId(paymentId);
    if (proxyResult.ok) {
      proxySlots = { ok: true, slotsCreated: proxyResult.slotsCreated };
      const tariff = await prisma.proxyTariff.findUnique({
        where: { id: payment.proxyTariffId },
        select: { name: true },
      });
      await notifyProxySlotsCreated(
        payment.clientId,
        proxyResult.slotIds,
        tariff?.name ?? undefined
      ).catch(() => {});
    } else {
      proxySlots = { ok: false, error: proxyResult.error };
    }
  } else if (payment.singboxTariffId) {
    const singboxResult = await createSingboxSlotsByPaymentId(paymentId);
    if (singboxResult.ok) {
      proxySlots = { ok: true, slotsCreated: singboxResult.slotsCreated };
      const tariff = await prisma.singboxTariff.findUnique({
        where: { id: payment.singboxTariffId },
        select: { name: true },
      });
      await notifySingboxSlotsCreated(
        payment.clientId,
        singboxResult.slotIds,
        tariff?.name ?? undefined
      ).catch(() => {});
    } else {
      proxySlots = { ok: false, error: singboxResult.error };
    }
  }

  if (payment.tariffId || payment.proxyTariffId || payment.singboxTariffId || isCustomBuild) {
    await prisma.client.update({
      where: { id: payment.clientId },
      data: { trialUsed: true },
    }).catch(() => {});
  }

  if (!isTopUp) {
    await extinguishOneTimeDiscount(payment.clientId);
  }

  const referral = await distributeReferralRewards(paymentId);
  const updated = await prisma.payment.findUnique({ where: { id: paymentId } });
  return {
    ok: true,
    payment: updated ?? payment,
    referral,
    activation,
    proxySlots: proxySlots.ok ? proxySlots : undefined,
    balanceCredited: isTopUp,
  };
}
