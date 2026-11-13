import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';

const source = readFileSync(new URL('../src/modules/admin/admin.routes.ts', import.meta.url), 'utf8');
const tree = ts.createSourceFile('admin.routes.ts', source, ts.ScriptTarget.Latest, true);
let callback;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(tree) === 'adminRouter.post' && node.arguments[0]?.text === '/settings/groq-models') {
    callback = node.arguments[1].arguments[0].getText(tree);
  }
  ts.forEachChild(node, visit);
}
visit(tree);
assert.ok(callback, 'Groq models endpoint must be registered');
const compiled = ts.transpileModule(`(${callback})`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

async function request({ body = {}, savedKey = 'saved-secret', fetch = async () => Response.json({ data: [] }), proxyError } = {}) {
  const controller = new AbortController();
  let timeout, calls = 0, input;
  const handler = vm.runInNewContext(compiled, {
    AbortSignal: { timeout: ms => { timeout = ms; return controller.signal; } },
    getSystemConfig: async () => ({ groqApiKey: savedKey }),
    require: name => {
      if (name === '../proxy-util/get-proxy-url.js') return { getProxyUrl: async target => { assert.equal(target, 'ai'); if (proxyError) throw proxyError; return 'http://fixture-proxy'; } };
      if (name === '../proxy-util/proxy-fetch.js') return { proxyFetch: async (url, init, proxy) => {
        calls++; input = { url, init, proxy }; return fetch({ url, init, proxy, abort: () => controller.abort() });
      } };
      throw Error(`Unexpected import ${name}`);
    },
  });
  const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.body = JSON.parse(JSON.stringify(data)); return this; } };
  await handler({ body }, response);
  return { ...response, timeout, calls, input };
}

test('uses typed or saved credentials, forwards a ten-second signal, filters and sorts model IDs', async () => {
  const response = await request({ body: { apiKey: '  typed-secret  ' }, fetch: async () => Response.json({ data: [
    { id: 'z-model', active: true }, null, false, {}, [], { id: 42 }, { id: '' }, { id: ' ' }, { id: 'x'.repeat(201) },
    { id: 'disabled', active: false }, { id: 'whisper-large-v3' }, { id: 'a-model' }, { id: 'z-model' },
  ] }) });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { models: ['a-model', 'z-model'] });
  assert.equal(response.timeout, 10_000);
  assert.equal(response.input.init.signal.aborted, false);
  assert.equal(response.input.init.headers.Authorization, 'Bearer typed-secret');
  assert.equal(response.input.proxy, 'http://fixture-proxy');
  assert.equal(response.input.url, 'https://api.groq.com/openai/v1/models');
  assert.equal((await request()).input.init.headers.Authorization, 'Bearer saved-secret');
});

test('missing key is rejected before contacting the provider', async () => {
  const response = await request({ body: { apiKey: 123 }, savedKey: '' });
  assert.equal(response.statusCode, 400); assert.equal(response.calls, 0);
});

test('malformed provider payloads are handled without raw body leakage', async () => {
  for (const value of [null, [], {}, { data: {} }, { data: 'saved-secret' }]) {
    const response = await request({ fetch: async () => Response.json(value) });
    assert.equal(response.statusCode, 502); assert.doesNotMatch(JSON.stringify(response.body), /secret/);
  }
  const response = await request({ fetch: async () => new Response('private saved-secret') });
  assert.equal(response.statusCode, 502); assert.doesNotMatch(JSON.stringify(response.body), /private|secret/);
});

test('provider, network and proxy failures expose only safe messages', async () => {
  for (const status of [401, 403, 429, 500, 503]) {
    const response = await request({ fetch: async () => new Response('private saved-secret', { status }) });
    assert.equal(response.statusCode, 502); assert.doesNotMatch(JSON.stringify(response.body), /private|secret/);
  }
  for (const fixture of [
    { fetch: async () => { throw new Error('proxy password saved-secret'); } },
    { proxyError: new Error('private proxy password saved-secret') },
  ]) {
    const response = await request(fixture);
    assert.equal(response.statusCode, 502); assert.doesNotMatch(JSON.stringify(response.body), /private|password|secret/);
  }
});

test('aborted requests and body reads return a timeout message', async () => {
  for (const fetch of [
    async ({ abort, init }) => { abort(); throw init.signal.reason; },
    async ({ abort, init }) => ({ ok: true, json: async () => { abort(); throw init.signal.reason; } }),
  ]) {
    const response = await request({ fetch });
    assert.equal(response.statusCode, 504); assert.match(response.body.message, /10 секунд/);
  }
});

test('admin authentication and section authorization precede the model endpoint', () => {
  const routeIndex = source.indexOf('adminRouter.post("/settings/groq-models"');
  for (const middleware of ['requireAuth', 'requireAdminSection']) {
    const index = source.indexOf(`adminRouter.use(${middleware})`);
    assert.ok(index >= 0 && index < routeIndex);
  }
});
