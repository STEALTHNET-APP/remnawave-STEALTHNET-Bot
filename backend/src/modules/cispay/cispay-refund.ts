import { prisma } from "../../db.js";
import { getSystemConfig } from "../client/client.service.js";
import { cispayMatchesPayment, getCispayStatus, refundCispayPayment } from "./cispay.service.js";

export async function requestCispayRefund(paymentId: string) {
  const cfg = await getSystemConfig();
  const config = { shopId: cfg.cispayShopId, apiKey: cfg.cispayApiKey };
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
  const meta = JSON.parse(payment.metadata || "{}");
  const remote = await getCispayStatus(config, payment.orderId);
  if (meta.cispayShopId !== config.shopId || !cispayMatchesPayment(remote, payment, meta.cispaySandbox === true) || remote.status !== "PAID" || remote.payment_method === "CRYPTO" || remote.charged_amount <= 0) throw Error("Возврат недоступен: проверьте операцию в CisPay. Криптовалютные платежи не возвращаются через API.");
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM payments WHERE id = ${paymentId} FOR UPDATE`;
    const current = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    const currentMeta = JSON.parse(current.metadata || "{}");
    const delivery = await tx.paymentDelivery.findUnique({ where: { paymentId } });
    if (current.provider !== "cispay" || current.status !== "PAID" || currentMeta.cispayRefundRequestedAt || ["PENDING", "PROCESSING"].includes(delivery?.state ?? "")) throw Error("Возврат уже запрошен или покупка ещё выдаётся. Сверьте статус CisPay перед повторной операцией.");
    await tx.payment.update({ where: { id: paymentId }, data: { metadata: JSON.stringify({ ...currentMeta, cispayRefundRequestedAt: new Date().toISOString(), cispayRefundAmount: remote.charged_amount }) } });
  });
  try { await refundCispayPayment(config, remote.id, remote.charged_amount); }
  catch { throw Error("Результат возврата не подтверждён. Запрос сохранён; проверьте его в CisPay. Повторный запрос заблокирован."); }
  return { ok: true, payment: await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } }), summary: { creditedToBalance: 0, reversedReferralAmount: 0, reversedReferralCount: 0 }, message: "Возврат запрошен в CisPay. Статус обновится после подтверждения платёжной системы." };
}
