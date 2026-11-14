import test from 'node:test';
import assert from 'node:assert/strict';
import { syncFailureSummary } from './sync-diagnostics.js';
test('sync failure retains count and bounded useful details', () => {
  const result = syncFailureSummary('Импорт клиентов', Array(16).fill('Remna: HTTP 401'));
  assert.equal(result.errorCount, 16);
  assert.equal(result.errors.length, 5);
  assert.match(result.message, /401/);
});
test('sync failure does not publish database queries or credentials', () => {
  const result = syncFailureSummary('Импорт', ['Unique constraint failed on email for private@example.com', 'https://example.com?token=abc Bearer secret password=abc']);
  assert.match(result.errors[0], /P2002/);
  assert.doesNotMatch(result.message, /private@example|Bearer secret|password=abc|token=abc/);
});
