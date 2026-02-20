/**
 * Webhook Platega:
 * - надёжно принимает разные форматы payload (orderId/externalId/transaction.id)
 * - идемпотентно переводит платежи PENDING -> PAID/FAILED
 * - топ-ап: зачисляет баланс атомарно вместе со сменой статуса
 * - тариф: активирует в Remna и распределяет реферальные (с ретраем по повторному webhook)
 */

import { Router } from "express";
import { prisma } from "../../db.js";
import { activateTariffByPaymentId } from "../tariff/tariff-activation.service.js";
import { createProxySlotsByPaymentId } from "../proxy/proxy-slots-activation.service.js";
import { applyExtraOptionByPaymentId } from "../extra-options/extra-options.service.js";
import { distributeReferralRewards } from "../referral/referral.service.js";
import { notifyBalanceToppedUp, notifyTariffActivated, notifyProxySlotsCreated } from "../notification/telegram-notify.service.js";

function hasExtraOptionInMetadata(metadata: string | null): boolean {
  if (!metadata?.trim()) return false;
  try {
    const obj = JSON.parse(metadata) as Record<string, unknown>;
    return obj?.extraOption != null && typeof obj.extraOption === "object";
  } catch {
    return false;
  }
}

export const plategaWebhooksRouter = Router();

type PaymentRow = {
  id: string;
  orderId: string;
  externalId: string | null;
  status: string;
  clientId: string;
  amount: number;
  currency: string;
  tariffId: string | null;
  proxyTariffId: string | null;
  metadata: string | null;
};

const PAYMENT_SELECT = {
  id: true,
  orderId: true,
  externalId: true,
  status: true,
  clientId: true,
  amount: true,
  currency: true,
  tariffId: true,
  proxyTariffId: true,
  metadata: true,
} as const;

const SUCCESS_STATUSES = new Set(["CONFIRMED", "PAID", "SUCCESS", "SUCCEEDED", "COMPLETED", "SUCCESSFUL", "APPROVED"]);
const FAILED_STATUSES = new Set(["CANCELED", "CANCELLED", "FAILED", "DECLINED", "REJECTED", "ERROR", "EXPIRED", "CHARGEBACK", "CHARGEBACKED"]);

type Meta = Record<string, unknown> & {
  plategaActivationAppliedAt?: string;
  plategaActivationInProgressAt?: string;
  plategaActivationAttempts?: number;
  plategaActivationLastError?: string | null;
};

function pickFirstString(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function parseMeta(raw: string | null): Meta {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Meta;
  } catch {
    return {};
  }
}

async function findPlategaPaymentByAnyId(candidateIds: string[]): Promise<PaymentRow | null> {
  for (const id of candidateIds) {
    const byExternal = await prisma.payment.findFirst({
      where: { provider: "platega", externalId: id },
      select: PAYMENT_SELECT,
    });
    if (byExternal) return byExternal;

    const byOrder = await prisma.payment.findUnique({
      where: { orderId: id },
      select: { ...PAYMENT_SELECT, provider: true },
    });
    if (byOrder && byOrder.provider === "platega") {
      return {
        id: byOrder.id,
        orderId: byOrder.orderId,
        externalId: byOrder.externalId,
        status: byOrder.status,
        clientId: byOrder.clientId,
        amount: byOrder.amount,
        currency: byOrder.currency,
        tariffId: byOrder.tariffId,
        proxyTariffId: byOrder.proxyTariffId,
        metadata: byOrder.metadata,
      };
    }
  }
  return null;
}

async function ensureTariffActivation(paymentId: string): Promise<void> {
  const claim = await prisma.$transaction(async (tx) => {
    const row = await tx.payment.findUnique({
      where: { id: paymentId },
      select: { status: true, tariffId: true, proxyTariffId: true, metadata: true, clientId: true },
    });
    const hasExtra = hasExtraOptionInMetadata(row?.metadata ?? null);
    if (!row || row.status !== "PAID" || (!row.tariffId && !row.proxyTariffId && !hasExtra)) {
      return { claimed: false as const, reason: "not_paid_or_no_tariff" };
    }

    const meta = parseMeta(row.metadata);
    if (typeof meta.plategaActivationAppliedAt === "string" && meta.plategaActivationAppliedAt.trim()) {
      return { claimed: false as const, reason: "already_applied" };
    }

    const inProgressAt = typeof meta.plategaActivationInProgressAt === "string" ? new Date(meta.plategaActivationInProgressAt) : null;
    const freshInProgress = inProgressAt && Number.isFinite(inProgressAt.getTime()) && Date.now() - inProgressAt.getTime() < 10 * 60 * 1000;
    if (freshInProgress) {
      return { claimed: false as const, reason: "in_progress" };
    }

    const next: Meta = {
      ...meta,
      plategaActivationInProgressAt: new Date().toISOString(),
      plategaActivationAttempts: Number(meta.plategaActivationAttempts ?? 0) + 1,
    };
    await tx.payment.update({
      where: { id: paymentId },
      data: { metadata: JSON.stringify(next) },
    });
    return { claimed: true as const, reason: "claimed" };
  });

  if (!claim.claimed) return;

  const row = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { tariffId: true, proxyTariffId: true, clientId: true, metadata: true },
  });
  const isExtraOption = row ? hasExtraOptionInMetadata(row.metadata) : false;
  let activation: { ok: boolean; error?: string; slotIds?: string[] } = { ok: false };
  if (isExtraOption) {
    activation = await applyExtraOptionByPaymentId(paymentId);
  } else if (row?.proxyTariffId) {
    const proxyResult = await createProxySlotsByPaymentId(paymentId);
    activation = proxyResult.ok ? { ok: true, slotIds: proxyResult.slotIds } : { ok: false, error: proxyResult.error };
    if (activation.ok && activation.slotIds?.length && row.clientId) {
      const tariff = await prisma.proxyTariff.findUnique({ where: { id: row.proxyTariffId! }, select: { name: true } });
      await notifyProxySlotsCreated(row.clientId, activation.slotIds, tariff?.name ?? undefined).catch(() => {});
    }
  } else {
    activation = await activateTariffByPaymentId(paymentId);
  }
  await prisma.$transaction(async (tx) => {
    const row = await tx.payment.findUnique({
      where: { id: paymentId },
      select: { metadata: true },
    });
    const meta = parseMeta(row?.metadata ?? null);
    const next: Meta = { ...meta };
    delete next.plategaActivationInProgressAt;
    if (activation.ok) {
      next.plategaActivationAppliedAt = new Date().toISOString();
      next.plategaActivationLastError = null;
    } else {
      next.plategaActivationLastError = activation.error;
    }
    await tx.payment.update({
      where: { id: paymentId },
      data: { metadata: JSON.stringify(next) },
    });
  });

  if (activation.ok) {
    console.log("[Platega Webhook] Tariff activated", { paymentId });
  } else {
    console.error("[Platega Webhook] Tariff activation failed", { paymentId, error: activation.error });
  }
}

plategaWebhooksRouter.post("/platega", async (req, res) => {
  // Возвращаем 200, чтобы провайдер не спамил ретраями при наших внутренних ошибках.
  try {
    const data = (req.body && typeof req.body === "object") ? (req.body as Record<string, unknown>) : null;
    if (!data || Object.keys(data).length === 0) {
      console.warn("[Platega Webhook] Empty body");
      return res.status(200).json({ received: true });
    }

    const txObj = (data.transaction && typeof data.transaction === "object")
      ? (data.transaction as Record<string, unknown>)
      : {};
    const idObj = (data.data && typeof data.data === "object")
      ? (data.data as Record<string, unknown>)
      : {};

    const statusRaw = pickFirstString(
      data.status,
      txObj.status,
      data.state,
      data.paymentStatus,
      data.payment_status,
      idObj.status,
      idObj.state
    );
    const status = (statusRaw ?? "").toUpperCase();

    const transactionId = pickFirstString(
      data.id,
      txObj.id,
      data.transactionId,
      data.transaction_id,
      idObj.id,
      idObj.transactionId,
      idObj.transaction_id
    );
    const externalId = pickFirstString(data.externalId, txObj.externalId, idObj.externalId, data.invoiceId, txObj.invoiceId, idObj.invoiceId);
    const orderId = pickFirstString(data.orderId, data.order_id, data.order, data.merchant_order_id, idObj.orderId, idObj.order_id, idObj.order);
    const payloadId = pickFirstString(data.payload, txObj.payload, idObj.payload);

    const candidateIds = [...new Set([payloadId, transactionId, externalId, orderId].filter(Boolean) as string[])];
    if (candidateIds.length === 0) {
      console.warn("[Platega Webhook] No identifiers", { keys: Object.keys(data) });
      return res.status(200).json({ received: true });
    }

    const payment = await findPlategaPaymentByAnyId(candidateIds);
    if (!payment) {
      console.warn("[Platega Webhook] Payment not found", { candidateIds, status });
      return res.status(200).json({ received: true });
    }

    if (FAILED_STATUSES.has(status)) {
      const failed = await prisma.payment.updateMany({
        where: { id: payment.id, status: "PENDING" },
        data: { status: "FAILED", externalId: transactionId ?? payment.externalId },
      });
      if (failed.count > 0) {
        console.log("[Platega Webhook] Payment marked FAILED", { paymentId: payment.id, status, transactionId, orderId: payment.orderId });
      }
      return res.status(200).json({ received: true });
    }

    if (!SUCCESS_STATUSES.has(status)) {
      console.log("[Platega Webhook] Ignored status", { status, paymentId: payment.id, candidateIds });
      return res.status(200).json({ received: true });
    }

    const isTopUp = !payment.tariffId && !payment.proxyTariffId;
    if (isTopUp) {
      const changed = await prisma.$transaction(async (tx) => {
        const upd = await tx.payment.updateMany({
          where: { id: payment.id, status: "PENDING" },
          data: { status: "PAID", paidAt: new Date(), externalId: transactionId ?? payment.externalId },
        });
        if (upd.count > 0) {
          await tx.client.update({
            where: { id: payment.clientId },
            data: { balance: { increment: payment.amount } },
          });
        }
        return upd.count > 0;
      });
      if (changed) {
        console.log("[Platega Webhook] Payment PAID, balance credited (top-up)", {
          paymentId: payment.id,
          amount: payment.amount,
          currency: payment.currency,
          transactionId,
          orderId: payment.orderId,
        });
        await notifyBalanceToppedUp(payment.clientId, payment.amount, payment.currency || "RUB").catch(() => {});
      } else {
        console.log("[Platega Webhook] Payment already finalized", { paymentId: payment.id, status: payment.status });
      }
    } else {
      const upd = await prisma.payment.updateMany({
        where: { id: payment.id, status: "PENDING" },
        data: { status: "PAID", paidAt: new Date(), externalId: transactionId ?? payment.externalId },
      });
      if (upd.count > 0) {
        console.log("[Platega Webhook] Payment PAID (tariff)", {
          paymentId: payment.id,
          transactionId,
          orderId: payment.orderId,
        });
      }
    }

    // Надёжная пост-обработка: даже если платеж уже PAID, повторный webhook
    // догонит активацию тарифа/рефералку.
    await ensureTariffActivation(payment.id);
    if (payment.tariffId) {
      await notifyTariffActivated(payment.clientId, payment.id).catch(() => {});
    }
    // proxyTariffId: notifyProxySlotsCreated вызывается из ensureTariffActivation
    await distributeReferralRewards(payment.id).catch((e) => {
      console.error("[Platega Webhook] Referral distribution error", { paymentId: payment.id, error: e });
    });

    return res.status(200).json({ received: true });
  } catch (e) {
    console.error("[Platega Webhook] Error:", e);
    return res.status(200).json({ received: true });
  }
});
