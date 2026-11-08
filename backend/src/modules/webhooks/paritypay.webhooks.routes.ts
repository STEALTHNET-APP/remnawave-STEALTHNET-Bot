import { Router, type Request, type Response } from "express";
import { prisma } from "../../db.js";
import { getSystemConfig } from "../client/client.service.js";
import { verifyParitypayWebhookSignature, getParitypayInvoice, matchesParitypayInvoice } from "../paritypay/paritypay.service.js";
import { activateTariffByPaymentId } from "../tariff/tariff-activation.service.js";
import { createProxySlotsByPaymentId } from "../proxy/proxy-slots-activation.service.js";
import { createSingboxSlotsByPaymentId } from "../singbox/singbox-slots-activation.service.js";
import { applyExtraOptionByPaymentId } from "../extra-options/extra-options.service.js";
import { distributeReferralRewards } from "../referral/referral.service.js";
import { notifyBalanceToppedUp, notifyExtraOptionApplied, notifyProxySlotsCreated, notifySingboxSlotsCreated } from "../notification/telegram-notify.service.js";
import { recordPromoCodeUsageFromPayment } from "../payment/promo-code-usage.util.js";
import { handlePaymentActivationResult } from "../payment/payment-fulfillment.util.js";
import { extinguishOneTimeDiscount } from "../client/personal-discount.js";
import { recordWebhook, markOutcome } from "../webhook-inbox/webhook-inbox.service.js";

export const paritypayWebhooksRouter = Router();
paritypayWebhooksRouter.post("/", async (req: Request, res: Response) => {
  const rawString = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : String(req.body ?? "");
  const captured = await recordWebhook("paritypay", req, rawString);
  const ack = (status: number, outcome: Parameters<typeof markOutcome>[2], errorMessage?: string, paymentId?: string | null) => {
    void markOutcome(captured, status, outcome, { errorMessage, paymentId });
  };
  try {
    let body: Record<string, unknown>;
    try { body = JSON.parse(rawString); }
    catch { ack(400, "rejected_payload", "Invalid JSON"); return res.status(400).send("Invalid JSON"); }
    if (!body || Array.isArray(body) || typeof body !== "object") {
      ack(400, "rejected_payload", "Invalid body");
      return res.status(400).send("Invalid body");
    }
    const settings = await getSystemConfig();
    const config = { shopId: settings.paritypayShopId || "", apiKey: settings.paritypayApiKey || "", signingSecret: settings.paritypaySigningSecret || "", enabled: settings.paritypayEnabled };
    // Existing invoices still settle after the merchant disables new checkout.
    if (!config.shopId || !config.apiKey || !config.signingSecret) {
      ack(503, "error", "Not configured");
      return res.status(503).send("Not configured");
    }
    if (!verifyParitypayWebhookSignature(config.signingSecret, body, req.header("X-SIGNATURE"))) {
      ack(401, "rejected_signature", "Invalid signature");
      return res.status(401).send("Invalid signature");
    }
    if (body.shop_id !== config.shopId) {
      ack(400, "rejected_payload", "Wrong shop");
      return res.status(400).send("Wrong shop");
    }
    if (body.status !== "PAID") {
      ack(200, "ignored_event", `status=${String(body.status)}`);
      return res.status(200).send("OK");
    }
    if (typeof body.order_id !== "string" || typeof body.id !== "string") {
      ack(400, "rejected_payload", "Missing identifiers");
      return res.status(400).send("Missing identifiers");
    }
    const payment = await prisma.payment.findFirst({ where: { orderId: body.order_id, provider: "paritypay" } });
    if (!payment) {
      ack(404, "payment_not_found", `order_id=${body.order_id}`, body.order_id);
      return res.status(404).send("Unknown order");
    }
    const expected = { orderId: payment.orderId, shopId: config.shopId, amount: payment.amount, externalId: payment.externalId };
    const invoice = await getParitypayInvoice(config, payment.orderId);
    if (invoice.status !== "PAID" || payment.currency.toUpperCase() !== "RUB" || !matchesParitypayInvoice(invoice, expected) || invoice.id !== body.id || Math.round(Number(body.amount)*100) !== Math.round(payment.amount*100)) {
      ack(400, "rejected_payload", "Payment mismatch", payment.id);
      return res.status(400).send("Payment mismatch");
    }
    const meta = payment.metadata ? JSON.parse(payment.metadata) as Record<string, unknown> : {};
    const topup = !payment.tariffId && !payment.proxyTariffId && !payment.singboxTariffId && !meta.extraOption && !meta.customBuild;
    let outcome: Parameters<typeof markOutcome>[2] = "accepted";
    if (topup) {
      const credited = await prisma.$transaction(async tx => {
        const result = await tx.payment.updateMany({ where: { id: payment.id, status: "PENDING" }, data: { status: "PAID", paidAt: new Date(), externalId: invoice.id } });
        if (result.count) await tx.client.update({ where: { id: payment.clientId }, data: { balance: { increment: payment.amount } } });
        return result.count > 0;
      });
      if (credited) {
        await notifyBalanceToppedUp(payment.clientId, payment.amount, payment.currency, "ParityPay").catch(()=>{});
      } else {
        ack(200, "payment_already_paid", undefined, payment.id);
        return res.status(200).send("OK");
      }
    } else {
      if (!meta.paritypayAppliedAt) {
        // Compare-and-swap claim prevents concurrent callbacks from activating twice.
        // A crashed/uncertain activation is left claimed for review, never blindly repeated.
        if (meta.paritypayProcessingAt) {
          ack(503, "ignored_event", "Activation pending review", payment.id);
          return res.status(503).send("Activation pending review");
        }
        const claimed = await prisma.payment.updateMany({ where: { id: payment.id, status: "PENDING", metadata: payment.metadata }, data: { status: "PAID", paidAt: new Date(), externalId: invoice.id, metadata: JSON.stringify({ ...meta, paritypayProcessingAt: new Date().toISOString() }) } });
        if (!claimed.count) {
          ack(503, "ignored_event", "Activation in progress", payment.id);
          return res.status(503).send("Activation in progress");
        }
        const activation = meta.extraOption ? await applyExtraOptionByPaymentId(payment.id)
          : payment.proxyTariffId ? await createProxySlotsByPaymentId(payment.id)
          : payment.singboxTariffId ? await createSingboxSlotsByPaymentId(payment.id)
          : await activateTariffByPaymentId(payment.id);
        const latest = await prisma.payment.findUnique({ where: { id: payment.id }, select: { metadata: true } });
        const next = latest?.metadata ? JSON.parse(latest.metadata) as Record<string,unknown> : meta;
        if (!activation.ok) {
          await prisma.payment.update({ where: { id: payment.id }, data: { metadata: JSON.stringify({ ...next, paritypayActivationError: activation.error || "Activation failed" }) } });
          await handlePaymentActivationResult({
            paymentId: payment.id,
            clientId: payment.clientId,
            amount: payment.amount,
            currency: payment.currency || "RUB",
            provider: "paritypay",
            activation: { ok: false, error: activation.error || "Activation failed" },
          });
          ack(503, "error", activation.error || "Activation failed", payment.id);
          return res.status(503).send("Activation failed");
        }
        delete next.paritypayProcessingAt;
        next.paritypayAppliedAt = new Date().toISOString();
        await prisma.payment.update({ where: { id: payment.id }, data: { metadata: JSON.stringify(next) } });
        if (meta.extraOption) await notifyExtraOptionApplied(payment.clientId, payment.id).catch(()=>{});
        else if (payment.proxyTariffId && "slotIds" in activation && Array.isArray(activation.slotIds)) {
          const tariff = await prisma.proxyTariff.findUnique({ where: { id: payment.proxyTariffId }, select: { name: true } });
          await notifyProxySlotsCreated(payment.clientId, activation.slotIds.filter((id): id is string => typeof id === "string"), tariff?.name).catch(()=>{});
        } else if (payment.singboxTariffId && "slotIds" in activation && Array.isArray(activation.slotIds)) {
          const tariff = await prisma.singboxTariff.findUnique({ where: { id: payment.singboxTariffId }, select: { name: true } });
          await notifySingboxSlotsCreated(payment.clientId, activation.slotIds.filter((id): id is string => typeof id === "string"), tariff?.name).catch(()=>{});
        }
        if (payment.tariffId || meta.customBuild) {
          await handlePaymentActivationResult({
            paymentId: payment.id,
            clientId: payment.clientId,
            amount: payment.amount,
            currency: payment.currency || "RUB",
            provider: "paritypay",
            activation,
          });
        }
        await extinguishOneTimeDiscount(payment.clientId);
      } else {
        outcome = "payment_already_paid";
      }
    }
    await recordPromoCodeUsageFromPayment(payment.id);
    await distributeReferralRewards(payment.id);
    ack(200, outcome, undefined, payment.id);
    return res.status(200).send("OK");
  } catch (error) {
    console.error("[ParityPay webhook] processing failed", error instanceof Error ? error.message : "Unknown error");
    ack(503, "error", error instanceof Error ? error.message : String(error));
    return res.status(503).send("Retry later");
  }
});
