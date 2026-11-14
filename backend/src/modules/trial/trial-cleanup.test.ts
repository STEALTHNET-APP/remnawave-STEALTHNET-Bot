import assert from "node:assert/strict";
import test from "node:test";
import {
  isTrialCleanupCandidate,
  trialCleanupCutoff,
  type TrialCleanupCandidate,
} from "./trial-cleanup.rules.js";

const NOW = new Date("2026-11-14T00:00:00.000Z");
const CUTOFF = trialCleanupCutoff(NOW, 90);
const OLD = new Date("2026-08-01T00:00:00.000Z");
const RECENT = new Date("2026-11-01T00:00:00.000Z");

function makeClient(overrides: Partial<TrialCleanupCandidate> = {}): TrialCleanupCandidate {
  return {
    id: "client-1",
    role: "CLIENT",
    balance: 0,
    trialUsed: true,
    createdAt: OLD,
    remnawaveUuid: null,
    payments: [],
    tickets: [],
    trialUsages: [],
    ownedSubscriptions: [
      {
        id: "sub-1",
        tariffId: null,
        trialId: "trial-1",
        remnawaveUuid: null,
        expireAt: OLD,
        createdAt: OLD,
      },
    ],
    ...overrides,
  };
}

test("trialCleanupCutoff subtracts the configured number of days", () => {
  assert.equal(CUTOFF.toISOString(), "2026-08-16T00:00:00.000Z");
  assert.equal(trialCleanupCutoff(NOW, 1).toISOString(), "2026-11-13T00:00:00.000Z");
});

test("deletes inactive trial user without purchases after the retention period", () => {
  assert.equal(isTrialCleanupCandidate(makeClient(), CUTOFF), true);
});

test("keeps users with a positive balance", () => {
  assert.equal(isTrialCleanupCandidate(makeClient({ balance: 100 }), CUTOFF), false);
});

test("keeps users with a successful payment", () => {
  assert.equal(
    isTrialCleanupCandidate(makeClient({ payments: [{ id: "pay-1", status: "PAID" }] }), CUTOFF),
    false,
  );
});

test("keeps users with a paid subscription", () => {
  const client = makeClient({
    ownedSubscriptions: [
      {
        id: "sub-paid",
        tariffId: "tariff-1",
        trialId: null,
        remnawaveUuid: "uuid-1",
        expireAt: OLD,
        createdAt: OLD,
      },
    ],
  });
  assert.equal(isTrialCleanupCandidate(client, CUTOFF), false);
});

test("keeps users with open or pending tickets", () => {
  assert.equal(
    isTrialCleanupCandidate(makeClient({ tickets: [{ id: "t-1", status: "open" }] }), CUTOFF),
    false,
  );
  assert.equal(
    isTrialCleanupCandidate(makeClient({ tickets: [{ id: "t-2", status: "pending" }] }), CUTOFF),
    false,
  );
});

test("keeps administrators", () => {
  assert.equal(isTrialCleanupCandidate(makeClient({ role: "ADMIN" }), CUTOFF), false);
});

test("keeps users who never activated a trial", () => {
  const client = makeClient({ trialUsed: false, trialUsages: [], ownedSubscriptions: [] });
  assert.equal(isTrialCleanupCandidate(client, CUTOFF), false);
});

test("keeps users whose trial expires after the cutoff", () => {
  const client = makeClient({
    ownedSubscriptions: [
      {
        id: "sub-1",
        tariffId: null,
        trialId: "trial-1",
        remnawaveUuid: null,
        expireAt: RECENT,
        createdAt: OLD,
      },
    ],
  });
  assert.equal(isTrialCleanupCandidate(client, CUTOFF), false);
});

test("uses subscription createdAt when expireAt is missing", () => {
  const oldTrial = makeClient({
    ownedSubscriptions: [
      {
        id: "sub-old",
        tariffId: null,
        trialId: "trial-1",
        remnawaveUuid: null,
        expireAt: null,
        createdAt: OLD,
      },
    ],
  });
  assert.equal(isTrialCleanupCandidate(oldTrial, CUTOFF), true);

  const recentTrial = makeClient({
    ownedSubscriptions: [
      {
        id: "sub-recent",
        tariffId: null,
        trialId: "trial-1",
        remnawaveUuid: null,
        expireAt: null,
        createdAt: RECENT,
      },
    ],
  });
  assert.equal(isTrialCleanupCandidate(recentTrial, CUTOFF), false);
});

test("uses client createdAt when trial usage has no subscription record", () => {
  const oldClient = makeClient({
    trialUsed: true,
    trialUsages: [{ subscriptionId: null }],
    ownedSubscriptions: [],
  });
  assert.equal(isTrialCleanupCandidate(oldClient, CUTOFF), true);

  const recentClient = makeClient({
    createdAt: RECENT,
    trialUsed: true,
    trialUsages: [{ subscriptionId: null }],
    ownedSubscriptions: [],
  });
  assert.equal(isTrialCleanupCandidate(recentClient, CUTOFF), false);
});
