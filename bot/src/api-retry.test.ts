import test from "node:test";
import assert from "node:assert/strict";
import { requestWithRetry } from "./api.js";

test("a timed out purchase is never repeated automatically", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new DOMException("timeout", "TimeoutError"); };
  try {
    await assert.rejects(requestWithRetry("https://api.invalid/purchase", { method: "POST", retries: 3 }));
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test("read requests recover from a transient gateway error", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => new Response("", { status: ++calls === 1 ? 503 : 200 });
  try {
    assert.equal((await requestWithRetry("https://api.invalid/subscriptions")).status, 200);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});

test("a gateway error after a mutation is returned without resubmitting", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response("", { status: 502 }); };
  try {
    assert.equal((await requestWithRetry("https://api.invalid/refund", { method: "POST" })).status, 502);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});
