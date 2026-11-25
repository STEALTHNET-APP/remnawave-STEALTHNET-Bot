import { createHash } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { getSystemConfig } from "../client/client.service.js";
import { acceptPaidPayment } from "../payment/payment-delivery.service.js";
import { recordWebhook, markOutcome } from "../webhook-inbox/webhook-inbox.service.js";
import { decimalMinor, getRivarapayStatus, rivarapayConfig, rivarapayMatchesPayment, verifyRivarapaySignature } from "./rivarapay.service.js";

export const rivarapayWebhooksRouter = Router();
const notification = z.object({ event_type: z.string(), status: z.string(), amount: z.string().regex(/^\d+(?:\.\d{1,2})?$/), currency: z.string(), test: z.boolean(), payment_id: z.string().min(1).optional(), order_id: z.string().min(1), refund_id: z.string().optional() });
rivarapayWebhooksRouter.post("/", async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const captured = await recordWebhook("rivarapay", req, raw);
  const fail = async (code: number, message: string) => {
    await markOutcome(captured, code, "error", { errorMessage: message });
    return res.status(code).send(message);
  };
  try {
    const cfg = await getSystemConfig();
    if (!cfg.rivarapayApiKey || !cfg.rivarapayWebhookSecret) return fail(503, "Not configured");
    if (!verifyRivarapaySignature(cfg.rivarapayWebhookSecret, raw, req.header("x-signature"), req.header("x-timestamp"))) {
      await markOutcome(captured, 400, "rejected_signature"); return res.status(400).send("Invalid signature");
    }
    const eventId = req.header("x-event-id");
    if (!eventId || eventId.length > 200) return fail(400, "Invalid event id");
    let body; try { body = JSON.parse(raw.toString("utf8")); } catch { return fail(400, "Invalid JSON"); }
    if (!["payment.paid", "payment.canceled", "payment.expired", "payment.refunded"].includes(body.event_type)) {
      await markOutcome(captured, 200, "ignored_event"); return res.status(200).send("OK");
    }
    const parsed = notification.safeParse(body);
    if (!parsed.success) return fail(400, "Invalid payload");
    const event = parsed.data;
    const payment = await prisma.payment.findFirst({ where: { provider: "rivarapay", orderId: event.order_id } });
    if (!payment) return fail(404, "Payment not found");
    const meta = JSON.parse(payment.metadata || "{}");
    if (event.test !== meta.rivarapaySandbox || event.test !== cfg.rivarapaySandbox || event.currency !== payment.currency) return fail(400, "Payment mode or currency mismatch");
    const id = payment.externalId || event.payment_id;
    if (!id || (event.payment_id && event.payment_id !== id)) return fail(400, "Payment identity mismatch");
    const status = await getRivarapayStatus(rivarapayConfig(cfg), id);
    if (!rivarapayMatchesPayment(status, payment, meta.rivarapaySandbox === true)) return fail(400, "Payment mismatch");
    if (event.event_type !== "payment.refunded" && decimalMinor(event.amount) !== decimalMinor(payment.amount.toFixed(2))) return fail(400, "Amount mismatch");
    if (event.test) {
      await markOutcome(captured, 200, "ignored_event", { paymentId: payment.id, errorMessage: "Sandbox notification verified; no real service or balance credited" });
      return res.status(200).send("OK");
    }
    const digest = createHash("sha256").update(raw).digest("hex");
    if (event.event_type === "payment.paid" && event.status === "paid" && status.status === "SUCCEEDED") {
      const result = await acceptPaidPayment(payment.id, "rivarapay", status.id, { id: eventId, digest });
      await markOutcome(captured, 200, result.accepted ? "accepted" : "payment_already_paid", { paymentId: payment.id });
    } else if (event.event_type === "payment.refunded" && event.status === "succeeded" && ["REFUNDED", "PARTIALLY_REFUNDED"].includes(status.status)) {
      const amount = decimalMinor(event.amount);
      if (amount === null || amount <= 0n || status.refunded?.currency !== payment.currency || amount > BigInt(status.refunded?.amount ?? "0")) return fail(400, "Refund mismatch");
      await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM payments WHERE id = ${payment.id} FOR UPDATE`;
        const previous = await tx.paymentWebhookReceipt.findUnique({ where: { provider_eventId: { provider: "rivarapay", eventId } } });
        if (previous) { if (previous.digest !== digest || previous.paymentId !== payment.id) throw Error("Event mismatch"); return; }
        const current = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
        const delivery = await tx.paymentDelivery.findUnique({ where: { paymentId: payment.id } });
        if (delivery?.state === "PROCESSING") throw Error("Delivery in progress");
        const currentMeta = JSON.parse(current.metadata || "{}");
        const full = status.status === "REFUNDED";
        const product = !!(current.tariffId || current.proxyTariffId || current.singboxTariffId || currentMeta.extraOption || currentMeta.customBuild);
        if (full && current.status === "PAID") {
          if (!product) await tx.client.update({ where: { id: current.clientId }, data: { balance: { decrement: current.amount } } });
          const credits = await tx.referralCredit.findMany({ where: { paymentId: payment.id } });
          for (const credit of credits) await tx.client.update({ where: { id: credit.referrerId }, data: { balance: { decrement: credit.amount } } });
          await tx.referralCredit.deleteMany({ where: { paymentId: payment.id } });
        }
        await tx.payment.update({ where: { id: payment.id }, data: { ...(full ? { status: "REFUNDED" } : {}), externalId: status.id, metadata: JSON.stringify({ ...currentMeta, rivarapayRefunded: status.refunded, rivarapayRefundReview: true, activationError: "RivaraPay подтвердил возврат. Проверьте выданный доступ и частичные начисления.", activationFailedAt: new Date().toISOString() }) } });
        await tx.paymentDelivery.updateMany({ where: { paymentId: payment.id }, data: { state: "REVIEW", error: "RivaraPay подтвердил возврат. Проверьте доступ и частичные начисления вручную." } });
        await tx.paymentWebhookReceipt.create({ data: { provider: "rivarapay", eventId, paymentId: payment.id, digest } });
      });
      await markOutcome(captured, 200, "accepted", { paymentId: payment.id });
    } else {
      if (["FAILED", "EXPIRED", "CANCELED"].includes(status.status)) await prisma.payment.updateMany({ where: { id: payment.id, status: "PENDING" }, data: { status: "FAILED", externalId: status.id } });
      if (event.event_type === "payment.paid" && ["CREATED", "PENDING", "PROCESSING"].includes(status.status)) return fail(503, "Awaiting provider confirmation");
      await markOutcome(captured, 200, "ignored_event", { paymentId: payment.id });
    }
    return res.status(200).send("OK");
  } catch {
    await markOutcome(captured, 503, "error", { errorMessage: "RivaraPay processing incomplete; retry required" });
    return res.status(503).send("Retry later");
  }
});
