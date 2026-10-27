import { type ChildProcess, spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { createGzip } from "node:zlib";
import { holdBackup } from "./backup-retention.js";
import type { DbConnection } from "./backup.service.js";

export const TELEGRAM_PART_BYTES = 45 * 1024 * 1024;
export const AUTO_BACKUPS_DIR = path.join(process.env.BACKUPS_DIR || path.join(process.cwd(), "backups"), "automatic");

/** New pg_dump clients emit this SET even for PG16, which cannot restore it. */
export function compatibleDumpHeader(): Transform {
  let prefix = Buffer.alloc(0);
  let flushed = false;
  const clean = (buffer: Buffer) => Buffer.from(buffer.toString("utf8").replace(/^SET transaction_timeout = 0;\r?\n/m, ""));
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      if (flushed) { callback(null, chunk); return; }
      prefix = Buffer.concat([prefix, chunk]);
      // pg_dump's ASCII prologue ends before the first schema object.
      const end = prefix.indexOf("--\n-- Name:");
      if (end >= 0 || prefix.length >= 16_384) {
        const boundary = end >= 0 ? end : prefix.lastIndexOf(10, 16_384) + 1;
        this.push(clean(prefix.subarray(0, boundary)));
        this.push(prefix.subarray(boundary));
        prefix = Buffer.alloc(0);
        flushed = true;
      }
      callback();
    },
    flush(callback) { if (!flushed) this.push(clean(prefix)); callback(); },
  });
}

/** A closed stdout is insufficient: pg_dump can still exit unsuccessfully afterwards. */
export function writeGzipArchive(proc: ChildProcess, fullPath: string): Promise<void> {
  return writeArchive(proc, fullPath, true);
}

export function writeSqlArchive(proc: ChildProcess, fullPath: string): Promise<void> {
  return writeArchive(proc, fullPath, false);
}

async function writeArchive(proc: ChildProcess, fullPath: string, gzip: boolean): Promise<void> {
  const release = holdBackup(fullPath);
  const partial = `${fullPath}.partial`;
  const exited = new Promise<void>((resolve, reject) => {
    proc.once("error", reject);
    proc.once("close", (code) => code === 0 ? resolve() : reject(new Error(`pg_dump exited with code ${code}`)));
  });
  proc.stderr?.resume(); // Do not log connection details or SQL data.
  let compressed: Promise<void> | undefined;
  try {
    if (!proc.stdout) throw new Error("pg_dump stdout unavailable");
    const output = createWriteStream(partial, { flags: "wx", mode: 0o600 });
    compressed = gzip
      ? pipeline(proc.stdout, compatibleDumpHeader(), createGzip({ level: 6 }), output)
      : pipeline(proc.stdout, compatibleDumpHeader(), output);
    await Promise.all([exited, compressed]);
    if ((await stat(partial)).size <= (gzip ? 20 : 0)) throw new Error("pg_dump produced an empty archive");
    await rename(partial, fullPath);
  } catch (error) {
    proc.kill();
    await Promise.allSettled([exited, compressed]);
    await rm(partial, { force: true });
    throw error;
  } finally { release(); }
}

export async function saveCompressedBackup(db: DbConnection, source: "bot") {
  await mkdir(AUTO_BACKUPS_DIR, { recursive: true, mode: 0o700 });
  const filename = `stealthnet-${source}-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.sql.gz`;
  const fullPath = path.join(AUTO_BACKUPS_DIR, filename);
  const proc = spawn("pg_dump", [
    "-h", db.host, "-p", String(db.port), "-U", db.user, "-d", db.database,
    "-F", "p", "--no-owner", "--no-acl", "--clean", "--if-exists",
  ], { env: { ...process.env, PGPASSWORD: db.password }, stdio: ["ignore", "pipe", "pipe"] });
  await writeGzipArchive(proc, fullPath);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(fullPath)) hash.update(chunk);
  return { filename, fullPath, bytes: (await stat(fullPath)).size, sha256: hash.digest("hex") };
}

/** Read bounded buffers even when the compressed backup exceeds Node's Buffer limit. */
export async function* readFileParts(filePath: string, limit = TELEGRAM_PART_BYTES): AsyncGenerator<Buffer> {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Invalid backup part size");
  const file = await open(filePath, "r");
  try {
    const size = (await file.stat()).size;
    for (let position = 0; position < size; position += limit) {
      const length = Math.min(limit, size - position);
      const part = Buffer.allocUnsafe(length);
      let offset = 0;
      while (offset < length) {
        const { bytesRead } = await file.read(part, offset, length - offset, position + offset);
        if (bytesRead === 0) throw new Error("Backup truncated during upload");
        offset += bytesRead;
      }
      yield part;
    }
  } finally { await file.close(); }
}

/** Manual snapshots and failed deliveries are never removed by automatic retention. */
export async function pruneDeliveredBackups(dir: string, prefix: string, retentionDays: number, keep = 7, now = Date.now()): Promise<void> {
  if (!Number.isSafeInteger(keep) || keep < 7) throw new Error("Invalid backup retention");
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return;
  const suffix = ".sql.gz.delivered.json";
  const markers: { name: string; deliveredAt: number }[] = [];
  for (const name of await readdir(dir)) {
    if (!name.startsWith(prefix) || !name.endsWith(suffix)) continue;
    try {
      const marker: unknown = JSON.parse(await readFile(path.join(dir, name), "utf8"));
      if (!marker || typeof marker !== "object" || !("deliveredAt" in marker) || typeof marker.deliveredAt !== "string") continue;
      const deliveredAt = Date.parse(marker.deliveredAt);
      if (!Number.isFinite(deliveredAt)) continue;
      const archive = await stat(path.join(dir, name.slice(0, -".delivered.json".length)));
      if (archive.isFile()) markers.push({ name, deliveredAt });
    } catch { /* Incomplete markers cannot authorize deletion. */ }
  }
  markers.sort((a, b) => b.deliveredAt - a.deliveredAt);
  const cutoff = now - retentionDays * 86_400_000;
  for (const { name: marker, deliveredAt } of markers.slice(keep)) {
    if (deliveredAt >= cutoff) continue;
    const archive = marker.slice(0, -".delivered.json".length);
    await rm(path.join(dir, archive), { force: true });
    await rm(path.join(dir, marker));
  }
}
