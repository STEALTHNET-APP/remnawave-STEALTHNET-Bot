import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { getSystemConfig } from "./client.service.js";

export const clientReferralsRouter = Router();

clientReferralsRouter.get("/referral-stats", async (req, res) => {
  const client = (req as unknown as { client: { id: string } }).client;
  const c = await prisma.client.findUnique({
    where: { id: client.id },
    select: {
      referralCode: true,
      referralPercent: true,
      balance: true,
      _count: { select: { referrals: true } },
    },
  });
  if (!c) return res.status(404).json({ message: "Не найдено" });
  const config = await getSystemConfig();
  const referralPercent: number = c.referralPercent ?? (config.defaultReferralPercent ?? 0);

  // расширенная статистика по эталону клиента.
  // - Доход L1 / L2 — отдельно по уровню (ReferralCredit.level)
  // - Купили = кол-во рефералов с хотя бы одной PAID-оплатой
  // - L2 invites = кол-во рефералов чьи рефералы → нам в L2
  // - Spent = SUM(Payment.amount) где clientId=me AND status=PAID AND provider=balance (потрачено с баланса)
  // - Withdrawn = SUM(WithdrawalRequest.amount) где APPROVED (если есть таблица; иначе 0)
  const [l1Sum, l2Sum, paidReferrals, l1Refs, totalSpent] = await Promise.all([
    prisma.referralCredit.aggregate({ where: { referrerId: client.id, level: 1 }, _sum: { amount: true } }),
    prisma.referralCredit.aggregate({ where: { referrerId: client.id, level: 2 }, _sum: { amount: true } }),
    prisma.client.count({
      where: { referrerId: client.id, payments: { some: { status: "PAID" } } },
    }),
    prisma.client.findMany({
      where: { referrerId: client.id },
      select: { id: true },
    }),
    prisma.payment.aggregate({
      where: { clientId: client.id, status: "PAID", provider: "balance" },
      _sum: { amount: true },
    }),
  ]);
  const l1Ids = l1Refs.map((r) => r.id);
  const l2InvitesCount = l1Ids.length > 0
    ? await prisma.client.count({ where: { referrerId: { in: l1Ids } } })
    : 0;

  // Withdrawal — если таблица существует. Безопасно через try/catch (миграция может ещё не накатиться).
  let totalWithdrawn = 0;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = await (prisma as any).withdrawalRequest?.aggregate?.({
      where: { clientId: client.id, status: "APPROVED" },
      _sum: { amount: true },
    });
    totalWithdrawn = w?._sum?.amount ?? 0;
  } catch {
    totalWithdrawn = 0;
  }

  const dayRewards = await prisma.referralReward.groupBy({ by: ["appliedAt"], where: { referrerId: client.id, kind: "days" }, _sum: { days: true } });
  const referralDaysEarned = dayRewards.reduce((sum, row) => sum + (row._sum.days ?? 0), 0);
  const referralDaysPending = dayRewards.filter(row => !row.appliedAt).reduce((sum, row) => sum + (row._sum.days ?? 0), 0);
  const l1Earned = l1Sum._sum.amount ?? 0;
  const l2Earned = l2Sum._sum.amount ?? 0;
  const totalEarned = l1Earned + l2Earned;

  return res.json({
    referralCode: c.referralCode,
    referralRewardMode: config.referralRewardMode,
    referralRewardAmount: config.referralRewardAmount,
    referralRewardDays: config.referralRewardDays,
    referralRewardCurrency: config.defaultCurrency,
    referralDaysEarned,
    referralDaysPending,
    referralPercent: config.referralRewardMode === "percent" ? referralPercent : 0,
    referralPercentLevel2: config.referralRewardMode === "percent" ? config.referralPercentLevel2 ?? 0 : 0,
    referralPercentLevel3: config.referralRewardMode === "percent" ? config.referralPercentLevel3 ?? 0 : 0,
    referralCount: c._count.referrals,
    // T-fix (11.05.2026): расширенная статистика
    l1Clicks: c._count.referrals, // переходов = кол-во зарегистрированных по ссылке
    l1Purchased: paidReferrals,
    l1Earned,
    l2InvitesCount,
    l2Earned,
    totalEarned,
    totalWithdrawn,
    totalSpent: totalSpent._sum.amount ?? 0,
    availableBalance: c.balance,
    // Back-compat:
    totalEarnings: totalEarned,
  });
});

// создание заявки на вывод реф. баланса (СБП, банковская карта или USDT TRC20).
// настройки в админке: withdrawals_enabled (вкл/выкл фичи целиком),
// withdrawal_min_amount (мин. сумма) и withdrawal_methods_* (доступные способы).
// При создании баланс замораживается (decrement) — при reject админом средства
// возвращаются. При approve — клиенту приходит уведомление.
type WithdrawalMethod = "sbp" | "card" | "usdt";

function luhnValid(cardNumber: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = cardNumber.length - 1; i >= 0; i -= 1) {
    let digit = Number(cardNumber[i]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

function normalizeCardDetails(input: string): string | null {
  const digits = input.replace(/[\s-]/g, "");
  if (!/^\d{16,19}$/.test(digits) || !luhnValid(digits)) return null;
  return digits.replace(/(\d{4})(?=\d)/g, "$1 ");
}

function normalizeSbpDetails(input: string): string | null {
  const parts = input.split(/[,;]/).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const bank = parts.slice(1).join(", ");
  if (bank.length < 2) return null;
  const phoneDigits = parts[0]?.replace(/\D/g, "") ?? "";
  if (phoneDigits.length < 10 || phoneDigits.length > 15) return null;
  let phone: string;
  if (phoneDigits.length === 11 && (phoneDigits.startsWith("7") || phoneDigits.startsWith("8"))) {
    phone = `+7${phoneDigits.slice(1)}`;
  } else if (phoneDigits.length === 10) {
    phone = `+7${phoneDigits}`;
  } else {
    phone = parts[0]?.trim().startsWith("+") ? `+${phoneDigits}` : phoneDigits;
  }
  return `${phone}, ${bank}`.slice(0, 255);
}

const withdrawCreateSchema = z.object({
  amount: z.number().positive().max(1e7),
  method: z.enum(["sbp", "card", "usdt"]).default("usdt"),
  details: z.string().min(3).max(255).optional(),
  walletTrc20: z.string().optional(),
});
clientReferralsRouter.post("/withdrawals", async (req, res) => {
  const clientId = (req as unknown as { clientId: string }).clientId;
  const wdCfg = await getSystemConfig();
  if (wdCfg.withdrawalsEnabled === false) {
    return res.status(403).json({ message: "Заявки на вывод временно отключены" });
  }
  const parsed = withdrawCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Некорректные данные", errors: parsed.error.flatten() });
  }
  const { amount, method } = parsed.data;
  const minAmount = wdCfg.withdrawalMinAmount ?? 3000;
  if (amount < minAmount) {
    return res.status(400).json({ message: `Минимальная сумма вывода — ${minAmount}₽` });
  }
  if (!wdCfg.withdrawalMethods.includes(method)) {
    return res.status(400).json({ message: "Выбранный способ вывода недоступен" });
  }
  const rawDetails = (parsed.data.details ?? parsed.data.walletTrc20 ?? "").trim();
  if (!rawDetails) {
    return res.status(400).json({ message: "Укажите реквизиты для вывода" });
  }
  let formattedDetails: string | null;
  if (method === "usdt") {
    formattedDetails = /^T[A-Za-z0-9]{33}$/.test(rawDetails) ? rawDetails : null;
    if (!formattedDetails) {
      return res.status(400).json({ message: "Некорректный TRC20-адрес (должен начинаться с T, 34 символа)" });
    }
  } else if (method === "card") {
    formattedDetails = normalizeCardDetails(rawDetails);
    if (!formattedDetails) {
      return res.status(400).json({ message: "Некорректный номер карты" });
    }
  } else {
    formattedDetails = normalizeSbpDetails(rawDetails);
    if (!formattedDetails) {
      return res.status(400).json({ message: "Укажите номер телефона и банк получателя через запятую" });
    }
  }

  let wr: { id: string; status: string };
  try {
    wr = await prisma.$transaction(async (tx) => {
      const debit = await tx.client.updateMany({
        where: { id: clientId, balance: { gte: amount } },
        data: { balance: { decrement: amount } },
      });
      if (debit.count === 0) {
        throw Object.assign(new Error("INSUFFICIENT_FUNDS"), { code: "INSUFFICIENT_FUNDS" });
      }
      return tx.withdrawalRequest.create({
        data: {
          clientId,
          amount,
          method,
          details: formattedDetails,
          walletTrc20: method === "usdt" ? formattedDetails : null,
          status: "PENDING",
        },
      });
    });
  } catch (e) {
    if ((e as { code?: string }).code === "INSUFFICIENT_FUNDS") {
      const c = await prisma.client.findUnique({ where: { id: clientId }, select: { balance: true } });
      return res.status(400).json({ message: `Недостаточно средств. Доступно: ${(c?.balance ?? 0).toFixed(2)}₽` });
    }
    console.error("[withdrawals] create failed:", e);
    return res.status(500).json({ message: "Не удалось создать заявку на вывод" });
  }

  // Notify админам в Telegram.
  try {
    const { notifyAdminsAboutWithdrawal } = await import("../notification/telegram-notify.service.js");
    await notifyAdminsAboutWithdrawal(wr.id).catch(() => {});
  } catch {
    // Если notify-функции ещё нет — просто молча; админ увидит заявку в UI.
  }

  return res.json({
    message: "Заявка отправлена. Ожидайте подтверждения администратора.",
    id: wr.id,
    amount,
    method,
    details: formattedDetails,
    walletTrc20: method === "usdt" ? formattedDetails : null,
    status: wr.status,
  });
});

// История заявок клиента.
clientReferralsRouter.get("/withdrawals", async (req, res) => {
  const clientId = (req as unknown as { clientId: string }).clientId;
  const items = await prisma.withdrawalRequest.findMany({
    where: { clientId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return res.json({ items });
});
