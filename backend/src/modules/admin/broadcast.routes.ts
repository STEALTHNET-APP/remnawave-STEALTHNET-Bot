import express, { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { prisma } from "../../db.js";
import {
  getBroadcastRecipientsCount,
  startBroadcastJob,
  getBroadcastJob,
  cancelBroadcastJob,
  listBroadcastHistory,
  getBroadcastHistoryItem,
  sendDirectTelegramMessage,
  sendDirectEmail,
  startListSendJob,
  getListSendJob,
} from "../broadcast/broadcast.service.js";
import { runRule, runAllRules, getEligibleClientIds } from "../auto-broadcast/auto-broadcast.service.js";

export const adminBroadcastRouter = Router();
export const adminAutoBroadcastRouter = Router();

function asyncRoute(
  fn: (req: express.Request, res: express.Response) => Promise<void | express.Response>
) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

// ——————————————— Рассылка ———————————————

const broadcastSchema = z.object({
  channel: z.enum(["telegram", "email", "both"]),
  subject: z.string().max(500).optional(),
  message: z.string().min(1, "Текст сообщения обязателен").max(4096),
  buttonText: z.string().max(64).optional(),
  buttonUrl: z.string().max(500).optional(),
  // фильтр получателей.
  targetGroup: z.enum([
    "all",
    "active_subs",
    "expired_subs",
    "with_any_subs",
    "without_subs",
    "standard_subs",
    "unblock_subs",
    "unblock_unlimited",
  ]).optional(),
});

const broadcastUpload = multer({
  storage: multer.memoryStorage(),
  // подняли с 20 MB до 50 MB ради видео (sendVideo через
  // основной bot API лимит ~50 MB; для большего пришлось бы поднимать локальный
  // bot-api server, чего у нас сейчас нет).
  limits: { fileSize: 50 * 1024 * 1024 },
});

adminBroadcastRouter.get("/recipients-count", asyncRoute(async (_req, res) => {
  const counts = await getBroadcastRecipientsCount();
  return res.json(counts);
}));

const DIRECT_EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// T-direct-send (портировано из WolfVPN): точечная отправка ОДНОМУ — Telegram (по id) или Email. Multipart.
adminBroadcastRouter.post("/send-to-user", broadcastUpload.single("attachment"), asyncRoute(async (req, res) => {
  const channel = req.body.channel === "email" ? "email" : "telegram";
  const recipient = String(req.body.telegramId ?? req.body.recipient ?? "").trim();
  const message = String(req.body.message ?? "").trim();
  if (!message || message.length > 4096) return res.status(400).json({ message: "Текст сообщения: 1–4096 символов" });
  const subject = req.body.subject ? String(req.body.subject).slice(0, 300) : undefined;
  const buttonText = req.body.buttonText ? String(req.body.buttonText).slice(0, 64) : undefined;
  const buttonUrl = req.body.buttonUrl ? String(req.body.buttonUrl).slice(0, 500) : undefined;
  const attachment = req.file ? { buffer: req.file.buffer, mimetype: req.file.mimetype, originalname: req.file.originalname } : undefined;

  let result: { ok: boolean; error?: string };
  if (channel === "email") {
    if (!DIRECT_EMAIL_RE.test(recipient)) return res.status(400).json({ message: "Введите корректный email" });
    result = await sendDirectEmail(recipient, subject, message, attachment);
  } else {
    if (!/^\d+$/.test(recipient)) return res.status(400).json({ message: "Telegram ID — только цифры" });
    result = await sendDirectTelegramMessage(recipient, message, { buttonText, buttonUrl, attachment });
  }
  if (!result.ok) return res.status(502).json({ message: result.error ?? "Не удалось отправить сообщение" });
  return res.json({ ok: true });
}));

// T-list-send (портировано из WolfVPN): рассылка по списку — Telegram (id) или Email, in-memory job. Multipart.
adminBroadcastRouter.post("/send-to-list", broadcastUpload.single("attachment"), asyncRoute(async (req, res) => {
  const channel = req.body.channel === "email" ? "email" : "telegram";
  let recipients: string[] = [];
  try { const raw = JSON.parse(String(req.body.telegramIds ?? "[]")); if (Array.isArray(raw)) recipients = raw.map((x) => String(x)); } catch { /* ignore */ }
  const message = String(req.body.message ?? "").trim();
  if (recipients.length === 0) return res.status(400).json({ message: "Список получателей пуст" });
  if (recipients.length > 10000) return res.status(400).json({ message: "Слишком много получателей (макс. 10000)" });
  if (!message || message.length > 4096) return res.status(400).json({ message: "Текст сообщения: 1–4096 символов" });
  const subject = req.body.subject ? String(req.body.subject).slice(0, 300) : undefined;
  const buttonText = req.body.buttonText ? String(req.body.buttonText).slice(0, 64) : undefined;
  const buttonUrl = req.body.buttonUrl ? String(req.body.buttonUrl).slice(0, 500) : undefined;
  const attachment = req.file ? { buffer: req.file.buffer, mimetype: req.file.mimetype, originalname: req.file.originalname } : undefined;
  const { jobId, total } = startListSendJob(recipients, message, { channel, subject, buttonText, buttonUrl, attachment });
  if (total === 0) return res.status(400).json({ message: channel === "email" ? "Не найдено корректных email" : "Не найдено корректных числовых ID" });
  return res.json({ jobId, total });
}));

adminBroadcastRouter.get("/send-to-list/:jobId", asyncRoute(async (req, res) => {
  const job = getListSendJob(req.params.jobId);
  if (!job) return res.status(404).json({ message: "Задача не найдена или устарела" });
  return res.json(job);
}));

adminBroadcastRouter.post(
  "/",
  broadcastUpload.single("attachment"),
  asyncRoute(async (req, res) => {
    const parsed = broadcastSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });
    }
    const { channel, subject, message, buttonText, buttonUrl, targetGroup } = parsed.data;
    const attachment =
      req.file && req.file.buffer
        ? { buffer: req.file.buffer, mimetype: req.file.mimetype || "application/octet-stream", originalname: req.file.originalname || "file" }
        : undefined;
    // Запускаем рассылку в фоне. Для больших баз синхронная отправка
    // упирается в таймаут nginx/браузера, хотя на бэкенде всё идёт успешно.
    const adminId = (req as unknown as { adminId?: string }).adminId;
    // startBroadcastJob теперь async (queue в DB + worker pickup).
    const jobId = await startBroadcastJob({
      channel,
      subject: subject ?? "",
      message,
      attachment,
      buttonText,
      buttonUrl,
      targetGroup,
      startedByAdmin: adminId,
    });
    return res.json({ jobId });
  })
);

// Возобновить ранее прерванную рассылку.
// Берёт существующую запись broadcast_history, читает её text/buttons/channel/targetGroup,
// принимает attachment (бинарь не хранится в БД, юзер переаплоадит тот же файл),
// запускает с тем же broadcastId → runBroadcast подхватит broadcast_sent_log
// и skip'нет уже отправленных. Дубли стремятся к нулю.
adminBroadcastRouter.post(
  "/:jobId/resume",
  broadcastUpload.single("attachment"),
  asyncRoute(async (req, res) => {
    const oldJobId = req.params.jobId;
    const old = await prisma.broadcastHistory.findUnique({ where: { id: oldJobId } });
    if (!old) return res.status(404).json({ message: "Рассылка не найдена" });
    if (old.status === "running") return res.status(409).json({ message: "Эта рассылка уже идёт" });

    const attachment =
      req.file && req.file.buffer
        ? { buffer: req.file.buffer, mimetype: req.file.mimetype || "application/octet-stream", originalname: req.file.originalname || "file" }
        : undefined;
    if (old.attachmentName && !attachment) {
      return res.status(400).json({
        message: `Эта рассылка содержала вложение "${old.attachmentName}" — переаплоадите тот же файл для возобновления.`,
      });
    }

    const tg = typeof req.body?.targetGroup === "string" ? req.body.targetGroup : "all";
    const adminId = (req as unknown as { adminId?: string }).adminId;

    const jobId = await startBroadcastJob({
      channel: old.channel as "telegram" | "email" | "both",
      subject: old.subject ?? "",
      message: old.message,
      attachment,
      buttonText: old.buttonText ?? undefined,
      buttonUrl: old.buttonUrl ?? undefined,
      targetGroup: tg as Parameters<typeof startBroadcastJob>[0]["targetGroup"],
      startedByAdmin: adminId,
      resumeJobId: oldJobId,
    });
    return res.json({ jobId, resumedFrom: oldJobId });
  })
);

// список получателей рассылки (sent_log) для админа.
// ?format=csv → text/csv downloadable. По дефолту json с массивом.
adminBroadcastRouter.get(
  "/:jobId/recipients",
  asyncRoute(async (req, res) => {
    const jobId = req.params.jobId;
    const fmt = typeof req.query.format === "string" ? req.query.format : "json";
    const rows = await prisma.$queryRaw<Array<{
      tgid: string;
      sent_at: Date;
      username: string | null;
    }>>`
      SELECT log.tgid, log.sent_at, c.telegram_username AS username
        FROM broadcast_sent_log log
        LEFT JOIN clients c ON c.telegram_id = log.tgid
       WHERE log.broadcast_id = ${jobId}
       ORDER BY log.sent_at ASC;
    `;
    if (fmt === "csv") {
      const header = "tgid,username,sent_at\n";
      const body = rows.map((r) => {
        const u = (r.username ?? "").replace(/[",\n]/g, "");
        return `${r.tgid},${u},${r.sent_at.toISOString()}`;
      }).join("\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="broadcast-${jobId}-recipients.csv"`);
      return res.send(header + body + "\n");
    }
    return res.json({ total: rows.length, recipients: rows });
  })
);

adminBroadcastRouter.get(
  "/status/:jobId",
  asyncRoute(async (req, res) => {
    // getBroadcastJob теперь async (читает из DB, не из in-memory).
    const job = await getBroadcastJob(req.params.jobId);
    if (!job) return res.status(404).json({ message: "Job not found" });
    return res.json({
      id: job.id,
      status: job.status,
      progress: job.progress,
      result: job.result ?? null,
      error: job.error ?? null,
      startedAt: job.startedAt.toISOString(),
      finishedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
      cancelRequested: job.cancelRequested,
    });
  })
);

// отмена активной рассылки.
// 25.05.2026 — теперь через DB-флаг (worker polls). Если job-row в БД 'running' но
// worker уже умер (зомби) → DB-update переводит запись в cancelled.
adminBroadcastRouter.post(
  "/cancel/:jobId",
  asyncRoute(async (req, res) => {
    const jobId = req.params.jobId;
    const result = await cancelBroadcastJob(jobId);
    if (result.ok) return res.json({ ok: true });
    const code = result.reason === "not_found" ? 404 : 409;
    const msg = result.reason === "not_found"
      ? "Рассылка не найдена"
      : result.reason === "not_running"
        ? "Рассылка уже завершена"
        : "Отмена уже запрошена";
    return res.status(code).json({ message: msg, reason: result.reason });
  })
);

// История рассылок: пагинированный список + получение деталей по id.
adminBroadcastRouter.get(
  "/history",
  asyncRoute(async (req, res) => {
    const limit = Number(req.query.limit) || 50;
    const offset = Number(req.query.offset) || 0;
    const data = await listBroadcastHistory({ limit, offset });
    return res.json(data);
  })
);

adminBroadcastRouter.get(
  "/history/:id",
  asyncRoute(async (req, res) => {
    const item = await getBroadcastHistoryItem(req.params.id);
    if (!item) return res.status(404).json({ message: "Not found" });
    return res.json(item);
  })
);

// ——————————————— Авто-рассылка ———————————————

const autoBroadcastRuleSchema = z.object({
  name: z.string().min(1).max(200),
  triggerType: z.enum([
    "after_registration",
    "inactivity",
    "no_payment",
    "trial_not_connected",
    "trial_used_never_paid",
    "no_traffic",
    "subscription_expired",
    "subscription_ending_soon",
    // новый триггер — за N минут до окончания подписки.
    "subscription_ending_minutes",
    // пассивные пользователи без действий.
    "inactive_no_subscription",
    "inactive_with_subscription",
  ]),
  // T-unify: для subscription_ending_minutes допускаем minutes до 7*24*60 = 10080.
  delayDays: z.union([z.number(), z.string()]).transform((v) => (typeof v === "string" ? parseInt(v, 10) : v)).pipe(z.number().int().min(0).max(10080)),
  channel: z.enum(["telegram", "email", "both"]),
  subject: z.string().max(500).nullish(),
  message: z.string().min(1).max(4096),
  buttonText: z.string().max(64).nullish(),
  buttonUrl: z.string().max(500).nullish(),
  // вторая кнопка под сообщением.
  button2Text: z.string().max(64).nullish(),
  button2Url: z.string().max(500).nullish(),
  enabled: z.boolean().optional(),
  // индивидуальные скидки/промокоды для авторассылки.
  promoCodeId: z.string().nullable().optional(),
  personalDiscountPercent: z.number().min(0).max(100).nullable().optional(),
  // при выдаче скидки клиенту через это правило —
  // помечать её как одноразовую (сгорит после первой продуктовой покупки). Дефолт true.
  personalDiscountIsOneTime: z.boolean().optional(),
  maxRecipients: z.number().int().min(1).nullable().optional(),
  // индивидуальный cron этого правила.
  // null/пусто → scheduler берёт дефолт по типу триггера. Формат node-cron (5 полей).
  cronExpression: z.string().max(64).nullable().optional(),
  // per-rule флаг — если true, правило НЕ
  // запускается по крону, ждёт события из бота (после регистрации). Поддерживается
  // для after_registration.
  eventDriven: z.boolean().optional(),
});

adminAutoBroadcastRouter.get("/rules", asyncRoute(async (_req, res) => {
  const rules = await prisma.autoBroadcastRule.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { logs: true } } },
  });
  return res.json(
    rules.map((r) => ({
      id: r.id,
      name: r.name,
      triggerType: r.triggerType,
      delayDays: r.delayDays,
      channel: r.channel,
      subject: r.subject,
      message: r.message,
      buttonText: r.buttonText,
      buttonUrl: r.buttonUrl,
      button2Text: r.button2Text,
      button2Url: r.button2Url,
      enabled: r.enabled,
      // T-promo (13.05.2026) — поля для рассылки с промокодом/скидкой.
      promoCodeId: r.promoCodeId,
      personalDiscountPercent: r.personalDiscountPercent,
      personalDiscountIsOneTime: r.personalDiscountIsOneTime,
      maxRecipients: r.maxRecipients,
      // T-cron-per-rule (13.05.2026)
      cronExpression: r.cronExpression,
      // T-event-driven (14.05.2026)
      eventDriven: r.eventDriven,
      lastRunAt: r.lastRunAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      sentCount: r._count.logs,
    }))
  );
}));

adminAutoBroadcastRouter.get("/rules/:id/eligible-count", asyncRoute(async (req, res) => {
  const ruleId = req.params.id;
  const ids = await getEligibleClientIds(ruleId);
  return res.json({ count: ids.length });
}));

adminAutoBroadcastRouter.post("/rules", asyncRoute(async (req, res) => {
  const parsed = autoBroadcastRuleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });
  const data = parsed.data;
  const rule = await prisma.autoBroadcastRule.create({
    data: {
      name: data.name,
      triggerType: data.triggerType,
      delayDays: data.delayDays,
      channel: data.channel,
      subject: data.subject ?? null,
      message: data.message,
      buttonText: data.buttonText ?? null,
      buttonUrl: data.buttonUrl ?? null,
      button2Text: data.button2Text ?? null,
      button2Url: data.button2Url ?? null,
      enabled: data.enabled ?? true,
      // T-promo (13.05.2026)
      promoCodeId: data.promoCodeId ?? null,
      personalDiscountPercent: data.personalDiscountPercent ?? null,
      personalDiscountIsOneTime: data.personalDiscountIsOneTime ?? true,
      maxRecipients: data.maxRecipients ?? null,
      // T-cron-per-rule (13.05.2026)
      cronExpression: data.cronExpression?.trim() || null,
      // T-event-driven (14.05.2026)
      eventDriven: data.eventDriven ?? false,
    },
  });
  // T-cron-per-rule: подхватить cron сразу после create — пересоздаём scheduler для этого правила.
  try {
    const { rescheduleRule } = await import("../auto-broadcast/auto-broadcast-scheduler.js");
    await rescheduleRule(rule.id);
  } catch (e) { console.warn("[auto-broadcast] rescheduleRule after create failed:", e); }
  return res.status(201).json({
    id: rule.id,
    name: rule.name,
    triggerType: rule.triggerType,
    delayDays: rule.delayDays,
    channel: rule.channel,
    subject: rule.subject,
    message: rule.message,
    buttonText: rule.buttonText,
    buttonUrl: rule.buttonUrl,
    button2Text: rule.button2Text,
    button2Url: rule.button2Url,
    enabled: rule.enabled,
    promoCodeId: rule.promoCodeId,
    personalDiscountPercent: rule.personalDiscountPercent,
    personalDiscountIsOneTime: rule.personalDiscountIsOneTime,
    maxRecipients: rule.maxRecipients,
    cronExpression: rule.cronExpression,
    eventDriven: rule.eventDriven,
    lastRunAt: rule.lastRunAt?.toISOString() ?? null,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
  });
}));

adminAutoBroadcastRouter.patch("/rules/:id", asyncRoute(async (req, res) => {
  const id = req.params.id;
  const parsed = autoBroadcastRuleSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });
  // нормализуем cronExpression (пустая строка → null).
  const data = { ...parsed.data } as Record<string, unknown>;
  if ("cronExpression" in data) {
    const raw = typeof data.cronExpression === "string" ? data.cronExpression.trim() : data.cronExpression;
    data.cronExpression = raw || null;
  }
  const rule = await prisma.autoBroadcastRule.update({ where: { id }, data });
  // Применяем новое расписание сразу.
  try {
    const { rescheduleRule } = await import("../auto-broadcast/auto-broadcast-scheduler.js");
    await rescheduleRule(rule.id);
  } catch (e) { console.warn("[auto-broadcast] rescheduleRule after patch failed:", e); }
  return res.json({
    id: rule.id,
    name: rule.name,
    triggerType: rule.triggerType,
    delayDays: rule.delayDays,
    channel: rule.channel,
    subject: rule.subject,
    message: rule.message,
    buttonText: rule.buttonText,
    buttonUrl: rule.buttonUrl,
    button2Text: rule.button2Text,
    button2Url: rule.button2Url,
    enabled: rule.enabled,
    promoCodeId: rule.promoCodeId,
    personalDiscountPercent: rule.personalDiscountPercent,
    personalDiscountIsOneTime: rule.personalDiscountIsOneTime,
    maxRecipients: rule.maxRecipients,
    cronExpression: rule.cronExpression,
    eventDriven: rule.eventDriven,
    lastRunAt: rule.lastRunAt?.toISOString() ?? null,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
  });
}));

adminAutoBroadcastRouter.delete("/rules/:id", asyncRoute(async (req, res) => {
  await prisma.autoBroadcastRule.delete({ where: { id: req.params.id } });
  // T-cron-per-rule: снимаем cron-задачу удалённого правила.
  try {
    const { rescheduleRule } = await import("../auto-broadcast/auto-broadcast-scheduler.js");
    await rescheduleRule(req.params.id);
  } catch (e) { console.warn("[auto-broadcast] rescheduleRule after delete failed:", e); }
  return res.status(204).send();
}));

adminAutoBroadcastRouter.post("/run", asyncRoute(async (_req, res) => {
  const results = await runAllRules();
  return res.json({ results });
}));

adminAutoBroadcastRouter.post("/run/:ruleId", asyncRoute(async (req, res) => {
  const result = await runRule(req.params.ruleId);
  return res.json(result);
}));

adminAutoBroadcastRouter.post("/rules/:ruleId/catchup", asyncRoute(async (req, res) => {
  const parsed = z.object({
    sinceDays: z.number().int().min(1).max(90).default(14),
    dryRun: z.boolean().default(true),
    limit: z.number().int().min(1).max(500).default(100),
  }).safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ message: "Неверные параметры", errors: parsed.error.flatten() });
  const { catchupTrialBroadcastRule } = await import("../auto-broadcast/auto-broadcast.service.js");
  const result = await catchupTrialBroadcastRule(req.params.ruleId, parsed.data);
  return res.json(result);
}));
