import { prisma } from "../../db.js";
import { cloudConfig, readMetadata } from "./cloudpayments.service.js";
import { cloudRequest, money } from "./cloudpayments-api.js";

export async function requestCloudRefund(paymentId: string) {
  const cfg = await cloudConfig();
  const request = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cloudpayments-refund:${paymentId}`}))`;
    const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    const meta = readMetadata(p.metadata);
    if (p.provider !== "cloudpayments" || p.status !== "PAID" || !p.externalId || meta.cloudTerminalId !== cfg.publicId) throw new Error("Платёж недоступен для возврата");
    if (meta.cloudRefundRequestAt && Date.now() - new Date(meta.cloudRefundRequestAt).getTime() > 55 * 60_000) throw new Error("Возврат уже запрошен. Сверьте его в CloudPayments перед новым запросом.");
    const amount = meta.cloudRefundRequestAmount ?? money(p.amount - Number(meta.cloudRefundedAmount || 0));
    if (amount <= 0) throw new Error("Сумма уже возвращена");
    await tx.payment.update({ where: { id: p.id }, data: { metadata: JSON.stringify({ ...meta, cloudRefundRequestAt: meta.cloudRefundRequestAt ?? new Date().toISOString(), cloudRefundRequestAmount: amount }) } });
    return { transactionId: p.externalId, amount };
  });
  await cloudRequest(cfg, "payments/refund", { TransactionId: request.transactionId, Amount: request.amount }, `refund-${paymentId}`);
  return { ok: true, payment: await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } }), summary: { creditedToBalance: 0, reversedReferralAmount: 0, reversedReferralCount: 0 } };
}

export async function processCloudRefund(eventId: string, body: Record<string, any>) {
  await prisma.$transaction(async tx => {
    const event = await tx.cloudPaymentEvent.findUniqueOrThrow({ where: { id: eventId } });
    if (event.processedAt) return;
    const found = await tx.payment.findFirst({ where: { provider: "cloudpayments", externalId: String(body.PaymentTransactionId) }, select: { id: true } });
    if (!found) throw new Error("Не найдена исходная оплата возврата");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cloudpayments-refund:${found.id}`}))`;
    const p = await tx.payment.findUniqueOrThrow({ where: { id: found.id } });
    if ( !["PAID", "REFUNDED"].includes(p.status) || body.OperationType !== "Refund") throw new Error("Не найдена исходная оплата возврата");
    const meta = readMetadata(p.metadata);
    if (body.AccountId && body.AccountId !== (meta.cloudAccountId || meta.cloudAgreementId || p.clientId)) throw new Error("Возврат относится к другому аккаунту");
    const amount = money(body.Amount);
    const refunded = money(Number(meta.cloudRefundedAmount || 0) + amount);
    if (amount <= 0 || refunded > money(p.amount)) throw new Error("Некорректная сумма возврата");
    const topup = !p.tariffId && !p.proxyTariffId && !p.singboxTariffId && !meta.extraOption && !meta.customBuild;
    if (topup) await tx.client.update({ where: { id: p.clientId }, data: { balance: { decrement: amount } } });
    const credits = await tx.referralCredit.findMany({ where: { paymentId: p.id } });
    for (const credit of credits) {
      const reverse = refunded === money(p.amount) ? credit.amount : money(credit.amount * amount / (p.amount - Number(meta.cloudRefundedAmount || 0)));
      await tx.client.update({ where: { id: credit.referrerId }, data: { balance: { decrement: reverse } } });
      await tx.referralCredit.update({ where: { id: credit.id }, data: { amount: money(credit.amount - reverse) } });
    }
    await tx.payment.update({ where: { id: p.id }, data: { status: refunded === money(p.amount) ? "REFUNDED" : "PAID", metadata: JSON.stringify({ ...meta, cloudRefundedAmount: refunded }) } });
    if (meta.cloudAgreementId) await tx.cloudPaymentAgreement.updateMany({ where: { id: meta.cloudAgreementId, state: { in: ["PENDING", "ACTIVE", "PAST_DUE"] } }, data: { state: "CANCEL_PENDING" } });
    await tx.cloudPaymentJob.updateMany({ where: { paymentId: p.id }, data: { state: topup ? "DONE" : "REVIEW", error: topup ? null : "Банк подтвердил возврат. Сверьте и при необходимости отключите выданный доступ." } });
    await tx.cloudPaymentEvent.update({ where: { id: eventId }, data: { processedAt: new Date(), error: null } });
  });
}
