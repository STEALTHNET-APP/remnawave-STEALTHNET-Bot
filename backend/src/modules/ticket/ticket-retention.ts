export function calculateRetentionCutoff(
  value: number,
  unit: "minutes" | "hours" | "days",
  now = new Date(),
): Date | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const multiplier = unit === "minutes" ? 60 * 1000 : unit === "hours" ? 3600 * 1000 : 86400 * 1000;
  return new Date(now.getTime() - value * multiplier);
}
