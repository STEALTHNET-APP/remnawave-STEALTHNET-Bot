/**
 * T-anti-abuse (15.06.2026, WolfVPN): сбор потребления трафика per-subscription за окно.
 *
 * Источник цифры — Remna bandwidth-stats (GET /api/bandwidth-stats/nodes/{uuid}/users),
 * который отдаёт top-N потребителей на ноду за диапазон ДАТ. Гранулярность — день
 * (categories = даты), поэтому окна считаем в часах и конвертируем в date-range
 * [start, end] (YYYY-MM-DD). Sub-day окна (hour) округляются до текущего дня.
 *
 * node-usage возвращает username, а у нас в БД хранится только remnawaveUuid — поэтому
 * резолвим username→uuid через список users Remna (с TTL-кэшем в пределах прогона).
 * Дальше движок (anti-abuse.scheduler) матчит uuid на subscription по remnawaveUuid.
 */

import {
  remnaGetNodes,
  remnaGetNodeUsersUsage,
  remnaGetUsers,
  isRemnaConfigured,
} from "../remna/remna.client.js";

export type AbuseWindowKind = "hour" | "day" | "week" | "custom" | "rolling";

export interface ResolvedWindow {
  kind: AbuseWindowKind;
  hours: number;
  /** YYYY-MM-DD — нижняя граница для Remna bandwidth API. */
  start: string;
  /** YYYY-MM-DD — верхняя граница (сегодня). */
  end: string;
  /** Календарная метка окна для дедупа предупреждений и сброса state на новом окне. */
  windowKey: string;
}

export interface UsageEntry {
  username: string;
  uuid: string;
  /** Суммарное потребление за окно (байты), сложенное по всем нодам (для day/week/custom). */
  periodBytes: number;
  /** Накопительный lifetimeUsedTrafficBytes (для rolling: дельта между замерами = трафик за интервал). */
  lifetimeBytes: number;
  /** Статус юзера в Remna (ACTIVE / DISABLED / LIMITED / EXPIRED). */
  status: string;
}

function pad2(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** ISO-номер недели для windowKey week-окна (формат "2026-W24"). */
function isoWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = date.getTime();
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = 1 + Math.round(((firstThursday - yearStart.getTime()) / 86_400_000 - 3 + ((yearStart.getUTCDay() + 6) % 7)) / 7);
  return `${date.getUTCFullYear()}-W${pad2(week)}`;
}

/** Длина окна в часах по виду. */
export function windowHours(kind: AbuseWindowKind, valueHours: number | null | undefined): number {
  if (kind === "hour") return 1;
  if (kind === "day") return 24;
  if (kind === "week") return 168;
  if (kind === "rolling") return Math.max(1, valueHours ?? 1); // rolling: интервал в часах (для banDuration)
  return Math.max(1, valueHours ?? 24); // custom
}

/**
 * Вычислить date-range и календарную метку окна.
 * windowKey фиксирует «период» так, чтобы предупреждение слалось 1 раз за календарный
 * час/день/неделю, а на новом периоде — снова разрешалось (естественный сброс state).
 */
export function resolveWindow(
  kind: AbuseWindowKind,
  valueHours: number | null | undefined,
  now: Date,
): ResolvedWindow {
  const hours = windowHours(kind, valueHours);
  // Remna bandwidth-stats работает по КАЛЕНДАРНЫМ дням. Считаем, сколько дней покрыть,
  // чтобы «сутки» = сегодня (1 день), «неделя» = 7 дней, без двойного учёта пограничного
  // дня (иначе day давал бы «вчера+сегодня» ≈ до 48ч → завышение и ложные срабатывания).
  const dayCount = Math.max(1, Math.ceil(hours / 24));
  const startDate = new Date(now.getTime() - (dayCount - 1) * 86_400_000);

  let windowKey: string;
  if (kind === "rolling") windowKey = "rolling"; // дельта-режим: дедуп не по календарю
  else if (kind === "hour") windowKey = `${ymd(now)}-${pad2(now.getUTCHours())}`;
  else if (kind === "week") windowKey = isoWeekKey(now);
  else if (kind === "custom") windowKey = `${ymd(startDate)}_${ymd(now)}`;
  else windowKey = ymd(now); // day

  return { kind, hours, start: ymd(startDate), end: ymd(now), windowKey };
}

// ---- Индекс username → {uuid, status} (TTL-кэш на прогон) -------------------

const PAGE_SIZE = 500;
/** Потолок 200k юзеров (60k+ с запасом). */
const MAX_PAGES = 400;
/** TTL индекса: несколько правил/окон в одном прогоне переиспользуют один индекс. */
const USER_INDEX_TTL_MS = 5 * 60 * 1000;

interface RemnaUserLite {
  uuid: string;
  username: string;
  status: string;
  lifetimeBytes: number;
}

let _userIndexCache: { data: Map<string, RemnaUserLite>; ts: number } | null = null;

interface RemnaUserRow {
  uuid: string;
  username: string;
  status: string;
  userTraffic?: { lifetimeUsedTrafficBytes?: number | string };
}
interface RemnaUsersPage {
  response?: { users?: RemnaUserRow[]; total?: number };
}

/** Накопительный lifetime-счётчик юзера (никогда не сбрасывается; нормализуем строку/число). */
function liftLifetime(u: RemnaUserRow): number {
  const raw: unknown = u.userTraffic?.lifetimeUsedTrafficBytes;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : 0;
}

async function loadUserIndex(): Promise<Map<string, RemnaUserLite>> {
  const index = new Map<string, RemnaUserLite>();

  const first = await remnaGetUsers({ size: PAGE_SIZE, start: 0 });
  if (first.error || !first.data) {
    console.error("[anti-abuse] loadUserIndex: первая страница не получена:", first.error);
    return index;
  }
  const firstData = first.data as RemnaUsersPage;
  const firstUsers = firstData.response?.users ?? [];
  const total = firstData.response?.total ?? firstUsers.length;
  for (const u of firstUsers) {
    if (u.username) index.set(u.username, { uuid: u.uuid, username: u.username, status: u.status, lifetimeBytes: liftLifetime(u) });
  }

  if (total <= PAGE_SIZE) return index;

  const pages = Math.min(Math.ceil(total / PAGE_SIZE), MAX_PAGES);
  // Батчим страницы с ограниченной конкуренцией — иначе ~120 одновременных запросов
  // к Remna кладут API (rate-limit / пул соединений) и часть страниц молча теряется.
  const CONCURRENCY = 8;
  let failedPages = 0;
  for (let batchStart = 1; batchStart < pages; batchStart += CONCURRENCY) {
    const batch = [];
    for (let i = batchStart; i < Math.min(batchStart + CONCURRENCY, pages); i++) {
      batch.push(remnaGetUsers({ size: PAGE_SIZE, start: i * PAGE_SIZE }));
    }
    const results = await Promise.allSettled(batch);
    for (const r of results) {
      if (r.status !== "fulfilled" || r.value.error || !r.value.data) {
        failedPages++;
        continue;
      }
      const users = (r.value.data as RemnaUsersPage).response?.users ?? [];
      for (const u of users) {
        if (u.username) index.set(u.username, { uuid: u.uuid, username: u.username, status: u.status, lifetimeBytes: liftLifetime(u) });
      }
    }
  }
  if (failedPages > 0) {
    console.error(
      `[anti-abuse] loadUserIndex: ${failedPages}/${pages - 1} страниц не загрузились — индекс неполный, часть нарушителей может не зарезолвиться`,
    );
  }
  return index;
}

async function getUserIndex(now: number): Promise<Map<string, RemnaUserLite>> {
  if (_userIndexCache && now - _userIndexCache.ts < USER_INDEX_TTL_MS) {
    return _userIndexCache.data;
  }
  const data = await loadUserIndex();
  _userIndexCache = { data, ts: now };
  return data;
}

/** Сбросить кэш индекса (например при ручном «Проверить сейчас»). */
export function invalidateUserIndexCache(): void {
  _userIndexCache = null;
}

// Кэш результата опроса по окну — правила с одинаковым окном в одном прогоне
// не дублируют запросы к нодам Remna (node-usage) и резолв индекса.
const USAGE_TTL_MS = 60 * 1000;
const _usageCache = new Map<string, { data: Map<string, UsageEntry>; ts: number }>();

// ---- Сбор потребления за окно ----------------------------------------------

interface RemnaNodeLite {
  uuid: string;
  name?: string;
  isDisabled?: boolean;
}

/**
 * Собрать потребление за окно [start, end] и резолвить в uuid.
 * Возвращает Map<uuid, UsageEntry> — только те, кто попал в top-N хотя бы на одной ноде
 * И резолвится в существующего Remna-юзера. Это «горячий хвост» (кандидаты на абьюз).
 */
export async function collectUsageForWindow(
  start: string,
  end: string,
  topUsersLimit: number,
  nowMs: number,
): Promise<Map<string, UsageEntry>> {
  const cacheKey = `${start}|${end}|${topUsersLimit}`;
  const cachedUsage = _usageCache.get(cacheKey);
  if (cachedUsage && nowMs - cachedUsage.ts < USAGE_TTL_MS) return cachedUsage.data;

  const result = new Map<string, UsageEntry>();
  if (!isRemnaConfigured()) {
    console.error("[anti-abuse] collectUsageForWindow: Remna не сконфигурирован");
    return result;
  }

  const nodesRes = await remnaGetNodes();
  if (nodesRes.error || !nodesRes.data) {
    console.error("[anti-abuse] collectUsageForWindow: ноды не получены:", nodesRes.error);
    return result;
  }
  const nodes = (nodesRes.data as { response?: RemnaNodeLite[] }).response ?? [];
  const active = nodes.filter((n) => !n.isDisabled);
  if (active.length === 0) return result;

  // 1. агрегируем потребление по username (юзер может качать с нескольких нод)
  const usageByUsername = new Map<string, number>();
  const usageResults = await Promise.allSettled(
    active.map((n) => remnaGetNodeUsersUsage(n.uuid, start, end, topUsersLimit)),
  );
  for (const r of usageResults) {
    if (r.status !== "fulfilled" || r.value.error || !r.value.data) continue;
    const top = (r.value.data as { response?: { topUsers?: { username: string; total: number }[] } })
      .response?.topUsers ?? [];
    for (const u of top) {
      if (!u.username) continue;
      // Remna для байтовых полей может вернуть строку (BigInt-safe) — нормализуем,
      // иначе typeof-фильтр молча отбросил бы нарушителя (фича не сработает).
      const rawTotal: unknown = u.total;
      const totalNum = typeof rawTotal === "number" ? rawTotal : Number(rawTotal);
      if (!Number.isFinite(totalNum)) continue;
      usageByUsername.set(u.username, (usageByUsername.get(u.username) ?? 0) + totalNum);
    }
  }
  if (usageByUsername.size === 0) return result;

  // 2. резолвим username → uuid через индекс юзеров Remna
  const userIndex = await getUserIndex(nowMs);
  for (const [username, bytes] of usageByUsername) {
    const u = userIndex.get(username);
    if (!u) continue;
    result.set(u.uuid, { username, uuid: u.uuid, periodBytes: bytes, lifetimeBytes: u.lifetimeBytes, status: u.status });
  }
  _usageCache.set(cacheKey, { data: result, ts: nowMs });
  return result;
}
