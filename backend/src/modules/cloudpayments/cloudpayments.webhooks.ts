import { Router } from "express";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import { cloudConfig, currentAgreementPrice, encryptCardToken, readMetadata } from "./cloudpayments.service.js";
import { parseCloudNotification, verifyCloudPaymentsSignature, sameAmount } from "./cloudpayments-api.js";

export const cloudWebhooksRouter = Router();
const kinds = new Set(["check", "pay", "fail", "recurrent", "refund", "cancel", "confirm"]);
const identifier = (v: unknown) => typeof v === "string" || typeof v === "number" ? String(v) : "";
export const cloudIsTest = (value: unknown) => value === true || value === 1 || value === "1";

export async function validateCloudPayment(body: Record<string, unknown>, check: boolean): Promise<number> {
  const cfg = await cloudConfig();
  if (![true, false, 1, 0, "1", "0"].includes(body.TestMode as never) || cloudIsTest(body.TestMode) !== cfg.cloudpaymentsTestMode) return 13;
  if (body.OperationType !== "Payment" || body.Status !== "Completed") return 13;
  const transactionId = identifier(body.TransactionId);
  if (!/^\d+$/.test(transactionId)) return 13;
  if (body.SubscriptionId) {
    const agreement = await prisma.cloudPaymentAgreement.findUnique({ where: { providerId: identifier(body.SubscriptionId) } });
    if (!agreement || body.AccountId !== agreement.id || agreement.terminalId !== cfg.publicId || !agreement.subscriptionId) return 11;
    if (check && (!["ACTIVE", "PAST_DUE"].includes(agreement.state) || !agreement.nextChargeAt || agreement.nextChargeAt.getTime() > Date.now() + 60_000)) return 13;
    const existing = await prisma.payment.findUnique({ where: { orderId: `cp-${transactionId}` } });
    if (existing) return existing.status === "FAILED" || existing.status === "REFUNDED" ? 13 : sameAmount(existing.amount, body.Amount) && existing.currency === body.Currency ? 0 : 12;
    if (!["ACTIVE", "PAST_DUE"].includes(agreement.state)) return 13;
    const quote = await currentAgreementPrice(agreement.id);
    if (!sameAmount(quote.amount, body.Amount) || agreement.currency !== body.Currency) return 12;
    return prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cloudpayments-cycle:${agreement.id}`}))`;
      const current = await tx.cloudPaymentAgreement.findUniqueOrThrow({ where: { id: agreement.id } });
      if (!["ACTIVE", "PAST_DUE"].includes(current.state) || !current.nextChargeAt) return 13;
      const cycle = `${agreement.id}:${current.nextChargeAt.toISOString()}`;
      const duplicate = await tx.payment.findFirst({ where: { provider: "cloudpayments", clientId: agreement.clientId, status: { in: ["PENDING", "PAID"] }, metadata: { contains: JSON.stringify(cycle) } } });
      if (duplicate) return duplicate.externalId === transactionId ? 0 : 13;
      await tx.payment.create({ data: {
        orderId: `cp-${transactionId}`, clientId: agreement.clientId, provider: "cloudpayments", externalId: transactionId,
        amount: quote.amount, currency: agreement.currency, tariffId: agreement.tariffId,
        tariffPriceOptionId: agreement.priceOptionId, subscriptionId: agreement.subscriptionId,
        metadata: JSON.stringify({ extendsSecondarySubId: agreement.subscriptionId, cloudAgreementId: agreement.id, cloudCycle: cycle, cloudRecurring: true, cloudPeriodDays: agreement.periodDays, cloudTerminalId: cfg.publicId, cloudTestMode: cfg.cloudpaymentsTestMode }),
      } });
      return 0;
    });
  }
  const payment = await prisma.payment.findFirst({ where: { orderId: identifier(body.InvoiceId), provider: "cloudpayments" } });
  if (!payment) return 10;
  const meta = readMetadata(payment.metadata);
  if (!meta.cloudAcceptedAt || meta.cloudTerminalId !== cfg.publicId || body.AccountId !== (meta.cloudAccountId || meta.cloudAgreementId || payment.clientId)) return 11;
  if (meta.cloudTestMode !== cloudIsTest(body.TestMode)) return 13;
  if (!sameAmount(payment.amount, body.Amount) || payment.currency !== body.Currency) return 12;
  if (payment.externalId && payment.externalId !== transactionId) return 13;
  if (payment.status === "PAID") return check ? 13 : 0;
  if (payment.status !== "PENDING") return 13;
  if (check && Date.now() - payment.createdAt.getTime() > 86_400_000) return 20;
  const claim = await prisma.payment.updateMany({ where: { id: payment.id, status: "PENDING", OR: [{ externalId: null }, { externalId: transactionId }] }, data: { externalId: transactionId } });
  return claim.count ? 0 : 13;
}

cloudWebhooksRouter.post("/:kind", async (req, res) => {
  const kind = req.params.kind.toLowerCase();
  if (!kinds.has(kind)) return res.sendStatus(404);
  try {
    const cfg = await cloudConfig();
    const raw = req.body;
    if (!Buffer.isBuffer(raw) || !verifyCloudPaymentsSignature(raw, req.header("Content-HMAC"), cfg.apiSecret)) return res.sendStatus(401);
    const body = parseCloudNotification(raw, req.header("Content-Type") || "");
    if (kind === "check") return res.json({ code: await validateCloudPayment(body, true) });
    const validationCode = kind === "pay" ? await validateCloudPayment(body, false).catch(() => 13) : 0;
    const clean: Record<string, string | number | boolean> = {};
    for (const field of ["TransactionId", "PaymentTransactionId", "InvoiceId", "AccountId", "SubscriptionId", "Id", "Status", "Amount", "Currency", "TestMode", "OperationType", "DateTime", "ReasonCode", "NextTransactionDate", "FailedTransactionsNumber", "SuccessfulTransactionsNumber"]) {
      const value = body[field];
      if (["string", "number", "boolean"].includes(typeof value)) clean[field] = value as string | number | boolean;
    }
    if (validationCode) clean.validationCode = validationCode;
    if (typeof body.Token === "string" && kind === "pay") clean.tokenEncrypted = encryptCardToken(body.Token);
    const key = kind === "recurrent" ? createHash("sha256").update(raw).digest("hex") : identifier(body.TransactionId);
    if (!key) return res.status(400).json({ code: 13 });
    await prisma.cloudPaymentEvent.createMany({ data: [{ id: `${kind}:${key}`, kind, body: clean as Prisma.InputJsonObject }], skipDuplicates: true });
    return res.json({ code: 0 });
  } catch {
    return res.status(503).json({ code: 13 });
  }
});
