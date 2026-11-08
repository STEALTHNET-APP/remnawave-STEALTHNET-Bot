/**
 * Webhook RollyPay.
 *
 * Приходит на POST /api/webhooks/rollypay с express.raw() — тело нужно сырым:
 * подпись считается по строке `X-Timestamp + "." + rawBody`, и повторная
 * сериализация JSON её сломает.
 *
 * События: payment.created / paid / canceled / expired / chargeback / refunded.
 * Зачисляем только `paid` — остальные подтверждаем 200, чтобы RollyPay не
 * пытался доставить их повторно (до 8 попыток около часа).
 *
 * Документация: https://docs.rollypay.io/api/callbacks/
 */

import { Router, Request, Response } from "express";
import { prisma } from "../../db.js";
import { getSystemConfig } from "../client/client.service.js";
import { verifyRollypayWebhookSignature } from "../rollypay/rollypay.service.js";
import { activateTariffByPaymentId } from "../tariff/tariff-activation.service.js";
import { createProxySlotsByPaymentId } from "../proxy/proxy-slots-activation.service.js";
import { createSingboxSlotsByPaymentId } from "../singbox/singbox-slots-activation.service.js";
import { applyExtraOptionByPaymentId } from "../extra-options/extra-options.service.js";
import { distributeReferralRewards } from "../referral/referral.service.js";
import { notifyBalanceToppedUp, notifyProxySlotsCreated, notifySingboxSlotsCreated } from "../notification/telegram-notify.service.js";
import { recordPromoCodeUsageFromPayment } from "../payment/promo-code-usage.util.js";
import { handlePaymentActivationResult } from "../payment/payment-fulfillment.util.js";
import { auditPaymentClientBotAlignment } from "../payment/payment-webhook-audit.util.js";
import { recordWebhook, markOutcome } from "../webhook-inbox/webhook-inbox.service.js";

function parseMetadata(metadata: string | null): Record<string, unknown> {
  if (!metadata?.trim()) return {};
  try { return JSON.parse(metadata) as Record<string, unknown>; } catch { return {}; }
}

export const rollypayWebhooksRouter = Router();

type RollypayWebhookPayload = {
  event_type?: string;
  payment_id?: string;
  order_id?: string;
  status?: string;
  amount?: string;
  currency?: string;
  test?: boolean;
};

rollypayWebhooksRouter.post("/", async (req: Request, res: Response) => {
  const rawBody = req.body;
  const rawString = typeof rawBody === "string" ? rawBody : Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : "";
  const captured = await recordWebhook("rollypay", req, rawString);
  const ack = (status: number, outcome: Parameters<typeof markOutcome>[2], errorMessage?: string, paymentId?: string | null) => {
    void markOutcome(captured, status, outcome, { errorMessage, paymentId });
  };
  let ackPaymentId: string | null = null;
  try {
  if (!rawString) {
    console.warn("[RollyPay Webhook] Empty body");
    ack(200, "rejected_payload", "Empty body");
    return res.status(200).send("OK");
  }

  const config = await getSystemConfig();
  const signingSecret = (config as { rollypaySigningSecret?: string | null }).rollypaySigningSecret?.trim();
  if (!signingSecret) {
    // Без секрета подпись проверить нечем. Принять «на веру» нельзя — это дыра:
    // кто угодно смог бы прислать «оплачено».
    console.warn("[RollyPay Webhook] Signing secret not configured — REJECTING");
    ack(503, "error", "Signing secret not configured");
    return res.status(503).send("Not configured");
  }

  const signature = req.header("x-signature") ?? undefined;
  const timestamp = req.header("x-timestamp") ?? undefined;
  if (!verifyRollypayWebhookSignature(signingSecret, rawString, timestamp, signature)) {
    console.warn("[RollyPay Webhook] Invalid signature");
    ack(401, "rejected_signature", "Invalid signature");
    return res.status(401).send("Invalid signature");
  }

  let body: RollypayWebhookPayload;
  try {
    body = JSON.parse(rawString) as RollypayWebhookPayload;
  } catch {
    console.warn("[RollyPay Webhook] Invalid JSON");
    ack(200, "rejected_payload", "Invalid JSON");
    return res.status(200).send("OK");
  }

  const status = (body.status ?? "").toLowerCase();
  const eventType = (body.event_type ?? "").toLowerCase();
  if (status !== "paid" && eventType !== "payment.paid") {
    ack(200, "ignored_event", `status=${body.status}`, body.order_id);
    return res.status(200).send("OK");
  }

  const orderId = body.order_id?.trim();
  if (!orderId) {
    console.warn("[RollyPay Webhook] No order_id");
    ack(200, "rejected_payload", "No order_id");
    return res.status(200).send("OK");
  }
  ackPaymentId = orderId;

  const payment = await prisma.payment.findFirst({
    where: { orderId, provider: "rollypay" },
    select: {
      id: true,
      clientId: true,
      amount: true,
      currency: true,
      tariffId: true,
      proxyTariffId: true,
      singboxTariffId: true,
      status: true,
      metadata: true,
    },
  });

  if (!payment) {
    console.warn("[RollyPay Webhook] Payment not found", { orderId });
    ack(200, "payment_not_found", `order_id=${orderId}`, orderId);
    return res.status(200).send("OK");
  }

  await auditPaymentClientBotAlignment(payment);

  const meta = parseMetadata(payment.metadata);
  const isExtraOption = Boolean(meta.extraOption);
  const isCustomBuild = Boolean(meta.customBuild);
  const isTopUp = !payment.tariffId && !payment.proxyTariffId && !payment.singboxTariffId && !isExtraOption && !isCustomBuild;
  const paidData = { status: "PAID", paidAt: new Date(), externalId: body.payment_id ?? null };
  const where = { id: payment.id, status: { not: "PAID" } };
  const claimed = isTopUp
    ? await prisma.$transaction(async (tx) => {
        const updated = await tx.payment.updateMany({ where, data: paidData });
        if (updated.count > 0) {
          await tx.client.update({
            where: { id: payment.clientId },
            data: { balance: { increment: payment.amount } },
          });
        }
        return updated.count > 0;
      })
    : (await prisma.payment.updateMany({ where, data: paidData })).count > 0;

  if (!claimed) {
    ack(200, "payment_already_paid", undefined, payment.id);
    return res.status(200).send("OK");
  }
  await recordPromoCodeUsageFromPayment(payment.id);

  let fulfillmentError: string | undefined;
  if (isTopUp) {
    await notifyBalanceToppedUp(payment.clientId, payment.amount, payment.currency || "RUB", "RollyPay").catch(() => {});
  } else if (isExtraOption) {
    const r = await applyExtraOptionByPaymentId(payment.id);
    if (r.ok) {
      const { notifyExtraOptionApplied } = await import("../notification/telegram-notify.service.js");
      await notifyExtraOptionApplied(payment.clientId, payment.id).catch(() => {});
    } else {
      fulfillmentError = (r as { error?: string }).error || "extra option activation failed";
      await handlePaymentActivationResult({
        paymentId: payment.id,
        clientId: payment.clientId,
        amount: payment.amount,
        currency: payment.currency || "RUB",
        provider: "rollypay",
        activation: { ok: false, error: fulfillmentError },
      });
    }
  } else if (payment.proxyTariffId) {
    const proxyResult = await createProxySlotsByPaymentId(payment.id);
    if (proxyResult.ok) {
      const tariff = await prisma.proxyTariff.findUnique({ where: { id: payment.proxyTariffId }, select: { name: true } });
      await notifyProxySlotsCreated(payment.clientId, proxyResult.slotIds, tariff?.name ?? undefined).catch(() => {});
    } else {
      fulfillmentError = proxyResult.error || "proxy slots activation failed";
      await handlePaymentActivationResult({
        paymentId: payment.id,
        clientId: payment.clientId,
        amount: payment.amount,
        currency: payment.currency || "RUB",
        provider: "rollypay",
        activation: { ok: false, error: fulfillmentError },
      });
    }
  } else if (payment.singboxTariffId) {
    const singboxResult = await createSingboxSlotsByPaymentId(payment.id);
    if (singboxResult.ok) {
      const tariff = await prisma.singboxTariff.findUnique({ where: { id: payment.singboxTariffId }, select: { name: true } });
      await notifySingboxSlotsCreated(payment.clientId, singboxResult.slotIds, tariff?.name ?? undefined).catch(() => {});
    } else {
      fulfillmentError = singboxResult.error || "singbox slots activation failed";
      await handlePaymentActivationResult({
        paymentId: payment.id,
        clientId: payment.clientId,
        amount: payment.amount,
        currency: payment.currency || "RUB",
        provider: "rollypay",
        activation: { ok: false, error: fulfillmentError },
      });
    }
  } else {
    const activation = await activateTariffByPaymentId(payment.id);
    await handlePaymentActivationResult({
      paymentId: payment.id,
      clientId: payment.clientId,
      amount: payment.amount,
      currency: payment.currency || "RUB",
      provider: "rollypay",
      activation,
    });
    if (!activation.ok) fulfillmentError = activation.error || "activation_failed";
  }

  // сжигаем одноразовую персональную скидку после продуктовой покупки.
  if (!isTopUp) {
    const { extinguishOneTimeDiscount } = await import("../client/personal-discount.js");
    await extinguishOneTimeDiscount(payment.clientId).catch(() => {});
  }

  await distributeReferralRewards(payment.id).catch(() => {});

  ack(200, fulfillmentError ? "error" : "accepted", fulfillmentError, payment.id);
  return res.status(200).send("OK");
  } catch (e) {
    console.error("[RollyPay Webhook] Processing failed", e);
    ack(200, "error", String(e), ackPaymentId);
    return res.status(200).send("OK");
  }
});
