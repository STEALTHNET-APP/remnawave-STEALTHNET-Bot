import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { build } from "esbuild";
import { readFile, readdir } from "node:fs/promises";
const playwright = await import(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const root = new URL("../", import.meta.url).pathname;
const bundled = await build({ absWorkingDir: root, tsconfig: root + "tsconfig.app.json", stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {BotWebhookManager} from './src/components/admin/bot-webhook-manager';createRoot(document.getElementById('root')).render(<BotWebhookManager token="fixture"/>);`, resolveDir: root, loader: "tsx" }, bundle: true, write: false, jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } });
const css = await readFile(root + "dist/assets/" + (await readdir(root + "dist/assets")).find(name => name.startsWith("index-") && name.endsWith(".css")));
const server = createServer((req, res) => {
  res.setHeader("Content-Type", req.url === "/bundle.js" ? "text/javascript" : req.url === "/style.css" ? "text/css" : "text/html");
  res.end(req.url === "/bundle.js" ? bundled.outputFiles[0].text : req.url === "/style.css" ? css : '<html class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body class="admin-modern" style="padding:16px"><div id="root"></div><script src="/bundle.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await playwright.chromium.launch();
const base = `http://127.0.0.1:${server.address().port}`;
try {
  await test("webhook settings fit mobile and desktop; refresh preserves draft, failure stays visible, polling requires confirmation", async () => {
    for (const width of [320, 390, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      const errors = []; const changes = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("dialog", () => { throw Error("Native dialog opened"); });
      let polling = false;
      await page.route("**/api/admin/bot/webhook/**", async route => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith("/status")) return route.fulfill({ json: { ok: true, enabled: !polling, runtimeMode: polling ? "polling" : "webhook", configuredUrl: "https://example.com/api/bot/webhook", hasSecret: true, webhookInfo: { url: polling ? "" : "https://example.com/api/bot/webhook", pending_update_count: 0 } } });
        changes.push(route.request().postDataJSON());
        if (path.endsWith("/set")) return route.fulfill({ status: 503, json: { message: "Переключение не подтверждено" } });
        polling = true;
        return route.fulfill({ json: { ok: true, message: "Long Polling включён" } });
      });
      await page.goto(base);
      await page.getByText("Webhook", { exact: true }).waitFor();
      await page.getByLabel("Адрес webhook").fill("https://another.example/api/bot/webhook");
      await page.getByRole("button", { name: "Проверить статус" }).click();
      assert.equal(await page.getByLabel("Адрес webhook").inputValue(), "https://another.example/api/bot/webhook");
      await page.getByRole("button", { name: "Включить Webhook", exact: true }).click();
      await page.getByRole("alert").filter({ hasText: "Переключение не подтверждено" }).waitFor();
      assert.deepEqual(changes[0], { url: "https://another.example/api/bot/webhook" });
      await page.getByRole("button", { name: "Перейти на Long Polling" }).click();
      await page.getByRole("dialog").waitFor();
      assert.equal(changes.length, 1);
      await page.getByRole("button", { name: "Переключить", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "Long Polling включён" }).waitFor();
      assert.equal(changes.length, 2);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `/tmp/pr248-webhook-${width}.png`, fullPage: true });
      await page.close();
    }
  });
} finally { await browser.close(); server.close(); }
