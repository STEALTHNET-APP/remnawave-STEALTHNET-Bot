/**
 * отправка кастомных уведомлений автосписания.
 * Использует шаблоны из таблицы `auto_renew_notifications` (UI: /admin/auto-renew).
 *
 * Архитектура:
 *   - Cron (`auto-renew.cron.ts`) после каждого события (UPCOMING, SUCCESS, FAILED, RETRY, EXPIRED)
 *     дёргает `dispatchAutoRenewNotification(...)` с типом события и контекстом.
 *   - Функция достаёт enabled шаблоны нужного типа, для UPCOMING фильтрует по offsetMinutes
 *     (близко к текущему timeLeft), подставляет переменные и отправляет через TG.
 *
 * Дедуп: cron бежит ЕЖЕМИНУТНО, поэтому каждое событие без дедупа = спам раз в минуту.
 * Храним в `subscriptions.last_notified_key` (и `clients.last_arn_notified_key`) JSON-карту
 * `{ "<маркер>": "<bucket>" }`, где bucket = floor(now / ttl); для UPCOMING bucket = `exp<expireAt ms>` —
 * шаблон уходит один раз за цикл подписки, продление (новый expireAt) сбрасывает дедуп. Раньше хранился ОДИН ключ
 * последнего шаблона — два разных шаблона (например UPCOMING и FAILED) затирали друг друга
 * и оба слались каждую минуту. Карта делает дедуп независимым per-шаблон.
 *
 * Переменные в `messageText`:
 *   {tariff_name}   — имя тарифа
 *   {amount}        — сумма к списанию
 *   {currency}      — валюта
 *   {days_left}     — целое число дней до истечения
 *   {hours_left}    — целое число часов до истечения
 *   {minutes_left}  — целое число минут до истечения
 *   {days_unit}     — «дн.»/«день»/«дня» (правильное склонение)
 *   {expire_date}   — DD.MM.YYYY
 *   {sub_index}     — номер подписки (#N)
 *   {balance}       — текущий баланс клиента
 */

import { prisma } from "../../db.js";
import { sendTelegramToUser } from "./telegram-notify.service.js";
import { getSystemConfig } from "../client/client.service.js";
import { pickDueUpcomingTemplates, upcomingDedupBucket } from "./auto-renew-schedule.js";

export type AutoRenewTriggerType = "UPCOMING" | "SUCCESS" | "FAILED" | "RETRY" | "EXPIRED";

export type AutoRenewNotifContext = {
  tariffName: string;
  amount: number;
  currency: string;
  /** Только для UPCOMING — оставшееся время до истечения в МИНУТАХ (положительное). */
  minutesLeft?: number;
  /** Дата истечения (для подстановки). */
  expireAt?: Date | null;
  /** Индекс подписки (root=0, secondary=N). */
  subIndex?: number;
  /** Текущий баланс клиента. */
  balance?: number;
  /**
   * Дедуп per-шаблон: если задан — тот же шаблон не уйдёт повторно, пока не сменится
   * bucket = floor(now / ttlMs). Ключи хранятся JSON-картой в
   * `subscriptions.last_notified_key` (для sec) / `clients.last_arn_notified_key` (для root).
   */
  dedupKeyForSec?: { secondarySubscriptionId: string; ttlMs?: number };
  /** Аналогично dedupKeyForSec — но для root подписки (через clients.last_arn_notified_key). */
  dedupKeyForRoot?: { clientId: string; ttlMs?: number };
};

function declOf(n: number): string {
  // Правильное склонение «дн.» / «дня» / «дней».
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs >= 11 && abs <= 14) return "дней";
  if (last === 1) return "день";
  if (last >= 2 && last <= 4) return "дня";
  return "дней";
}

/* ─────────────── Dedup-карта ─────────────── */

const DEDUP_MAP_MAX_KEYS = 16;

/** Разбор хранимого значения дедупа: JSON-карта или legacy-строка `templateId:bucket`. */
export function parseDedupMap(raw: string | null | undefined): Record<string, string> {
  if (!raw?.trim()) return {};
  try {
    const o = JSON.parse(raw) as unknown;
    if (o && typeof o === "object" && !Array.isArray(o)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
        if (typeof v === "string") out[k] = v;
      }
      return out;
    }
    return {};
  } catch {
    // legacy формат "<templateId>:<bucket>" — конвертируем в карту.
    const idx = raw.lastIndexOf(":");
    if (idx > 0) return { [raw.slice(0, idx)]: raw.slice(idx + 1) };
    return {};
  }
}

/** Ограничить размер карты (выкидываем самые старые записи по порядку вставки). */
function capDedupMap(map: Record<string, string>): Record<string, string> {
  const entries = Object.entries(map);
  if (entries.length <= DEDUP_MAP_MAX_KEYS) return map;
  return Object.fromEntries(entries.slice(entries.length - DEDUP_MAP_MAX_KEYS));
}

/**
 * Ad-hoc дедуп-маркер по подписке (для не-шаблонных событий: попытка YK-списания,
 * hardcoded-уведомление об отказе карты и т.п.).
 * Возвращает true если маркер ещё не ставился в текущем bucket (действие разрешено),
 * false — если уже было (пропустить). Маркер записывается сразу же (mark-then-act).
 */
export async function tryMarkSubDedup(
  subscriptionId: string,
  marker: string,
  ttlMs: number,
  bucketOverride?: string,
): Promise<boolean> {
  return claimDedupMarker(
    async () => (await prisma.subscription.findUnique({ where: { id: subscriptionId }, select: { lastNotifiedKey: true } }))?.lastNotifiedKey,
    async (previous, next) => (await prisma.subscription.updateMany({
      where: { id: subscriptionId, lastNotifiedKey: previous },
      data: { lastNotifiedKey: next },
    })).count === 1,
    marker, ttlMs, bucketOverride,
  );
}

export async function tryMarkClientDedup(
  clientId: string,
  marker: string,
  ttlMs: number,
  bucketOverride?: string,
): Promise<boolean> {
  return claimDedupMarker(
    async () => (await prisma.client.findUnique({ where: { id: clientId }, select: { lastArnNotifiedKey: true } }))?.lastArnNotifiedKey,
    async (previous, next) => (await prisma.client.updateMany({
      where: { id: clientId, lastArnNotifiedKey: previous },
      data: { lastArnNotifiedKey: next },
    })).count === 1,
    marker, ttlMs, bucketOverride,
  );
}

async function claimDedupMarker(
  read: () => Promise<string | null | undefined>,
  write: (previous: string | null, next: string) => Promise<boolean>,
  marker: string,
  ttlMs: number,
  bucketOverride?: string,
): Promise<boolean> {
  const bucket = bucketOverride ?? String(Math.floor(Date.now() / ttlMs));
  for (let attempt = 0; attempt < 5; attempt++) {
    const previous = await read();
    if (previous === undefined) return false;
    const map = parseDedupMap(previous);
    if (map[marker] === bucket) return false;
    map[marker] = bucket;
    if (await write(previous, JSON.stringify(capDedupMap(map)))) return true;
  }
  return false;
}

async function releaseNotificationClaim(context: AutoRenewNotifContext, marker: string, bucketFor: (ttl: number) => string) {
  const sec = context.dedupKeyForSec;
  const root = context.dedupKeyForRoot;
  for (let attempt = 0; attempt < 5; attempt++) {
    const previous = sec
      ? (await prisma.subscription.findUnique({ where: { id: sec.secondarySubscriptionId }, select: { lastNotifiedKey: true } }))?.lastNotifiedKey
      : root ? (await prisma.client.findUnique({ where: { id: root.clientId }, select: { lastArnNotifiedKey: true } }))?.lastArnNotifiedKey : undefined;
    if (previous == null) return;
    const map = parseDedupMap(previous);
    if (map[marker] !== bucketFor((sec ?? root)?.ttlMs ?? 3600000)) return;
    delete map[marker];
    const next = JSON.stringify(map);
    const result = sec
      ? await prisma.subscription.updateMany({ where: { id: sec.secondarySubscriptionId, lastNotifiedKey: previous }, data: { lastNotifiedKey: next } })
      : await prisma.client.updateMany({ where: { id: root!.clientId, lastArnNotifiedKey: previous }, data: { lastArnNotifiedKey: next } });
    if (result.count) return;
  }
}

function renderTemplate(template: string, ctx: AutoRenewNotifContext): string {
  const fmt = (n: number) => Math.round(n).toLocaleString("ru-RU");
  const days = ctx.minutesLeft != null ? Math.max(0, Math.floor(ctx.minutesLeft / (60 * 24))) : 0;
  const hours = ctx.minutesLeft != null ? Math.max(0, Math.floor(ctx.minutesLeft / 60)) : 0;
  const minutes = ctx.minutesLeft != null ? Math.max(0, Math.round(ctx.minutesLeft)) : 0;
  const expireStr = ctx.expireAt
    ? ctx.expireAt.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })
    : "—";

  return template
    // Литеральные «\n» из ручного ввода в админке → реальные переносы строк.
    // Реальные переносы (из seed E'...\n...') не содержат backslash и не затрагиваются.
    .replace(/\\r\\n|\\n/g, "\n")
    .replace(/\{tariff_name\}/g, ctx.tariffName)
    .replace(/\{amount\}/g, fmt(ctx.amount))
    .replace(/\{currency\}/g, ctx.currency.toUpperCase() === "RUB" ? "₽" : ctx.currency)
    .replace(/\{days_left\}/g, String(days))
    .replace(/\{hours_left\}/g, String(hours))
    .replace(/\{minutes_left\}/g, String(minutes))
    .replace(/\{days_unit\}/g, declOf(days))
    .replace(/\{expire_date\}/g, expireStr)
    .replace(/\{sub_index\}/g, ctx.subIndex != null ? String(ctx.subIndex) : "")
    .replace(/\{balance\}/g, ctx.balance != null ? fmt(ctx.balance) : "—");
}

/**
 * Главная функция dispatch. Отправляет все подходящие active-шаблоны клиенту.
 * Возвращает количество отправленных уведомлений (для логов).
 */
export async function dispatchAutoRenewNotification(
  clientId: string,
  triggerType: AutoRenewTriggerType,
  context: AutoRenewNotifContext,
): Promise<number> {
  // Тянем enabled шаблоны нужного типа.
  const templates = await prisma.autoRenewNotification.findMany({
    where: { triggerType, enabled: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  if (templates.length === 0) return 0;

  // Для UPCOMING — шаблон наступает, когда осталось <= offsetMinutes; уходит только ближайший.
  // Однократность на цикл подписки — дедуп по expireAt (см. upcomingDedupBucket).
  let matched = templates;
  if (triggerType === "UPCOMING") {
    if (context.minutesLeft == null) return 0;
    matched = pickDueUpcomingTemplates(templates, context.minutesLeft);
  }
  if (matched.length === 0) return 0;

  // Клиент → telegramId.
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { telegramId: true, id: true },
  });
  if (!client?.telegramId) return 0;

  const cfg = await getSystemConfig();
  const backLabel = (cfg.botBackLabel ?? "🏠 Главное меню").trim() || "🏠 Главное меню";

  const notificationTime = Date.now();
  const dedupBucketFor = (ttlMs: number): string =>
    triggerType === "UPCOMING"
      ? upcomingDedupBucket(context.expireAt, notificationTime, ttlMs)
      : String(Math.floor(notificationTime / ttlMs));

  let sentCount = 0;
  for (const t of matched) {
    // Дедуп per-шаблон (JSON-карта). Ключ карты = id шаблона, значение = текущий bucket.
    if (context.dedupKeyForSec?.secondarySubscriptionId) {
      const ttl = context.dedupKeyForSec.ttlMs ?? 60 * 60 * 1000;
      const allowed = await tryMarkSubDedup(
        context.dedupKeyForSec.secondarySubscriptionId,
        t.id,
        ttl,
        dedupBucketFor(ttl),
      );
      if (!allowed) continue;
    }
    // Дедуп для root — та же карта, но в clients.lastArnNotifiedKey.
    if (context.dedupKeyForRoot?.clientId) {
      const ttl = context.dedupKeyForRoot.ttlMs ?? 60 * 60 * 1000;
      const allowed = await tryMarkClientDedup(
        context.dedupKeyForRoot.clientId, t.id, ttl, dedupBucketFor(ttl),
      );
      if (!allowed) continue;
    }

    const text = renderTemplate(t.messageText, context);
    const replyMarkup = {
      inline_keyboard: [
        [{ text: "📋 Мои подписки", callback_data: "menu:my_subs" }],
        [{ text: backLabel, callback_data: "menu:main" }],
      ],
    };
    try {
      await sendTelegramToUser(client.telegramId, text, null, replyMarkup, { clientIdForBotToken: client.id, throwOnError: true });
      sentCount += 1;
    } catch (error) {
      await releaseNotificationClaim(context, t.id, dedupBucketFor);
      console.error(`[arn-notif] sendTelegramToUser failed for client ${clientId}, template ${t.id}:`, error);
    }
  }
  return sentCount;
}
