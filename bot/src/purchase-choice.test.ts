import assert from "node:assert/strict";
import test from "node:test";

import { shouldShowPurchaseChoice } from "./purchase-choice.js";

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
