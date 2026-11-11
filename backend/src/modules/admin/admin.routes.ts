import { cancelCloudAgreement } from "../cloudpayments/cloudpayments.service.js";
import { receiptSettingsSchema } from "../cloudpayments/cloudpayments-receipt.js";
import { botCommandsSchema } from "../bot/bot-commands.js";
import { botButtonsJsonSchema } from "../bot/menu-buttons.js";
import { mailTestRouter } from "../mail/mail-test.routes.js";
import { updateRouter } from "../update/update.routes.js";
/**
 * Админские эндпоинты — прокси к Remna API + клиенты панели + настройки
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { Router } from "express";
import { APP_BUILD } from "../../config/app-version.js";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireAuth, requireAdminSection, requireAction } from "../auth/middleware.js";
import { getSystemConfig, invalidateSystemConfigCache } from "../client/client.service.js";
import { getServerStats, getSshConfig, updateSshConfig } from "../server/server.service.js";
import { syncFromRemna, syncToRemna, syncSubscriptionsMirror, createRemnaUsersForClientsWithoutUuid } from "../sync/sync.service.js";
import { markPaymentPaid } from "../payment/mark-paid.service.js";
import { registerBackupRoutes } from "../backup/backup.routes.js";
import { invalidateBrandCache } from "../branding/spa-html.js";
import { adminCreateGiftCode } from "../gift/gift.service.js";
import { languageRouter } from "./language.routes.js";
import { adminGramadsRouter } from "./gramads.routes.js";
import { adminRemnaRouter } from "./remna.routes.js";
import { adminTariffsRouter } from "./tariffs.routes.js";
import { adminAnalyticsRouter } from "./analytics.routes.js";
import { adminClientsRouter } from "./clients.routes.js";
import { adminSubscriptionsRouter } from "./subscriptions.routes.js";
import { adminTicketsRouter } from "./tickets.routes.js";
import { adminPromoGroupsRouter, adminPromoCodesRouter } from "./promo.routes.js";
import { adminTrialsRouter } from "./trials.routes.js";
import { adminTariffCategoriesRouter } from "./tariff-categories.routes.js";
import { adminBroadcastRouter, adminAutoBroadcastRouter } from "./broadcast.routes.js";
import { adminSecondarySubscriptionsRouter } from "./secondary-subscriptions.routes.js";
import { adminTourStepsRouter, adminTourMascotsRouter } from "./tour.routes.js";
import { adminAdminsRouter } from "./admins.routes.js";

export { ADMIN_ALLOWED_SECTIONS } from "./admins.routes.js";

export const adminRouter = Router();
adminRouter.use(requireAuth);
// 🔒 SECURITY: секционный RBAC ДОЛЖЕН стоять ДО регистрации под-роутеров — иначе backup
// (pg_dump/restore БД) и /languages обходят requireAdminSection (менеджер дампит/перезаписывает БД).
adminRouter.use(requireAdminSection);
adminRouter.post("/settings/cloudpayments-subscriptions/:id/cancel", asyncRoute(async (req, res) => {
  await cancelCloudAgreement(req.params.id);
  return res.json({ ok: true });
}));
adminRouter.get("/settings/cloudpayments-status", asyncRoute(async (req, res) => {
  const clientId = typeof req.query.clientId === "string" ? req.query.clientId.trim().slice(0, 128) : "";
  const [agreements, jobs, events, eventErrors] = await Promise.all([
    prisma.cloudPaymentAgreement.findMany({ where: clientId ? { clientId } : {}, orderBy: { updatedAt: "desc" }, take: 50, select: { id: true, clientId: true, state: true, amount: true, nextChargeAt: true, lastError: true } }),
    prisma.cloudPaymentJob.findMany({ where: { state: { not: "DONE" } }, orderBy: { createdAt: "asc" }, take: 50, select: { paymentId: true, state: true, error: true } }),
    prisma.cloudPaymentEvent.count({ where: { processedAt: null } }),
    prisma.cloudPaymentEvent.findMany({ where: { processedAt: null, error: { not: null } }, orderBy: { receivedAt: "asc" }, take: 50, select: { id: true, kind: true, error: true } }),
  ]);
  res.json({ agreements, jobs, pendingEvents: events, eventErrors });
}));
adminRouter.use("/updates", updateRouter);
adminRouter.use("/settings/mail-test", mailTestRouter);

/** Обёртка для async-роутов: ошибки передаются в next() и возвращают 500. */
function asyncRoute(
  fn: (req: express.Request, res: express.Response) => Promise<void | express.Response>
) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

registerBackupRoutes(adminRouter, asyncRoute);

adminRouter.use("/languages", languageRouter);

adminRouter.use("/gramads", adminGramadsRouter);

adminRouter.get("/me", asyncRoute(async (req, res) => {
  const adminId = (req as unknown as { adminId: string }).adminId;
  const admin = await prisma.admin.findUnique({
    where: { id: adminId },
    select: { id: true, email: true, mustChangePassword: true, role: true, allowedSections: true, totpEnabled: true },
  });
  if (!admin) return res.status(401).json({ message: "Not found" });
  const allowedSections = admin.allowedSections
    ? (() => {
        try {
          const p = JSON.parse(admin.allowedSections!) as unknown;
          return Array.isArray(p) ? p.filter((s): s is string => typeof s === "string") : [];
        } catch {
          return [];
        }
      })()
    : [];
  return res.json({ ...admin, allowedSections });
}));

adminRouter.use("/remna", adminRemnaRouter);

/**
 * POST /api/admin/bot/test-token
 * Проверка токена Telegram бота через getMe
 */
adminRouter.post("/bot/test-token", asyncRoute(async (req, res) => {
  let token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  if (!token) {
    const config = await getSystemConfig();
    token = (config.telegramBotToken || process.env.BOT_TOKEN || "").trim();
  }
  if (!token) {
    return res.status(400).json({ ok: false, error: "Токен бота не указан и отсутствует в .env" });
  }

  const start = Date.now();
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: AbortSignal.timeout(7_000),
    });
    const latencyMs = Date.now() - start;
    const data = await r.json().catch(() => ({})) as { ok: boolean; description?: string; result?: { id: number; is_bot: boolean; first_name: string; username?: string } };
    if (!r.ok || !data.ok) {
      return res.status(400).json({
        ok: false,
        latencyMs,
        error: data.description || `Telegram API вернул HTTP ${r.status}`,
      });
    }
    return res.json({
      ok: true,
      latencyMs,
      bot: {
        id: data.result?.id,
        firstName: data.result?.first_name,
        username: data.result?.username,
      },
      message: `Бот @${data.result?.username ?? "bot"} (${data.result?.first_name}) доступен (${latencyMs} мс)`,
    });
  } catch (e) {
    const latencyMs = Date.now() - start;
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(500).json({ ok: false, latencyMs, error: `Ошибка запроса к Telegram: ${msg}` });
  }
}));

/**
 * POST /api/admin/bot/reset-token
 * Сброс токена Telegram бота к значению из .env (BOT_TOKEN)
 */
adminRouter.post("/bot/reset-token", asyncRoute(async (_req, res) => {
  await prisma.systemSetting.deleteMany({
    where: { key: "telegram_bot_token" },
  });
  invalidateSystemConfigCache();
  await getSystemConfig();
  return res.json({ ok: true });
}));

/** Условие: только реальные поступления (исключаем оплату с баланса, чтобы не дублировать учёт). */
const PAID_EXTERNAL_WHERE = { status: "PAID" as const, provider: { not: "balance" } };

/** Статистика дашборда: пользователи (локальная БД), продажи (Payment PAID — только внешние поступления). */
adminRouter.get("/dashboard/stats", async (_req, res) => {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [clientsTotal, clientsWithRemna, paidAgg, paidToday, paidLast7, paidLast30, newClientsToday, newClientsLast7, newClientsLast30] =
    await Promise.all([
      prisma.client.count(),
      prisma.client.count({ where: { remnawaveUuid: { not: null } } }),
      prisma.payment.aggregate({
        where: PAID_EXTERNAL_WHERE,
        _sum: { amount: true },
        _count: true,
      }),
      prisma.payment.aggregate({
        where: { ...PAID_EXTERNAL_WHERE, paidAt: { gte: todayStart } },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.payment.aggregate({
        where: { ...PAID_EXTERNAL_WHERE, paidAt: { gte: sevenDaysAgo } },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.payment.aggregate({
        where: { ...PAID_EXTERNAL_WHERE, paidAt: { gte: thirtyDaysAgo } },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.client.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.client.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
      prisma.client.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    ]);

  return res.json({
    users: {
      total: clientsTotal,
      withRemna: clientsWithRemna,
      newToday: newClientsToday,
      newLast7Days: newClientsLast7,
      newLast30Days: newClientsLast30,
    },
    sales: {
      totalAmount: paidAgg._sum.amount ?? 0,
      totalCount: paidAgg._count,
      todayAmount: paidToday._sum.amount ?? 0,
      todayCount: paidToday._count,
      last7DaysAmount: paidLast7._sum.amount ?? 0,
      last7DaysCount: paidLast7._count,
      last30DaysAmount: paidLast30._sum.amount ?? 0,
      last30DaysCount: paidLast30._count,
    },
  });
});

// ──── Мониторинг сервера ────

adminRouter.get("/server/stats", asyncRoute(async (_req, res) => {
  const stats = await getServerStats();
  return res.json(stats);
}));

adminRouter.get("/server/ssh", asyncRoute(async (_req, res) => {
  const config = await getSshConfig();
  if (!config) return res.status(404).json({ message: "sshd_config не найден (SSH не настроен или нет доступа)" });
  return res.json(config);
}));

adminRouter.patch("/server/ssh", asyncRoute(async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const updates: Record<string, unknown> = {};
  if (body.port != null) updates.port = Number(body.port);
  if (body.permitRootLogin != null) updates.permitRootLogin = String(body.permitRootLogin);
  if (body.passwordAuthentication != null) updates.passwordAuthentication = Boolean(body.passwordAuthentication);
  if (body.pubkeyAuthentication != null) updates.pubkeyAuthentication = Boolean(body.pubkeyAuthentication);
  const result = await updateSshConfig(updates as any);
  if (!result.ok) return res.status(500).json({ message: result.error });
  const config = await getSshConfig();
  return res.json(config);
}));

adminRouter.get("/auto-renew/stats", async (_req, res) => {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [
    totalAutoRenewEnabled,
    totalAutoRenewDisabled,
    retriesInProgress,
    renewalsLast30Days,
    renewalsLast7Days,
    renewalAmountLast30Days,
  ] = await Promise.all([
    // Clients with auto-renewal enabled
    prisma.client.count({ where: { autoRenewEnabled: true, autoRenewTariffId: { not: null } } }),
    // Clients who had it but now disabled
    prisma.client.count({ where: { autoRenewEnabled: false, autoRenewTariffId: { not: null } } }),
    // Clients currently in retry state
    prisma.client.count({ where: { autoRenewEnabled: true, autoRenewRetryCount: { gt: 0 } } }),
    // Successful auto-renewals (balance payments with tariff) in 30 days
    prisma.payment.count({
      where: {
        provider: "balance",
        status: "PAID",
        tariffId: { not: null },
        paidAt: { gte: thirtyDaysAgo },
      },
    }),
    // Successful auto-renewals in 7 days
    prisma.payment.count({
      where: {
        provider: "balance",
        status: "PAID",
        tariffId: { not: null },
        paidAt: { gte: sevenDaysAgo },
      },
    }),
    // Total amount of balance-tariff payments in 30 days
    prisma.payment.aggregate({
      where: {
        provider: "balance",
        status: "PAID",
        tariffId: { not: null },
        paidAt: { gte: thirtyDaysAgo },
      },
      _sum: { amount: true },
    }),
  ]);

  return res.json({
    enabled: totalAutoRenewEnabled,
    disabled: totalAutoRenewDisabled,
    retriesInProgress,
    renewalsLast7Days,
    renewalsLast30Days,
    amountLast30Days: renewalAmountLast30Days._sum.amount ?? 0,
  });
});

adminRouter.get("/notifications/counters", asyncRoute(async (_req, res) => {
  const [totalClients, totalTickets, totalTariffPayments, totalBalanceTopups] = await Promise.all([
    prisma.client.count(),
    prisma.ticket.count(),
    prisma.payment.count({
      where: {
        status: "PAID",
        OR: [
          { tariffId: { not: null } },
          { proxyTariffId: { not: null } },
          { singboxTariffId: { not: null } },
        ],
      },
    }),
    prisma.payment.count({
      where: {
        status: "PAID",
        tariffId: null,
        proxyTariffId: null,
        singboxTariffId: null,
      },
    }),
  ]);
  return res.json({ totalClients, totalTickets, totalTariffPayments, totalBalanceTopups });
}));

/** Отметить платёж как оплаченный и начислить реферальные бонусы (3 уровня) */
const paymentIdParamSchema = z.object({ id: z.string().min(1) });
const markPaymentPaidSchema = z.object({ status: z.literal("PAID") });
adminRouter.patch("/payments/:id", asyncRoute(async (req, res) => {
  const params = paymentIdParamSchema.safeParse(req.params);
  const body = markPaymentPaidSchema.safeParse(req.body);
  if (!params.success || !body.success) {
    const err = !params.success ? params.error.flatten() : body.error!.flatten();
    return res.status(400).json({ message: "Invalid input", errors: err });
  }
  const result = await markPaymentPaid(params.data.id);
  if (!result.ok) {
    return res.status(404).json({ message: result.error ?? "Payment not found" });
  }
  return res.json({
    payment: result.payment,
    referral: result.referral,
    activation: result.activation,
    proxySlots: result.proxySlots,
    balanceCredited: result.balanceCredited,
  });
}));

adminRouter.use("/tariff-categories", adminTariffCategoriesRouter);

adminRouter.use("/tariffs", adminTariffsRouter);

// админ-эндпоинты для withdrawal_requests (USDT TRC20).
// Approve → клиенту приходит уведомление в Telegram. Reject → возвращаем баланс.
adminRouter.get("/withdrawals", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status.toUpperCase() : null;
  const where = status && ["PENDING", "APPROVED", "REJECTED"].includes(status) ? { status } : {};
  const items = await prisma.withdrawalRequest.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { client: { select: { id: true, email: true, telegramId: true, telegramUsername: true } } },
  });
  return res.json({ items });
});

adminRouter.post("/withdrawals/:id/approve", async (req, res) => {
  const id = req.params.id;
  const comment = typeof req.body?.comment === "string" ? req.body.comment.slice(0, 500) : null;
  const updated = await prisma.withdrawalRequest.updateMany({
    where: { id, status: "PENDING" },
    data: { status: "APPROVED", processedAt: new Date(), adminComment: comment },
  });
  if (updated.count === 0) {
    return res.status(400).json({ message: "Заявка уже обработана" });
  }
  const { notifyClientAboutWithdrawalApproved } = await import("../notification/telegram-notify.service.js");
  await notifyClientAboutWithdrawalApproved(id).catch(() => {});
  return res.json({ message: "Заявка одобрена. Клиенту отправлено уведомление." });
});

adminRouter.post("/withdrawals/:id/reject", async (req, res) => {
  const id = req.params.id;
  const comment = typeof req.body?.comment === "string" ? req.body.comment.slice(0, 500) : null;
  const wr = await prisma.withdrawalRequest.findUnique({ where: { id } });
  if (!wr) return res.status(404).json({ message: "Заявка не найдена" });
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.withdrawalRequest.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "REJECTED", processedAt: new Date(), adminComment: comment },
    });
    if (updated.count === 0) return false;
    await tx.client.update({ where: { id: wr.clientId }, data: { balance: { increment: wr.amount } } });
    return true;
  });
  if (!result) {
    return res.status(400).json({ message: "Заявка уже обработана" });
  }
  return res.json({ message: "Заявка отклонена. Баланс возвращён клиенту." });
});

// CRUD для шаблонов уведомлений автосписания.
// Cron `auto-renew.cron.ts` использует эти шаблоны при отправке нотификаций клиенту.
const autoRenewNotifSchema = z.object({
  name: z.string().min(1).max(120),
  triggerType: z.enum(["UPCOMING", "SUCCESS", "FAILED", "RETRY", "EXPIRED"]),
  offsetMinutes: z.number().int().min(0).max(60 * 24 * 30), // до 30 дней
  messageText: z.string().min(1).max(4000),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

adminRouter.get("/auto-renew-notifications", async (_req, res) => {
  const list = await prisma.autoRenewNotification.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return res.json({
    items: list.map((n) => ({
      id: n.id,
      name: n.name,
      triggerType: n.triggerType,
      offsetMinutes: n.offsetMinutes,
      messageText: n.messageText,
      enabled: n.enabled,
      sortOrder: n.sortOrder,
      createdAt: n.createdAt.toISOString(),
      updatedAt: n.updatedAt.toISOString(),
    })),
  });
});

adminRouter.post("/auto-renew-notifications", async (req, res) => {
  const parsed = autoRenewNotifSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });
  const created = await prisma.autoRenewNotification.create({
    data: {
      name: parsed.data.name,
      triggerType: parsed.data.triggerType,
      offsetMinutes: parsed.data.offsetMinutes,
      messageText: parsed.data.messageText,
      enabled: parsed.data.enabled ?? true,
      sortOrder: parsed.data.sortOrder ?? 0,
    },
  });
  return res.status(201).json({ id: created.id });
});

adminRouter.patch("/auto-renew-notifications/:id", async (req, res) => {
  const parsed = autoRenewNotifSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });
  try {
    await prisma.autoRenewNotification.update({
      where: { id: req.params.id },
      data: parsed.data,
    });
    return res.json({ ok: true });
  } catch {
    return res.status(404).json({ message: "Шаблон не найден" });
  }
});

adminRouter.delete("/auto-renew-notifications/:id", async (req, res) => {
  try {
    await prisma.autoRenewNotification.delete({ where: { id: req.params.id } });
    return res.json({ ok: true });
  } catch {
    return res.status(404).json({ message: "Шаблон не найден" });
  }
});

adminRouter.use("/trials", adminTrialsRouter);

adminRouter.use("/clients", adminClientsRouter);
adminRouter.use("/subscriptions", adminSubscriptionsRouter);

// Настройки (языки, валюты, название сервиса) — для бота, mini app, сайта
adminRouter.get("/settings", asyncRoute(async (_req, res) => {
  const config = await getSystemConfig();
  return res.json({ ...config, cispayApiKey: config.cispayApiKey ? "********" : "", botWebhookSecret: config.botWebhookSecret ? "********" : "", cloudpaymentsApiSecret: config.cloudpaymentsApiSecret ? "********" : "" });
}));

/** Версия панели — для мониторинга. Под auth, чтобы не светить наружу. */
adminRouter.get("/version", asyncRoute(async (_req, res) => {
  return res.json(APP_BUILD);
}));

/**
 * GET /api/admin/lavatop/products
 *
 * Прокси к Lava.top API: возвращает список всех продуктов оператора со
 * вложенными офферами. UI админки использует это чтобы показать удобный
 * список offer ID — оператор копирует нужный UUID в поле тарифа.
 *
 * Аутентификация — текущий API-key из system_settings.lavatop_api_key.
 */
adminRouter.get("/lavatop/products", asyncRoute(async (_req, res) => {
  const config = await getSystemConfig();
  const apiKey = (config as { lavatopApiKey?: string | null }).lavatopApiKey?.trim();
  if (!apiKey) {
    return res.status(400).json({ message: "Lava.top API-ключ не настроен. Сначала введите его в Settings → Платежи → Lava.top." });
  }
  try {
    const r = await fetch("https://gate.lava.top/api/v2/products", {
      method: "GET",
      headers: { "X-Api-Key": apiKey, Accept: "application/json" },
    });
    const text = await r.text();
    if (r.status === 401) {
      return res.status(401).json({ message: "Lava.top: неверный API-ключ (401)" });
    }
    if (!r.ok) {
      return res.status(r.status).json({ message: `Lava.top API ${r.status}: ${text.slice(0, 300)}` });
    }
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch {
      return res.status(502).json({ message: "Lava.top вернул невалидный JSON" });
    }
    type LavatopOffer = {
      id: string;
      name?: string;
      description?: string;
      prices?: { currency: string; amount: number; periodicity: string }[];
    };
    type LavatopProduct = {
      id: string;
      title?: string;
      description?: string;
      type?: string;
      offers?: LavatopOffer[];
    };
    const data = parsed as { items?: LavatopProduct[] } | LavatopProduct[];
    const items: LavatopProduct[] = Array.isArray(data)
      ? (data as LavatopProduct[])
      : Array.isArray(data?.items) ? data.items : [];

    // Нормализуем: плоский список офферов с привязкой к продукту
    const offers = items.flatMap((p) =>
      (p.offers ?? []).map((o) => ({
        offerId: o.id,
        offerName: o.name ?? "",
        offerDescription: (o.description ?? "").slice(0, 200),
        productId: p.id,
        productTitle: p.title ?? "",
        productType: p.type ?? "",
        prices: (o.prices ?? []).map((pr) => ({
          currency: pr.currency,
          amount: pr.amount,
          periodicity: pr.periodicity,
        })),
      })),
    );

    return res.json({
      productCount: items.length,
      offerCount: offers.length,
      offers,
      products: items.map((p) => ({ id: p.id, title: p.title, type: p.type, offerCount: (p.offers ?? []).length })),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(502).json({ message: `Lava.top: нет связи (${msg})` });
  }
}));

/**
 * Базовый конфиг страницы подписки (subpage-00000000-0000-0000-0000-000000000000.json)
 * для визуального редактора. В Docker файл подмонтирован как volume
 * (см. docker-compose.yml), поэтому изменения файла на хосте подхватываются
 * без пересборки контейнера.
 *
 * Логика поиска (по убыванию приоритета):
 *   1. /app/subpage-...json (volume-mount или COPY из образа) — primary
 *   2. process.cwd()-варианты для dev-окружения (npm run dev из backend/)
 *   3. /app/defaults/subpage-...json — fallback из образа, если primary
 *      сломан (пустой каталог при отсутствии файла на хосте, битый JSON и т.п.)
 *
 * Кэш на 30 секунд в памяти, чтобы не читать файл при каждом GET.
 * `?fresh=1` сбрасывает кэш — используется кнопкой «Перезагрузить с сервера» в UI.
 */
let _defaultSubpageCache: { data: unknown; ts: number } | null = null;
const SUBPAGE_CACHE_TTL_MS = 30_000;

async function tryReadJsonFile(filePath: string): Promise<unknown | null> {
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as unknown;
  } catch {
    // ENOENT, EISDIR (volume на отсутствующий файл монтируется как пустой каталог),
    // невалидный JSON — все случаи прозрачно скипаем и идём к следующему кандидату.
    return null;
  }
}

adminRouter.get("/default-subscription-page-config", asyncRoute(async (req, res) => {
  // ?fresh=1 — принудительный сброс кэша (используется при ручной перезагрузке)
  const fresh = req.query.fresh === "1" || req.query.fresh === "true";
  if (!fresh && _defaultSubpageCache && Date.now() - _defaultSubpageCache.ts < SUBPAGE_CACHE_TTL_MS) {
    return res.json(_defaultSubpageCache.data);
  }

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const fileName = "subpage-00000000-0000-0000-0000-000000000000.json";
  const candidates = [
    // 1. Primary: /app/subpage-...json (Docker volume-mount или COPY из образа)
    path.join(process.cwd(), fileName),
    // 2. Dev: запуск из backend/ (npm run dev)
    path.join(process.cwd(), "..", fileName),
    path.join(__dirname, "..", "..", "..", "..", fileName),
    path.join(__dirname, "..", "..", "..", "..", "..", fileName),
    // 3. Fallback из образа (всегда валидный snapshot версии на момент сборки)
    path.join(process.cwd(), "defaults", fileName),
    "/app/defaults/" + fileName,
  ];

  for (const configPath of candidates) {
    const data = await tryReadJsonFile(configPath);
    if (data !== null) {
      _defaultSubpageCache = { data, ts: Date.now() };
      return res.json(data);
    }
  }
  return res.status(404).json({ message: "Default config file not found" });
}));

const updateSettingsSchema = z.object({
  maintenanceEnabled: z.boolean().optional(),
  maintenanceMessage: z.string().trim().max(1000).optional(),
  remnaAutoSyncEnabled: z.boolean().optional(),
  remnaAutoSyncIntervalMinutes: z.number().int().min(5).max(1440).optional(),
  activeLanguages: z.string().optional(),
  activeCurrencies: z.string().optional(),
  defaultLanguage: z.string().max(10).optional(),
  defaultCurrency: z.string().max(10).optional(),
  referralRewardMode: z.enum(["percent", "balance", "days"]).optional(),
  referralRewardAmount: z.number().finite().min(0.01).max(1000000).multipleOf(0.01).optional(),
  referralRewardDays: z.number().int().min(1).max(365).optional(),
  defaultReferralPercent: z.number().min(0).max(100).optional(),
  referralPercentLevel2: z.number().min(0).max(100).optional(),
  referralPercentLevel3: z.number().min(0).max(100).optional(),
  trialDays: z.number().int().min(0).optional(),
  trialSquadUuid: z.string().uuid().nullable().optional(),
  trialDeviceLimit: z.number().int().min(0).nullable().optional(),
  trialTrafficLimitBytes: z.number().int().min(0).nullable().optional(),
  serviceName: z.string().max(200).optional(),
  serviceDescription: z.string().max(500).nullable().optional(),
  logo: z.string().max(5_500_000).nullable().optional(),
  logoBot: z.string().max(5_500_000).nullable().optional(),
  favicon: z.string().max(5_500_000).nullable().optional(),
  ogImage: z.string().max(5_500_000).nullable().optional(),
  cabinetDesign: z.enum(["classic", "modern", "stealth", "aurora"]).optional(),
  cabinetDesignApplyInBrowser: z.boolean().optional(),
  remnaApiUrl: z.string().trim().max(1000).refine(value => !value || /^https?:\/\//.test(value) && URL.canParse(value)).nullable().optional(),
  remnaAdminToken: z.string().trim().max(2000).nullable().optional(),
  remnaSecretKey: z.string().trim().max(1000).nullable().optional(),
  remnaClientUrl: z.string().max(2000).nullable().optional(),
  smtpHost: z.string().max(255).nullable().optional(),
  smtpPort: z.number().int().min(1).max(65535).optional(),
  smtpSecure: z.boolean().optional(),
  smtpUser: z.string().max(255).nullable().optional(),
  smtpPassword: z.string().max(500).nullable().optional(),
  smtpFromEmail: z.string().email().max(255).nullable().optional(),
  smtpFromName: z.string().max(200).nullable().optional(),
  mailProvider: z.enum(["smtp", "resend"]).optional(),
  resendApiKey: z.string().max(500).nullable().optional(),
  resendFromEmail: z.string().email().max(255).nullable().optional(),
  publicAppUrl: z.string().max(2000).nullable().optional(),
  telegramBotToken: z.string().max(500).nullable().optional(),
  telegramBotUsername: z.string().max(100).nullable().optional(),
  botAdminTelegramIds: z.union([z.string().max(2000), z.array(z.string())]).nullable().optional(),
  notificationTelegramGroupId: z.string().max(100).nullable().optional(),
  notificationManagersGroupId: z.string().max(100).nullable().optional(),
  notificationManagersTopicTickets: z.string().max(50).nullable().optional(),
  notificationTopicNewClients: z.string().max(50).nullable().optional(),
  notificationTopicPayments: z.string().max(50).nullable().optional(),
  notificationTopicTickets: z.string().max(50).nullable().optional(),
  notificationTopicTrials: z.string().max(50).nullable().optional(),
  notificationTopicConversions: z.string().max(50).nullable().optional(),
  notificationTopicWithdrawals: z.string().max(50).nullable().optional(),
  notificationTopicPromo: z.string().max(50).nullable().optional(),
  notificationTopicGifts: z.string().max(50).nullable().optional(),
  notificationTopicAutoRenew: z.string().max(50).nullable().optional(),
  notificationTopicBackups: z.string().max(50).nullable().optional(),
  autoBackupEnabled: z.boolean().optional(),
  autoBackupCron: z.string().max(50).nullable().optional(),
  ticketRetentionValue: z.number().int().min(0).max(36500).optional(),
  ticketRetentionUnit: z.enum(["minutes", "hours", "days"]).optional(),
  backupRetentionDays: z.number().int().min(0).max(3650).optional(),
  backupRetentionValue: z.number().int().min(0).max(100000).optional(),
  backupRetentionUnit: z.enum(["minutes", "hours", "days"]).optional(),
  plategaMerchantId: z.string().max(200).nullable().optional(),
  plategaSecret: z.string().max(500).nullable().optional(),
  plategaMethods: z.string().max(2000).nullable().optional(),
  /** HMAC секрет для проверки подписи webhook'ов Platega — security fix против форджинга платежей. */
  plategaWebhookSecret: z.string().max(500).nullable().optional(),
  paymentProvidersConfig: z.string().max(5000).nullable().optional(),
  gramadsApiKey: z.string().max(1000).nullable().optional(),
  yoomoneyClientId: z.string().max(200).nullable().optional(),
  yoomoneyClientSecret: z.string().max(500).nullable().optional(),
  yoomoneyReceiverWallet: z.string().max(50).nullable().optional(),
  yoomoneyNotificationSecret: z.string().max(500).nullable().optional(),
  yookassaShopId: z.string().max(200).nullable().optional(),
  yookassaSecretKey: z.string().max(500).nullable().optional(),
  /** Basic-auth username для webhook ЮKassa — security fix против форджинга платежей. */
  yookassaWebhookBasicUser: z.string().max(200).nullable().optional(),
  /** Basic-auth password для webhook ЮKassa — security fix против форджинга платежей. */
  yookassaWebhookBasicPassword: z.string().max(500).nullable().optional(),
  telegramStarsEnabled: z.boolean().optional(),
  telegramStarsRubPerStar: z.number().finite().min(0).max(1000000).optional(),
  cryptopayApiToken: z.string().max(500).nullable().optional(),
  cryptopayTestnet: z.boolean().optional(),
  heleketMerchantId: z.string().max(500).nullable().optional(),
  heleketApiKey: z.string().max(500).nullable().optional(),
  cloudpaymentsReceipt: receiptSettingsSchema.optional(),
  cloudpaymentsBotDirect: z.boolean().optional(),
  botCommands: botCommandsSchema.optional(),
  cloudpaymentsPublicId: z.string().max(150).optional(),
  cloudpaymentsApiSecret: z.string().max(500).optional(),
  cloudpaymentsEnabled: z.boolean().optional(),
  cloudpaymentsTestMode: z.boolean().optional(),
  cloudpaymentsTrialDays: z.number().int().min(0).max(365).optional(),
  cloudpaymentsTrialAmount: z.number().min(1).max(1000000).optional(),
  cloudpaymentsTrialTariffId: z.string().nullable().optional(),
  cloudpaymentsGraceDays: z.number().int().min(0).max(30).optional(),
  paritypayShopId: z.string().max(100).nullable().optional(),
  paritypayApiKey: z.string().max(500).nullable().optional(),
  paritypaySigningSecret: z.string().max(500).nullable().optional(),
  paritypayEnabled: z.boolean().optional(),
  cispayEnabled: z.boolean().optional(),
  cispayShopId: z.union([z.string().uuid(), z.literal("")]).optional(),
  cispayApiKey: z.string().max(500).optional(),
  cispaySandbox: z.boolean().optional(),
  rollypayApiKey: z.string().max(500).nullable().optional(),
  rollypaySigningSecret: z.string().max(500).nullable().optional(),
  rollypayTestMode: z.boolean().optional(),
  rollypayEnabled: z.boolean().optional(),
  lavaShopId: z.string().max(200).nullable().optional(),
  lavaSecretKey: z.string().max(500).nullable().optional(),
  lavaAdditionalKey: z.string().max(500).nullable().optional(),
  lavatopApiKey: z.string().max(500).nullable().optional(),
  lavatopDefaultOfferId: z.string().max(200).nullable().optional(),
  // Приветствие в боте при /start
  botWelcomeEnabled: z.boolean().optional(),
  botWelcomeText: z.string().max(4000).nullable().optional(),
  botWelcomeImage: z.string().max(5_500_000).nullable().optional(), // data URL base64
  botWelcomeShowOnce: z.boolean().optional(),
  overpayApiUrl: z.string().max(500).nullable().optional(),
  overpayProjectId: z.string().max(100).nullable().optional(),
  overpayLogin: z.string().max(200).nullable().optional(),
  overpayPassword: z.string().max(500).nullable().optional(),
  groqApiKey: z.string().max(500).nullable().optional(),
  groqModel: z.string().max(100).nullable().optional(),
  groqFallback1: z.string().max(100).nullable().optional(),
  groqFallback2: z.string().max(100).nullable().optional(),
  groqFallback3: z.string().max(100).nullable().optional(),
  aiSystemPrompt: z.string().max(5000).nullable().optional(),
  botButtons: botButtonsJsonSchema.nullable().optional(),
  paymentDescription: z.string().trim().max(128).optional(),
  botGroupCabinet: z.boolean().optional(),
  botMenuMode: z.enum(["classic", "web"]).optional(),
  botButtonsPerRow: z.union([z.literal(1), z.literal(2), z.number().int().min(1).max(2)]).optional(),
  botEmojis: z.union([z.string().max(15000), z.record(z.object({ unicode: z.string().max(20).optional(), tgEmojiId: z.string().max(50).optional() }))]).nullable().optional(),
  botBackLabel: z.string().max(200).nullable().optional(),
  // редактируемый текст шапки «📱 Мои устройства».
  botDevicesText: z.string().max(8000).nullable().optional(),
  botMenuTexts: z.string().max(8000).nullable().optional(),
  botMenuLineVisibility: z.union([z.string().max(5000), z.record(z.boolean())]).nullable().optional(),
  botInnerButtonStyles: z.union([z.string().max(2000), z.record(z.string())]).nullable().optional(),
  botTariffsText: z.string().max(8000).nullable().optional(),
  botTariffsFields: z.union([z.string().max(2000), z.record(z.boolean())]).nullable().optional(),
  botPaymentText: z.string().max(8000).nullable().optional(),
  subscriptionPageConfig: z.string().max(500000).nullable().optional(),
  supportLink: z.string().max(2000).nullable().optional(),
  agreementLink: z.string().max(2000).nullable().optional(),
  offerLink: z.string().max(2000).nullable().optional(),
  instructionsLink: z.string().max(2000).nullable().optional(),
  // ссылка инструкции по рефералке.
  referralInstructionsUrl: z.string().max(2000).nullable().optional(),
  // T11+T13+T14 (11.05.2026) — кастомизация бота
  refundLink: z.string().max(2000).nullable().optional(),
  supportHoursFrom: z.string().max(20).nullable().optional(),
  supportHoursTo: z.string().max(20).nullable().optional(),
  tgProxyText: z.string().max(8000).nullable().optional(),
  tgProxyUrlPrimary: z.string().max(2000).nullable().optional(),
  tgProxyUrlBackup: z.string().max(2000).nullable().optional(),
  // динамический список TG-прокси-серверов. Заменяет
  // primary/backup на массив. Каждый элемент: {flag: "🇳🇱", name: "Нидерланды",
  // url: "tg://proxy?..."}. Хранится как JSON-строка в system_settings.
  // Старые поля primary/backup остаются для backward compat: бот их использует
  // как fallback, если массив пуст.
  tgProxyServers: z.string().max(16000).nullable().optional(),
  reissueWarningText: z.string().max(4000).nullable().optional(),
  installSecondDeviceText: z.string().max(8000).nullable().optional(),
  helpIntroText: z.string().max(8000).nullable().optional(),
  ticketsEnabled: z.boolean().optional(),
  themeAccent: z.string().max(50).optional(),
  themeMode: z.enum(["light", "dark", "system"]).optional(),
  allowUserThemeChange: z.boolean().optional(),
  forceSubscribeEnabled: z.boolean().optional(),
  forceSubscribeChannelId: z.string().max(200).nullable().optional(),
  forceSubscribeMessage: z.string().max(1000).nullable().optional(),
  blacklistEnabled: z.boolean().optional(),
  sellOptionsEnabled: z.boolean().optional(),
  sellOptionsTrafficEnabled: z.boolean().optional(),
  sellOptionsTrafficProducts: z.string().max(10000).nullable().optional(),
  sellOptionsDevicesEnabled: z.boolean().optional(),
  sellOptionsDevicesProducts: z.string().max(10000).nullable().optional(),
  sellOptionsServersEnabled: z.boolean().optional(),
  sellOptionsServersProducts: z.string().max(10000).nullable().optional(),
  googleAnalyticsId: z.string().max(100).nullable().optional(),
  yandexMetrikaId: z.string().max(100).nullable().optional(),
  autoBroadcastCron: z.string().max(100).nullable().optional(),
  adminFrontNotificationsEnabled: z.boolean().optional(),
  skipEmailVerification: z.boolean().optional(),
  onboardingEmailRequired: z.boolean().optional(),
  passwordResetEnabled: z.boolean().optional(),
  stealthAccent: z.string().max(20).nullable().optional(),
  stealthHeroImage: z.string().max(8_000_000).nullable().optional(),
  multiSubscriptionsEnabled: z.boolean().optional(),
  // заявки на вывод реф. баланса: вкл/выкл + мин. сумма + способы вывода.
  withdrawalsEnabled: z.boolean().optional(),
  withdrawalMinAmount: z.number().int().min(1).max(1e7).optional(),
  withdrawalMethods: z.array(z.enum(["sbp", "card", "usdt"])).optional(),
  withdrawalMethodsSbp: z.boolean().optional(),
  withdrawalMethodsCard: z.boolean().optional(),
  withdrawalMethodsUsdt: z.boolean().optional(),
  signupProtectionEnabled: z.boolean().optional(),
  emailDomainBlocklist: z.string().max(10000).optional(),
  emailPatternBlocklist: z.string().max(10000).optional(),
  signupMaxPerIpPerHour: z.number().int().min(1).max(1000).optional(),
  happCryptEnabled: z.boolean().optional(),
  useRemnaSubscriptionPage: z.boolean().optional(),
  aiChatEnabled: z.boolean().optional(),
  customBuildEnabled: z.boolean().optional(),
  customBuildPricePerDay: z.number().min(0).optional(),
  customBuildPricePerDevice: z.number().min(0).optional(),
  customBuildTrafficMode: z.enum(["unlimited", "per_gb"]).optional(),
  customBuildPricePerGb: z.number().min(0).optional(),
  customBuildSquadUuid: z.string().uuid().nullable().optional(),
  customBuildCurrency: z.string().max(10).optional(),
  customBuildMaxDays: z.number().int().min(1).max(360).optional(),
  customBuildMaxDevices: z.number().int().min(1).max(20).optional(),
  defaultAutoRenewEnabled: z.boolean().optional(),
  autoRenewDaysBeforeExpiry: z.number().int().min(1).max(30).optional(),
  autoRenewNotifyDaysBefore: z.number().int().min(1).max(30).optional(),
  autoRenewGracePeriodDays: z.number().int().min(0).max(14).optional(),
  autoRenewMaxRetries: z.number().int().min(1).max(10).optional(),
  yookassaRecurringEnabled: z.boolean().optional(),
  googleLoginEnabled: z.boolean().optional(),
  googleClientId: z.string().max(500).nullable().optional(),
  googleClientSecret: z.string().max(500).nullable().optional(),
  appleLoginEnabled: z.boolean().optional(),
  appleClientId: z.string().max(500).nullable().optional(),
  appleTeamId: z.string().max(100).nullable().optional(),
  appleKeyId: z.string().max(100).nullable().optional(),
  applePrivateKey: z.string().max(5000).nullable().optional(),
  landingEnabled: z.boolean().optional(),
  landingHeroTitle: z.string().max(500).nullable().optional(),
  landingHeroSubtitle: z.string().max(2000).nullable().optional(),
  landingHeroCtaText: z.string().max(100).nullable().optional(),
  landingShowTariffs: z.boolean().optional(),
  landingContacts: z.string().max(5000).nullable().optional(),
  landingOfferLink: z.string().max(2000).nullable().optional(),
  landingPrivacyLink: z.string().max(2000).nullable().optional(),
  landingFooterText: z.string().max(2000).nullable().optional(),
  landingHeroBadge: z.string().max(200).nullable().optional(),
  landingHeroHint: z.string().max(500).nullable().optional(),
  landingFeature1Label: z.string().max(200).nullable().optional(),
  landingFeature1Sub: z.string().max(200).nullable().optional(),
  landingFeature2Label: z.string().max(200).nullable().optional(),
  landingFeature2Sub: z.string().max(200).nullable().optional(),
  landingFeature3Label: z.string().max(200).nullable().optional(),
  landingFeature3Sub: z.string().max(200).nullable().optional(),
  landingFeature4Label: z.string().max(200).nullable().optional(),
  landingFeature4Sub: z.string().max(200).nullable().optional(),
  landingFeature5Label: z.string().max(200).nullable().optional(),
  landingFeature5Sub: z.string().max(200).nullable().optional(),
  landingBenefitsTitle: z.string().max(200).nullable().optional(),
  landingBenefitsSubtitle: z.string().max(1000).nullable().optional(),
  landingBenefit1Title: z.string().max(200).nullable().optional(),
  landingBenefit1Desc: z.string().max(1000).nullable().optional(),
  landingBenefit2Title: z.string().max(200).nullable().optional(),
  landingBenefit2Desc: z.string().max(1000).nullable().optional(),
  landingBenefit3Title: z.string().max(200).nullable().optional(),
  landingBenefit3Desc: z.string().max(1000).nullable().optional(),
  landingBenefit4Title: z.string().max(200).nullable().optional(),
  landingBenefit4Desc: z.string().max(1000).nullable().optional(),
  landingBenefit5Title: z.string().max(200).nullable().optional(),
  landingBenefit5Desc: z.string().max(1000).nullable().optional(),
  landingBenefit6Title: z.string().max(200).nullable().optional(),
  landingBenefit6Desc: z.string().max(1000).nullable().optional(),
  landingTariffsTitle: z.string().max(200).nullable().optional(),
  landingTariffsSubtitle: z.string().max(500).nullable().optional(),
  landingDevicesTitle: z.string().max(200).nullable().optional(),
  landingDevicesSubtitle: z.string().max(500).nullable().optional(),
  landingFaqTitle: z.string().max(200).nullable().optional(),
  landingFaqJson: z.string().max(20000).nullable().optional(),
  landingHeroHeadline1: z.string().max(300).nullable().optional(),
  landingHeroHeadline2: z.string().max(300).nullable().optional(),
  landingHeaderBadge: z.string().max(200).nullable().optional(),
  landingButtonLogin: z.string().max(100).nullable().optional(),
  landingButtonLoginCabinet: z.string().max(100).nullable().optional(),
  landingNavBenefits: z.string().max(100).nullable().optional(),
  landingNavTariffs: z.string().max(100).nullable().optional(),
  landingNavDevices: z.string().max(100).nullable().optional(),
  landingNavFaq: z.string().max(100).nullable().optional(),
  landingBenefitsBadge: z.string().max(200).nullable().optional(),
  landingDefaultPaymentText: z.string().max(300).nullable().optional(),
  landingButtonChooseTariff: z.string().max(100).nullable().optional(),
  landingNoTariffsMessage: z.string().max(500).nullable().optional(),
  landingButtonWatchTariffs: z.string().max(100).nullable().optional(),
  landingButtonStart: z.string().max(100).nullable().optional(),
  landingButtonOpenCabinet: z.string().max(100).nullable().optional(),
  landingJourneyStepsJson: z.string().max(5000).nullable().optional(),
  landingSignalCardsJson: z.string().max(5000).nullable().optional(),
  landingTrustPointsJson: z.string().max(2000).nullable().optional(),
  landingExperiencePanelsJson: z.string().max(3000).nullable().optional(),
  landingDevicesListJson: z.string().max(1000).nullable().optional(),
  landingQuickStartJson: z.string().max(1500).nullable().optional(),
  landingInfraTitle: z.string().max(500).nullable().optional(),
  landingNetworkCockpitText: z.string().max(500).nullable().optional(),
  landingPulseTitle: z.string().max(300).nullable().optional(),
  landingComfortTitle: z.string().max(300).nullable().optional(),
  landingComfortBadge: z.string().max(200).nullable().optional(),
  landingPrinciplesTitle: z.string().max(500).nullable().optional(),
  landingTechTitle: z.string().max(300).nullable().optional(),
  landingTechDesc: z.string().max(2000).nullable().optional(),
  landingCategorySubtitle: z.string().max(500).nullable().optional(),
  landingTariffDefaultDesc: z.string().max(500).nullable().optional(),
  landingTariffBullet1: z.string().max(300).nullable().optional(),
  landingTariffBullet2: z.string().max(300).nullable().optional(),
  landingTariffBullet3: z.string().max(300).nullable().optional(),
  landingLowestTariffDesc: z.string().max(500).nullable().optional(),
  landingDevicesCockpitText: z.string().max(500).nullable().optional(),
  landingUniversalityTitle: z.string().max(300).nullable().optional(),
  landingUniversalityDesc: z.string().max(500).nullable().optional(),
  landingQuickSetupTitle: z.string().max(300).nullable().optional(),
  landingQuickSetupDesc: z.string().max(500).nullable().optional(),
  landingPremiumServiceTitle: z.string().max(300).nullable().optional(),
  landingPremiumServicePara1: z.string().max(1000).nullable().optional(),
  landingPremiumServicePara2: z.string().max(1000).nullable().optional(),
  landingHowItWorksTitle: z.string().max(500).nullable().optional(),
  landingHowItWorksDesc: z.string().max(1000).nullable().optional(),
  landingStatsPlatforms: z.string().max(50).nullable().optional(),
  landingStatsTariffsLabel: z.string().max(50).nullable().optional(),
  landingStatsAccessLabel: z.string().max(50).nullable().optional(),
  landingStatsPaymentMethods: z.string().max(50).nullable().optional(),
  landingReadyToConnectEyebrow: z.string().max(200).nullable().optional(),
  landingReadyToConnectTitle: z.string().max(500).nullable().optional(),
  landingReadyToConnectDesc: z.string().max(2000).nullable().optional(),
  landingShowFeatures: z.boolean().optional(),
  landingShowBenefits: z.boolean().optional(),
  landingShowDevices: z.boolean().optional(),
  landingShowFaq: z.boolean().optional(),
  landingShowHowItWorks: z.boolean().optional(),
  landingShowCta: z.boolean().optional(),
  proxyEnabled: z.boolean().optional(),
  proxyUrl: z.string().max(500).nullable().optional(),
  proxyTelegram: z.boolean().optional(),
  proxyPayments: z.boolean().optional(),
  proxyAi: z.boolean().optional(),
  liteMode: z.boolean().optional(),
  giftSubscriptionsEnabled: z.boolean().optional(),
  giftCodeExpiryHours: z.number().int().min(1).max(8760).optional(),
  maxAdditionalSubscriptions: z.number().int().min(1).max(100).optional(),
  giftCodeFormatLength: z.number().int().min(6).max(24).optional(),
  giftRateLimitPerMinute: z.number().int().min(1).max(60).optional(),
  giftExpiryNotificationDays: z.number().int().min(0).max(30).optional(),
  giftReferralEnabled: z.boolean().optional(),
  giftMessageMaxLength: z.number().int().min(0).max(1000).optional(),
  // Поведение бота
  botAutoDeleteUnknownMessages: z.boolean().optional(),
  botInfoBlock: z.string().max(2000).nullable().optional(),
  // тогглы кнопок на экране «Тарифы» бота (default true)
  botTariffsShowExtraDevicesButton: z.boolean().optional(),
  botTariffsShowBalanceButton: z.boolean().optional(),
  // меню выбора категорий перед списком тарифов в боте (default true)
  botHtmlBubblesTest: z.boolean().optional(),
  botShowTariffCategories: z.boolean().optional(),
});

adminRouter.patch("/settings", async (req, res) => {
  const rawBody = req.body as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(rawBody, "botInnerButtonStyles")) {
    const raw = rawBody.botInnerButtonStyles;
    const val =
      typeof raw === "string"
        ? raw
        : raw !== null && typeof raw === "object" && !Array.isArray(raw)
          ? JSON.stringify(raw)
          : "";
    await prisma.systemSetting.upsert({
      where: { key: "bot_inner_button_styles" },
      create: { key: "bot_inner_button_styles", value: val },
      update: { value: val },
    });
  }

  const body = updateSettingsSchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  }
  const updates = body.data;
  if (updates.activeLanguages != null) {
    await prisma.systemSetting.upsert({
      where: { key: "active_languages" },
      create: { key: "active_languages", value: updates.activeLanguages },
      update: { value: updates.activeLanguages },
    });
  }
  if (updates.activeCurrencies != null) {
    await prisma.systemSetting.upsert({
      where: { key: "active_currencies" },
      create: { key: "active_currencies", value: updates.activeCurrencies },
      update: { value: updates.activeCurrencies },
    });
  }
  if (updates.defaultLanguage != null) {
    await prisma.systemSetting.upsert({
      where: { key: "default_language" },
      create: { key: "default_language", value: updates.defaultLanguage },
      update: { value: updates.defaultLanguage },
    });
  }
  if (updates.defaultCurrency != null) {
    await prisma.systemSetting.upsert({
      where: { key: "default_currency" },
      create: { key: "default_currency", value: updates.defaultCurrency },
      update: { value: updates.defaultCurrency },
    });
  }
  for (const [key, value] of [["remna_auto_sync_enabled", updates.remnaAutoSyncEnabled], ["remna_auto_sync_interval_minutes", updates.remnaAutoSyncIntervalMinutes]] as const) {
    if (value !== undefined) await prisma.systemSetting.upsert({ where: { key }, create: { key, value: String(value) }, update: { value: String(value) } });
  }
  for (const [key, value] of [["maintenance_enabled", updates.maintenanceEnabled], ["maintenance_message", updates.maintenanceMessage]] as const) {
    if (value !== undefined) await prisma.systemSetting.upsert({ where: { key }, create: { key, value: String(value) }, update: { value: String(value) } });
  }
  const referralSettings = [
    ["referral_reward_mode", updates.referralRewardMode],
    ["referral_reward_amount", updates.referralRewardAmount],
    ["referral_reward_days", updates.referralRewardDays],
  ] as const;
  await prisma.$transaction(async tx => {
    const previous = await tx.systemSetting.findUnique({ where: { key: "referral_reward_mode" } });
    if (updates.referralRewardMode && updates.referralRewardMode !== "percent" && (!previous || previous.value === "percent")) {
      const now = new Date().toISOString();
      await tx.systemSetting.upsert({ where: { key: "referral_reward_enabled_at" }, create: { key: "referral_reward_enabled_at", value: now }, update: { value: now } });
    }
    for (const [key, value] of referralSettings) {
      if (value !== undefined) await tx.systemSetting.upsert({ where: { key }, create: { key, value: String(value) }, update: { value: String(value) } });
    }
  });
  if (updates.defaultReferralPercent != null) {
    await prisma.systemSetting.upsert({
      where: { key: "default_referral_percent" },
      create: { key: "default_referral_percent", value: String(updates.defaultReferralPercent) },
      update: { value: String(updates.defaultReferralPercent) },
    });
  }
  if (updates.referralPercentLevel2 != null) {
    await prisma.systemSetting.upsert({
      where: { key: "referral_percent_level_2" },
      create: { key: "referral_percent_level_2", value: String(updates.referralPercentLevel2) },
      update: { value: String(updates.referralPercentLevel2) },
    });
  }
  if (updates.referralPercentLevel3 != null) {
    await prisma.systemSetting.upsert({
      where: { key: "referral_percent_level_3" },
      create: { key: "referral_percent_level_3", value: String(updates.referralPercentLevel3) },
      update: { value: String(updates.referralPercentLevel3) },
    });
  }
  if (updates.trialDays != null) {
    await prisma.systemSetting.upsert({
      where: { key: "trial_days" },
      create: { key: "trial_days", value: String(updates.trialDays) },
      update: { value: String(updates.trialDays) },
    });
  }
  if (updates.trialSquadUuid !== undefined) {
    const val = updates.trialSquadUuid ?? "";
    await prisma.systemSetting.upsert({
      where: { key: "trial_squad_uuid" },
      create: { key: "trial_squad_uuid", value: val },
      update: { value: val },
    });
  }
  if (updates.trialDeviceLimit !== undefined) {
    const val = updates.trialDeviceLimit == null ? "" : String(updates.trialDeviceLimit);
    await prisma.systemSetting.upsert({
      where: { key: "trial_device_limit" },
      create: { key: "trial_device_limit", value: val },
      update: { value: val },
    });
  }
  if (updates.trialTrafficLimitBytes !== undefined) {
    const val = updates.trialTrafficLimitBytes == null ? "" : String(updates.trialTrafficLimitBytes);
    await prisma.systemSetting.upsert({
      where: { key: "trial_traffic_limit" },
      create: { key: "trial_traffic_limit", value: val },
      update: { value: val },
    });
  }
  if (updates.serviceName != null) {
    await prisma.systemSetting.upsert({
      where: { key: "service_name" },
      create: { key: "service_name", value: updates.serviceName },
      update: { value: updates.serviceName },
    });
    invalidateBrandCache();
  }
  if (updates.serviceDescription !== undefined) {
    const val = updates.serviceDescription ?? "";
    await prisma.systemSetting.upsert({
      where: { key: "service_description" },
      create: { key: "service_description", value: val },
      update: { value: val },
    });
    invalidateBrandCache();
  }
  if (updates.logo !== undefined) {
    const val = updates.logo ?? "";
    await prisma.systemSetting.upsert({
      where: { key: "logo" },
      create: { key: "logo", value: val },
      update: { value: val },
    });
    invalidateBrandCache();
  }
  if (updates.logoBot !== undefined) {
    const val = updates.logoBot ?? "";
    await prisma.systemSetting.upsert({
      where: { key: "logo_bot" },
      create: { key: "logo_bot", value: val },
      update: { value: val },
    });
  }
  if (updates.favicon !== undefined) {
    const val = updates.favicon ?? "";
    await prisma.systemSetting.upsert({
      where: { key: "favicon" },
      create: { key: "favicon", value: val },
      update: { value: val },
    });
    invalidateBrandCache();
    invalidateSystemConfigCache();
  }
  if (updates.ogImage !== undefined) {
    const val = updates.ogImage ?? "";
    await prisma.systemSetting.upsert({
      where: { key: "og_image" },
      create: { key: "og_image", value: val },
      update: { value: val },
    });
    invalidateBrandCache();
    invalidateSystemConfigCache();
  }
  if (updates.cabinetDesign !== undefined) {
    await prisma.systemSetting.upsert({
      where: { key: "cabinet_design" },
      create: { key: "cabinet_design", value: updates.cabinetDesign },
      update: { value: updates.cabinetDesign },
    });
  }
  if (updates.cabinetDesignApplyInBrowser !== undefined) {
    const val = updates.cabinetDesignApplyInBrowser ? "true" : "false";
    await prisma.systemSetting.upsert({
      where: { key: "cabinet_design_apply_in_browser" },
      create: { key: "cabinet_design_apply_in_browser", value: val },
      update: { value: val },
    });
  }
  const remnaChanges = [
    ["remna_api_url", updates.remnaApiUrl],
    ["remna_admin_token", updates.remnaAdminToken],
    ["remna_secret_key", updates.remnaSecretKey],
  ] as const;
  if (remnaChanges.some(([, value]) => value !== undefined)) {
    await prisma.$transaction(async db => {
      for (const [key, input] of remnaChanges) {
        if (input === undefined) continue;
        const value = (input ?? "").trim();
        if (!value && key !== "remna_secret_key") await db.systemSetting.deleteMany({ where: { key } });
        else await db.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
      }
    });
    invalidateSystemConfigCache();
  }
  if (updates.remnaClientUrl !== undefined) {
    const val = updates.remnaClientUrl ?? "";
    await prisma.systemSetting.upsert({
      where: { key: "remna_client_url" },
      create: { key: "remna_client_url", value: val },
      update: { value: val },
    });
  }
  if (updates.smtpHost !== undefined) {
    const val = updates.smtpHost ?? "";
    await prisma.systemSetting.upsert({ where: { key: "smtp_host" }, create: { key: "smtp_host", value: val }, update: { value: val } });
  }
  if (updates.smtpPort != null) {
    await prisma.systemSetting.upsert({ where: { key: "smtp_port" }, create: { key: "smtp_port", value: String(updates.smtpPort) }, update: { value: String(updates.smtpPort) } });
  }
  if (updates.smtpSecure !== undefined) {
    await prisma.systemSetting.upsert({ where: { key: "smtp_secure" }, create: { key: "smtp_secure", value: updates.smtpSecure ? "true" : "false" }, update: { value: updates.smtpSecure ? "true" : "false" } });
  }
  if (updates.smtpUser !== undefined) {
    const val = updates.smtpUser ?? "";
    await prisma.systemSetting.upsert({ where: { key: "smtp_user" }, create: { key: "smtp_user", value: val }, update: { value: val } });
  }
  if (updates.smtpPassword !== undefined) {
    const val = updates.smtpPassword ?? "";
    await prisma.systemSetting.upsert({ where: { key: "smtp_password" }, create: { key: "smtp_password", value: val }, update: { value: val } });
  }
  if (updates.smtpFromEmail !== undefined) {
    const val = updates.smtpFromEmail ?? "";
    await prisma.systemSetting.upsert({ where: { key: "smtp_from_email" }, create: { key: "smtp_from_email", value: val }, update: { value: val } });
  }
  if (updates.smtpFromName !== undefined) {
    const val = updates.smtpFromName ?? "";
    await prisma.systemSetting.upsert({ where: { key: "smtp_from_name" }, create: { key: "smtp_from_name", value: val }, update: { value: val } });
  }
  if (updates.mailProvider !== undefined) {
    const val = updates.mailProvider === "resend" ? "resend" : "smtp";
    await prisma.systemSetting.upsert({ where: { key: "mail_provider" }, create: { key: "mail_provider", value: val }, update: { value: val } });
  }
  if (updates.resendApiKey !== undefined) {
    const val = updates.resendApiKey ?? "";
    await prisma.systemSetting.upsert({ where: { key: "resend_api_key" }, create: { key: "resend_api_key", value: val }, update: { value: val } });
  }
  if (updates.resendFromEmail !== undefined) {
    const val = updates.resendFromEmail ?? "";
    await prisma.systemSetting.upsert({ where: { key: "resend_from_email" }, create: { key: "resend_from_email", value: val }, update: { value: val } });
  }
  if (updates.publicAppUrl !== undefined) {
    const val = updates.publicAppUrl ?? "";
    await prisma.systemSetting.upsert({ where: { key: "public_app_url" }, create: { key: "public_app_url", value: val }, update: { value: val } });
  }
  if (updates.telegramBotToken !== undefined) {
    const val = updates.telegramBotToken ?? "";
    await prisma.systemSetting.upsert({ where: { key: "telegram_bot_token" }, create: { key: "telegram_bot_token", value: val }, update: { value: val } });
  }
  if (updates.telegramBotUsername !== undefined) {
    const val = updates.telegramBotUsername ?? "";
    await prisma.systemSetting.upsert({ where: { key: "telegram_bot_username" }, create: { key: "telegram_bot_username", value: val }, update: { value: val } });
  }
  if (updates.botAdminTelegramIds !== undefined) {
    const raw = updates.botAdminTelegramIds;
    const val = Array.isArray(raw) ? JSON.stringify(raw) : (raw ?? "");
    await prisma.systemSetting.upsert({ where: { key: "bot_admin_telegram_ids" }, create: { key: "bot_admin_telegram_ids", value: val }, update: { value: val } });
  }
  if (updates.notificationTelegramGroupId !== undefined) {
    const val = (updates.notificationTelegramGroupId ?? "").trim() || "";
    await prisma.systemSetting.upsert({
      where: { key: "notification_telegram_group_id" },
      create: { key: "notification_telegram_group_id", value: val },
      update: { value: val },
    });
  }
  if (updates.notificationManagersGroupId !== undefined) {
    const val = (updates.notificationManagersGroupId ?? "").trim() || "";
    await prisma.systemSetting.upsert({
      where: { key: "notification_managers_group_id" },
      create: { key: "notification_managers_group_id", value: val },
      update: { value: val },
    });
  }
  const topicKeys: [keyof typeof updates, string][] = [
    ["notificationTopicNewClients", "notification_topic_new_clients"],
    ["notificationTopicPayments", "notification_topic_payments"],
    ["notificationTopicTickets", "notification_topic_tickets"],
    ["notificationTopicTrials", "notification_topic_trials"],
    ["notificationTopicConversions", "notification_topic_conversions"],
    ["notificationTopicWithdrawals", "notification_topic_withdrawals"],
    ["notificationTopicPromo", "notification_topic_promo"],
    ["notificationTopicGifts", "notification_topic_gifts"],
    ["notificationTopicAutoRenew", "notification_topic_auto_renew"],
    ["notificationManagersTopicTickets", "notification_managers_topic_tickets"],
    ["notificationTopicBackups", "notification_topic_backups"],
  ];
  for (const [key, dbKey] of topicKeys) {
    if (updates[key] !== undefined) {
      const val = (String(updates[key] ?? "")).trim() || "";
      await prisma.systemSetting.upsert({ where: { key: dbKey }, create: { key: dbKey, value: val }, update: { value: val } });
    }
  }
  if (updates.autoBackupEnabled !== undefined) {
    const val = updates.autoBackupEnabled ? "true" : "false";
    await prisma.systemSetting.upsert({ where: { key: "auto_backup_enabled" }, create: { key: "auto_backup_enabled", value: val }, update: { value: val } });
  }
  if (updates.autoBackupCron !== undefined) {
    const val = (updates.autoBackupCron ?? "").trim() || "";
    await prisma.systemSetting.upsert({ where: { key: "auto_backup_cron" }, create: { key: "auto_backup_cron", value: val }, update: { value: val } });
    const { restartAutoBackupScheduler } = await import("../backup/auto-backup.scheduler.js");
    await restartAutoBackupScheduler();
  }
  if (updates.autoBackupEnabled !== undefined) {
    const { restartAutoBackupScheduler } = await import("../backup/auto-backup.scheduler.js");
    await restartAutoBackupScheduler();
  }
  if (updates.ticketRetentionValue !== undefined) {
    const val = String(updates.ticketRetentionValue);
    await prisma.systemSetting.upsert({ where: { key: "ticket_retention_value" }, create: { key: "ticket_retention_value", value: val }, update: { value: val } });
  }
  if (updates.ticketRetentionUnit !== undefined) {
    const val = updates.ticketRetentionUnit;
    await prisma.systemSetting.upsert({ where: { key: "ticket_retention_unit" }, create: { key: "ticket_retention_unit", value: val }, update: { value: val } });
  }
  if (updates.backupRetentionValue !== undefined) {
    const val = String(updates.backupRetentionValue);
    await prisma.systemSetting.upsert({ where: { key: "backup_retention_value" }, create: { key: "backup_retention_value", value: val }, update: { value: val } });
  }
  if (updates.backupRetentionUnit !== undefined) {
    const val = updates.backupRetentionUnit;
    await prisma.systemSetting.upsert({ where: { key: "backup_retention_unit" }, create: { key: "backup_retention_unit", value: val }, update: { value: val } });
  }
  if (updates.backupRetentionDays !== undefined) {
    const val = String(updates.backupRetentionDays);
    await prisma.systemSetting.upsert({ where: { key: "backup_retention_days" }, create: { key: "backup_retention_days", value: val }, update: { value: val } });
  } else if (updates.backupRetentionValue !== undefined) {
    const unit = updates.backupRetentionUnit ?? "days";
    const days = unit === "days" ? updates.backupRetentionValue : Math.max(1, Math.round(updates.backupRetentionValue / (unit === "hours" ? 24 : 1440)));
    const val = String(updates.backupRetentionValue === 0 ? 0 : days);
    await prisma.systemSetting.upsert({ where: { key: "backup_retention_days" }, create: { key: "backup_retention_days", value: val }, update: { value: val } });
  }
  if (updates.plategaMerchantId !== undefined) {
    const val = updates.plategaMerchantId ?? "";
    await prisma.systemSetting.upsert({ where: { key: "platega_merchant_id" }, create: { key: "platega_merchant_id", value: val }, update: { value: val } });
  }
  if (updates.plategaSecret !== undefined) {
    const val = updates.plategaSecret ?? "";
    await prisma.systemSetting.upsert({ where: { key: "platega_secret" }, create: { key: "platega_secret", value: val }, update: { value: val } });
  }
  if (updates.plategaMethods !== undefined) {
    const val = updates.plategaMethods ?? "";
    await prisma.systemSetting.upsert({ where: { key: "platega_methods" }, create: { key: "platega_methods", value: val }, update: { value: val } });
  }
  if (updates.plategaWebhookSecret !== undefined) {
    const val = updates.plategaWebhookSecret ?? "";
    await prisma.systemSetting.upsert({ where: { key: "platega_webhook_secret" }, create: { key: "platega_webhook_secret", value: val }, update: { value: val } });
  }
  if (updates.paymentProvidersConfig !== undefined) {
    const val = updates.paymentProvidersConfig ?? "";
    await prisma.systemSetting.upsert({ where: { key: "payment_providers_config" }, create: { key: "payment_providers_config", value: val }, update: { value: val } });
  }
  if (updates.gramadsApiKey !== undefined) {
    const val = updates.gramadsApiKey && updates.gramadsApiKey !== "********" ? updates.gramadsApiKey : (updates.gramadsApiKey === "" ? "" : undefined);
    if (val !== undefined) {
      await prisma.systemSetting.upsert({ where: { key: "gramads_api_key" }, create: { key: "gramads_api_key", value: val }, update: { value: val } });
    }
  }
  if (updates.yoomoneyClientId !== undefined) {
    const val = updates.yoomoneyClientId ?? "";
    await prisma.systemSetting.upsert({ where: { key: "yoomoney_client_id" }, create: { key: "yoomoney_client_id", value: val }, update: { value: val } });
  }
  if (updates.yoomoneyClientSecret !== undefined) {
    const val = updates.yoomoneyClientSecret ?? "";
    await prisma.systemSetting.upsert({ where: { key: "yoomoney_client_secret" }, create: { key: "yoomoney_client_secret", value: val }, update: { value: val } });
  }
  if (updates.yoomoneyReceiverWallet !== undefined) {
    const val = updates.yoomoneyReceiverWallet ?? "";
    await prisma.systemSetting.upsert({ where: { key: "yoomoney_receiver_wallet" }, create: { key: "yoomoney_receiver_wallet", value: val }, update: { value: val } });
  }
  if (updates.yoomoneyNotificationSecret !== undefined) {
    const val = updates.yoomoneyNotificationSecret ?? "";
    await prisma.systemSetting.upsert({ where: { key: "yoomoney_notification_secret" }, create: { key: "yoomoney_notification_secret", value: val }, update: { value: val } });
  }
  if (updates.yookassaShopId !== undefined) {
    const val = updates.yookassaShopId ?? "";
    await prisma.systemSetting.upsert({ where: { key: "yookassa_shop_id" }, create: { key: "yookassa_shop_id", value: val }, update: { value: val } });
  }
  if (updates.yookassaSecretKey !== undefined) {
    const val = updates.yookassaSecretKey ?? "";
    await prisma.systemSetting.upsert({ where: { key: "yookassa_secret_key" }, create: { key: "yookassa_secret_key", value: val }, update: { value: val } });
  }
  if (updates.yookassaWebhookBasicUser !== undefined) {
    const val = updates.yookassaWebhookBasicUser ?? "";
    await prisma.systemSetting.upsert({ where: { key: "yookassa_webhook_basic_user" }, create: { key: "yookassa_webhook_basic_user", value: val }, update: { value: val } });
  }
  if (updates.yookassaWebhookBasicPassword !== undefined) {
    const val = updates.yookassaWebhookBasicPassword ?? "";
    await prisma.systemSetting.upsert({ where: { key: "yookassa_webhook_basic_password" }, create: { key: "yookassa_webhook_basic_password", value: val }, update: { value: val } });
  }
  for (const [field, key] of [["telegramStarsEnabled", "telegram_stars_enabled"], ["telegramStarsRubPerStar", "telegram_stars_rub_per_star"]] as const) {
    if (updates[field] !== undefined) {
      const value = String(updates[field]);
      await prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
    }
  }
  if (updates.cryptopayApiToken !== undefined) {
    const val = updates.cryptopayApiToken ?? "";
    await prisma.systemSetting.upsert({ where: { key: "cryptopay_api_token" }, create: { key: "cryptopay_api_token", value: val }, update: { value: val } });
  }
  if (updates.cryptopayTestnet !== undefined) {
    const val = updates.cryptopayTestnet ? "true" : "false";
    await prisma.systemSetting.upsert({ where: { key: "cryptopay_testnet" }, create: { key: "cryptopay_testnet", value: val }, update: { value: val } });
  }
  if (updates.heleketMerchantId !== undefined) {
    const val = updates.heleketMerchantId ?? "";
    await prisma.systemSetting.upsert({ where: { key: "heleket_merchant_id" }, create: { key: "heleket_merchant_id", value: val }, update: { value: val } });
  }
  if (updates.cloudpaymentsPublicId !== undefined && String(updates.cloudpaymentsPublicId) !== "********") {
    const value = String(updates.cloudpaymentsPublicId ?? "");
    await prisma.systemSetting.upsert({ where: { key: "cloudpayments_public_id" }, create: { key: "cloudpayments_public_id", value }, update: { value } });
  }
  if (updates.cloudpaymentsApiSecret !== undefined && String(updates.cloudpaymentsApiSecret) !== "********") {
    const value = String(updates.cloudpaymentsApiSecret ?? "");
    await prisma.systemSetting.upsert({ where: { key: "cloudpayments_api_secret" }, create: { key: "cloudpayments_api_secret", value }, update: { value } });
  }
  if (updates.cloudpaymentsEnabled !== undefined && String(updates.cloudpaymentsEnabled) !== "********") {
    const value = String(updates.cloudpaymentsEnabled ?? "");
    await prisma.systemSetting.upsert({ where: { key: "cloudpayments_enabled" }, create: { key: "cloudpayments_enabled", value }, update: { value } });
  }
  if (updates.cloudpaymentsTestMode !== undefined && String(updates.cloudpaymentsTestMode) !== "********") {
    const value = String(updates.cloudpaymentsTestMode ?? "");
    await prisma.systemSetting.upsert({ where: { key: "cloudpayments_test_mode" }, create: { key: "cloudpayments_test_mode", value }, update: { value } });
  }
  if (updates.cloudpaymentsTrialDays !== undefined && String(updates.cloudpaymentsTrialDays) !== "********") {
    const value = String(updates.cloudpaymentsTrialDays ?? "");
    await prisma.systemSetting.upsert({ where: { key: "cloudpayments_trial_days" }, create: { key: "cloudpayments_trial_days", value }, update: { value } });
  }
  if (updates.cloudpaymentsTrialAmount !== undefined && String(updates.cloudpaymentsTrialAmount) !== "********") {
    const value = String(updates.cloudpaymentsTrialAmount ?? "");
    await prisma.systemSetting.upsert({ where: { key: "cloudpayments_trial_amount" }, create: { key: "cloudpayments_trial_amount", value }, update: { value } });
  }
  if (updates.cloudpaymentsTrialTariffId !== undefined && String(updates.cloudpaymentsTrialTariffId) !== "********") {
    const value = String(updates.cloudpaymentsTrialTariffId ?? "");
    await prisma.systemSetting.upsert({ where: { key: "cloudpayments_trial_tariff_id" }, create: { key: "cloudpayments_trial_tariff_id", value }, update: { value } });
  }
  for (const [field, key] of [["cloudpaymentsReceipt", "cloudpayments_receipt"], ["cloudpaymentsBotDirect", "cloudpayments_bot_direct"], ["botCommands", "bot_commands"]] as const) {
    if (updates[field] === undefined) continue;
    const value = JSON.stringify(updates[field]);
    await prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }
  if (updates.cloudpaymentsGraceDays !== undefined && String(updates.cloudpaymentsGraceDays) !== "********") {
    const value = String(updates.cloudpaymentsGraceDays ?? "");
    await prisma.systemSetting.upsert({ where: { key: "cloudpayments_grace_days" }, create: { key: "cloudpayments_grace_days", value }, update: { value } });
  }
  if (updates.paritypayShopId !== undefined && updates.paritypayShopId !== "********") {
    const val = updates.paritypayShopId ?? "";
    await prisma.systemSetting.upsert({ where: { key: "paritypay_shop_id" }, create: { key: "paritypay_shop_id", value: val }, update: { value: val } });
  }
  if (updates.paritypayApiKey !== undefined && updates.paritypayApiKey !== "********") {
    const val = updates.paritypayApiKey ?? "";
    await prisma.systemSetting.upsert({ where: { key: "paritypay_api_key" }, create: { key: "paritypay_api_key", value: val }, update: { value: val } });
  }
  if (updates.paritypaySigningSecret !== undefined && updates.paritypaySigningSecret !== "********") {
    const val = updates.paritypaySigningSecret ?? "";
    await prisma.systemSetting.upsert({ where: { key: "paritypay_signing_secret" }, create: { key: "paritypay_signing_secret", value: val }, update: { value: val } });
  }
  if (updates.paritypayEnabled !== undefined) {
    const val = updates.paritypayEnabled ? "true" : "false";
    await prisma.systemSetting.upsert({ where: { key: "paritypay_enabled" }, create: { key: "paritypay_enabled", value: val }, update: { value: val } });
  }
  for (const [field, key] of [["cispayEnabled", "cispay_enabled"], ["cispayShopId", "cispay_shop_id"], ["cispayApiKey", "cispay_api_key"], ["cispaySandbox", "cispay_sandbox"]] as const) {
    const value = updates[field];
    if (value === undefined || (field === "cispayApiKey" && value === "********")) continue;
    await prisma.systemSetting.upsert({ where: { key }, create: { key, value: String(value) }, update: { value: String(value) } });
  }
  if (updates.rollypayApiKey !== undefined) {
    const val = updates.rollypayApiKey ?? "";
    await prisma.systemSetting.upsert({ where: { key: "rollypay_api_key" }, create: { key: "rollypay_api_key", value: val }, update: { value: val } });
  }
  if (updates.rollypaySigningSecret !== undefined) {
    const val = updates.rollypaySigningSecret ?? "";
    await prisma.systemSetting.upsert({ where: { key: "rollypay_signing_secret" }, create: { key: "rollypay_signing_secret", value: val }, update: { value: val } });
  }
  if (updates.rollypayTestMode !== undefined) {
    const val = updates.rollypayTestMode ? "true" : "false";
    await prisma.systemSetting.upsert({ where: { key: "rollypay_test_mode" }, create: { key: "rollypay_test_mode", value: val }, update: { value: val } });
  }
  if (updates.rollypayEnabled !== undefined) {
    const val = updates.rollypayEnabled ? "true" : "false";
    await prisma.systemSetting.upsert({ where: { key: "rollypay_enabled" }, create: { key: "rollypay_enabled", value: val }, update: { value: val } });
  }
  if (updates.heleketApiKey !== undefined) {
    const val = updates.heleketApiKey ?? "";
    await prisma.systemSetting.upsert({ where: { key: "heleket_api_key" }, create: { key: "heleket_api_key", value: val }, update: { value: val } });
  }
  if (updates.lavaShopId !== undefined) {
    const val = updates.lavaShopId ?? "";
    await prisma.systemSetting.upsert({ where: { key: "lava_shop_id" }, create: { key: "lava_shop_id", value: val }, update: { value: val } });
  }
  if (updates.lavaSecretKey !== undefined) {
    const val = updates.lavaSecretKey ?? "";
    await prisma.systemSetting.upsert({ where: { key: "lava_secret_key" }, create: { key: "lava_secret_key", value: val }, update: { value: val } });
  }
  if (updates.lavaAdditionalKey !== undefined) {
    const val = updates.lavaAdditionalKey ?? "";
    await prisma.systemSetting.upsert({ where: { key: "lava_additional_key" }, create: { key: "lava_additional_key", value: val }, update: { value: val } });
  }
  if (updates.lavatopApiKey !== undefined) {
    const val = updates.lavatopApiKey ?? "";
    await prisma.systemSetting.upsert({ where: { key: "lavatop_api_key" }, create: { key: "lavatop_api_key", value: val }, update: { value: val } });
  }
  if (updates.lavatopDefaultOfferId !== undefined) {
    const val = updates.lavatopDefaultOfferId ?? "";
    await prisma.systemSetting.upsert({ where: { key: "lavatop_default_offer_id" }, create: { key: "lavatop_default_offer_id", value: val }, update: { value: val } });
  }
  if (updates.botWelcomeEnabled !== undefined) {
    const val = updates.botWelcomeEnabled ? "true" : "false";
    await prisma.systemSetting.upsert({ where: { key: "bot_welcome_enabled" }, create: { key: "bot_welcome_enabled", value: val }, update: { value: val } });
  }
  if (updates.botWelcomeText !== undefined) {
    const val = updates.botWelcomeText ?? "";
    await prisma.systemSetting.upsert({ where: { key: "bot_welcome_text" }, create: { key: "bot_welcome_text", value: val }, update: { value: val } });
  }
  if (updates.botWelcomeImage !== undefined) {
    const val = updates.botWelcomeImage ?? "";
    await prisma.systemSetting.upsert({ where: { key: "bot_welcome_image" }, create: { key: "bot_welcome_image", value: val }, update: { value: val } });
  }
  if (updates.botWelcomeShowOnce !== undefined) {
    const val = updates.botWelcomeShowOnce ? "true" : "false";
    await prisma.systemSetting.upsert({ where: { key: "bot_welcome_show_once" }, create: { key: "bot_welcome_show_once", value: val }, update: { value: val } });
  }
  if (updates.overpayApiUrl !== undefined) {
    const val = updates.overpayApiUrl ?? "";
    await prisma.systemSetting.upsert({ where: { key: "overpay_api_url" }, create: { key: "overpay_api_url", value: val }, update: { value: val } });
  }
  if (updates.overpayProjectId !== undefined) {
    const val = updates.overpayProjectId ?? "";
    await prisma.systemSetting.upsert({ where: { key: "overpay_project_id" }, create: { key: "overpay_project_id", value: val }, update: { value: val } });
  }
  if (updates.overpayLogin !== undefined) {
    const val = updates.overpayLogin ?? "";
    await prisma.systemSetting.upsert({ where: { key: "overpay_login" }, create: { key: "overpay_login", value: val }, update: { value: val } });
  }
  if (updates.overpayPassword !== undefined) {
    const val = updates.overpayPassword ?? "";
    await prisma.systemSetting.upsert({ where: { key: "overpay_password" }, create: { key: "overpay_password", value: val }, update: { value: val } });
  }
  if (updates.groqApiKey !== undefined) {
    const val = updates.groqApiKey ?? "";
    await prisma.systemSetting.upsert({ where: { key: "groq_api_key" }, create: { key: "groq_api_key", value: val }, update: { value: val } });
  }
  if (updates.groqModel !== undefined) {
    const val = updates.groqModel ?? "llama3-8b-8192";
    await prisma.systemSetting.upsert({ where: { key: "groq_model" }, create: { key: "groq_model", value: val }, update: { value: val } });
  }
  if (updates.groqFallback1 !== undefined) {
    const val = updates.groqFallback1 ?? "";
    await prisma.systemSetting.upsert({ where: { key: "groq_fallback_1" }, create: { key: "groq_fallback_1", value: val }, update: { value: val } });
  }
  if (updates.groqFallback2 !== undefined) {
    const val = updates.groqFallback2 ?? "";
    await prisma.systemSetting.upsert({ where: { key: "groq_fallback_2" }, create: { key: "groq_fallback_2", value: val }, update: { value: val } });
  }
  if (updates.groqFallback3 !== undefined) {
    const val = updates.groqFallback3 ?? "";
    await prisma.systemSetting.upsert({ where: { key: "groq_fallback_3" }, create: { key: "groq_fallback_3", value: val }, update: { value: val } });
  }
  if (updates.aiSystemPrompt !== undefined) {
    const val = updates.aiSystemPrompt ?? "";
    await prisma.systemSetting.upsert({ where: { key: "ai_system_prompt" }, create: { key: "ai_system_prompt", value: val }, update: { value: val } });
  }
  if (updates.botButtons !== undefined) {
    const val = updates.botButtons ?? "";
    await prisma.systemSetting.upsert({ where: { key: "bot_buttons" }, create: { key: "bot_buttons", value: val }, update: { value: val } });
  }
  if (updates.paymentDescription !== undefined) {
    const value = updates.paymentDescription;
    await prisma.systemSetting.upsert({ where: { key: "payment_description" }, create: { key: "payment_description", value }, update: { value } });
  }
  if (updates.botGroupCabinet !== undefined) {
    const value = String(updates.botGroupCabinet);
    await prisma.systemSetting.upsert({ where: { key: "bot_group_cabinet" }, create: { key: "bot_group_cabinet", value }, update: { value } });
  }
  if (updates.botMenuMode !== undefined) {
    const value = updates.botMenuMode;
    await prisma.systemSetting.upsert({ where: { key: "bot_menu_mode" }, create: { key: "bot_menu_mode", value }, update: { value } });
  }
  if (updates.botButtonsPerRow !== undefined) {
    const val = updates.botButtonsPerRow === 2 ? "2" : "1";
    await prisma.systemSetting.upsert({ where: { key: "bot_buttons_per_row" }, create: { key: "bot_buttons_per_row", value: val }, update: { value: val } });
  }
  if (updates.botEmojis !== undefined) {
    const raw = updates.botEmojis;
    const val =
      typeof raw === "string"
        ? raw
        : raw !== null && typeof raw === "object" && !Array.isArray(raw)
          ? JSON.stringify(raw)
          : "";
    await prisma.systemSetting.upsert({ where: { key: "bot_emojis" }, create: { key: "bot_emojis", value: val }, update: { value: val } });
  }
  if (updates.botBackLabel !== undefined) {
    const val = updates.botBackLabel ?? "";
    await prisma.systemSetting.upsert({ where: { key: "bot_back_label" }, create: { key: "bot_back_label", value: val }, update: { value: val } });
  }
  if (updates.botDevicesText !== undefined) {
    const val = updates.botDevicesText ?? "";
    await prisma.systemSetting.upsert({ where: { key: "bot_devices_text" }, create: { key: "bot_devices_text", value: val }, update: { value: val } });
  }
  if (updates.botMenuTexts !== undefined) {
    const val = updates.botMenuTexts ?? "";
    await prisma.systemSetting.upsert({ where: { key: "bot_menu_texts" }, create: { key: "bot_menu_texts", value: val }, update: { value: val } });
  }
  if (updates.botMenuLineVisibility !== undefined) {
    const raw = updates.botMenuLineVisibility;
    const val =
      typeof raw === "string"
        ? raw
        : raw !== null && typeof raw === "object" && !Array.isArray(raw)
          ? JSON.stringify(raw)
          : "";
    await prisma.systemSetting.upsert({
      where: { key: "bot_menu_line_visibility" },
      create: { key: "bot_menu_line_visibility", value: val },
      update: { value: val },
    });
  }
  if (updates.botInnerButtonStyles !== undefined) {
    const raw = updates.botInnerButtonStyles;
    const val =
      typeof raw === "string"
        ? raw
        : raw !== null && typeof raw === "object" && !Array.isArray(raw)
          ? JSON.stringify(raw)
          : "";
    await prisma.systemSetting.upsert({
      where: { key: "bot_inner_button_styles" },
      create: { key: "bot_inner_button_styles", value: val },
      update: { value: val },
    });
  }
  if (updates.botTariffsText !== undefined) {
    const val = updates.botTariffsText ?? "";
    await prisma.systemSetting.upsert({
      where: { key: "bot_tariffs_text" },
      create: { key: "bot_tariffs_text", value: val },
      update: { value: val },
    });
  }
  if (updates.botTariffsFields !== undefined) {
    const raw = updates.botTariffsFields;
    const val =
      typeof raw === "string"
        ? raw
        : raw !== null && typeof raw === "object" && !Array.isArray(raw)
          ? JSON.stringify(raw)
          : "";
    await prisma.systemSetting.upsert({
      where: { key: "bot_tariffs_fields" },
      create: { key: "bot_tariffs_fields", value: val },
      update: { value: val },
    });
  }
  if (updates.botPaymentText !== undefined) {
    const val = updates.botPaymentText ?? "";
    await prisma.systemSetting.upsert({
      where: { key: "bot_payment_text" },
      create: { key: "bot_payment_text", value: val },
      update: { value: val },
    });
  }
  if (updates.subscriptionPageConfig !== undefined) {
    const val = updates.subscriptionPageConfig ?? "";
    await prisma.systemSetting.upsert({
      where: { key: "subscription_page_config" },
      create: { key: "subscription_page_config", value: val },
      update: { value: val },
    });
  }
  if (updates.allowUserThemeChange !== undefined) {
    const val = updates.allowUserThemeChange ? "true" : "false";
    await prisma.systemSetting.upsert({ where: { key: "allow_user_theme_change" }, create: { key: "allow_user_theme_change", value: val }, update: { value: val } });
  }
  if (updates.themeMode !== undefined) {
    await prisma.systemSetting.upsert({
      where: { key: "theme_mode" },
      create: { key: "theme_mode", value: updates.themeMode },
      update: { value: updates.themeMode },
    });
  }
  if (updates.themeAccent !== undefined) {
    await prisma.systemSetting.upsert({
      where: { key: "theme_accent" },
      create: { key: "theme_accent", value: updates.themeAccent },
      update: { value: updates.themeAccent },
    });
  }
  for (const [key, settingKey] of [
    ["supportLink", "support_link"],
    ["agreementLink", "agreement_link"],
    ["offerLink", "offer_link"],
    ["instructionsLink", "instructions_link"],
    // T-ref-instructions (27.05.2026) — ссылка инструкции рефералки.
    ["referralInstructionsUrl", "referral_instructions_url"],
    // T11+T13+T14 (11.05.2026) — кастомизация бота.
    ["refundLink", "refund_link"],
    ["supportHoursFrom", "support_hours_from"],
    ["supportHoursTo", "support_hours_to"],
    ["tgProxyText", "tg_proxy_text"],
    ["tgProxyUrlPrimary", "tg_proxy_url_primary"],
    ["tgProxyUrlBackup", "tg_proxy_url_backup"],
    // JSON-массив прокси-серверов (см. tgProxyServers выше).
    ["tgProxyServers", "tg_proxy_servers"],
    ["reissueWarningText", "reissue_warning_text"],
    ["installSecondDeviceText", "install_second_device_text"],
    ["helpIntroText", "help_intro_text"],
  ] as const) {
    if (updates[key] !== undefined) {
      const val = updates[key] ?? "";
      await prisma.systemSetting.upsert({
        where: { key: settingKey },
        create: { key: settingKey, value: String(val).trim() },
        update: { value: String(val).trim() },
      });
    }
  }
  if (updates.ticketsEnabled !== undefined) {
    const val = updates.ticketsEnabled ? "true" : "false";
    await prisma.systemSetting.upsert({ where: { key: "tickets_enabled" }, create: { key: "tickets_enabled", value: val }, update: { value: val } });
  }
  if (updates.forceSubscribeEnabled !== undefined) {
    const val = updates.forceSubscribeEnabled ? "true" : "false";
    await prisma.systemSetting.upsert({ where: { key: "force_subscribe_enabled" }, create: { key: "force_subscribe_enabled", value: val }, update: { value: val } });
  }
  if (updates.forceSubscribeChannelId !== undefined) {
    const val = (updates.forceSubscribeChannelId ?? "").trim();
    await prisma.systemSetting.upsert({ where: { key: "force_subscribe_channel_id" }, create: { key: "force_subscribe_channel_id", value: val }, update: { value: val } });
  }
  if (updates.forceSubscribeMessage !== undefined) {
    const val = (updates.forceSubscribeMessage ?? "").trim();
    await prisma.systemSetting.upsert({ where: { key: "force_subscribe_message" }, create: { key: "force_subscribe_message", value: val }, update: { value: val } });
  }
  if (updates.blacklistEnabled !== undefined) {
    const val = updates.blacklistEnabled ? "true" : "false";
    await prisma.systemSetting.upsert({ where: { key: "blacklist_enabled" }, create: { key: "blacklist_enabled", value: val }, update: { value: val } });
  }
  if (updates.sellOptionsEnabled !== undefined) {
    const val = updates.sellOptionsEnabled ? "true" : "false";
    await prisma.systemSetting.upsert({ where: { key: "sell_options_enabled" }, create: { key: "sell_options_enabled", value: val }, update: { value: val } });
  }
  if (updates.sellOptionsTrafficEnabled !== undefined) {
    const val = updates.sellOptionsTrafficEnabled ? "true" : "false";
    await prisma.systemSetting.upsert({ where: { key: "sell_options_traffic_enabled" }, create: { key: "sell_options_traffic_enabled", value: val }, update: { value: val } });
  }
  if (updates.sellOptionsTrafficProducts !== undefined) {
    const val = typeof updates.sellOptionsTrafficProducts === "string" ? updates.sellOptionsTrafficProducts : (updates.sellOptionsTrafficProducts == null ? "" : JSON.stringify(updates.sellOptionsTrafficProducts));
    await prisma.systemSetting.upsert({ where: { key: "sell_options_traffic_products" }, create: { key: "sell_options_traffic_products", value: val }, update: { value: val } });
  }
  if (updates.sellOptionsDevicesEnabled !== undefined) {
    const val = updates.sellOptionsDevicesEnabled ? "true" : "false";
    await prisma.systemSetting.upsert({ where: { key: "sell_options_devices_enabled" }, create: { key: "sell_options_devices_enabled", value: val }, update: { value: val } });
  }
  if (updates.sellOptionsDevicesProducts !== undefined) {
    const val = typeof updates.sellOptionsDevicesProducts === "string" ? updates.sellOptionsDevicesProducts : (updates.sellOptionsDevicesProducts == null ? "" : JSON.stringify(updates.sellOptionsDevicesProducts));
    await prisma.systemSetting.upsert({ where: { key: "sell_options_devices_products" }, create: { key: "sell_options_devices_products", value: val }, update: { value: val } });
  }
  if (updates.sellOptionsServersEnabled !== undefined) {
    const val = updates.sellOptionsServersEnabled ? "true" : "false";
    await prisma.systemSetting.upsert({ where: { key: "sell_options_servers_enabled" }, create: { key: "sell_options_servers_enabled", value: val }, update: { value: val } });
  }
  if (updates.sellOptionsServersProducts !== undefined) {
    const val = typeof updates.sellOptionsServersProducts === "string" ? updates.sellOptionsServersProducts : (updates.sellOptionsServersProducts == null ? "" : JSON.stringify(updates.sellOptionsServersProducts));
    await prisma.systemSetting.upsert({ where: { key: "sell_options_servers_products" }, create: { key: "sell_options_servers_products", value: val }, update: { value: val } });
  }
  if (updates.googleAnalyticsId !== undefined) {
    await prisma.systemSetting.upsert({ where: { key: "google_analytics_id" }, create: { key: "google_analytics_id", value: updates.googleAnalyticsId ?? "" }, update: { value: updates.googleAnalyticsId ?? "" } });
  }
  if (updates.yandexMetrikaId !== undefined) {
    await prisma.systemSetting.upsert({ where: { key: "yandex_metrika_id" }, create: { key: "yandex_metrika_id", value: updates.yandexMetrikaId ?? "" }, update: { value: updates.yandexMetrikaId ?? "" } });
  }
  if (updates.autoBroadcastCron !== undefined) {
    const val = updates.autoBroadcastCron ?? "";
    await prisma.systemSetting.upsert({
      where: { key: "auto_broadcast_cron" },
      create: { key: "auto_broadcast_cron", value: val },
      update: { value: val },
    });
    const { restartAutoBroadcastScheduler } = await import("../auto-broadcast/auto-broadcast-scheduler.js");
    await restartAutoBroadcastScheduler();
  }
  if (updates.adminFrontNotificationsEnabled !== undefined) {
    const val = updates.adminFrontNotificationsEnabled ? "true" : "false";
    await prisma.systemSetting.upsert({
      where: { key: "admin_front_notifications_enabled" },
      create: { key: "admin_front_notifications_enabled", value: val },
      update: { value: val },
    });
  }
  if (updates.skipEmailVerification !== undefined) {
    const val = updates.skipEmailVerification ? "true" : "false";
    await prisma.systemSetting.upsert({
      where: { key: "skip_email_verification" },
      create: { key: "skip_email_verification", value: val },
      update: { value: val },
    });
  }
  if (updates.passwordResetEnabled !== undefined) {
    const val = updates.passwordResetEnabled ? "true" : "false";
    await prisma.systemSetting.upsert({
      where: { key: "password_reset_enabled" },
      create: { key: "password_reset_enabled", value: val },
      update: { value: val },
    });
  }
  if (updates.onboardingEmailRequired !== undefined) {
    const val = updates.onboardingEmailRequired ? "true" : "false";
    await prisma.systemSetting.upsert({
      where: { key: "onboarding_email_required" },
      create: { key: "onboarding_email_required", value: val },
      update: { value: val },
    });
  }
  if (updates.stealthAccent !== undefined) {
    const val = updates.stealthAccent ?? "";
    await prisma.systemSetting.upsert({
      where: { key: "stealth_accent" },
      create: { key: "stealth_accent", value: val },
      update: { value: val },
    });
  }
  if (updates.stealthHeroImage !== undefined) {
    const val = updates.stealthHeroImage ?? "";
    await prisma.systemSetting.upsert({
      where: { key: "stealth_hero_image" },
      create: { key: "stealth_hero_image", value: val },
      update: { value: val },
    });
  }
  if (updates.multiSubscriptionsEnabled !== undefined) {
    const val = updates.multiSubscriptionsEnabled ? "true" : "false";
    await prisma.systemSetting.upsert({
      where: { key: "multi_subscriptions_enabled" },
      create: { key: "multi_subscriptions_enabled", value: val },
      update: { value: val },
    });
  }
  // заявки на вывод: вкл/выкл + мин. сумма.
  if (updates.withdrawalsEnabled !== undefined) {
    const val = updates.withdrawalsEnabled ? "true" : "false";
    await prisma.systemSetting.upsert({
      where: { key: "withdrawals_enabled" },
      create: { key: "withdrawals_enabled", value: val },
      update: { value: val },
    });
  }
  if (updates.withdrawalMinAmount !== undefined) {
    const val = String(updates.withdrawalMinAmount);
    await prisma.systemSetting.upsert({
      where: { key: "withdrawal_min_amount" },
      create: { key: "withdrawal_min_amount", value: val },
      update: { value: val },
    });
  }
  if (updates.withdrawalMethods !== undefined) {
    const enabled = new Set(updates.withdrawalMethods);
    for (const method of ["sbp", "card", "usdt"] as const) {
      const key = `withdrawal_methods_${method}`;
      const val = enabled.has(method) ? "true" : "false";
      await prisma.systemSetting.upsert({
        where: { key },
        create: { key, value: val },
        update: { value: val },
      });
    }
  }
  for (const [key, value] of [
    ["withdrawal_methods_sbp", updates.withdrawalMethodsSbp],
    ["withdrawal_methods_card", updates.withdrawalMethodsCard],
    ["withdrawal_methods_usdt", updates.withdrawalMethodsUsdt],
  ] as const) {
    if (value === undefined) continue;
    const val = value ? "true" : "false";
    await prisma.systemSetting.upsert({
      where: { key },
      create: { key, value: val },
      update: { value: val },
    });
  }
  // Антибот-защита регистраций
  if (updates.signupProtectionEnabled !== undefined) {
    const val = updates.signupProtectionEnabled ? "true" : "false";
    await prisma.systemSetting.upsert({
      where: { key: "signup_protection_enabled" },
      create: { key: "signup_protection_enabled", value: val },
      update: { value: val },
    });
  }
  if (updates.emailDomainBlocklist !== undefined) {
    await prisma.systemSetting.upsert({
      where: { key: "email_domain_blocklist" },
      create: { key: "email_domain_blocklist", value: updates.emailDomainBlocklist ?? "" },
      update: { value: updates.emailDomainBlocklist ?? "" },
    });
  }
  if (updates.emailPatternBlocklist !== undefined) {
    await prisma.systemSetting.upsert({
      where: { key: "email_pattern_blocklist" },
      create: { key: "email_pattern_blocklist", value: updates.emailPatternBlocklist ?? "" },
      update: { value: updates.emailPatternBlocklist ?? "" },
    });
  }
  if (updates.signupMaxPerIpPerHour !== undefined) {
    const val = String(Math.max(1, updates.signupMaxPerIpPerHour));
    await prisma.systemSetting.upsert({
      where: { key: "signup_max_per_ip_per_hour" },
      create: { key: "signup_max_per_ip_per_hour", value: val },
      update: { value: val },
    });
  }
  if (updates.happCryptEnabled !== undefined) {
    const val = updates.happCryptEnabled ? "true" : "false";
    await prisma.systemSetting.upsert({
      where: { key: "happ_crypt_enabled" },
      create: { key: "happ_crypt_enabled", value: val },
      update: { value: val },
    });
  }
  if (updates.useRemnaSubscriptionPage !== undefined) {
    const val = updates.useRemnaSubscriptionPage ? "true" : "false";
    await prisma.systemSetting.upsert({
      where: { key: "use_remna_subscription_page" },
      create: { key: "use_remna_subscription_page", value: val },
      update: { value: val },
    });
  }
  if (updates.aiChatEnabled !== undefined) {
    const val = updates.aiChatEnabled ? "true" : "false";
    await prisma.systemSetting.upsert({
      where: { key: "ai_chat_enabled" },
      create: { key: "ai_chat_enabled", value: val },
      update: { value: val },
    });
  }
  if (updates.defaultAutoRenewEnabled !== undefined) {
    const val = updates.defaultAutoRenewEnabled ? "true" : "false";
    await prisma.systemSetting.upsert({
      where: { key: "default_auto_renew_enabled" },
      create: { key: "default_auto_renew_enabled", value: val },
      update: { value: val },
    });
  }
  // Auto-renewal numeric settings
  const autoRenewNumericKeys: [keyof typeof updates, string][] = [
    ["autoRenewDaysBeforeExpiry", "auto_renew_days_before_expiry"],
    ["autoRenewNotifyDaysBefore", "auto_renew_notify_days_before"],
    ["autoRenewGracePeriodDays", "auto_renew_grace_period_days"],
    ["autoRenewMaxRetries", "auto_renew_max_retries"],
  ];
  for (const [key, dbKey] of autoRenewNumericKeys) {
    const v = updates[key];
    if (v === undefined) continue;
    const val = String(v);
    await prisma.systemSetting.upsert({
      where: { key: dbKey },
      create: { key: dbKey, value: val },
      update: { value: val },
    });
  }
  // YooKassa recurring payments toggle
  if (updates.yookassaRecurringEnabled !== undefined) {
    const val = updates.yookassaRecurringEnabled ? "true" : "false";
    await prisma.systemSetting.upsert({
      where: { key: "yookassa_recurring_enabled" },
      create: { key: "yookassa_recurring_enabled", value: val },
      update: { value: val },
    });
  }
  const cbKeys: [keyof typeof updates, string][] = [
    ["customBuildEnabled", "custom_build_enabled"],
    ["customBuildPricePerDay", "custom_build_price_per_day"],
    ["customBuildPricePerDevice", "custom_build_price_per_device"],
    ["customBuildTrafficMode", "custom_build_traffic_mode"],
    ["customBuildPricePerGb", "custom_build_price_per_gb"],
    ["customBuildSquadUuid", "custom_build_squad_uuid"],
    ["customBuildCurrency", "custom_build_currency"],
    ["customBuildMaxDays", "custom_build_max_days"],
    ["customBuildMaxDevices", "custom_build_max_devices"],
  ];
  for (const [key, dbKey] of cbKeys) {
    const v = updates[key];
    if (v === undefined) continue;
    const val = typeof v === "boolean" ? (v ? "true" : "false") : (v === null ? "" : String(v));
    await prisma.systemSetting.upsert({
      where: { key: dbKey },
      create: { key: dbKey, value: val },
      update: { value: val },
    });
  }
  const oauthKeys: [keyof typeof updates, string][] = [
    ["googleLoginEnabled", "google_login_enabled"],
    ["googleClientId", "google_client_id"],
    ["googleClientSecret", "google_client_secret"],
    ["appleLoginEnabled", "apple_login_enabled"],
    ["appleClientId", "apple_client_id"],
    ["appleTeamId", "apple_team_id"],
    ["appleKeyId", "apple_key_id"],
    ["applePrivateKey", "apple_private_key"],
  ];
  for (const [key, dbKey] of oauthKeys) {
    const v = updates[key];
    if (v === undefined) continue;
    const val = typeof v === "boolean" ? (v ? "true" : "false") : (v === null ? "" : String(v));
    await prisma.systemSetting.upsert({
      where: { key: dbKey },
      create: { key: dbKey, value: val },
      update: { value: val },
    });
  }
  const landingKeys: [keyof typeof updates, string][] = [
    ["landingEnabled", "landing_enabled"],
    ["landingHeroTitle", "landing_hero_title"],
    ["landingHeroSubtitle", "landing_hero_subtitle"],
    ["landingHeroCtaText", "landing_hero_cta_text"],
    ["landingShowTariffs", "landing_show_tariffs"],
    ["landingContacts", "landing_contacts"],
    ["landingOfferLink", "landing_offer_link"],
    ["landingPrivacyLink", "landing_privacy_link"],
    ["landingFooterText", "landing_footer_text"],
    ["landingHeroBadge", "landing_hero_badge"],
    ["landingHeroHint", "landing_hero_hint"],
    ["landingFeature1Label", "landing_feature_1_label"],
    ["landingFeature1Sub", "landing_feature_1_sub"],
    ["landingFeature2Label", "landing_feature_2_label"],
    ["landingFeature2Sub", "landing_feature_2_sub"],
    ["landingFeature3Label", "landing_feature_3_label"],
    ["landingFeature3Sub", "landing_feature_3_sub"],
    ["landingFeature4Label", "landing_feature_4_label"],
    ["landingFeature4Sub", "landing_feature_4_sub"],
    ["landingFeature5Label", "landing_feature_5_label"],
    ["landingFeature5Sub", "landing_feature_5_sub"],
    ["landingBenefitsTitle", "landing_benefits_title"],
    ["landingBenefitsSubtitle", "landing_benefits_subtitle"],
    ["landingBenefit1Title", "landing_benefit_1_title"],
    ["landingBenefit1Desc", "landing_benefit_1_desc"],
    ["landingBenefit2Title", "landing_benefit_2_title"],
    ["landingBenefit2Desc", "landing_benefit_2_desc"],
    ["landingBenefit3Title", "landing_benefit_3_title"],
    ["landingBenefit3Desc", "landing_benefit_3_desc"],
    ["landingBenefit4Title", "landing_benefit_4_title"],
    ["landingBenefit4Desc", "landing_benefit_4_desc"],
    ["landingBenefit5Title", "landing_benefit_5_title"],
    ["landingBenefit5Desc", "landing_benefit_5_desc"],
    ["landingBenefit6Title", "landing_benefit_6_title"],
    ["landingBenefit6Desc", "landing_benefit_6_desc"],
    ["landingTariffsTitle", "landing_tariffs_title"],
    ["landingTariffsSubtitle", "landing_tariffs_subtitle"],
    ["landingDevicesTitle", "landing_devices_title"],
    ["landingDevicesSubtitle", "landing_devices_subtitle"],
    ["landingFaqTitle", "landing_faq_title"],
    ["landingFaqJson", "landing_faq_json"],
    ["landingHeroHeadline1", "landing_hero_headline_1"],
    ["landingHeroHeadline2", "landing_hero_headline_2"],
    ["landingHeaderBadge", "landing_header_badge"],
    ["landingButtonLogin", "landing_button_login"],
    ["landingButtonLoginCabinet", "landing_button_login_cabinet"],
    ["landingNavBenefits", "landing_nav_benefits"],
    ["landingNavTariffs", "landing_nav_tariffs"],
    ["landingNavDevices", "landing_nav_devices"],
    ["landingNavFaq", "landing_nav_faq"],
    ["landingBenefitsBadge", "landing_benefits_badge"],
    ["landingDefaultPaymentText", "landing_default_payment_text"],
    ["landingButtonChooseTariff", "landing_button_choose_tariff"],
    ["landingNoTariffsMessage", "landing_no_tariffs_message"],
    ["landingButtonWatchTariffs", "landing_button_watch_tariffs"],
    ["landingButtonStart", "landing_button_start"],
    ["landingButtonOpenCabinet", "landing_button_open_cabinet"],
    ["landingJourneyStepsJson", "landing_journey_steps_json"],
    ["landingSignalCardsJson", "landing_signal_cards_json"],
    ["landingTrustPointsJson", "landing_trust_points_json"],
    ["landingExperiencePanelsJson", "landing_experience_panels_json"],
    ["landingDevicesListJson", "landing_devices_list_json"],
    ["landingQuickStartJson", "landing_quick_start_json"],
    ["landingInfraTitle", "landing_infra_title"],
    ["landingNetworkCockpitText", "landing_network_cockpit_text"],
    ["landingPulseTitle", "landing_pulse_title"],
    ["landingComfortTitle", "landing_comfort_title"],
    ["landingComfortBadge", "landing_comfort_badge"],
    ["landingPrinciplesTitle", "landing_principles_title"],
    ["landingTechTitle", "landing_tech_title"],
    ["landingTechDesc", "landing_tech_desc"],
    ["landingCategorySubtitle", "landing_category_subtitle"],
    ["landingTariffDefaultDesc", "landing_tariff_default_desc"],
    ["landingTariffBullet1", "landing_tariff_bullet_1"],
    ["landingTariffBullet2", "landing_tariff_bullet_2"],
    ["landingTariffBullet3", "landing_tariff_bullet_3"],
    ["landingLowestTariffDesc", "landing_lowest_tariff_desc"],
    ["landingDevicesCockpitText", "landing_devices_cockpit_text"],
    ["landingUniversalityTitle", "landing_universality_title"],
    ["landingUniversalityDesc", "landing_universality_desc"],
    ["landingQuickSetupTitle", "landing_quick_setup_title"],
    ["landingQuickSetupDesc", "landing_quick_setup_desc"],
    ["landingPremiumServiceTitle", "landing_premium_service_title"],
    ["landingPremiumServicePara1", "landing_premium_service_para1"],
    ["landingPremiumServicePara2", "landing_premium_service_para2"],
    ["landingHowItWorksTitle", "landing_how_it_works_title"],
    ["landingHowItWorksDesc", "landing_how_it_works_desc"],
    ["landingStatsPlatforms", "landing_stats_platforms"],
    ["landingStatsTariffsLabel", "landing_stats_tariffs_label"],
    ["landingStatsAccessLabel", "landing_stats_access_label"],
    ["landingStatsPaymentMethods", "landing_stats_payment_methods"],
    ["landingReadyToConnectEyebrow", "landing_ready_to_connect_eyebrow"],
    ["landingReadyToConnectTitle", "landing_ready_to_connect_title"],
    ["landingReadyToConnectDesc", "landing_ready_to_connect_desc"],
    ["landingShowFeatures", "landing_show_features"],
    ["landingShowBenefits", "landing_show_benefits"],
    ["landingShowDevices", "landing_show_devices"],
    ["landingShowFaq", "landing_show_faq"],
    ["landingShowHowItWorks", "landing_show_how_it_works"],
    ["landingShowCta", "landing_show_cta"],
  ];
  for (const [key, dbKey] of landingKeys) {
    const v = updates[key];
    if (v === undefined) continue;
    const val = typeof v === "boolean" ? (v ? "true" : "false") : (v === null ? "" : String(v));
    await prisma.systemSetting.upsert({
      where: { key: dbKey },
      create: { key: dbKey, value: val },
      update: { value: val },
    });
  }
  const proxyKeys: [keyof typeof updates, string][] = [
    ["proxyEnabled", "proxy_enabled"],
    ["proxyUrl", "proxy_url"],
    ["proxyTelegram", "proxy_telegram"],
    ["proxyPayments", "proxy_payments"],
    ["proxyAi", "proxy_ai"],
  ];
  for (const [key, dbKey] of proxyKeys) {
    const v = updates[key];
    if (v === undefined) continue;
    const val = typeof v === "boolean" ? (v ? "true" : "false") : (v === null ? "" : String(v));
    await prisma.systemSetting.upsert({
      where: { key: dbKey },
      create: { key: dbKey, value: val },
      update: { value: val },
    });
  }
  const giftKeys: [keyof typeof updates, string][] = [
    ["liteMode", "lite_mode"],
    ["giftSubscriptionsEnabled", "gift_subscriptions_enabled"],
    ["giftCodeExpiryHours", "gift_code_expiry_hours"],
    ["maxAdditionalSubscriptions", "max_additional_subscriptions"],
    ["giftCodeFormatLength", "gift_code_format_length"],
    ["giftRateLimitPerMinute", "gift_rate_limit_per_minute"],
    ["giftExpiryNotificationDays", "gift_expiry_notification_days"],
    ["giftReferralEnabled", "gift_referral_enabled"],
    ["giftMessageMaxLength", "gift_message_max_length"],
    ["botAutoDeleteUnknownMessages", "bot_auto_delete_unknown_messages"],
    ["botInfoBlock", "bot_info_block"],
    // тогглы кнопок на экране «Тарифы» бота
    ["botTariffsShowExtraDevicesButton", "bot_tariffs_show_extra_devices_button"],
    ["botTariffsShowBalanceButton", "bot_tariffs_show_balance_button"],
    ["botShowTariffCategories", "bot_show_tariff_categories"],
    ["botHtmlBubblesTest", "bot_htmlbubbles_test"],
  ];
  for (const [key, dbKey] of giftKeys) {
    const v = updates[key];
    if (v === undefined) continue;
    const val = v === null ? "" : typeof v === "boolean" ? (v ? "true" : "false") : String(v);
    await prisma.systemSetting.upsert({
      where: { key: dbKey },
      create: { key: dbKey, value: val },
      update: { value: val },
    });
  }
  // invalidate cache до возврата свежего config'а.
  invalidateSystemConfigCache();
  const config = await getSystemConfig();
  return res.json({ ...config, cispayApiKey: config.cispayApiKey ? "********" : "", botWebhookSecret: config.botWebhookSecret ? "********" : "", cloudpaymentsApiSecret: config.cloudpaymentsApiSecret ? "********" : "" });
});

/** Сброс всех текстов лендинга на исходные (из кода). Очищает значения в БД — фронт подставит дефолты. */
const LANDING_TEXT_DB_KEYS = [
  "landing_hero_title", "landing_hero_subtitle", "landing_hero_cta_text", "landing_contacts", "landing_offer_link",
  "landing_privacy_link", "landing_footer_text", "landing_hero_badge", "landing_hero_hint",
  "landing_feature_1_label", "landing_feature_1_sub", "landing_feature_2_label", "landing_feature_2_sub",
  "landing_feature_3_label", "landing_feature_3_sub", "landing_feature_4_label", "landing_feature_4_sub",
  "landing_feature_5_label", "landing_feature_5_sub", "landing_benefits_title", "landing_benefits_subtitle",
  "landing_benefit_1_title", "landing_benefit_1_desc", "landing_benefit_2_title", "landing_benefit_2_desc",
  "landing_benefit_3_title", "landing_benefit_3_desc", "landing_benefit_4_title", "landing_benefit_4_desc",
  "landing_benefit_5_title", "landing_benefit_5_desc", "landing_benefit_6_title", "landing_benefit_6_desc",
  "landing_tariffs_title", "landing_tariffs_subtitle", "landing_devices_title", "landing_devices_subtitle",
  "landing_faq_title", "landing_faq_json", "landing_hero_headline_1", "landing_hero_headline_2",
  "landing_header_badge", "landing_button_login", "landing_button_login_cabinet", "landing_nav_benefits",
  "landing_nav_tariffs", "landing_nav_devices", "landing_nav_faq", "landing_benefits_badge",
  "landing_default_payment_text", "landing_button_choose_tariff", "landing_no_tariffs_message",
  "landing_button_watch_tariffs", "landing_button_start", "landing_button_open_cabinet",
  "landing_journey_steps_json", "landing_signal_cards_json", "landing_trust_points_json",
  "landing_experience_panels_json", "landing_devices_list_json", "landing_quick_start_json",
  "landing_infra_title", "landing_network_cockpit_text", "landing_pulse_title", "landing_comfort_title",
  "landing_comfort_badge", "landing_principles_title", "landing_tech_title", "landing_tech_desc",
  "landing_category_subtitle", "landing_tariff_default_desc", "landing_tariff_bullet_1", "landing_tariff_bullet_2",
  "landing_tariff_bullet_3", "landing_lowest_tariff_desc", "landing_devices_cockpit_text",
  "landing_universality_title", "landing_universality_desc", "landing_quick_setup_title", "landing_quick_setup_desc",
  "landing_premium_service_title", "landing_premium_service_para1", "landing_premium_service_para2",
  "landing_how_it_works_title", "landing_how_it_works_desc",   "landing_stats_platforms",
  "landing_stats_tariffs_label", "landing_stats_access_label", "landing_stats_payment_methods",
  "landing_ready_to_connect_eyebrow", "landing_ready_to_connect_title", "landing_ready_to_connect_desc",
];
adminRouter.post("/settings/reset-landing-text", asyncRoute(async (req, res) => {
  for (const dbKey of LANDING_TEXT_DB_KEYS) {
    await prisma.systemSetting.upsert({
      where: { key: dbKey },
      create: { key: dbKey, value: "" },
      update: { value: "" },
    });
  }
  const config = await getSystemConfig();
  return res.json({ ...config, cispayApiKey: config.cispayApiKey ? "********" : "", botWebhookSecret: config.botWebhookSecret ? "********" : "", cloudpaymentsApiSecret: config.cloudpaymentsApiSecret ? "********" : "" });
}));

adminRouter.use("/tickets", adminTicketsRouter);

// Синхронизация с Remna
adminRouter.post("/sync/from-remna", async (_req, res) => {
  try {
    const result = await syncFromRemna();
    // T-remna-mirror: следом переносим в нашу БД состояние подписок
    // (даты, статус, трафик) — чтобы данные не жили только в Remnawave.
    const mirror = await syncSubscriptionsMirror().catch((e) => ({
      ok: false, updated: 0, missing: 0,
      errors: [e instanceof Error ? e.message : String(e)],
    }));
    return res.json({ ...result, mirror });
  } catch (e) {
    console.error("Sync from Remna error:", e);
    return res.status(500).json({
      ok: false,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [e instanceof Error ? e.message : String(e)],
    });
  }
});

adminRouter.post("/sync/to-remna", async (_req, res) => {
  try {
    const result = await syncToRemna();
    return res.json(result);
  } catch (e) {
    console.error("Sync to Remna error:", e);
    return res.status(500).json({
      ok: false,
      updated: 0,
      errors: [e instanceof Error ? e.message : String(e)],
    });
  }
});

/** Создать в Remna пользователей для клиентов без remnawaveUuid (привязка «отстающих»). */
adminRouter.post("/sync/create-remna-for-missing", async (_req, res) => {
  try {
    const result = await createRemnaUsersForClientsWithoutUuid();
    return res.json(result);
  } catch (e) {
    console.error("Create Remna for missing error:", e);
    return res.status(500).json({
      ok: false,
      created: 0,
      linked: 0,
      errors: [e instanceof Error ? e.message : String(e)],
    });
  }
});

adminRouter.use("/broadcast", adminBroadcastRouter);
adminRouter.use("/auto-broadcast", adminAutoBroadcastRouter);

adminRouter.use("/promo-groups", adminPromoGroupsRouter);
adminRouter.use("/promo-codes", adminPromoCodesRouter);

adminRouter.use("/analytics", adminAnalyticsRouter);

// ═══════════════════════════════════════════════════════════════
//  ОТЧЁТЫ ПРОДАЖ
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
//  АВТО-БЭКАП — ручной запуск
// ═══════════════════════════════════════════════════════════════

adminRouter.post("/backup/send-to-telegram", asyncRoute(async (_req, res) => {
  const { runAutoBackup } = await import("../backup/auto-backup.scheduler.js");
  try {
    await runAutoBackup({ force: true });
    return res.json({ ok: true, message: "Бэкап создан и отправлен в Telegram" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(500).json({ ok: false, message: msg });
  }
}));

// ═══════════════════════════════════════════════════════════════
//  ВИДЕО-ИНСТРУКЦИИ
// ═══════════════════════════════════════════════════════════════

adminRouter.get("/video-instructions", async (_req, res) => {
  const [enabledRow, dataRow] = await Promise.all([
    prisma.systemSetting.findUnique({ where: { key: "video_instructions_enabled" } }),
    prisma.systemSetting.findUnique({ where: { key: "video_instructions" } }),
  ]);
  let items: { id: string; title: string; telegramFileId: string; sortOrder: number }[] = [];
  try { items = JSON.parse(dataRow?.value || "[]"); } catch { /* empty */ }
  return res.json({ enabled: enabledRow?.value === "true", items });
});

adminRouter.put("/video-instructions/toggle", async (req, res) => {
  const enabled = req.body.enabled === true;
  await prisma.systemSetting.upsert({
    where: { key: "video_instructions_enabled" },
    create: { key: "video_instructions_enabled", value: enabled ? "true" : "false" },
    update: { value: enabled ? "true" : "false" },
  });
  return res.json({ ok: true, enabled });
});

adminRouter.post("/video-instructions", async (req, res) => {
  const { title, telegramFileId } = req.body;
  if (!title || !telegramFileId) return res.status(400).json({ error: "title and telegramFileId required" });

  const row = await prisma.systemSetting.findUnique({ where: { key: "video_instructions" } });
  let items: { id: string; title: string; telegramFileId: string; sortOrder: number }[] = [];
  try { items = JSON.parse(row?.value || "[]"); } catch { /* empty */ }

  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const sortOrder = items.length > 0 ? Math.max(...items.map((i) => i.sortOrder)) + 1 : 0;
  items.push({ id, title: String(title).trim(), telegramFileId: String(telegramFileId).trim(), sortOrder });

  await prisma.systemSetting.upsert({
    where: { key: "video_instructions" },
    create: { key: "video_instructions", value: JSON.stringify(items) },
    update: { value: JSON.stringify(items) },
  });
  return res.json({ ok: true, items });
});

adminRouter.put("/video-instructions/:id", async (req, res) => {
  const { id } = req.params;
  const { title, telegramFileId } = req.body;

  const row = await prisma.systemSetting.findUnique({ where: { key: "video_instructions" } });
  let items: { id: string; title: string; telegramFileId: string; sortOrder: number }[] = [];
  try { items = JSON.parse(row?.value || "[]"); } catch { /* empty */ }

  const idx = items.findIndex((i) => i.id === id);
  if (idx === -1) return res.status(404).json({ error: "not found" });

  if (title !== undefined) items[idx].title = String(title).trim();
  if (telegramFileId !== undefined) items[idx].telegramFileId = String(telegramFileId).trim();

  await prisma.systemSetting.upsert({
    where: { key: "video_instructions" },
    create: { key: "video_instructions", value: JSON.stringify(items) },
    update: { value: JSON.stringify(items) },
  });
  return res.json({ ok: true, items });
});

adminRouter.delete("/video-instructions/:id", async (req, res) => {
  const { id } = req.params;

  const row = await prisma.systemSetting.findUnique({ where: { key: "video_instructions" } });
  let items: { id: string; title: string; telegramFileId: string; sortOrder: number }[] = [];
  try { items = JSON.parse(row?.value || "[]"); } catch { /* empty */ }

  items = items.filter((i) => i.id !== id);

  await prisma.systemSetting.upsert({
    where: { key: "video_instructions" },
    create: { key: "video_instructions", value: JSON.stringify(items) },
    update: { value: JSON.stringify(items) },
  });
  return res.json({ ok: true, items });
});

adminRouter.put("/video-instructions/reorder", async (req, res) => {
  const { order } = req.body;
  if (!Array.isArray(order)) return res.status(400).json({ error: "order must be an array of ids" });

  const row = await prisma.systemSetting.findUnique({ where: { key: "video_instructions" } });
  let items: { id: string; title: string; telegramFileId: string; sortOrder: number }[] = [];
  try { items = JSON.parse(row?.value || "[]"); } catch { /* empty */ }

  const sorted: typeof items = [];
  for (let i = 0; i < order.length; i++) {
    const found = items.find((it) => it.id === order[i]);
    if (found) { found.sortOrder = i; sorted.push(found); }
  }
  for (const it of items) {
    if (!sorted.includes(it)) sorted.push(it);
  }

  await prisma.systemSetting.upsert({
    where: { key: "video_instructions" },
    create: { key: "video_instructions", value: JSON.stringify(sorted) },
    update: { value: JSON.stringify(sorted) },
  });
  return res.json({ ok: true, items: sorted });
});

adminRouter.get("/sales-report", async (req, res) => {
  const from = typeof req.query.from === "string" ? req.query.from : null;
  const to = typeof req.query.to === "string" ? req.query.to : null;
  const provider = typeof req.query.provider === "string" ? req.query.provider : null;
  const search = typeof req.query.search === "string" ? req.query.search.trim() : null;
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10) || 50));

  const where: Record<string, unknown> = {};
  if (status && status !== "all") {
    where.status = status;
  } else {
    where.status = "PAID";
  }
  if (from || to) {
    const paidAt: Record<string, Date> = {};
    if (from) paidAt.gte = new Date(from);
    if (to) paidAt.lte = new Date(to + "T23:59:59.999Z");
    where.paidAt = paidAt;
  }
  if (provider) where.provider = provider;
  if (search) {
    where.OR = [
      { orderId: { contains: search, mode: "insensitive" } },
      { client: { email: { contains: search, mode: "insensitive" } } },
      { client: { telegramUsername: { contains: search, mode: "insensitive" } } },
      { client: { telegramId: search } },
      { tariff: { name: { contains: search, mode: "insensitive" } } },
    ];
  }

  const [total, payments] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.findMany({
      where,
      orderBy: { paidAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        client: { select: { id: true, email: true, telegramId: true, telegramUsername: true } },
        tariff: { select: { id: true, name: true } },
      },
    }),
  ]);

  const agg = await prisma.payment.aggregate({ where, _sum: { amount: true }, _count: true });

  const byCurrency: Record<string, { sum: number; count: number }> = {};
  const byProvider: Record<string, number> = {};
  for (const p of payments) {
    const cur = p.currency ?? "RUB";
    if (!byCurrency[cur]) byCurrency[cur] = { sum: 0, count: 0 };
    byCurrency[cur].sum += p.amount;
    byCurrency[cur].count += 1;
    const prov = p.provider ?? "unknown";
    byProvider[prov] = (byProvider[prov] ?? 0) + 1;
  }

  return res.json({
    items: payments.map((p) => {
      let activationError: string | null = null;
      try {
        const meta = p.metadata ? (JSON.parse(p.metadata) as Record<string, unknown>) : null;
        if (typeof meta?.activationError === "string") activationError = meta.activationError;
      } catch { /* ignore malformed metadata */ }
      return {
        id: p.id,
        orderId: p.orderId,
        amount: p.amount,
        currency: p.currency,
        provider: p.provider ?? "unknown",
        status: p.status,
        tariffName: p.tariff?.name ?? null,
        tariffId: p.tariff?.id ?? null,
        clientId: p.client?.id ?? null,
        clientEmail: p.client?.email ?? null,
        clientTelegramId: p.client?.telegramId ?? null,
        clientTelegramUsername: p.client?.telegramUsername ?? null,
        paidAt: p.paidAt?.toISOString() ?? null,
        createdAt: p.createdAt.toISOString(),
        metadata: p.metadata,
        hasActivationError: p.status === "PAID" && !p.subscriptionId && Boolean(activationError),
        activationError,
      };
    }),
    total,
    page,
    limit,
    totalAmount: agg._sum.amount ?? 0,
    totalCount: agg._count,
    byCurrency,
    byProvider,
  });
});

/**
 * отчёт продаж только через баланс.
 * Доступ только для ADMIN или MANAGER с action `view_balance_sales`. Для менеджеров-девочек —
 * они видят только то, что реально оплачено через начисление баланса (provider=balance),
 * без всех остальных платёжек (карты/крипта/etc).
 *
 * Этот endpoint не пускает через requireAdminSection (т.к. секция `sales-report` могла быть
 * не выдана менеджеру), а проверяет action напрямую.
 */
adminRouter.get("/balance-sales", requireAction("view_balance_sales"), async (req, res) => {
  const from = typeof req.query.from === "string" ? req.query.from : null;
  const to = typeof req.query.to === "string" ? req.query.to : null;
  const search = typeof req.query.search === "string" ? req.query.search.trim() : null;
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10) || 50));

  const where: Record<string, unknown> = {
    status: "PAID",
    provider: "balance",
  };
  if (from || to) {
    const paidAt: Record<string, Date> = {};
    if (from) paidAt.gte = new Date(from);
    if (to) paidAt.lte = new Date(to + "T23:59:59.999Z");
    where.paidAt = paidAt;
  }
  if (search) {
    where.OR = [
      { client: { email: { contains: search, mode: "insensitive" } } },
      { client: { telegramUsername: { contains: search, mode: "insensitive" } } },
      { client: { telegramId: search } },
      { tariff: { name: { contains: search, mode: "insensitive" } } },
    ];
  }

  const [total, payments] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.findMany({
      where,
      orderBy: { paidAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        client: { select: { id: true, email: true, telegramId: true, telegramUsername: true } },
        tariff: { select: { id: true, name: true } },
      },
    }),
  ]);

  const agg = await prisma.payment.aggregate({ where, _sum: { amount: true }, _count: true });

  return res.json({
    items: payments.map((p) => ({
      id: p.id,
      amount: p.amount,
      currency: p.currency,
      tariffName: p.tariff?.name ?? null,
      clientId: p.client?.id ?? null,
      clientEmail: p.client?.email ?? null,
      clientTelegramId: p.client?.telegramId ?? null,
      clientTelegramUsername: p.client?.telegramUsername ?? null,
      paidAt: p.paidAt?.toISOString() ?? null,
    })),
    total,
    page,
    limit,
    totalAmount: agg._sum.amount ?? 0,
    totalCount: agg._count,
  });
});

adminRouter.delete("/sales-report/:paymentId", async (req, res) => {
  const { paymentId } = req.params;
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) return res.status(404).json({ error: "Платёж не найден" });
  await prisma.payment.delete({ where: { id: paymentId } });
  return res.json({ ok: true });
});

adminRouter.use("/admins", adminAdminsRouter);

adminRouter.use("/secondary-subscriptions", adminSecondarySubscriptionsRouter);

// ────── Gift Analytics ──────

adminRouter.get("/gift-analytics", asyncRoute(async (_req, res) => {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [
    totalSubscriptions,
    last30Days,
    activatedSelf,
    gifted,
    pendingCodes,
    expiredCodes,
    redeemedCodes,
    totalCodes,
  ] = await Promise.all([
    prisma.subscription.count(),
    prisma.subscription.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    prisma.subscription.count({ where: { OR: [{ giftStatus: null, giftedToClientId: null }, { giftStatus: "", giftedToClientId: null }, { giftStatus: "ACTIVATED_SELF" }] } }),
    prisma.subscription.count({ where: { giftedToClientId: { not: null } } }),
    prisma.giftCode.count({ where: { status: "ACTIVE" } }),
    prisma.giftCode.count({ where: { status: "EXPIRED" } }),
    prisma.giftCode.count({ where: { status: "REDEEMED" } }),
    prisma.giftCode.count(),
  ]);

  const conversionRate = totalCodes > 0
    ? Math.round((redeemedCodes / totalCodes) * 1000) / 10
    : 0;

  return res.json({
    totalSubscriptions,
    last30Days,
    activatedSelf,
    gifted,
    pendingCodes,
    expiredCodes,
    redeemedCodes,
    conversionRate,
  });
}));

// ────── Admin Gift Code Creation ──────

adminRouter.post("/gift-codes/create", asyncRoute(async (req, res) => {
  const schema = z.object({
    clientId: z.string().min(1),
    tariffId: z.string().min(1),
    giftMessage: z.string().max(200).optional(),
    durationDays: z.number().int().min(1).max(3650).optional(),
    trafficGb: z.number().min(0).max(1048576).optional(),
    notify: z.boolean().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Некорректные данные", errors: parsed.error.flatten().fieldErrors });
  }

  const { clientId, tariffId, giftMessage, durationDays, trafficGb, notify = true } = parsed.data;

  // Проверяем что клиент существует
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) {
    return res.status(404).json({ message: "Клиент не найден" });
  }

  // передаём adminId чтобы в админ-списке отображался конкретный менеджер.
  const adminIdForGift = (req as unknown as { adminId?: string }).adminId ?? null;
  // админ-override срока/трафика (GB → bytes; 0 = безлимит).
  const giftOverrides: { durationDays?: number; trafficLimitBytes?: bigint | null } = {};
  if (durationDays != null) giftOverrides.durationDays = durationDays;
  if (trafficGb != null) giftOverrides.trafficLimitBytes = trafficGb > 0 ? BigInt(Math.round(trafficGb * 1024 ** 3)) : BigInt(0);
  const result = await adminCreateGiftCode(clientId, tariffId, giftMessage, adminIdForGift, giftOverrides);
  if (!result.ok) {
    return res.status(result.status).json({ message: result.error });
  }

  // giftUrl считаем ВСЕГДА (нужен и в ответе админу, и для авто-уведомления).
  // Авто-сообщение клиенту шлём только если notify (по умолчанию true). Новая выдача «код в руки» → notify=false.
  let giftUrl: string | null = null;
  try {
    const cfg = await getSystemConfig();
    const botToken = (cfg.telegramBotToken || "").trim();
    if (botToken) {
      const meRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`)
        .then((r) => r.json() as Promise<{ ok: boolean; result?: { username?: string } }>)
        .catch(() => null);
      const botUsername = meRes?.result?.username ?? "bot";
      giftUrl = `https://t.me/${botUsername}?start=gift_${result.data.code}`;
      if (notify) {
        const fullClient = await prisma.client.findUnique({
          where: { id: clientId },
          select: { telegramId: true, telegramUsername: true },
        });
        if (fullClient?.telegramId) {
          const tariff = await prisma.tariff.findUnique({ where: { id: tariffId }, select: { name: true } });
          const customMessage = giftMessage?.trim() ? `\n\n💬 «${giftMessage.trim()}»` : "";
          const text =
            `🎁 Вам подарили подписку <b>${tariff?.name ?? "VPN"}</b>!\n\n` +
            `Код активации: <code>${result.data.code}</code>${customMessage}\n\n` +
            `${giftUrl}`;
          const shareText = `У меня для тебя подарок 🎁\n \nПодписка на сервис безопасного удалённого доступа 🛡 \n\n💡 Нажми на ссылку, чтобы активировать:\n\n${giftUrl}`;
          const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(giftUrl)}&text=${encodeURIComponent(shareText)}`;
          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: fullClient.telegramId,
              text,
              parse_mode: "HTML",
              reply_markup: {
                inline_keyboard: [
                  [{ text: "💌 Отправить подарок", url: shareUrl }],
                  [{ text: "🎁 Активировать подарок", url: giftUrl }],
                ],
              },
            }),
          }).catch((e) => console.error("[admin/gift-codes/create] notify client failed:", e));
        }
      }
    }
  } catch (e) {
    console.error("[admin/gift-codes/create] giftUrl/notify error:", e);
  }

  return res.json({ ...result.data, giftUrl });
}));

adminRouter.use("/tour-steps", adminTourStepsRouter);
adminRouter.use("/tour-mascots", adminTourMascotsRouter);

// ─── Referral admin (16.05.2026) ──────────────────────────────────
// Полная картина по рефералке конкретного клиента: его реферер, кого пригласил,
// заработок по уровням L1/L2/L3, последние credit'ы. Plus возможность переназначить
// реферера (для саппорта когда клиент жалуется «не приходит реф. кэшбек»).

/**
 * GET /api/admin/referrals/lookup?q=<query>
 * Поиск клиента по: client.id (cuid), telegramId, telegramUsername, email, referralCode.
 * Возвращает до 10 совпадений — для autocomplete'а.
 */
adminRouter.get("/referrals/lookup", asyncRoute(async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (q.length < 2) return res.json({ clients: [] });
  const stripped = q.replace(/^@/, "");
  const clients = await prisma.client.findMany({
    where: {
      OR: [
        { id: q },
        { telegramId: stripped },
        { telegramUsername: { equals: stripped, mode: "insensitive" } },
        { telegramUsername: { contains: stripped, mode: "insensitive" } },
        { email: { equals: stripped, mode: "insensitive" } },
        { referralCode: { equals: stripped.toUpperCase() } },
      ],
    },
    select: {
      id: true,
      telegramId: true,
      telegramUsername: true,
      email: true,
      referralCode: true,
      referrerId: true,
      balance: true,
      _count: { select: { referrals: true, referralCredits: true } },
    },
    take: 10,
  });
  return res.json({ clients });
}));

/**
 * GET /api/admin/referrals/:id
 * Полная инфо по рефералке клиента.
 *  - client (basic info)
 *  - referrer (если есть)
 *  - referrals[] (кого он пригласил)
 *  - earnings: { totalAll, byLevel: {1, 2, 3} }
 *  - recentCredits[] (последние 50)
 */
adminRouter.get("/referrals/:id", asyncRoute(async (req, res) => {
  const id = String(req.params.id ?? "").trim();
  if (!id) return res.status(400).json({ message: "Invalid client id" });

  const client = await prisma.client.findUnique({
    where: { id },
    select: {
      id: true,
      telegramId: true,
      telegramUsername: true,
      email: true,
      referralCode: true,
      referralPercent: true,
      referrerId: true,
      balance: true,
      createdAt: true,
    },
  });
  if (!client) return res.status(404).json({ message: "Клиент не найден" });

  const referrer = client.referrerId
    ? await prisma.client.findUnique({
        where: { id: client.referrerId },
        select: {
          id: true, telegramId: true, telegramUsername: true,
          email: true, referralCode: true,
        },
      })
    : null;

  const referrals = await prisma.client.findMany({
    where: { referrerId: id },
    select: {
      id: true,
      telegramId: true,
      telegramUsername: true,
      email: true,
      createdAt: true,
      _count: { select: { referrals: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  // earnings aggregate
  const earningsRows = await prisma.referralCredit.groupBy({
    by: ["level"],
    where: { referrerId: id },
    _sum: { amount: true },
    _count: { id: true },
  });
  const byLevel: Record<number, { amount: number; count: number }> = {};
  let totalAll = 0;
  let totalCount = 0;
  for (const r of earningsRows) {
    const lvl = r.level;
    const amt = Number(r._sum.amount ?? 0);
    const cnt = Number(r._count.id ?? 0);
    byLevel[lvl] = { amount: amt, count: cnt };
    totalAll += amt;
    totalCount += cnt;
  }

  const recentCredits = await prisma.referralCredit.findMany({
    where: { referrerId: id },
    select: {
      id: true,
      amount: true,
      level: true,
      createdAt: true,
      paymentId: true,
      payment: {
        select: {
          id: true,
          amount: true,
          status: true,
          clientId: true,
          client: { select: { id: true, telegramId: true, telegramUsername: true, email: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return res.json({
    client,
    referrer,
    referrals,
    earnings: { totalAll, totalCount, byLevel },
    recentCredits,
  });
}));

/**
 * PATCH /api/admin/referrals/:id/referrer
 * Body: { referrerId: string | null, lookupBy?: "id"|"tgid"|"username"|"referralCode" }
 * Если lookupBy задан и не "id" — referrerId интерпретируется как соответствующий ключ
 * (например telegramId), и резолвится в Client.id. Защита от self-referral / циклов.
 */
adminRouter.patch("/referrals/:id/referrer", asyncRoute(async (req, res) => {
  const id = String(req.params.id ?? "").trim();
  if (!id) return res.status(400).json({ message: "Invalid client id" });

  const schema = z.object({
    referrerId: z.string().nullable(),
    lookupBy: z.enum(["id", "tgid", "username", "referralCode"]).optional(),
  });
  const body = schema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input" });

  const client = await prisma.client.findUnique({ where: { id }, select: { id: true, referrerId: true } });
  if (!client) return res.status(404).json({ message: "Клиент не найден" });

  let resolvedReferrerId: string | null = null;
  if (body.data.referrerId) {
    const raw = body.data.referrerId.trim().replace(/^@/, "");
    const by = body.data.lookupBy ?? "id";
    let found: { id: string } | null = null;
    if (by === "id") {
      found = await prisma.client.findUnique({ where: { id: raw }, select: { id: true } });
    } else if (by === "tgid") {
      found = await prisma.client.findFirst({ where: { telegramId: raw }, select: { id: true } });
    } else if (by === "username") {
      found = await prisma.client.findFirst({
        where: { telegramUsername: { equals: raw, mode: "insensitive" } },
        select: { id: true },
      });
    } else if (by === "referralCode") {
      found = await prisma.client.findFirst({
        where: { referralCode: raw.toUpperCase() },
        select: { id: true },
      });
    }
    if (!found) return res.status(404).json({ message: "Реферер не найден по указанному ключу" });
    if (found.id === id) return res.status(400).json({ message: "Нельзя сделать клиента реферером самого себя" });

    // Защита от циклов: проверяем что новый реферер не является нашим (прямым или транзитивным) рефералом.
    let cursor: string | null = found.id;
    const visited = new Set<string>();
    while (cursor) {
      if (cursor === id) {
        return res.status(400).json({ message: "Цикл рефералки запрещён (этот клиент уже является чьим-то рефералом по цепочке)" });
      }
      if (visited.has(cursor)) break;
      visited.add(cursor);
      const parent: { referrerId: string | null } | null = await prisma.client.findUnique({
        where: { id: cursor },
        select: { referrerId: true },
      });
      cursor = parent?.referrerId ?? null;
    }
    resolvedReferrerId = found.id;
  }

  await prisma.client.update({
    where: { id },
    data: { referrerId: resolvedReferrerId },
  });

  return res.json({ ok: true, referrerId: resolvedReferrerId, previousReferrerId: client.referrerId });
}));
