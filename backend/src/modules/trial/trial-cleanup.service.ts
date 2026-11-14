import type { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import { getSystemConfig } from "../client/client.service.js";
import { isRemnaConfigured, remnaDeleteUser, remnaGetUser } from "../remna/remna.client.js";
import {
  isTrialCleanupCandidate,
  trialCleanupCutoff,
  type TrialCleanupCandidate,
} from "./trial-cleanup.rules.js";

export {
  isTrialCleanupCandidate,
  trialCleanupCutoff,
  type TrialCleanupCandidate,
  type TrialCleanupSubscription,
} from "./trial-cleanup.rules.js";

const BATCH_SIZE = 50;
const PAGE_SIZE = 200;

export interface TrialCleanupResult {
  candidateCount: number;
  deletedCount: number;
  dryRun: boolean;
  skippedCount: number;
  failedCount: number;
}

const trialCleanupSelect = {
  id: true,
  role: true,
  balance: true,
  trialUsed: true,
  createdAt: true,
  remnawaveUuid: true,
  payments: { select: { id: true, status: true }, take: 1 },
  tickets: { where: { status: { in: ["open", "pending"] } }, select: { id: true, status: true }, take: 1 },
  trialUsages: { select: { subscriptionId: true } },
  ownedSubscriptions: {
    select: {
      id: true,
      tariffId: true,
      trialId: true,
      remnawaveUuid: true,
      expireAt: true,
      createdAt: true,
    },
  },
} satisfies Prisma.ClientSelect;

const trialCleanupBaseWhere = {
  role: "CLIENT",
  balance: 0,
  payments: { none: {} },
  cloudAgreements: { none: {} },
  tickets: { none: { status: { in: ["open", "pending"] } } },
  proxySlots: { none: {} },
  singboxSlots: { none: {} },
  receivedSubscriptions: { none: {} },
  giftCodesCreated: { none: {} },
  giftCodesRedeemed: { none: {} },
  referrals: { none: {} },
  withdrawalRequests: { none: {} },
  ownedSubscriptions: { some: {}, every: { trialId: { not: null }, trial: { is: { price: 0 } }, purchasedAsGift: false, giftStatus: null, giftedToClientId: null } },
} satisfies Prisma.ClientWhereInput;

export async function findTrialCleanupCandidates(options: { now?: Date; days?: number } = {}): Promise<TrialCleanupCandidate[]> {
  const now = options.now ?? new Date();
  const days = options.days ?? (await getSystemConfig()).trialCleanupDays;
  const cutoffDate = trialCleanupCutoff(now, days);
  const candidates: TrialCleanupCandidate[] = [];
  let lastId: string | undefined;

  for (;;) {
    const page = await prisma.client.findMany({
      where: { ...trialCleanupBaseWhere, ...(lastId ? { id: { gt: lastId } } : {}) },
      orderBy: { id: "asc" },
      take: PAGE_SIZE,
      select: trialCleanupSelect,
    });

    if (page.length === 0) break;

    for (const client of page) {
      if (isTrialCleanupCandidate(client, cutoffDate)) candidates.push(client);
    }

    if (page.length < PAGE_SIZE) break;
    lastId = page[page.length - 1]?.id;
    if (!lastId) break;
  }

  return candidates;
}

export async function deleteTrialClient(clientId: string, cutoffDate: Date): Promise<boolean> {
  return prisma.$transaction(async db => {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"subscription-owner:" + clientId}, 0))`;
    await db.$queryRaw`SELECT id FROM clients WHERE id = ${clientId} FOR UPDATE`;
    await db.$queryRaw`SELECT id FROM subscriptions WHERE owner_id = ${clientId} ORDER BY id FOR UPDATE`;
    const client = await db.client.findFirst({ where: { id: clientId, ...trialCleanupBaseWhere }, select: trialCleanupSelect });
    if (!client || !isTrialCleanupCandidate(client, cutoffDate)) return false;
    const uuids = [...new Set(client.ownedSubscriptions.map(s => s.remnawaveUuid).filter((uuid): uuid is string => !!uuid))].sort();
    if (uuids.length && !isRemnaConfigured()) throw new Error("Remna не настроена; клиент сохранён");
    for (const uuid of uuids) {
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"subscription-remna:" + uuid}, 0))`;
      const anotherSub = await db.subscription.findFirst({ where: { remnawaveUuid: uuid, ownerId: { not: clientId } } });
      const anotherClient = await db.client.findFirst({ where: { remnawaveUuid: uuid, id: { not: clientId } } });
      if (anotherSub || anotherClient) return false;
      const remote = await remnaGetUser(uuid);
      if (remote.status === 404) continue;
      if (remote.error || remote.status < 200 || remote.status >= 300) throw new Error("Не удалось проверить подписку в Remna; клиент сохранён");
      const body = remote.data as { response?: { expireAt?: string; status?: string }; expireAt?: string; status?: string } | undefined;
      const user = body?.response ?? body;
      const expiry = user?.expireAt ? new Date(user.expireAt) : null;
      if (!expiry || !Number.isFinite(expiry.getTime()) || expiry > cutoffDate || user?.status !== "EXPIRED") return false;
    }
    for (const uuid of uuids) {
      const result = await remnaDeleteUser(uuid);
      if (result.status === 404) continue;
      if (result.error || result.status < 200 || result.status >= 300) throw new Error("Удаление в Remna не подтверждено; клиент сохранён для повторной проверки");
      const verified = await remnaGetUser(uuid);
      if (verified.status !== 404) throw new Error("Remna ещё не подтвердила отсутствие профиля; клиент сохранён");
    }
    await db.client.delete({ where: { id: clientId } });
    return true;
  }, { timeout: 120_000, maxWait: 5_000 });
}

export async function runTrialCleanup({ dryRun = false }: { dryRun?: boolean } = {}): Promise<TrialCleanupResult> {
  const config = await getSystemConfig();

  if (!dryRun && !config.trialCleanupEnabled) {
    return { candidateCount: 0, deletedCount: 0, dryRun: false, skippedCount: 0, failedCount: 0 };
  }

  const candidates = await findTrialCleanupCandidates({ days: config.trialCleanupDays });

  if (dryRun) {
    return { candidateCount: candidates.length, deletedCount: 0, dryRun: true, skippedCount: 0, failedCount: 0 };
  }

  let deletedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  const cutoffDate = trialCleanupCutoff(new Date(), config.trialCleanupDays);
  for (let offset = 0; offset < candidates.length; offset += BATCH_SIZE) {
    const batch = candidates.slice(offset, offset + BATCH_SIZE);
    for (const client of batch) {
      try {
        if (await deleteTrialClient(client.id, cutoffDate)) deletedCount += 1;
        else skippedCount += 1;
      } catch (error) {
        failedCount += 1;
        console.error(`[trial-cleanup] Failed to delete client ${client.id}:`, error);
      }
    }
  }

  if (deletedCount > 0) {
    console.log(`[trial-cleanup] Deleted ${deletedCount} inactive trial client(s)`);
  }

  return { candidateCount: candidates.length, deletedCount, dryRun: false, skippedCount, failedCount };
}
