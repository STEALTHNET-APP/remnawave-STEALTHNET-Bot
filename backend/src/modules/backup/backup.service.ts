/**
 * Сервис бэкапов: pg_dump (создание), хранение по дням, список, скачивание, psql (восстановление)
 * Требует postgresql-client в контейнере (apk add postgresql-client)
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeSqlArchive } from "./backup-archive.js";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const BACKUPS_DIR = process.env.BACKUPS_DIR || path.join(process.cwd(), "backups");

export interface DbConnection {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/** Парсит DATABASE_URL в объект подключения */
export function parseDatabaseUrl(url: string): DbConnection | null {
  try {
    const u = new URL(url.replace(/^postgresql:\/\//i, "postgres://"));
    const password = u.password ? decodeURIComponent(u.password) : "";
    return {
      host: u.hostname || "localhost",
      port: u.port ? parseInt(u.port, 10) : 5432,
      user: u.username || "postgres",
      password,
      database: u.pathname ? u.pathname.slice(1).replace(/\/.*$/, "") : "postgres",
    };
  } catch {
    return null;
  }
}

/** Запускает pg_dump и стримит вывод в переданный поток */
export function runPgDump(db: DbConnection): Promise<{ stream: NodeJS.ReadableStream; cleanup?: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, PGPASSWORD: db.password };
    const proc = spawn(
      "pg_dump",
      ["-h", db.host, "-p", String(db.port), "-U", db.user, "-d", db.database, "-F", "p", "--no-owner", "--no-acl", "--clean", "--if-exists"],
      { env }
    );
    proc.on("error", (err) => reject(err));
    proc.stderr?.on("data", (chunk) => console.error("[pg_dump]", chunk.toString()));
    proc.on("close", (code) => {
      if (code !== 0) reject(new Error(`pg_dump exited with code ${code}`));
    });
    resolve({ stream: proc.stdout! });
  });
}

/** Создаёт бэкап на диск в папку по дате (backups/YYYY/MM/DD/) и возвращает путь и имя файла */
export async function saveBackupToFile(db: DbConnection): Promise<{ relativePath: string; filename: string; fullPath: string }> {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const time = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `stealthnet-backup-${time}-${randomUUID()}.sql`;
  const dirPath = path.join(BACKUPS_DIR, String(y), m, d);
  const fullPath = path.join(dirPath, filename);
  const relativePath = path.join(String(y), m, d, filename);

  const { mkdir } = await import("node:fs/promises");
  await mkdir(dirPath, { recursive: true });

  const proc = spawn(
    "pg_dump",
    ["-h", db.host, "-p", String(db.port), "-U", db.user, "-d", db.database, "-F", "p", "--no-owner", "--no-acl", "--clean", "--if-exists"],
    { env: { ...process.env, PGPASSWORD: db.password }, stdio: ["ignore", "pipe", "pipe"] }
  );
  await writeSqlArchive(proc, fullPath);

  return { relativePath, filename, fullPath };
}

export interface BackupItem {
  path: string;
  filename: string;
  date: string;
  size: number;
  createdAt?: string;
  type?: "manual" | "automatic";
}

/** Список бэкапов (рекурсивно по backups/YYYY/MM/DD/ и backups/automatic/) */
export async function listBackups(): Promise<BackupItem[]> {
  const items: BackupItem[] = [];
  try {
    await walkDir(BACKUPS_DIR, "");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  return items.sort((a, b) => (b.createdAt || b.date).localeCompare(a.createdAt || a.date));

  async function walkDir(dir: string, prefix: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const rel = prefix ? path.join(prefix, e.name) : e.name;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walkDir(full, rel);
      } else if (e.isFile() && (e.name.endsWith(".sql") || e.name.endsWith(".sql.gz"))) {
        const st = await stat(full);
        const isAuto = e.name.endsWith(".sql.gz") || rel.startsWith("automatic/") || rel.startsWith("automatic\\");
        items.push({
          path: rel.replace(/\\/g, "/"),
          filename: e.name,
          date: isAuto ? st.mtime.toISOString().slice(0, 10).replace(/-/g, "/") : path.dirname(rel).replace(/\\/g, "/"),
          size: st.size,
          createdAt: st.mtime.toISOString(),
          type: isAuto ? "automatic" : "manual",
        });
      }
    }
  }
}

/** Безопасно разрешает относительный путь к файлу бэкапа; возвращает полный путь или null */
export function resolveBackupPath(relativePath: string): string | null {
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes("\\") || relativePath.split("/").some((part) => part === "..") || !/\.sql(?:\.gz)?$/i.test(relativePath)) return null;
  const base = path.resolve(BACKUPS_DIR);
  const full = path.resolve(base, relativePath);
  const relative = path.relative(base, full);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return full;
}

/** Читает файл бэкапа в буфер (для восстановления с сервера) */
export async function readBackupFile(relativePath: string): Promise<Buffer | null> {
  const full = resolveBackupPath(relativePath);
  if (!full) return null;
  try {
    return await readFile(full);
  } catch {
    return null;
  }
}

export { runPgRestore } from "./backup-restore.js";

/**
 * Удаляет бэкапы старше заданного времени (retention).
 * Поддерживает минуты, часы, дни (через config) или число дней (legacy).
 * Очищает как .sql (ручные), так и .sql.gz (автоматические),
 * а также связанные с ними метафайлы (.delivered.json, .manifest.json, .partial)
 * и зависшие .partial файлы старше 1 часа.
 */
export async function cleanupOldBackups(
  retention: number | { backupRetentionValue?: number; backupRetentionUnit?: string; backupRetentionDays?: number }
): Promise<{ deleted: number; freedBytes: number }> {
  const result = { deleted: 0, freedBytes: 0 };
  let retentionMs = 0;
  if (typeof retention === "number") {
    if (!Number.isFinite(retention) || retention <= 0) return result;
    // Если передано число < 1000 — трактуем как дни (legacy), если больше — как ms
    retentionMs = retention < 1000 ? retention * 86_400_000 : retention;
  } else if (retention && typeof retention === "object") {
    const { getBackupRetentionMs } = await import("../client/client.service.js");
    retentionMs = getBackupRetentionMs(retention);
  }
  if (!Number.isFinite(retentionMs) || retentionMs <= 0) return result; // 0 = хранить вечно

  const { readdir, stat, unlink, rmdir } = await import("node:fs/promises");
  const now = Date.now();
  const cutoff = now - retentionMs;
  const partialCutoff = now - 3_600_000; // зависшие .partial старше 1 часа

  const walk = async (dir: string): Promise<void> => {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return; // папки может не быть — это не ошибка
    }
    for (const name of entries) {
      const full = path.join(dir, name);
      let st;
      try {
        st = await stat(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        await walk(full);
        // подчищаем опустевшие папки дат (YYYY/MM/DD)
        try {
          const rest = await readdir(full);
          if (rest.length === 0) await rmdir(full);
        } catch {
          /* не критично */
        }
      } else {
        const isBackupArchive = name.endsWith(".sql") || name.endsWith(".sql.gz");
        const isOrphanPartial = name.endsWith(".partial") && st.mtimeMs < partialCutoff;
        if ((isBackupArchive && st.mtimeMs < cutoff) || isOrphanPartial) {
          try {
            await unlink(full);
            result.deleted++;
            result.freedBytes += st.size;
            // Удаляем сопутствующие файлы метаданных
            for (const suffix of [".delivered.json", ".manifest.json", ".partial"]) {
              try {
                const compPath = full + suffix;
                const compSt = await stat(compPath).catch(() => null);
                if (compSt) {
                  await unlink(compPath);
                  result.freedBytes += compSt.size;
                }
              } catch { /* игнорируем */ }
            }
          } catch (e) {
            console.error("[backup] не удалось удалить", full, e);
          }
        }
      }
    }
  };

  await walk(BACKUPS_DIR);
  if (result.deleted > 0) {
    console.log(`[backup] чистка: удалено ${result.deleted} бэкапов (срок ${Math.round(retentionMs / 60000)} мин.), освобождено ${(result.freedBytes / 1048576).toFixed(1)} МБ`);
  }
  return result;
}

/**
 * Удаляет один указанный файл бэкапа по относительному пути (вместе с сопутствующими метафайлами)
 */
export async function deleteBackupFile(relativePath: string): Promise<boolean> {
  const full = resolveBackupPath(relativePath);
  if (!full) return false;
  const { unlink, stat, readdir, rmdir } = await import("node:fs/promises");
  try {
    const st = await stat(full);
    if (!st.isFile()) return false;
    await unlink(full);
    // Удаляем сопутствующие метафайлы
    for (const suffix of [".delivered.json", ".manifest.json", ".partial"]) {
      try { await unlink(full + suffix); } catch {}
    }
    // Удаляем пустые родительские папки дат
    let parent = path.dirname(full);
    const base = path.resolve(BACKUPS_DIR);
    while (parent.startsWith(base) && parent !== base) {
      try {
        const remaining = await readdir(parent);
        if (remaining.length === 0) {
          await rmdir(parent);
          parent = path.dirname(parent);
        } else {
          break;
        }
      } catch {
        break;
      }
    }
    return true;
  } catch (e) {
    console.error("[backup] ошибка удаления бэкапа:", relativePath, e);
    return false;
  }
}

/**
 * Полностью удаляет все бэкапы на сервере (включая ручные и автоматические архивы)
 */
export async function deleteAllBackups(): Promise<{ deleted: number; freedBytes: number }> {
  const result = { deleted: 0, freedBytes: 0 };
  const { readdir, stat, unlink, rm } = await import("node:fs/promises");
  const base = path.resolve(BACKUPS_DIR);

  const walk = async (dir: string): Promise<void> => {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = path.join(dir, name);
      let st;
      try {
        st = await stat(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        await walk(full);
        try {
          if (full !== base) {
            await rm(full, { recursive: true, force: true });
          }
        } catch { /* игнорируем */ }
      } else {
        try {
          await unlink(full);
          result.deleted++;
          result.freedBytes += st.size;
        } catch (e) {
          console.error("[backup] не удалось удалить", full, e);
        }
      }
    }
  };

  await walk(base);
  console.log(`[backup] удалены все бэкапы: ${result.deleted} файлов, освобождено ${(result.freedBytes / 1048576).toFixed(1)} МБ`);
  return result;
}
