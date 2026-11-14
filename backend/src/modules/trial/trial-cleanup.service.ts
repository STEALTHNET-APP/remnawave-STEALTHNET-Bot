import type { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import { getSystemConfig } from "../client/client.service.js";
import { isRemnaConfigured, remnaDeleteUser } from "../remna/remna.client.js";
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
}

const trialCleanupSelect = {
  id: true,
  role: true,
  balance: true,
  trialUsed: true,
  createdAt: true,
  remnawaveUuid: true,
  payments: { where: { status: "PAID" }, select: { id: true, status: true }, take: 1 },
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
  role: { not: "ADMIN" },
  balance: { lte: 0 },
  payments: { none: { status: "PAID" } },
  tickets: { none: { status: { in: ["open", "pending"] } } },
  ownedSubscriptions: { none: { tariffId: { not: null }, trialId: null } },
  OR: [
    { trialUsed: true },
    { trialUsages: { some: {} } },
    { ownedSubscriptions: { some: { trialId: { not: null } } } },
  ],
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

async function deleteTrialClient(client: TrialCleanupCandidate): Promise<void> {
  if (isRemnaConfigured()) {
    const uuids = new Set<string>();
    if (client.remnawaveUuid) uuids.add(client.remnawaveUuid);
    for (const subscription of client.ownedSubscriptions) {
      if (subscription.remnawaveUuid) uuids.add(subscription.remnawaveUuid);
    }

    for (const uuid of uuids) {
      try {
        const result = await remnaDeleteUser(uuid);
        if (result.error) console.warn(`[trial-cleanup] Remna delete failed for ${uuid}:`, result.error);
      } catch (error) {
        console.warn(`[trial-cleanup] Remna delete threw for ${uuid}:`, error);
      }
    }
  }

  await prisma.client.delete({ where: { id: client.id } });
}

export async function runTrialCleanup({ dryRun = false }: { dryRun?: boolean } = {}): Promise<TrialCleanupResult> {
  const config = await getSystemConfig();

  if (!dryRun && !config.trialCleanupEnabled) {
    return { candidateCount: 0, deletedCount: 0, dryRun: false };
  }

  const candidates = await findTrialCleanupCandidates({ days: config.trialCleanupDays });

  if (dryRun) {
    return { candidateCount: candidates.length, deletedCount: 0, dryRun: true };
  }

  let deletedCount = 0;
  for (let offset = 0; offset < candidates.length; offset += BATCH_SIZE) {
    const batch = candidates.slice(offset, offset + BATCH_SIZE);
    for (const client of batch) {
      try {
        await deleteTrialClient(client);
        deletedCount += 1;
      } catch (error) {
        console.error(`[trial-cleanup] Failed to delete client ${client.id}:`, error);
      }
    }
  }

  if (deletedCount > 0) {
    console.log(`[trial-cleanup] Deleted ${deletedCount} inactive trial client(s)`);
  }

  return { candidateCount: candidates.length, deletedCount, dryRun: false };
}
