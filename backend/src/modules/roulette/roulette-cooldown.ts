export type CooldownSettings = { cooldownHours: number; resetMode?: "hours" | "daily"; timeZone?: string };

export function nextRouletteSpinAt(last: Date, settings: CooldownSettings): number {
  if (settings.resetMode !== "daily") return last.getTime() + settings.cooldownHours * 3600000;
  const format = new Intl.DateTimeFormat("en-CA", { timeZone: settings.timeZone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" });
  const day = format.format(last);
  let low = last.getTime();
  let high = low + 48 * 3600000;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (format.format(middle) === day) low = middle;
    else high = middle;
  }
  return high;
}
