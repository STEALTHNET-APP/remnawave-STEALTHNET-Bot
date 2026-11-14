import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { getSystemConfig } from "../client/client.service.js";
import { verifyRollypayWebhookSignature } from "../rollypay/rollypay.service.js";
import { acceptPaidPayment } from "../payment/payment-delivery.service.js";
import { recordWebhook, markOutcome } from "../webhook-inbox/webhook-inbox.service.js";

export const rollypayWebhooksRouter = Router();
const notification = z.object({ event_type: z.string(), payment_id: z.string().min(1), order_id: z.string().min(1), status: z.string(), amount: z.string().regex(/^\d+(\.\d{1,2})?$/), currency: z.string(), test: z.boolean() });

rollypayWebhooksRouter.post("/", async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : typeof req.body === "string" ? req.body : "";
  const captured = await recordWebhook("rollypay", req, raw);
  let paymentId: string | undefined;
  try {
    const config = await getSystemConfig();
    if (!config.rollypaySigningSecret) return res.status(503).send("Not configured");
    if (!verifyRollypayWebhookSignature(config.rollypaySigningSecret, raw, req.header("x-timestamp"), req.header("x-signature"))) {
      await markOutcome(captured, 401, "rejected_signature"); return res.status(401).send("Invalid signature");
    }
    const parsed = notification.safeParse(JSON.parse(raw));
    if (!parsed.success) { await markOutcome(captured, 400, "rejected_payload"); return res.status(400).send("Invalid payload"); }
    const b = parsed.data;
    const p = await prisma.payment.findFirst({ where: { orderId: b.order_id, provider: "rollypay" } });
    if (!p) { await markOutcome(captured, 404, "payment_not_found"); return res.status(404).send("Payment not found"); }
    paymentId = p.id;
    let meta: Record<string, unknown> = {}; try { meta = JSON.parse(p.metadata || "{}"); } catch {}
    const testMode = typeof meta.rollypayTestMode === "boolean" ? meta.rollypayTestMode : config.rollypayTestMode === true;
    const cents = Math.round(Number(b.amount) * 100);
    if (!Number.isSafeInteger(cents) || cents !== Math.round(p.amount * 100) || b.currency.toUpperCase() !== p.currency.toUpperCase() || b.test !== testMode || (p.externalId && p.externalId !== b.payment_id)) {
      await markOutcome(captured, 400, "rejected_payload", { paymentId, errorMessage: "Amount, currency, test mode or transaction mismatch" });
      return res.status(400).send("Payment mismatch");
    }
    if (b.status !== "paid" || b.event_type !== "payment.paid") {
      await markOutcome(captured, 200, "ignored_event", { paymentId }); return res.status(200).send("OK");
    }
    const result = await acceptPaidPayment(p.id, "rollypay", b.payment_id);
    await markOutcome(captured, 200, result.accepted ? "accepted" : "payment_already_paid", { paymentId });
    return res.status(200).send("OK");
  } catch (e) {
    await markOutcome(captured, 503, "error", { paymentId, errorMessage: e instanceof Error ? e.message : "Processing failed" });
    return res.status(503).send("Retry later");
  }
});
