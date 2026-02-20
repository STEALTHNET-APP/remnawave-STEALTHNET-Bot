/**
 * Webhook ЮKassa — уведомления о статусе платежа (JSON).
 * Событие payment.succeeded: помечаем платёж PAID, активируем тариф или зачисляем баланс, рефералы.
 * Документация: https://yookassa.ru/developers/using-api/webhooks
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

export const yookassaWebhooksRouter = Router();

yookassaWebhooksRouter.get("/yookassa", (_req, res) => {
  res.status(200).json({ status: "ok", message: "YooKassa webhook is available" });
});

type YookassaNotification = {
  type?: string;
  event?: string;
  object?: {
    id?: string;
    status?: string;
    amount?: { value?: string; currency?: string };
    metadata?: Record<string, string>;
  };
};

yookassaWebhooksRouter.post("/yookassa", async (req, res) => {
  let body: YookassaNotification = {};
  if (req.body && typeof req.body === "object") {
    body = req.body as YookassaNotification;
  }
  if (!body.object?.metadata?.payment_id) {
    console.warn("[YooKassa Webhook] Missing or invalid body/object/metadata.payment_id", {
      hasBody: !!req.body,
      event: body.event,
    });
    return res.status(200).send("OK");
  }

  const event = body.event ?? "";
  const paymentId = body.object?.metadata?.payment_id?.trim();
  if (!paymentId) {
    return res.status(200).send("OK");
  }

  if (event !== "payment.succeeded") {
    console.log("[YooKassa Webhook] Ignored event", { event, paymentId });
    return res.status(200).send("OK");
  }

  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, provider: "yookassa" },
    select: { id: true, clientId: true, amount: true, currency: true, tariffId: true, proxyTariffId: true, status: true, metadata: true },
  });

  if (!payment) {
    console.warn("[YooKassa Webhook] Payment not found", { paymentId });
    return res.status(200).send("OK");
  }

  if (payment.status === "PAID") {
    console.log("[YooKassa Webhook] Already processed", { paymentId });
    return res.status(200).send("OK");
  }

  const yookassaId = body.object?.id ?? null;
  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: "PAID", paidAt: new Date(), externalId: yookassaId },
  });

  const isExtraOption = hasExtraOptionInMetadata(payment.metadata);
  const isTopUp = !payment.tariffId && !payment.proxyTariffId && !isExtraOption;

  if (isTopUp) {
    await prisma.client.update({
      where: { id: payment.clientId },
      data: { balance: { increment: payment.amount } },
    });
    console.log("[YooKassa Webhook] Payment PAID, balance credited (top-up)", {
      paymentId: payment.id,
      clientId: payment.clientId,
      amount: payment.amount,
    });
    await notifyBalanceToppedUp(payment.clientId, payment.amount, payment.currency || "RUB").catch(() => {});
  } else if (isExtraOption) {
    const result = await applyExtraOptionByPaymentId(payment.id);
    if (result.ok) {
      console.log("[YooKassa Webhook] Extra option applied", { paymentId: payment.id });
    } else {
      console.error("[YooKassa Webhook] Extra option apply failed", {
        paymentId: payment.id,
        error: (result as { error?: string }).error,
      });
    }
  } else if (payment.proxyTariffId) {
    const proxyResult = await createProxySlotsByPaymentId(payment.id);
    if (proxyResult.ok) {
      console.log("[YooKassa Webhook] Proxy slots created", { paymentId: payment.id, slots: proxyResult.slotsCreated });
      const tariff = await prisma.proxyTariff.findUnique({ where: { id: payment.proxyTariffId }, select: { name: true } });
      await notifyProxySlotsCreated(payment.clientId, proxyResult.slotIds, tariff?.name ?? undefined).catch(() => {});
    } else {
      console.error("[YooKassa Webhook] Proxy slots creation failed", {
        paymentId: payment.id,
        error: proxyResult.error,
      });
    }
  } else {
    const activation = await activateTariffByPaymentId(payment.id);
    if (activation.ok) {
      console.log("[YooKassa Webhook] Tariff activated", { paymentId: payment.id });
      await notifyTariffActivated(payment.clientId, payment.id).catch(() => {});
    } else {
      console.error("[YooKassa Webhook] Tariff activation failed", {
        paymentId: payment.id,
        error: (activation as { error?: string }).error,
      });
    }
  }

  await distributeReferralRewards(payment.id).catch((e) => {
    console.error("[YooKassa Webhook] Referral distribution error", { paymentId: payment.id, error: e });
  });

  return res.status(200).send("OK");
});
