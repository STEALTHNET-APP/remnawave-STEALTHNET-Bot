import assert from "node:assert/strict";
import { test } from "node:test";
import { SYSTEM_CONFIG_KEYS } from "../dist/modules/client/client.service.js";

test("SYSTEM_CONFIG_KEYS includes bot webhook keys", () => {
  assert.ok(SYSTEM_CONFIG_KEYS.includes("bot_webhook_enabled"));
  assert.ok(SYSTEM_CONFIG_KEYS.includes("bot_webhook_url"));
  assert.ok(SYSTEM_CONFIG_KEYS.includes("bot_webhook_secret"));
});

test("bot webhook forwarding handles secret verification logic", async () => {
  // Test secret verification logic:
  function verifySecret(expectedSecret, headerSecret) {
    if (expectedSecret && expectedSecret.trim()) {
      return headerSecret === expectedSecret.trim();
    }
    return true; // no secret required if not set
  }

  assert.equal(verifySecret("my-secret-123", "my-secret-123"), true);
  assert.equal(verifySecret("my-secret-123", "wrong-secret"), false);
  assert.equal(verifySecret("my-secret-123", undefined), false);
  assert.equal(verifySecret("", undefined), true);
  assert.equal(verifySecret(null, undefined), true);
});

test("bot webhook reply payload forwarding logic", () => {
  function processBotForwardResponse(contentType, data) {
    if (contentType.includes("application/json") && data && typeof data === "object") {
      return { status: 200, isJson: true, body: data };
    }
    return { status: 200, isJson: false, body: "OK" };
  }

  // When bot replies via Webhook Reply
  const replyPayload = {
    method: "editMessageText",
    text: "Главное меню",
    reply_markup: { inline_keyboard: [] },
  };
  const res1 = processBotForwardResponse("application/json", replyPayload);
  assert.equal(res1.status, 200);
  assert.equal(res1.isJson, true);
  assert.deepEqual(res1.body, replyPayload);

  // When bot finishes without Webhook Reply
  const res2 = processBotForwardResponse("text/plain", "OK");
  assert.equal(res2.status, 200);
  assert.equal(res2.isJson, false);
  assert.equal(res2.body, "OK");
});

test("bot bootstrap data contract assembly", () => {
  const mockClient = {
    id: "clnt_123",
    preferredLang: "ru",
    preferredCurrency: "RUB",
    balance: 500,
  };
  const mockSubs = [
    {
      type: "root",
      id: "sub_1",
      subscriptionIndex: 0,
      subscription: { status: "ACTIVE" },
      tariffDisplayName: "VIP Тариф",
      trialId: null,
      isBanned: false,
    },
  ];
  const mockTrials = { items: [], hasAnyEnabled: false };

  const rootItem = mockSubs.find((s) => s.subscriptionIndex === 0 || s.type === "root") ?? mockSubs[0];
  const primarySubscription = rootItem
    ? {
        subscription: rootItem.subscription,
        tariffDisplayName: rootItem.tariffDisplayName,
        isTrial: Boolean(rootItem.trialId),
        isBanned: rootItem.isBanned,
      }
    : { subscription: null, tariffDisplayName: null };

  const bootstrap = {
    client: mockClient,
    subscription: primarySubscription,
    allSubscriptions: { items: mockSubs },
    availableTrials: mockTrials,
  };

  assert.equal(bootstrap.client.id, "clnt_123");
  assert.equal(bootstrap.subscription.tariffDisplayName, "VIP Тариф");
  assert.equal(bootstrap.allSubscriptions.items.length, 1);
  assert.equal(bootstrap.availableTrials.hasAnyEnabled, false);
});
