import { prisma } from "../../db.js";
import { remnaGetUser, remnaUpdateUser } from "../remna/remna.client.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export type GrantExtendMode = "days_only" | "tariff";

/**
 * Admin «Продлить подписку»: триал (trialId) или подписка без тарифа продлевается
 * только по дате, пока админ явно не выбрал тариф (тогда это конвертация в тариф).
 */
export function chooseGrantExtendMode(
  sub: { tariffId: string | null; trialId: string | null },
  requestedTariffId: string | undefined,
): GrantExtendMode {
  if (requestedTariffId) return "tariff";
  if (sub.trialId != null || !sub.tariffId) return "days_only";
  return "tariff";
}

/** Новая дата = max(now, текущая) + days. */
export function computeDaysOnlyExpireAt(currentExpireAt: Date | null, days: number, now: Date): Date {
  const base = currentExpireAt && currentExpireAt.getTime() > now.getTime() ? currentExpireAt : now;
  return new Date(base.getTime() + days * DAY_MS);
}

/** expireAt (в т.ч. прошедший) и status из ответа Remnawave GET /api/users/{uuid}. */
export function extractRemnaExpireAndStatus(data: unknown): { expireAt: Date | null; status: string | null } {
  if (!data || typeof data !== "object") return { expireAt: null, status: null };
  const o = data as Record<string, unknown>;
  const inner = o.response ?? o.data ?? o;
  if (!inner || typeof inner !== "object") return { expireAt: null, status: null };
  const resp = inner as Record<string, unknown>;
  let expireAt: Date | null = null;
  if (typeof resp.expireAt === "string") {
    const d = new Date(resp.expireAt);
    if (!Number.isNaN(d.getTime())) expireAt = d;
  }
  const status = typeof resp.status === "string" ? resp.status : null;
  return { expireAt, status };
}

export type DaysOnlyExtendResult =
  | { ok: true; expireAt: Date; reactivated: boolean }
  | { ok: false; error: string; status: number };

/**
 * Продление только даты: PATCH в Remnawave шлёт лишь uuid + expireAt (+ status=ACTIVE,
 * если юзер EXPIRED — Remnawave сам его не возвращает, см. PATCH /admin/subscriptions/:subId/remna).
 * DISABLED (ручная блокировка) не снимаем. Лимиты, сквады, трафик, trialId/tariffId не трогаем.
 */
export async function extendSubscriptionDaysOnly(
  sub: { id: string; remnawaveUuid: string },
  days: number,
  now: Date = new Date(),
): Promise<DaysOnlyExtendResult> {
  const userRes = await remnaGetUser(sub.remnawaveUuid);
  if (userRes.error || !userRes.data) {
    return { ok: false, error: "Пользователь VPN для этой подписки не найден", status: 404 };
  }
  const current = extractRemnaExpireAndStatus(userRes.data);
  const expireAt = computeDaysOnlyExpireAt(current.expireAt, days, now);
  const reactivated = current.status === "EXPIRED" && expireAt.getTime() > now.getTime();

  const patch: Record<string, unknown> = { uuid: sub.remnawaveUuid, expireAt: expireAt.toISOString() };
  if (reactivated) patch.status = "ACTIVE";
  const updateRes = await remnaUpdateUser(patch);
  if (updateRes.error) {
    return { ok: false, error: updateRes.error, status: updateRes.status >= 400 ? updateRes.status : 500 };
  }

  try {
    await prisma.subscription.update({ where: { id: sub.id }, data: { expireAt } });
  } catch (e) {
    console.error("[admin/grant-extend] expireAt DB sync failed:", e);
  }
  return { ok: true, expireAt, reactivated };
}
