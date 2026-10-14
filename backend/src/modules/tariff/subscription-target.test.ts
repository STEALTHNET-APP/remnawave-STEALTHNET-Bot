import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isLegacyTrialRecord,
  isOnTrialSquad,
  pickConvertibleSubscription,
  type ConvertibleCandidate,
} from "./subscription-target.js";
import { parseMultiSubscriptionsEnabled, isMultiSubscriptionsEnabled, describeMultiSubscriptionsRaw } from "../client/multi-subscriptions.js";

const day = 86_400_000;
const now = Date.now();

function sub(over: Partial<ConvertibleCandidate> & { id: string }): ConvertibleCandidate {
  return {
    subscriptionIndex: 0,
    tariffId: null,
    categoryId: null,
    trialId: null,
    expireAt: null,
    isLegacyTrial: false,
    ...over,
  };
}

test("parseMultiSubscriptionsEnabled: only true/1 (trimmed, case-insensitive) enable multi", () => {
  for (const on of ["true", "TRUE", " True ", "1", " 1"]) assert.equal(parseMultiSubscriptionsEnabled(on), true, on);
  for (const off of [undefined, null, "", "false", "False", "0", "no", "off", "yes", "2"]) {
    assert.equal(parseMultiSubscriptionsEnabled(off), false, String(off));
  }
});

test("isMultiSubscriptionsEnabled: missing config/flag is OFF, never ON by default", () => {
  assert.equal(isMultiSubscriptionsEnabled(null), false);
  assert.equal(isMultiSubscriptionsEnabled(undefined), false);
  assert.equal(isMultiSubscriptionsEnabled({}), false);
  assert.equal(isMultiSubscriptionsEnabled({ multiSubscriptionsEnabled: false }), false);
  assert.equal(isMultiSubscriptionsEnabled({ multiSubscriptionsEnabled: true }), true);
});

test("isLegacyTrialRecord: tariff-less, trial-less, unpriced, owned, linked to Remnawave", () => {
  const base = { tariffId: null, trialId: null, purchasedAsGift: false, giftStatus: null, remnawaveUuid: "u", customPrice: null };
  assert.equal(isLegacyTrialRecord(base), true);
  assert.equal(isLegacyTrialRecord({ ...base, tariffId: "t" }), false, "paid tariff");
  assert.equal(isLegacyTrialRecord({ ...base, trialId: "tr" }), false, "multi-trial is handled elsewhere");
  assert.equal(isLegacyTrialRecord({ ...base, purchasedAsGift: true }), false, "gift");
  assert.equal(isLegacyTrialRecord({ ...base, giftStatus: "GIFT_RESERVED" }), false, "reserved gift");
  assert.equal(isLegacyTrialRecord({ ...base, remnawaveUuid: null }), false, "no Remnawave user");
  assert.equal(isLegacyTrialRecord({ ...base, customPrice: 300 }), false, "custom build has a price");
});

test("describeMultiSubscriptionsRaw: unrecognised non-empty values are flagged", () => {
  for (const ok of [undefined, null, "", " ", "true", "TRUE", "1", "false", "False", "0"]) {
    assert.equal(describeMultiSubscriptionsRaw(ok).recognised, true, String(ok));
  }
  for (const bad of ["yes", "on", "off", "2", "enabled"]) assert.equal(describeMultiSubscriptionsRaw(bad).recognised, false, bad);
});

test("isOnTrialSquad: trial squad must be configured and present", () => {
  assert.equal(isOnTrialSquad(["a", "trial"], "trial"), true);
  assert.equal(isOnTrialSquad(["a"], "trial"), false);
  assert.equal(isOnTrialSquad(["trial"], null), false);
  assert.equal(isOnTrialSquad(["trial"], "  "), false);
  assert.equal(isOnTrialSquad([" trial"], "trial "), false, "uuids compared exactly after config trim");
});

test("multi ON, no category single: legacy trial is converted in place instead of a new _1", () => {
  const legacy = sub({ id: "legacy", isLegacyTrial: true, expireAt: new Date(now + 2 * day) });
  const r = pickConvertibleSubscription([legacy], { tariffId: "paid", categoryId: "cat", multiSubEnabled: true, perCategorySingle: false });
  assert.equal(r?.id, "legacy");
});

test("multi ON: paid subscriptions and multi-trials are left alone (additional sub is created)", () => {
  const paid = sub({ id: "paid", tariffId: "other", categoryId: "cat", expireAt: new Date(now + 20 * day) });
  const multiTrial = sub({ id: "mt", subscriptionIndex: 1, tariffId: "trialTariff", trialId: "tr" });
  const r = pickConvertibleSubscription([paid, multiTrial], { tariffId: "paid2", categoryId: "cat", multiSubEnabled: true, perCategorySingle: false });
  assert.equal(r, null);
});

test("multi ON: buyer picked a multi-trial to replace → legacy trial is not hijacked", () => {
  const legacy = sub({ id: "legacy", isLegacyTrial: true });
  const r = pickConvertibleSubscription([legacy], { tariffId: "p", categoryId: null, multiSubEnabled: true, perCategorySingle: false, preferredSubId: "other-trial" });
  assert.equal(r, null);
});

test("multi ON + category single: category sub wins; legacy trial is the fallback", () => {
  const legacy = sub({ id: "legacy", isLegacyTrial: true, expireAt: new Date(now + 9 * day) });
  const cat = sub({ id: "cat", subscriptionIndex: 1, tariffId: "t1", categoryId: "cat", expireAt: new Date(now + day) });
  const opts = { tariffId: "t2", categoryId: "cat", multiSubEnabled: true, perCategorySingle: true };
  assert.equal(pickConvertibleSubscription([legacy, cat], opts)?.id, "cat");
  assert.equal(pickConvertibleSubscription([legacy], opts)?.id, "legacy");
});

test("multi OFF: explicit trial target wins over expireAt ordering", () => {
  const a = sub({ id: "a", tariffId: "x", expireAt: new Date(now + 30 * day) });
  const b = sub({ id: "b", subscriptionIndex: 1, tariffId: "y", trialId: "tr", expireAt: new Date(now + day) });
  const r = pickConvertibleSubscription([a, b], { tariffId: "z", categoryId: null, multiSubEnabled: false, perCategorySingle: false, preferredSubId: "b" });
  assert.equal(r?.id, "b");
});

test("multi OFF: explicit trial choice does not override a paid sub of the same tariff", () => {
  const paid = sub({ id: "paid", subscriptionIndex: 1, tariffId: "x", expireAt: new Date(now + 5 * day) });
  const legacy = sub({ id: "legacy", isLegacyTrial: true, expireAt: new Date(now + day) });
  const multiTrial = sub({ id: "mt", subscriptionIndex: 2, tariffId: "tt", trialId: "tr" });
  const opts = { tariffId: "x", categoryId: null, multiSubEnabled: false, perCategorySingle: false };
  assert.equal(pickConvertibleSubscription([paid, legacy, multiTrial], { ...opts, preferredSubId: "legacy" })?.id, "paid");
  assert.equal(pickConvertibleSubscription([paid, legacy, multiTrial], { ...opts, preferredSubId: "mt" })?.id, "paid");
});

test("multi OFF: explicit non-trial choice is ignored in favour of normal ordering", () => {
  const a = sub({ id: "a", tariffId: "x", expireAt: new Date(now + 30 * day) });
  const b = sub({ id: "b", subscriptionIndex: 1, tariffId: "y", expireAt: new Date(now + day) });
  const r = pickConvertibleSubscription([a, b], { tariffId: "x", categoryId: null, multiSubEnabled: false, perCategorySingle: false, preferredSubId: "b" });
  assert.equal(r?.id, "a");
});

test("multi OFF: explicit trial choice wins when no same-tariff paid sub exists", () => {
  const a = sub({ id: "a", tariffId: "x", expireAt: new Date(now + 30 * day) });
  const legacy = sub({ id: "legacy", subscriptionIndex: 1, isLegacyTrial: true, expireAt: new Date(now + day) });
  const r = pickConvertibleSubscription([a, legacy], { tariffId: "z", categoryId: null, multiSubEnabled: false, perCategorySingle: false, preferredSubId: "legacy" });
  assert.equal(r?.id, "legacy");
});

test("multi OFF: unknown explicit target falls back to normal ordering", () => {
  const a = sub({ id: "a", tariffId: "x", expireAt: new Date(now + 30 * day) });
  const r = pickConvertibleSubscription([a], { tariffId: "z", categoryId: null, multiSubEnabled: false, perCategorySingle: false, preferredSubId: "foreign" });
  assert.equal(r?.id, "a");
});

test("multi OFF: same-tariff paid sub first, then paid over trials even if a trial lives longer", () => {
  const legacy = sub({ id: "legacy", isLegacyTrial: true, expireAt: new Date(now + 3 * day) });
  const paid1 = sub({ id: "paid1", subscriptionIndex: 1, tariffId: "x", expireAt: new Date(now + day) });
  const paid2 = sub({ id: "paid2", subscriptionIndex: 2, tariffId: "y", expireAt: new Date(now + 2 * day) });
  const opts = { categoryId: null, multiSubEnabled: false, perCategorySingle: false };
  assert.equal(pickConvertibleSubscription([legacy, paid1, paid2], { ...opts, tariffId: "x" })?.id, "paid1");
  assert.equal(pickConvertibleSubscription([legacy, paid1, paid2], { ...opts, tariffId: "z" })?.id, "paid2");
  assert.equal(pickConvertibleSubscription([legacy], { ...opts, tariffId: "z" })?.id, "legacy");
});

test("multi OFF: expired paid subs still beat a live trial (null expireAt last)", () => {
  const trial = sub({ id: "trial", tariffId: "tt", trialId: "tr", expireAt: new Date(now + 3 * day) });
  const paidNull = sub({ id: "paidNull", subscriptionIndex: 1, tariffId: "x", expireAt: null });
  const paidOld = sub({ id: "paidOld", subscriptionIndex: 2, tariffId: "y", expireAt: new Date(now - day) });
  const r = pickConvertibleSubscription([trial, paidNull, paidOld], { tariffId: "z", categoryId: null, multiSubEnabled: false, perCategorySingle: false });
  assert.equal(r?.id, "paidOld");
});

test("multi OFF: no subscriptions → null (create the first one)", () => {
  assert.equal(pickConvertibleSubscription([], { tariffId: "z", categoryId: null, multiSubEnabled: false, perCategorySingle: false }), null);
});

test('first paid purchase keeps the promo primary in both subscription modes', () => {
  const promo = sub({id:'promo',subscriptionIndex:0,tariffId:'promo-tariff',promoGranted:true});
  const paid = sub({id:'paid',subscriptionIndex:1,tariffId:'target',expireAt:new Date(now+30*day)});
  for (const multiSubEnabled of [true,false]) {
    assert.equal(pickConvertibleSubscription([paid,promo],{tariffId:'target',categoryId:null,multiSubEnabled,perCategorySingle:false})?.id,'promo');
  }
});
