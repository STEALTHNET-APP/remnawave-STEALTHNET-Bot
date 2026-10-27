import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";

const playwright = await import(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const root = new URL("../", import.meta.url).pathname;
const bundled = await build({
  absWorkingDir: root,
  tsconfig: root + "tsconfig.app.json",
  stdin: {
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {PwaUpdatePrompt} from './src/components/pwa/pwa-update-prompt';createRoot(document.getElementById('root')).render(<PwaUpdatePrompt/>);`,
    resolveDir: root, loader: "tsx",
  },
  bundle: true, write: false, jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "observe-reload", setup(builder) {
    builder.onLoad({ filter: /pwa-apply-update\.ts$/ }, async args => ({ loader: "ts", contents: (await readFile(args.path, "utf8")).replace("window.location.reload()", "(window.reloads = (window.reloads || 0) + 1)") }));
  } }, { name: "worker-fixture", setup(builder) {
    builder.onResolve({ filter: /^virtual:pwa-register\/react$/ }, () => ({ path: "worker", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "js", resolveDir: root, contents: `import {useState,useCallback} from 'react';export function useRegisterSW(){const needRefresh=useState(false),offlineReady=useState(false);window.offerUpdate=()=>needRefresh[1](true);const updateServiceWorker=useCallback(async()=>{window.updates=(window.updates||0)+1;if(window.failUpdate)throw Error('offline');},[]);return {needRefresh,offlineReady,updateServiceWorker};}` }));
  }}],
});
const server = createServer((req, res) => {
  res.setHeader("Content-Type", req.url === "/bundle.js" ? "text/javascript" : "text/html");
  res.end(req.url === "/bundle.js" ? bundled.outputFiles[0].text : '<meta charset="utf-8"><input id="name"><input id="check" type="checkbox"><div id="root"></div><script src="/bundle.js"></script>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await playwright.chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
const base = `http://127.0.0.1:${server.address().port}`;

async function scenario(path, run) {
  const page = await browser.newPage();
  try {
    await page.clock.install({ time: new Date("2026-10-25T12:00:00Z") });
    await page.goto(base + path);
    await page.waitForFunction(() => !!window.offerUpdate);
    await page.evaluate(() => window.offerUpdate());
    await page.getByText("Доступно обновление", { exact: true }).waitFor();
    await run(page);
  } finally { await page.close(); }
}

try {
  await test("idle dashboard updates once and preserves URL", () => scenario("/cabinet/dashboard", async page => {
    await page.clock.runFor(70000);
    assert.equal(await page.evaluate(() => window.updates), 1);
    assert.equal(page.url(), base + "/cabinet/dashboard");
    await page.clock.runFor(70000);
    assert.equal(await page.evaluate(() => window.updates), 1);
  }));
  await test("edited field remains protected after blur", () => scenario("/admin", async page => {
    await page.locator("#name").fill("unsaved");
    await page.locator("#name").blur();
    await page.clock.runFor(120000);
    assert.equal(await page.evaluate(() => window.updates || 0), 0);

    await page.getByRole("button", { name: "Обновить сейчас" }).click();
    await page.getByRole("dialog").waitFor();
    await page.getByRole("button", { name: "Остаться", exact: true }).click();
    assert.equal(await page.evaluate(() => window.updates || 0), 0);
  }));
  await test("Telegram without native confirmation requires explicit consent", () => scenario("/cabinet/profile", async page => {
    await page.evaluate(() => { window.Telegram = { WebApp: { initData: "fixture" } }; window.confirm = () => { throw Error("unsupported"); }; });
    await page.locator("#name").fill("keep me");
    await page.locator("#name").blur();
    await page.clock.runFor(120000);
    await page.getByRole("button", { name: "Обновить сейчас" }).click();
    await page.getByRole("dialog").waitFor();
    assert.equal(await page.evaluate(() => window.updates || 0), 0);
    await page.getByRole("button", { name: "Обновить без сохранения" }).click();
    assert.equal(await page.evaluate(() => window.updates), 1);
    await page.clock.runFor(2000);
    assert.equal(await page.evaluate(() => window.reloads), 1);
  }));
  await test("checkbox changes are protected", () => scenario("/admin", async page => {
    await page.locator("#check").check();
    await page.locator("#check").blur();
    await page.clock.runFor(120000);
    assert.equal(await page.evaluate(() => window.updates || 0), 0);
  }));
  await test("Aurora sheet prevents reload", () => scenario("/cabinet/dashboard", async page => {
    await page.evaluate(() => { const sheet = document.createElement("div"); sheet.className = "au-sheet-overlay"; sheet.textContent = "payment"; document.body.append(sheet); });
    await page.clock.runFor(120000);
    assert.equal(await page.evaluate(() => window.updates || 0), 0);
  }));
  await test("payment URLs and settings never reload automatically", async () => {
    for (const path of ["/cabinet/dashboard?payment=success", "/cabinet/tariffs", "/admin/settings"]) {
      await scenario(path, async page => {
        await page.clock.runFor(120000);
        assert.equal(await page.evaluate(() => window.updates || 0), 0);
      });
    }
  });
  await test("snooze reappears after ten minutes without another SW event", () => scenario("/admin/settings", async page => {
    await page.getByRole("button", { name: "Отложить", exact: true }).click();
    await page.clock.runFor(599000);
    assert.equal(await page.getByText("Доступно обновление", { exact: true }).count(), 0);
    await page.clock.runFor(2000);
    await page.getByText("Доступно обновление", { exact: true }).waitFor();
  }));
  await test("failed update requires manual retry", () => scenario("/cabinet/dashboard", async page => {
    await page.evaluate(() => { window.failUpdate = true; });
    await page.clock.runFor(70000);
    assert.equal(await page.evaluate(() => window.updates), 1);
    await page.getByText("Не удалось обновить. Попробуйте ещё раз.").waitFor();
    await page.clock.runFor(360000);
    assert.equal(await page.evaluate(() => window.updates), 1);
    await page.evaluate(() => { window.failUpdate = false; });
    await page.getByRole("button", { name: "Обновить сейчас" }).click();
    assert.equal(await page.evaluate(() => window.updates), 2);
  }));
} finally {
  await browser.close();
  server.close();
}
