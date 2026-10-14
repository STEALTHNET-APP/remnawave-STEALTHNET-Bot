/**
 * Webhook Platega:
 * - надёжно принимает разные форматы payload (orderId/externalId/transaction.id)
 * - идемпотентно переводит платежи PENDING -> PAID/FAILED
 * - топ-ап: зачисляет баланс атомарно вместе со сменой статуса
 * - тариф: активирует в Remna и распределяет реферальные (с ретраем по повторному webhook)
 *
 * Аутентификация (security fix против форджинга платежей):
 *
 * 1. **API double-check (основной)** — после получения webhook'а мы дёргаем Platega
 *    API `/transaction/status` с нашими `merchantId+secret` и проверяем что транзакция
 *    действительно в успешном статусе. Атакер не может подделать ответ от Platega API,
 *    поэтому даже без подписи webhook'а forge невозможен. Включён всегда когда заданы
 *    `plategaMerchantId` и `plategaSecret`.
 *
 * 2. **HMAC (опциональный)** — если admin задал `plategaWebhookSecret` в админке и
 *    Platega поддерживает custom HMAC headers, проверяется HMAC-SHA256(rawBody, secret)
 *    в заголовке `X-Signature` (hex, опционально с префиксом `sha256=`). На большинстве
 *    платежных провайдеров (включая Platega на сегодня) этой опции в кабинете нет —
 *    оставлено как future-proof заглушка.
 *
 * Если оба механизма не настроены — webhook принимается с громким warning'ом в логи.
 *
 * NB: для проверки HMAC нужен RAW body, поэтому в app.ts роут смонтирован с
 *     express.raw({ type: "application/json" }).
 */

import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "../../db.js";
import { getSystemConfig } from "../client/client.service.js";
import { checkPlategaBinding, checkPlategaWebhookTxId, getPlategaTransactionStatus, isPlategaConfigured, plategaTxIdToVerify } from "../platega/platega.service.js";
import { recordWebhook, markOutcome } from "../webhook-inbox/webhook-inbox.service.js";
import { activateTariffByPaymentId } from "../tariff/tariff-activation.service.js";
import { createProxySlotsByPaymentId } from "../proxy/proxy-slots-activation.service.js";
import { createSingboxSlotsByPaymentId } from "../singbox/singbox-slots-activation.service.js";
import { applyExtraOptionByPaymentId } from "../extra-options/extra-options.service.js";
import { distributeReferralRewards } from "../referral/referral.service.js";
import { notifyBalanceToppedUp, notifyTariffActivated, notifyTariffActivationFailed, notifyProxySlotsCreated, notifySingboxSlotsCreated } from "../notification/telegram-notify.service.js";
import { recordPromoCodeUsageFromPayment } from "../payment/promo-code-usage.util.js";
import { auditPaymentClientBotAlignment } from "../payment/payment-webhook-audit.util.js";
import { decidePlategaConfirmed, withPlategaCancelMarker, type PlategaApiCheck, type PlategaConfirmedDecision } from "./platega-transition.js";

function hasExtraOptionInMetadata(metadata: string | null): boolean {
  if (!metadata?.trim()) return false;
  try {
    const obj = JSON.parse(metadata) as Record<string, unknown>;
    return obj?.extraOption != null && typeof obj.extraOption === "object";
  } catch {
    return false;
  }
}

export const plategaWebhooksRouter = Router();

type PaymentRow = {
  id: string;
  orderId: string;
  externalId: string | null;
  status: string;
  clientId: string;
  amount: number;
  currency: string;
  tariffId: string | null;
  proxyTariffId: string | null;
  singboxTariffId: string | null;
  metadata: string | null;
};

const PAYMENT_SELECT = {
  id: true,
  orderId: true,
  externalId: true,
  status: true,
  clientId: true,
  amount: true,
  currency: true,
  tariffId: true,
  proxyTariffId: true,
  singboxTariffId: true,
  metadata: true,
} as const;

const SUCCESS_STATUSES = new Set(["CONFIRMED", "PAID", "SUCCESS", "SUCCEEDED", "COMPLETED", "SUCCESSFUL", "APPROVED"]);
const FAILED_STATUSES = new Set(["CANCELED", "CANCELLED", "FAILED", "DECLINED", "REJECTED", "ERROR", "EXPIRED", "CHARGEBACK", "CHARGEBACKED"]);

type Meta = Record<string, unknown> & {
  plategaActivationAppliedAt?: string;
  plategaActivationInProgressAt?: string;
  plategaActivationAttempts?: number;
  plategaActivationLastError?: string | null;
};

function pickFirstString(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function parseMeta(raw: string | null): Meta {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Meta;
  } catch {
    return {};
  }
}

async function findPlategaPaymentByAnyId(candidateIds: string[]): Promise<PaymentRow | null> {
  for (const id of candidateIds) {
    const byExternal = await prisma.payment.findFirst({
      where: { provider: "platega", externalId: id },
      select: PAYMENT_SELECT,
    });
    if (byExternal) return byExternal;

    const byOrder = await prisma.payment.findUnique({
      where: { orderId: id },
      select: { ...PAYMENT_SELECT, provider: true },
    });
    if (byOrder && byOrder.provider === "platega") {
      return {
        id: byOrder.id,
        orderId: byOrder.orderId,
        externalId: byOrder.externalId,
        status: byOrder.status,
        clientId: byOrder.clientId,
        amount: byOrder.amount,
        currency: byOrder.currency,
        tariffId: byOrder.tariffId,
        proxyTariffId: byOrder.proxyTariffId,
        singboxTariffId: byOrder.singboxTariffId,
        metadata: byOrder.metadata,
      };
    }
  }
  return null;
}

type ActivationOutcome =
  /** активация выполнена этим вызовом */
  | { applied: true; ok: true }
  /** активация выполнялась этим вызовом и упала */
  | { applied: true; ok: false; error: string }
  /** делать было нечего: уже применена ранее / in_progress / не PAID */
  | { applied: false; ok: true; reason: string };

async function ensureTariffActivation(paymentId: string): Promise<ActivationOutcome> {
  const claim = await prisma.$transaction(async (tx) => {
    const row = await tx.payment.findUnique({
      where: { id: paymentId },
      select: { status: true, tariffId: true, proxyTariffId: true, singboxTariffId: true, metadata: true, clientId: true },
    });
    const hasExtra = hasExtraOptionInMetadata(row?.metadata ?? null);
    if (!row || row.status !== "PAID" || (!row.tariffId && !row.proxyTariffId && !row.singboxTariffId && !hasExtra)) {
      return { claimed: false as const, reason: "not_paid_or_no_tariff" };
    }

    const meta = parseMeta(row.metadata);
    if (typeof meta.plategaActivationAppliedAt === "string" && meta.plategaActivationAppliedAt.trim()) {
      return { claimed: false as const, reason: "already_applied" };
    }

    const inProgressAt = typeof meta.plategaActivationInProgressAt === "string" ? new Date(meta.plategaActivationInProgressAt) : null;
    const freshInProgress = inProgressAt && Number.isFinite(inProgressAt.getTime()) && Date.now() - inProgressAt.getTime() < 10 * 60 * 1000;
    if (freshInProgress) {
      return { claimed: false as const, reason: "in_progress" };
    }

    const next: Meta = {
      ...meta,
      plategaActivationInProgressAt: new Date().toISOString(),
      plategaActivationAttempts: Number(meta.plategaActivationAttempts ?? 0) + 1,
    };
    await tx.payment.update({
      where: { id: paymentId },
      data: { metadata: JSON.stringify(next) },
    });
    return { claimed: true as const, reason: "claimed" };
  });

  if (!claim.claimed) return { applied: false, ok: true, reason: claim.reason };

  const row = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { tariffId: true, proxyTariffId: true, singboxTariffId: true, clientId: true, metadata: true },
  });
  const isExtraOption = row ? hasExtraOptionInMetadata(row.metadata) : false;
  let activation: { ok: boolean; error?: string; slotIds?: string[] } = { ok: false };
  if (isExtraOption) {
    activation = await applyExtraOptionByPaymentId(paymentId);
    if (activation.ok && row?.clientId) {
      const { notifyExtraOptionApplied } = await import("../notification/telegram-notify.service.js");
      await notifyExtraOptionApplied(row.clientId, paymentId).catch(() => {});
    }
  } else if (row?.proxyTariffId) {
    const proxyResult = await createProxySlotsByPaymentId(paymentId);
    activation = proxyResult.ok ? { ok: true, slotIds: proxyResult.slotIds } : { ok: false, error: proxyResult.error };
    if (activation.ok && activation.slotIds?.length && row.clientId) {
      const tariff = await prisma.proxyTariff.findUnique({ where: { id: row.proxyTariffId! }, select: { name: true } });
      await notifyProxySlotsCreated(row.clientId, activation.slotIds, tariff?.name ?? undefined).catch(() => {});
    }
  } else if (row?.singboxTariffId) {
    const singboxResult = await createSingboxSlotsByPaymentId(paymentId);
    activation = singboxResult.ok ? { ok: true, slotIds: singboxResult.slotIds } : { ok: false, error: singboxResult.error };
    if (activation.ok && activation.slotIds?.length && row.clientId) {
      const tariff = await prisma.singboxTariff.findUnique({ where: { id: row.singboxTariffId }, select: { name: true } });
      await notifySingboxSlotsCreated(row.clientId, activation.slotIds, tariff?.name ?? undefined).catch(() => {});
    }
  } else {
    activation = await activateTariffByPaymentId(paymentId);
  }
  await prisma.$transaction(async (tx) => {
    const row = await tx.payment.findUnique({
      where: { id: paymentId },
      select: { metadata: true },
    });
    const meta = parseMeta(row?.metadata ?? null);
    const next: Meta = { ...meta };
    delete next.plategaActivationInProgressAt;
    if (activation.ok) {
      next.plategaActivationAppliedAt = new Date().toISOString();
      next.plategaActivationLastError = null;
    } else {
      next.plategaActivationLastError = activation.error;
    }
    await tx.payment.update({
      where: { id: paymentId },
      data: { metadata: JSON.stringify(next) },
    });
  });

  if (activation.ok) {
    console.log("[Platega Webhook] Tariff activated", { paymentId });
    return { applied: true, ok: true };
  }
  console.error("[Platega Webhook] Tariff activation failed", { paymentId, error: activation.error });
  return { applied: true, ok: false, error: activation.error ?? "unknown activation error" };
}

/**
 * Verify HMAC-SHA256 signature in `X-Signature` header against raw body.
 * Используется опционально, если в админке задан platega_webhook_secret.
 */
function verifyPlategaHmacSignature(
  rawBody: Buffer,
  headerSig: string | undefined,
  secret: string,
): { ok: boolean; reason?: string } {
  if (!headerSig || typeof headerSig !== "string" || !headerSig.trim()) {
    return { ok: false, reason: "missing_x_signature" };
  }

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const received = headerSig.trim().replace(/^sha256=/i, "").toLowerCase();
  const expectedLower = expected.toLowerCase();

  let aBuf: Buffer;
  let bBuf: Buffer;
  try {
    aBuf = Buffer.from(expectedLower, "hex");
    bBuf = Buffer.from(received, "hex");
  } catch {
    return { ok: false, reason: "invalid_hex" };
  }

  if (aBuf.length !== bBuf.length) return { ok: false, reason: "length_mismatch" };
  if (!timingSafeEqual(aBuf, bBuf)) return { ok: false, reason: "signature_mismatch" };
  return { ok: true };
}

const PLATEGA_API_SUCCESS_STATUSES = new Set([
  "CONFIRMED", "PAID", "SUCCESS", "SUCCEEDED", "COMPLETED", "SUCCESSFUL", "APPROVED",
]);

/**
 * Double-check через Platega API: проверяем что транзакция действительно в успешном
 * статусе. Атакер не может подделать ответ от Platega API (запрос идёт от нашего сервера
 * к app.platega.io с нашими credentials), поэтому даже без подписи webhook'а forge
 * невозможен.
 *
 * Возвращает:
 *   - { trusted: true, status } если API подтверждает success
 *   - { trusted: false, reason } если API вернул другой статус (или мы не смогли его дёрнуть)
 *   - { trusted: "unverified" } если plategaMerchantId/plategaSecret не настроены — нечего и проверять
 */
async function verifyViaPlategaApi(payment: PaymentRow, webhookTxId: string | null): Promise<
  | { trusted: true; status: string }
  | { trusted: false; reason: string }
  | { trusted: "unverified"; reason: string }
> {
  const config = await getSystemConfig();
  const merchantId = (config as { plategaMerchantId?: string | null }).plategaMerchantId?.trim();
  const secret = (config as { plategaSecret?: string | null }).plategaSecret?.trim();
  // Webhook должен ссылаться на транзакцию, выданную Platega при создании этого платежа.
  const idCheck = checkPlategaWebhookTxId(payment, webhookTxId);
  if (!idCheck.ok) return { trusted: false, reason: idCheck.reason };
  if (!merchantId || !secret) {
    return { trusted: "unverified", reason: "platega api credentials not configured" };
  }
  const transactionId = plategaTxIdToVerify(payment, webhookTxId);
  if (!transactionId) {
    return { trusted: false, reason: "no transactionId in webhook body" };
  }

  const result = await getPlategaTransactionStatus({ merchantId, secret }, transactionId);
  if ("error" in result) {
    return { trusted: false, reason: `platega api error: ${result.error}` };
  }
  const upperStatus = result.status.toUpperCase();
  if (!PLATEGA_API_SUCCESS_STATUSES.has(upperStatus)) {
    return { trusted: false, reason: `platega api returned status=${result.status}` };
  }
  // Успешная транзакция должна принадлежать именно этому платежу (id/payload/сумма/валюта).
  const binding = checkPlategaBinding(payment, webhookTxId, result);
  if (!binding.ok) return { trusted: false, reason: binding.reason };
  return { trusted: true, status: upperStatus };
}

/**
 * Атомарно переводит платёж в PAID по подтверждённому CONFIRMED:
 *   PENDING → PAID (как раньше) или FAILED → PAID, если FAILED поставил CANCELED-webhook
 *   этой же транзакции (#198). Условный updateMany (статус + provider, для FAILED ещё и
 *   точное совпадение metadata с маркером) гарантирует один переход при дублях/гонках.
 */
async function claimPlategaPaid(
  db: Prisma.TransactionClient,
  paymentId: string,
  transactionId: string | null,
  api: PlategaApiCheck,
  paidData: { status: "PAID"; paidAt: Date; externalId: string | null },
): Promise<{ changed: boolean; decision: PlategaConfirmedDecision }> {
  let decision: PlategaConfirmedDecision = { kind: "not_recoverable", reason: "payment_missing" };
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await db.payment.findUnique({ where: { id: paymentId }, select: { status: true, metadata: true } });
    if (!row) return { changed: false, decision: { kind: "not_recoverable", reason: "payment_missing" } };
    decision = decidePlategaConfirmed(row, transactionId, api, new Date().toISOString());
    if (decision.kind === "from_pending") {
      const upd = await db.payment.updateMany({
        where: { id: paymentId, provider: "platega", status: "PENDING" },
        data: paidData,
      });
      if (upd.count > 0) return { changed: true, decision };
      continue; // статус сменился параллельно — перечитываем
    }
    if (decision.kind === "recover_failed") {
      const upd = await db.payment.updateMany({
        where: { id: paymentId, provider: "platega", status: "FAILED", metadata: row.metadata },
        data: { ...paidData, metadata: decision.nextMetadata },
      });
      if (upd.count > 0) return { changed: true, decision };
      continue;
    }
    return { changed: false, decision };
  }
  return { changed: false, decision: { kind: "not_recoverable", reason: "concurrent_update" } };
}

// Используется ниже. Объявлено здесь чтобы видеть типы выше.
void isPlategaConfigured;

plategaWebhooksRouter.post("/platega", async (req, res) => {
  // 1. Получаем raw body (нужен для HMAC если он задан) и парсим JSON.
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === "string" ? req.body : "");

  // 0. Сохраняем webhook в inbox для аудита/replay. ID нужен чтобы потом markOutcome().
  const captured = await recordWebhook("platega", req, rawBody);
  const ack = (status: number, outcome: Parameters<typeof markOutcome>[2], errorMessage?: string, paymentId?: string | null) => {
    void markOutcome(captured, status, outcome, { errorMessage, paymentId });
  };

  // 2. Опциональная HMAC проверка — если в админке задан platega_webhook_secret.
  //    Большинство пользователей оставляют это поле пустым (Platega не требует HMAC),
  //    тогда мы пропускаем эту проверку и опираемся на API double-check ниже.
  const config = await getSystemConfig();
  const hmacSecret = (config as { plategaWebhookSecret?: string | null }).plategaWebhookSecret?.trim();
  if (hmacSecret) {
    const headerSig = (req.headers["x-signature"] ?? req.headers["X-Signature"]) as string | undefined;
    const sigCheck = verifyPlategaHmacSignature(rawBody, headerSig, hmacSecret);
    if (!sigCheck.ok) {
      console.warn(`[Platega Webhook] HMAC signature failed: ${sigCheck.reason}`);
      ack(401, "rejected_signature", `HMAC: ${sigCheck.reason}`);
      return res.status(401).json({ message: "Invalid signature" });
    }
  }

  // 3. Парсим JSON из raw body.
  let parsedBody: Record<string, unknown> | null = null;
  if (rawBody.length > 0) {
    try {
      parsedBody = JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>;
    } catch (e) {
      console.warn("[Platega Webhook] Invalid JSON body", e);
      ack(400, "rejected_payload", "Invalid JSON");
      return res.status(400).json({ message: "Invalid JSON" });
    }
  }

  // Возвращаем 200, чтобы провайдер не спамил ретраями при наших внутренних ошибках.
  try {
    const data = parsedBody;
    if (!data || Object.keys(data).length === 0) {
      console.warn("[Platega Webhook] Empty body");
      ack(200, "rejected_payload", "Empty body");
      return res.status(200).json({ received: true });
    }

    const txObj = (data.transaction && typeof data.transaction === "object")
      ? (data.transaction as Record<string, unknown>)
      : {};
    const idObj = (data.data && typeof data.data === "object")
      ? (data.data as Record<string, unknown>)
      : {};

    const statusRaw = pickFirstString(
      data.status,
      txObj.status,
      data.state,
      data.paymentStatus,
      data.payment_status,
      idObj.status,
      idObj.state
    );
    const status = (statusRaw ?? "").toUpperCase();

    const transactionId = pickFirstString(
      data.id,
      txObj.id,
      data.transactionId,
      data.transaction_id,
      idObj.id,
      idObj.transactionId,
      idObj.transaction_id
    );
    const externalId = pickFirstString(data.externalId, txObj.externalId, idObj.externalId, data.invoiceId, txObj.invoiceId, idObj.invoiceId);
    const orderId = pickFirstString(data.orderId, data.order_id, data.order, data.merchant_order_id, idObj.orderId, idObj.order_id, idObj.order);
    const payloadId = pickFirstString(data.payload, txObj.payload, idObj.payload);

    const candidateIds = [...new Set([payloadId, transactionId, externalId, orderId].filter(Boolean) as string[])];
    if (candidateIds.length === 0) {
      console.warn("[Platega Webhook] No identifiers", { keys: Object.keys(data) });
      ack(200, "rejected_payload", "no identifiers in payload");
      return res.status(200).json({ received: true });
    }

    const payment = await findPlategaPaymentByAnyId(candidateIds);
    if (!payment) {
      console.warn("[Platega Webhook] Payment not found", { candidateIds, status });
      ack(200, "payment_not_found", `tried: ${candidateIds.join(",")}`);
      return res.status(200).json({ received: true });
    }

    await auditPaymentClientBotAlignment(payment);

    // Не даём чужому CANCELED пометить платёж и заблокировать его настоящее подтверждение.
    const webhookBinding = checkPlategaWebhookTxId(payment, transactionId);
    if (!webhookBinding.ok) {
      ack(401, "rejected_signature", webhookBinding.reason, payment.id);
      return res.status(401).json({ message: "Platega transaction does not match payment" });
    }

    if (FAILED_STATUSES.has(status)) {
      const failed = await prisma.payment.updateMany({
        where: { id: payment.id, status: "PENDING" },
        data: {
          status: "FAILED",
          externalId: plategaTxIdToVerify(payment, transactionId),
          // маркер: FAILED выставлен webhook'ом Platega — CONFIRMED этой же транзакции сможет его отменить (#198)
          metadata: withPlategaCancelMarker(payment.metadata, status, transactionId ?? payment.externalId, new Date().toISOString()),
        },
      });
      if (failed.count > 0) {
        console.log("[Platega Webhook] Payment marked FAILED", { paymentId: payment.id, status, transactionId, orderId: payment.orderId });
      }
      ack(200, "payment_failed", `provider status=${status}`, payment.id);
      return res.status(200).json({ received: true });
    }

    if (!SUCCESS_STATUSES.has(status)) {
      console.log("[Platega Webhook] Ignored status", { status, paymentId: payment.id, candidateIds });
      ack(200, "ignored_event", `status=${status}`, payment.id);
      return res.status(200).json({ received: true });
    }

    // SECURITY: double-check через Platega API. Атакер может подделать webhook
    // (URL публичный, подписи у Platega нет в кабинете), но не может подделать
    // ответ от app.platega.io. Запрашиваем у API реальный статус — если не PAID,
    // отвергаем как поддельный webhook.
    const apiVerify = await verifyViaPlategaApi(payment, transactionId);
    if (apiVerify.trusted === false) {
      console.warn("[Platega Webhook] API double-check FAILED", {
        paymentId: payment.id,
        candidateIds,
        webhookStatus: status,
        reason: apiVerify.reason,
      });
      ack(401, "rejected_signature", `API double-check: ${apiVerify.reason}`, payment.id);
      return res.status(401).json({ message: "Platega API does not confirm this transaction" });
    }
    if (apiVerify.trusted === "unverified") {
      // Креды не настроены — falling back to webhook trust. Громко предупреждаем.
      console.warn("[Platega Webhook] SECURITY: API double-check skipped (plategaMerchantId/plategaSecret not configured) — accepting webhook UNVERIFIED: status, transaction ownership and amount are NOT confirmed. Configure Platega API credentials (and/or plategaWebhookSecret) in admin.", { paymentId: payment.id, transactionId });
    }
    const boundTxId = plategaTxIdToVerify(payment, transactionId);


    const apiCheck: PlategaApiCheck = apiVerify.trusted === true ? "confirmed" : "unverified";
    const paidData = { status: "PAID" as const, paidAt: new Date(), externalId: boundTxId ?? payment.externalId };
    const isExtraOption = hasExtraOptionInMetadata(payment.metadata);
    const isTopUp = !payment.tariffId && !payment.proxyTariffId && !payment.singboxTariffId && !isExtraOption;
    // В claimPlategaPaid идёт только id из тела webhook'а: externalId CANCELED уже записал
    // сам, поэтому fallback на него не доказывает, что это та же транзакция (FAILED → PAID).
    let claim: { changed: boolean; decision: PlategaConfirmedDecision };
    if (isTopUp) {
      claim = await prisma.$transaction(async (tx) => {
        const res = await claimPlategaPaid(tx, payment.id, transactionId, apiCheck, paidData);
        if (res.changed) {
          await tx.client.update({
            where: { id: payment.clientId },
            data: { balance: { increment: payment.amount } },
          });
        }
        return res;
      });
    } else {
      claim = await claimPlategaPaid(prisma, payment.id, transactionId, apiCheck, paidData);
    }
    const recovered = claim.decision.kind === "recover_failed";

    if (claim.decision.kind === "not_recoverable") {
      // CONFIRMED (подтверждённый или unverified) пришёл, но платёж не PAID и вернуть его
      // нельзя — деньги могли списаться без выдачи. Не молчим: warning, outcome=error, алерт админам.
      const reason = claim.decision.reason;
      console.warn("[Platega Webhook] CONFIRMED could not be applied", { paymentId: payment.id, transactionId, reason, apiCheck });
      await notifyTariffActivationFailed(
        payment.clientId,
        payment.id,
        `Platega прислал ${status}, но платёж не зачислен (${reason}). Проверьте транзакцию ${transactionId ?? payment.externalId ?? "?"} вручную.`,
      ).catch(() => {});
      ack(200, "error", `CONFIRMED not applied: ${reason}`, payment.id);
      return res.status(200).json({ received: true });
    }

    if (isTopUp) {
      if (claim.changed) {
        console.log("[Platega Webhook] Payment PAID, balance credited (top-up)", {
          paymentId: payment.id,
          amount: payment.amount,
          currency: payment.currency,
          transactionId,
          orderId: payment.orderId,
          recoveredAfterCancel: recovered,
        });
        await notifyBalanceToppedUp(payment.clientId, payment.amount, payment.currency || "RUB", "Platega").catch(() => {});
      } else {
        console.log("[Platega Webhook] Payment already finalized", { paymentId: payment.id, status: payment.status });
      }
    } else if (claim.changed) {
      console.log("[Platega Webhook] Payment PAID (tariff)", {
        paymentId: payment.id,
        transactionId,
        orderId: payment.orderId,
        recoveredAfterCancel: recovered,
      });
    }

    // Надёжная пост-обработка: даже если платеж уже PAID, повторный webhook
    // догонит активацию тарифа/рефералку.
    await recordPromoCodeUsageFromPayment(payment.id);
    // «оплачен и активирован» клиенту и «📦 Оплата тарифа» админам
    // уходили независимо от результата активации — при упавшей активации все
    // получали «успех», а реальная ошибка тихо лежала в metadata. Теперь уведомляем
    // только когда активация реально применена, а при фейле шлём админам алерт.
    const activationOutcome = await ensureTariffActivation(payment.id);
    if (payment.tariffId) {
      if (activationOutcome.applied && activationOutcome.ok) {
        await notifyTariffActivated(payment.clientId, payment.id).catch(() => {});
      } else if (!activationOutcome.ok) {
        await notifyTariffActivationFailed(payment.clientId, payment.id, activationOutcome.error).catch(() => {});
      }
      // applied=false (already_applied / in_progress) — уведомление уже уходило при
      // первичной активации; повторный webhook больше не дублирует его.
    }
    // proxyTariffId: notifyProxySlotsCreated вызывается из ensureTariffActivation

    // сжигаем одноразовую персональную скидку после продуктовой покупки.
    if (!isTopUp) {
      const { extinguishOneTimeDiscount } = await import("../client/personal-discount.js");
      await extinguishOneTimeDiscount(payment.clientId).catch(() => {});
    }

    await distributeReferralRewards(payment.id).catch((e) => {
      console.error("[Platega Webhook] Referral distribution error", { paymentId: payment.id, error: e });
    });

    ack(200, "accepted", undefined, payment.id);
    return res.status(200).json({ received: true });
  } catch (e) {
    console.error("[Platega Webhook] Error:", e);
    ack(200, "error", String(e));
    return res.status(200).json({ received: true });
  }
});
