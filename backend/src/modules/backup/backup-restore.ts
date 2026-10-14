import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm, stat, statfs } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { compatibleDumpHeader } from "./backup-archive.js";
import type { DbConnection } from "./backup.service.js";

const CLEAN_SCHEMA_SQL = "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; GRANT USAGE, CREATE ON SCHEMA public TO public;";
const MAX_RESTORE_BYTES = 8 * 1024 ** 3;
const RESTORE_DISK_RESERVE = 1024 ** 3;
const RESTORE_TIMEOUT_MS = 15 * 60_000;
let restoring = false;
interface RestoreLimits { maxBytes?: number; timeoutMs?: number }

/** Stage the entire input before psql: invalid/truncated gzip must never clear the live schema. */
export async function prepareRestore(input: Buffer | Readable | string, sqlPath: string, filename = "backup.sql", limits: RestoreLimits = {}): Promise<void> {
  const disk = await statfs(path.dirname(sqlPath));
  const maxBytes = Math.min(MAX_RESTORE_BYTES, limits.maxBytes ?? MAX_RESTORE_BYTES, disk.bavail * disk.bsize - RESTORE_DISK_RESERVE);
  const timeoutMs = Math.min(RESTORE_TIMEOUT_MS, limits.timeoutMs ?? RESTORE_TIMEOUT_MS);
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("Недостаточно места или неверный лимит подготовки бэкапа");
  }
  let bytes = 0;
  const bound = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    bytes += chunk.length;
    callback(bytes > maxBytes ? new Error("Restore size limit exceeded") : null, bytes > maxBytes ? undefined : chunk);
  } });
  const stream = typeof input === "string" ? createReadStream(input) : Buffer.isBuffer(input) ? Readable.from([input]) : input;
  const signal = AbortSignal.timeout(timeoutMs);
  const abort = () => { stream.destroy(new Error("Restore preparation timed out")); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    const iterator = stream[Symbol.asyncIterator]();
    const firstChunks: Buffer[] = [];
    let prefixBytes = 0;
    while (prefixBytes < 2) {
      const next = await iterator.next();
      if (next.done) break;
      const chunk = Buffer.isBuffer(next.value) ? next.value : Buffer.from(next.value as Uint8Array);
      firstChunks.push(chunk);
      prefixBytes += chunk.length;
    }
    const prefix = Buffer.concat(firstChunks);
    const gzip = filename.toLowerCase().endsWith(".gz") || (prefix[0] === 0x1f && prefix[1] === 0x8b);
    const source = Readable.from((async function* () {
      try {
        yield prefix;
        for (;;) {
          const next = await iterator.next();
          if (next.done) break;
          yield next.value;
        }
      } finally { stream.destroy(); }
    })());
    const output = createWriteStream(sqlPath, { flags: "wx", mode: 0o600 });
    if (gzip) await pipeline(source, createGunzip(), bound, compatibleDumpHeader(), output, { signal });
    else await pipeline(source, bound, compatibleDumpHeader(), output, { signal });
    if ((await stat(sqlPath)).size === 0) throw new Error("Пустой SQL-бэкап");
  } catch {
    throw new Error("Не удалось подготовить бэкап: пустой/повреждённый файл, превышен лимит размера/времени или ошибка записи");
  } finally {
    signal.removeEventListener("abort", abort);
    stream.destroy();
  }
}

function runPsql(db: DbConnection, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("psql", ["-X", "-h", db.host, "-p", String(db.port), "-U", db.user, "-d", db.database,
      "-v", "ON_ERROR_STOP=1", ...args], { env: { ...process.env, PGPASSWORD: db.password }, stdio: ["ignore", "pipe", "pipe"] });
    // Restore output can contain customer rows; never accumulate it or return it through the API.
    proc.stdout?.resume();
    proc.stderr?.resume();
    proc.once("error", () => reject(new Error("psql не запущен. Проверьте postgresql-client.")));
    proc.once("close", code => code === 0 ? resolve() : reject(new Error(`psql завершился с кодом ${code}`)));
  });
}

export async function runPgRestore(db: DbConnection, input: Buffer | Readable | string, filename = "backup.sql", limits: RestoreLimits = {}): Promise<void> {
  if (restoring) throw new Error("Восстановление уже выполняется");
  restoring = true;
  let dir: string | undefined;
  try {
    const tempRoot = path.join(process.cwd(), "temp");
    await mkdir(tempRoot, { recursive: true });
    dir = await mkdtemp(path.join(tempRoot, "stealthnet-restore-"));
    const sqlPath = path.join(dir, "restore.sql");
    await prepareRestore(input, sqlPath, filename, limits);
    await runPsql(db, ["--single-transaction", "-c", CLEAN_SCHEMA_SQL, "-f", sqlPath]);
  } finally {
    try {
      if (input instanceof Readable) input.destroy();
      if (dir) await rm(dir, { recursive: true, force: true });
    } finally { restoring = false; }
  }
}
