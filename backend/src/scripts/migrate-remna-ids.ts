/**
 * Перепривязка подписок к Remnawave 3.x.
 *
 * В Remnawave 3.x пользователь адресуется числовым `id`, поля `uuid` больше нет.
 * У панелей, которые жили на 2.x, в `subscriptions.remnawave_uuid` остались UUID —
 * после обновления Remnawave каждый запрос `/api/users/<uuid>` отдаёт 400
 * («expected number, received NaN»), и у КАЖДОГО клиента подписка пропадает:
 * в боте «нет подписки», в кабинете «Неактивна», хотя в админке всё на месте.
 *
 * Здесь мы одноразово подбираем каждому UUID числовой id по данным, которые
 * есть с обеих сторон, в порядке убывания надёжности:
 *   1. `short_uuid` → `shortUuid`      — однозначно;
 *   2. `telegram_id` → `telegramId` и `email` → `email`; если у клиента
 *      несколько аккаунтов — уточняем по суффиксу `_<index>` в `username`;
 *   3. `expire_at` → `expireAt`        — разводит пары, которые не развёл суффикс.
 *
 * Осторожность важнее полноты: строки, где кандидат неоднозначен или уже занят
 * другой подпиской, НЕ трогаем — их видно в логе, владелец разберёт руками.
 * Записи с числовым id не трогаются вообще, так что повторный запуск безопасен.
 *
 * `payments.remnawave_user_id` намеренно не мигрируем: это исторические записи,
 * на работу подписок они не влияют.
 */

import { prisma } from "../db.js";
import { isRemnaConfigured, remnaGetUsers } from "../modules/remna/remna.client.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 500;

interface RemnaUser {
  id?: unknown;
  uuid?: unknown;
  shortUuid?: unknown;
  username?: unknown;
  email?: unknown;
  telegramId?: unknown;
  expireAt?: unknown;
}

interface StaleRow {
  id: string;
  subscription_index: number | null;
  short_uuid: string | null;
  expire_at: Date | null;
  email: string | null;
  telegram_id: bigint | null;
}

export interface RemnaIdMigrationResult {
  /** false — миграция не требовалась (2.x, не настроено, нечего чинить) */
  ran: boolean;
  scanned: number;
  fixed: number;
  unresolved: number;
}

/** Все пользователи Remnawave постранично. */
async function fetchAllUsers(): Promise<RemnaUser[]> {
  const out: RemnaUser[] = [];
  let start = 0;
  for (;;) {
    // remnaFetch отдаёт обёртку { data, error, status } — тело лежит в data,
    // а сама Remnawave заворачивает полезную нагрузку ещё и в response.
    const res = (await remnaGetUsers({ size: PAGE, start })) as { data?: unknown };
    const body = (res?.data ?? res) as Record<string, unknown>;
    const resp = (body?.response ?? body) as Record<string, unknown>;
    const batch = (resp?.users ?? resp?.items ?? []) as RemnaUser[];
    if (!Array.isArray(batch) || batch.length === 0) break;
    out.push(...batch);
    start += batch.length;
    const total = typeof resp?.total === "number" ? resp.total : out.length;
    if (out.length >= total) break;
  }
  return out;
}

function day(v: unknown): string | null {
  if (typeof v === "string" && v.length >= 10) return v.slice(0, 10);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return null;
}

/** Из нескольких аккаунтов клиента выбираем по суффиксу `_<index>`, затем по дате. */
function disambiguate(cands: RemnaUser[], index: number | null, expire: Date | null): RemnaUser | null {
  if (cands.length === 1) return cands[0];
  if (index != null) {
    const bySuffix = cands.filter((c) => new RegExp(`_${index}$`).test(String(c.username ?? "")));
    if (bySuffix.length === 1) return bySuffix[0];
  }
  const target = day(expire);
  if (target) {
    const byDate = cands.filter((c) => day(c.expireAt) === target);
    if (byDate.length === 1) return byDate[0];
  }
  return null;
}

export async function migrateRemnaIds(): Promise<RemnaIdMigrationResult> {
  const idle: RemnaIdMigrationResult = { ran: false, scanned: 0, fixed: 0, unresolved: 0 };
  if (!isRemnaConfigured()) return idle;

  const stale = await prisma.$queryRawUnsafe<StaleRow[]>(`
    SELECT s.id, s.subscription_index, s.short_uuid, s.expire_at, c.email, c.telegram_id
    FROM subscriptions s
    JOIN clients c ON c.id = s.owner_id
    WHERE s.remnawave_uuid IS NOT NULL AND s.remnawave_uuid !~ '^[0-9]+$'
  `);
  if (stale.length === 0) return idle;

  const users = await fetchAllUsers();
  if (users.length === 0) return idle;

  // На 2.x идентификаторы-UUID корректны — мигрировать нечего.
  const isV3 = users.some((u) => typeof u.id === "number") && users.every((u) => u.uuid == null);
  if (!isV3) return idle;

  // id, уже занятые исправными подписками, второй раз не раздаём.
  const takenRows = await prisma.$queryRawUnsafe<{ remnawave_uuid: string }[]>(
    `SELECT remnawave_uuid FROM subscriptions WHERE remnawave_uuid ~ '^[0-9]+$'`,
  );
  const taken = new Set(takenRows.map((r) => r.remnawave_uuid));

  const byShort = new Map<string, RemnaUser>();
  const byTg = new Map<string, RemnaUser[]>();
  const byEmail = new Map<string, RemnaUser[]>();
  for (const u of users) {
    if (typeof u.id !== "number" || taken.has(String(u.id))) continue;
    if (typeof u.shortUuid === "string" && u.shortUuid) byShort.set(u.shortUuid, u);
    if (u.telegramId != null) {
      const k = String(u.telegramId);
      byTg.set(k, [...(byTg.get(k) ?? []), u]);
    }
    if (typeof u.email === "string" && u.email.trim()) {
      const k = u.email.trim().toLowerCase();
      byEmail.set(k, [...(byEmail.get(k) ?? []), u]);
    }
  }

  const picked = new Map<string, string>(); // subscriptionId → remna id
  const claimed = new Set<string>();
  for (const row of stale) {
    let hit: RemnaUser | null = null;
    if (row.short_uuid && byShort.has(row.short_uuid)) hit = byShort.get(row.short_uuid) ?? null;
    if (!hit && row.telegram_id != null) {
      hit = disambiguate(byTg.get(String(row.telegram_id)) ?? [], row.subscription_index, row.expire_at);
    }
    if (!hit && row.email) {
      hit = disambiguate(byEmail.get(row.email.trim().toLowerCase()) ?? [], row.subscription_index, row.expire_at);
    }
    if (!hit || typeof hit.id !== "number") continue;
    const target = String(hit.id);
    // один аккаунт Remnawave не может принадлежать двум подпискам
    if (claimed.has(target)) {
      picked.delete(target);
      continue;
    }
    claimed.add(target);
    picked.set(row.id, target);
  }

  let fixed = 0;
  for (const [subscriptionId, remnaId] of picked) {
    try {
      await prisma.$executeRawUnsafe(
        `UPDATE subscriptions SET remnawave_uuid = $1 WHERE id = $2 AND remnawave_uuid !~ '^[0-9]+$'`,
        remnaId,
        subscriptionId,
      );
      fixed++;
    } catch (e) {
      console.error(`[remna-ids] не удалось перепривязать подписку ${subscriptionId}:`, e);
    }
  }

  // Клиенту проставляем id его основной (нулевой) подписки — тем же значением,
  // что уже проверено выше, без отдельного подбора.
  if (fixed > 0) {
    await prisma.$executeRawUnsafe(`
      UPDATE clients c SET remnawave_uuid = s.remnawave_uuid
      FROM subscriptions s
      WHERE s.owner_id = c.id
        AND coalesce(s.subscription_index, 0) = 0
        AND s.remnawave_uuid ~ '^[0-9]+$'
        AND (c.remnawave_uuid IS NULL OR c.remnawave_uuid !~ '^[0-9]+$')
    `);
  }

  return { ran: true, scanned: stale.length, fixed, unresolved: stale.length - fixed };
}

/** Проверка формата — вынесена для тестов и переиспользования. */
export function isLegacyRemnaUuid(value: string | null | undefined): boolean {
  return typeof value === "string" && UUID_RE.test(value);
}
