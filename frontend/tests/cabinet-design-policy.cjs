const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const out = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/cabinet-design-policy.ts', 'utf8'), {
 compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { exports: out });
for (const design of ['classic', 'modern', 'stealth', 'aurora']) {
 assert.equal(out.normalizeCabinetAppearance(design), design);
 const expected = design === 'modern' ? 'classic' : design;
 assert.equal(out.resolveCabinetRenderer(design, true, false), expected);
 assert.equal(out.resolveCabinetRenderer(design, false, true), expected);
 assert.equal(out.resolveCabinetRenderer(design, false, false), 'classic');
 assert.equal(out.resolveCabinetRenderer(design, true, true, true), 'classic');
}
for (const value of [undefined, null, '', 'unknown', {}]) assert.equal(out.normalizeCabinetAppearance(value), 'classic');
console.log('PASS: admin-selected Mini App appearance, browser opt-in, legacy values, Lite mode');
