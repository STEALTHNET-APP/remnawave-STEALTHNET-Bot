import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir } from 'node:fs/promises';
import { buildWidget } from '../dist/widgets.js';
import { buildMainMenuText } from '../dist/handlers/shared.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const browser = await chromium.launch();
const output = process.env.UI_OUTPUT_DIR;
if (output) await mkdir(output, { recursive: true });
const menu = buildMainMenuText({
  serviceName: 'STEALTHNET', telegramId: 906436062, balance: 25, currency: 'RUB', tariffDisplayName: '🎁 Пробная 1',
  menuLineVisibility: { balancePrefix: true, tariffPrefix: true, subscriptionPrefix: true, expirePrefix: true, devicesLabel: true, trafficPrefix: true },
  subscription: { hwidDeviceLimit: 3, user: { status: 'EXPIRED', expireAt: '2026-10-22T12:21:00Z', hwidDeviceLimit: 3, trafficLimitBytes: 5 * 1024 ** 3, usedTrafficBytes: 0 } },
});
const labels = ['📦 Тарифы', '🔄 Продлить подписку', 'Автоплатежи', '📱 Устройства', '💳 Пополнить баланс', '🎰 Рулетка', 'Помощь'];
try {
  for (const scheme of ['dark', 'light']) {
    await test(`account widget fits 320px in ${scheme} theme and keeps actions`, async () => {
      const widget = buildWidget(menu.text, [labels.map((text, i) => ({ text, callback_data: `action:${i}` }))], 'STEALTHNET', menu.widgetSummary);
      assert.ok(widget);
      const page = await browser.newPage({ viewport: { width: 320, height: 650 } });
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.evaluate(() => { window.queries = []; window.TelegramWidget = { request: async value => { window.queries.push(value); return { result: '' }; } }; });
      await page.setContent('<!doctype html>'+widget.html);
      await page.addStyleTag({ content: `:root{--tg-theme-bg-color:${scheme === 'dark' ? '#232627' : '#fff'};--tg-theme-text-color:${scheme === 'dark' ? '#f1f3f4' : '#171a1c'};--tg-theme-hint-color:${scheme === 'dark' ? '#9ca4aa' : '#5e6871'};--tg-theme-subtitle-text-color:${scheme === 'dark' ? '#b4bcc1' : '#59636b'};--tg-theme-secondary-bg-color:${scheme === 'dark' ? '#30363b' : '#eef1f4'};--tg-theme-section-separator-color:${scheme === 'dark' ? '#3a4146' : '#dce1e5'};--tg-theme-button-color:#3478e5;--tg-theme-button-text-color:#fff}html{background:var(--tg-theme-bg-color)}` });
      assert.equal(await page.getByRole('heading', { name: 'Пробная 1', exact: true }).count(), 1);
      assert.equal(await page.getByText('Добро пожаловать', { exact: false }).count(), 0);
      const size = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.body.getBoundingClientRect().height }));
      assert.ok(size.width <= 320, JSON.stringify(size)); assert.ok(size.height < 560, JSON.stringify(size));
      if (output) await page.screenshot({ path: `${output}/widget-account-${scheme}.png`, clip: { x: 0, y: 0, width: 320, height: Math.ceil(size.height) } });
      await page.getByRole('button', { name: 'Продлить подписку', exact: true }).click();
      assert.equal(widget.actions.get(await page.evaluate(() => window.queries[0])), 'action:1');
      await page.locator('#next').click(); await page.getByRole('button', { name: 'Помощь', exact: true }).click();
      assert.equal(widget.actions.get(await page.evaluate(() => window.queries[1])), 'action:6');
      assert.deepEqual(errors, []); await page.close();
    });
  }
} finally { await browser.close(); }
