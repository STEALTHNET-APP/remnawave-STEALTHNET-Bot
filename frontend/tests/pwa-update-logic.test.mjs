import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
const bundle = await build({ entryPoints: [new URL('../src/components/pwa/pwa-apply-update.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm' });
const { applyWorkerUpdate } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));

test('a hanging worker promise cannot leave the button spinning forever', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let reloads = 0;
  const pending = applyWorkerUpdate(() => new Promise(() => {}), undefined, undefined, () => reloads++);
  t.mock.timers.tick(1500);
  await pending;
  assert.equal(reloads, 1);
});

test('fallback reload fires after 1500ms even when controllerchange is not dispatched in webviews', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let reloads = 0;
  const registration = { waiting: { state: 'installed', postMessage() {} } };
  const pending = applyWorkerUpdate(async () => {}, registration, new EventTarget(), () => reloads++);
  t.mock.timers.tick(1500);
  await pending;
  assert.equal(reloads, 1);
});

test('activation reloads exactly once and clears pending timers', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let reloads = 0;
  const worker = new EventTarget();
  const pending = applyWorkerUpdate(async () => {}, { waiting: { state: 'installed', postMessage() {} } }, worker, () => reloads++);
  worker.dispatchEvent(new Event('controllerchange'));
  await pending;
  worker.dispatchEvent(new Event('controllerchange'));
  t.mock.timers.tick(10000);
  assert.equal(reloads, 1);
});

test('a rejected update clears the fallback and does not reload', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let reloads = 0;
  await assert.rejects(applyWorkerUpdate(async () => { throw Error('offline'); }, undefined, undefined, () => reloads++), /offline/);
  t.mock.timers.tick(10000);
  assert.equal(reloads, 0);
});
