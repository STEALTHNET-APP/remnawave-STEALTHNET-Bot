import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';

process.env.API_URL = 'https://api.example.invalid';
const root = new URL('../', import.meta.url);
let source = fs.readFileSync(new URL('src/index.ts', root), 'utf8');
const boot = source.indexOf('\nawait waitForApi();');
const tail = source.indexOf('\nasync function groupedProfileMenu', boot);
assert(boot > 0 && tail > boot);
source = source.slice(0, boot) + source.slice(tail);
const modules = new Map();
for (const match of source.matchAll(/(?:from\s+|import\s*)["']([^"']+)["']/g)) {
  const name = match[1];
  if (['./api.js', 'grammy', 'dotenv/config'].includes(name)) continue;
  modules.set(name, await import(name.startsWith('.') ? new URL(`dist/${name.slice(2)}`, root) : name));
}
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function setup({ count = 1, periods = 1, multi = false, blocked = false, extras = 0, expired = false, failRead = false, standaloneTrial = false, cloudpayments = false } = {}) {
  let callback;
  const payments = [], messages = [], cooldownIds = [];
  const subscriptions = Array.from({ length: count }, (_, i) => ({
    id: `subscription-${i}`, tariffId: standaloneTrial ? null : 'standard', type: i ? 'secondary' : 'root', subscriptionIndex: i,
    trialId: standaloneTrial ? 'trial' : null, trialConvertEnabled: true, trialConvertAllTariffs: standaloneTrial, tariffDisplayName: 'Standard', remnawaveUuid: `uuid-${i}`,
    extraDevices: extras, extraDevicesMonthlyPrice: extras * 50,
    subscription: { status: expired ? 'EXPIRED' : 'ACTIVE', expireAt: expired ? '2020-01-01' : '2099-01-01' },
  }));
  const tariff = { id: 'standard', name: 'Standard', currency: 'RUB', price: 100, durationDays: 30, includedDevices: 1,
    priceOptions: Array.from({ length: periods }, (_, i) => ({ id: `period-${i}`, price: 100 * (i + 1), durationDays: 30 * (i + 1), sortOrder: i })) };
  const api = {
    getPublicConfig: async () => ({ cloudpaymentsEnabled: cloudpayments, cloudpaymentsTrialTariffId: cloudpayments ? "standard" : null, cloudpaymentsTrialDays: 3, cloudpaymentsTrialAmount: 1, multiSubscriptionsEnabled: multi, defaultCurrency: 'RUB', defaultLanguage: 'ru', publicAppUrl: 'https://panel.example' }),
    registerByTelegram: async () => ({ token: 'fixture-token', client: { preferredLang: 'ru' } }),
    getAllSubscriptions: async () => { if (failRead) throw new Error('unavailable'); return { items: subscriptions }; },
    getPublicTariffs: async () => ({ items: [{ id: 'category', tariffs: [tariff], singleSubscriptionMode: false }] }),
    checkSubscriptionCooldown: async (_, id) => { cooldownIds.push(id); return { blocked, message: 'Cooldown' }; },
    checkSubscriptionsCooldownBatch: async () => ({ items: [] }),
    getMe: async () => ({ balance: 5000, preferredCurrency: 'RUB' }),
    tariffConversionPreview: async () => ({ willConvert: false }),
    createCloudpaymentsPayment: async (_, purchase) => { payments.push(purchase); return { payUrl: "https://panel.example/api/cloudpayments/checkout/test" }; },
    payByBalance: async (_, purchase) => { payments.push(purchase); return { message: 'paid' }; },
  };
  class Composer {
    on(event, fn) { if (event === 'callback_query:data') callback = fn; return this; }
    command() { return this; }
    use() { return this; }
  }
  vm.runInNewContext(js, {
    exports: {}, process: { env: { BOT_TOKEN: 'fixture-only' } }, console: { log() {}, warn() {}, error(...args) { throw new Error(args.join(' ')); } },
    setInterval() { return { unref() {} }; }, setTimeout, clearTimeout, URL, Buffer,
    require(name) {
      if (name === './api.js') return api;
      if (name === 'grammy') return { Composer };
      if (name === 'dotenv/config') return {};
      if (!modules.has(name)) throw new Error(`Unexpected import ${name}`);
      return modules.get(name);
    },
  }, { filename: 'bot-index-fixture.cjs' });
  assert.equal(typeof callback, 'function');
  return {
    payments, messages, cooldownIds,
    async click(data) {
      await callback({ from: { id: 123 }, callbackQuery: { data, message: {} }, api: {},
        answerCallbackQuery: async () => {},
        editMessageText: async (text, options) => messages.push({ text, buttons: options?.reply_markup?.inline_keyboard.flat() ?? [] }),
        reply: async (text, options) => messages.push({ text, buttons: options?.reply_markup?.inline_keyboard.flat() ?? [] }),
      });
      assert(messages.length > 0);
      return messages.at(-1);
    },
  };
}

for (const entry of ['menu:renew', 'renew_pick:standard', 'pay_tariff:standard']) {
  for (const periods of [1, 2]) {
    test(`${entry}: ${periods} periods retain explicit renewal target through balance payment`, async () => {
      const t = setup({ periods, expired: true });
      let screen = await t.click(entry);
      assert(!screen.buttons.some(b => /renew_pick:|pay_tariff_ext:|:add$/.test(b.callback_data ?? '')));
      if (periods === 2) {
        const period = screen.buttons.find(b => b.callback_data?.startsWith('topt:'));
        assert(period, screen.text);
        screen = await t.click(period.callback_data);
      }
      const payment = screen.buttons.find(b => b.callback_data === 'pay_tariff_balance:standard');
      assert(payment, screen.text);
      await t.click(payment.callback_data);
      assert.equal(t.payments.length, 1);
      assert.equal(t.payments[0].extendsSecondarySubId, 'subscription-0');
      assert.equal(t.payments[0].asAdditional, undefined);
      assert(t.cooldownIds.includes('subscription-0'));
    });
  }
}

test('multiple subscriptions keep the selected ID even with multi disabled', async () => {
  const t = setup({ count: 2 });
  const picker = await t.click('menu:renew');
  assert.equal(picker.buttons.filter(b => b.callback_data?.startsWith('pay_tariff_ext:')).length, 2);
  await t.click('pay_tariff_ext:subscription-1');
  await t.click('pay_tariff_balance:standard');
  assert.equal(t.payments[0].extendsSecondarySubId, 'subscription-1');
});
test('cooldown stops renewal before payment methods', async () => {
  const t = setup({ blocked: true });
  const screen = await t.click('menu:renew');
  assert.equal(screen.text, 'Cooldown');
  assert.equal(t.payments.length, 0);
  assert(!screen.buttons.some(b => b.callback_data?.startsWith('pay_tariff_balance:')));
});
test('extra devices preserve the keep/drop step', async () => {
  const t = setup({ extras: 2 });
  const screen = await t.click('menu:renew');
  assert(screen.buttons.some(b => b.callback_data === 'pay_ext_keep:0'));
  assert(screen.buttons.some(b => b.callback_data === 'pay_ext_drop:0'));
  await t.click('pay_ext_drop:0');
  await t.click('pay_tariff_balance:standard');
  assert.equal(t.payments[0].extendsSecondarySubId, 'subscription-0');
  assert.equal(t.payments[0].removeExtrasOnActivate, true);
});
test('stale add callback and failed subscription read cannot create a purchase', async () => {
  const t = setup();
  assert.match((await t.click('pay_tariff:standard:add')).text, /отключена/);
  assert.equal(t.payments.length, 0);
  const broken = setup({ failRead: true });
  assert.match((await broken.click('pay_tariff:standard')).text, /Не удалось проверить/);
  assert.equal(broken.payments.length, 0);
});

test('renewal picker rejects an ID absent from the current account', async () => {
  const t = setup();
  const screen = await t.click('pay_tariff_ext:someone-elses-subscription');
  assert.match(screen.text, /не найдены/);
  assert.equal(t.payments.length, 0);
  assert.equal(t.cooldownIds.length, 0);
});

test('convertible standalone trial keeps its target through tariff selection', async () => {
  const t = setup({ standaloneTrial: true });
  const screen = await t.click('menu:renew');
  assert(screen.buttons.some(b => b.callback_data === 'pay_ext_pickt:0'));
  await t.click('pay_ext_pickt:0');
  await t.click('pay_tariff_balance:standard');
  assert.equal(t.payments[0].extendsSecondarySubId, 'subscription-0');
});

test('CloudPayments renewal keeps the chosen subscription and extra-device policy', async () => {
  const t = setup({ cloudpayments: true, extras: 2 });
  await t.click('menu:renew');
  await t.click('pay_ext_drop:0');
  await t.click('pay_tariff_cloudpayments:standard');
  assert.equal(t.payments.length, 1);
  assert.equal(t.payments[0].extendsSecondarySubId, 'subscription-0');
  assert.equal(t.payments[0].removeExtrasOnActivate, true);
});
test('CloudPayments paid trial opens consent checkout with explicit paidTrial intent', async () => {
  const t = setup({ cloudpayments: true });
  await t.click('menu:cloudtrial');
  assert.equal(t.payments.length, 1);
  assert.equal(t.payments[0].paidTrial, true);
  assert.equal(t.payments[0].tariffId, 'standard');
});
