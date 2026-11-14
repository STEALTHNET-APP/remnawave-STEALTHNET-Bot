import assert from "node:assert/strict";
import test from "node:test";
import { backNavRow, backToMenu, profileBackButton } from "./keyboard.js";
import { isCabinetGrouped, sectionBackToMenu } from "./handlers/shared.js";

const callbacks = (row: { callback_data: string }[]) => row.map((button) => button.callback_data);

test("section navigation keeps a single main menu button when the section is not grouped", () => {
  const row = backNavRow(null, undefined, undefined, false);
  assert.deepEqual(callbacks(row), ["menu:main"]);
  assert.equal(row[0]!.text, "🏠 Главное меню");
});

test("grouped sections get a back-to-profile button next to the main menu", () => {
  const row = backNavRow(
    "🏠 Меню",
    { back: "primary", backProfile: "success" },
    { backProfile: "5289722755871162900", backProfileUnicode: "⬅️" },
    true,
  );
  assert.deepEqual(callbacks(row), ["menu:profile", "menu:main"]);
  assert.equal(row[0]!.text, "Назад");
  assert.equal(row[0]!.style, "success");
  assert.equal(row[0]!.icon_custom_emoji_id, "5289722755871162900");
  assert.equal(row[1]!.text, "🏠 Меню");
  assert.equal(row[1]!.style, "primary");
});

test("profile back button uses default color and unicode unless overridden", () => {
  const button = profileBackButton(undefined, undefined, "ru");
  assert.equal(button.text, "◀️ Назад");
  assert.equal(button.style, "danger");
  assert.equal(button.icon_custom_emoji_id, undefined);
});

test("profile back button keeps the localized label with a premium emoji", () => {
  const button = profileBackButton({ backProfile: "primary" }, { backProfile: "999" }, "en");
  assert.equal(button.text, "Back");
  assert.equal(button.style, "primary");
  assert.equal(button.icon_custom_emoji_id, "999");
});

test("backToMenu returns two buttons only for grouped sections", () => {
  assert.deepEqual(callbacks(backToMenu(null, undefined, undefined, false).inline_keyboard[0] as { callback_data: string }[]), ["menu:main"]);
  assert.deepEqual(callbacks(backToMenu(null, undefined, undefined, true).inline_keyboard[0] as { callback_data: string }[]), ["menu:profile", "menu:main"]);
});

test("grouped cabinet detection follows the configured list", () => {
  assert.equal(isCabinetGrouped("tariffs", { botGroupCabinet: true } as never), true);
  assert.equal(isCabinetGrouped("tariffs", { botGroupCabinet: true, botGroupCabinetItems: ["devices"] } as never), false);
  assert.equal(isCabinetGrouped("devices", { botGroupCabinet: true, botGroupCabinetItems: ["devices"] } as never), true);
  assert.equal(isCabinetGrouped("devices", { botGroupCabinet: true, botGroupCabinetItems: [] } as never), false);
  assert.equal(isCabinetGrouped("devices", { botGroupCabinet: false } as never), false);
  assert.equal(isCabinetGrouped("devices", null), false);
});

test("grouped section keyboard exposes both return paths", () => {
  const grouped = sectionBackToMenu("tariffs", { botGroupCabinet: true } as never, { backProfile: "primary" });
  assert.deepEqual(callbacks(grouped.inline_keyboard[0] as { callback_data: string }[]), ["menu:profile", "menu:main"]);
  const plain = sectionBackToMenu("tariffs", { botGroupCabinet: true, botGroupCabinetItems: [] } as never);
  assert.deepEqual(callbacks(plain.inline_keyboard[0] as { callback_data: string }[]), ["menu:main"]);
});
