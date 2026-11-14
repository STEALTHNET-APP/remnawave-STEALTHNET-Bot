import cron from "node-cron";
import { prisma } from "../../db.js";
import { cloudConfig, DAY, readMetadata, syncCloudAgreement, applyCloudCancellation } from "./cloudpayments.service.js";
import { fulfillCloudTariff } from "./cloudpayments-fulfillment.js";
import { remnaGetUser, remnaUpdateUser } from "../remna/remna.client.js";
import { distributeReferralRewards } from "../referral/referral.service.js";
import { recordPromoCodeUsageFromPayment } from "../payment/promo-code-usage.util.js";
import { extinguishOneTimeDiscount } from "../client/personal-discount.js";
import { cloudRequest, sameAmount } from "./cloudpayments-api.js";

async function processEvent(id: string) {
  const event = await prisma.cloudPaymentEvent.findUniqueOrThrow({ where: { id } });
  if (event.processedAt) return;
  const b = event.body as Record<string, any>;
  const cfg = await cloudConfig();
  if (event.kind === "pay") {
    if (b.validationCode) throw new Error(`Банковская оплата требует сверки заказа: код ${b.validationCode}`);
    const payment = await prisma.payment.findFirst({ where: { provider: "cloudpayments", externalId: String(b.TransactionId) } });
    if (!payment || !sameAmount(payment.amount, b.Amount) || payment.currency !== b.Currency) throw new Error("Платёж не найден или сумма не совпадает");
    const meta = readMetadata(payment.metadata);
    await prisma.$transaction(async tx => {
      const paid = await tx.payment.updateMany({ where: { id: payment.id, status: "PENDING" }, data: { status: "PAID", paidAt: new Date() } });
      if (paid.count && !payment.tariffId && !payment.proxyTariffId && !payment.singboxTariffId && !meta.extraOption && !meta.customBuild) {
        await tx.client.update({ where: { id: payment.clientId }, data: { balance: { increment: payment.amount } } });
      }
      if (meta.cloudAgreementId && b.tokenEncrypted) await tx.cloudPaymentAgreement.update({ where: { id: meta.cloudAgreementId }, data: { tokenEncrypted: b.tokenEncrypted } });
      await tx.cloudPaymentJob.upsert({ where: { paymentId: payment.id }, update: {}, create: { paymentId: payment.id, transactionId: String(b.TransactionId), agreementId: meta.cloudAgreementId ?? null } });
    });
  } else if (event.kind === "fail") {
    if (b.SubscriptionId) {
      await prisma.payment.updateMany({ where: { provider: "cloudpayments", externalId: String(b.TransactionId), status: "PENDING" }, data: { status: "FAILED" } });
      const agreement = await prisma.cloudPaymentAgreement.findUnique({ where: { providerId: b.SubscriptionId } });
      if (!agreement || b.AccountId !== agreement.id || agreement.terminalId !== cfg.publicId) throw new Error("Автоплатёж не найден");
      const occurred = new Date(String(b.DateTime).replace(" ", "T") + (String(b.DateTime).endsWith("Z") ? "" : "Z"));
      if (agreement.nextChargeAt && agreement.nextChargeAt.getTime() <= occurred.getTime() + 60_000 && ["ACTIVE", "PAST_DUE"].includes(agreement.state)) {
        await prisma.cloudPaymentAgreement.update({ where: { id: agreement.id }, data: {
          state: "PAST_DUE", graceEndsAt: agreement.graceEndsAt ?? new Date(agreement.nextChargeAt.getTime() + cfg.cloudpaymentsGraceDays * DAY),
          lastError: `Платёж отклонён, код ${String(b.ReasonCode || "не указан")}`,
        } });
      }
    } else {
      await prisma.payment.updateMany({ where: { provider: "cloudpayments", orderId: String(b.InvoiceId || ""), externalId: String(b.TransactionId), status: "PENDING" }, data: { externalId: null } });
    }
  } else if (event.kind === "recurrent") {
    const agreement = await prisma.cloudPaymentAgreement.findFirst({ where: { OR: [{ providerId: String(b.Id) }, { id: String(b.AccountId) }] } });
    if (!agreement || b.AccountId !== agreement.id || agreement.terminalId !== cfg.publicId) throw new Error("Автоплатёж не найден");
    if (!agreement.providerId && agreement.createRequestedAt) await prisma.cloudPaymentAgreement.update({ where: { id: agreement.id }, data: { providerId: String(b.Id) } });
    if (b.Status === "Cancelled") await prisma.cloudPaymentAgreement.update({ where: { id: agreement.id }, data: { state: "CANCEL_PENDING" } });
    await syncCloudAgreement(agreement.id);
  } else if (event.kind === "refund") {
    await (await import("./cloudpayments-refund.js")).processCloudRefund(id, b);
    return;
  } else if (event.kind === "cancel") {
    const payment = await prisma.payment.findFirst({ where: { provider: "cloudpayments", externalId: String(b.TransactionId) } });
    if (!payment) throw new Error("Платёж для отмены не найден");
    const remote = await cloudRequest<{ Status: string }>(cfg, "payments/get", { TransactionId: b.TransactionId });
    if (remote.Status !== "Cancelled") throw new Error("Отмена ещё не подтверждена банком");
    if (payment.status === "PAID") throw new Error("Оплаченный заказ отменён: требуется сверка денег и выданного доступа");
    await prisma.payment.updateMany({ where: { id: payment.id, status: "PENDING" }, data: { status: "FAILED" } });
  }
  await prisma.cloudPaymentEvent.update({ where: { id }, data: { processedAt: new Date(), error: null } });
}

async function processJob(id: string) {
  const job = await prisma.cloudPaymentJob.findUniqueOrThrow({ where: { id }, include: { payment: true } });
  if (!["PENDING", "FULFILLED"].includes(job.state)) return;
  const p = job.payment;
  if (p.status !== "PAID") return;
  const meta = readMetadata(p.metadata);
  if (job.state === "PENDING") {
  if (p.tariffId) await fulfillCloudTariff(id);
  else if (meta.extraOption?.kind === "devices") {
    const result = await (await import("../extra-options/extra-options.service.js")).applyExtraOptionByPaymentId(p.id);
    if (!result.ok) throw new Error("Оплата принята, устройства ещё не выданы");
    await prisma.cloudPaymentJob.update({ where: { id }, data: { state: "FULFILLED", error: null } });
  } else if (p.proxyTariffId || p.singboxTariffId || meta.customBuild || meta.extraOption) {
    const claim = await prisma.cloudPaymentJob.updateMany({ where: { id, state: "PENDING" }, data: { state: "REVIEW", error: "Выдача начата; при сбое требуется сверка результата" } });
    if (!claim.count) return;
    const result = meta.extraOption ? await (await import("../extra-options/extra-options.service.js")).applyExtraOptionByPaymentId(p.id)
      : p.proxyTariffId ? await (await import("../proxy/proxy-slots-activation.service.js")).createProxySlotsByPaymentId(p.id)
      : p.singboxTariffId ? await (await import("../singbox/singbox-slots-activation.service.js")).createSingboxSlotsByPaymentId(p.id)
      : await (await import("../tariff/tariff-activation.service.js")).activateTariffByPaymentId(p.id);
    if (!result.ok) throw new Error("Оплата принята, выдача требует сверки");
    await prisma.cloudPaymentJob.update({ where: { id }, data: { state: "FULFILLED", error: null } });
  } else await prisma.cloudPaymentJob.update({ where: { id }, data: { state: "FULFILLED", error: null } });
  }
  await recordPromoCodeUsageFromPayment(p.id);
  await distributeReferralRewards(p.id);
  if (p.tariffId || meta.extraOption) await extinguishOneTimeDiscount(p.clientId);
  await prisma.cloudPaymentJob.update({ where: { id }, data: { state: "DONE", error: null } });
}

async function processAgreement(id: string) {
  await syncCloudAgreement(id);
  const agreement = await prisma.cloudPaymentAgreement.findUniqueOrThrow({ where: { id }, include: { subscription: true } });
  if (agreement.state === "CANCELLED") await applyCloudCancellation(id);
  const sub = agreement.subscription;
  if (agreement.graceEndsAt && sub?.remnawaveUuid && ["PAST_DUE", "REJECTED"].includes(agreement.state)) {
    const result = await remnaGetUser(sub.remnawaveUuid);
    if (result.error) throw new Error("Не удалось проверить льготный доступ");
    const response = result.data as Record<string, any>;
    const user = response?.response ?? response;
    const current = new Date(user?.expireAt).getTime();
    const desired = agreement.graceEndsAt.getTime();
    if (current < desired) {
      const update = await remnaUpdateUser({ uuid: sub.remnawaveUuid, expireAt: agreement.graceEndsAt.toISOString(), ...(desired > Date.now() ? { status: "ACTIVE" } : {}) });
      if (update.error) throw new Error("Не удалось применить льготный доступ");
      await prisma.subscription.update({ where: { id: sub.id }, data: { expireAt: agreement.graceEndsAt } });
    }
  }
}

async function exclusive(key: string, fn: () => Promise<void>) {
  await prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${`cloudpayments:${key}`})) AS locked`;
    if (rows[0]?.locked) await fn();
  }, { timeout: 600_000, maxWait: 5000 });
}

export async function processCloudPayments() {
  const events = await prisma.cloudPaymentEvent.findMany({ where: { processedAt: null }, orderBy: { receivedAt: "asc" }, take: 100 });
  for (const event of events) {
    try { await exclusive("worker", () => processEvent(event.id)); }
    catch (e) { await prisma.cloudPaymentEvent.update({ where: { id: event.id }, data: { error: e instanceof Error ? e.message : "Ошибка обработки" } }); }
  }
  const jobs = await prisma.cloudPaymentJob.findMany({ where: { state: { in: ["PENDING", "FULFILLED"] } }, orderBy: { createdAt: "asc" }, take: 50 });
  for (const job of jobs) {
    try { await exclusive("worker", () => processJob(job.id)); }
    catch (e) { await prisma.cloudPaymentJob.update({ where: { id: job.id }, data: { error: e instanceof Error ? e.message : "Ошибка выдачи" } }); }
  }
  const agreements = await prisma.cloudPaymentAgreement.findMany({ where: { OR: [{ state: { in: ["PENDING", "ACTIVE", "PAST_DUE", "CANCEL_PENDING"] } }, { state: { in: ["CANCELLED", "REJECTED"] }, updatedAt: { gte: new Date(Date.now() - DAY) } }] }, select: { id: true } });
  for (const agreement of agreements) {
    try { await exclusive("worker", () => processAgreement(agreement.id)); }
    catch (e) { await prisma.cloudPaymentAgreement.update({ where: { id: agreement.id }, data: { lastError: e instanceof Error ? e.message : "Ошибка синхронизации" } }); }
  }
}

export function startCloudPaymentsScheduler() {
  let running = false;
  cron.schedule("* * * * *", async () => {
    if (running) return;
    running = true;
    try { await processCloudPayments(); } catch { console.error("[cloudpayments] Worker failed"); }
    finally { running = false; }
  });
}
