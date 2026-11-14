import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
const result = await build({ entryPoints: [new URL('../src/lib/cache-housekeeper.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm' });
const { cacheHousekeeper } = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
const storage = entries => { const values = new Map(entries); return { get length() { return values.size; }, key: i => [...values.keys()][i] ?? null, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }; };
test('cleanup preserves OAuth nonces and unrelated caches; only explicit expired data is removed', async () => {
 const now = Date.now(); let deleted = 0;
 globalThis.localStorage = storage([['oauth_nonce', 'plain-active-nonce'], ['oauth_state', JSON.stringify({ exp: Math.floor(now / 1000) + 600 })], ['stealthnet_temp_old', JSON.stringify({ expiresAt: now - 1 })], ['stealthnet_temp_unknown', 'opaque'], ['client_token', 'token']]);
 globalThis.sessionStorage = storage([['stealthnet_oauth_expired', JSON.stringify({ exp: Math.floor(now / 1000) - 10 })]]);
 globalThis.window = { caches: { keys: async () => ['other-app', 'workbox-precache-v2-other'], delete: async () => { deleted++; } } };
 await cacheHousekeeper(now);
 assert.equal(deleted, 0); assert.equal(localStorage.getItem('oauth_nonce'), 'plain-active-nonce');
 assert.notEqual(localStorage.getItem('oauth_state'), null); assert.equal(localStorage.getItem('stealthnet_temp_old'), null);
 assert.equal(localStorage.getItem('stealthnet_temp_unknown'), 'opaque'); assert.equal(localStorage.getItem('client_token'), 'token');
 assert.equal(sessionStorage.getItem('stealthnet_oauth_expired'), null);
});
