/**
 * Чистая логика расписания UPCOMING-уведомлений автосписания (без БД) — тестируется отдельно.
 */

export type UpcomingTemplateLike = { id: string; offsetMinutes: number };

/** Минимальный допуск запоздания (cron/простой), минут. */
const MIN_CATCH_UP_MINUTES = 30;
/** Допуск запоздания как доля offset: «за 1 день» можно догнать до 6 часов, но не за 3 часа до конца. */
const CATCH_UP_FRACTION = 0.25;

/**
 * Какие UPCOMING-шаблоны должны уйти сейчас.
 *
 * Шаблон «за N минут» наступил, когда осталось 0 < minutesLeft <= N. Из наступивших берём
 * только самый близкий к истечению (минимальный offset; шаблоны с одинаковым offset — все):
 * если подписка куплена/обнаружена поздно, более дальние напоминания («за 3 дня») не шлём.
 * Запоздавшее более чем на max(30 мин, 25% offset) напоминание считается пропущенным.
 * Однократность на цикл обеспечивает dedup по `upcomingDedupBucket`.
 */
export function pickDueUpcomingTemplates<T extends UpcomingTemplateLike>(
  templates: readonly T[],
  minutesLeft: number,
): T[] {
  if (!(minutesLeft > 0)) return [];
  const due = templates.filter((t) => {
    if (minutesLeft > t.offsetMinutes) return false;
    const lateness = t.offsetMinutes - minutesLeft;
    return lateness <= Math.max(MIN_CATCH_UP_MINUTES, t.offsetMinutes * CATCH_UP_FRACTION);
  });
  if (due.length === 0) return [];
  const closest = Math.min(...due.map((t) => t.offsetMinutes));
  return due.filter((t) => t.offsetMinutes === closest);
}

/**
 * Значение дедуп-bucket для UPCOMING: привязано к моменту истечения (а не к часу), поэтому
 * шаблон уходит один раз за цикл подписки, а продление (новый expireAt) сбрасывает дедуп.
 * Без expireAt — прежний временной bucket floor(now / ttl).
 */
export function upcomingDedupBucket(expireAt: Date | null | undefined, nowMs: number, ttlMs: number): string {
  if (expireAt && !Number.isNaN(expireAt.getTime())) return `exp${expireAt.getTime()}`;
  return String(Math.floor(nowMs / ttlMs));
}
