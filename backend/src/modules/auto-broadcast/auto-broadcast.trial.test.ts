import assert from "node:assert/strict";
import test from "node:test";
import {
  computeClientTrialEndedAt,
  isTrialEligibleInWindow,
  type TrialCandidateClient,
} from "./auto-broadcast.service.js";

const DAY_MS = 24 * 60 * 60 * 1000;

test("computeClientTrialEndedAt returns subscription expireAt for multi-trial usage", () => {
  const expireAt = new Date("2026-10-20T12:00:00.000Z");
  const client: TrialCandidateClient = {
    id: "c-1",
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    trialUsed: false,
    trialUsages: [
      {
        activatedAt: new Date("2026-10-17T12:00:00.000Z"),
        subscriptionId: "sub-100",
        trial: { durationDays: 3 },
      },
    ],
    ownedSubscriptions: [
      {
        id: "sub-100",
        trialId: "trial-1",
        createdAt: new Date("2026-10-17T12:00:00.000Z"),
        expireAt,
      },
    ],
  };

  const endedAt = computeClientTrialEndedAt(client);
  assert.ok(endedAt);
  assert.equal(endedAt.getTime(), expireAt.getTime());
});

test("computeClientTrialEndedAt calculates activatedAt + durationDays when subscription is missing", () => {
  const activatedAt = new Date("2026-10-10T10:00:00.000Z");
  const client: TrialCandidateClient = {
    id: "c-2",
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    trialUsed: false,
    trialUsages: [
      {
        activatedAt,
        subscriptionId: null,
        trial: { durationDays: 7 },
      },
    ],
  };

  const endedAt = computeClientTrialEndedAt(client);
  assert.ok(endedAt);
  const expected = new Date(activatedAt.getTime() + 7 * DAY_MS);
  assert.equal(endedAt.getTime(), expected.getTime());
});

test("computeClientTrialEndedAt returns latest end date when client activated multiple trials", () => {
  const client: TrialCandidateClient = {
    id: "c-3",
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    trialUsed: true,
    trialUsages: [
      {
        activatedAt: new Date("2026-10-01T00:00:00.000Z"),
        subscriptionId: "sub-1",
        trial: { durationDays: 3 },
      },
      {
        activatedAt: new Date("2026-10-15T00:00:00.000Z"),
        subscriptionId: "sub-2",
        trial: { durationDays: 5 },
      },
    ],
    ownedSubscriptions: [
      {
        id: "sub-1",
        trialId: "t-1",
        createdAt: new Date("2026-10-01T00:00:00.000Z"),
        expireAt: new Date("2026-10-04T00:00:00.000Z"),
      },
      {
        id: "sub-2",
        trialId: "t-2",
        createdAt: new Date("2026-10-15T00:00:00.000Z"),
        expireAt: new Date("2026-10-20T00:00:00.000Z"),
      },
    ],
  };

  const endedAt = computeClientTrialEndedAt(client);
  assert.ok(endedAt);
  assert.equal(endedAt.toISOString(), "2026-10-20T00:00:00.000Z");
});

test("computeClientTrialEndedAt supports legacy trials with trialUsed=true and subscription expireAt", () => {
  const expireAt = new Date("2026-06-15T00:00:00.000Z");
  const client: TrialCandidateClient = {
    id: "c-legacy",
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    trialUsed: true,
    trialUsages: [],
    ownedSubscriptions: [
      {
        id: "legacy-sub",
        createdAt: new Date("2026-06-01T00:00:00.000Z"),
        expireAt,
      },
    ],
  };

  const endedAt = computeClientTrialEndedAt(client);
  assert.ok(endedAt);
  assert.equal(endedAt.getTime(), expireAt.getTime());
});

test("computeClientTrialEndedAt returns null for client who never used a trial", () => {
  const client: TrialCandidateClient = {
    id: "c-notrial",
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    trialUsed: false,
    trialUsages: [],
    ownedSubscriptions: [],
  };

  const endedAt = computeClientTrialEndedAt(client);
  assert.equal(endedAt, null);
});

test("isTrialEligibleInWindow returns true when trialEndedAt matches delayDays and sliding window", () => {
  const now = new Date("2026-10-23T09:00:00.000Z");
  const delayDays = 3;
  // windowEnd = now - 3 days = 2026-10-20T09:00:00.000Z
  // windowStart = windowEnd - 3 days = 2026-10-17T09:00:00.000Z

  // Trial ended exactly 3 days ago (at windowEnd)
  const eligible1 = isTrialEligibleInWindow({
    trialEndedAt: new Date("2026-10-20T09:00:00.000Z"),
    now,
    delayDays,
    windowDays: 3,
  });
  assert.equal(eligible1, true);

  // Trial ended 4.5 days ago (inside window)
  const eligible2 = isTrialEligibleInWindow({
    trialEndedAt: new Date("2026-10-18T18:00:00.000Z"),
    now,
    delayDays,
    windowDays: 3,
  });
  assert.equal(eligible2, true);

  // Trial ended 6 days ago (at windowStart)
  const eligible3 = isTrialEligibleInWindow({
    trialEndedAt: new Date("2026-10-17T09:00:00.000Z"),
    now,
    delayDays,
    windowDays: 3,
  });
  assert.equal(eligible3, true);
});

test("isTrialEligibleInWindow returns false when trial is too recent (delay not yet reached)", () => {
  const now = new Date("2026-10-23T09:00:00.000Z");
  const delayDays = 3;
  // Trial ended 1 day ago (delayDays=3 not reached yet)
  const eligible = isTrialEligibleInWindow({
    trialEndedAt: new Date("2026-10-22T09:00:00.000Z"),
    now,
    delayDays,
    windowDays: 3,
  });
  assert.equal(eligible, false);
});

test("isTrialEligibleInWindow returns false when trial ended too long ago (outside sliding window)", () => {
  const now = new Date("2026-10-23T09:00:00.000Z");
  const delayDays = 3;
  // Trial ended 15 days ago (ancient trial, outside 3-day window)
  const eligible = isTrialEligibleInWindow({
    trialEndedAt: new Date("2026-10-08T09:00:00.000Z"),
    now,
    delayDays,
    windowDays: 3,
  });
  assert.equal(eligible, false);
});

test("isTrialEligibleInWindow returns false when trialEndedAt is null", () => {
  const now = new Date("2026-10-23T09:00:00.000Z");
  const eligible = isTrialEligibleInWindow({
    trialEndedAt: null,
    now,
    delayDays: 3,
    windowDays: 3,
  });
  assert.equal(eligible, false);
});
