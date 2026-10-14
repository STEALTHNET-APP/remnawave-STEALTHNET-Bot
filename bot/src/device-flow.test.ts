import assert from "node:assert/strict";
import test from "node:test";
import { DeviceFlow, formatDeviceCount, subscriptionDeviceLimit, type DeviceSource, type DeviceScreen } from "./device-flow.js";

const sub = { id: "sub-active", type: "root" as const, subscriptionIndex: 0, tariffDisplayName: "Базовый", subscription: { status: "ACTIVE", hwidDeviceLimit: 8 } };
function fixture() {
  const deleted: string[] = [];
  const reads: string[] = [];
  let items = Array.from({ length: 9 }, (_, i) => ({ hwid: `hwid-${i}`, deviceModel: "iPhone", appName: "Happ" }));
  const source: DeviceSource = {
    subscriptions: async () => [sub, { ...sub, id: "sub-expired", subscriptionIndex: 1, subscription: { status: "EXPIRED" } }],
    devices: async (id) => { reads.push(id); return { total: items.length, devices: items }; },
    remove: async (selected, hwid) => { deleted.push(`${selected.id}:${hwid}`); items = items.filter(d => d.hwid !== hwid); },
  };
  return { flow: new DeviceFlow(), source, deleted, reads };
}
function button(screen: DeviceScreen, label: string) {
  const b = screen.markup.inline_keyboard.flat().find(b => b.text.includes(label));
  assert.ok(b, `missing ${label}`);
  return b.callback_data;
}

test("menu asks for a subscription and does not merge their devices", async () => {
  const { flow, source, reads } = fixture();
  const menu = await flow.handle("u1", "menu:devices", source);
  assert.match(menu.text, /Выберите подписку/);
  assert.deepEqual(reads, []);
  assert.match(menu.markup.inline_keyboard.flat().map(b => b.text).join(" "), /Истекла/);
  const list = await flow.handle("u1", button(menu, "#0"), source);
  assert.deepEqual(reads, ["sub-active"]);
  assert.match(list.text, /9 из 8/);
});

test("device selection confirms; cancel keeps it; yes deletes exactly the chosen subscription and HWID", async () => {
  const { flow, source, deleted } = fixture();
  let screen = await flow.handle("u", "dev:open:sub-active", source);
  screen = await flow.handle("u", button(screen, "iPhone"), source);
  assert.match(screen.text, /Удалить устройство/);
  assert.deepEqual(deleted, []);
  screen = await flow.handle("u", button(screen, "Отмена"), source);
  assert.deepEqual(deleted, []);
  screen = await flow.handle("u", button(screen, "iPhone"), source);
  const yes = button(screen, "Да, удалить");
  screen = await flow.handle("u", yes, source);
  assert.deepEqual(deleted, ["sub-active:hwid-0"]);
  assert.match(screen.text, /8 из 8/);
  await flow.handle("u", yes, source);
  assert.equal(deleted.length, 1);
});

test("stale, cross-user and legacy delete callbacks cannot delete devices", async () => {
  const { flow, source, deleted } = fixture();
  let screen = await flow.handle("u", "dev:open:sub-active", source);
  screen = await flow.handle("u", button(screen, "iPhone"), source);
  const yes = button(screen, "Да, удалить");
  await flow.handle("other", yes, source);
  await flow.handle("u", "menu:devices", source);
  await flow.handle("u", yes, source);
  await flow.handle("u", "devices:delete:0", source);
  assert.deepEqual(deleted, []);
});

test("pagination reaches devices beyond the first page and respects Telegram limits", async () => {
  const { flow, source, deleted } = fixture();
  let screen = await flow.handle("u", "dev:open:sub-active", source);
  screen = await flow.handle("u", button(screen, "Далее"), source);
  assert.match(screen.text, /2 из 2/);
  for (const b of screen.markup.inline_keyboard.flat()) assert.ok(Buffer.byteLength(b.callback_data) <= 64);
  assert.ok(screen.text.length <= 1024);
  screen = await flow.handle("u", button(screen, "iPhone"), source);
  await flow.handle("u", button(screen, "Да, удалить"), source);
  assert.deepEqual(deleted, ["sub-active:hwid-6"]);
});

test("failed lookup is unavailable, not empty; failed deletion never reports success", async () => {
  const { flow, source } = fixture();
  let screen = await flow.handle("u", "dev:open:sub-active", source);
  screen = await flow.handle("u", button(screen, "iPhone"), source);
  source.remove = async () => { throw new Error("offline"); };
  screen = await flow.handle("u", button(screen, "Да, удалить"), source);
  assert.match(screen.text, /Не удалось удалить/);
  source.devices = async () => { throw new Error("offline"); };
  screen = await flow.handle("u", "dev:open:sub-active", source);
  assert.match(screen.text, /не удалось загрузить/);
  assert.doesNotMatch(screen.text, /Подключено: 0/);
});

test("counts show available slots, unlimited limits and unavailable counts honestly", () => {
  assert.equal(formatDeviceCount(5, 8), "📱 Подключено: 5 из 8 · свободно 3");
  assert.match(formatDeviceCount(0, 8), /0 из 8 · свободно 8/);
  assert.match(formatDeviceCount(9, 8), /свободно 0/);
  assert.match(formatDeviceCount(5, 0), /без лимита/);
  assert.equal(subscriptionDeviceLimit({ response: { hwidDeviceLimit: null } }), null);
  assert.match(formatDeviceCount(5, subscriptionDeviceLimit({ hwidDeviceLimit: null })), /без лимита/);
  assert.match(formatDeviceCount(null, 8), /не удалось загрузить/);
});

test("empty devices and unusual names stay readable with valid UTF-8 and short captions", async () => {
  const { flow, source } = fixture();
  source.devices = async () => ({ total: 0, devices: [] });
  let screen = await flow.handle("u", "dev:open:sub-active", source);
  assert.match(screen.text, /пока нет подключённых/);
  assert.match(screen.text, /0 из 8/);
  source.devices = async () => ({ total: 1, devices: [{ hwid: "device", deviceModel: "\n\u0000", appName: "💜".repeat(1000) + "\ud800" }] });
  screen = await flow.handle("u", "dev:open:sub-active", source);
  screen = await flow.handle("u", button(screen, "Устройство"), source);
  assert.ok(screen.text.length < 1024);
  assert.equal(Buffer.from(screen.text, "utf8").toString("utf8"), screen.text);
});

test("a second confirmation while deletion is pending cannot replay the operation", async () => {
  const { flow, source, deleted } = fixture();
  let screen = await flow.handle("u", "dev:open:sub-active", source);
  screen = await flow.handle("u", button(screen, "iPhone"), source);
  const yes = button(screen, "Да, удалить");
  const remove = source.remove;
  let release: () => void = () => {};
  const pending = new Promise<void>(resolve => { release = resolve; });
  source.remove = async (s, hwid) => { await pending; return remove(s, hwid); };
  const first = flow.handle("u", yes, source);
  const replay = await flow.handle("u", yes, source);
  assert.match(replay.text, /устарел/);
  release();
  await first;
  assert.equal(deleted.length, 1);
});
