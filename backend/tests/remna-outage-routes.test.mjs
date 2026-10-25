import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { test } from 'node:test';
const text = readFileSync(new URL('../src/modules/client/client.routes.ts', import.meta.url), 'utf8');
const source = ts.createSourceFile('routes.ts', text, ts.ScriptTarget.Latest, true);
function load(name, globals) {
  const node = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  const compiled = ts.transpileModule('(' + node.getText(source) + ')', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return vm.runInNewContext(compiled, globals);
}
for (const [name, body, blocked] of [
  ['balance top-up', { amount: 100 }, false],
  ['proxy purchase', { proxyTariffId: 'proxy' }, false],
  ['Sing-box purchase', { singboxTariffId: 'singbox' }, false],
  ['Remna tariff', { tariffId: 'tariff' }, true],
  ['custom tariff', { customBuild: { days: 30 } }, true],
  ['Remna extra devices', { extraOption: { kind: 'devices' } }, true],
]) {
  test(name, async () => {
    let passed = false;
    let status;
    const guard = load('requireRemnaOnline', { probeRemnaHealth: async () => false });
    const paymentGuard = load('requireRemnaPaymentOnline', { requireRemnaOnline: guard });
    paymentGuard({ body }, { status: value => { status = value; return { json() {} }; } }, () => { passed = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(passed, !blocked);
    assert.equal(status, blocked ? 503 : undefined);
  });
}
