import { gzipSync } from "node:zlib";
import { APP_BUILD } from "../../config/app-version.js";
import { updaterRequest } from "../update/update.routes.js";
import { reportUpdateStatus, summarizeDiagnosticLog } from "./support-report.js";
import type { ReqAdmin } from "../auth/middleware.js";
/**
 * Админские диагностические эндпоинты:
 * - GET /api/admin/diagnostics/health       — агрегированный health-check
 * - GET /api/admin/diagnostics/crons        — список cron-задач + last-run
 * - POST /api/admin/diagnostics/crons/:name/trigger — запуск крон-задачи руками
 * - GET /api/admin/diagnostics/logs         — последние строки логов API-контейнера
 */

import express, { Router } from "express";
import { z } from "zod";
import { requireAuth, requireAdminSection } from "../auth/middleware.js";
import { aggregateHealth } from "./health.service.js";
import { listCronEntries, triggerCron } from "./cron-registry.js";
import { logAdmin } from "../audit/audit.service.js";
import { getLogs } from "./log-buffer.js";

function asyncRoute(fn: (req: express.Request, res: express.Response) => Promise<void | express.Response>) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

export const diagnosticsAdminRouter = Router();
diagnosticsAdminRouter.use(requireAuth);
diagnosticsAdminRouter.use(requireAdminSection);

diagnosticsAdminRouter.get(
  "/health",
  asyncRoute(async (_req, res) => {
    const result = await aggregateHealth();
    return res.json(result);
  }),
);

diagnosticsAdminRouter.get(
  "/crons",
  asyncRoute(async (_req, res) => {
    return res.json({ items: listCronEntries() });
  }),
);

diagnosticsAdminRouter.post(
  "/crons/:name/trigger",
  asyncRoute(async (req, res) => {
    const result = await triggerCron(req.params.name);
    await logAdmin(req, "cron.trigger", { type: "cron", id: req.params.name }, { ok: result.ok, error: result.error });
    if (!result.ok) return res.status(400).json({ message: result.error });
    return res.json({ ok: true });
  }),
);

const logsQuerySchema = z.object({
  /** Сколько последних строк отдать (default 200, max 5000). */
  lines: z.coerce.number().int().min(1).max(5000).optional(),
  /** Регэкс для фильтрации (insensitive). */
  filter: z.string().max(200).optional(),
  /** Уровень логов: log | info | warn | error | debug. По умолчанию все. */
  level: z.enum(["log", "info", "warn", "error", "debug"]).optional(),
  /** Имя контейнера. Только api поддерживается (внутри-процессный буфер). */
  container: z.enum(["api"]).optional(),
});

diagnosticsAdminRouter.get(
  "/logs",
  asyncRoute(async (req, res) => {
    const parsed = logsQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ message: "Invalid query", errors: parsed.error.flatten() });

    const result = getLogs({
      lines: parsed.data.lines,
      filter: parsed.data.filter,
      level: parsed.data.level,
    });

    if ("error" in result) {
      return res.status(400).json({ message: result.error });
    }

    // Формируем читаемый текст для UI (формат: ISO ts [level] text)
    const text = result.lines
      .map((l) => {
        const iso = new Date(l.ts).toISOString().slice(11, 23); // HH:MM:SS.mmm
        const lvl = l.level.toUpperCase().padEnd(5, " ");
        return `${iso} [${lvl}] ${l.text}`;
      })
      .join("\n");

    return res.json({
      container: "api",
      lines: result.lines.length,
      text: text || "[no log entries yet — logs will appear as the API processes requests]",
      meta: { bufferSize: result.bufferSize, capacity: result.capacity },
    });
  }),
);

diagnosticsAdminRouter.get("/report", asyncRoute(async (req, res) => {
  if ((req as typeof req & ReqAdmin).adminRole !== "ADMIN") return res.status(403).json({ message: "Отчёт доступен только администратору" });
  const [health, update] = await Promise.all([
    aggregateHealth(),
    updaterRequest("/status").then(result => reportUpdateStatus(result.data)).catch(() => ({ connected: false })),
  ]);
  const logs = getLogs({ lines: 200 });
  const report = {
    format: "stealthnet-support-v1", createdAt: new Date().toISOString(), build: APP_BUILD,
    health: { overallStatus: health.overallStatus, checks: health.checks.map(check => ({ name: check.name, status: check.status, durationMs: check.durationMs })) },
    update,
    crons: listCronEntries().map(entry => ({ name: entry.name, recent: entry.recent.map(run => ({ ok: run.ok, startedAt: run.startedAt, finishedAt: run.finishedAt })) })),
    logs: logs.lines.map(summarizeDiagnosticLog),
    note: "Исходный текст логов, адреса серверов, настройки, учётные записи и содержимое БД не включены. В журнале оставлены время, уровень, категория и распознанные коды ошибок.",
  };
  await logAdmin(req, "diagnostics.report", { type: "diagnostics", id: "support-report" });
  const archive = gzipSync(Buffer.from(JSON.stringify(report, null, 2)));
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/gzip");
  res.setHeader("Content-Disposition", 'attachment; filename="stealthnet-diagnostics.json.gz"');
  return res.send(archive);
}));
