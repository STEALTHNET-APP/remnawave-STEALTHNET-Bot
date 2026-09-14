import { Router, type Request, type Response } from "express";
import { prisma } from "../../db.js";
import { getSystemConfig } from "../client/client.service.js";
import { verifyParitypayWebhookSignature, getParitypayInvoice, matchesParitypayInvoice } from "../paritypay/paritypay.service.js";
import { activateTariffByPaymentId } from "../tariff/tariff-activation.service.js";
import { createProxySlotsByPaymentId } from "../proxy/proxy-slots-activation.service.js";
import { createSingboxSlotsByPaymentId } from "../singbox/singbox-slots-activation.service.js";
import { applyExtraOptionByPaymentId } from "../extra-options/extra-options.service.js";
import { distributeReferralRewards } from "../referral/referral.service.js";
import { notifyBalanceToppedUp, notifyTariffActivated, notifyExtraOptionApplied, notifyProxySlotsCreated, notifySingboxSlotsCreated } from "../notification/telegram-notify.service.js";
import { recordPromoCodeUsageFromPayment } from "../payment/promo-code-usage.util.js";
import { extinguishOneTimeDiscount } from "../client/personal-discount.js";

export const paritypayWebhooksRouter = Router();
paritypayWebhooksRouter.post("/", async (req: Request, res: Response) => {
  try {
    let body: Record<string, unknown>;
    try { body = JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString("utf8") : String(req.body)); }
    catch { return res.status(400).send("Invalid JSON"); }
    if (!body || Array.isArray(body) || typeof body !== "object") return res.status(400).send("Invalid body");
    const settings = await getSystemConfig();
    const config = { shopId: settings.paritypayShopId || "", apiKey: settings.paritypayApiKey || "", signingSecret: settings.paritypaySigningSecret || "", enabled: settings.paritypayEnabled };
    // Existing invoices still settle after the merchant disables new checkout.
    if (!config.shopId || !config.apiKey || !config.signingSecret) return res.status(503).send("Not configured");
    if (!verifyParitypayWebhookSignature(config.signingSecret, body, req.header("X-SIGNATURE"))) return res.status(401).send("Invalid signature");
    if (body.shop_id !== config.shopId) return res.status(400).send("Wrong shop");
    if (body.status !== "PAID") return res.status(200).send("OK");
    if (typeof body.order_id !== "string" || typeof body.id !== "string") return res.status(400).send("Missing identifiers");
    const payment = await prisma.payment.findFirst({ where: { orderId: body.order_id, provider: "paritypay" } });
    if (!payment) return res.status(404).send("Unknown order");
    const expected = { orderId: payment.orderId, shopId: config.shopId, amount: payment.amount, externalId: payment.externalId };
    const invoice = await getParitypayInvoice(config, payment.orderId);
    if (invoice.status !== "PAID" || payment.currency.toUpperCase() !== "RUB" || !matchesParitypayInvoice(invoice, expected) || invoice.id !== body.id || Math.round(Number(body.amount)*100) !== Math.round(payment.amount*100)) return res.status(400).send("Payment mismatch");
    const meta = payment.metadata ? JSON.parse(payment.metadata) as Record<string, unknown> : {};
    const topup = !payment.tariffId && !payment.proxyTariffId && !payment.singboxTariffId && !meta.extraOption && !meta.customBuild;
    if (topup) {
      const credited = await prisma.$transaction(async tx => {
        const result = await tx.payment.updateMany({ where: { id: payment.id, status: "PENDING" }, data: { status: "PAID", paidAt: new Date(), externalId: invoice.id } });
        if (result.count) await tx.client.update({ where: { id: payment.clientId }, data: { balance: { increment: payment.amount } } });
        return result.count > 0;
      });
      if (credited) await notifyBalanceToppedUp(payment.clientId, payment.amount, payment.currency, "ParityPay").catch(()=>{});
    } else {
      if (!meta.paritypayAppliedAt) {
        // Compare-and-swap claim prevents concurrent callbacks from activating twice.
        // A crashed/uncertain activation is left claimed for review, never blindly repeated.
        if (meta.paritypayProcessingAt) return res.status(503).send("Activation pending review");
        const claimed = await prisma.payment.updateMany({ where: { id: payment.id, status: "PENDING", metadata: payment.metadata }, data: { status: "PAID", paidAt: new Date(), externalId: invoice.id, metadata: JSON.stringify({ ...meta, paritypayProcessingAt: new Date().toISOString() }) } });
        if (!claimed.count) return res.status(503).send("Activation in progress");
        const activation = meta.extraOption ? await applyExtraOptionByPaymentId(payment.id)
          : payment.proxyTariffId ? await createProxySlotsByPaymentId(payment.id)
          : payment.singboxTariffId ? await createSingboxSlotsByPaymentId(payment.id)
          : await activateTariffByPaymentId(payment.id);
        const latest = await prisma.payment.findUnique({ where: { id: payment.id }, select: { metadata: true } });
        const next = latest?.metadata ? JSON.parse(latest.metadata) as Record<string,unknown> : meta;
        if (!activation.ok) {
          await prisma.payment.update({ where: { id: payment.id }, data: { metadata: JSON.stringify({ ...next, paritypayActivationError: activation.error || "Activation failed" }) } });
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
        if (payment.tariffId || meta.customBuild) await notifyTariffActivated(payment.clientId, payment.id).catch(()=>{});
        await extinguishOneTimeDiscount(payment.clientId);
      }
    }
    await recordPromoCodeUsageFromPayment(payment.id);
    await distributeReferralRewards(payment.id);
    return res.status(200).send("OK");
  } catch (error) {
    console.error("[ParityPay webhook] processing failed", error instanceof Error ? error.message : "Unknown error");
    return res.status(503).send("Retry later");
  }
});
