import assert from 'node:assert/strict';
import { test } from 'node:test';
import { botButtonsJsonSchema, parseConfiguredBotButtons, isBotButtonUrl } from '../dist/modules/bot/menu-buttons.js';
import { mainMenu } from '../../bot/dist/keyboard.js';
import { isBotButtonUrl as botUrl } from '../../bot/dist/button-url.js';
import { isBotButtonUrl as frontendUrl } from '../../frontend/src/lib/bot-button-url.ts';
const defaults = [
  { id: 'tariffs', label: 'Buy', visible: true, order: 1 },
  { id: 'profile', label: 'Profile', visible: true, order: 2 },
];
const custom = { id: 'custom_test', label: 'Our channel', url: 'https://t.me/example', visible: true, order: 0, style: 'success', onePerRow: true };
const parse = data => parseConfiguredBotButtons(JSON.stringify(data), defaults);
const menu = buttons => mainMenu({ botButtons: buttons, buttonsPerRow: 2, appUrl: null, showVpn: false, showTrial: false });

test('URL validation agrees in API, bot and settings', () => {
  for (const [url, valid] of [
    ['https://t.me/example', true], ['http://example.com/path?q=a%20b', true], ['tg://resolve?domain=example', true],
    ['javascript:alert(1)', false], ['data:text/plain,hello', false], ['file:///etc/passwd', false],
    ['https://user:pass@example.com', false], ['https://example.com/with space', false], ['//example.com', false],
    ['https://', false], ['tg:', false], ['https://example.com/\npath', false], ['', false], ['https://example.com/'+'a'.repeat(1000), false],
  ]) for (const validate of [isBotButtonUrl, botUrl, frontendUrl]) assert.equal(validate(url), valid, url);
});
test('saved custom links survive parsing and become URL buttons, with built-in callbacks preserved', () => {
  const buttons = parse([{ ...defaults[0], visible: false }, { ...custom, url: ' https://t.me/example ', label: ' Our channel ' }]);
  assert.equal(buttons.find(b => b.id === 'tariffs').visible, false);
  assert.ok(buttons.some(b => b.id === 'profile'));
  const rows = menu(buttons).inline_keyboard;
  assert.deepEqual(rows[0], [{ text: 'Our channel', url: 'https://t.me/example', style: 'success' }]);
  assert.ok(rows.flat().some(b => b.callback_data === 'menu:profile'));
  assert.ok(!rows.flat().some(b => b.callback_data === 'menu:tariffs'));
});
test('order, row width, hiding and removal work without changing built-in actions', () => {
  const two = { ...custom, id: 'custom_two', label: 'Second', order: -1, onePerRow: false };
  const rows = menu(parse([{ ...custom, onePerRow: false }, two])).inline_keyboard;
  assert.equal(rows[0][0].text, 'Second');
  assert.equal(rows[0][1].text, 'Our channel');
  assert.ok(!menu(parse([{ ...custom, visible: false }])).inline_keyboard.flat().some(b => b.url === custom.url));
  assert.ok(!menu(parse([])).inline_keyboard.flat().some(b => b.url === custom.url));
});
test('invalid payloads, duplicate IDs, empty labels and built-in URL overrides are rejected', () => {
  for (const raw of ['{', '{}', '[null]', JSON.stringify([custom, custom]), JSON.stringify([{...custom, label: ' '}]), JSON.stringify([{...custom, label: 'a'.repeat(65)}]), JSON.stringify([{...custom, url: 'javascript:alert(1)'}]), JSON.stringify([{...defaults[0], url: custom.url}]), JSON.stringify([{...custom, order: 'bad'}])]) assert.equal(botButtonsJsonSchema.safeParse(raw).success, false, raw);
  assert.equal(botButtonsJsonSchema.safeParse('').success, true);
  assert.equal(botButtonsJsonSchema.safeParse(JSON.stringify(defaults)).success, true);
});
test('supports 20 custom links; rejects more without silently truncating', () => {
  const list = Array.from({length:20}, (_,i) => ({...custom, id:'custom_'+i}));
  assert.equal(botButtonsJsonSchema.safeParse(JSON.stringify(list)).success, true);
  assert.equal(parse(list).filter(b => b.id.startsWith('custom_')).length, 20);
  assert.equal(botButtonsJsonSchema.safeParse(JSON.stringify([...list,{...custom,id:'custom_21'}])).success, false);
});
test('broken stored links are skipped; legacy/default menus still render', () => {
  assert.deepEqual(parseConfiguredBotButtons('broken', defaults), defaults);
  const buttons = parse([null, { ...custom, url: 'file:///tmp/bad' }, defaults[0]]);
  assert.ok(!buttons.some(b => b.id === custom.id));
  assert.ok(menu(buttons).inline_keyboard.flat().some(b => b.callback_data === 'menu:tariffs'));
  assert.ok(!menu([{...custom,url:'javascript:alert(1)'}]).inline_keyboard.flat().some(b => b.text === custom.label));
  assert.ok(!menu([{...defaults[0],url:custom.url}]).inline_keyboard.flat().some(b => b.url === custom.url));
});
