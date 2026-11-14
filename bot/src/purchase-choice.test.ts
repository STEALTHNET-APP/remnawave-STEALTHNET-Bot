import assert from "node:assert/strict";
import test from "node:test";

import { shouldShowPurchaseChoice, purchaseChoiceText } from "./purchase-choice.js";

const subscriptions = [
  { tariffId: "tariff-standard" },
  { tariffId: "tariff-other" },
];

test("shows renew-or-new choice before a multi-period tariff already owned by the client", () => {
  assert.equal(
    shouldShowPurchaseChoice({
      tariffId: "tariff-standard",
      subscriptions,
      isBypass: false,
      isSingleCategory: false,
      multiSubscriptionsEnabled: true,
    }),
    true,
  );
});

test("does not reopen the choice after the client explicitly selected a purchase mode", () => {
  assert.equal(
    shouldShowPurchaseChoice({
      tariffId: "tariff-standard",
      subscriptions,
      isBypass: true,
      isSingleCategory: false,
      multiSubscriptionsEnabled: true,
    }),
    false,
  );
});

test("does not offer renewal when the client has no subscription with the tariff", () => {
  assert.equal(
    shouldShowPurchaseChoice({
      tariffId: "tariff-missing",
      subscriptions,
      isBypass: false,
      isSingleCategory: false,
      multiSubscriptionsEnabled: true,
    }),
    false,
  );
});

test("purchase warning explains separate billing and identifies active and expired subscriptions", () => {
  const text = purchaseChoiceText([{tariffDisplayName:"Active",subscription:{response:{expireAt:"2026-12-31T12:00:00Z"}}},{tariffDisplayName:"Old",subscription:{expireAt:"2026-01-01T12:00:00Z"}}], Date.parse("2026-11-15T12:00:00Z"));
  assert.ok(text.includes("Active — до 31.12.2026"));
  assert.ok(text.includes("Old — истекла 01.01.2026"));
  assert.ok(text.includes("оплачиваться отдельно"));
});
