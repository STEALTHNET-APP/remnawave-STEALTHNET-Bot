/**
 * Вебхуки Platega.io — callback при смене статуса оплаты.
 * Пополнение баланса (без tariffId) → зачисляем на баланс клиента.
 * Покупка тарифа (есть tariffId) → активируем тариф в Remnawave, баланс не трогаем.
 * Реферальные начисления — в обоих случаях.
 *
 * Platega API docs:
 * - Статусы: PENDING, CANCELED, CONFIRMED, CHARGEBACKED
 * - Успешный платёж: CONFIRMED
 * - Структура webhook: { id, status, transaction: { id, status }, paymentDetails, externalId, invoiceId }
 */

import { Router } from "express";
import { prisma } from "../../db.js";
import { activateTariffByPaymentId } from "../tariff/tariff-activation.service.js";
import { distributeReferralRewards } from "../referral/referral.service.js";

export const plategaWebhooksRouter = Router();

const SELECT = { id: true, status: true, clientId: true, amount: true, currency: true, tariffId: true } as const;

plategaWebhooksRouter.post("/platega", async (req, res) => {
  // Всегда 200 OK, как в Panel — чтобы Platega не повторяла запросы при наших ошибках
  try {
    let data = req.body as Record<string, unknown> | null;
    if (!data || typeof data !== "object" || Object.keys(data).length === 0) {
      console.warn("[Platega Webhook] Empty or invalid body");
      return res.status(200).json({ status: "ok" });
    }

    console.log("[Platega Webhook] Received:", JSON.stringify(data, null, 2));

    // --- Статус ---
    const transaction = (data.transaction && typeof data.transaction === "object" ? data.transaction : {}) as Record<string, unknown>;
    let status = String(data.status ?? transaction.status ?? "").trim().toUpperCase();

    // Успешный платёж — CONFIRMED (по документации Platega), плюс обратная совместимость
    const SUCCESS_STATUSES = ["CONFIRMED", "PAID", "SUCCESS", "COMPLETED"];
    if (!SUCCESS_STATUSES.includes(status)) {
      console.log(`[Platega Webhook] Ignoring status: ${status}`);
      return res.status(200).json({ status: "ok" });
    }

    // --- ID транзакции ---
    const transactionId = String(data.transactionId ?? data.id ?? transaction.id ?? transaction.transactionId ?? "").trim() || undefined;
    const externalId = String(data.externalId ?? transaction.externalId ?? "").trim() || undefined;
    const invoiceId = String(data.invoiceId ?? transaction.invoiceId ?? "").trim() || undefined;
    // orderId — может прийти напрямую или через payload (мы передаём orderId в payload при создании)
    const payload = String(data.payload ?? transaction.payload ?? "").trim() || undefined;
    const orderId = String(data.orderId ?? data.order_id ?? data.order ?? data.merchant_order_id ?? "").trim() || undefined;

    console.log("[Platega Webhook] IDs:", { transactionId, externalId, invoiceId, orderId, payload, status });

    // --- Ищем платёж как в Panel: по всем возможным идентификаторам ---
    // payload — наш orderId, переданный при создании транзакции
    const candidateIds = [...new Set([payload, orderId, transactionId, externalId, invoiceId].filter(Boolean) as string[])];

    if (candidateIds.length === 0) {
      console.warn("[Platega Webhook] No identifiers in webhook", { keys: Object.keys(data) });
      return res.status(200).json({ status: "ok" });
    }

    let payment: { id: string; status: string; clientId: string; amount: number; currency: string; tariffId: string | null } | null = null;

    for (const id of candidateIds) {
      // По externalId (payment_system_id в Panel)
      payment = await prisma.payment.findFirst({
        where: { externalId: id, provider: "platega" },
        select: SELECT,
      });
      if (payment) break;

      // По orderId
      payment = await prisma.payment.findUnique({
        where: { orderId: id },
        select: SELECT,
      });
      if (payment) break;
    }

    if (!payment) {
      console.warn("[Platega Webhook] Payment not found", { triedIds: candidateIds });
      return res.status(200).json({ status: "ok" });
    }

    if (payment.status === "PAID") {
      console.log("[Platega Webhook] Payment already processed", { paymentId: payment.id });
      return res.status(200).json({ status: "ok" });
    }

    // --- Обработка ---
    const isTopUp = !payment.tariffId;
    if (isTopUp) {
      await prisma.$transaction([
        prisma.payment.update({
          where: { id: payment.id },
          data: { status: "PAID", paidAt: new Date(), externalId: transactionId ?? payment.id },
        }),
        prisma.client.update({
          where: { id: payment.clientId },
          data: { balance: { increment: payment.amount } },
        }),
      ]);
      console.log("[Platega Webhook] Payment PAID, balance credited (top-up)", { paymentId: payment.id, amount: payment.amount });
    } else {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: "PAID", paidAt: new Date(), externalId: transactionId ?? payment.id },
      });
      console.log("[Platega Webhook] Payment PAID (tariff)", { paymentId: payment.id });

      const activation = await activateTariffByPaymentId(payment.id);
      if (activation.ok) {
        console.log("[Platega Webhook] Tariff activated", { paymentId: payment.id });
      } else {
        console.error("[Platega Webhook] Tariff activation failed", { paymentId: payment.id, error: (activation as { error?: string }).error });
      }
    }

    await distributeReferralRewards(payment.id).catch((e) => {
      console.error("[Platega Webhook] Referral error", { paymentId: payment!.id, error: e });
    });

    return res.status(200).json({ status: "ok" });
  } catch (e) {
    console.error("[Platega Webhook] Error:", e);
    return res.status(200).json({ status: "ok" });
  }
});
