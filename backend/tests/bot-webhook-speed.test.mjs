import assert from "node:assert/strict";
import { test } from "node:test";
import { forwardBotUpdate, internalBotCredential, matchesSecret, validTelegramUpdate } from "../dist/modules/bot-webhook/bot-webhook.transport.js";

test("webhook auth rejects missing, empty and mismatched secrets", () => {
  assert.equal(matchesSecret("", undefined), false);
  assert.equal(matchesSecret("secret", undefined), false);
  assert.equal(matchesSecret("secret", ["secret"]), false);
  assert.equal(matchesSecret("secret", "wrong"), false);
  assert.equal(matchesSecret("secret", "secret"), true);
  assert.equal(internalBotCredential(""), "");
  assert.notEqual(internalBotCredential("first"), internalBotCredential("second"));
});

test("update IDs must be nonnegative safe integers", () => {
  for (const value of [null, {}, { update_id: -1 }, { update_id: "1" }, { update_id: 1.2 }]) assert.equal(validTelegramUpdate(value), false);
  assert.equal(validTelegramUpdate({ update_id: 123 }), true);
});

test("forwarding preserves failure status and sends internal authentication", async () => {
  let calls = 0;
  for (const status of [200, 500, 503]) {
    const ok = await forwardBotUpdate({ update_id: 42 }, "credential", async (url, options) => {
      calls++;
      assert.ok(url.endsWith("/webhook"));
      assert.equal(options.headers["X-Bot-Internal-Auth"], "credential");
      assert.equal(JSON.parse(options.body).update_id, 42);
      assert.ok(options.signal instanceof AbortSignal);
      return new Response('{"error":"test"}', { status });
    });
    assert.equal(ok, status === 200);
  }
  assert.equal(calls, 3);
  await assert.rejects(forwardBotUpdate({}, "credential", async () => { calls++; throw Error("connection lost"); }));
  assert.equal(calls, 4);
});
