export function getBackupRetentionMs(config: { backupRetentionValue?: number; backupRetentionUnit?: string; backupRetentionDays?: number }): number {
  const value = config.backupRetentionValue ?? config.backupRetentionDays ?? 30;
  if (!Number.isFinite(value) || value <= 0) return 0;
  const unit = config.backupRetentionUnit ?? "days";
  return value * (unit === "minutes" ? 60_000 : unit === "hours" ? 3_600_000 : 86_400_000);
}

const active = new Map<string, number>();

export function holdBackup(file: string): () => void {
  active.set(file, (active.get(file) ?? 0) + 1);
  return () => {
    const count = (active.get(file) ?? 1) - 1;
    if (count > 0) active.set(file, count);
    else active.delete(file);
  };
}

export function backupIsActive(file: string): boolean {
  return active.has(file);
}
