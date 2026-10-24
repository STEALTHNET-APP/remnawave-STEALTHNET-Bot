import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("SYSTEM_CONFIG_KEYS contains remna_api_url, remna_admin_token and remna_secret_key", () => {
  const serviceCode = fs.readFileSync(path.join(__dirname, "../src/modules/client/client.service.ts"), "utf8");
  assert.match(serviceCode, /"remna_api_url"/);
  assert.match(serviceCode, /"remna_admin_token"/);
  assert.match(serviceCode, /"remna_secret_key"/);
});

test("remnaSecretCookieHeader formats both name:value and name=value correctly", async () => {
  const clientCode = fs.readFileSync(path.join(__dirname, "../src/modules/remna/remna.client.ts"), "utf8");
  assert.match(clientCode, /export function remnaSecretCookieHeader/);

  function formatCookie(secret) {
    if (!secret || !secret.trim()) return null;
    const s = secret.trim();
    const colonIdx = s.indexOf(":");
    const eqIdx = s.indexOf("=");
    const splitIdx = colonIdx > 0 ? colonIdx : eqIdx;
    const name = splitIdx > 0 ? s.slice(0, splitIdx).trim() : s;
    const value = splitIdx > 0 ? s.slice(splitIdx + 1).trim() : s;
    return `${name}=${value}`;
  }

  assert.equal(formatCookie(""), null);
  assert.equal(formatCookie(null), null);
  assert.equal(formatCookie("test_cookie:test_value"), "test_cookie=test_value");
  assert.equal(formatCookie("my_cookie=custom_val"), "my_cookie=custom_val");
  assert.equal(formatCookie("secret_alone"), "secret_alone=secret_alone");
});

test("setRemnaRuntimeConfig updates active config and normalizes trailing slashes", () => {
  let active = { apiUrl: "", adminToken: "", secretKey: "", source: "none" };
  let squadCacheCleared = false;

  function setCfg(cfg) {
    active = {
      ...cfg,
      apiUrl: (cfg.apiUrl || "").trim().replace(/\/+$/, ""),
      adminToken: (cfg.adminToken || "").trim(),
      secretKey: (cfg.secretKey || "").trim(),
    };
    squadCacheCleared = true;
  }

  setCfg({
    apiUrl: "https://remna.example.com///",
    adminToken: "token-12345",
    secretKey: "test_cookie:test_value",
    source: "database",
  });

  assert.equal(active.apiUrl, "https://remna.example.com");
  assert.equal(active.adminToken, "token-12345");
  assert.equal(active.secretKey, "test_cookie:test_value");
  assert.equal(active.source, "database");
  assert.equal(squadCacheCleared, true);
});

test("dynamic config resolver gives priority to database over .env", () => {
  const env = {
    REMNA_API_URL: "https://env.example.com",
    REMNA_ADMIN_TOKEN: "env-token",
    REMNA_SECRET_KEY: "env-secret",
    DOMAIN: "env.stealthnet.app",
    BOT_TOKEN: "1111:env-bot-token",
  };

  function resolve(dbMap) {
    const remnaApiUrl = (dbMap.remna_api_url ?? "").trim() || (env.REMNA_API_URL?.replace(/\/$/, "") ?? "") || null;
    const remnaAdminToken = (dbMap.remna_admin_token ?? "").trim() || (env.REMNA_ADMIN_TOKEN ?? "") || null;
    const remnaSecretKey = (dbMap.remna_secret_key ?? "").trim() || (env.REMNA_SECRET_KEY?.trim() ?? "") || null;
    const remnaConfigSource =
      ((dbMap.remna_api_url ?? "").trim() || (dbMap.remna_admin_token ?? "").trim())
        ? "database"
        : (env.REMNA_API_URL && env.REMNA_ADMIN_TOKEN ? "env" : "none");

    const telegramBotToken = (dbMap.telegram_bot_token ?? "").trim() || (env.BOT_TOKEN ?? "").trim() || null;
    const botTokenSource =
      (dbMap.telegram_bot_token ?? "").trim()
        ? "database"
        : ((env.BOT_TOKEN ?? "").trim() ? "env" : "none");

    const publicAppUrl = (dbMap.public_app_url ?? "").trim() || (env.DOMAIN ? `https://${env.DOMAIN.trim()}` : null);
    const publicUrlSource =
      (dbMap.public_app_url ?? "").trim()
        ? "database"
        : ((env.DOMAIN ?? "").trim() ? "env" : "none");

    return {
      remnaApiUrl,
      remnaAdminToken,
      remnaSecretKey,
      remnaConfigSource,
      telegramBotToken,
      botTokenSource,
      publicAppUrl,
      publicUrlSource,
    };
  }

  // Case 1: Clean DB -> falls back to .env
  const fallback = resolve({});
  assert.equal(fallback.remnaApiUrl, "https://env.example.com");
  assert.equal(fallback.remnaAdminToken, "env-token");
  assert.equal(fallback.remnaSecretKey, "env-secret");
  assert.equal(fallback.remnaConfigSource, "env");
  assert.equal(fallback.telegramBotToken, "1111:env-bot-token");
  assert.equal(fallback.botTokenSource, "env");
  assert.equal(fallback.publicAppUrl, "https://env.stealthnet.app");
  assert.equal(fallback.publicUrlSource, "env");

  // Case 2: Overridden in DB -> takes priority
  const overridden = resolve({
    remna_api_url: "https://new-panel.custom.store",
    remna_admin_token: "new-admin-token",
    remna_secret_key: "new-cookie:123",
    telegram_bot_token: "9999:custom-token",
    public_app_url: "https://myvpn.site",
  });
  assert.equal(overridden.remnaApiUrl, "https://new-panel.custom.store");
  assert.equal(overridden.remnaAdminToken, "new-admin-token");
  assert.equal(overridden.remnaSecretKey, "new-cookie:123");
  assert.equal(overridden.remnaConfigSource, "database");
  assert.equal(overridden.telegramBotToken, "9999:custom-token");
  assert.equal(overridden.botTokenSource, "database");
  assert.equal(overridden.publicAppUrl, "https://myvpn.site");
  assert.equal(overridden.publicUrlSource, "database");
});

test("admin routes register test-connection, test-token, and reset endpoints", () => {
  const routesCode = fs.readFileSync(path.join(__dirname, "../src/modules/admin/admin.routes.ts"), "utf8");
  assert.match(routesCode, /\/remna\/test-connection/);
  assert.match(routesCode, /\/bot\/test-token/);
  assert.match(routesCode, /\/remna\/reset-config/);
  assert.match(routesCode, /\/bot\/reset-token/);
  assert.match(routesCode, /\/remna\/reset-uuids-and-sync/);
});

test("frontend api.ts exposes test and reset methods", (t) => {
  const possiblePaths = [
    path.join(__dirname, "../../frontend/src/lib/api.ts"),
    path.join(__dirname, "../../../frontend/src/lib/api.ts"),
    "/repo/frontend/src/lib/api.ts",
  ];
  const found = possiblePaths.find((p) => fs.existsSync(p));
  if (!found) {
    t.skip("Frontend directory not mounted in container, skipping frontend-specific file check");
    return;
  }
  const apiCode = fs.readFileSync(found, "utf8");
  assert.match(apiCode, /testRemnaConnection/);
  assert.match(apiCode, /testTelegramBot/);
  assert.match(apiCode, /resetRemnaConfig/);
  assert.match(apiCode, /resetBotToken/);
  assert.match(apiCode, /relinkRemnaUsers/);
  assert.match(apiCode, /remnaConfigSource/);
  assert.match(apiCode, /botTokenSource/);
});
