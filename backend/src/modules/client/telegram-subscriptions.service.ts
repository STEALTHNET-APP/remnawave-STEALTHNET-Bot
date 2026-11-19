import { prisma } from "../../db.js";
import { isRemnaConfigured, remnaFetch, remnaGetUser, extractRemnaUuid } from "../remna/remna.client.js";
import { upsertSubscriptionByRemnaUuid } from "../subscription/subscription.helpers.js";

export class TelegramSubscriptionCheckError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export type TelegramRemoteSubscription = {
  remnawaveUuid: string;
  status: string | null;
  expireAt: string | null;
};

const unavailable = () => new TelegramSubscriptionCheckError(503,
  "Не удалось проверить существующие подписки. Попробуйте /start позже — новая подписка не создана.");
const accountConflict = () => new TelegramSubscriptionCheckError(409,
  "Найдена подписка в другом аккаунте. Войдите на сайт в свой аккаунт и привяжите Telegram в профиле. Если Telegram уже привязан, обратитесь в поддержку.");

const ADMIN_DETACH_EVENTS = ["DELETED", "UNLINKED"];

function parseRemoteSubscription(user: Record<string, unknown>, uuid: string): TelegramRemoteSubscription {
  return {
    remnawaveUuid: uuid,
    status: typeof user.status === "string" ? user.status : null,
    expireAt: typeof user.expireAt === "string" ? user.expireAt : null,
  };
}

export function isLiveRemnaSubscription(sub: TelegramRemoteSubscription): boolean {
  if (sub.expireAt) {
    const expireAt = new Date(sub.expireAt);
    if (!Number.isNaN(expireAt.getTime()) && expireAt.getTime() <= Date.now()) return false;
  }
  const status = sub.status?.toUpperCase();
  return status !== "EXPIRED" && status !== "DISABLED" && status !== "MISSING";
}

export async function findTelegramSubscriptions(telegramId: string): Promise<TelegramRemoteSubscription[]> {
  if (!isRemnaConfigured()) return [];
  const found = new Map<string, TelegramRemoteSubscription>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const query = new URLSearchParams({ telegramId, size: "100" });
    if (cursor) query.set("cursor", cursor);
    let result = await remnaFetch<unknown>(`/api/users/stream?${query}`);
    let legacy = false;
    if (page === 0 && (result.status === 404 || result.status === 400)) {
      legacy = true;
      result = await remnaFetch<unknown>(`/api/users/by-telegram-id/${encodeURIComponent(telegramId)}`);
    }
    if (result.error || result.status !== 200 || !result.data || typeof result.data !== "object") throw unavailable();
    const envelope = result.data as Record<string, unknown>;
    const body = envelope.response ?? envelope.data ?? envelope;
    if (!body || typeof body !== "object") throw unavailable();
    const record = body as Record<string, unknown>;
    const users = Array.isArray(body)
      ? body
      : Array.isArray(record.users)
        ? record.users
        : record.telegramId !== undefined
          ? [record]
          : null;
    if (!Array.isArray(users)) throw unavailable();
    for (const user of users) {
      if (!user || typeof user !== "object" || String(user.telegramId) !== telegramId) throw unavailable();
      const id = extractRemnaUuid(user);
      if (!id) throw unavailable();
      found.set(id, parseRemoteSubscription(user as Record<string, unknown>, id));
    }
    if (legacy || record.hasMore === false) return [...found.values()];
    if (record.hasMore !== true || typeof record.nextCursor !== "string" || !/^\d+$/.test(record.nextCursor)
      || cursors.has(record.nextCursor)) throw unavailable();
    cursor = record.nextCursor;
    cursors.add(cursor);
  }
  throw unavailable();
}

export async function checkTelegramSubscriptionOwners(ids: string[], clientId?: string): Promise<void> {
  if (!ids.length) return;
  const [subscriptions, clients] = await Promise.all([
    prisma.subscription.findMany({ where: { remnawaveUuid: { in: ids } }, select: { ownerId: true } }),
    prisma.client.findMany({ where: { remnawaveUuid: { in: ids } }, select: { id: true } }),
  ]);
  if (subscriptions.some(sub => sub.ownerId !== clientId) || clients.some(client => client.id !== clientId)) throw accountConflict();
}

export async function adminDetachedUuids(clientId?: string): Promise<Set<string>> {
  const rows = await prisma.giftHistory.findMany({
    where: { clientId, eventType: { in: ADMIN_DETACH_EVENTS } },
    select: { metadata: true },
  });
  const uuids = new Set<string>();
  for (const row of rows) {
    const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? row.metadata as Record<string, unknown>
      : null;
    if (metadata?.deletedBy !== "admin" && metadata?.unlinkedBy !== "admin") continue;
    if (typeof metadata.remnawaveUuid === "string" && metadata.remnawaveUuid) uuids.add(metadata.remnawaveUuid);
  }
  return uuids;
}

async function loadRemoteSubscription(uuid: string, known?: TelegramRemoteSubscription): Promise<TelegramRemoteSubscription> {
  if (known) return known;
  try {
    const result = await remnaGetUser(uuid);
    if (result.error || !result.data || typeof result.data !== "object") {
      if (result.status === 404) return { remnawaveUuid: uuid, status: "MISSING", expireAt: null };
      throw unavailable();
    }
    const raw = result.data as Record<string, unknown>;
    const user = (raw.response ?? raw) as Record<string, unknown>;
    return parseRemoteSubscription(user, uuid);
  } catch {
    throw unavailable();
  }
}

export async function restoreTelegramSubscriptions(
  client: { id: string; remnawaveUuid: string | null },
  candidates: TelegramRemoteSubscription[],
): Promise<void> {
  const detached = await adminDetachedUuids(client.id);
  const known = new Map<string, TelegramRemoteSubscription>();
  for (const candidate of candidates) {
    if (!detached.has(candidate.remnawaveUuid)) known.set(candidate.remnawaveUuid, candidate);
  }
  const anchor = client.remnawaveUuid && !detached.has(client.remnawaveUuid) ? client.remnawaveUuid : null;
  const allIds = [...new Set([...(anchor ? [anchor] : []), ...known.keys()])];
  if (!allIds.length) return;
  await checkTelegramSubscriptionOwners(allIds, client.id);

  const existing = await prisma.subscription.findMany({
    where: { ownerId: client.id },
    select: { remnawaveUuid: true, expireAt: true },
  });

  const live: string[] = [];
  const dead: TelegramRemoteSubscription[] = [];
  for (const uuid of allIds) {
    const remote = await loadRemoteSubscription(uuid, known.get(uuid));
    if (isLiveRemnaSubscription(remote)) live.push(uuid);
    else if (remote.status !== "MISSING") dead.push(remote);
  }

  let selected: string[];
  if (live.length) {
    selected = live;
  } else if (!existing.length && dead.length) {
    const latest = dead.reduce((best, item) => {
      const bestTime = best.expireAt ? new Date(best.expireAt).getTime() : 0;
      const itemTime = item.expireAt ? new Date(item.expireAt).getTime() : 0;
      return itemTime > bestTime ? item : best;
    });
    selected = [latest.remnawaveUuid];
  } else {
    selected = [];
  }

  for (const remnawaveUuid of selected) {
    try { await upsertSubscriptionByRemnaUuid(client.id, { remnawaveUuid }); }
    catch (error) {
      if (error instanceof Error && error.message === "VPN profile belongs to another client") throw accountConflict();
      throw unavailable();
    }
  }
  if (selected.length) {
    await prisma.client.updateMany({ where: { id: client.id, remnawaveUuid: null }, data: { remnawaveUuid: selected[0] } });
  }
}
