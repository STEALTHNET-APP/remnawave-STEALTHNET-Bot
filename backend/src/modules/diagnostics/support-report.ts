const categories = ["remna-sync", "subscription/all", "payment", "webhook", "updater", "backup", "prisma", "telegram", "cron"];

export function summarizeDiagnosticLog(line: { ts: number; level: string; text: string }) {
  const lower = line.text.toLowerCase();
  const http = line.text.match(/\bHTTP(?:\s+status)?[ :=]+([45]\d{2})\b/i);
  const prisma = line.text.match(/\bP(?:1|2)\d{3}\b/);
  const system = line.text.match(/\b(ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|ENOSPC|EACCES)\b/);
  return {
    at: new Date(line.ts).toISOString(),
    level: ["error", "warn", "info", "log", "debug"].includes(line.level) ? line.level : "log",
    category: categories.find(category => lower.includes(category)) ?? "application",
    ...(http ? { httpStatus: Number(http[1]) } : {}),
    ...(prisma || system ? { errorCode: prisma?.[0] ?? system?.[0] } : {}),
  };
}

export function reportUpdateStatus(data: Record<string, unknown>) {
  const status = data.status as Record<string, unknown> | undefined;
  if (!status) return { connected: false };
  const allowedPhases = ["idle", "checking", "ready", "building", "rehearsal", "backup", "installing", "verifying", "success", "failed", "interrupted"];
  return {
    connected: true,
    phase: allowedPhases.includes(String(status.phase)) ? status.phase : "unknown",
    recoveryRequired: status.recoveryRequired === true,
    rolledBack: status.rolledBack === true,
    writesResumed: status.writesResumed === true,
    available: status.available === true,
    ...(typeof status.target === "string" && /^[a-f0-9]{40}$/.test(status.target) ? { target: status.target } : {}),
  };
}
