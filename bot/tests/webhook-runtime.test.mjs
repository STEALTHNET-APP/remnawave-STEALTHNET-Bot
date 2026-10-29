import assert from "node:assert/strict";
import { test } from "node:test";
import { Bot } from "grammy";
import { sequentialize } from "@grammyjs/runner";
import { createModeController, createBotServer, createUpdateProcessor, internalBotCredential } from "../dist/webhook-runtime.js";

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

function fixture() {
  let config = { enabled: false, url: "https://example.com/api/bot/webhook", secret: "test-secret" };
  const calls = [];
  let running = false;
  let fail = false;
  const controller = createModeController({
    config: async () => config,
    setWebhook: async (url, secret) => { calls.push(["set", url, secret]); if (fail) throw Error("Telegram unavailable"); },
    deleteWebhook: async () => { calls.push(["delete"]); if (fail) throw Error("Telegram unavailable"); },
    startPolling: () => { calls.push(["start"]); running = true; return { isRunning: () => running, stop: async () => { calls.push(["stop"]); running = false; } }; },
  });
  return { controller, calls, change: values => { config = { ...config, ...values }; }, fail: value => { fail = value; }, crash: () => { running = false; } };
}

test("polling/webhook transitions stop polling first, rotate secrets and retain unchanged mode", async () => {
  const f = fixture();
  assert.equal(await f.controller.reload(), "polling");
  f.change({ enabled: true });
  assert.equal(await f.controller.reload(), "webhook");
  assert.deepEqual(f.calls.map(c => c[0]), ["delete", "start", "stop", "set"]);
  await f.controller.reload();
  assert.equal(f.calls.length, 4);
  f.change({ secret: "rotated" });
  await f.controller.reload();
  assert.equal(f.calls.at(-1)[2], "rotated");
  f.change({ enabled: false });
  assert.equal(await f.controller.reload(), "polling");
  assert.deepEqual(f.calls.slice(-2).map(c => c[0]), ["delete", "start"]);
});

test("failed Telegram transition is not reported as active and can be retried", async () => {
  const f = fixture();
  await f.controller.reload();
  f.change({ enabled: true }); f.fail(true);
  await assert.rejects(f.controller.reload());
  assert.equal(f.controller.mode(), "unavailable");
  f.fail(false);
  assert.equal(await f.controller.reload(), "webhook");
  f.change({ enabled: false }); f.fail(true);
  await assert.rejects(f.controller.reload());
  assert.equal(f.controller.mode(), "unavailable");
  assert.equal(f.calls.filter(c => c[0] === "start").length, 1);
});

test("concurrent reloads share work and a stopped poller recovers", async () => {
  const f = fixture();
  await Promise.all([f.controller.reload(), f.controller.reload()]);
  assert.equal(f.calls.length, 2);
  f.crash();
  assert.equal(f.controller.mode(), "unavailable");
  await f.controller.reload();
  assert.equal(f.controller.mode(), "polling");
});

test("webhook cannot be enabled without a secret", async () => {
  const f = fixture();
  f.change({ enabled: true, secret: null });
  await assert.rejects(f.controller.reload());
  assert.equal(f.calls.length, 0);
});

test("duplicates share processing, successful delivery is retained, errors remain retryable", async () => {
  const wait = deferred(); let calls = 0;
  const process = createUpdateProcessor(async () => { calls++; await wait.promise; });
  const first = process({ update_id: 1 });
  const second = process({ update_id: 1 });
  await Promise.resolve();
  assert.equal(calls, 1);
  wait.resolve();
  await Promise.all([first, second]);
  await process({ update_id: 1 });
  assert.equal(calls, 1);
  let attempts = 0;
  const retry = createUpdateProcessor(async () => { if (++attempts === 1) throw Error("temporary"); });
  await assert.rejects(retry({ update_id: 2 }));
  await retry({ update_id: 2 });
  assert.equal(attempts, 2);
});

test("internal HTTP endpoints require credentials, report failures and reject malformed updates", async () => {
  let mode = "webhook"; let fail = false; let calls = 0;
  const credential = internalBotCredential("fixture:token");
  const server = createBotServer({ credential, mode: () => mode, reload: async () => { if (fail) throw Error(); return mode; }, process: createUpdateProcessor(async () => { calls++; if (fail) throw Error(); }) });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, payload, auth = credential) => fetch(base + path, { method: "POST", headers: { "X-Bot-Internal-Auth": auth }, body: JSON.stringify(payload) });
  try {
    for (const path of ["/webhook", "/internal/reload"]) assert.equal((await request(path, {}, "wrong")).status, 401);
    assert.equal((await request("/webhook", {})).status, 400);
    assert.equal((await request("/webhook", { update_id: 3 })).status, 200);
    assert.equal((await request("/webhook", { update_id: 3 })).status, 200);
    assert.equal(calls, 1);
    fail = true;
    assert.equal((await request("/webhook", { update_id: 4 })).status, 503);
    assert.equal((await request("/internal/reload", {})).status, 503);
    fail = false; mode = "polling";
    assert.equal((await request("/webhook", { update_id: 5 })).status, 503);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("real grammY middleware serializes one user including pre-checkout while other users proceed", async () => {
  const bot = new Bot("123:fixture", { botInfo: { id: 123, is_bot: true, first_name: "Test", username: "test_bot", can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false } });
  bot.use(sequentialize(ctx => [ctx.from?.id ? `user:${ctx.from.id}` : undefined, ctx.chat?.id ? `chat:${ctx.chat.id}` : undefined].filter(Boolean)));
  const wait = deferred(); const started = [];
  bot.use(async ctx => { started.push(ctx.update.update_id); if (ctx.update.update_id === 10) await wait.promise; });
  const user = id => ({ id, is_bot: false, first_name: "Test" });
  const msg = (update_id, id) => ({ update_id, message: { message_id: update_id, date: 0, chat: { id, type: "private" }, from: user(id), text: "hello" } });
  const first = bot.handleUpdate(msg(10, 1));
  const second = bot.handleUpdate({ update_id: 11, pre_checkout_query: { id: "q", from: user(1), currency: "XTR", total_amount: 1, invoice_payload: "test" } });
  const third = bot.handleUpdate(msg(12, 2));
  await third;
  assert.deepEqual(started, [10, 12]);
  wait.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(started, [10, 12, 11]);
});
