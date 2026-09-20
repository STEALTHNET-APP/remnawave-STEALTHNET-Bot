import assert from "node:assert/strict";
import test from "node:test";

import { buildPaymentIntentMetadata, parsePaymentIntentMetadata } from "./payment-intent.js";

test("renewal target wins over the new-subscription flag", () => {
  assert.deepEqual(
    buildPaymentIntentMetadata({
      asAdditional: true,
      asGift: false,
      extendsSecondarySubId: "sub-current",
      removeExtrasOnActivate: true,
      replaceTrialSubId: "trial-old",
    }),
    {
      extendsSecondarySubId: "sub-current",
      removeExtrasOnActivate: true,
      replaceTrialSubId: "trial-old",
    },
  );
});

test("explicit new purchase persists the additional-subscription marker", () => {
  assert.deepEqual(
    buildPaymentIntentMetadata({
      asAdditional: true,
      asGift: false,
    }),
    { isAdditionalSubscription: true },
  );
});

test("gift intent is preserved without inventing renewal metadata", () => {
  assert.deepEqual(
    buildPaymentIntentMetadata({
      asAdditional: true,
      asGift: true,
    }),
    { isAdditionalSubscription: true, purchasedAsGift: true },
  );
});

test("conflicting renewal and new-subscription markers are rejected", () => {
  assert.throws(
    () => parsePaymentIntentMetadata(JSON.stringify({
      extendsSecondarySubId: "sub-current",
      isAdditionalSubscription: true,
    })),
    /PAYMENT_INTENT_CONFLICT/,
  );
});

test("renewal metadata is parsed into an explicit target", () => {
  assert.deepEqual(
    parsePaymentIntentMetadata({ extendsSecondarySubId: "sub-current" }),
    { renewalTargetId: "sub-current", isAdditionalSubscription: false },
  );
});
