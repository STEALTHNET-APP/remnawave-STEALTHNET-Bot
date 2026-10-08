// Issue #195: secondary auto-renew must charge AND extend by the same price option.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict'), ts = require('typescript');
const source = fs.readFileSync('src/modules/payment/secondary-renew-plan.ts', 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const mod = { exports: {} };
vm.runInNewContext(js, { exports: mod.exports, require: (n) => { throw Error(n); } });
const { resolveSecondaryRenewTariffId, computeSecondaryRenewPrice } = mod.exports;
const autoRenewPrefsFromLastPayment = (...a) => ({ ...mod.exports.autoRenewPrefsFromLastPayment(...a) });
// Copy into this realm: objects built inside vm have a foreign Object.prototype.
const resolveSecondaryRenewPlan = (...a) => ({ ...mod.exports.resolveSecondaryRenewPlan(...a) });

// Admin fills tariffs.price/duration_days from the cheapest option.
const tariff = { id: 't1', price: 70, durationDays: 7 };
const options = [
  { id: 'o7', tariffId: 't1', durationDays: 7, price: 70 },
  { id: 'o31', tariffId: 't1', durationDays: 31, price: 250 },
  { id: 'o90', tariffId: 't1', durationDays: 90, price: 600 },
];
const sub = (o) => ({ tariffId: 't1', autoRenewTariffId: null, autoRenewPriceOptionId: null, customPrice: null, extraDevicesMonthlyPrice: 0, ...o });

// 1. Issue scenario: bought 31d/250 with saved option → charge 250, extend 31d, option saved.
assert.deepEqual(
  resolveSecondaryRenewPlan(sub({ autoRenewPriceOptionId: 'o31', customPrice: 250 }), tariff, options),
  { tariffId: 't1', optionId: 'o31', durationDays: 31, basePrice: 250 },
);
// Saved option wins over a customPrice that points elsewhere.
assert.equal(resolveSecondaryRenewPlan(sub({ autoRenewPriceOptionId: 'o90', customPrice: 250 }), tariff, options).optionId, 'o90');

// 2. No saved option id, customPrice matches an option.
assert.deepEqual(
  resolveSecondaryRenewPlan(sub({ customPrice: 250 }), tariff, options),
  { tariffId: 't1', optionId: 'o31', durationDays: 31, basePrice: 250 },
);

// 3. Nothing matches → legacy tariff price AND duration together (never customPrice + tariff days).
assert.deepEqual(
  resolveSecondaryRenewPlan(sub({ customPrice: 333 }), tariff, options),
  { tariffId: 't1', optionId: null, durationDays: 7, basePrice: 70 },
);
assert.deepEqual(
  resolveSecondaryRenewPlan(sub({}), tariff, options),
  { tariffId: 't1', optionId: null, durationDays: 7, basePrice: 70 },
);
// Tariff without options: customPrice was born from this tariff (old accumulator) → kept as today.
assert.deepEqual(
  resolveSecondaryRenewPlan(sub({ customPrice: 90 }), tariff, []),
  { tariffId: 't1', optionId: null, durationDays: 7, basePrice: 90 },
);
// ...but with paid extra devices the base is the plain tariff price, as today.
assert.equal(resolveSecondaryRenewPlan(sub({ customPrice: 90, extraDevicesMonthlyPrice: 30 }), tariff, []).basePrice, 70);
// Zero legacy duration falls back to 30 days, as today.
assert.equal(resolveSecondaryRenewPlan(sub({}), { id: 't1', price: 70, durationDays: 0 }, []).durationDays, 30);

// 4. tariffId wins; autoRenewTariffId only when the sub lost its tariff (review of f1de800:
//    autoRenewTariffId can be stale — copied from another sub's payment or pre-conversion).
assert.equal(resolveSecondaryRenewTariffId({ tariffId: 't1', autoRenewTariffId: 't2' }), 't1');
assert.equal(resolveSecondaryRenewTariffId({ tariffId: 't1', autoRenewTariffId: null }), 't1');
assert.equal(resolveSecondaryRenewTariffId({ tariffId: null, autoRenewTariffId: 't2' }), 't2');
assert.equal(resolveSecondaryRenewTariffId({ tariffId: null, autoRenewTariffId: null }), null);
// tariffId set + stale autoRenewTariffId/option of t2 → tariff t1 unchanged, foreign option ignored.
{
  const stale = sub({ tariffId: 't1', autoRenewTariffId: 't2', autoRenewPriceOptionId: 'x', customPrice: 250 });
  assert.equal(resolveSecondaryRenewTariffId(stale), 't1');
  assert.deepEqual(
    resolveSecondaryRenewPlan(stale, tariff, [...options, { id: 'x', tariffId: 't2', durationDays: 60, price: 180 }]),
    { tariffId: 't1', optionId: 'o31', durationDays: 31, basePrice: 250 },
  );
}

// 5. Option from another tariff is ignored (both as saved id and as price match).
const t2 = { id: 't2', price: 100, durationDays: 30 };
const mixed = [...options, { id: 'x', tariffId: 't2', durationDays: 60, price: 180 }];
assert.deepEqual(
  resolveSecondaryRenewPlan(sub({ tariffId: 't2', autoRenewPriceOptionId: 'o31', customPrice: 250 }), t2, mixed),
  { tariffId: 't2', optionId: null, durationDays: 30, basePrice: 100 },
);
assert.equal(resolveSecondaryRenewPlan(sub({ autoRenewPriceOptionId: 'x', customPrice: 180 }), tariff, mixed).optionId, null);

// Price: option price + extras for the option's period + personal discount, same formula as before.
const plan31 = { tariffId: 't1', optionId: 'o31', durationDays: 31, basePrice: 250 };
assert.equal(computeSecondaryRenewPrice(plan31, 0, 0), 250);
assert.equal(computeSecondaryRenewPrice(plan31, 60, 0), 250 + Math.floor(60 * 31 / 30));
assert.equal(computeSecondaryRenewPrice(plan31, 60, 10), Math.floor((250 + 62) * 0.9));

// Enabling auto-renew on a sub: only that sub's payment of that sub's tariff, option must belong to it.
const paid = { tariffId: 't1', tariffPriceOptionId: 'o31', deviceCount: 2 };
assert.deepEqual(autoRenewPrefsFromLastPayment('t1', paid, 't1'),
  { autoRenewTariffId: 't1', autoRenewPriceOptionId: 'o31', autoRenewExtraDevices: 2 });
assert.deepEqual(autoRenewPrefsFromLastPayment('t1', paid, 't2'),
  { autoRenewTariffId: 't1', autoRenewPriceOptionId: null, autoRenewExtraDevices: 2 });
assert.deepEqual(autoRenewPrefsFromLastPayment('t1', { ...paid, tariffId: 't2' }, 't2'),
  { autoRenewTariffId: 't1', autoRenewPriceOptionId: null });
assert.deepEqual(autoRenewPrefsFromLastPayment('t1', null, null),
  { autoRenewTariffId: 't1', autoRenewPriceOptionId: null });
assert.deepEqual(autoRenewPrefsFromLastPayment('t1', { ...paid, tariffPriceOptionId: null, deviceCount: null }, null),
  { autoRenewTariffId: 't1', autoRenewPriceOptionId: null, autoRenewExtraDevices: 0 });

console.log('secondary-renew-plan: ok');
