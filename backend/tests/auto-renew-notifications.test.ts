import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pickDueUpcomingTemplates,
  upcomingDedupBucket,
} from "../src/modules/notification/auto-renew-schedule.js";
import {
  LEGACY_AUTO_RENEW_CLIENT_WHERE,
  excludeLegacyAutoRenewSubs,
} from "../src/modules/payment/legacy-auto-renew-scope.js";

const T3D = { id: "arn_default_upcoming_3d", offsetMinutes: 4320 };
const T1D = { id: "arn_default_upcoming_1d", offsetMinutes: 1440 };
const T15M = { id: "arn_default_upcoming_15m", offsetMinutes: 15 };
const ALL = [T3D, T1D, T15M];
const ids = (ml: number) => pickDueUpcomingTemplates(ALL, ml).map((t) => t.id);

test("15-minute template is not due 44 minutes before expiry", () => {
  assert.deepEqual(ids(44), []);
  assert.deepEqual(ids(16), []);
});

test("15-minute template is due once minutesLeft <= 15", () => {
  assert.deepEqual(ids(15), [T15M.id]);
  assert.deepEqual(ids(3), [T15M.id]);
  assert.deepEqual(ids(1), [T15M.id]);
});

test("nothing is due for expired subscriptions", () => {
  assert.deepEqual(ids(0), []);
  assert.deepEqual(ids(-5), []);
});

test("3d and 1d templates fire from their offset, only the closest one", () => {
  assert.deepEqual(ids(4320), [T3D.id]);
  assert.deepEqual(ids(4000), [T3D.id]);
  assert.deepEqual(ids(1440), [T1D.id]);
  assert.deepEqual(ids(1300), [T1D.id]);
  assert.deepEqual(ids(5000), []);
});

test("catch-up limit: a long-passed reminder is not sent late", () => {
  // 3d template, but only 2 hours left (subscription bought late): no "3 days" reminder.
  assert.deepEqual(ids(120), []);
  // 1d template, 3 hours left: too late for "tomorrow".
  assert.deepEqual(pickDueUpcomingTemplates([T1D], 180), []);
  // 1d template, 5 hours late is still inside the catch-up window.
  assert.deepEqual(pickDueUpcomingTemplates([T1D], 1440 - 300).map((t) => t.id), [T1D.id]);
});

test("templates sharing the closest offset are all returned", () => {
  const a = { id: "a", offsetMinutes: 60 };
  const b = { id: "b", offsetMinutes: 60 };
  assert.deepEqual(pickDueUpcomingTemplates([a, b, T1D], 50).map((t) => t.id), ["a", "b"]);
});

test("dedup bucket is stable across clock hours and changes on renewal", () => {
  const expireAt = new Date("2026-10-07T18:00:00.000Z");
  const h1 = upcomingDedupBucket(expireAt, Date.parse("2026-10-07T17:31:00Z"), 3600000);
  const h2 = upcomingDedupBucket(expireAt, Date.parse("2026-10-07T18:00:00Z") - 1000, 3600000);
  assert.equal(h1, h2);
  const renewed = new Date("2026-11-06T18:00:00.000Z");
  assert.notEqual(upcomingDedupBucket(renewed, Date.parse("2026-10-07T17:31:00Z"), 3600000), h1);
});

test("dedup bucket falls back to the ttl bucket without expireAt", () => {
  assert.equal(upcomingDedupBucket(null, 7200000 + 5, 3600000), "2");
});

test("auto-broadcast excludes exactly what the legacy client loop handles", () => {
  assert.deepEqual(LEGACY_AUTO_RENEW_CLIENT_WHERE, {
    autoRenewEnabled: true,
    autoRenewTariffId: { not: null },
    remnawaveUuid: { not: null },
    isBlocked: false,
  });
  assert.deepEqual(excludeLegacyAutoRenewSubs(), {
    NOT: { subscriptionIndex: 0, owner: LEGACY_AUTO_RENEW_CLIENT_WHERE },
  });
});
