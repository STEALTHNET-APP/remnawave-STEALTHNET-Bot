import { test } from "node:test";
import assert from "node:assert/strict";
import { helpMainMenu, mainMenu } from "./keyboard.js";

test("support offers the existing tickets mini app alongside documents and support", () => {
  const buttons = helpMainMenu({ support: "https://t.me/support", appUrl: " https://panel.example/app/// ", ticketsEnabled: true }).inline_keyboard.flat();
  assert.ok(buttons.some(b => "url" in b && b.url === "https://t.me/support"));
  assert.ok(buttons.some(b => "callback_data" in b && b.callback_data === "menu:docs"));
  assert.deepEqual(buttons.find(b => "web_app" in b), { text: "🎫 Тикеты", web_app: { url: "https://panel.example/app/cabinet/tickets" } });
  assert.equal((buttons.at(-1) as { callback_data: string }).callback_data, "menu:main");
});

for (const enabled of [false, undefined]) {
  test(`support hides tickets when ticketsEnabled is ${enabled}`, () => {
    const buttons = helpMainMenu({ appUrl: "https://panel.example", ticketsEnabled: enabled }).inline_keyboard.flat();
    assert.equal(buttons.some(b => "web_app" in b), false);
    assert.ok(buttons.some(b => "callback_data" in b && b.callback_data === "menu:docs"));
  });
}

for (const appUrl of [null, undefined, "", "   "]) {
  test(`support hides tickets without a cabinet URL: ${JSON.stringify(appUrl)}`, () => {
    const buttons = helpMainMenu({ appUrl, ticketsEnabled: true }).inline_keyboard.flat();
    assert.equal(buttons.some(b => "web_app" in b), false);
  });
}

test("ticket label uses the selected language and preserves the configured back button", () => {
  const rows = helpMainMenu({ appUrl: "https://panel.example", ticketsEnabled: true }, "Return", "success", { back: "123" }, "en").inline_keyboard;
  assert.equal(rows.flat().find(b => "web_app" in b)?.text, "🎫 Tickets");
  assert.deepEqual(rows.at(-1), [{ text: "Return", callback_data: "menu:main", style: "success", icon_custom_emoji_id: "123" }]);
});

test("main menu exposes support with only tickets configured and respects hidden support", () => {
  const opts = { showTrial: false, showVpn: false, appUrl: "https://panel.example", showTickets: true, hasSupportLinks: false };
  const hasSupport = (buttons: ReturnType<typeof mainMenu>) => buttons.inline_keyboard.flat().some(b => "callback_data" in b && b.callback_data === "menu:support");
  assert.equal(hasSupport(mainMenu(opts)), true);
  assert.equal(hasSupport(mainMenu({ ...opts, showTickets: false })), false);
  assert.equal(hasSupport(mainMenu({ ...opts, appUrl: null })), false);
  assert.equal(hasSupport(mainMenu({ ...opts, botButtons: [{ id: "support", visible: false, label: "Help", order: 1 }] })), false);
  assert.equal(hasSupport(mainMenu({ ...opts, showTickets: false, hasSupportLinks: true })), true);
});
