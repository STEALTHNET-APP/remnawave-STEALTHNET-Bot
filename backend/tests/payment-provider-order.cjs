const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(path, mocks = {}) {
  const exports = {};
  const fallback = new Proxy({}, { get: () => undefined });
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports,
      require: (name) => mocks[name] ?? fallback,
      module: { exports },
      Buffer,
      URL,
      console,
      Date,
      JSON,
      Math,
      Number,
      String,
      Array,
      Object,
      Map,
      Promise,
      Set,
      process,
      globalThis: {},
    },
  );
  return exports;
}

const service = load('src/modules/client/client.service.ts');
const checkout = load('../frontend/src/lib/checkout-methods.ts');

const legacyConfig = JSON.stringify([
  { id: 'telegram_stars', label: 'Stars', sortOrder: 0 },
  { id: 'platega', label: 'СБП #1', sortOrder: 1 },
]);

const migrated = service.parsePaymentProviders(legacyConfig);
assert.ok(!migrated.some((p) => p.id === 'platega'));
const platega2 = migrated.find((p) => p.id === 'platega_2');
assert.equal(platega2.label, 'СБП #1');
assert.ok(migrated.some((p) => p.id === 'platega_11'));
assert.ok(migrated.some((p) => p.id === 'platega_12'));
assert.ok(migrated.some((p) => p.id === 'platega_13'));
const sortOrders = migrated.map((p) => p.sortOrder);
assert.equal(JSON.stringify(sortOrders), JSON.stringify([...sortOrders].sort((a, b) => a - b)));

const duplicateLegacy = service.parsePaymentProviders(JSON.stringify([
  { id: 'platega', label: 'Legacy', sortOrder: 0 },
  { id: 'platega_2', label: 'СБП #1', sortOrder: 1 },
]));
assert.equal(duplicateLegacy.filter((p) => p.id === 'platega_2').length, 1);
assert.equal(duplicateLegacy.find((p) => p.id === 'platega_2').label, 'СБП #1');
assert.ok(!duplicateLegacy.some((p) => p.id === 'platega'));

const checkoutConfig = {
  plategaMethods: [
    { id: 2, label: 'СБП (Platega)' },
    { id: 11, label: 'Карты (Platega)' },
  ],
  yookassaEnabled: true,
  rollypayEnabled: true,
  paymentProviders: [
    { id: 'platega_2', label: 'СБП #1 (Platega)', sortOrder: 0 },
    { id: 'rollypay', label: 'СБП #2 (RollyPay)', sortOrder: 1 },
    { id: 'platega_11', label: 'Карты (Platega)', sortOrder: 2 },
    { id: 'yookassa', label: 'ЮKassa (СБП / Карты)', sortOrder: 3 },
  ],
};

const methods = checkout.checkoutMethods(checkoutConfig, 'RUB');
assert.equal(JSON.stringify(methods.map((m) => m.id)), JSON.stringify(['platega_2', 'rollypay', 'platega_11', 'yookassa']));
assert.equal(JSON.stringify(methods.map((m) => m.label)), JSON.stringify([
  'СБП #1 (Platega)',
  'СБП #2 (RollyPay)',
  'Карты (Platega)',
  'ЮKassa (СБП / Карты)',
]));

console.log('PASS: payment provider migration, custom labels and interleaved Platega ordering');
