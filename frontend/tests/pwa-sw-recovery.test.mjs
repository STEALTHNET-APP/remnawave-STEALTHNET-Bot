import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
const bundle = await build({ entryPoints: [new URL('../src/lib/sw-recovery.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm' });
const { forceApplicationReload, hardResetApplication, recoverFromStaleBundle, resetRetryWindow } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));

function memoryStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

function cacheStore(deleted) {
  return { keys: async () => ['workbox-precache-v2', 'images-v2'], delete: async key => { deleted.push(key); return true; } };
}

test('a waiting worker is activated instead of unregistering everything', async () => {
  globalThis.window = { location: { pathname: '/cabinet' } };
  globalThis.sessionStorage = memoryStorage();
  const posts = [];
  const bus = new EventTarget();
  const registration = {
    waiting: { state: 'installed', postMessage: message => posts.push(message) },
    update: async () => {},
    addEventListener: (type, handler) => bus.addEventListener(type, handler),
    removeEventListener: (type, handler) => bus.removeEventListener(type, handler),
  };
  const deleted = [];
  const reloads = [];
  const pending = recoverFromStaleBundle({
    force: true,
    container: {
      getRegistration: async () => registration,
      addEventListener: (type, handler, options) => bus.addEventListener(type, handler, options),
      removeEventListener: (type, handler) => bus.removeEventListener(type, handler),
    },
    cacheStorage: cacheStore(deleted),
    reload: () => reloads.push(1),
  });
  await new Promise(resolve => setImmediate(resolve));
  bus.dispatchEvent(new Event('controllerchange'));
  assert.equal(await pending, true);
  assert.deepEqual(posts, [{ type: 'SKIP_WAITING' }]);
  assert.equal(reloads.length, 1);
  assert.deepEqual(deleted, []);
});

test('an up-to-date service worker only reloads the page without clearing caches', async () => {
  globalThis.window = { location: { pathname: '/cabinet' } };
  globalThis.sessionStorage = memoryStorage();
  const deleted = [];
  const reloads = [];
  const result = await recoverFromStaleBundle({
    force: true,
    container: {
      getRegistration: async () => ({ update: async () => {}, waiting: null, installing: null }),
      getRegistrations: async () => { throw new Error('should not unregister a working worker'); },
    },
    cacheStorage: cacheStore(deleted),
    reload: () => reloads.push(1),
  });
  assert.equal(result, true);
  assert.deepEqual(deleted, []);
  assert.equal(reloads.length, 1);
});

test('a failed update check does not reload or clear anything', async () => {
  globalThis.window = { location: { pathname: '/cabinet' } };
  globalThis.sessionStorage = memoryStorage();
  const deleted = [];
  const reloads = [];
  const result = await recoverFromStaleBundle({
    force: true,
    container: {
      getRegistration: async () => ({ update: async () => { throw new Error('offline'); }, waiting: null, installing: null }),
      getRegistrations: async () => [],
    },
    cacheStorage: cacheStore(deleted),
    reload: () => reloads.push(1),
  });
  assert.equal(result, false);
  assert.deepEqual(deleted, []);
  assert.equal(reloads.length, 0);
});

test('a worker that is still installing triggers the hard reset', async () => {
  globalThis.window = { location: { pathname: '/cabinet' } };
  globalThis.sessionStorage = memoryStorage();
  const unregistered = [];
  const deleted = [];
  const reloads = [];
  const result = await recoverFromStaleBundle({
    force: true,
    container: {
      getRegistration: async () => ({ update: async () => {}, waiting: null, installing: { state: 'installing' } }),
      getRegistrations: async () => [{ unregister: async () => { unregistered.push(1); return true; } }],
    },
    cacheStorage: cacheStore(deleted),
    reload: () => reloads.push(1),
  });
  assert.equal(result, true);
  assert.deepEqual(unregistered, [1]);
  assert.deepEqual(deleted, ['workbox-precache-v2', 'images-v2']);
  assert.equal(reloads.length, 1);
});

test('without a service worker the page still gets a clean reload', async () => {
  globalThis.window = { location: { pathname: '/cabinet' } };
  globalThis.sessionStorage = memoryStorage();
  const deleted = [];
  const reloads = [];
  const result = await recoverFromStaleBundle({
    force: true,
    container: { getRegistration: async () => undefined, getRegistrations: async () => [] },
    cacheStorage: cacheStore(deleted),
    reload: () => reloads.push(1),
  });
  assert.equal(result, true);
  assert.deepEqual(deleted, ['workbox-precache-v2', 'images-v2']);
  assert.equal(reloads.length, 1);
});

test('payment pages are never reloaded automatically', async () => {
  globalThis.window = { location: { pathname: '/cabinet/payment-wait', search: '?payment=1' } };
  globalThis.sessionStorage = memoryStorage();
  const reloads = [];
  const result = await recoverFromStaleBundle({
    container: { getRegistration: async () => { throw new Error('should not touch the worker'); } },
    cacheStorage: { keys: async () => { throw new Error('should not clear caches'); }, delete: async () => true },
    reload: () => reloads.push(1),
  });
  assert.equal(result, false);
  assert.equal(reloads.length, 0);
});

test('a second chunk failure within the retry window does not loop', async () => {
  globalThis.window = { location: { pathname: '/cabinet' } };
  globalThis.sessionStorage = memoryStorage();
  const reloads = [];
  const options = {
    now: 1_000_000,
    container: { getRegistration: async () => undefined, getRegistrations: async () => [] },
    cacheStorage: { keys: async () => [], delete: async () => true },
    reload: () => reloads.push(1),
  };
  assert.equal(await recoverFromStaleBundle(options), true);
  assert.equal(await recoverFromStaleBundle({ ...options, now: 1_030_000 }), false);
  assert.equal(reloads.length, 1);
  resetRetryWindow();
  assert.equal(await recoverFromStaleBundle({ ...options, now: 1_060_000 }), true);
});

test('manual reset clears the retry window before reloading', async () => {
  globalThis.window = { location: { pathname: '/cabinet' } };
  globalThis.sessionStorage = memoryStorage();
  sessionStorage.setItem('chunk_retry_timestamp', '1');
  const reloads = [];
  await forceApplicationReload({
    container: { getRegistrations: async () => [] },
    cacheStorage: { keys: async () => [], delete: async () => true },
    reload: () => reloads.push(1),
  });
  assert.equal(sessionStorage.getItem('chunk_retry_timestamp'), null);
  assert.equal(reloads.length, 1);
});

test('hard reset survives a missing service worker container and cache storage', async () => {
  const reloads = [];
  await hardResetApplication({ container: undefined, cacheStorage: undefined, reload: () => reloads.push(1) });
  assert.equal(reloads.length, 1);
});
