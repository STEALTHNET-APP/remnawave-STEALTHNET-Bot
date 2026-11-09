/**
 * Webhook Crypto Pay (Crypto Bot): update_type invoice_paid.
 * Проверка подписи: HMAC-SHA256(rawBody, SHA256(token)).
 * Документация: https://help.send.tg/en/articles/10279948-crypto-pay-api
 */

import { Router, Request, Response } from "express";
import { prisma } from "../../db.js";
import { getSystemConfig } from "../client/client.service.js";
import { verifyCryptopayWebhookSignature } from "../cryptopay/cryptopay.service.js";
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

export const cryptopayWebhooksRouter = Router();

type CryptopayWebhookPayload = {
  update_type?: string;
  payload?: { payload?: string; invoice_id?: number; status?: string };
};

/** POST /api/webhooks/cryptopay — вызывается с express.raw(), req.body = Buffer */
cryptopayWebhooksRouter.post("/", async (req: Request, res: Response) => {
  const rawBody = req.body;
  const rawString = typeof rawBody === "string" ? rawBody : Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : "";
  const captured = await recordWebhook("cryptopay", req, rawString);
  const ack = (status: number, outcome: Parameters<typeof markOutcome>[2], errorMessage?: string, paymentId?: string | null) => {
    void markOutcome(captured, status, outcome, { errorMessage, paymentId });
  };
  let ackPaymentId: string | null = null;
  try {
  if (!rawString) {
    console.warn("[Crypto Pay Webhook] Empty body");
    ack(200, "rejected_payload", "Empty body");
    return res.status(200).send("OK");
  }

  const config = await getSystemConfig();
  const token = (config as { cryptopayApiToken?: string | null }).cryptopayApiToken?.trim();
  if (!token) {
    console.warn("[Crypto Pay Webhook] Crypto Pay not configured");
    ack(200, "error", "Crypto Pay not configured");
    return res.status(200).send("OK");
  }

  const signature = req.headers["crypto-pay-api-signature"] as string | undefined;
  if (!verifyCryptopayWebhookSignature(token, rawString, signature)) {
    console.warn("[Crypto Pay Webhook] Invalid signature");
    ack(401, "rejected_signature", "Invalid signature");
    return res.status(401).send("Invalid signature");
  }

  let body: CryptopayWebhookPayload;
  try {
    body = JSON.parse(rawString) as CryptopayWebhookPayload;
  } catch {
    console.warn("[Crypto Pay Webhook] Invalid JSON");
    ack(200, "rejected_payload", "Invalid JSON");
    return res.status(200).send("OK");
  }

  if (body.update_type !== "invoice_paid" || !body.payload?.payload) {
    ack(200, "ignored_event", `update_type=${body.update_type}`);
    return res.status(200).send("OK");
  }

  const paymentId = body.payload.payload.trim();
  ackPaymentId = paymentId;
  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, provider: "cryptopay" },
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
    console.warn("[Crypto Pay Webhook] Payment not found", { paymentId });
    ack(200, "payment_not_found", `invoice_id=${paymentId}`, paymentId);
    return res.status(200).send("OK");
  }

  await auditPaymentClientBotAlignment(payment);

  const invoiceId = body.payload.invoice_id ?? null;
  const meta = parseMetadata(payment.metadata);
  const isExtraOption = Boolean(meta.extraOption);
  const isCustomBuild = Boolean(meta.customBuild);
  const isTopUp = !payment.tariffId && !payment.proxyTariffId && !payment.singboxTariffId && !isExtraOption && !isCustomBuild;
  const paidData = { status: "PAID", paidAt: new Date(), externalId: invoiceId != null ? String(invoiceId) : null };
  const where = { id: payment.id, status: { in: ["PENDING", "FAILED"] } };
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
    await notifyBalanceToppedUp(payment.clientId, payment.amount, payment.currency || "USD", "CryptoPay").catch(() => {});
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
        provider: "cryptopay",
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
        provider: "cryptopay",
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
        provider: "cryptopay",
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
      provider: "cryptopay",
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
    console.error("[Crypto Pay Webhook] Processing failed", e);
    ack(200, "error", String(e), ackPaymentId);
    return res.status(200).send("OK");
  }
});
