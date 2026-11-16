import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';

const routeSource = readFileSync(new URL('../src/modules/admin/admin.routes.ts', import.meta.url), 'utf8');
const serviceSource = readFileSync(new URL('../src/modules/ai/ai-provider.service.ts', import.meta.url), 'utf8');

const plain = value => JSON.parse(JSON.stringify(value));

const compiled = ts.transpileModule(serviceSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function loadService({ fetch = async () => Response.json({ data: [] }) } = {}) {
  const calls = [];
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    console,
    Response,
    AbortSignal,
    AbortController,
    setTimeout,
    clearTimeout,
    require: name => {
      if (name === '../proxy-util/proxy-fetch.js') {
        return {
          proxyFetch: async (url, init, proxy) => {
            calls.push({ url: String(url), init, proxy });
            return fetch({ url: String(url), init, proxy });
          },
        };
      }
      throw Error(`Unexpected import ${name}`);
    },
  });
  return { service: module.exports, calls };
}

test('legacy Groq settings keep working until an explicit provider is chosen', () => {
  const { service } = loadService();
  const resolved = service.resolveAiConfig({
    groqApiKey: '  legacy-key  ',
    groqModel: 'llama-3.1-8b-instant',
    groqFallback1: 'openai/gpt-oss-20b',
  });
  assert.equal(resolved.provider, 'groq');
  assert.equal(resolved.apiKey, 'legacy-key');
  assert.equal(resolved.baseUrl, 'https://api.groq.com/openai/v1');
  assert.equal(resolved.model, 'llama-3.1-8b-instant');
  assert.deepEqual(plain(resolved.fallbackModels), ['openai/gpt-oss-20b']);
});

test('explicit provider overrides legacy settings and resolves defaults', () => {
  const { service } = loadService();
  const defaults = service.resolveAiConfig({});
  assert.equal(defaults.provider, 'gemini');
  assert.equal(defaults.model, 'gemini-2.0-flash');
  assert.equal(defaults.baseUrl, 'https://generativelanguage.googleapis.com/v1beta/openai');
  assert.equal(defaults.apiKey, '');

  const explicit = service.resolveAiConfig({
    aiProvider: 'Gemini',
    aiApiKey: ' ai-key ',
    aiModel: '',
    aiFallback1: 'gemini-2.5-flash',
    aiFallback2: '  ',
    aiFallback3: 'gemini-1.5-flash',
    groqApiKey: 'legacy-key',
    groqModel: 'llama-3.3-70b-versatile',
  });
  assert.equal(explicit.provider, 'gemini');
  assert.equal(explicit.apiKey, 'ai-key');
  assert.equal(explicit.model, 'gemini-2.0-flash');
  assert.deepEqual(plain(explicit.fallbackModels), ['gemini-2.5-flash', 'gemini-1.5-flash']);
});

test('custom provider normalizes the base URL and rejects an empty one', async () => {
  const { service, calls } = loadService({ fetch: async () => Response.json({ data: [{ id: ' llama3.3 ' }] }) });
  const resolved = service.resolveAiConfig({ aiProvider: 'custom', aiApiKey: 'local', aiBaseUrl: ' http://localhost:11434/v1/// ', aiModel: 'llama3.3' });
  assert.equal(resolved.baseUrl, 'http://localhost:11434/v1');
  assert.equal(resolved.model, 'llama3.3');

  const models = await service.fetchAiModels({ provider: 'custom', apiKey: 'local', baseUrl: resolved.baseUrl });
  assert.deepEqual(plain(models), ['llama3.3']);
  assert.equal(calls[0].url, 'http://localhost:11434/v1/models');

  await assert.rejects(
    () => service.fetchAiModels({ provider: 'custom', apiKey: 'local', baseUrl: '   ' }),
    err => err instanceof service.AiProviderError && err.status === 400,
  );
});

test('model list uses each provider endpoint, forwards the AI proxy and filters noise', async () => {
  const fixtures = [
    ['gemini', 'https://generativelanguage.googleapis.com/v1beta/openai/models'],
    ['deepseek', 'https://api.deepseek.com/models'],
    ['groq', 'https://api.groq.com/openai/v1/models'],
    ['openrouter', 'https://openrouter.ai/api/v1/models'],
    ['openai', 'https://api.openai.com/v1/models'],
  ];
  for (const [provider, expected] of fixtures) {
    const { service, calls } = loadService({ fetch: async () => Response.json({ data: [] }) });
    await service.fetchAiModels({ provider, apiKey: 'secret', aiProxy: 'http://fixture-proxy' });
    assert.equal(calls[0].url, expected);
    assert.equal(calls[0].init.headers.Authorization, 'Bearer secret');
    assert.equal(calls[0].proxy, 'http://fixture-proxy');
  }

  const { service } = loadService({
    fetch: async () => Response.json({ data: [
      { id: 'models/gemini-2.0-flash' }, { id: 'z-model', active: true }, null, false, {}, [], { id: 42 },
      { id: '' }, { id: ' ' }, { id: 'x'.repeat(201) }, { id: 'disabled', active: false },
      { id: 'whisper-large-v3' }, { id: 'gpt-4o-audio-preview' }, { id: 'text-embedding-3-small' },
      { id: 'a-model' }, { id: 'z-model' },
    ] }),
  });
  const models = await service.fetchAiModels({ provider: 'gemini', apiKey: 'secret' });
  assert.deepEqual(plain(models), ['a-model', 'gemini-2.0-flash', 'z-model']);
});

test('provider failures expose safe messages and statuses', async () => {
  const cases = [
    [401, 'ключ'],
    [403, 'ключ'],
    [429, 'запрос'],
    [500, 'недоступен'],
  ];
  for (const [status, expected] of cases) {
    const { service } = loadService({ fetch: async () => new Response('private saved-secret', { status }) });
    await assert.rejects(
      () => service.fetchAiModels({ provider: 'groq', apiKey: 'saved-secret' }),
      err => {
        assert.match(err.message, new RegExp(expected));
        assert.doesNotMatch(err.message, /secret/);
        return true;
      },
    );
  }
  for (const value of [null, [], {}, { data: {} }, { data: 'saved-secret' }]) {
    const { service } = loadService({ fetch: async () => Response.json(value) });
    await assert.rejects(
      () => service.fetchAiModels({ provider: 'groq', apiKey: 'saved-secret' }),
      err => err instanceof service.AiProviderError && !/secret/.test(err.message),
    );
  }
});

test('chat requests walk the fallback chain and report exhausted limits', async () => {
  const seen = [];
  const replies = [new Response('rate limited', { status: 429 }), new Response('overloaded', { status: 503 })];
  const { service, calls } = loadService({
    fetch: async ({ init }) => {
      seen.push(JSON.parse(init.body).model);
      const next = replies.shift();
      return next ?? Response.json({ choices: [{ message: { content: '  Привет!  ' } }] });
    },
  });

  const result = await service.sendAiChatRequest({
    provider: 'gemini',
    apiKey: 'secret',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    modelsToTry: ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-1.5-flash'],
    messages: [{ role: 'user', content: 'hi' }],
    aiProxy: 'http://fixture-proxy',
  });
  assert.deepEqual(plain(result), { reply: 'Привет!', model: 'gemini-1.5-flash' });
  assert.deepEqual(seen, ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-1.5-flash']);
  assert.equal(calls[0].url, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer secret');

  const failing = loadService({ fetch: async () => new Response('nope', { status: 429 }) });
  await assert.rejects(
    () => failing.service.sendAiChatRequest({
      provider: 'groq',
      apiKey: 'secret',
      baseUrl: 'https://api.groq.com/openai/v1',
      modelsToTry: ['llama-3.3-70b-versatile'],
      messages: [{ role: 'user', content: 'hi' }],
    }),
    err => err instanceof failing.service.AiProviderError && err.status === 429 && !/nope/.test(err.message),
  );
});

test('admin routes expose the universal endpoint and keep the Groq alias', () => {
  const universal = routeSource.indexOf('adminRouter.post("/settings/ai-models"');
  const alias = routeSource.indexOf('adminRouter.post("/settings/groq-models", createAiModelsHandler("groq"))');
  const sandbox = routeSource.indexOf('adminRouter.post("/settings/ai-test"');
  assert.ok(universal >= 0, 'Universal AI models endpoint must be registered');
  assert.ok(alias >= 0, 'Groq models alias must stay registered');
  assert.ok(sandbox >= 0, 'Admin AI test chat endpoint must be registered');
  for (const middleware of ['requireAuth', 'requireAdminSection']) {
    const index = routeSource.indexOf(`adminRouter.use(${middleware})`);
    assert.ok(index >= 0 && index < universal && index < alias && index < sandbox);
  }
});

test('admin settings mask the universal AI key and persist the new fields', () => {
  assert.match(routeSource, /aiApiKey: config\.aiApiKey \? "\*{8}" : ""/);
  for (const key of ['ai_provider', 'ai_api_key', 'ai_base_url', 'ai_model', 'ai_fallback_1', 'ai_fallback_2', 'ai_fallback_3']) {
    assert.match(routeSource, new RegExp(`"${key}"`));
  }
});
