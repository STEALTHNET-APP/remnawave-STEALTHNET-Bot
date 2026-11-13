/**
 * T-anti-abuse (15.06.2026, WolfVPN): движок анти-абьюза.
 *
 * Эталон — auto-broadcast-scheduler: правила в БД + node-cron. У каждого правила
 * массив «будильников» (schedules) — на каждый ставится cron.schedule. Тик правила:
 *   master-чек → окно → опрос потребления → матч на подписки (scope) → WARN/BAN.
 * Отдельный частый тик авто-разбана: bannedUntil <= now → remnaEnableUser + чистка полей.
 *
 * Master-toggle и topN читаются напрямую из system_settings (изолированно от
 * большого client.service getSystemConfig).
 */

import cron, { type ScheduledTask } from "node-cron";
import type { TrafficAbuseRule } from "@prisma/client";
import { prisma } from "../../db.js";
import { remnaDisableUser, remnaEnableUser } from "../remna/remna.client.js";
import { registerCron, wrapCronTick, unregisterCron } from "../diagnostics/cron-registry.js";
import {
  resolveWindow,
  windowHours,
  collectUsageForWindow,
  collectLifetimeUsage,
  type AbuseWindowKind,
} from "./anti-abuse.usage.js";
import { sendAbuseNotification, type AbuseChannels } from "./anti-abuse.notify.js";

const SETTING_ENABLED = "anti_abuse_enabled";
const SETTING_TOPN = "anti_abuse_top_n_per_node";
const UNBAN_CRON = "*/10 * * * *"; // авто-разбан каждые 10 минут
const DEFAULT_TOP_N = 500;

/** ruleId → активные cron-задачи (по одной на «будильник»). */
const ruleTasks = new Map<string, ScheduledTask[]>();
let unbanTask: ScheduledTask | null = null;
// Overlap-guard: не запускать тик повторно, пока предыдущий не завершился.
// На 60k тик может длиться минуты — без этого наслоение дублирует нагрузку и баны.
const runningRules = new Set<string>();
let unbanRunning = false;

// ---- Настройки (system_settings) -------------------------------------------

/** Master-toggle: выключить всю систему одним кликом. */
export async function isAbuseMasterEnabled(): Promise<boolean> {
  const row = await prisma.systemSetting.findUnique({ where: { key: SETTING_ENABLED } });
  return row?.value === "true" || row?.value === "1";
}

async function getTopN(): Promise<number> {
  const row = await prisma.systemSetting.findUnique({ where: { key: SETTING_TOPN } });
  const n = row ? parseInt(row.value, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TOP_N;
}

// ---- Приведение Json-полей правила -----------------------------------------

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "string" && v.trim()) {
    try {
      const p: unknown = JSON.parse(v);
      return Array.isArray(p) ? p.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  }
  return [];
}

function asChannels(v: unknown): AbuseChannels {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    return { telegram: o.telegram === true, email: o.email === true, site: o.site === true };
  }
  return {};
}

function windowLabel(kind: AbuseWindowKind, hours: number): string {
  if (kind === "hour") return "за час";
  if (kind === "day") return "за сутки";
  if (kind === "week") return "за неделю";
  if (kind === "rolling") return "между проверками";
  return `за ${hours} ч`;
}

// ---- Приоритет правил (T-priority, 24.06.2026) ------------------------------
// Если подписка попадает под несколько правил — действует ТОЛЬКО самое приоритетное.
// Строгий тотальный порядок: priority (выше = главнее) → BAN важнее WARN при равном
// приоритете → более СТАРОЕ правило (раньше createdAt) при прочих равных.
function rankTuple(r: TrafficAbuseRule): [number, number, number] {
  return [r.priority, r.action === "BAN" ? 1 : 0, -r.createdAt.getTime()];
}
/** true, если H строго приоритетнее R (H перебивает R). */
function outranks(h: TrafficAbuseRule, r: TrafficAbuseRule): boolean {
  const a = rankTuple(h);
  const b = rankTuple(r);
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}
/** Сигнатура окна — для кэша опроса потребления (правила с одинаковым окном опрашиваем 1 раз). */
function windowSig(r: TrafficAbuseRule): string {
  return `${r.windowKind}:${r.windowValueHours ?? ""}`;
}

// ---- Планирование ----------------------------------------------------------

function scheduleRule(rule: TrafficAbuseRule): void {
  const schedules = asStringArray(rule.schedules).filter((s) => cron.validate(s));
  if (schedules.length === 0) return;
  const tasks: ScheduledTask[] = [];
  for (const expr of schedules) {
    tasks.push(cron.schedule(expr, wrapCronTick(`anti-abuse:${rule.id}`, () => runRuleTick(rule.id))));
  }
  ruleTasks.set(rule.id, tasks);
  registerCron({
    name: `anti-abuse:${rule.id}`,
    cron: schedules.join(" | "),
    description: `Анти-абьюз правило «${rule.name}» (${rule.action})`,
    trigger: () => runRuleTick(rule.id),
  });
}

async function reloadAllRules(): Promise<void> {
  for (const tasks of ruleTasks.values()) for (const t of tasks) t.stop();
  ruleTasks.clear();
  const rules = await prisma.trafficAbuseRule.findMany({ where: { enabled: true } });
  for (const rule of rules) scheduleRule(rule);
  console.log(`[anti-abuse] запланировано правил: ${rules.length}`);
}

/** Пересоздать задачи одного правила (после create/update/delete в админке). */
export async function rescheduleAbuseRule(ruleId: string): Promise<void> {
  const existing = ruleTasks.get(ruleId);
  if (existing) {
    for (const t of existing) t.stop();
    ruleTasks.delete(ruleId);
    unregisterCron(`anti-abuse:${ruleId}`);
  }
  const rule = await prisma.trafficAbuseRule.findUnique({ where: { id: ruleId } });
  if (rule && rule.enabled) scheduleRule(rule);
}

export async function startAntiAbuseScheduler(): Promise<void> {
  await reloadAllRules();
  unbanTask = cron.schedule(UNBAN_CRON, wrapCronTick("anti-abuse-unban", runAutoUnban));
  registerCron({
    name: "anti-abuse-unban",
    cron: UNBAN_CRON,
    description: "Авто-разбан подписок анти-абьюза (bannedUntil <= now)",
    trigger: runAutoUnban,
  });
}

export function stopAntiAbuseScheduler(): void {
  for (const tasks of ruleTasks.values()) for (const t of tasks) t.stop();
  ruleTasks.clear();
  if (unbanTask) {
    unbanTask.stop();
    unbanTask = null;
  }
}

// ---- Тик правила -----------------------------------------------------------

interface SubForRule {
  id: string;
  remnawaveUuid: string | null;
  subscriptionIndex: number;
  tariffId: string | null;
  bannedUntil: Date | null;
  abuseImmuneUntil: Date | null;
  owner: { id: string; telegramId: string | null; email: string | null };
  tariff: { name: string; internalSquadUuids: unknown } | null;
}

function ruleAppliesToSub(rule: TrafficAbuseRule, sub: SubForRule): boolean {
  const exclude = asStringArray(rule.excludeSubscriptionIds);
  if (exclude.includes(sub.id)) return false;
  if (rule.scopeKind === "all") return true;
  const values = asStringArray(rule.scopeValues);
  if (values.length === 0) return false;
  if (rule.scopeKind === "tariff") return sub.tariffId != null && values.includes(sub.tariffId);
  if (rule.scopeKind === "squad") {
    const squads = asStringArray(sub.tariff?.internalSquadUuids);
    return squads.some((s) => values.includes(s));
  }
  return true;
}

/** Конец текущего календарного периода окна (UTC). */
function endOfWindow(kind: AbuseWindowKind, now: Date): Date {
  const d = new Date(now);
  if (kind === "hour") {
    d.setUTCMinutes(59, 59, 999);
    return d;
  }
  if (kind === "week") {
    // конец ISO-недели: воскресенье 23:59:59 UTC (Mon=0..Sun=6)
    const dayIdx = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() + (6 - dayIdx));
    d.setUTCHours(23, 59, 59, 999);
    return d;
  }
  // day — конец суток UTC
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

function computeBanUntil(rule: TrafficAbuseRule, windowHrs: number, now: Date): Date {
  let until: Date;
  if (rule.banDurationKind === "fixed" && rule.banDurationHours && rule.banDurationHours > 0) {
    until = new Date(now.getTime() + rule.banDurationHours * 3_600_000);
  } else if ((rule.windowKind as AbuseWindowKind) === "custom" || (rule.windowKind as AbuseWindowKind) === "rolling") {
    // custom/rolling: бан на длину окна/интервала (календарного периода нет).
    until = new Date(now.getTime() + windowHrs * 3_600_000);
  } else {
    // until_window_end — до конца ТЕКУЩЕГО календарного периода (часа/суток/недели).
    until = endOfWindow(rule.windowKind as AbuseWindowKind, now);
  }
  // Гарантируем минимум +1ч в будущее, чтобы авто-разбан (тик каждые 10 мин) не снял
  // бан мгновенно → исключаем пинг-понг disable/enable.
  const minUntil = new Date(now.getTime() + 3_600_000);
  return until.getTime() > minUntil.getTime() ? until : minUntil;
}

export async function runRuleTick(ruleId: string): Promise<void> {
  if (runningRules.has(ruleId)) {
    console.warn(`[anti-abuse] тик правила ${ruleId} ещё выполняется — пропуск (overlap)`);
    return;
  }
  runningRules.add(ruleId);
  try {
    await runRuleTickInner(ruleId);
  } finally {
    runningRules.delete(ruleId);
  }
}

async function runRuleTickInner(ruleId: string): Promise<void> {
  if (!(await isAbuseMasterEnabled())) return;
  const rule = await prisma.trafficAbuseRule.findUnique({ where: { id: ruleId } });
  if (!rule || !rule.enabled) return;

  const now = new Date();
  const kind = rule.windowKind as AbuseWindowKind;
  const win = resolveWindow(kind, rule.windowValueHours, now);
  const hrs = windowHours(kind, rule.windowValueHours);
  const topN = await getTopN();

  const usage = kind === "hour"
    ? await collectLifetimeUsage(now.getTime())
    : await collectUsageForWindow(win.start, win.end, topN, now.getTime());
  if (usage.size === 0) return;

  const limit = Number(rule.limitBytes);
  const isRolling = kind === "rolling";
  // Rolling: кандидаты — все из usage (топ за сегодня), дельта lifetime считается по снапшоту.
  // Остальные окна: те, кто превысил лимит за период (periodBytes).
  const candidateUuids = isRolling || kind === "hour"
    ? [...usage.values()].map((u) => u.uuid)
    : [...usage.values()].filter((u) => u.periodBytes > limit).map((u) => u.uuid);
  if (candidateUuids.length === 0) {
    await prisma.trafficAbuseRule.update({ where: { id: rule.id }, data: { lastRunAt: now } }).catch(() => undefined);
    return;
  }

  const subs = (await prisma.subscription.findMany({
    where: { remnawaveUuid: { in: candidateUuids } },
    select: {
      id: true,
      remnawaveUuid: true,
      subscriptionIndex: true,
      tariffId: true,
      bannedUntil: true,
      abuseImmuneUntil: true,
      owner: { select: { id: true, telegramId: true, email: true } },
      tariff: { select: { name: true, internalSquadUuids: true } },
    },
  })) as SubForRule[];

  // ── T-priority (24.06.2026): правила выше приоритетом перебивают это ──
  // Если подписка подпадает под более приоритетное правило (по его окну/лимиту) — текущее
  // правило уступает (его действие пропускается). Так «попал под оба → бьёт самое приоритетное»,
  // и WARN больше не «молчит» из-за чужого BAN: либо WARN сработает (если он приоритетнее/единственный),
  // либо уступит приоритетному BAN, который сам и забанит на своём тике.
  const higherRules = (await prisma.trafficAbuseRule.findMany({ where: { enabled: true, id: { not: rule.id } } }))
    .filter((h) => outranks(h, rule));
  // Кэш опроса потребления по сигнатуре окна (правила с тем же окном — 1 запрос).
  const usageCache = new Map<string, Map<string, { periodBytes: number; lifetimeBytes: number }>>();
  usageCache.set(windowSig(rule), usage as Map<string, { periodBytes: number; lifetimeBytes: number }>);
  const getUsageFor = async (r: TrafficAbuseRule) => {
    const sig = windowSig(r);
    let m = usageCache.get(sig);
    if (!m) {
      const w = resolveWindow(r.windowKind as AbuseWindowKind, r.windowValueHours, now);
      m = r.windowKind === "hour"
        ? await collectLifetimeUsage(now.getTime())
        : await collectUsageForWindow(w.start, w.end, topN, now.getTime());
      usageCache.set(sig, m);
    }
    return m;
  };
  // Подпадает ли подписка под более приоритетное правило прямо сейчас?
  const outrankedBy = async (s: SubForRule): Promise<boolean> => {
    if (higherRules.length === 0 || !s.remnawaveUuid) return false;
    for (const h of higherRules) {
      if (!ruleAppliesToSub(h, s)) continue;
      const m = await getUsageFor(h);
      const e = m.get(s.remnawaveUuid);
      if (!e) continue;
      const hLimit = Number(h.limitBytes);
      if ((h.windowKind as AbuseWindowKind) === "rolling") {
        // Rolling меряет дельту lifetime от снапшота правила; без снапшота базы нет — пропускаем.
        const st = await prisma.trafficAbuseState.findUnique({
          where: { subscriptionId_ruleId: { subscriptionId: s.id, ruleId: h.id } },
        });
        const snap = st?.lastLifetimeBytes != null ? Number(st.lastLifetimeBytes) : null;
        if (snap != null && e.lifetimeBytes - snap > hLimit) return true;
      } else if (h.windowKind === "hour") {
        const st = await prisma.trafficAbuseState.findUnique({
          where: { subscriptionId_ruleId: { subscriptionId: s.id, ruleId: h.id } },
        });
        const w = resolveWindow("hour", null, now);
        if (st?.windowKey === w.windowKey && st.lastLifetimeBytes != null &&
            e.lifetimeBytes >= Number(st.lastLifetimeBytes) &&
            e.lifetimeBytes - Number(st.lastLifetimeBytes) > hLimit) return true;
      } else if (e.periodBytes > hLimit) {
        return true;
      }
    }
    return false;
  };

  for (const sub of subs) {
    if (!sub.remnawaveUuid) continue;
    if (!ruleAppliesToSub(rule, sub)) continue;
    const entry = usage.get(sub.remnawaveUuid);
    if (!entry) continue;
    // Уступаем более приоритетному правилу, под которое подписка тоже подпадает.
    if (await outrankedBy(sub)) continue;
    try {
      if (kind === "hour") {
        const bytes = await hourlyBytes(rule, sub, entry, win, now);
        if (bytes != null && bytes > limit) {
          if (rule.action === "BAN") await applyBan(rule, sub, bytes, win, hrs, now);
          else await applyWarn(rule, sub, bytes, win, now);
        }
      } else if (isRolling) await applyRolling(rule, sub, entry, hrs, now);
      else if (rule.action === "BAN") await applyBan(rule, sub, entry.periodBytes, win, hrs, now);
      else await applyWarn(rule, sub, entry.periodBytes, win, now);
    } catch (e) {
      console.error(`[anti-abuse] правило ${rule.id} sub ${sub.id}:`, e instanceof Error ? e.message : e);
      await prisma.trafficAbuseEvent
        .create({
          data: {
            subscriptionId: sub.id,
            ruleId: rule.id,
            eventType: "ERROR",
            windowKey: win.windowKey,
            detail: e instanceof Error ? e.message : String(e),
          },
        })
        .catch(() => undefined);
    }
  }

  await prisma.trafficAbuseRule.update({ where: { id: rule.id }, data: { lastRunAt: now } }).catch(() => undefined);
}

async function hourlyBytes(
  rule: TrafficAbuseRule, sub: SubForRule,
  entry: { lifetimeBytes: number; sampledAt?: number },
  win: ReturnType<typeof resolveWindow>, now: Date,
): Promise<number | null> {
  const sample = entry.sampledAt;
  if (sample == null || !Number.isSafeInteger(entry.lifetimeBytes) || entry.lifetimeBytes < 0 ||
      Math.floor(sample / 3_600_000) !== Math.floor(now.getTime() / 3_600_000)) return null;
  const where = { subscriptionId_ruleId: { subscriptionId: sub.id, ruleId: rule.id } };
  const state = await prisma.trafficAbuseState.findUnique({ where });
  if (state?.lastSnapshotAt && sample < state.lastSnapshotAt.getTime()) return null;
  if (state?.windowKey !== win.windowKey || state.lastLifetimeBytes == null ||
      !state.lastSnapshotAt || entry.lifetimeBytes < Number(state.lastLifetimeBytes)) {
    await prisma.trafficAbuseState.upsert({ where,
      create: { subscriptionId: sub.id, ruleId: rule.id, windowKey: win.windowKey,
        lastLifetimeBytes: BigInt(entry.lifetimeBytes), lastSnapshotAt: new Date(sample) },
      update: { windowKey: win.windowKey, lastLifetimeBytes: BigInt(entry.lifetimeBytes),
        lastSnapshotAt: new Date(sample), warnedAt: null, lastPeriodBytes: null },
    });
    return null;
  }
  return entry.lifetimeBytes - Number(state.lastLifetimeBytes);
}

/**
 * Нужно ли слать WARN: первое предупреждение в окне, либо повтор по resendAfterHours,
 * если юзер НЕ снизил потребление (effectiveBytes >= зафиксированного на прошлом warn).
 */
function shouldSendWarn(
  state: { warnedAt: Date | null; windowKey: string; lastPeriodBytes: bigint | null } | null,
  rule: TrafficAbuseRule,
  windowKey: string,
  effectiveBytes: number,
  now: Date,
): boolean {
  if (!state?.warnedAt) return true; // ещё не предупреждали
  if (state.windowKey !== windowKey) return true; // новое календарное окно
  const resendH = rule.resendAfterHours;
  if (!resendH || resendH <= 0) return false; // повтор выключен → шлём 1 раз
  const elapsedH = (now.getTime() - state.warnedAt.getTime()) / 3_600_000;
  if (elapsedH < resendH) return false; // ещё рано повторять
  const prev = state.lastPeriodBytes != null ? Number(state.lastPeriodBytes) : 0;
  const listened = effectiveBytes < prev; // снизил потребление → послушал
  return !listened; // не снизил → шлём повтор
}

async function applyWarn(
  rule: TrafficAbuseRule,
  sub: SubForRule,
  periodBytes: number,
  win: ReturnType<typeof resolveWindow>,
  now: Date,
): Promise<void> {
  // Забанена (другим правилом) — WARN не шлём (подписка отключена).
  if (sub.bannedUntil && sub.bannedUntil > now) return;
  // T-abuse-grace (29.06.2026, WolfVPN): иммунитет после ручного разбана — не банить и не
  // предупреждать, пока abuseImmuneUntil > now (админ дал срок «не трогать»).
  if (sub.abuseImmuneUntil && sub.abuseImmuneUntil > now) return;

  const state = await prisma.trafficAbuseState.findUnique({
    where: { subscriptionId_ruleId: { subscriptionId: sub.id, ruleId: rule.id } },
  });
  if (!shouldSendWarn(state, rule, win.windowKey, periodBytes, now)) return;

  const channels = asChannels(rule.channels);
  const recipient = { ownerClientId: sub.owner.id, telegramId: sub.owner.telegramId, email: sub.owner.email };
  const hasRecipient = !!((channels.telegram && recipient.telegramId) || (channels.email && recipient.email));

  const sent = await sendAbuseNotification({
    channels,
    messageText: rule.messageText,
    emailSubject: rule.emailSubject,
    recipient,
    vars: {
      tariff: sub.tariff?.name ?? `Подписка #${sub.subscriptionIndex}`,
      subIndex: sub.subscriptionIndex,
      periodBytes,
      limitBytes: Number(rule.limitBytes),
      windowLabel: windowLabel(win.kind, win.hours),
    },
  });

  const delivered = sent.telegram || sent.email;
  // Получатель есть, но доставка упала → НЕ закрываем окно дедупа (повторим в след. тик),
  // иначе предупреждение «потеряется» до конца календарного периода.
  if (!delivered && hasRecipient) {
    await prisma.trafficAbuseEvent.create({
      data: {
        subscriptionId: sub.id,
        ruleId: rule.id,
        eventType: "ERROR",
        windowKey: win.windowKey,
        detail: "Предупреждение не доставлено — повтор в следующий тик",
      },
    });
    return;
  }

  // Доставлено ИЛИ доставлять некому (нет канала) — фиксируем окно, чтобы не спамить.
  await prisma.trafficAbuseState.upsert({
    where: { subscriptionId_ruleId: { subscriptionId: sub.id, ruleId: rule.id } },
    create: {
      subscriptionId: sub.id,
      ruleId: rule.id,
      windowKey: win.windowKey,
      warnedAt: now,
      lastPeriodBytes: BigInt(Math.round(periodBytes)),
    },
    update: { windowKey: win.windowKey, warnedAt: now, lastPeriodBytes: BigInt(Math.round(periodBytes)) },
  });

  await prisma.trafficAbuseEvent.create({
    data: {
      subscriptionId: sub.id,
      ruleId: rule.id,
      eventType: "WARN",
      periodBytes: BigInt(Math.round(periodBytes)),
      windowKey: win.windowKey,
      channelsSent: { telegram: sent.telegram, email: sent.email },
    },
  });
}

async function applyBan(
  rule: TrafficAbuseRule,
  sub: SubForRule,
  periodBytes: number,
  win: ReturnType<typeof resolveWindow>,
  windowHrs: number,
  now: Date,
): Promise<void> {
  // Уже забанена и бан активен — не перебаниваем.
  if (sub.bannedUntil && sub.bannedUntil > now) return;
  // T-abuse-grace (29.06.2026, WolfVPN): иммунитет после ручного разбана — не банить и не
  // предупреждать, пока abuseImmuneUntil > now (админ дал срок «не трогать»).
  if (sub.abuseImmuneUntil && sub.abuseImmuneUntil > now) return;

  const bannedUntil = computeBanUntil(rule, windowHrs, now);

  // Физический бан в Remna (отключаем подключение).
  if (sub.remnawaveUuid) {
    const result = await remnaDisableUser(sub.remnawaveUuid);
    if (result.error || result.status < 200 || result.status >= 300) {
      throw new Error(result.error || `Remna disable failed: ${result.status}`);
    }
  }

  await prisma.subscription.update({
    where: { id: sub.id },
    data: { bannedUntil, banReason: rule.name, banRuleId: rule.id, banNotifiedAt: now },
  });

  const sent = await sendAbuseNotification({
    channels: asChannels(rule.channels),
    messageText: rule.messageText,
    emailSubject: rule.emailSubject,
    recipient: { ownerClientId: sub.owner.id, telegramId: sub.owner.telegramId, email: sub.owner.email },
    vars: {
      tariff: sub.tariff?.name ?? `Подписка #${sub.subscriptionIndex}`,
      subIndex: sub.subscriptionIndex,
      periodBytes,
      limitBytes: Number(rule.limitBytes),
      windowLabel: windowLabel(win.kind, win.hours),
      bannedUntil,
    },
  });

  await prisma.trafficAbuseEvent.create({
    data: {
      subscriptionId: sub.id,
      ruleId: rule.id,
      eventType: "BAN",
      periodBytes: BigInt(Math.round(periodBytes)),
      windowKey: win.windowKey,
      channelsSent: { telegram: sent.telegram, email: sent.email },
      detail: `Заблокировано до ${bannedUntil.toISOString()}`,
    },
  });

}

/**
 * Rolling-режим: трафик за интервал между замерами = дельта накопительного
 * lifetimeUsedTrafficBytes. Снапшот обновляется каждый тик; при первом замере базы нет.
 */
async function applyRolling(
  rule: TrafficAbuseRule,
  sub: SubForRule,
  entry: { lifetimeBytes: number },
  windowHrs: number,
  now: Date,
): Promise<void> {
  const current = Math.max(0, Math.round(entry.lifetimeBytes));
  const state = await prisma.trafficAbuseState.findUnique({
    where: { subscriptionId_ruleId: { subscriptionId: sub.id, ruleId: rule.id } },
  });
  const snapshot = state?.lastLifetimeBytes != null ? Number(state.lastLifetimeBytes) : null;

  // Сдвиг базы снапшота. Вызывается ТОЛЬКО после успешной обработки тика — иначе при
  // сбое (напр. remnaDisableUser упал) дельта потерялась бы и нарушитель проскочил.
  const saveSnapshot = (extra?: { warnedAt?: Date | null; lastPeriodBytes?: bigint }) =>
    prisma.trafficAbuseState.upsert({
      where: { subscriptionId_ruleId: { subscriptionId: sub.id, ruleId: rule.id } },
      create: { subscriptionId: sub.id, ruleId: rule.id, windowKey: "rolling", lastLifetimeBytes: BigInt(current), lastSnapshotAt: now, ...extra },
      update: { lastLifetimeBytes: BigInt(current), lastSnapshotAt: now, ...extra },
    });

  if (snapshot == null) {
    await saveSnapshot(); // первый замер — только запоминаем базу
    return;
  }
  let delta = current - snapshot;
  if (delta < 0) delta = 0; // аномалия (reset счётчика / смена uuid)
  const limit = Number(rule.limitBytes);

  if (delta <= limit) {
    // В пределах лимита — двигаем базу и закрываем инцидент (warnedAt=null), чтобы при
    // новом превышении предупредить заново.
    await saveSnapshot(state?.warnedAt ? { warnedAt: null } : undefined);
    return;
  }

  // Превышение. Если уже забанена (этим/другим правилом) — базу НЕ двигаем (заморожена:
  // трафик при бане не учитываем; после разбана state сбрасывается).
  if (sub.bannedUntil && sub.bannedUntil > now) return;
  // T-abuse-grace (29.06.2026, WolfVPN): иммунитет после ручного разбана — не банить и не
  // предупреждать, пока abuseImmuneUntil > now (админ дал срок «не трогать»).
  if (sub.abuseImmuneUntil && sub.abuseImmuneUntil > now) return;

  const channels = asChannels(rule.channels);
  const recipient = { ownerClientId: sub.owner.id, telegramId: sub.owner.telegramId, email: sub.owner.email };
  const baseVars = {
    tariff: sub.tariff?.name ?? `Подписка #${sub.subscriptionIndex}`,
    subIndex: sub.subscriptionIndex,
    periodBytes: delta,
    limitBytes: limit,
    windowLabel: "между проверками",
  };

  if (rule.action === "BAN") {
    const bannedUntil = computeBanUntil(rule, windowHrs, now);
    // Сначала применяем бан; если remnaDisableUser бросит — снапшот НЕ сдвинется,
    // дельта сохранится и нарушитель будет пойман на следующем тике.
    if (sub.remnawaveUuid) {
      const result = await remnaDisableUser(sub.remnawaveUuid);
      if (result.error || result.status < 200 || result.status >= 300) {
        throw new Error(result.error || `Remna disable failed: ${result.status}`);
      }
    }
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { bannedUntil, banReason: rule.name, banRuleId: rule.id, banNotifiedAt: now },
    });
    await saveSnapshot(); // бан применён — двигаем базу
    const sent = await sendAbuseNotification({
      channels, messageText: rule.messageText, emailSubject: rule.emailSubject, recipient,
      vars: { ...baseVars, bannedUntil },
    });
    await prisma.trafficAbuseEvent.create({
      data: {
        subscriptionId: sub.id, ruleId: rule.id, eventType: "BAN",
        periodBytes: BigInt(delta), windowKey: "rolling",
        channelsSent: { telegram: sent.telegram, email: sent.email },
        detail: `Заблокировано до ${bannedUntil.toISOString()} (rolling-дельта)`,
      },
    });
  } else {
    // WARN. Антиспам/повтор: первое предупреждение или повтор по resendAfterHours, если не снизил.
    if (!shouldSendWarn(state, rule, "rolling", delta, now)) {
      await saveSnapshot(); // не шлём (рано/послушал), но базу двигаем — дельта между проверками
      return;
    }
    const sent = await sendAbuseNotification({
      channels, messageText: rule.messageText, emailSubject: rule.emailSubject, recipient, vars: baseVars,
    });
    await saveSnapshot({ warnedAt: now, lastPeriodBytes: BigInt(delta) });
    await prisma.trafficAbuseEvent.create({
      data: {
        subscriptionId: sub.id, ruleId: rule.id, eventType: "WARN",
        periodBytes: BigInt(delta), windowKey: "rolling",
        channelsSent: { telegram: sent.telegram, email: sent.email },
      },
    });
  }
}

// ---- Авто-разбан -----------------------------------------------------------

export async function runAutoUnban(): Promise<void> {
  if (unbanRunning) return;
  unbanRunning = true;
  try {
    await runAutoUnbanInner();
  } finally {
    unbanRunning = false;
  }
}

async function runAutoUnbanInner(): Promise<void> {
  const now = new Date();
  // take-лимит: если разом истекло много банов — добьём за несколько тиков (раз в 10 мин),
  // не растягивая один прогон на минуты последовательных remnaEnableUser.
  const banned = await prisma.subscription.findMany({
    where: { bannedUntil: { not: null, lte: now } },
    select: { id: true, remnawaveUuid: true, banRuleId: true },
    take: 300,
  });
  if (banned.length === 0) return;

  let unbanned = 0;
  for (const sub of banned) {
    try {
      if (sub.remnawaveUuid) {
        const result = await remnaEnableUser(sub.remnawaveUuid);
        if (result.error || result.status < 200 || result.status >= 300) {
          throw new Error(result.error || `Remna enable failed: ${result.status}`);
        }
      }
    } catch (e) {
      console.error(`[anti-abuse] авто-разбан Remna enable ${sub.id}:`, e instanceof Error ? e.message : e);
      continue; // Keep the ban pending so the next tick retries.
    }
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { bannedUntil: null, banReason: null, banRuleId: null, banNotifiedAt: null },
    });
    // Сброс снапшотов/счётчика предупреждений: после бана отсчёт с чистого листа,
    // иначе rolling посчитал бы дельту за весь срок бана → мгновенный ребан.
    await prisma.trafficAbuseState.updateMany({
      where: { subscriptionId: sub.id },
      data: { lastLifetimeBytes: null, lastSnapshotAt: null, warnedAt: null, lastPeriodBytes: null },
    });
    await prisma.trafficAbuseEvent.create({
      data: {
        subscriptionId: sub.id,
        ruleId: sub.banRuleId,
        eventType: "UNBAN",
        detail: "Авто-разбан по истечении срока блокировки",
      },
    });
    unbanned++;
  }
  console.log(`[anti-abuse] авто-разбан: разблокировано ${unbanned}`);
}
