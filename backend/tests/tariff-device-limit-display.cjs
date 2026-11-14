const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function load(relativePath, mocks = {}) {
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, relativePath), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    require: (name) => (name in mocks ? mocks[name] : require(name)),
    console,
    Date,
    Number,
    String,
    Object,
    Array,
    Math,
    JSON,
    BigInt,
    process,
  });
  return module.exports;
}

const tariff = load("../../bot/src/tariff-device-limit.ts");
const flow = load("../../bot/src/device-flow.ts", { "node:crypto": require("node:crypto") });
const snapshot = load("../src/modules/remna/offline-snapshot.ts");

assert.equal(tariff.formatTariffDeviceLine({ includedDevices: 8, deviceLimit: null, maxExtraDevices: 0 }), "устройства 8");
assert.equal(tariff.formatTariffDeviceLine({ includedDevices: 8, deviceLimit: 5, maxExtraDevices: 0 }), "устройства 8");
assert.equal(tariff.formatTariffDeviceLine({ includedDevices: 2, deviceLimit: null, maxExtraDevices: 3 }), "устройства 2 (+до 3)");
assert.equal(tariff.formatTariffDeviceLine({ includedDevices: 1, deviceLimit: 5, maxExtraDevices: 0 }), "устройства 5");
assert.equal(tariff.formatTariffDeviceLine({ includedDevices: 0, deviceLimit: null, maxExtraDevices: 0 }), "устройства без лимита");
assert.equal(tariff.formatTariffDeviceLine({}), "устройства без лимита");

assert.equal(flow.subscriptionDeviceLimit({ response: { hwidDeviceLimit: null, includedDevices: 8 } }), 8);
assert.equal(flow.subscriptionDeviceLimit({ response: { hwidDeviceLimit: null, includedDevices: 8, deviceLimit: 5 } }), 8);
assert.equal(flow.subscriptionDeviceLimit({ hwidDeviceLimit: null, tariff: { includedDevices: 6 } }), 6);
assert.equal(flow.subscriptionDeviceLimit({ response: { hwidDeviceLimit: null, deviceLimit: 4 } }), 4);
assert.equal(flow.subscriptionDeviceLimit({ response: { hwidDeviceLimit: null } }), null);
assert.equal(flow.subscriptionDeviceLimit({ response: { hwidDeviceLimit: 0 } }), 0);

const modern = snapshot.offlineSubscriptionSnapshot({
  remnawaveUuid: "uuid",
  shortUuid: "short",
  remnaStatus: "ACTIVE",
  expireAt: new Date(Date.now() + 86_400_000),
  trafficUsedBytes: 0,
  trafficLimitBytes: null,
  extraDevices: 2,
  tariff: { trafficLimitBytes: null, includedDevices: 8, deviceLimit: null },
});
assert.equal(modern.response.hwidDeviceLimit, 10);

const legacy = snapshot.offlineSubscriptionSnapshot({
  remnawaveUuid: "uuid",
  shortUuid: "short",
  remnaStatus: "ACTIVE",
  expireAt: new Date(Date.now() + 86_400_000),
  trafficUsedBytes: 0,
  trafficLimitBytes: null,
  extraDevices: 1,
  tariff: { trafficLimitBytes: null, includedDevices: 1, deviceLimit: 5 },
});
assert.equal(legacy.response.hwidDeviceLimit, 6);

const unlimited = snapshot.offlineSubscriptionSnapshot({
  remnawaveUuid: "uuid",
  shortUuid: "short",
  remnaStatus: "ACTIVE",
  expireAt: new Date(Date.now() + 86_400_000),
  trafficUsedBytes: 0,
  trafficLimitBytes: null,
  extraDevices: 0,
  tariff: { trafficLimitBytes: null, includedDevices: 0, deviceLimit: null },
});
assert.equal(unlimited.response.hwidDeviceLimit, null);

console.log("PASS: tariff device limit resolves includedDevices, legacy deviceLimit, extras and unlimited fallback");
