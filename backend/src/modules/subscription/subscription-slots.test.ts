import { test } from "node:test";
import assert from "node:assert/strict";
import { isReservedGiftStatus, planSubscriptionSlotOrder } from "./subscription-slots.js";

function sub(id: string, subscriptionIndex: number, giftStatus: string | null = null) {
  return { id, subscriptionIndex, giftStatus };
}

test("planSubscriptionSlotOrder: dense slots keep their order and need no reindex", () => {
  const plan = planSubscriptionSlotOrder([sub("a", 0), sub("b", 1), sub("c", 2)]);
  assert.deepEqual(plan.ordered.map((s) => s.id), ["a", "b", "c"]);
  assert.equal(plan.promotedId, null);
  assert.equal(plan.reindexed, false);
});

test("planSubscriptionSlotOrder: missing slot 0 promotes the lowest slot", () => {
  const plan = planSubscriptionSlotOrder([sub("b", 1), sub("c", 2)]);
  assert.deepEqual(plan.ordered.map((s) => s.id), ["b", "c"]);
  assert.equal(plan.promotedId, "b");
  assert.equal(plan.reindexed, true);
});

test("planSubscriptionSlotOrder: gap after a deletion is closed", () => {
  const plan = planSubscriptionSlotOrder([sub("a", 0), sub("c", 2)]);
  assert.deepEqual(plan.ordered.map((s) => s.id), ["a", "c"]);
  assert.equal(plan.promotedId, null);
  assert.equal(plan.reindexed, true);
});

test("planSubscriptionSlotOrder: reserved gifts never take the primary slot", () => {
  const plan = planSubscriptionSlotOrder([
    sub("gift", 0, "GIFT_RESERVED"),
    sub("paid", 1),
  ]);
  assert.deepEqual(plan.ordered.map((s) => s.id), ["paid", "gift"]);
  assert.equal(plan.promotedId, "paid");
  assert.equal(plan.reindexed, true);
});

test("planSubscriptionSlotOrder: reserved gifts alone are not promoted to slot 0", () => {
  const plan = planSubscriptionSlotOrder([sub("gift", 1, "GIFT_CODE_ACTIVE")]);
  assert.deepEqual(plan.ordered, []);
  assert.equal(plan.promotedId, null);
  assert.equal(plan.reindexed, false);
});

test("planSubscriptionSlotOrder: empty list stays empty", () => {
  const plan = planSubscriptionSlotOrder([]);
  assert.deepEqual(plan.ordered, []);
  assert.equal(plan.promotedId, null);
  assert.equal(plan.reindexed, false);
});

test("isReservedGiftStatus: only pending gift lifecycle states are reserved", () => {
  assert.equal(isReservedGiftStatus("GIFT_RESERVED"), true);
  assert.equal(isReservedGiftStatus("GIFT_CODE_ACTIVE"), true);
  for (const status of [null, undefined, "", "GIFTED", "ACTIVATED_SELF"]) {
    assert.equal(isReservedGiftStatus(status), false, String(status));
  }
});
