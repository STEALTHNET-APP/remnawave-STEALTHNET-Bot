import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTopupAmount } from "./topup-amount.js";

test("custom topups accept the same minimum as the cabinet and preserve decimals", () => {
  for (const [input, expected] of [["1", 1], ["49", 49], ["1,25", 1.25], ["1 000,50", 1000.5]] as const) assert.equal(parseTopupAmount(input), expected);
  for (const input of ["0", "0.99", "-10", "1.2.3", "10 рублей", "Infinity", "1.001", ""]) assert.equal(parseTopupAmount(input), null);
});
