import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";

const telegramIdSchema = z.string().trim().max(16).nullable().transform(value => value || null).refine(
  value => value === null || (/^[1-9]\d*$/.test(value) && Number(value) <= 4503599627370495),
  "Telegram ID должен быть положительным числовым ID пользователя, не @username",
);

export const updateClientSchema = z.object({
  email: z.string().email().nullable().optional(),
  telegramId: telegramIdSchema.optional(),
  expectedTelegramId: z.string().max(128).nullable().optional(),
  preferredLang: z.string().max(5).optional(),
  preferredCurrency: z.string().max(5).optional(),
  balance: z.number().optional(),
  isBlocked: z.boolean().optional(),
  blockReason: z.string().nullable().optional(),
  referralPercent: z.number().min(0).max(100).nullable().optional(),
  personalDiscountPercent: z.number().min(0).max(100).nullable().optional(),
  personalDiscountIsOneTime: z.boolean().optional(),
});

export class ClientProfileError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function updateAdminClientProfile(id: string, data: z.infer<typeof updateClientSchema>) {
  try {
    return await prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM clients WHERE id = ${id} FOR UPDATE`;
      if (!rows.length) throw new ClientProfileError(404, "Клиент не найден");
      const client = await tx.client.findUniqueOrThrow({ where: { id } });
      const updates: Prisma.ClientUncheckedUpdateInput = {};
      if (data.email !== undefined) updates.email = data.email;
      if (data.preferredLang !== undefined) updates.preferredLang = data.preferredLang;
      if (data.preferredCurrency !== undefined) updates.preferredCurrency = data.preferredCurrency;
      if (data.balance !== undefined) updates.balance = data.balance;
      if (data.isBlocked !== undefined) updates.isBlocked = data.isBlocked;
      if (data.blockReason !== undefined) updates.blockReason = data.blockReason;
      if (data.referralPercent !== undefined) updates.referralPercent = data.referralPercent;
      if (data.personalDiscountPercent !== undefined) updates.personalDiscountPercent = data.personalDiscountPercent;
      if (data.personalDiscountIsOneTime !== undefined) updates.personalDiscountIsOneTime = data.personalDiscountIsOneTime;

      if (data.telegramId !== undefined) {
        if (data.expectedTelegramId !== undefined && data.expectedTelegramId !== client.telegramId) {
          throw new ClientProfileError(409, "Привязка Telegram уже изменилась. Переоткройте карточку клиента.");
        }
        if (data.telegramId !== client.telegramId) {
          const email = data.email !== undefined ? data.email : client.email;
          if (data.telegramId === null && !((email && client.passwordHash) || client.googleId || client.appleId)) {
            throw new ClientProfileError(400, "Перед отвязкой Telegram задайте клиенту email и пароль или подключите другой способ входа.");
          }
          updates.telegramId = data.telegramId;
          updates.telegramUsername = null;
          updates.telegramUnreachable = false;
          await tx.pendingTelegramLink.deleteMany({ where: { clientId: id } });
        }
      }
      return tx.client.update({
        where: { id },
        data: updates,
        select: {
          id: true,
          email: true,
          telegramId: true,
          telegramUsername: true,
          preferredLang: true,
          preferredCurrency: true,
          balance: true,
          referralCode: true,
          remnawaveUuid: true,
          trialUsed: true,
          isBlocked: true,
          blockReason: true,
          referralPercent: true,
          personalDiscountPercent: true,
          personalDiscountIsOneTime: true,
          restrictedTariffIds: true,
          tariffRestrictionReason: true,
          createdAt: true,
          _count: { select: { referrals: true } },
        },
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const target = String(error.meta?.target ?? "");
      throw new ClientProfileError(409, target.toLowerCase().includes("telegram")
        ? "Этот Telegram ID уже привязан к другому клиенту."
        : "Этот email уже используется другим клиентом.");
    }
    throw error;
  }
}
