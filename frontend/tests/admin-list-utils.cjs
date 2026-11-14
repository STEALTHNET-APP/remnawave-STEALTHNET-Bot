const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/admin-list-utils.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { exports: exportsObject, URLSearchParams });
const { listPage, clientListUrl, csvCell } = exportsObject;
for (const input of [null, '', '-1', '0', '1.5', 'NaN', 'Infinity', '9007199254740992', '3abc']) assert.equal(listPage(input), 1);
assert.equal(listPage('23'), 23);
const id = 'client+with&search=? пробел';
assert.equal(new URL(clientListUrl(id), 'https://test.invalid').searchParams.get('search'), id);
assert.equal(csvCell('Тариф; "премиум"\n60 дней'), '"Тариф; ""премиум""\n60 дней"');
assert.equal(csvCell('=HYPERLINK("https://example.invalid")'), '"\'=HYPERLINK(""https://example.invalid"")"');
for (const value of ['+123', '-1+2', '@SUM(1)', '  =1+1', '\t=1', '\r=1', '\n=1', '\uFEFF=1']) assert.ok(csvCell(value).startsWith('"\''), value);
assert.equal(csvCell(100), '"100"');
assert.equal(csvCell(null), '""');
console.log('PASS: invalid pagination, client links, multiline CSV, CSV formula injection');
