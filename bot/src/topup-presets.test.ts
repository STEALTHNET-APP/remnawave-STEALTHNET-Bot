import assert from "node:assert/strict";
import { test } from "node:test";
import { topUpPresets } from "./keyboard.js";

test("ruble preset displays and submits 150 while custom amounts remain available", () => {
  const rows = topUpPresets("rub").inline_keyboard;
  assert.equal(rows[0][0].text, "₽ 150");
  assert.equal((rows[0][0] as { callback_data: string }).callback_data, "topup:150");
  assert.ok(rows.flat().some(button => "callback_data" in button && button.callback_data === "topup:custom"));
  assert.equal((topUpPresets("USD").inline_keyboard[0][0] as { callback_data: string }).callback_data, "topup:100");
});
