import { holdBackup } from "./backup-retention.js";
import cron, { type ScheduledTask } from "node-cron";
import { writeFile } from "node:fs/promises";
import { getSystemConfig } from "../client/client.service.js";
import { parseDatabaseUrl } from "./backup.service.js";
import { TELEGRAM_PART_BYTES, readFileParts, saveCompressedBackup } from "./backup-archive.js";
import { proxyFetch } from "../proxy-util/proxy-fetch.js";
import { getProxyUrl } from "../proxy-util/get-proxy-url.js";

const DEFAULT_CRON = "0 7 * * *";
const CLEANUP_CRON = "*/10 * * * *";
const LOG = "[auto-backup]";
let currentTask: ScheduledTask | null = null;
let cleanupTask: ScheduledTask | null = null;
let running = false;

interface TelegramDestination { botToken: string; chatId: string; topicId: number | null }
interface TelegramResult { ok?: boolean; description?: string; result?: { message_id?: number }; parameters?: { retry_after?: number } }

async function sendDocument(destination: TelegramDestination, buffer: Buffer, filename: string, caption: string): Promise<number> {
  const proxy = await getProxyUrl("telegram");
  for (let attempt = 0; attempt < 3; attempt++) {
    const form = new FormData();
    form.append("chat_id", destination.chatId);
    if (destination.topicId !== null) form.append("message_thread_id", String(destination.topicId));
    form.append("caption", caption);
    form.append("document", new Blob([new Uint8Array(buffer)]), filename);
    let result: TelegramResult;
    try {
      const res = await proxyFetch(`https://api.telegram.org/bot${destination.botToken}/sendDocument`, {
        method: "POST", body: form, signal: AbortSignal.timeout(5 * 60_000),
      }, proxy);
      result = await res.json() as TelegramResult;
    } catch {
      // Never expose token-bearing request URLs in logs or API errors.
      if (attempt === 2) throw new Error(`Telegram upload failed: ${filename}`);
      await new Promise(resolve => setTimeout(resolve, 3000 * (attempt + 1)));
      continue;
    }
    if (result.ok && typeof result.result?.message_id === "number") return result.result.message_id;
    const retryAfter = result.parameters?.retry_after;
    if (retryAfter && attempt < 2) {
      await new Promise(resolve => setTimeout(resolve, Math.min(retryAfter, 120) * 1000));
      continue;
    }
    throw new Error(`Telegram rejected backup ${filename}`);
  }
  throw new Error(`Telegram upload failed: ${filename}`);
}

export async function runAutoBackup(options: { force?: boolean } = {}): Promise<void> {
  if (running) throw new Error("Создание бэкапа уже выполняется");
  running = true;
  try {
    const config = await getSystemConfig();
    if (!options.force && !config.autoBackupEnabled) return;
    const botToken = config.telegramBotToken?.trim();
    const chatId = config.notificationTelegramGroupId?.trim();
    if (!botToken || !chatId) throw new Error("Не настроены Telegram-бот и группа для бэкапов");
    const topic = config.notificationTopicBackups?.trim();
    const topicId = topic ? Number(topic) : null;
    if (topicId !== null && (!Number.isSafeInteger(topicId) || topicId <= 0)) throw new Error("Некорректный ID темы бэкапов");
    const destination = { botToken, chatId, topicId };
    const sources: { name: "bot"; label: string; url: string | undefined }[] = [
      { name: "bot", label: "База бота", url: process.env.DATABASE_URL },
    ];
    const failures: string[] = [];
    for (const source of sources) {
      try {
        const db = source.url && parseDatabaseUrl(source.url);
        if (!db) throw new Error(`Не настроено подключение к БД: ${source.name}`);
        console.log(`${LOG} Creating compressed backup: ${source.name}`);
        const archive = await saveCompressedBackup(db, source.name);
        const release = holdBackup(archive.fullPath);
        const total = Math.ceil(archive.bytes / TELEGRAM_PART_BYTES);
        try {
        const messages: number[] = [];
        let index = 0;
        for await (const part of readFileParts(archive.fullPath)) {
          index++;
          const partName = total === 1 ? archive.filename : `${archive.filename}.part${String(index).padStart(3, "0")}-of-${String(total).padStart(3, "0")}`;
          const caption = `💾 ${source.label}\n${new Date().toISOString()}\n${archive.filename}\nЧасть ${index}/${total} · ${(part.length / 1048576).toFixed(1)} МБ\nПосле получения всех частей: объединить по порядку, распаковать gzip → SQL.\nSHA256 целого архива: ${archive.sha256}`;
          messages.push(await sendDocument(destination, part, partName, caption));
          console.log(`${LOG} Delivered ${source.name} part ${index}/${total}, message ${messages.at(-1)}`);
        }
        const manifest = { filename: archive.filename, bytes: archive.bytes, sha256: archive.sha256, source: source.name, format: "SQL + gzip", parts: total, messages, chatId, topicId, deliveredAt: new Date().toISOString() };
        await sendDocument(destination, Buffer.from(JSON.stringify(manifest, null, 2)), `${archive.filename}.manifest.json`, `✅ ${source.label}: все ${total} частей отправлены. Контрольная сумма и список сообщений — в файле.`);
        await writeFile(`${archive.fullPath}.delivered.json`, JSON.stringify(manifest, null, 2), { mode: 0o600 });
        } finally { release(); }
        try {
          const { cleanupOldBackups } = await import("./backup.service.js");
          await cleanupOldBackups(config);
        } catch (e) {
          console.error(`${LOG} cleanupOldBackups error:`, e);
        }
        console.log(`${LOG} Backup complete: ${source.name}, ${archive.bytes} bytes, ${total} parts`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown backup failure";
        console.error(`${LOG} ${source.name}: ${message}`);
        failures.push(`${source.label}: ${message}`);
      }
    }
    if (failures.length) {
      const summary = failures.join("; ");
      await sendDocument(destination, Buffer.from(summary), "stealthnet-backup-error.txt", "⚠️ Резервное копирование завершилось с ошибкой. Подробности в файле.")
        .catch(() => console.error(`${LOG} Could not deliver failure notification`));
      throw new Error(summary);
    }
  } finally { running = false; }
}

export async function startAutoBackupScheduler(): Promise<void> {
  const config = await getSystemConfig();

  // Фоновая периодическая чистка устаревших бэкапов (каждые 10 минут)
  if (!cleanupTask) {
    cleanupTask = cron.schedule(CLEANUP_CRON, async () => {
      try {
        const cfg = await getSystemConfig();
        const { cleanupOldBackups } = await import("./backup.service.js");
        await cleanupOldBackups(cfg);
      } catch (error) {
        console.error(LOG, "Periodic cleanup error:", error instanceof Error ? error.message : error);
      }
    });
  }

  if (!config.autoBackupEnabled) {
    console.log(`${LOG} Disabled, skip scheduler`);
    return;
  }
  const configured = config.autoBackupCron?.trim();
  const schedule = configured && cron.validate(configured) ? configured : DEFAULT_CRON;
  currentTask = cron.schedule(schedule, async () => {
    try { await runAutoBackup(); }
    catch (error) { console.error(LOG, error instanceof Error ? error.message : "Backup failed"); }
  });
  console.log(`${LOG} Scheduler started: ${schedule} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`);
}

export async function restartAutoBackupScheduler(): Promise<void> {
  stopAutoBackupScheduler();
  await startAutoBackupScheduler();
}

export function stopAutoBackupScheduler(): void {
  currentTask?.stop();
  currentTask = null;
  cleanupTask?.stop();
  cleanupTask = null;
}
