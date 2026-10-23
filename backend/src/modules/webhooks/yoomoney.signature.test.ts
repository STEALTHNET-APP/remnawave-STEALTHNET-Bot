import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import {
  pickFirst,
  verifyYooMoneyHmacSign,
  computeYooMoneySha1,
} from "./yoomoney.signature.js";

const TEST_SECRET = "super-secret-notification-key-123";

test("pickFirst returns trimmed string or first element from array", () => {
  assert.equal(pickFirst(null), "");
  assert.equal(pickFirst(undefined), "");
  assert.equal(pickFirst("  hello world  "), "hello world");
  assert.equal(pickFirst(["first", "second"]), "first");
  assert.equal(pickFirst(123), "123");
});

test("verifyYooMoneyHmacSign validates HMAC-SHA256 sign parameter correctly", () => {
  const body: Record<string, unknown> = {
    notification_type: "p2p-incoming",
    operation_id: "test-op-1001",
    amount: "150.00",
    currency: "643",
    datetime: "2026-10-24T00:00:00Z",
    sender: "41001000000000",
    codepro: "false",
    label: "payment-uuid-1",
    unaccepted: "false",
  };

  const sortedKeys = Object.keys(body).sort();
  const dataString = sortedKeys
    .map((k) => `${k}=${encodeURIComponent(String(body[k]))}`)
    .join("&");
  const expectedSign = createHmac("sha256", TEST_SECRET)
    .update(dataString, "utf8")
    .digest("hex");

  const payloadWithSign = { ...body, sign: expectedSign };

  assert.equal(verifyYooMoneyHmacSign(payloadWithSign, TEST_SECRET), true);
  // Case-insensitive hex verification
  assert.equal(verifyYooMoneyHmacSign({ ...body, sign: expectedSign.toUpperCase() }, TEST_SECRET), true);
  // Rejects wrong secret
  assert.equal(verifyYooMoneyHmacSign(payloadWithSign, "wrong-secret"), false);
  // Rejects tampered parameter
  assert.equal(verifyYooMoneyHmacSign({ ...payloadWithSign, amount: "999.00" }, TEST_SECRET), false);
  // Rejects missing sign
  assert.equal(verifyYooMoneyHmacSign(body, TEST_SECRET), false);
});

test("verifyYooMoneyHmacSign handles array values and ignores Sign key casing", () => {
  const body: Record<string, unknown> = {
    notification_type: ["p2p-incoming"],
    operation_id: "op-2002",
    amount: "250.50",
    currency: "643",
    datetime: "2026-10-24T01:00:00Z",
    sender: "41001999999999",
    codepro: "false",
    label: "payment-uuid-2",
  };

  const sortedKeys = Object.keys(body).sort();
  const dataString = sortedKeys
    .map((k) => {
      const val = Array.isArray(body[k]) ? body[k][0] : body[k];
      return `${k}=${encodeURIComponent(String(val))}`;
    })
    .join("&");
  const sign = createHmac("sha256", TEST_SECRET)
    .update(dataString, "utf8")
    .digest("hex");

  // Sign provided with lowercase key
  assert.equal(verifyYooMoneyHmacSign({ ...body, sign }, TEST_SECRET), true);
  // Sign provided with uppercase key
  assert.equal(verifyYooMoneyHmacSign({ ...body, Sign: sign }, TEST_SECRET), true);
});

test("verifyYooMoneyHmacSign correctly handles Cyrillic and spaces in parameters", () => {
  const body: Record<string, unknown> = {
    notification_type: "p2p-incoming",
    operation_id: "op-cyrillic-1",
    amount: "500.00",
    currency: "643",
    datetime: "2026-10-24T02:00:00Z",
    sender: "41001000000000",
    codepro: "false",
    label: "оплата заказа №45",
  };

  const sortedKeys = Object.keys(body).sort();
  const dataString = sortedKeys
    .map((k) => `${k}=${encodeURIComponent(String(body[k]))}`)
    .join("&");
  const sign = createHmac("sha256", TEST_SECRET)
    .update(dataString, "utf8")
    .digest("hex");

  assert.equal(verifyYooMoneyHmacSign({ ...body, sign }, TEST_SECRET), true);
});

test("computeYooMoneySha1 computes legacy SHA-1 hash matching YooMoney spec", () => {
  const hash = computeYooMoneySha1(
    "p2p-incoming",
    "12345678",
    "300.00",
    "643",
    "2026-10-24T00:00:00Z",
    "41001000000000",
    "false",
    TEST_SECRET,
    "payment-uuid-3"
  );

  assert.equal(typeof hash, "string");
  assert.equal(hash.length, 40); // 40 hex chars for SHA-1

  // Tampering changes hash
  const tamperedHash = computeYooMoneySha1(
    "p2p-incoming",
    "12345678",
    "300.01", // changed
    "643",
    "2026-10-24T00:00:00Z",
    "41001000000000",
    "false",
    TEST_SECRET,
    "payment-uuid-3"
  );
  assert.notEqual(hash, tamperedHash);
});

test("dual-verification flow validates either HMAC-SHA256 or legacy SHA-1", () => {
  const secret = "shared-secret";
  const basePayload: Record<string, unknown> = {
    notification_type: "card-incoming",
    operation_id: "op-dual-99",
    amount: "100.00",
    currency: "643",
    datetime: "2026-10-24T03:00:00Z",
    sender: "",
    codepro: "false",
    label: "uuid-dual-99",
  };

  function computeHmacForPayload(payload: Record<string, unknown>, s: string): string {
    const params: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(payload)) {
      if (k.toLowerCase() === "sign") continue;
      params[k] = v;
    }
    const sortedKeys = Object.keys(params).sort();
    const dataString = sortedKeys
      .map((k) => `${k}=${encodeURIComponent(String(params[k]))}`)
      .join("&");
    return createHmac("sha256", s).update(dataString, "utf8").digest("hex");
  }

  const validSha1 = computeYooMoneySha1(
    String(basePayload.notification_type),
    String(basePayload.operation_id),
    String(basePayload.amount),
    String(basePayload.currency),
    String(basePayload.datetime),
    String(basePayload.sender),
    String(basePayload.codepro),
    secret,
    String(basePayload.label)
  );

  function verifyDual(body: Record<string, unknown>, s: string): { ok: boolean; method?: string } {
    let receivedSign = pickFirst(body.sign);
    if (!receivedSign) {
      for (const [k, v] of Object.entries(body)) {
        if (k.toLowerCase() === "sign") {
          receivedSign = pickFirst(v);
          break;
        }
      }
    }
    const sha1Hash = pickFirst(body.sha1_hash);

    if (receivedSign && verifyYooMoneyHmacSign(body, s)) {
      return { ok: true, method: "HMAC-SHA256" };
    }
    if (sha1Hash) {
      const computed = computeYooMoneySha1(
        pickFirst(body.notification_type),
        pickFirst(body.operation_id),
        pickFirst(body.amount),
        pickFirst(body.currency),
        pickFirst(body.datetime),
        pickFirst(body.sender),
        pickFirst(body.codepro),
        s,
        pickFirst(body.label)
      );
      if (computed.toLowerCase() === sha1Hash.toLowerCase()) {
        return { ok: true, method: "SHA-1" };
      }
    }
    return { ok: false };
  }

  // Case A: Only new sign present
  const signOnly = computeHmacForPayload(basePayload, secret);
  assert.deepEqual(verifyDual({ ...basePayload, sign: signOnly }, secret), { ok: true, method: "HMAC-SHA256" });

  // Case B: Only legacy sha1_hash present
  assert.deepEqual(verifyDual({ ...basePayload, sha1_hash: validSha1 }, secret), { ok: true, method: "SHA-1" });

  // Case C: Both present and valid
  const bothValidPayload = { ...basePayload, sha1_hash: validSha1 };
  const signForBoth = computeHmacForPayload(bothValidPayload, secret);
  assert.deepEqual(verifyDual({ ...bothValidPayload, sign: signForBoth }, secret), { ok: true, method: "HMAC-SHA256" });

  // Case D: Both present, sign invalid but sha1_hash valid (fallback to SHA-1)
  assert.deepEqual(verifyDual({ ...basePayload, sign: "invalid-sign", sha1_hash: validSha1 }, secret), { ok: true, method: "SHA-1" });

  // Case E: Both present, both invalid
  assert.deepEqual(verifyDual({ ...basePayload, sign: "invalid-sign", sha1_hash: "invalid-sha1" }, secret), { ok: false });

  // Case F: Neither present
  assert.deepEqual(verifyDual({ ...basePayload }, secret), { ok: false });
});
