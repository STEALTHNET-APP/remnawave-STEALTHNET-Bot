/**
 * Webhook Heleket: статусы paid, paid_over.
 * Проверка подписи: md5(base64(json без sign) + apiKey), слэши в JSON экранированы.
 * Документация: https://doc.heleket.com/methods/payments/webhook
 */

import { Router, Request, Response } from "express";
import { prisma } from "../../db.js";
import { getSystemConfig } from "../client/client.service.js";
import { verifyHeleketWebhookSignature } from "../heleket/heleket.service.js";
import { activateTariffByPaymentId } from "../tariff/tariff-activation.service.js";
import { createProxySlotsByPaymentId } from "../proxy/proxy-slots-activation.service.js";
import { createSingboxSlotsByPaymentId } from "../singbox/singbox-slots-activation.service.js";
import { applyExtraOptionByPaymentId } from "../extra-options/extra-options.service.js";
import { distributeReferralRewards } from "../referral/referral.service.js";
import { notifyBalanceToppedUp, notifyTariffActivated, notifyProxySlotsCreated, notifySingboxSlotsCreated } from "../notification/telegram-notify.service.js";
import { recordPromoCodeUsageFromPayment } from "../payment/promo-code-usage.util.js";
import { auditPaymentClientBotAlignment } from "../payment/payment-webhook-audit.util.js";

function hasExtraOptionInMetadata(metadata: string | null): boolean {
  if (!metadata?.trim()) return false;
  try {
    const obj = JSON.parse(metadata) as Record<string, unknown>;
    return obj?.extraOption != null && typeof obj.extraOption === "object";
  } catch {
    return false;
  }
}

export const heleketWebhooksRouter = Router();

type HeleketWebhookPayload = {
  type?: string;
  order_id?: string;
  uuid?: string;
  status?: string;
  sign?: string;
};

/** POST /api/webhooks/heleket — вызывается с express.raw(), req.body = Buffer */
heleketWebhooksRouter.post("/", async (req: Request, res: Response) => {
  try {
  const rawBody = req.body;
  const rawString = typeof rawBody === "string" ? rawBody : Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : "";
  if (!rawString) {
    console.warn("[Heleket Webhook] Empty body");
    return res.status(400).send("Empty body");
  }

  const config = await getSystemConfig();
  const apiKey = (config as { heleketApiKey?: string | null }).heleketApiKey?.trim();
  if (!apiKey) {
    console.warn("[Heleket Webhook] Heleket not configured");
    return res.status(200).send("OK");
  }

  let body: HeleketWebhookPayload;
  try {
    body = JSON.parse(rawString) as HeleketWebhookPayload;
  } catch {
    console.warn("[Heleket Webhook] Invalid JSON");
    return res.status(400).send("Invalid JSON");
  }

  if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.sign !== "string") {
    return res.status(400).send("Invalid payload");
  }

  const signFromBody = body.sign;
  if (!verifyHeleketWebhookSignature(apiKey, rawString, signFromBody)) {
    console.warn("[Heleket Webhook] Invalid signature");
    return res.status(401).send("Invalid signature");
  }

  if (typeof body.status !== "string" || typeof body.order_id !== "string" || typeof body.uuid !== "string") {
    return res.status(400).send("Invalid payload");
  }
  const status = body.status.toLowerCase();
  if (status !== "paid" && status !== "paid_over") {
    return res.status(200).send("OK");
  }

  const orderId = body.order_id?.trim();
  if (!orderId) {
    console.warn("[Heleket Webhook] No order_id");
    return res.status(200).send("OK");
  }

  const payment = await prisma.payment.findFirst({
    where: { orderId, provider: "heleket" },
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
    console.warn("[Heleket Webhook] Payment not found", { orderId });
    return res.status(200).send("OK");
  }

  await auditPaymentClientBotAlignment(payment);

  if (payment.status === "PAID") {
    return res.status(200).send("OK");
  }

  const uuid = body.uuid.trim();
  if (!uuid) return res.status(400).send("Missing invoice uuid");
  const isExtraOption = hasExtraOptionInMetadata(payment.metadata);
  const isTopUp = !payment.tariffId && !payment.proxyTariffId && !payment.singboxTariffId && !isExtraOption;
  const paidData = { status: "PAID", paidAt: new Date(), externalId: uuid };
  const where = { id: payment.id, status: { not: "PAID" } };
  const claimed = isTopUp
    ? await prisma.$transaction(async (tx) => {
        const updated = await tx.payment.updateMany({ where, data: paidData });
        if (updated.count) {
          await tx.client.update({ where: { id: payment.clientId }, data: { balance: { increment: payment.amount } } });
        }
        return updated.count > 0;
      })
    : (await prisma.payment.updateMany({ where, data: paidData })).count > 0;
  if (!claimed) return res.status(200).send("OK");
  await recordPromoCodeUsageFromPayment(payment.id);

  if (isTopUp) {
    await notifyBalanceToppedUp(payment.clientId, payment.amount, payment.currency || "USD", "Heleket").catch(() => {});
  } else if (isExtraOption) {
    const r = await applyExtraOptionByPaymentId(payment.id);
    if (r.ok) {
      const { notifyExtraOptionApplied } = await import("../notification/telegram-notify.service.js");
      await notifyExtraOptionApplied(payment.clientId, payment.id).catch(() => {});
    }
  } else if (payment.proxyTariffId) {
    const proxyResult = await createProxySlotsByPaymentId(payment.id);
    if (proxyResult.ok) {
      const tariff = await prisma.proxyTariff.findUnique({ where: { id: payment.proxyTariffId }, select: { name: true } });
      await notifyProxySlotsCreated(payment.clientId, proxyResult.slotIds, tariff?.name ?? undefined).catch(() => {});
    }
  } else if (payment.singboxTariffId) {
    const singboxResult = await createSingboxSlotsByPaymentId(payment.id);
    if (singboxResult.ok) {
      const tariff = await prisma.singboxTariff.findUnique({ where: { id: payment.singboxTariffId }, select: { name: true } });
      await notifySingboxSlotsCreated(payment.clientId, singboxResult.slotIds, tariff?.name ?? undefined).catch(() => {});
    }
  } else {
    const activation = await activateTariffByPaymentId(payment.id);
    if (activation.ok) await notifyTariffActivated(payment.clientId, payment.id).catch(() => {});
  }

  // сжигаем одноразовую персональную скидку после продуктовой покупки.
  if (!isTopUp) {
    const { extinguishOneTimeDiscount } = await import("../client/personal-discount.js");
    await extinguishOneTimeDiscount(payment.clientId).catch(() => {});
  }

  await distributeReferralRewards(payment.id).catch(() => {});

  return res.status(200).send("OK");
  } catch (error) {
    console.error("[Heleket Webhook] Processing failed", error);
    return res.status(503).send("Processing failed");
  }
});
