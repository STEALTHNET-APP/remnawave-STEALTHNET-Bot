import assert from "node:assert/strict";
import test from "node:test";
import type { SubscriptionListItem } from "./api.js";
import { renewableSubscriptions, connectableSubscriptions, directConnectionTarget } from "./subscription-actions.js";
import { shouldShowPurchaseChoice } from "./purchase-choice.js";
import { mainMenu } from "./keyboard.js";

const active: SubscriptionListItem = {
  id: "active", type: "secondary", subscriptionIndex: 2, tariffId: "standard", trialId: null,
  tariffDisplayName: "Standard", remnawaveUuid: "uuid-active",
  subscription: { response: { status: "ACTIVE", expireAt: "2099-01-01", subscriptionUrl: "https://sub.example/active" } },
};
const expired: SubscriptionListItem = { ...active, id: "expired", remnawaveUuid: "uuid-expired", subscription: { data: { status: "EXPIRED", expireAt: "2020-01-01" } } };
const trial: SubscriptionListItem = { ...expired, id: "trial", trialId: "trial", trialConvertEnabled: false };

test("expired subscriptions stay renewable without entering the connection picker", () => {
  const items = [trial, expired, active];
  assert.deepEqual(renewableSubscriptions(items).map(s => s.id), ["expired", "active"]);
  assert.deepEqual(connectableSubscriptions(items).map(s => s.id), ["active"]);
  assert.deepEqual(renewableSubscriptions(items, "missing"), []);
});

test("connection requires available status, valid expiry and no active ban", () => {
  assert.deepEqual(connectableSubscriptions([
    { ...active, isBanned: true },
    { ...active, bannedUntil: "2099-01-01" },
    { ...active, subscription: null },
    { ...active, subscription: { user: { status: "ACTIVE", expireAt: "2020-01-01" } } },
    { ...active, subscription: { status: "DISABLED" } },
    { ...active, subscription: { status: "ACTIVE", expireAt: "invalid" } },
  ]), []);
  assert.equal(connectableSubscriptions([{ ...active, subscription: { data: { user: { status: "ACTIVE", expireAt: "2099-01-01" } } } }]).length, 1);
});

test("single connection opens the correct subscription; multiple subscriptions retain a picker", () => {
  assert.deepEqual(directConnectionTarget([trial, active], "https://panel.example", true), { url: "https://sub.example/active" });
  assert.deepEqual(directConnectionTarget([trial, active], "https://panel.example/", false), { web_app: { url: "https://panel.example/cabinet/subscribe?uuid=uuid-active" } });
  assert.equal(directConnectionTarget([active, { ...active, id: "another" }], "https://panel.example"), undefined);
  assert.equal(directConnectionTarget([expired], "https://panel.example"), undefined);
});

test("single subscription mode suppresses purchase choice regardless of period count", () => {
  const base = { tariffId: "standard", subscriptions: [active], isBypass: false, isSingleCategory: false };
  assert.equal(shouldShowPurchaseChoice({ ...base, multiSubscriptionsEnabled: false }), false);
  assert.equal(shouldShowPurchaseChoice({ ...base, multiSubscriptionsEnabled: true }), true);
  assert.equal(shouldShowPurchaseChoice({ ...base, isSingleCategory: true, multiSubscriptionsEnabled: true }), false);
});

test("renewal button supports existing configs, visibility, label, order, grouped and web menus", () => {
  const base = { showTrial: false, showVpn: true, showRenew: true, appUrl: "https://panel.example" };
  const buttons = (options: Parameters<typeof mainMenu>[0]) => mainMenu(options).inline_keyboard.flat();
  for (const extra of [{}, { groupCabinet: true }, { menuMode: "web" as const }, { liteMode: true }]) {
    assert(buttons({ ...base, ...extra }).some(b => "callback_data" in b && b.callback_data === "menu:renew"));
  }
  assert(!buttons({ ...base, showRenew: false }).some(b => "callback_data" in b && b.callback_data === "menu:renew"));
  assert(buttons({ ...base, botButtons: [{ id: "vpn", visible: true, label: "Connect", order: 5 }] }).some(b => "callback_data" in b && b.callback_data === "menu:renew"));
  const configured = { id: "renew", visible: true, label: "Продлить доступ", order: -1, style: "success" };
  assert.equal(buttons({ ...base, botButtons: [configured] })[0].text, "Продлить доступ");
  assert(!buttons({ ...base, botButtons: [{ ...configured, visible: false }] }).some(b => b.text === configured.label));
});

test("direct VPN link takes priority over web menu routing", () => {
  const connectTarget = directConnectionTarget([active], "https://panel.example", true);
  for (const menuMode of ["classic", "web"] as const) {
    const items = mainMenu({ showTrial: false, showVpn: true, appUrl: "https://panel.example", menuMode, connectTarget }).inline_keyboard.flat();
    assert(items.some(b => "url" in b && b.url === "https://sub.example/active"));
    assert(!items.some(b => "callback_data" in b && b.callback_data === "menu:vpn"));
  }
});
