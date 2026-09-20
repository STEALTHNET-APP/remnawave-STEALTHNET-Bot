/**
 * T-anti-abuse (15.06.2026, WolfVPN): админ-API анти-абьюза.
 * /api/admin/anti-abuse/*  — CRUD правил, листинг состояния (warned/banned),
 * журнал событий, глобальные настройки (master-toggle, topN), ручной разбан.
 *
 * Секция доступа — "anti-abuse" (getSectionFromPath возвращает первый сегмент;
 * ADMIN проходит всегда, менеджер — если секция в allowedSections).
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { TrafficAbuseRule } from "@prisma/client";
import { prisma } from "../../db.js";
import { requireAuth, requireAdminSection } from "../auth/middleware.js";
import { logAdmin } from "../audit/audit.service.js";
import { remnaEnableUser, remnaDisableUser } from "../remna/remna.client.js";
import { rescheduleAbuseRule, runRuleTick, isAbuseMasterEnabled } from "./anti-abuse.scheduler.js";

export const antiAbuseRouter = Router();
antiAbuseRouter.use(requireAuth);
antiAbuseRouter.use(requireAdminSection);

const SETTING_ENABLED = "anti_abuse_enabled";
const SETTING_TOPN = "anti_abuse_top_n_per_node";

const channelsSchema = z.object({
  telegram: z.boolean().optional(),
  email: z.boolean().optional(),
  site: z.boolean().optional(),
});

const ruleSchema = z.object({
  name: z.string().min(1).max(120),
  enabled: z.boolean().optional(),
  schedules: z.array(z.string().min(1).max(120)).min(1).max(20),
  windowKind: z.enum(["hour", "day", "week", "custom", "rolling"]),
  windowValueHours: z.number().int().positive().max(8760).nullable().optional(),
  limitBytes: z.union([z.string(), z.number()]),
  action: z.enum(["WARN", "BAN"]),
  banDurationKind: z.enum(["until_window_end", "fixed"]).nullable().optional(),
  banDurationHours: z.number().int().positive().max(8760).nullable().optional(),
  channels: channelsSchema,
  messageText: z.string().min(1),
  emailSubject: z.string().max(200).nullable().optional(),
  scopeKind: z.enum(["all", "tariff", "squad"]).optional(),
  scopeValues: z.array(z.string().max(64)).max(5000).nullable().optional(),
  excludeSubscriptionIds: z.array(z.string().max(64)).max(20000).nullable().optional(),
  priority: z.number().int().optional(),
  resendAfterHours: z.number().int().positive().max(8760).nullable().optional(),
});

function parseLimitBytes(v: string | number): bigint {
  if (typeof v === "number") return BigInt(Math.max(0, Math.round(v)));
  const cleaned = v.trim();
  if (!/^\d+$/.test(cleaned)) throw new Error("limitBytes must be a non-negative integer string");
  return BigInt(cleaned);
}

/** BigInt → строка для JSON-ответа (BigInt не сериализуется JSON.stringify). */
function serializeRule(r: TrafficAbuseRule) {
  return { ...r, limitBytes: r.limitBytes.toString() };
}

// ---- Правила CRUD ----------------------------------------------------------

antiAbuseRouter.get("/rules", async (_req: Request, res: Response) => {
  const rules = await prisma.trafficAbuseRule.findMany({ orderBy: [{ priority: "desc" }, { createdAt: "asc" }] });
  return res.json({ items: rules.map(serializeRule) });
});

antiAbuseRouter.post("/rules", async (req: Request, res: Response) => {
  const parsed = ruleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid rule", errors: parsed.error.flatten() });
  const d = parsed.data;
  let limitBytes: bigint;
  try {
    limitBytes = parseLimitBytes(d.limitBytes);
  } catch (e) {
    return res.status(400).json({ message: e instanceof Error ? e.message : "Invalid limitBytes" });
  }
  const rule = await prisma.trafficAbuseRule.create({
    data: {
      name: d.name,
      enabled: d.enabled ?? true,
      schedules: d.schedules,
      windowKind: d.windowKind,
      windowValueHours: d.windowValueHours ?? null,
      limitBytes,
      action: d.action,
      banDurationKind: d.banDurationKind ?? null,
      banDurationHours: d.banDurationHours ?? null,
      channels: d.channels,
      messageText: d.messageText,
      emailSubject: d.emailSubject ?? null,
      scopeKind: d.scopeKind ?? "all",
      scopeValues: d.scopeValues ?? undefined,
      excludeSubscriptionIds: d.excludeSubscriptionIds ?? undefined,
      priority: d.priority ?? 0,
      resendAfterHours: d.resendAfterHours ?? null,
    },
  });
  await rescheduleAbuseRule(rule.id);
  await logAdmin(req, "anti_abuse.rule.create", { type: "anti-abuse-rule", id: rule.id }, { name: rule.name, action: rule.action });
  return res.json(serializeRule(rule));
});

antiAbuseRouter.patch("/rules/:id", async (req: Request, res: Response) => {
  const parsed = ruleSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid rule", errors: parsed.error.flatten() });
  const d = parsed.data;
  const data: Record<string, unknown> = {};
  if (d.name !== undefined) data.name = d.name;
  if (d.enabled !== undefined) data.enabled = d.enabled;
  if (d.schedules !== undefined) data.schedules = d.schedules;
  if (d.windowKind !== undefined) data.windowKind = d.windowKind;
  if (d.windowValueHours !== undefined) data.windowValueHours = d.windowValueHours;
  if (d.limitBytes !== undefined) {
    try {
      data.limitBytes = parseLimitBytes(d.limitBytes);
    } catch (e) {
      return res.status(400).json({ message: e instanceof Error ? e.message : "Invalid limitBytes" });
    }
  }
  if (d.action !== undefined) data.action = d.action;
  if (d.banDurationKind !== undefined) data.banDurationKind = d.banDurationKind;
  if (d.banDurationHours !== undefined) data.banDurationHours = d.banDurationHours;
  if (d.channels !== undefined) data.channels = d.channels;
  if (d.messageText !== undefined) data.messageText = d.messageText;
  if (d.emailSubject !== undefined) data.emailSubject = d.emailSubject;
  if (d.scopeKind !== undefined) data.scopeKind = d.scopeKind;
  if (d.scopeValues !== undefined) data.scopeValues = d.scopeValues ?? undefined;
  if (d.excludeSubscriptionIds !== undefined) data.excludeSubscriptionIds = d.excludeSubscriptionIds ?? undefined;
  if (d.priority !== undefined) data.priority = d.priority;
  if (d.resendAfterHours !== undefined) data.resendAfterHours = d.resendAfterHours;

  const rule = await prisma.trafficAbuseRule.update({ where: { id: req.params.id }, data });
  await rescheduleAbuseRule(rule.id);
  await logAdmin(req, "anti_abuse.rule.update", { type: "anti-abuse-rule", id: rule.id }, { name: rule.name });
  return res.json(serializeRule(rule));
});

antiAbuseRouter.delete("/rules/:id", async (req: Request, res: Response) => {
  const id = req.params.id;
  await prisma.trafficAbuseRule.delete({ where: { id } }).catch(() => undefined);
  await rescheduleAbuseRule(id);
  await logAdmin(req, "anti_abuse.rule.delete", { type: "anti-abuse-rule", id });
  return res.json({ ok: true });
});

/** Запустить проверку правила немедленно (ручной прогон). */
antiAbuseRouter.post("/rules/:id/run", async (req: Request, res: Response) => {
  const id = req.params.id;
  const rule = await prisma.trafficAbuseRule.findUnique({ where: { id } });
  if (!rule) return res.status(404).json({ message: "Rule not found" });
  runRuleTick(id).catch((e) => console.error("[anti-abuse] manual run error:", e));
  await logAdmin(req, "anti_abuse.rule.run", { type: "anti-abuse-rule", id });
  return res.json({ ok: true, message: "Проверка запущена в фоне" });
});

// ---- Состояние (листинг warned / banned) -----------------------------------

antiAbuseRouter.get("/state", async (_req: Request, res: Response) => {
  const now = new Date();
  const banned = await prisma.subscription.findMany({
    where: { bannedUntil: { gt: now } },
    select: {
      id: true,
      subscriptionIndex: true,
      remnawaveUuid: true,
      bannedUntil: true,
      banReason: true,
      banRuleId: true,
      tariff: { select: { name: true } },
      owner: { select: { id: true, telegramId: true, telegramUsername: true, email: true } },
    },
    orderBy: { bannedUntil: "asc" },
    take: 500,
  });

  const warnedRows = await prisma.trafficAbuseState.findMany({
    where: { warnedAt: { not: null } },
    select: {
      id: true,
      windowKey: true,
      warnedAt: true,
      lastPeriodBytes: true,
      subscription: {
        select: {
          id: true,
          subscriptionIndex: true,
          tariff: { select: { name: true } },
          owner: { select: { id: true, telegramId: true, telegramUsername: true, email: true } },
        },
      },
      rule: { select: { id: true, name: true, action: true } },
    },
    orderBy: { warnedAt: "desc" },
    take: 500,
  });

  const warned = warnedRows.map((w) => ({
    ...w,
    lastPeriodBytes: w.lastPeriodBytes != null ? w.lastPeriodBytes.toString() : null,
  }));

  return res.json({ banned, warned });
});

// ---- Журнал событий --------------------------------------------------------

antiAbuseRouter.get("/events", async (req: Request, res: Response) => {
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? ""), 10) || 50, 1), 200);
  const q = req.query;
  const eventType = typeof q.eventType === "string" && q.eventType ? q.eventType : undefined;
  const ruleId = typeof q.ruleId === "string" && q.ruleId ? q.ruleId : undefined;
  const cursor = typeof q.cursor === "string" && q.cursor ? q.cursor : undefined;
  const dateFrom = typeof q.dateFrom === "string" && q.dateFrom ? new Date(q.dateFrom) : undefined;
  const dateTo = typeof q.dateTo === "string" && q.dateTo ? new Date(q.dateTo) : undefined;

  const where: Record<string, unknown> = {};
  if (eventType) where.eventType = eventType;
  if (ruleId) where.ruleId = ruleId;
  const createdAt: Record<string, Date> = {};
  if (dateFrom && !Number.isNaN(dateFrom.getTime())) createdAt.gte = dateFrom;
  if (dateTo && !Number.isNaN(dateTo.getTime())) createdAt.lte = dateTo;
  if (Object.keys(createdAt).length) where.createdAt = createdAt;

  // Курсорная пагинация: берём limit+1, лишний элемент = признак следующей страницы.
  const rows = await prisma.trafficAbuseEvent.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      eventType: true,
      periodBytes: true,
      windowKey: true,
      channelsSent: true,
      detail: true,
      createdAt: true,
      ruleId: true,
      subscription: {
        select: { id: true, subscriptionIndex: true, owner: { select: { id: true, telegramId: true, telegramUsername: true, email: true } } },
      },
    },
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore && page.length > 0 ? page[page.length - 1].id : null;
  const items = page.map((e) => ({ ...e, periodBytes: e.periodBytes != null ? e.periodBytes.toString() : null }));
  return res.json({ items, nextCursor });
});

// ---- Глобальные настройки --------------------------------------------------

antiAbuseRouter.get("/settings", async (_req: Request, res: Response) => {
  const enabled = await isAbuseMasterEnabled();
  const topRow = await prisma.systemSetting.findUnique({ where: { key: SETTING_TOPN } });
  const topN = topRow ? parseInt(topRow.value, 10) || 500 : 500;
  return res.json({ enabled, topN });
});

const settingsSchema = z.object({
  enabled: z.boolean().optional(),
  topN: z.number().int().positive().max(100000).optional(),
});

antiAbuseRouter.patch("/settings", async (req: Request, res: Response) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid settings", errors: parsed.error.flatten() });
  const { enabled, topN } = parsed.data;
  if (enabled !== undefined) {
    await prisma.systemSetting.upsert({
      where: { key: SETTING_ENABLED },
      create: { key: SETTING_ENABLED, value: enabled ? "true" : "false" },
      update: { value: enabled ? "true" : "false" },
    });
  }
  if (topN !== undefined) {
    await prisma.systemSetting.upsert({
      where: { key: SETTING_TOPN },
      create: { key: SETTING_TOPN, value: String(topN) },
      update: { value: String(topN) },
    });
  }
  await logAdmin(req, "anti_abuse.settings.update", { type: "system", id: "anti-abuse" }, { enabled, topN });
  return res.json({ ok: true });
});

// ---- Ручная блокировка (из листинга предупреждённых) -----------------------
// T-manual-ban (19.06.2026, WolfVPN): админ может заблокировать подписку руками прямо из
// журнала/листинга предупреждённых, указав причину и срок. В журнале выглядит как бан, но
// banRuleId=null (правило не сработало — заблокировали вручную). durationHours=null → бессрочно.

const manualBanSchema = z.object({
  reason: z.string().trim().min(1, "Укажите причину").max(500),
  durationHours: z.number().int().positive().max(876000).nullable().optional(),
});

antiAbuseRouter.post("/ban/:subscriptionId", async (req: Request, res: Response) => {
  const parsed = manualBanSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid request", errors: parsed.error.flatten() });
  const { reason, durationHours } = parsed.data;
  const id = req.params.subscriptionId;

  const sub = await prisma.subscription.findUnique({
    where: { id },
    select: {
      id: true,
      subscriptionIndex: true,
      remnawaveUuid: true,
      tariff: { select: { name: true } },
      owner: { select: { id: true } },
    },
  });
  if (!sub) return res.status(404).json({ message: "Subscription not found" });

  const now = new Date();
  const indefinite = !durationHours;
  // Бессрочно = заведомо дальняя дата (до ручного разбана). Поле bannedUntil обязано быть > now,
  // чтобы попасть в листинг «Заблокированы сейчас» и фильтр авто-разбана не снял раньше времени.
  const bannedUntil = indefinite
    ? new Date(now.getTime() + 100 * 365 * 24 * 3600_000)
    : new Date(now.getTime() + durationHours! * 3600_000);

  // Физический бан в Remna (отключаем подключение) — как авто-бан правила.
  if (sub.remnawaveUuid) {
    try {
      await remnaDisableUser(sub.remnawaveUuid);
    } catch (e) {
      console.error("[anti-abuse] manual ban Remna disable error:", e instanceof Error ? e.message : e);
    }
  }

  await prisma.subscription.update({
    where: { id },
    data: { bannedUntil, banReason: reason, banRuleId: null, banNotifiedAt: now },
  });

  // Убираем из «Предупреждены»: на варн отреагировали баном вручную.
  await prisma.trafficAbuseState.updateMany({ where: { subscriptionId: id }, data: { warnedAt: null } });

  await prisma.trafficAbuseEvent.create({
    data: {
      subscriptionId: id,
      ruleId: null,
      eventType: "BAN",
      detail: indefinite
        ? `Ручная блокировка администратором (бессрочно): ${reason}`
        : `Ручная блокировка администратором до ${bannedUntil.toISOString()}: ${reason}`,
    },
  });

  await logAdmin(req, "anti_abuse.ban", { type: "subscription", id }, { reason, durationHours: durationHours ?? null });
  return res.json({ ok: true, bannedUntil: bannedUntil.toISOString(), indefinite });
});

// ---- Ручной разбан ---------------------------------------------------------

antiAbuseRouter.post("/unban/:subscriptionId", async (req: Request, res: Response) => {
  const id = req.params.subscriptionId;
  const sub = await prisma.subscription.findUnique({
    where: { id },
    select: { id: true, remnawaveUuid: true, banRuleId: true },
  });
  if (!sub) return res.status(404).json({ message: "Subscription not found" });
  if (sub.remnawaveUuid) {
    try {
      await remnaEnableUser(sub.remnawaveUuid);
    } catch (e) {
      console.error("[anti-abuse] manual unban Remna enable error:", e instanceof Error ? e.message : e);
    }
  }
  // T-abuse-grace (29.06.2026, WolfVPN): иммунитет от авто-бана. Админ задаёт срок (дней),
  // дефолт 7. На это время крон не банит/не предупреждает — даём время исправиться.
  // 0 → без иммунитета (крон может забанить уже на следующем тике).
  const rawDays = (req.body as { immuneDays?: unknown })?.immuneDays;
  const immuneDays = Math.max(0, Math.min(365, Number.isFinite(Number(rawDays)) ? Math.round(Number(rawDays)) : 7));
  const abuseImmuneUntil = immuneDays > 0 ? new Date(Date.now() + immuneDays * 24 * 60 * 60 * 1000) : null;
  await prisma.subscription.update({
    where: { id },
    data: { bannedUntil: null, banReason: null, banRuleId: null, banNotifiedAt: null, abuseImmuneUntil },
  });
  // Сброс снапшотов/счётчика предупреждений: после разбана отсчёт с чистого листа.
  await prisma.trafficAbuseState.updateMany({
    where: { subscriptionId: id },
    data: { lastLifetimeBytes: null, lastSnapshotAt: null, warnedAt: null, lastPeriodBytes: null },
  });
  await prisma.trafficAbuseEvent.create({
    data: {
      subscriptionId: id,
      ruleId: sub.banRuleId,
      eventType: "UNBAN",
      detail: immuneDays > 0
        ? `Ручной разбан администратором. Иммунитет от авто-бана: ${immuneDays} дн. (до ${abuseImmuneUntil!.toLocaleString("ru-RU")})`
        : "Ручной разбан администратором (без иммунитета)",
    },
  });
  await logAdmin(req, "anti_abuse.unban", { type: "subscription", id }, { immuneDays });
  return res.json({ ok: true, immuneDays, abuseImmuneUntil: abuseImmuneUntil?.toISOString() ?? null });
});
