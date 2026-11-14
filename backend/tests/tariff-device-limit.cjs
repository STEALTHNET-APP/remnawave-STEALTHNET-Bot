const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(path, mocks = {}) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    { exports, require: (name) => mocks[name] ?? require(name), console, Date, JSON, process, globalThis: {}, Buffer },
  );
  return exports;
}

const cap = load('src/modules/extra-options/device-limit.ts');

const primarySub = { id: 'primary', extraDevices: 4, subscriptionIndex: 0, tariffId: 'tariff-5' };
const db = {
  tariff: {
    findUnique: async () => ({ maxExtraDevices: 5 }),
  },
  subscription: {
    findFirst: async ({ where }) => {
      if (where.id) return where.id === primarySub.id ? primarySub : null;
      if (where.subscriptionIndex === 0 && where.tariffId === primarySub.tariffId) return primarySub;
      return null;
    },
  },
};

(async () => {
  await assert.rejects(
    () => cap.validateTariffDevices(db, 'client', 'tariff-5', 2, { autoRenew: true }),
    (error) => error.code === 'EXTRA_DEVICE_LIMIT' && /1/.test(error.message),
  );
  await cap.validateTariffDevices(db, 'client', 'tariff-5', 1, { autoRenew: true });
  await cap.validateTariffDevices(db, 'client', 'tariff-5', 5);

  await assert.rejects(
    () => cap.validateTariffDevices(db, 'client', 'tariff-5', 2, { extendsSecondarySubId: 'primary' }),
    (error) => error.code === 'EXTRA_DEVICE_LIMIT',
  );
  await cap.validateTariffDevices(db, 'client', 'tariff-5', 1, { extendsSecondarySubId: 'primary' });

  await cap.validateTariffDevices(db, 'client', 'tariff-5', 5, { isAdditionalSubscription: true });
  await cap.validateTariffDevices(db, 'client', 'tariff-5', 5, { extendsSecondarySubId: 'primary', removeExtrasOnActivate: true });
  await cap.validateTariffDevices(db, 'client', 'tariff-5', 5, { purchasedAsGift: true });
  await cap.validateTariffDevices(db, 'client', 'another-tariff', 5);

  console.log('PASS: extra-device limit applies to current subscription and explicit renewal target');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
