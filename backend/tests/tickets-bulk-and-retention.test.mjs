import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateRetentionCutoff } from '../dist/modules/ticket/ticket-retention.js';
test('closed ticket retention is disabled at zero and supports all configured units', () => {
  const now = new Date('2026-10-27T12:00:00Z');
  for (const value of [0, -1, NaN, Infinity]) assert.equal(calculateRetentionCutoff(value, 'days', now), null);
  for (const [unit, ms] of [['minutes', 60000], ['hours', 3600000], ['days', 86400000]]) {
    assert.equal(calculateRetentionCutoff(2, unit, now).getTime(), now.getTime() - 2 * ms);
  }
});
