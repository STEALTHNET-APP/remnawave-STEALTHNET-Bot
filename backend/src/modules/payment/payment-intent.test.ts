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

test("renewal target must keep its tariff unless it is a trial or has no tariff", async () => {
  const { isRenewalTargetTariffAllowed } = await import("./payment-intent.js");
  assert.equal(isRenewalTargetTariffAllowed({ tariffId: "t1", trialId: null }, "t1"), true);
  assert.equal(isRenewalTargetTariffAllowed({ tariffId: "t1", trialId: null }, "t2"), false);
  // trial conversion to another tariff is validated later by the trial convert rules
  assert.equal(isRenewalTargetTariffAllowed({ tariffId: "trial-tariff", trialId: "trial-1" }, "t2"), true);
  // legacy trial / manually granted subscription without tariff
  assert.equal(isRenewalTargetTariffAllowed({ tariffId: null, trialId: null }, "t2"), true);
});
