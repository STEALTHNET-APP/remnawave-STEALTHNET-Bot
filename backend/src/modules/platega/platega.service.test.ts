import assert from "node:assert/strict";
import test from "node:test";
import { buildPlategaTransactionBody, type PlategaTransactionParams } from "./platega-request.js";

const baseParams: PlategaTransactionParams = {
  amount: 430,
  currency: "rub",
  orderId: "order-123",
  paymentMethod: 11,
  returnUrl: "https://example.test/return",
  failedUrl: "https://example.test/failed",
  description: "Тариф #order-123",
};

test("Platega request puts payer email in top-level metadata and keeps order payload", () => {
  const body = JSON.parse(JSON.stringify(buildPlategaTransactionBody({
    ...baseParams,
    email: "  Case.Sensitive+tag@Example.test  ",
  }))) as Record<string, unknown>;

  assert.deepEqual(body, {
    paymentMethod: 11,
    paymentDetails: { amount: 430, currency: "RUB" },
    description: "Тариф #order-123",
    return: "https://example.test/return",
    failedUrl: "https://example.test/failed",
    payload: "order-123",
    metadata: { email: "Case.Sensitive+tag@Example.test" },
  });
});

test("Platega request omits email metadata when no valid payer email exists", () => {
  for (const email of [undefined, null, "", "  ", "not-an-email", "user@invalid"]) {
    const body = buildPlategaTransactionBody({ ...baseParams, email });
    assert.equal("metadata" in body, false, `email=${String(email)}`);
    assert.equal(body.payload, "order-123");
  }
});

test("Platega request preserves other metadata without mutating caller data", () => {
  const metadata = { intent: "renewal", nested: { subscription: "sub-123" } };
  const params = { ...baseParams, email: "payer@example.test", metadata };
  const body = buildPlategaTransactionBody(params);

  assert.deepEqual(body.metadata, {
    intent: "renewal",
    nested: { subscription: "sub-123" },
    email: "payer@example.test",
  });
  assert.deepEqual(metadata, { intent: "renewal", nested: { subscription: "sub-123" } });
  assert.equal("email" in metadata, false);
  assert.equal(params.email, "payer@example.test");
  assert.equal(body.payload, "order-123");
});
