import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextRouletteSpinAt } from '../dist/modules/roulette/roulette-cooldown.js';

for (const [name, last, zone, expected] of [
  ['UTC midnight', '2026-10-25T23:59:59Z', 'UTC', '2026-10-26T00:00:00Z'],
  ['Moscow midnight', '2026-10-25T20:00:00Z', 'Europe/Moscow', '2026-10-25T21:00:00Z'],
  ['year boundary', '2026-12-31T23:59:59Z', 'UTC', '2027-01-01T00:00:00Z'],
  ['leap day', '2028-02-28T23:00:00Z', 'UTC', '2028-02-29T00:00:00Z'],
  ['DST spring 23 hours', '2026-03-28T23:00:00Z', 'Europe/Berlin', '2026-03-29T22:00:00Z'],
  ['DST autumn 25 hours', '2026-10-24T22:00:00Z', 'Europe/Berlin', '2026-10-25T23:00:00Z'],
  ['half-hour timezone', '2026-10-25T18:00:00Z', 'Asia/Kolkata', '2026-10-25T18:30:00Z'],
]) test(name, () => {
  assert.equal(nextRouletteSpinAt(new Date(last), { cooldownHours: 24, resetMode: 'daily', timeZone: zone }), Date.parse(expected));
});
test('existing hour-based and pending reward plans retain their cooldown', () => {
  const last = new Date('2026-10-25T23:00:00Z');
  assert.equal(nextRouletteSpinAt(last, { cooldownHours: 24 }), Date.parse('2026-10-26T23:00:00Z'));
});
test('daily mode without an explicit timezone defaults to Moscow', () => {
  // 23:00 МСК 25 октября → ближайшая полночь по Москве наступает через час.
  const last = new Date('2026-10-25T20:00:00Z');
  assert.equal(nextRouletteSpinAt(last, { cooldownHours: 24, resetMode: 'daily' }), Date.parse('2026-10-25T21:00:00Z'));
});
