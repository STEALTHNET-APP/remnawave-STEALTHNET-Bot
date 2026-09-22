import assert from "node:assert/strict";
import test from "node:test";
import { readSubscriptionDevices, usesLegacyDeviceFallback, type DeviceDependencies } from "./subscription-devices.js";

function fixture(ownerId = "owner", giftedToClientId: string | null = null) {
  const calls: string[] = [];
  const deps: DeviceDependencies = {
    findSubscription: async () => ({ ownerId, giftedToClientId, remnawaveUuid: "vpn-selected" }),
    getDevices: async (uuid) => {
      calls.push(uuid);
      return { status: 200, data: { response: { total: 99, devices: [
        { hwid: "first", deviceModel: "iPhone", clientName: "Happ" },
        { hwid: "first", deviceModel: "iPhone" },
        { hwid: "second", deviceModel: "iPhone" },
      ] } } };
    },
  };
  return { deps, calls };
}

test("counts unique HWIDs in the selected subscription, preserving identical models", async () => {
  const { deps, calls } = fixture();
  const result = await readSubscriptionDevices("owner", "selected", deps);
  assert.equal(result.status, 200);
  assert.deepEqual(calls, ["vpn-selected"]);
  assert.ok("devices" in result.body);
  assert.equal(result.body.total, 2);
  assert.equal(result.body.devices[0].appName, "Happ");
});

test("rejects another client's subscription before querying VPN", async () => {
  const { deps, calls } = fixture();
  assert.equal((await readSubscriptionDevices("stranger", "selected", deps)).status, 404);
  assert.deepEqual(calls, []);
});

test("allows the recipient to manage a gifted subscription", async () => {
  assert.equal((await readSubscriptionDevices("recipient", "gift", fixture("owner", "recipient").deps)).status, 200);
});

test("upstream failure or malformed data never becomes a zero count", async () => {
  for (const result of [
    { status: 500, error: "offline" },
    { status: 200, data: { response: {} } },
    { status: 200, data: { response: { devices: [{ hwid: "" }] } } },
  ]) {
    const { deps } = fixture();
    deps.getDevices = async () => result;
    assert.equal((await readSubscriptionDevices("owner", "selected", deps)).status, 503);
  }
});

test("an explicit subscription id must never fall back to other subscriptions", () => {
  assert.equal(usesLegacyDeviceFallback({ subscriptionId: "selected" }), false);
  assert.equal(usesLegacyDeviceFallback({ subscriptionType: "root" }), false);
  assert.equal(usesLegacyDeviceFallback({}), true);
});
