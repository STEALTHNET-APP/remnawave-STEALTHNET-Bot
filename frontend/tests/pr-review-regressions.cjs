const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, modules) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports, URL, Date, console, require: name => modules[name] || {}, window: {} });
  return exports;
}
function createHarness() {
  const slots = [];
  let cursor = 0, dirty = true, effects = [], render, result;
  const equal = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(init) {
      const i = cursor++;
      if (!slots[i]) slots[i] = { value: typeof init === 'function' ? init() : init };
      return [slots[i].value, value => { const next = typeof value === 'function' ? value(slots[i].value) : value; if (!Object.is(next, slots[i].value)) { slots[i].value = next; dirty = true; } }];
    },
    useRef(value) { const i = cursor++; return slots[i] ||= { current: value }; },
    useMemo(fn, deps) { const i = cursor++; if (!slots[i] || !equal(slots[i].deps, deps)) slots[i] = { value: fn(), deps }; return slots[i].value; },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || !equal(slots[i].deps, deps)) { const cleanup = slots[i]?.cleanup; slots[i] = { deps }; effects.push(() => { cleanup?.(); slots[i].cleanup = fn(); }); } },
  };
  return { react, async run(fn) { render = fn || render; dirty = true; for (let i = 0; i < 20; i++) { if (dirty) { dirty = false; cursor = 0; result = render(); } const pending = effects; effects = []; pending.forEach(fn => fn()); await new Promise(resolve => setImmediate(resolve)); if (!dirty && effects.length === 0) return result; } throw new Error('Hook did not settle'); } };
}
(async () => {
  const landing = load('src/components/landing-studio/landing-surface.tsx', {});
  for (const href of ['/cabinet/login', '/cabinet/register?ref=hello']) assert.equal(landing.isCabinetAuthLink(href), true);
  for (const href of ['https://merchant.example/offer', 'https://merchant.example/cabinet/login', '/cabinet/tariffs', '#support', '//other.example/cabinet/login']) assert.equal(landing.isCabinetAuthLink(href), false);
  const cabinetReturn = load('src/lib/client-menu-return.ts', {}).clientMenuReturnTo;
  for (const href of ['/cabinet/login', '/cabinet/register', '/cabinet/forgot-password', '//other.example', 'javascript:alert(1)']) assert.equal(cabinetReturn(href), '/cabinet/dashboard');
  assert.equal(cabinetReturn('/cabinet/tariffs?extend=trial#plans'), '/cabinet/tariffs?extend=trial#plans');
  const h = createHarness();
  let params = new URLSearchParams('extend=trial');
  const tariffs = [{ id: 'wrong', price: 100, priceOptions: [{ id: 'wrong-30', price: 100, durationDays: 30 }] }, { id: 'approved', price: 200, priceOptions: [{ id: 'approved-30', price: 200, durationDays: 30 }] }];
  const subs = [{ id: 'trial', trialId: 'trial-plan', tariffId: null, convertTariffIds: ['approved'], subscriptionIndex: 0, extraDevices: 2 }, { id: 'paid', tariffId: 'approved', subscriptionIndex: 1, extraDevices: 3 }];
  const query = { data: { items: [{ id: 'category', tariffs }] }, refetch: async () => {} };
  const state = { token: 'test', client: { balance: 1000 } };
  const refreshProfile = async () => {};
  const api = { clientAllSubscriptions: async () => ({ items: subs }), clientTariffConversionPreview: async () => ({ willConvert: false }) };
  const hook = load('src/pages/cabinet/use-cabinet-tariff-purchase.ts', {
    react: h.react,
    'react-router-dom': { useLocation: () => ({ state: null }), useNavigate: () => () => {}, useSearchParams: () => [params] },
    '@/contexts/client-auth': { useClientAuth: () => ({ state, refreshProfile }) },
    '@/lib/queries': { usePublicTariffs: () => query, useAvailableTrials: () => ({ data: { items: [] } }) },
    '@/lib/public-config': { usePublicConfig: () => null },
    '@/lib/api': { api },
  }).useCabinetTariffPurchase;
  const opts = { autoSelectFirst: true, autoSelectExtended: 'tariffOnly', requirePriceOption: true };
  let view = await h.run(() => hook(opts));
  assert.equal(view.selectedCatId, 'category');
  assert.equal(view.selectedTariffId, 'approved');
  assert.equal(view.selectedPriceOptionId, 'approved-30');
  view.setExtKeepExtras(false);
  view = await h.run();
  assert.equal(view.extKeepExtras, false);
  params = new URLSearchParams('extend=paid');
  view = await h.run();
  assert.equal(view.extKeepExtras, true);
  assert.equal(view.extendTarget.id, 'paid');
  const e = createHarness();
  const jsx = (type, props) => ({ type, props });
  const editor = load('src/components/subscription-page-editor.tsx', { react: e.react, 'react/jsx-runtime': { jsx, jsxs: jsx }, '@dnd-kit/core': { useSensor: () => ({}), useSensors: () => [] } });
  const custom = { name: 'Happ', featured: false, blocks: [{ title: { ru: 'Моя инструкция' }, buttons: [{ link: 'https://custom.example/app' }] }] };
  const saved = JSON.stringify({ customMetadata: 'keep-me', platforms: { ios: { apps: [custom], customPlatformSetting: 'keep-platform' } } });
  const defaults = { platforms: { ios: { apps: [{ name: 'Happ', featured: true }, { name: 'New app' }] } } };
  let submitted;
  let props = { currentConfigJson: saved, defaultConfig: defaults, saving: false, onSave: value => { submitted = JSON.parse(value); } };
  const previewState = tree => { if (!tree || typeof tree !== 'object') return null; if (tree.type?.name === 'SubscriptionPagePreviewDialog') return tree.props.editorState; for (const child of [tree.props?.children].flat(Infinity)) { const found = previewState(child); if (found) return found; } return null; };
  let tree = await e.run(() => editor.SubscriptionPageEditor(props));
  let apps = previewState(tree).ios.apps;
  assert.equal(apps.length, 1, 'opening editor must not re-enable absent apps');
  assert.equal(apps[0].app.blocks[0].buttons[0].link, 'https://custom.example/app');
  assert.equal(apps[0].app.featured, false);
  props = { ...props, defaultConfig: { platforms: { ios: { apps: [{ name: 'Happ', featured: true }] } } } };
  tree = await e.run();
  assert.equal(previewState(tree).ios.apps[0].app.blocks[0].title.ru, 'Моя инструкция');
  function findSave(tree) {
    if (!tree || typeof tree !== 'object') return null;
    if (tree.props?.children === 'Сохранить') return tree.props.onClick;
    for (const child of [tree.props?.children].flat(Infinity)) { const found = findSave(child); if (found) return found; }
    return null;
  }
  findSave(tree)();
  assert.equal(submitted.customMetadata, 'keep-me');
  assert.equal(submitted.platforms.ios.customPlatformSetting, 'keep-platform');
  assert.equal(submitted.platforms.ios.apps[0].blocks[0].buttons[0].link, 'https://custom.example/app');
  const onlyMissing = editor.mergeWithDefault(editor.parseConfigJson(saved), defaults, true);
  assert.equal(onlyMissing.ios.apps[0].app.blocks[0].buttons[0].link, 'https://custom.example/app');
  assert.equal(onlyMissing.ios.apps[1].app.name, 'New app');
  const explicitReload = editor.mergeWithDefault(editor.parseConfigJson(saved), defaults, false);
  assert.equal(explicitReload.ios.apps[0].app.featured, true, 'explicit default reload can update bundled apps');
  console.log('PASS: PR review regressions — renewal selection/extras, custom subscription apps, landing links, safe return paths');
})().catch(error => { console.error(error); process.exitCode = 1; });
