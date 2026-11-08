/**
 * Webhook LAVA Business: статусы `success` (оплачен), `expired`, `cancel`, `error`.
 * Документация: https://dev.lava.ru/business-webhook
 *
 * Подпись: в заголовке `Authorization` (в некоторых кабинетах называется `Signature`).
 * Значение: HMAC-SHA256(rawBody, additionalKey) → hex.
 *
 * ВАЖНО: роутер монтируется с `express.raw({ type: "application/json" })`,
 * чтобы `req.body` был `Buffer` с ОРИГИНАЛЬНЫМ телом (иначе подпись не сойдётся).
 */

import { Router, Request, Response } from "express";
import { prisma } from "../../db.js";
import { getSystemConfig } from "../client/client.service.js";
import { verifyLavaWebhookSignature } from "../lava/lava.service.js";
import { activateTariffByPaymentId } from "../tariff/tariff-activation.service.js";
import { createProxySlotsByPaymentId } from "../proxy/proxy-slots-activation.service.js";
import { createSingboxSlotsByPaymentId } from "../singbox/singbox-slots-activation.service.js";
import { applyExtraOptionByPaymentId } from "../extra-options/extra-options.service.js";
import { distributeReferralRewards } from "../referral/referral.service.js";
import { notifyBalanceToppedUp, notifyProxySlotsCreated, notifySingboxSlotsCreated } from "../notification/telegram-notify.service.js";
import { recordPromoCodeUsageFromPayment } from "../payment/promo-code-usage.util.js";
import { handlePaymentActivationResult } from "../payment/payment-fulfillment.util.js";
import { auditPaymentClientBotAlignment } from "../payment/payment-webhook-audit.util.js";

function parseMetadata(metadata: string | null): Record<string, unknown> {
  if (!metadata?.trim()) return {};
  try { return JSON.parse(metadata) as Record<string, unknown>; } catch { return {}; }
}

export const lavaWebhooksRouter = Router();

type LavaWebhookPayload = {
  invoice_id?: string;
  order_id?: string;
  status?: string;
  amount?: number;
  pay_service?: string;
  pay_time?: string;
  payer_details?: string;
  custom_fields?: string | null;
  credited?: number;
};

/** POST /api/webhooks/lava — вызывается с express.raw(), req.body = Buffer */
lavaWebhooksRouter.post("/", async (req: Request, res: Response) => {
  const rawBody = req.body;
  const rawString = typeof rawBody === "string" ? rawBody : Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : "";
  if (!rawString) {
    console.warn("[Lava Webhook] Empty body");
    return res.status(200).send("OK");
  }

  const config = await getSystemConfig();
  const additionalKey = (config as { lavaAdditionalKey?: string | null }).lavaAdditionalKey?.trim();
  const secretKey = (config as { lavaSecretKey?: string | null }).lavaSecretKey?.trim();

  // Lava подписывает webhook'и через additional_key (подтверждено саппортом 04.05.2026).
  // secret_key используется только для исходящих запросов (создание платежа).
  // Раньше тут был fallback на secretKey — это давало 401 на легитимные webhook'и,
  // если админ не настроил additional_key (Lava-то подписывает другим ключом).
  if (!additionalKey) {
    if (secretKey) {
      console.warn("[Lava Webhook] additional_key NOT configured — webhook нельзя проверить. Зайди в кабинет Lava → Доп. настройки → Дополнительный секретный ключ → сгенерируй и впиши его в админке (Settings → Платежи → Lava → Additional key).");
      return res.status(503).send("Lava webhook signing key not configured");
    }
    console.warn("[Lava Webhook] Lava not configured at all");
    return res.status(200).send("OK");
  }
  const verifyKey = additionalKey;

  // Lava кладёт подпись в Authorization; некоторые версии — в Signature.
  const sigHeader =
    (req.headers["authorization"] as string | undefined) ??
    (req.headers["signature"] as string | undefined) ??
    (req.headers["x-signature"] as string | undefined);

  if (!verifyLavaWebhookSignature(verifyKey, rawString, sigHeader)) {
    console.warn("[Lava Webhook] Invalid signature");
    return res.status(401).send("Invalid signature");
  }

  let body: LavaWebhookPayload;
  try {
    body = JSON.parse(rawString) as LavaWebhookPayload;
  } catch {
    console.warn("[Lava Webhook] Invalid JSON");
    return res.status(200).send("OK");
  }

  const status = (body.status ?? "").toLowerCase();
  const orderId = body.order_id?.trim();
  if (!orderId) {
    console.warn("[Lava Webhook] No order_id");
    return res.status(200).send("OK");
  }

  const payment = await prisma.payment.findFirst({
    where: { orderId, provider: "lava" },
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
    console.warn("[Lava Webhook] Payment not found", { orderId });
    return res.status(200).send("OK");
  }

  await auditPaymentClientBotAlignment(payment);

  // Неуспех — помечаем FAILED, ничего больше не делаем.
  if (status !== "success") {
    if (payment.status === "PENDING" && (status === "expired" || status === "cancel" || status === "error")) {
      await prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED" } });
    }
    return res.status(200).send("OK");
  }

  const invoiceId = body.invoice_id ?? null;
  const meta = parseMetadata(payment.metadata);
  const isExtraOption = Boolean(meta.extraOption);
  const isCustomBuild = Boolean(meta.customBuild);
  const isTopUp = !payment.tariffId && !payment.proxyTariffId && !payment.singboxTariffId && !isExtraOption && !isCustomBuild;
  const paidData = { status: "PAID", paidAt: new Date(), externalId: invoiceId };
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

  if (!claimed) return res.status(200).send("OK");
  await recordPromoCodeUsageFromPayment(payment.id);

  if (isTopUp) {
    await notifyBalanceToppedUp(payment.clientId, payment.amount, payment.currency || "RUB", "Lava").catch(() => {});
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
    await handlePaymentActivationResult({
      paymentId: payment.id,
      clientId: payment.clientId,
      amount: payment.amount,
      currency: payment.currency || "RUB",
      provider: "lava",
      activation,
    });
  }

  // сжигаем одноразовую персональную скидку после продуктовой покупки.
  if (!isTopUp) {
    const { extinguishOneTimeDiscount } = await import("../client/personal-discount.js");
    await extinguishOneTimeDiscount(payment.clientId).catch(() => {});
  }

  await distributeReferralRewards(payment.id).catch(() => {});

  return res.status(200).send("OK");
});
