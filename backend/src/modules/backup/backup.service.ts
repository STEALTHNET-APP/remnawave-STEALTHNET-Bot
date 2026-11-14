/**
 * Сервис бэкапов: pg_dump (создание), хранение по дням, список, скачивание, psql (восстановление)
 * Требует postgresql-client в контейнере (apk add postgresql-client)
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeSqlArchive } from "./backup-archive.js";
import { readFile, readdir, stat, lstat, unlink, rmdir } from "node:fs/promises";
import path from "node:path";
import { lstatSync } from "node:fs";
import { backupIsActive, getBackupRetentionMs } from "./backup-retention.js";

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
    if ((await lstat(dir)).isSymbolicLink()) return;
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
  try {
    let current = base;
    if (lstatSync(current).isSymbolicLink()) return null;
    for (const part of relative.split(path.sep)) {
      current = path.join(current, part);
      if (lstatSync(current).isSymbolicLink()) return null;
    }
    if (!lstatSync(full).isFile()) return null;
  } catch { return null; }
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

async function removeArchive(relativePath: string): Promise<{ deleted: number; freedBytes: number }> {
  const result = { deleted: 0, freedBytes: 0 };
  const full = resolveBackupPath(relativePath);
  if (!full || backupIsActive(full)) return result;
  const info = await lstat(full).catch(() => null);
  if (!info?.isFile() || backupIsActive(full)) return result;
  try { await unlink(full); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return result;
    throw error;
  }
  result.deleted = 1;
  result.freedBytes = info.size;
  for (const suffix of [".delivered.json", ".manifest.json"]) {
    const companion = full + suffix;
    const metadata = await lstat(companion).catch(() => null);
    if (!metadata?.isFile()) continue;
    await unlink(companion).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
    result.freedBytes += metadata.size;
  }
  let parent = path.dirname(full);
  const base = path.resolve(BACKUPS_DIR);
  while (parent !== base && path.relative(base, parent) && !path.relative(base, parent).startsWith("..")) {
    try { await rmdir(parent); } catch { break; }
    parent = path.dirname(parent);
  }
  return result;
}

export async function cleanupOldBackups(
  retention: number | { backupRetentionValue?: number; backupRetentionUnit?: string; backupRetentionDays?: number },
): Promise<{ deleted: number; freedBytes: number }> {
  const result = { deleted: 0, freedBytes: 0 };
  const duration = getBackupRetentionMs(typeof retention === "number" ? { backupRetentionDays: retention } : retention);
  if (!Number.isFinite(duration) || duration <= 0) return result;
  const cutoff = Date.now() - duration;
  for (const archive of await listBackups()) {
    if (!archive.createdAt || new Date(archive.createdAt).getTime() >= cutoff) continue;
    const removed = await removeArchive(archive.path);
    result.deleted += removed.deleted;
    result.freedBytes += removed.freedBytes;
  }
  return result;
}

export async function deleteBackupFile(relativePath: string): Promise<boolean> {
  return (await removeArchive(relativePath)).deleted > 0;
}

export async function deleteAllBackups(): Promise<{ deleted: number; freedBytes: number }> {
  const result = { deleted: 0, freedBytes: 0 };
  for (const archive of await listBackups()) {
    const removed = await removeArchive(archive.path);
    result.deleted += removed.deleted;
    result.freedBytes += removed.freedBytes;
  }
  return result;
}
