import assert from "node:assert/strict";
import { test } from "node:test";
import { auroraProfileTab, formatAuroraBalance } from "../src/lib/aurora-profile.ts";

test("profile sheets can be opened from query or hash", () => {
  assert.equal(auroraProfileTab("?tab=account", ""), "account");
  assert.equal(auroraProfileTab("?other=1", "#security"), "security");
  assert.equal(auroraProfileTab("?tab=language", "#payments"), "language");
  assert.equal(auroraProfileTab("?tab=unknown", ""), null);
  assert.equal(auroraProfileTab("", ""), null);
});

test("balances preserve currency and fractional amounts", () => {
  assert.equal(formatAuroraBalance(123.45, "eur", "en"), "€123.45");
  assert.equal(formatAuroraBalance(1.25, "usd", "en"), "$1.25");
  assert.match(formatAuroraBalance(1.25, "rub", "ru"), /1,25.*₽/);
  assert.equal(formatAuroraBalance(0, "eur", "en"), "€0.00");
  assert.equal(formatAuroraBalance(1.25, "USDT", "en"), "1.25 USDT");
});
