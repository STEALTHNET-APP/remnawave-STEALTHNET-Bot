import { statfs } from "node:fs/promises";
import path from "node:path";

export type BackupDiskUsage = { totalBytes: number; usedBytes: number; availableBytes: number; usedPercent: number };

export function diskUsageFromStats(stats: { blocks: number; bfree: number; bavail: number; bsize: number }): BackupDiskUsage | null {
  const totalBytes = stats.blocks * stats.bsize;
  const usedBytes = (stats.blocks - stats.bfree) * stats.bsize;
  const availableBytes = stats.bavail * stats.bsize;
  if (![totalBytes, usedBytes, availableBytes].every(Number.isFinite) || totalBytes <= 0 || usedBytes < 0 || usedBytes > totalBytes || availableBytes < 0) return null;
  return { totalBytes, usedBytes, availableBytes, usedPercent: Math.round(usedBytes / totalBytes * 100) };
}

export async function getBackupDiskUsage(archivePath: string): Promise<BackupDiskUsage | null> {
  try { return diskUsageFromStats(await statfs(path.dirname(archivePath))); }
  catch { return null; }
}

export function backupDiskLine(disk: BackupDiskUsage | null): string {
  if (!disk) return "💽 Диск сервера: нет данных";
  const gb = (bytes: number) => (bytes / 1024 ** 3).toFixed(1);
  return `💽 Диск сервера: ${gb(disk.usedBytes)} ГБ из ${gb(disk.totalBytes)} ГБ (${disk.usedPercent}%), доступно ${gb(disk.availableBytes)} ГБ`;
}
