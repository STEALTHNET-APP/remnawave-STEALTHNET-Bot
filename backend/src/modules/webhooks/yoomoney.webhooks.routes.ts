import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { prisma } from "../../db.js";
import { getSystemConfig } from "../client/client.service.js";
import { activateTariffByPaymentId } from "../tariff/tariff-activation.service.js";
import { createProxySlotsByPaymentId } from "../proxy/proxy-slots-activation.service.js";
import { createSingboxSlotsByPaymentId } from "../singbox/singbox-slots-activation.service.js";
import { applyExtraOptionByPaymentId } from "../extra-options/extra-options.service.js";
import {
  pickFirst,
  verifyYooMoneyHmacSign,
  computeYooMoneySha1,
} from "./yoomoney.signature.js";

export { pickFirst, verifyYooMoneyHmacSign, computeYooMoneySha1 };

function hasExtraOptionInMetadata(metadata: string | null): boolean {
  if (!metadata?.trim()) return false;
  try {
      const obj = JSON.parse(metadata) as Record<string, unknown>;
      return obj?.extraOption != null && typeof obj.extraOption === "object";
    } catch {
      return false;
    }
  }
  import { distributeReferralRewards } from "../referral/referral.service.js";
  import { notifyBalanceToppedUp, notifyTariffActivated, notifyProxySlotsCreated, notifySingboxSlotsCreated } from "../notification/telegram-notify.service.js";
  import { recordPromoCodeUsageFromPayment } from "../payment/promo-code-usage.util.js";
  import { auditPaymentClientBotAlignment } from "../payment/payment-webhook-audit.util.js";

  export const yoomoneyWebhooksRouter = Router();

  /** Как в Panel: GET для проверки доступности URL в настройках ЮMoney */
  yoomoneyWebhooksRouter.get("/yoomoney", (_req, res) => {
    res.status(200).json({ status: "ok", message: "YooMoney webhook is available" });
  });

  yoomoneyWebhooksRouter.post("/yoomoney", async (req, res) => {
    try {
    const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
    if (Array.isArray(body) || Object.keys(body).length === 0 || Object.values(body).some((value) => typeof value !== "string")) {
      console.warn("[YooMoney Webhook] Invalid form payload");
      return res.status(400).send("Bad request");
    }

    const notificationType = pickFirst(body.notification_type);
    const operationId = pickFirst(body.operation_id);
    const amountRaw = body.amount;
    const amount = Array.isArray(amountRaw) ? String(amountRaw[0] ?? "") : typeof amountRaw === "number" ? String(amountRaw) : String(amountRaw ?? "");
    const currency = pickFirst(body.currency);
    const datetime = pickFirst(body.datetime);
    const sender = pickFirst(body.sender);
    const codeproRaw = body.codepro;
    const codeproStr = Array.isArray(codeproRaw) ? String(codeproRaw[0] ?? "false") : codeproRaw === true || codeproRaw === "true" ? "true" : "false";
    let label = pickFirst(body.label);
    if (!label) label = pickFirst(body.order_id) || pickFirst(body.orderId) || pickFirst(body.custom);
    const receivedSign = pickFirst(body.sign);
    const sha1Hash = pickFirst(body.sha1_hash);
    const unaccepted = pickFirst(body.unaccepted).toLowerCase();

    console.log("[YooMoney Webhook] Incoming", {
      keys: Object.keys(body),
      notification_type: notificationType,
      operation_id: operationId,
      amount,
      label: label ? `${label.slice(0, 12)}…` : "(empty)",
      codepro: codeproStr,
      unaccepted: unaccepted || "(empty)",
      has_sign: Boolean(receivedSign),
      has_sha1: Boolean(sha1Hash),
    });

    if (!notificationType || !operationId || !amount || (!receivedSign && !sha1Hash)) {
      console.warn("[YooMoney Webhook] Missing required fields", { keys: Object.keys(body) });
      return res.status(400).send("Bad request");
    }

    if (codeproStr === "true") {
      console.log("[YooMoney Webhook] Ignored: codepro=true (protected transfer)");
      return res.status(200).send("OK");
    }
    if (unaccepted && unaccepted !== "false") {
      console.log("[YooMoney Webhook] Ignored: unaccepted=", unaccepted);
      return res.status(200).send("OK");
    }

    const config = await getSystemConfig();
    const secret = config.yoomoneyNotificationSecret?.trim();
    if (!secret) {
      console.warn("[YooMoney Webhook] yoomoney_notification_secret not configured");
      return res.status(500).send("Server configuration error");
    }

    let signatureValid = false;
    let signatureMethod = "";

    if (receivedSign) {
      if (verifyYooMoneyHmacSign(body, secret)) {
        signatureValid = true;
        signatureMethod = "HMAC-SHA256 (sign)";
      }
    }

    if (body.sign === undefined && /^[a-f0-9]{40}$/i.test(sha1Hash)) {
      const expectedHash = computeYooMoneySha1(
        notificationType,
        operationId,
        amount,
        currency,
        datetime,
        sender,
        codeproStr,
        secret,
        label
      );
      if (timingSafeEqual(Buffer.from(expectedHash, "hex"), Buffer.from(sha1Hash, "hex"))) {
        signatureValid = true;
        signatureMethod = "SHA-1 (sha1_hash)";
      }
    }

    if (!signatureValid) {
      console.warn("[YooMoney Webhook] Invalid signature", {
        hasSign: Boolean(receivedSign),
        hasSha1: Boolean(sha1Hash),
      });
      return res.status(403).send("Invalid signature");
    }

    console.log(`[YooMoney Webhook] Signature verified via ${signatureMethod}`, {
      operationId,
      label: label ? `${label.slice(0, 12)}…` : "(empty)",
    });

    if (!label.trim()) {
      console.warn("[YooMoney Webhook] Empty label, cannot match payment");
      return res.status(200).send("OK");
    }

    const labelNorm = label.trim();

    // Как в Panel: ищем сначала по id (мы пишем payment.id в label), потом по orderId, потом по operation_id
    type PaymentRow = {
      id: string;
      clientId: string;
      amount: number;
      tariffId: string | null;
      proxyTariffId: string | null;
      singboxTariffId: string | null;
      status: string;
      metadata: string | null;
    };
    let payment: PaymentRow | null = null;

    const paymentSelect = {
      id: true,
      clientId: true,
      amount: true,
      tariffId: true,
      proxyTariffId: true,
      singboxTariffId: true,
      status: true,
      metadata: true,
    } as const;
    // 1) По payment.id (наш label при создании = payment.id)
    payment = await prisma.payment.findFirst({
      where: { id: labelNorm, provider: "yoomoney_form" },
      select: paymentSelect,
    });

    // 2) По orderId (как в Panel: label = order_id)
    if (!payment) {
      payment = await prisma.payment.findFirst({
        where: { orderId: labelNorm, provider: "yoomoney_form" },
        select: paymentSelect,
      });
    }

    // 3) По operation_id как externalId
    if (!payment && operationId) {
      payment = await prisma.payment.findFirst({
        where: { externalId: operationId, provider: "yoomoney_form" },
        select: paymentSelect,
      });
    }

    if (!payment) {
      console.warn("[YooMoney Webhook] Payment not found", { label: labelNorm, operationId });
      return res.status(200).send("OK");
    }

    await auditPaymentClientBotAlignment(payment);

    if (payment.status === "PAID") {
      console.log("[YooMoney Webhook] Payment already processed", { paymentId: payment.id });
      return res.status(200).send("OK");
    }

    const amountNum = parseFloat(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return res.status(200).send("OK");
    }

    const isExtraOption = hasExtraOptionInMetadata(payment.metadata);
    const isTopUp = !payment.tariffId && !payment.proxyTariffId && !payment.singboxTariffId && !isExtraOption;

    const where = { id: payment.id, status: { not: "PAID" } };
    const data = { status: "PAID", paidAt: new Date(), externalId: operationId };
    const claimed = isTopUp
      ? await prisma.$transaction(async (tx) => {
          const updated = await tx.payment.updateMany({ where, data });
          if (updated.count) {
            await tx.client.update({ where: { id: payment.clientId }, data: { balance: { increment: amountNum } } });
          }
          return updated.count > 0;
        })
      : (await prisma.payment.updateMany({ where, data })).count > 0;
    if (!claimed) return res.status(200).send("OK");

    if (isTopUp) {
      console.log("[YooMoney Webhook] Payment PAID, balance credited (top-up)", {
        paymentId: payment.id,
        clientId: payment.clientId,
        amount: amountNum,
        operationId,
        notificationType,
      });
      await notifyBalanceToppedUp(payment.clientId, amountNum, currency || "RUB", "YooMoney").catch(() => {});
    } else {
      await recordPromoCodeUsageFromPayment(payment.id);
      console.log("[YooMoney Webhook] Payment PAID (tariff/option)", { paymentId: payment.id, operationId, notificationType });

      if (isExtraOption) {
        const result = await applyExtraOptionByPaymentId(payment.id);
        if (result.ok) {
          console.log("[YooMoney Webhook] Extra option applied", { paymentId: payment.id });
          const { notifyExtraOptionApplied } = await import("../notification/telegram-notify.service.js");
          await notifyExtraOptionApplied(payment.clientId, payment.id).catch(() => {});
        } else {
          console.error("[YooMoney Webhook] Extra option apply failed", { paymentId: payment.id, error: (result as { error?: string }).error });
        }
      } else if (payment.proxyTariffId) {
        const proxyResult = await createProxySlotsByPaymentId(payment.id);
        if (proxyResult.ok) {
          console.log("[YooMoney Webhook] Proxy slots created", { paymentId: payment.id, slots: proxyResult.slotsCreated });
          const tariff = await prisma.proxyTariff.findUnique({ where: { id: payment.proxyTariffId }, select: { name: true } });
          await notifyProxySlotsCreated(payment.clientId, proxyResult.slotIds, tariff?.name ?? undefined).catch(() => {});
        } else {
          console.error("[YooMoney Webhook] Proxy slots creation failed", { paymentId: payment.id, error: proxyResult.error });
        }
      } else if (payment.singboxTariffId) {
        const singboxResult = await createSingboxSlotsByPaymentId(payment.id);
        if (singboxResult.ok) {
          console.log("[YooMoney Webhook] Singbox slots created", { paymentId: payment.id, slots: singboxResult.slotsCreated });
          const tariff = await prisma.singboxTariff.findUnique({ where: { id: payment.singboxTariffId }, select: { name: true } });
          await notifySingboxSlotsCreated(payment.clientId, singboxResult.slotIds, tariff?.name ?? undefined).catch(() => {});
        } else {
          console.error("[YooMoney Webhook] Singbox slots creation failed", { paymentId: payment.id, error: singboxResult.error });
        }
      } else {
        const activation = await activateTariffByPaymentId(payment.id);
        if (activation.ok) {
          console.log("[YooMoney Webhook] Tariff activated", { paymentId: payment.id });
          await notifyTariffActivated(payment.clientId, payment.id).catch(() => {});
        } else {
          console.error("[YooMoney Webhook] Tariff activation failed", { paymentId: payment.id, error: (activation as { error?: string }).error });
        }
      }
    }

    // сжигаем одноразовую персональную скидку после продуктовой покупки.
    if (!isTopUp) {
      const { extinguishOneTimeDiscount } = await import("../client/personal-discount.js");
      await extinguishOneTimeDiscount(payment.clientId).catch(() => {});
    }

    await distributeReferralRewards(payment.id).catch((e) => {
      console.error("[YooMoney Webhook] Referral distribution error", { paymentId: payment.id, error: e });
    });

    return res.status(200).send("OK");
  } catch (error) {
    console.error("[YooMoney Webhook] Processing failed", error);
    return res.status(503).send("Processing failed");
  }
});
