import assert from "node:assert/strict";
import { test } from "node:test";
import { mainMenu } from "./keyboard.js";
import { menuWebAppUrl } from "./menu-web-app.js";
const opts = { showTrial: true, showVpn: true, showProxy: true, showSingbox: true, showTickets: true, showExtraOptions: true, showGift: true, hasSupportLinks: true, appUrl: "https://panel.example" };

test("classic remains the default and switching back restores callbacks", () => {
  const defaultMenu = mainMenu(opts);
  assert.deepEqual(mainMenu({ ...opts, menuMode: "classic" }), defaultMenu);
  assert.ok(defaultMenu.inline_keyboard.flat().some(b => "callback_data" in b && b.callback_data === "menu:tariffs"));
});

test("web menu sends every built-in section to HTTPS Mini App without callbacks", () => {
  const buttons = mainMenu({ ...opts, menuMode: "web" }).inline_keyboard.flat();
  assert.ok(buttons.length >= 20);
  assert.ok(buttons.every(b => "web_app" in b || "url" in b));
  for (const route of ["tariffs", "menu/devices", "menu/topup", "menu/trial", "menu/promocode", "menu/support", "menu/tg-proxy", "subscribe", "gifts", "proxy", "singbox", "extra-options"]) {
    assert.ok(buttons.some(b => "web_app" in b && b.web_app.url === `https://panel.example/cabinet/${route}`), route);
  }
});

test("web mode preserves custom links, row order, labels, styles and premium icons", () => {
  const rows = mainMenu({ ...opts, menuMode: "web", buttonsPerRow: 2, botButtons: [
    { id: "tariffs", label: "📦 Купить", order: 1, visible: true, style: "success", iconCustomEmojiId: "123" },
    { id: "custom_test", label: "Наш канал", url: "https://t.me/example", order: 0, visible: true, onePerRow: true },
    { id: "profile", label: "Hidden", order: 2, visible: false },
  ] }).inline_keyboard;
  assert.deepEqual(rows[0], [{ text: "Наш канал", url: "https://t.me/example" }]);
  const button = rows.flat().find(b => "web_app" in b && b.web_app.url.endsWith("/tariffs"));
  assert.deepEqual(button, { text: "Купить", style: "success", icon_custom_emoji_id: "123", web_app: { url: "https://panel.example/cabinet/tariffs" } });
  assert.ok(!rows.flat().some(b => b.text === "Hidden"));
});

test("feature visibility remains enforced in web mode", () => {
  const buttons = mainMenu({ ...opts, menuMode: "web", showTrial: false, showVpn: false, showProxy: false, showSingbox: false, showTickets: false, showExtraOptions: false, showGift: false, hasSupportLinks: false }).inline_keyboard.flat();
  const urls = buttons.flatMap(b => "web_app" in b ? [b.web_app.url] : []);
  for (const route of ["menu/trial", "subscribe", "proxy", "singbox", "tickets", "extra-options", "gifts", "menu/support"]) assert.ok(!urls.includes(`https://panel.example/cabinet/${route}`));
});

test("invalid web URLs fall back to classic actions without losing buttons", () => {
  for (const base of ["", "http://panel.example", "javascript:alert(1)", "https://user:pass@panel.example", "not-a-url"]) {
    assert.equal(menuWebAppUrl(base, "tariffs"), null);
    const buttons = mainMenu({ ...opts, appUrl: base, menuMode: "web" }).inline_keyboard.flat();
    assert.ok(buttons.some(b => "callback_data" in b && b.callback_data === "menu:tariffs"));
  }
  assert.equal(menuWebAppUrl(" https://panel.example/base///?x=1#old ", "devices"), "https://panel.example/base/cabinet/menu/devices");
  assert.equal(menuWebAppUrl(opts.appUrl, "__proto__"), null);
  assert.equal(menuWebAppUrl(opts.appUrl, "custom_test"), null);
});
