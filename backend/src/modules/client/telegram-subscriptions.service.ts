import { prisma } from "../../db.js";
import { isRemnaConfigured, remnaFetch, extractRemnaUuid } from "../remna/remna.client.js";
import { upsertSubscriptionByRemnaUuid } from "../subscription/subscription.helpers.js";

export class TelegramSubscriptionCheckError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

const unavailable = () => new TelegramSubscriptionCheckError(503,
  "Не удалось проверить существующие подписки. Попробуйте /start позже — новая подписка не создана.");
const accountConflict = () => new TelegramSubscriptionCheckError(409,
  "Найдена подписка в другом аккаунте. Войдите на сайт в свой аккаунт и привяжите Telegram в профиле. Если Telegram уже привязан, обратитесь в поддержку.");

export async function findTelegramSubscriptions(telegramId: string): Promise<string[]> {
  if (!isRemnaConfigured()) return [];
  const ids = new Set<string>();
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
    const users = Array.isArray(body) ? body : record.users;
    if (!Array.isArray(users)) throw unavailable();
    for (const user of users) {
      if (!user || typeof user !== "object" || String(user.telegramId) !== telegramId) throw unavailable();
      const id = extractRemnaUuid(user);
      if (!id) throw unavailable();
      ids.add(id);
    }
    if (legacy || record.hasMore === false) return [...ids];
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

export async function restoreTelegramSubscriptions(client: { id: string; remnawaveUuid: string | null }, ids: string[]): Promise<void> {
  const allIds = [...new Set([...(client.remnawaveUuid ? [client.remnawaveUuid] : []), ...ids])];
  await checkTelegramSubscriptionOwners(allIds, client.id);
  for (const remnawaveUuid of allIds) {
    try { await upsertSubscriptionByRemnaUuid(client.id, { remnawaveUuid }); }
    catch (error) {
      if (error instanceof Error && error.message === "VPN profile belongs to another client") throw accountConflict();
      throw unavailable();
    }
  }
  if (allIds.length) {
    await prisma.client.updateMany({ where: { id: client.id, remnawaveUuid: null }, data: { remnawaveUuid: allIds[0] } });
  }
}
