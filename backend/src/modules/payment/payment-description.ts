import { prisma } from "../../db.js";

export async function paymentDescription(fallback: string): Promise<string> {
  const setting = await prisma.systemSetting.findUnique({ where: { key: "payment_description" } });
  return setting?.value.trim() || fallback;
}
