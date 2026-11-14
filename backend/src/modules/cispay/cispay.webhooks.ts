import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { getSystemConfig } from "../client/client.service.js";
import { acceptPaidPayment } from "../payment/payment-delivery.service.js";
import { recordWebhook, markOutcome } from "../webhook-inbox/webhook-inbox.service.js";
import { cispayMatchesPayment, getCispayStatus, verifyCispaySignature } from "./cispay.service.js";

export const cispayWebhooksRouter = Router();
const notification = z.object({ id: z.string().uuid(), order_id: z.string().min(1), store_id: z.string().uuid(), status: z.string(), amount: z.number().int().positive(), currency: z.string(), is_sandbox: z.boolean() });
cispayWebhooksRouter.post("/", async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
  const captured = await recordWebhook("cispay", req, raw);
  try {
    const cfg = await getSystemConfig();
    if (!cfg.cispayApiKey || !cfg.cispayShopId) return res.status(503).send("Not configured");
    if (!verifyCispaySignature(cfg.cispayApiKey, raw, req.header("x-signature"))) {
      await markOutcome(captured, 401, "rejected_signature"); return res.status(401).send("Invalid signature");
    }
    let body; try { body = JSON.parse(raw.toString("utf8")); } catch { return res.status(400).send("Invalid JSON"); }
    if (body.store_id === cfg.cispayShopId && body.object === "subscription" && typeof body.event === "string" && body.event.startsWith("subscription.")) { await markOutcome(captured, 200, "ignored_event"); return res.status(200).send("OK"); }
    const parsed = notification.safeParse(body);
    if (!parsed.success || parsed.data.store_id !== cfg.cispayShopId) { await markOutcome(captured, 400, "rejected_payload"); return res.status(400).send("Invalid notification"); }
    const p = await prisma.payment.findFirst({ where: { provider: "cispay", orderId: parsed.data.order_id } });
    if (!p) { await markOutcome(captured, 404, "payment_not_found"); return res.status(404).send("Payment not found"); }
    const meta = JSON.parse(p.metadata || "{}");
    if (meta.cispayShopId !== cfg.cispayShopId) return res.status(409).send("Shop configuration changed");
    const status = await getCispayStatus({ shopId: cfg.cispayShopId, apiKey: cfg.cispayApiKey }, p.orderId);
    if (!cispayMatchesPayment(status, p, meta.cispaySandbox === true) || status.id !== parsed.data.id || status.amount !== parsed.data.amount || status.currency !== parsed.data.currency || status.is_sandbox !== parsed.data.is_sandbox) {
      await markOutcome(captured, 400, "rejected_payload", { paymentId: p.id, errorMessage: "Payment identity, amount, currency or sandbox mismatch" }); return res.status(400).send("Payment mismatch");
    }
    if (status.status === "PAID") {
      const result = await acceptPaidPayment(p.id, "cispay", status.id);
      await markOutcome(captured, 200, result.accepted ? "accepted" : "payment_already_paid", { paymentId: p.id });
    } else if (status.status === "REFUNDED") {
      await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM payments WHERE id = ${p.id} FOR UPDATE`;
        const current = await tx.payment.findUniqueOrThrow({ where: { id: p.id } });
        const currentMeta = JSON.parse(current.metadata || "{}");
        const delivery = await tx.paymentDelivery.findUnique({ where: { paymentId: p.id } });
        if (delivery?.state === "PROCESSING") throw Error("Delivery in progress; retry refund notification");
        const claim = await tx.payment.updateMany({ where: { id: p.id, status: { in: ["PAID", "PENDING", "FAILED"] } }, data: { status: "REFUNDED", externalId: status.id } });
        if (!claim.count) return;
        if (current.status === "PAID" && !delivery && !current.tariffId && !current.proxyTariffId && !current.singboxTariffId && !currentMeta.customBuild && !currentMeta.extraOption) await tx.client.update({ where: { id: p.clientId }, data: { balance: { decrement: p.amount } } });
        await tx.paymentDelivery.updateMany({ where: { paymentId: p.id }, data: { state: "REVIEW", error: "CisPay вернул оплату. Сверьте доступ и отмените выданную покупку вручную." } });
        const credits = await tx.referralCredit.findMany({ where: { paymentId: p.id } });
        for (const credit of credits) await tx.client.update({ where: { id: credit.referrerId }, data: { balance: { decrement: credit.amount } } });
        await tx.referralCredit.deleteMany({ where: { paymentId: p.id } });
      });
      await markOutcome(captured, 200, "accepted", { paymentId: p.id });
    } else {
      if (["FAILED", "EXPIRED"].includes(status.status)) await prisma.payment.updateMany({ where: { id: p.id, status: "PENDING" }, data: { status: "FAILED", externalId: status.id } });
      await markOutcome(captured, 200, "ignored_event", { paymentId: p.id });
    }
    return res.status(200).send("OK");
  } catch {
    await markOutcome(captured, 503, "error", { errorMessage: "CisPay processing incomplete; retry required" });
    return res.status(503).send("Retry later");
  }
});
