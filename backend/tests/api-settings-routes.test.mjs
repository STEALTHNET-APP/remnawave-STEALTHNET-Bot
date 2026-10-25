import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { test } from 'node:test';

const source = path => ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const evaluate = (code, globals) => vm.runInNewContext(ts.transpileModule('(' + code + ')', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, globals);
const routes = source('../src/modules/admin/admin.routes.ts');
function callback(path) {
  let result;
  function visit(node) {
    if (ts.isCallExpression(node) && node.arguments[0]?.text === path && node.expression.getText(routes) === 'adminRouter.post') result = node.arguments[1].arguments[0].getText(routes);
    ts.forEachChild(node, visit);
  }
  visit(routes);
  return result;
}

test('reset endpoints return no credentials and never change subscription mappings', async () => {
  for (const path of ['/remna/reset-config', '/bot/reset-token']) {
    let deleted;
    let result;
    const handler = evaluate(callback(path), {
      prisma: { systemSetting: { deleteMany: async args => { deleted = args.where; } } },
      invalidateSystemConfigCache() {}, getSystemConfig: async () => ({ telegramBotToken: 'private-token', smtpPassword: 'private-password' }),
    });
    await handler({}, { json: body => { result = body; } });
    assert.ok(deleted);
    assert.equal(JSON.stringify(result), '{"ok":true}');
  }
  assert.equal(callback('/remna/reset-uuids-and-sync'), undefined);
});

test('API credential endpoints use settings permissions, not dashboard permissions', () => {
  const tree = source('../src/modules/auth/middleware.ts');
  const node = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'getSectionFromPath');
  const section = evaluate(node.getText(tree), {});
  for (const path of ['remna/reset-config', 'remna/test-connection', 'bot/reset-token', 'bot/test-token']) assert.equal(section(path), 'settings');
  assert.equal(section('remna/nodes'), 'remna-nodes');
});
