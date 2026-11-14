import { holdBackup } from "./backup-retention.js";
/**
 * Роуты бэкапа: создание (сохранение на диск + скачивание), список, скачивание, восстановление
 */

import { Request, Response } from "express";
import multer from "multer";
import {
  parseDatabaseUrl,
  runPgRestore,
  saveBackupToFile,
  cleanupOldBackups,
  listBackups,
  resolveBackupPath,
  deleteBackupFile,
  deleteAllBackups,
} from "./backup.service.js";
import { getSystemConfig } from "../client/client.service.js";
import { stat } from "node:fs/promises";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

export function registerBackupRoutes(
  router: import("express").Router,
  asyncRoute: (fn: (req: Request, res: Response) => Promise<void | Response>) => (req: Request, res: Response, next: () => void) => void
) {
  /** GET /api/admin/backup/create — создаёт бэкап на диск (по дням) и отдаёт файл на скачивание */
  router.get("/backup/create", asyncRoute(async (_req, res) => {
    const url = process.env.DATABASE_URL;
    if (!url) return res.status(503).json({ message: "DATABASE_URL не задан" });
    const db = parseDatabaseUrl(url);
    if (!db) return res.status(503).json({ message: "Неверный формат DATABASE_URL" });
    try {
      const { relativePath, filename, fullPath } = await saveBackupToFile(db);
      if (res.destroyed) return;
      const release = holdBackup(fullPath);
      res.once("close", release);
      // Чистим старые бэкапы сразу после успешного создания нового,
      // чтобы папка не росла бесконечно (без этого диск забивался).
      try {
        const cfg = await getSystemConfig();
        await cleanupOldBackups(cfg);
      } catch (e) {
        console.error("[backup] чистка старых бэкапов не удалась:", e);
      }
      const st = await stat(fullPath);
      res.setHeader("Content-Type", "application/sql");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", String(st.size));
      res.download(fullPath, filename, (error) => {
        if (!error) return;
        if (res.headersSent) { res.destroy(error); return; }
        res.status(500).json({ message: "Не удалось скачать бэкап." });
      });
    } catch (e) {
      console.error("Backup create error:", e);
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ message: "Ошибка создания бэкапа. Убедитесь, что в контейнере установлен postgresql-client.", error: msg });
    }
  }));

  /** GET /api/admin/backup/list — список сохранённых бэкапов */
  router.get("/backup/list", asyncRoute(async (_req, res) => {
    try {
      const items = await listBackups();
      const totalSize = items.reduce((acc, it) => acc + (it.size || 0), 0);
      return res.json({ items, totalSize, totalCount: items.length });
    } catch (e) {
      console.error("Backup list error:", e);
      return res.status(500).json({ message: "Ошибка чтения списка бэкапов" });
    }
  }));

  /** DELETE /api/admin/backup?path=... — удалить один бэкап с сервера */
  router.delete("/backup", asyncRoute(async (req, res) => {
    const pathParam = (req.query.path || req.body?.path) as string | undefined;
    if (!pathParam || typeof pathParam !== "string") {
      return res.status(400).json({ message: "Укажите параметр path (относительный путь к бэкапу)" });
    }
    const success = await deleteBackupFile(pathParam);
    if (!success) {
      return res.status(404).json({ message: "Бэкап не найден или не может быть удалён" });
    }
    return res.json({ ok: true, message: "Бэкап успешно удалён", path: pathParam });
  }));

  /** POST /api/admin/backup/delete-all — удалить все бэкапы на сервере */
  router.post("/backup/delete-all", asyncRoute(async (req, res) => {
    if (req.body?.confirm !== "DELETE_ALL") {
      return res.status(400).json({ message: "Подтвердите удаление всех бэкапов: укажите confirm: DELETE_ALL" });
    }
    try {
      const result = await deleteAllBackups();
      return res.json({
        ok: true,
        message: `Удалено ${result.deleted} бэкапов, освобождено ${(result.freedBytes / 1048576).toFixed(1)} МБ. Выполняющиеся операции пропущены.`,
        deleted: result.deleted,
        freedBytes: result.freedBytes,
      });
    } catch (e) {
      console.error("Backup delete all error:", e);
      return res.status(500).json({ message: "Ошибка удаления бэкапов" });
    }
  }));

  /** POST /api/admin/backup/cleanup — запустить немедленную очистку устаревших бэкапов */
  router.post("/backup/cleanup", asyncRoute(async (_req, res) => {
    try {
      const cfg = await getSystemConfig();
      const result = await cleanupOldBackups(cfg);
      return res.json({
        ok: true,
        message: result.deleted > 0
          ? `Очистка завершена: удалено ${result.deleted} бэкапов, освобождено ${(result.freedBytes / 1048576).toFixed(1)} МБ`
          : "Устаревших бэкапов не обнаружено",
        deleted: result.deleted,
        freedBytes: result.freedBytes,
      });
    } catch (e) {
      console.error("Backup cleanup error:", e);
      return res.status(500).json({ message: "Ошибка очистки бэкапов" });
    }
  }));

  /** GET /api/admin/backup/download?path=YYYY/MM/DD/filename.sql — скачать бэкап с сервера */
  router.get("/backup/download", asyncRoute(async (req, res) => {
    const pathParam = req.query.path as string | undefined;
    if (!pathParam || typeof pathParam !== "string") {
      return res.status(400).json({ message: "Укажите параметр path (относительный путь к бэкапу)" });
    }
    const fullPath = resolveBackupPath(pathParam);
    const fileStat = fullPath ? await stat(fullPath).catch(() => null) : null;
    if (!fullPath || !fileStat?.isFile()) return res.status(404).json({ message: "Бэкап не найден" });
    const filename = pathParam.split("/").pop() || "backup.sql";
    res.setHeader("Content-Type", filename.endsWith(".gz") ? "application/gzip" : "application/sql");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    const releaseDownload = holdBackup(fullPath);
    res.once("close", releaseDownload);
    res.download(fullPath, filename, (error) => {
      if (!error) return;
      if (res.headersSent) { res.destroy(error); return; }
      const status = (error as NodeJS.ErrnoException).code === "ENOENT" ? 404 : 500;
      res.status(status).json({ message: status === 404 ? "Бэкап не найден" : "Не удалось скачать бэкап." });
    });
  }));

  /**
   * POST /api/admin/backup/restore
   * Вариант 1: multipart с полем "file" и "confirm" = "RESTORE"
   * Вариант 2: JSON body { confirm: "RESTORE", path: "YYYY/MM/DD/filename.sql" } — восстановить с сервера
   */
  router.post("/backup/restore", upload.single("file"), asyncRoute(async (req, res) => {
    const url = process.env.DATABASE_URL;
    if (!url) return res.status(503).json({ message: "DATABASE_URL не задан" });
    const db = parseDatabaseUrl(url);
    if (!db) return res.status(503).json({ message: "Неверный формат DATABASE_URL" });
    if (req.body?.confirm !== "RESTORE") {
      return res.status(400).json({ message: "Подтвердите восстановление: укажите confirm: RESTORE" });
    }

    let input: Buffer | string;
    let filename: string;
    const serverPath = req.body?.path as string | undefined;
    if (serverPath && typeof serverPath === "string") {
      const fullPath = resolveBackupPath(serverPath);
      const fileStat = fullPath ? await stat(fullPath).catch(() => null) : null;
      if (!fullPath || !fileStat?.isFile() || fileStat.size === 0) return res.status(404).json({ message: "Бэкап на сервере не найден" });
      input = fullPath;
      filename = serverPath;
    } else {
      const file = (req as Request & { file?: Express.Multer.File }).file;
      if (!file || !file.buffer || file.buffer.length === 0) {
        return res.status(400).json({ message: "Выберите файл бэкапа (.sql или .sql.gz) или укажите path к сохранённому бэкапу" });
      }
      input = file.buffer;
      filename = file.originalname;
    }

    const releaseRestore = typeof input === "string" ? holdBackup(input) : () => {};
    try {
      await runPgRestore(db, input, filename);
      return res.json({ message: "База данных восстановлена из бэкапа." });
    } catch (e) {
      console.error("Backup restore error:", e);
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ message: msg, error: msg });
    } finally { releaseRestore(); }
  }));
}
