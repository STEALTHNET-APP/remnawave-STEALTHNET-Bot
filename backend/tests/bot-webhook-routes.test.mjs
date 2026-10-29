import assert from "node:assert/strict";
import { test, mock } from "node:test";
import express from "express";
import { internalBotCredential } from "../dist/modules/bot-webhook/bot-webhook.transport.js";

process.env.BOT_TOKEN = "123:local-fixture";
let config = { botWebhookEnabled: true, botWebhookUrl: "https://example.com/api/bot/webhook", botWebhookSecret: "secret", telegramBotToken: process.env.BOT_TOKEN };
let writes = 0;
const nativeFetch = globalThis.fetch;
let upstreamStatus = 200;
let runtimeMode = "webhook";
mock.module("../dist/db.js", { namedExports: { prisma: {
  admin: { findUnique: async ({ where }) => ({ id: where.id, role: where.id === "admin" ? "ADMIN" : "MANAGER", email: "test@example.invalid", allowedSections: where.id === "manager-settings" ? '["settings"]' : '["clients"]' }) },
  systemSetting: { upsert: async ({ where, update }) => {
    writes++;
    if (where.key === "bot_webhook_enabled") config.botWebhookEnabled = update.value === "true";
    if (where.key === "bot_webhook_url") config.botWebhookUrl = update.value;
    if (where.key === "bot_webhook_secret") config.botWebhookSecret = update.value;
  } },
  $transaction: promises => Promise.all(promises),
} } });
mock.module("../dist/modules/client/client.service.js", { namedExports: { getSystemConfig: async () => config, invalidateSystemConfigCache() {} } });
mock.module("../dist/config/index.js", { namedExports: { env: { JWT_SECRET: "fixture" } } });
mock.module("../dist/modules/auth/auth.service.js", { namedExports: { verifyToken: token => token ? { type: "access", adminId: token } : null } });
const { botWebhookRouter, botWebhookAdminRouter } = await import("../dist/modules/bot-webhook/bot-webhook.routes.js");
const app = express();
app.use(express.json());
app.use("/api/bot", botWebhookRouter);
app.use("/api/admin/bot/webhook", botWebhookAdminRouter);
const server = app.listen(0, "127.0.0.1");
await new Promise(resolve => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
globalThis.fetch = async (url, options) => {
  if (String(url).startsWith(base)) return nativeFetch(url, options);
  if (String(url).includes("getWebhookInfo")) return new Response(JSON.stringify({ ok: true, result: { url: config.botWebhookUrl, pending_update_count: 0 } }));
  assert.equal(options.headers["X-Bot-Internal-Auth"], internalBotCredential(process.env.BOT_TOKEN));
  return new Response(JSON.stringify({ ok: upstreamStatus === 200, mode: runtimeMode }), { status: upstreamStatus });
};
const post = (path, body, headers = {}) => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

try {
  await test("public webhook rejects unconfigured or forged deliveries and propagates upstream failure", async () => {
    assert.equal((await post("/api/bot/webhook", { update_id: 1 })).status, 401);
    const headers = { "X-Telegram-Bot-Api-Secret-Token": "secret" };
    assert.equal((await post("/api/bot/webhook", {}, headers)).status, 400);
    assert.equal((await post("/api/bot/webhook", { update_id: 1 }, headers)).status, 200);
    upstreamStatus = 503;
    assert.equal((await post("/api/bot/webhook", { update_id: 2 }, headers)).status, 503);
    upstreamStatus = 200;
    config.botWebhookEnabled = false;
    assert.equal((await post("/api/bot/webhook", { update_id: 2 }, headers)).status, 503);
    config.botWebhookEnabled = true; config.botWebhookSecret = "";
    assert.equal((await post("/api/bot/webhook", { update_id: 3 }, headers)).status, 401);
  });
  await test("private runtime config requires separate service authentication", async () => {
    assert.equal((await fetch(base + "/api/bot/runtime")).status, 401);
    const response = await fetch(base + "/api/bot/runtime", { headers: { "X-Bot-Internal-Auth": internalBotCredential(process.env.BOT_TOKEN) } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
  });
  await test("admin webhook controls enforce settings permissions", async () => {
    const body = { url: "https://example.com/api/bot/webhook" };
    assert.equal((await post("/api/admin/bot/webhook/set", body)).status, 401);
    assert.equal((await post("/api/admin/bot/webhook/set", body, { Authorization: "Bearer manager-clients" })).status, 403);
    assert.equal(writes, 0);
    assert.equal((await post("/api/admin/bot/webhook/set", body, { Authorization: "Bearer manager-settings" })).status, 200);
    assert.match(config.botWebhookSecret, /^[a-f0-9]{64}$/);
  });
  await test("invalid URL, disabled secret and token mismatch cannot reconfigure webhook", async () => {
    const headers = { Authorization: "Bearer admin" };
    const before = writes;
    for (const body of [{ url: "http://example.com/api/bot/webhook" }, { url: "https://example.com/wrong" }, { url: "https://example.com/api/bot/webhook", clearSecret: true }, { url: "https://example.com/api/bot/webhook", secretToken: "" }]) {
      assert.equal((await post("/api/admin/bot/webhook/set", body, headers)).status, 400);
    }
    config.telegramBotToken = "different";
    assert.equal((await post("/api/admin/bot/webhook/set", { url: "https://example.com/api/bot/webhook" }, headers)).status, 409);
    assert.equal(writes, before);
    config.telegramBotToken = process.env.BOT_TOKEN;
  });
  await test("unsuccessful mode change is reported as failure, saved secret retained on retry", async () => {
    const headers = { Authorization: "Bearer admin" };
    const secret = config.botWebhookSecret;
    upstreamStatus = 503;
    assert.equal((await post("/api/admin/bot/webhook/set", { url: "https://example.com/api/bot/webhook" }, headers)).status, 503);
    assert.equal(config.botWebhookSecret, secret);
    upstreamStatus = 200; runtimeMode = "polling";
    assert.equal((await post("/api/admin/bot/webhook/delete", {}, headers)).status, 200);
    assert.equal(config.botWebhookEnabled, false);
    const response = await fetch(base + "/api/admin/bot/webhook/status", { headers });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).hasSecret, true);
  });
} finally {
  globalThis.fetch = nativeFetch;
  await new Promise(resolve => server.close(resolve));
}
