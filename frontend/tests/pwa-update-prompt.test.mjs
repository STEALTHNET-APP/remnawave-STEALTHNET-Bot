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
    contents: `import React,{useEffect,useState} from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter,Link} from 'react-router-dom';import {PwaUpdatePrompt} from './src/components/pwa/pwa-update-prompt';function Ready(){useEffect(()=>{window.promptReady=true;},[]);return null;}function App(){const [value,setValue]=useState('initial');return <BrowserRouter><input id="name"/><input id="check" type="checkbox"/><input id="controlled" value={value} onChange={e=>setValue(e.target.value)}/><select id="select"><option>A</option><option>B</option></select><div id="rich" contentEditable suppressContentEditableWarning>initial</div><Link id="to-dashboard" to="/cabinet/dashboard">Dashboard</Link><Link id="to-referral" to="/cabinet/referral">Referral</Link><Link id="to-payment" to="/cabinet/payment-wait?payment=success">Payment</Link><PwaUpdatePrompt/><Ready/></BrowserRouter>};createRoot(document.getElementById('root')).render(<App/>);`,
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
  res.end(req.url === "/bundle.js" ? bundled.outputFiles[0].text : '<meta charset="utf-8"><div id="root"></div><script src="/bundle.js"></script>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await playwright.chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
const base = `http://127.0.0.1:${server.address().port}`;

async function openPage(path, { endColdStart = true } = {}) {
  const page = await browser.newPage();
  await page.clock.install({ time: new Date("2026-10-25T12:00:00Z") });
  await page.goto(base + path);
  await page.waitForFunction(() => window.promptReady === true);
  if (endColdStart) {
    await page.evaluate(() => { window.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); });
  }
  return page;
}

async function offerUpdate(page) {
  await page.evaluate(() => window.offerUpdate());
}

async function updateCount(page) {
  return page.evaluate(() => window.updates || 0);
}

async function reloadCount(page) {
  return page.evaluate(() => window.reloads || 0);
}

try {
  await test("cold start applies a waiting update immediately", async () => {
    const page = await openPage("/cabinet/dashboard", { endColdStart: false });
    try {
      await offerUpdate(page);
      await page.clock.runFor(2000);
      assert.equal(await updateCount(page), 1);
      assert.equal(await reloadCount(page), 1);
    } finally { await page.close(); }
  });

  await test("route transition applies the update and keeps the target URL", async () => {
    const page = await openPage("/cabinet/dashboard");
    try {
      await offerUpdate(page);
      assert.equal(await updateCount(page), 0);
      await page.locator("#to-referral").click();
      await page.waitForFunction(() => window.updates === 1);
      assert.equal(page.url(), base + "/cabinet/referral");
      await page.clock.runFor(2000);
      assert.equal(await reloadCount(page), 1);
    } finally { await page.close(); }
  });

  await test("hiding the tab applies the update in the background", async () => {
    const page = await openPage("/cabinet/dashboard");
    try {
      await offerUpdate(page);
      assert.equal(await updateCount(page), 0);
      await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await page.waitForFunction(() => window.updates === 1);
      await page.clock.runFor(2000);
      assert.equal(await reloadCount(page), 1);
    } finally { await page.close(); }
  });

  await test("hiding the tab does not apply the update over unsaved input", async () => {
    const page = await openPage("/cabinet/dashboard");
    try {
      await page.locator("#name").fill("unsaved");
      await page.locator("#name").blur();
      await offerUpdate(page);
      await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await page.clock.runFor(60000);
      assert.equal(await updateCount(page), 0);
    } finally { await page.close(); }
  });

  await test("payment routes and payment query parameters are never updated automatically", async () => {
    for (const path of [
      "/cabinet/payment-wait",
      "/cabinet/payment-wait?payment=success",
      "/cabinet/payment?status=fail",
      "/cabinet/subscribe",
      "/cabinet/yoomoney-pay?invoice=1",
      "/cabinet/dashboard?payment=success",
      "/cabinet/dashboard?redirect=https%3A%2F%2Fexample.com",
      "/cabinet/dashboard?stars=1",
    ]) {
      const page = await openPage(path);
      try {
        await offerUpdate(page);
        await page.clock.runFor(5000);
        assert.equal(await updateCount(page), 0, path);
      } finally { await page.close(); }
    }
  });

  await test("an open Telegram Stars invoice blocks automatic updates", async () => {
    const page = await openPage("/cabinet/dashboard");
    try {
      await page.evaluate(() => sessionStorage.setItem("stealthnet_telegram_invoice_open", String(Date.now())));
      await offerUpdate(page);
      await page.clock.runFor(5000);
      assert.equal(await updateCount(page), 0);
    } finally { await page.close(); }
  });

  await test("a safe navigation after a payment route applies the waiting update", async () => {
    const page = await openPage("/cabinet/payment-wait?payment=success");
    try {
      await offerUpdate(page);
      await page.clock.runFor(5000);
      assert.equal(await updateCount(page), 0);
      await page.locator("#to-dashboard").click();
      await page.waitForFunction(() => window.updates === 1);
    } finally { await page.close(); }
  });

  await test("an open dialog or sheet blocks automatic updates", async () => {
    const page = await openPage("/cabinet/dashboard");
    try {
      await page.evaluate(() => {
        const dialog = document.createElement("div");
        dialog.setAttribute("role", "dialog");
        dialog.textContent = "payment";
        document.body.append(dialog);
      });
      await offerUpdate(page);
      await page.clock.runFor(60000);
      assert.equal(await updateCount(page), 0);
    } finally { await page.close(); }
  });

  await test("dirty form input blocks automatic updates and asks before a manual reload", async () => {
    const page = await openPage("/cabinet/dashboard");
    try {
      await page.locator("#name").fill("unsaved");
      await page.locator("#name").blur();
      await offerUpdate(page);
      await page.clock.runFor(122000);
      assert.equal(await updateCount(page), 0);

      await page.getByRole("button", { name: "Обновить сейчас" }).click();
      await page.getByText("Обновить страницу?", { exact: true }).waitFor();
      await page.getByText("Несохранённые изменения будут потеряны. Сначала сохраните их или подтвердите обновление.").waitFor();
      await page.getByRole("button", { name: "Остаться", exact: true }).click();
      assert.equal(await updateCount(page), 0);

      await page.getByRole("button", { name: "Обновить сейчас" }).click();
      await page.getByRole("button", { name: "Обновить без сохранения" }).click();
      await page.waitForFunction(() => window.updates === 1);
    } finally { await page.close(); }
  });

  await test("checkbox, select and rich text edits remain protected after blur", async () => {
    for (const id of ["check", "select", "rich"]) {
      const page = await openPage("/cabinet/dashboard");
      try {
        if (id === "check") await page.locator("#check").check();
        else if (id === "select") await page.locator("#select").selectOption("B");
        else await page.locator("#rich").fill("edited document");
        await page.locator(`#${id}`).blur();
        await offerUpdate(page);
        await page.clock.runFor(60000);
        assert.equal(await updateCount(page), 0, id);
      } finally { await page.close(); }
    }
  });

  await test("reverted and unmounted edits stop blocking background updates", async () => {
    for (const action of ["revert", "remove"]) {
      const page = await openPage("/cabinet/dashboard");
      try {
        await page.locator("#controlled").fill("unsaved");
        if (action === "revert") {
          await page.locator("#controlled").fill("initial");
          await page.locator("#controlled").blur();
        } else {
          await page.locator("#controlled").evaluate(el => el.remove());
        }
        await page.clock.runFor(16000);
        await offerUpdate(page);
        await page.evaluate(() => {
          Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
          document.dispatchEvent(new Event("visibilitychange"));
        });
        await page.waitForFunction(() => window.updates === 1);
      } finally { await page.close(); }
    }
  });

  await test("a long session shows a quiet prompt without a countdown", async () => {
    const page = await openPage("/cabinet/dashboard");
    try {
      await offerUpdate(page);
      await page.clock.runFor(119000);
      assert.equal(await updateCount(page), 0);
      assert.equal(await page.getByText("Доступна новая версия", { exact: true }).count(), 0);

      await page.clock.runFor(3000);
      await page.getByText("Доступна новая версия", { exact: true }).waitFor();
      assert.equal(await page.getByText(/Применяем обновление \(/).count(), 0);

      await page.getByRole("button", { name: "Обновить сейчас" }).click();
      await page.waitForFunction(() => window.updates === 1);
      await page.clock.runFor(2000);
      assert.equal(await reloadCount(page), 1);
    } finally { await page.close(); }
  });

  await test("a snoozed prompt returns after fifteen minutes without a new SW event", async () => {
    const page = await openPage("/cabinet/dashboard");
    try {
      await offerUpdate(page);
      await page.clock.runFor(122000);
      await page.getByText("Доступна новая версия", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Позже", exact: true }).click();
      await page.clock.runFor(899000);
      assert.equal(await page.getByText("Доступна новая версия", { exact: true }).count(), 0);
      await page.clock.runFor(2000);
      await page.getByText("Доступна новая версия", { exact: true }).waitFor();
    } finally { await page.close(); }
  });

  await test("a failed update requires a manual retry", async () => {
    const page = await openPage("/cabinet/dashboard");
    try {
      await offerUpdate(page);
      await page.clock.runFor(122000);
      await page.evaluate(() => { window.failUpdate = true; });
      await page.getByRole("button", { name: "Обновить сейчас" }).click();
      await page.waitForFunction(() => window.updates === 1);
      await page.getByText("Не удалось обновить. Попробуйте ещё раз.").waitFor();
      await page.clock.runFor(360000);
      assert.equal(await updateCount(page), 1);

      await page.evaluate(() => { window.failUpdate = false; });
      await page.getByRole("button", { name: "Обновить сейчас" }).click();
      await page.waitForFunction(() => window.updates === 2);
    } finally { await page.close(); }
  });
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
