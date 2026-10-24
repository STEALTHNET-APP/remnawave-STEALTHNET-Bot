import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { computeYooMoneySha1, verifyYooMoneyHmacSign } from "./yoomoney.signature.js";

const notification = {
  notification_type: "p2p-incoming", operation_id: "441361714955017004", amount: "98.00",
  withdraw_amount: "100.00", currency: "643", datetime: "2013-12-26T08:28:34Z",
  sender: "41000000000", codepro: "false", label: "ML23045", unaccepted: "false",
  sha1_hash: "ac13833bd6ba9eff1fa9e4bed76f3d6ebb57f6c0",
};
const canonical = "amount=98.00&codepro=false&currency=643&datetime=2013-12-26T08%3A28%3A34Z&label=ML23045&notification_type=p2p-incoming&operation_id=441361714955017004&sender=41000000000&sha1_hash=ac13833bd6ba9eff1fa9e4bed76f3d6ebb57f6c0&unaccepted=false&withdraw_amount=100.00";
const sign = createHmac("sha256", "secret123").update(canonical).digest("hex");

test("YooMoney documented canonical payload and all signed fields", () => {
  assert.equal(verifyYooMoneyHmacSign({ ...notification, sign }, "secret123"), true);
  assert.equal(verifyYooMoneyHmacSign({ ...notification, sign: sign.toUpperCase() }, "secret123"), true);
  for (const key of Object.keys(notification)) {
    assert.equal(verifyYooMoneyHmacSign({ ...notification, [key]: "modified", sign }, "secret123"), false, key);
  }
  assert.equal(verifyYooMoneyHmacSign({ ...notification, sign }, "wrong-secret"), false);
});

test("RFC3986 reserved characters, Unicode, whitespace and empty values remain signed", () => {
  const body = { label: " !'()* Привет +& ", sender: "" };
  const encoded = "label=%20%21%27%28%29%2A%20%D0%9F%D1%80%D0%B8%D0%B2%D0%B5%D1%82%20%2B%26%20&sender=";
  const signature = createHmac("sha256", "secret").update(encoded).digest("hex");
  assert.equal(verifyYooMoneyHmacSign({ ...body, sign: signature }, "secret"), true);
  assert.equal(verifyYooMoneyHmacSign({ ...body, label: body.label.trim(), sign: signature }, "secret"), false);
});

test("ambiguous and malformed form parameters are rejected", () => {
  for (const patch of [{ sign: [] }, { sign: "ab" }, { sign: "z".repeat(64) }, { amount: ["98.00", "0"] }, { amount: { value: "98.00" } }, { amount: 98 }]) {
    assert.equal(verifyYooMoneyHmacSign({ ...notification, sign, ...patch }, "secret123"), false);
  }
  assert.equal(verifyYooMoneyHmacSign(notification, "secret123"), false);
});

test("legacy SHA1 uses documented parameter ordering", () => {
  assert.equal(computeYooMoneySha1("p2p-incoming", "441361714955017004", "98.00", "643", "2013-12-26T08:28:34Z", "41000000000", "false", "secret123", "ML23045").length, 40);
});
