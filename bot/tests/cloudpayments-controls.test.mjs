import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommandSync, defaultBotCommands } from '../dist/bot-commands.js';
import { mainMenu } from '../dist/keyboard.js';
test('command menu supports hidden commands, order and descriptions, avoids unchanged writes and retries failures', async () => {
  const calls = []; let fail = false;
  const sync = createCommandSync(async (commands, scope) => { if (fail) throw Error('offline'); calls.push({ commands, scope }); });
  const config = [{ command: 'support', description: 'Помощь', visible: false }, { command: 'autopay', description: 'Мои списания', visible: true }];
  await sync(config); assert.equal(calls.length, 6); assert.deepEqual(calls[0].commands, [{ command: 'autopay', description: 'Мои списания' }]);
  await sync(config); assert.equal(calls.length, 6);
  fail = true; await assert.rejects(sync([])); fail = false;
  await sync([]); assert.equal(calls.length, 12); assert.deepEqual(calls.at(-1).commands, []);
  await sync(defaultBotCommands); assert.equal(calls.length, 18);
});
test('paid trial respects visibility, label, position, grouping and eligibility', () => {
  const opts = { showTrial: false, showVpn: false, paidTrial: { days: 3, amount: 1 }, botButtons: [{ id: 'cloudtrial', visible: true, label: 'Тест {days} / {amount}', order: -2 }, { id: 'autopay', visible: false, label: 'Списания', order: 0 }] };
  const buttons = o => mainMenu(o).inline_keyboard.flat();
  assert.equal(buttons(opts)[0].text, 'Тест 3 / 1');
  assert(!buttons(opts).some(b => b.callback_data === 'menu:autopay'));
  assert(!buttons({ ...opts, paidTrial: null }).some(b => b.callback_data === 'menu:cloudtrial'));
  assert(!buttons({ ...opts, botButtons: opts.botButtons.map(b => ({ ...b, visible: false })) }).some(b => b.callback_data === 'menu:cloudtrial'));
  assert(!buttons({ ...opts, groupCabinet: true }).some(b => b.callback_data === 'menu:cloudtrial'));
  assert(buttons({ ...opts, groupCabinet: true, section: 'profile' }).some(b => b.callback_data === 'menu:cloudtrial'));
});
