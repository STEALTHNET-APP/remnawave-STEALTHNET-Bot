import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeTheme, readStoredTheme, resolveThemePolicy } from '../src/lib/theme-policy.ts';

test('client and gift routes ignore old personal appearance choices', () => {
  const personal = { mode: 'light', accent: 'rose' };
  for (const pathname of ['/cabinet', '/cabinet/dashboard', '/cabinet/login', '/gift/abc', '/']) {
    const policy = resolveThemePolicy(pathname, personal, { mode: 'dark', accent: 'blue' });
    assert.equal(policy.editable, false);
    assert.deepEqual(policy.config, { mode: 'dark', accent: 'blue' });
  }
});

test('admin personal appearance survives visiting the controlled cabinet', () => {
  const personal = { mode: 'light', accent: 'emerald' };
  const server = { mode: 'dark', accent: 'red' };
  assert.deepEqual(resolveThemePolicy('/admin/settings', personal, server), { editable: true, config: personal });
  assert.deepEqual(resolveThemePolicy('/cabinet/profile', personal, server).config, server);
  assert.deepEqual(resolveThemePolicy('/admin', personal, server).config, personal);
  assert.equal(resolveThemePolicy('/administrator', personal, server).editable, false);
});

test('system mode remains an admin policy rather than a stored client override', () => {
  for (const mode of ['system', 'light', 'dark']) {
    assert.equal(resolveThemePolicy('/cabinet/dashboard', { mode: 'light', accent: 'rose' }, { mode, accent: 'violet' }).config.mode, mode);
  }
});

test('invalid storage and unsupported server values fall back safely', () => {
  for (const raw of [null, '{', 'null', '[]', '42']) assert.equal(readStoredTheme(raw), null);
  assert.deepEqual(readStoredTheme('{"mode":"unknown","accent":"__proto__"}'), { mode: 'dark', accent: 'default' });
  assert.deepEqual(normalizeTheme({ mode: 'light', accent: 'not-a-palette' }), { mode: 'light', accent: 'default' });
  assert.deepEqual(resolveThemePolicy('/cabinet', { mode: 'light', accent: 'rose' }, null).config, { mode: 'dark', accent: 'default' });
});
