import { prisma } from "../../db.js";

export async function handlePaymentActivationResult(params: {
  paymentId: string;
  clientId: string;
  amount: number;
  currency: string;
  provider: string;
  activation: { ok: boolean; error?: string; status?: number };
  tariffName?: string | null;
}): Promise<void> {
  const { paymentId, clientId, amount, currency, provider, activation } = params;
  if (activation.ok) {
    const { notifyTariffActivated } = await import("../notification/telegram-notify.service.js");
    await notifyTariffActivated(clientId, paymentId).catch(() => {});
    return;
  }

  const errMessage = activation.error || "Неизвестная ошибка активации";
  let tariffName = params.tariffName;
  try {
    const p = await prisma.payment.findUnique({
      where: { id: paymentId },
      select: { metadata: true, tariff: { select: { name: true } } },
    });
    let meta: Record<string, unknown> = {};
    try {
      meta = (p?.metadata ? JSON.parse(p.metadata) : {}) as Record<string, unknown>;
    } catch {
      meta = {};
    }
    meta.activationError = errMessage;
    meta.activationFailedAt = new Date().toISOString();
    await prisma.payment.update({
      where: { id: paymentId },
      data: { metadata: JSON.stringify(meta) },
    });
    if (tariffName === undefined) tariffName = p?.tariff?.name ?? null;
  } catch (e) {
    console.error("[handlePaymentActivationResult] Failed to save activationError in metadata:", e);
  }

  console.error(`[Payment Fulfillment Failed] payment=${paymentId} client=${clientId} error=${errMessage}`);

  const { notifyAdminsAboutActivationFailed, notifyClientAboutActivationDelayed } = await import(
    "../notification/telegram-notify.service.js"
  );
  await notifyAdminsAboutActivationFailed({
    clientId,
    paymentId,
    amount,
    currency,
    provider,
    error: errMessage,
    tariffName,
  }).catch(() => {});
  await notifyClientAboutActivationDelayed(clientId, errMessage).catch(() => {});
}
