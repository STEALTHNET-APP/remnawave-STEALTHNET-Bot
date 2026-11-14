import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { compactBotMenu } from '../src/lib/bot-menu-preset.ts';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
function initialTheme(pathname, saved) {
  let mode;
  const root = { style: {}, classList: { remove() {}, add(value) { mode = value; } } };
  runInNewContext(script, {
    window: { location: { pathname }, matchMedia: () => ({ matches: true }) },
    localStorage: { getItem: key => saved[key] ? JSON.stringify(saved[key]) : null },
    document: { documentElement: root, querySelector: () => null },
  });
  return mode;
}
test('first paint respects the admin lock on client appearance', () => {
  const saved = {
    'stealthnet-server-theme': { mode: 'dark', allowUserThemeChange: false },
    'stealthnet-client-theme': { mode: 'light' },
    'stealthnet-admin-theme': { mode: 'light' },
  };
  assert.equal(initialTheme('/cabinet', saved), 'dark');
  assert.equal(initialTheme('/admin/settings', saved), 'light');
  saved['stealthnet-server-theme'].allowUserThemeChange = true;
  assert.equal(initialTheme('/cabinet', saved), 'light');
  assert.equal(initialTheme('/cabinet', {}), 'dark');
});
test('compact preset keeps custom links and disabled optional buttons unchanged', () => {
  const defaults = ['vpn', 'renew', 'tariffs', 'profile', 'support', 'autopay', 'gift'].map((id, order) => ({ id, order, visible: true, label: id }));
  const hidden = { ...defaults.at(-1), visible: false };
  const link = { id: 'custom_channel', url: 'https://t.me/example', label: 'Channel', visible: true, order: 20 };
  const settings = { botButtons: [...defaults.slice(0, -1), hidden, link], botMenuTexts: { chooseAction: 'Custom text' } };
  const original = structuredClone(settings);
  const preset = compactBotMenu(settings, defaults);
  assert.deepEqual(settings, original);
  assert.equal(preset.botButtonsPerRow, 2);
  assert.deepEqual(preset.botGroupCabinetItems, ['autopay', 'gift', 'custom_channel']);
  assert.deepEqual(preset.botButtons.find(button => button.id === link.id), link);
  assert.equal(preset.botButtons.find(button => button.id === 'gift').visible, false);
  assert.equal(preset.botMenuTexts.chooseAction, 'Custom text');
  assert.equal(preset.botMenuLineVisibility.chooseAction, false);
});
