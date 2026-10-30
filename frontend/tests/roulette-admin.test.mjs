import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { build } from "esbuild";
import { readFile, readdir } from "node:fs/promises";
const playwright = await import(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const root = new URL("../", import.meta.url).pathname;
const bundled = await build({ absWorkingDir: root, tsconfig: root + "tsconfig.app.json", stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {AuthProvider} from './src/contexts/auth';import {RouletteAdminTab} from './src/components/roulette/roulette-admin-tab';createRoot(document.getElementById('root')).render(<AuthProvider><RouletteAdminTab/></AuthProvider>);`, resolveDir: root, loader: "tsx" }, bundle: true, write: false, jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } });
const css = await readFile(root + "dist/assets/" + (await readdir(root + "dist/assets")).find(name => name.startsWith("index-") && name.endsWith(".css")));
const server = createServer((req, res) => {
  res.setHeader("Content-Type", req.url === "/bundle.js" ? "text/javascript" : req.url === "/style.css" ? "text/css" : "text/html");
  res.end(req.url === "/bundle.js" ? bundled.outputFiles[0].text : req.url === "/style.css" ? css : '<html class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body class="admin-modern" style="padding:16px"><div id="root"></div><script src="/bundle.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await playwright.chromium.launch();
const base = `http://127.0.0.1:${server.address().port}`;
const sectors = [
  { id: "s1", type: "days", value: 1, label: "+1 день", weight: 30, color: "#4f46e5", icon: "calendar" },
  { id: "s2", type: "balance", value: 25, label: "25 ₽", weight: 30, color: "#06b6d4", icon: "wallet" },
  { id: "s3", type: "empty", value: 0, label: "Пусто", weight: 40, color: "#64748b", icon: "frown" },
];
try {
  await test("roulette admin defaults to Moscow timezone, allows override and sends it on save", async () => {
    for (const width of [390, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 1200 } });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.addInitScript(() => {
        localStorage.setItem("stealthnet_access_token", "fixture");
        localStorage.setItem("stealthnet_admin", JSON.stringify({ id: "admin-1", email: "admin@example.com" }));
      });
      const timeZone = width === 390 ? "UTC" : undefined;
      await page.route("**/api/admin/roulette*", async route => {
        if (route.request().method() === "PUT") return route.fulfill({ json: {} });
        return route.fulfill({ json: { settings: { enabled: true, cooldownHours: 24, resetMode: width === 390 ? "daily" : "hours", ...(timeZone ? { timeZone } : {}), sectors }, totalSpins: 0, spinsByType: [], recentSpins: [] } });
      });
      await page.goto(base);
      await page.getByRole("button", { name: "Сохранить настройки рулетки" }).waitFor();

      if (width === 390) {
        const zone = page.getByLabel("Часовой пояс");
        assert.equal(await zone.inputValue(), "UTC");
        await page.getByRole("button", { name: "Москва" }).click();
        assert.equal(await zone.inputValue(), "Europe/Moscow");
        const request = page.waitForRequest(req => req.method() === "PUT" && req.url().includes("/api/admin/roulette"));
        await page.getByRole("button", { name: "Сохранить настройки рулетки" }).click();
        const saved = await request;
        assert.equal(saved.postDataJSON().timeZone, "Europe/Moscow");
        assert.equal(saved.postDataJSON().resetMode, "daily");
      } else {
        // Без сохранённого пояса админка показывает Москву по умолчанию.
        await page.getByLabel("Обновление попыток").selectOption("daily");
        assert.equal(await page.getByLabel("Часовой пояс").inputValue(), "Europe/Moscow");
        assert.equal(await page.getByRole("button", { name: "Москва" }).isDisabled(), true);
        // В режиме кулдауна поле часового пояса скрыто.
        await page.getByLabel("Обновление попыток").selectOption("hours");
        assert.equal(await page.getByLabel("Часовой пояс").count(), 0);
        assert.equal(await page.getByLabel("Кулдаун между вращениями (часы)").count(), 1);
      }

      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `/tmp/roulette-admin-${width}.png`, fullPage: true });
      await page.close();
    }
  });
} finally { await browser.close(); server.close(); }
