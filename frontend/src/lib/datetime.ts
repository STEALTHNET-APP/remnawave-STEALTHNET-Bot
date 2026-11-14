/**
 * T-msk (14.05.2026)
 *
 * Хелперы для отображения и редактирования дат **строго в Europe/Moscow**,
 * независимо от таймзоны браузера админа. Сервер уже отдаёт ISO с зоной (`Z`
 * или `+03`), задача фронта — рендерить эти моменты глазами МСК-админа.
 *
 *   fmtMsk(iso)               — "14.05.2026, 18:30:42"
 *   fmtMskDate(iso)           — "14.05.2026"
 *   fmtMskShort(iso)          — "14.05.2026, 18:30"
 *   isoToMskInputValue(iso)   — "2026-05-14T18:30" (для <input type=datetime-local>)
 *   mskInputValueToIso(v)     — обратно: "2026-05-14T18:30" → ISO UTC с Z
 *
 * Почему не `toLocaleString("ru", { timeZone: "Europe/Moscow" })` напрямую везде?
 * Можно и так — но (а) длинно, (б) легко забыть и получить TZ браузера. Поэтому
 * единая обёртка.
 */

const MSK_TZ = "Europe/Moscow";
const MSK_OFFSET_MINUTES = 3 * 60; // UTC+03, без DST

function toDate(input: string | number | Date | null | undefined): Date | null {
  if (input == null) return null;
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input;
  if (typeof input === "number") {
    const d = new Date(input);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof input === "string" && input.trim()) {
    const d = new Date(input);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** "14.05.2026, 18:30:42" — дата + время с секундами в МСК. */
export function fmtMsk(input: string | number | Date | null | undefined): string {
  const d = toDate(input);
  if (!d) return "—";
  return d.toLocaleString("ru-RU", {
    timeZone: MSK_TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** "14.05.2026, 18:30" — без секунд (для большинства таблиц). */
export function fmtMskShort(input: string | number | Date | null | undefined): string {
  const d = toDate(input);
  if (!d) return "—";
  return d.toLocaleString("ru-RU", {
    timeZone: MSK_TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "14.05.2026" — только дата. */
export function fmtMskDate(input: string | number | Date | null | undefined): string {
  const d = toDate(input);
  if (!d) return "—";
  return d.toLocaleDateString("ru-RU", {
    timeZone: MSK_TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/**
 * ISO → значение для `<input type="datetime-local">` в зоне МСК.
 * Возвращает "YYYY-MM-DDTHH:MM" (формат который понимает input).
 *
 * Пример: ISO "2026-05-14T15:30:42.000Z" (UTC 15:30) → "2026-05-14T18:30" (МСК).
 */
export function isoToMskInputValue(input: string | number | Date | null | undefined): string {
  const d = toDate(input);
  if (!d) return "";
  const mskMs = d.getTime() + MSK_OFFSET_MINUTES * 60_000;
  const m = new Date(mskMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${m.getUTCFullYear()}-${pad(m.getUTCMonth() + 1)}-${pad(m.getUTCDate())}T${pad(m.getUTCHours())}:${pad(m.getUTCMinutes())}`;
}

/**
 * Значение `<input type="datetime-local">` (трактуется как МСК) → ISO UTC с `Z`.
 *
 * Пример: "2026-05-14T18:30" (МСК 18:30) → "2026-05-14T15:30:00.000Z" (UTC).
 *
 * Если строка пустая или невалидная — возвращает `undefined`.
 */
export function mskInputValueToIso(value: string | null | undefined): string | undefined {
  if (!value || typeof value !== "string") return undefined;
  // Ожидаем "YYYY-MM-DDTHH:MM" или "YYYY-MM-DDTHH:MM:SS".
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return undefined;
  const [, y, mo, d, h, mi, s] = match;
  // Date.UTC(year, monthIdx, day, hour, min, sec) даёт UTC миллисекунды
  // если бы переданные компоненты были UTC. Они у нас МСК, поэтому вычитаем offset.
  const utcMs = Date.UTC(+y, +mo - 1, +d, +h, +mi, s ? +s : 0) - MSK_OFFSET_MINUTES * 60_000;
  return new Date(utcMs).toISOString();
}
