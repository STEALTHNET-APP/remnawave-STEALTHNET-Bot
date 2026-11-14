const DAY_MS = 24 * 60 * 60 * 1000;

export interface TrialCleanupSubscription {
  id: string;
  tariffId: string | null;
  trialId: string | null;
  remnawaveUuid: string | null;
  expireAt: Date | null;
  createdAt: Date;
}

export interface TrialCleanupCandidate {
  id: string;
  role: string;
  balance: number;
  trialUsed: boolean;
  createdAt: Date;
  remnawaveUuid: string | null;
  payments: Array<{ id: string; status: string }>;
  tickets: Array<{ id: string; status: string }>;
  trialUsages: Array<{ subscriptionId: string | null }>;
  ownedSubscriptions: TrialCleanupSubscription[];
}

export function trialCleanupCutoff(now: Date, days: number): Date {
  const safeDays = Number.isFinite(days) ? Math.max(1, Math.floor(days)) : 90;
  return new Date(now.getTime() - safeDays * DAY_MS);
}

export function isTrialCleanupCandidate(
  client: TrialCleanupCandidate,
  cutoffDate: Date,
): boolean {
  if (client.role !== "CLIENT" || !Number.isFinite(client.balance) || client.balance !== 0) return false;
  if (client.payments.length > 0) return false;
  if (client.tickets.some(ticket => ticket.status === "open" || ticket.status === "pending")) return false;
  if (client.ownedSubscriptions.length === 0) return false;
  if (client.remnawaveUuid && !client.ownedSubscriptions.some(sub => sub.remnawaveUuid === client.remnawaveUuid)) return false;
  for (const sub of client.ownedSubscriptions) {
    if (!sub.trialId || !sub.expireAt || !Number.isFinite(sub.expireAt.getTime()) || sub.expireAt > cutoffDate) return false;
  }
  return true;
}
