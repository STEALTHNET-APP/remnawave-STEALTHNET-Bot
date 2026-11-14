import { prisma } from "../../db.js";

export async function cloudTrialUsed(clientId: string, db: Pick<typeof prisma, "payment"> = prisma): Promise<boolean> {
  const payments = await db.payment.findMany({ where: { clientId, provider: "cloudpayments", status: { in: ["PAID", "REFUNDED"] }, metadata: { contains: '"cloudTrialDays"' } }, select: { metadata: true } });
  return payments.some(p => { try { return Number(JSON.parse(p.metadata || "{}").cloudTrialDays) > 0; } catch { return false; } });
}
