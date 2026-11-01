/**
 * Webhook Lava.top — обрабатывает события подписок и разовых оплат.
 *
 * Поддерживаемые события:
 *   - payment.success                            — первая оплата (или ONE_TIME топ-ап)
 *   - payment.failed                             — ошибка
 *   - subscription.recurring.payment.success     — авто-списание раз в месяц
 *   - subscription.recurring.payment.failed      — ошибка авто-списания
 *   - subscription.cancelled                     — клиент отменил подписку
 *
 * Логика:
 *   • Тариф (lavatopOfferId на тарифе) → подписка MONTHLY:
 *       - первый webhook (payment.success) активирует тариф (durationDays)
 *       - каждый recurring webhook ПРОДЛЕВАЕТ тариф (создаёт новый payment + активация)
 *   • Топ-ап баланса → разовая оплата (ONE_TIME):
 *       - один webhook payment.success → +amount к балансу
 *
 * Авторизация — `X-Api-Key` (или `Authorization: Bearer`). Подписи HMAC у
 * Lava.top нет, просто сверяется ключ.
 *
 * Документация: https://developers.lava.top/ru
 */

import { Router, Request, Response } from "express";
import { randomUUID } from "crypto";
import { prisma } from "../../db.js";
import { getSystemConfig } from "../client/client.service.js";
import { verifyLavatopWebhookAuth, parseLavatopWebhook, type LavatopWebhookEvent } from "../lavatop/lavatop.service.js";
import { activateTariffByPaymentId } from "../tariff/tariff-activation.service.js";
import { createProxySlotsByPaymentId } from "../proxy/proxy-slots-activation.service.js";
import { createSingboxSlotsByPaymentId } from "../singbox/singbox-slots-activation.service.js";
import { applyExtraOptionByPaymentId } from "../extra-options/extra-options.service.js";
import { distributeReferralRewards } from "../referral/referral.service.js";
import {
  notifyBalanceToppedUp,
  notifyTariffActivated,
  notifyProxySlotsCreated,
  notifySingboxSlotsCreated,
} from "../notification/telegram-notify.service.js";
import { recordPromoCodeUsageFromPayment } from "../payment/promo-code-usage.util.js";
import { auditPaymentClientBotAlignment } from "../payment/payment-webhook-audit.util.js";

function parseMetadata(metadata: string | null): Record<string, unknown> {
  if (!metadata?.trim()) return {};
  try { return JSON.parse(metadata) as Record<string, unknown>; } catch { return {}; }
}

export const lavatopWebhooksRouter = Router();

/** Активирует/продлевает тариф (или прокси/singbox/extras/topup) по существующему PAID payment. */
async function activatePayment(paymentId: string) {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      clientId: true,
      amount: true,
      currency: true,
      tariffId: true,
      proxyTariffId: true,
      singboxTariffId: true,
      metadata: true,
    },
  });
  if (!payment) return;

  const meta = parseMetadata(payment.metadata);
  const isExtraOption = Boolean(meta.extraOption);
  const isCustomBuild = Boolean(meta.customBuild);
  const isTopUp =
    !payment.tariffId &&
    !payment.proxyTariffId &&
    !payment.singboxTariffId &&
    !isExtraOption &&
    !isCustomBuild;

  if (isTopUp) {
    await notifyBalanceToppedUp(payment.clientId, payment.amount, payment.currency || "RUB", "Lava.top").catch(() => {});
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
}

class RecurringIdentityError extends Error {}

/** Recurring renewal: клонирует исходный payment, создаёт новый PAID и активирует. */
async function handleRecurringRenewal(event: LavatopWebhookEvent): Promise<void> {
  const parentOrderId = event.parentContractId?.trim();
  const rawChildOrderId = event.contractId?.trim();
  if (!parentOrderId || !rawChildOrderId) {
    console.warn("[Lava.top Webhook] recurring без parentContractId/contractId", event);
    return;
  }

  const raw = event.raw as Record<string, unknown>;
  const identity = [raw.invoiceId, raw.invoice_id, raw.event_id, raw.eventId, raw.id]
    .find(value => typeof value === "string" && value.trim().length > 0);
  const timestamp = event.timestamp?.trim();
  const recurringKey = typeof identity === "string" ? identity.trim()
    : timestamp && Number.isFinite(Date.parse(timestamp)) ? timestamp : null;
  if (rawChildOrderId === parentOrderId && !recurringKey) {
    throw new RecurringIdentityError("Recurring webhook has no stable payment identity");
  }
  const recurringOrderId = rawChildOrderId !== parentOrderId
    ? rawChildOrderId
    : `lavatop-rec-${parentOrderId}-${recurringKey}`;

  const alreadyProcessed = await prisma.payment.findUnique({
    where: { orderId: recurringOrderId },
    select: { id: true, status: true },
  });
  if (alreadyProcessed) {
    if (alreadyProcessed.status !== "PAID") {
      const flipped = await prisma.payment.updateMany({
        where: { id: alreadyProcessed.id, status: { not: "PAID" } },
        data: { status: "PAID", paidAt: new Date() },
      });
      if (flipped.count > 0) await activatePayment(alreadyProcessed.id);
    }
    return;
  }

  // Находим исходный (parent) платёж — берём из него clientId, tariffId
  const parent = await prisma.payment.findFirst({
    where: { orderId: parentOrderId, provider: "lavatop" },
    select: {
      id: true,
      clientId: true,
      currency: true,
      tariffId: true,
      tariffPriceOptionId: true,
      proxyTariffId: true,
      singboxTariffId: true,
      deviceCount: true,
      metadata: true,
    },
  });
  if (!parent) {
    console.warn("[Lava.top Webhook] recurring: parent payment не найден", { parentOrderId });
    return;
  }

  // Сумма берётся из webhook'а (Lava сообщает фактически списанную сумму)
  const amount = event.amount ?? 0;
  const currency = (event.currency || parent.currency || "RUB").toLowerCase();

  let metadata = parseMetadata(parent.metadata);
  const isExtraOption = Boolean(metadata.extraOption);
  const isCustomBuild = Boolean(metadata.customBuild);
  const isTopUp = !parent.tariffId && !parent.proxyTariffId && !parent.singboxTariffId && !isExtraOption && !isCustomBuild;
  metadata = {
    ...metadata,
    recurring: true,
    parentContractId: parentOrderId,
    parentPaymentId: parent.id,
    lavatopRenewalAt: new Date().toISOString(),
  };

  // Создаём новый payment для этого месяца (расширение подписки)
  const newPaymentId = `cm_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.payment.create({
        data: {
          id: newPaymentId,
          clientId: parent.clientId,
          orderId: recurringOrderId,
          amount,
          currency,
          status: "PAID",
          provider: "lavatop",
          externalId: event.productId || null,
          tariffId: parent.tariffId,
          tariffPriceOptionId: parent.tariffPriceOptionId,
          proxyTariffId: parent.proxyTariffId,
          singboxTariffId: parent.singboxTariffId,
          deviceCount: parent.deviceCount,
          metadata: JSON.stringify(metadata),
          paidAt: new Date(),
        },
      });
      if (isTopUp) {
        await tx.client.update({
          where: { id: parent.clientId },
          data: { balance: { increment: amount } },
        });
      }
    });
  } catch (e) {
    if ((e as { code?: string })?.code === "P2002") return;
    throw e;
  }

  console.log("[Lava.top Webhook] recurring renewal — создан payment", { id: newPaymentId, amount, currency });

  // Активация (продление) тарифа / прокси / singbox / etc
  await activatePayment(newPaymentId);
}

/** POST /api/webhooks/lavatop */
lavatopWebhooksRouter.post("/", async (req: Request, res: Response) => {
  const config = await getSystemConfig();
  const apiKey = (config as { lavatopApiKey?: string | null }).lavatopApiKey?.trim();
  if (!apiKey) {
    console.warn("[Lava.top Webhook] не настроено (нет lavatop_api_key)");
    return res.status(200).send("OK");
  }

  const xApiKey = req.header("x-api-key") || req.header("X-Api-Key") || undefined;
  const auth = req.header("authorization") || undefined;
  if (!verifyLavatopWebhookAuth(apiKey, { xApiKey, authorization: auth })) {
    console.warn("[Lava.top Webhook] неверный X-Api-Key");
    return res.status(401).send("Unauthorized");
  }

  const body = req.body;
  if (!body || typeof body !== "object") {
    console.warn("[Lava.top Webhook] пустое body");
    return res.status(200).send("OK");
  }

  const event = parseLavatopWebhook(body as Record<string, unknown>);
  console.log("[Lava.top Webhook]", {
    eventType: event.eventType,
    status: event.status,
    contractId: event.contractId,
    parentContractId: event.parentContractId,
    amount: event.amount,
    currency: event.currency,
    email: event.buyerEmail,
  });

  // ─── Отмена подписки клиентом ──────────────────────────────────
  if (event.status === "cancelled" || /subscription\.cancelled/i.test(event.eventType)) {
    // Просто фиксируем в логе. Не отменяем уже выданный тариф —
    // он истечёт по своему сроку. Дальше клиент платит новой подпиской если хочет.
    console.log("[Lava.top Webhook] подписка отменена", { contractId: event.contractId });
    return res.status(200).send("OK");
  }

  // Обрабатываем только успешные платежи — failed логируем и игнорим.
  if (event.status !== "success") {
    return res.status(200).send("OK");
  }

  // ─── Recurring renewal: subscription.recurring.payment.success ──
  if (/subscription\.recurring\.payment\.success/i.test(event.eventType)) {
    try {
      await handleRecurringRenewal(event);
    } catch (e) {
      if (e instanceof RecurringIdentityError) {
        try {
          await prisma.webhookEvent.create({
            data: {
              provider: "lavatop", rawBody: JSON.stringify(body), headers: {},
              responseStatus: 200, outcome: "rejected_payload", errorMessage: e.message,
            },
          });
          return res.status(200).send("OK");
        } catch {
          return res.status(503).send("Unable to retain webhook for review");
        }
      }
      console.error("[Lava.top Webhook] ошибка recurring renewal:", e);
      return res.status(503).send("Recurring payment processing failed");
    }
    return res.status(200).send("OK");
  }

  // ─── Первый платёж (payment.success / SUBSCRIPTION_FIRST_INVOICE) ──
  const orderId = event.contractId?.trim();
  if (!orderId) {
    console.warn("[Lava.top Webhook] нет contractId");
    return res.status(200).send("OK");
  }

  const payment = await prisma.payment.findFirst({
    where: { orderId, provider: "lavatop" },
    select: { id: true, status: true, clientId: true, amount: true, currency: true, tariffId: true, proxyTariffId: true, singboxTariffId: true, metadata: true },
  });

  if (!payment) {
    console.warn("[Lava.top Webhook] payment не найден", { orderId });
    return res.status(200).send("OK");
  }

  await auditPaymentClientBotAlignment(payment);

  const meta = parseMetadata(payment.metadata);
  const isExtraOption = Boolean(meta.extraOption);
  const isCustomBuild = Boolean(meta.customBuild);
  const isTopUp = !payment.tariffId && !payment.proxyTariffId && !payment.singboxTariffId && !isExtraOption && !isCustomBuild;
  const paidData = { status: "PAID", paidAt: new Date(), externalId: event.productId || null };
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
  await activatePayment(payment.id);

  return res.status(200).send("OK");
});
