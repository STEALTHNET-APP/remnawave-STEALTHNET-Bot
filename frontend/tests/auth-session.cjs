const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');

function load(file, globals) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText, { exports, ...globals });
  return exports;
}

const token = 'header.' + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url') + '.signature';
const client = { id: 'qa-client', email: 'qa@example.invalid' };
const apiModule = load('src/lib/api.ts', {
  Headers, FormData,
  fetch: async () => new Response('<html>Unauthorized</html>', { status: 401, statusText: 'Unauthorized' }),
});

function harness(saved, request) {
  const storage = new Map(Object.entries(saved));
  let current;
  const react = {
    createContext: () => ({ Provider: {} }),
    createElement: (_type, props) => props.value,
    useState: init => {
      current = typeof init === 'function' ? init() : init;
      return [current, update => { current = typeof update === 'function' ? update(current) : update; }];
    },
    useCallback: fn => fn,
    useEffect: () => {},
    useRef: value => ({ current: value }),
  };
  const context = load('src/contexts/client-auth.tsx', {
    require: name => name === 'react' ? react : { ...apiModule, api: { clientMe: request } },
    atob,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
  });
  const value = context.ClientAuthProvider({ children: null });
  return { value, storage, state: () => current };
}

const saved = { stealthnet_client_token: token, stealthnet_client_profile: JSON.stringify(client) };

(async () => {
  await assert.rejects(apiModule.api.clientMe(token), error => error instanceof apiModule.ApiError && error.status === 401);
  for (const error of [new TypeError('Failed to fetch'), new apiModule.ApiError('Unavailable', 503), new apiModule.ApiError('Too many requests', 429)]) {
    const h = harness(saved, async () => { throw error; });
    await h.value.refreshProfile();
    assert.equal(h.state().token, token);
    assert.equal(h.storage.get('stealthnet_client_token'), token);
  }
  for (const status of [401, 403]) {
    const h = harness(saved, async () => { throw new apiModule.ApiError('Unauthorized', status); });
    await h.value.refreshProfile();
    assert.equal(h.state().token, null);
    assert.equal(h.storage.has('stealthnet_client_token'), false);
  }
  for (const raw of ['{broken', '42', '{"id":42}']) {
    const h = harness({ ...saved, stealthnet_client_profile: raw }, async () => client);
    assert.equal(h.state().token, null);
    assert.equal(h.storage.has('stealthnet_client_profile'), false);
  }
  let resolve;
  const h = harness(saved, () => new Promise(done => { resolve = done; }));
  const pending = h.value.refreshProfile();
  h.value.logout();
  resolve(client);
  await pending;
  assert.equal(h.state().client, null);
  assert.equal(h.storage.has('stealthnet_client_profile'), false);
  console.log('PASS: temporary failures preserve login; 401/403 revoke it; corrupted storage and late responses are handled');
})().catch(error => { console.error(error); process.exitCode = 1; });
