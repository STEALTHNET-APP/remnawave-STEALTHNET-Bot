const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/search-shortcut.ts', 'utf8'), {
 compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { exports: exportsObject });
const { usesCommandKey, searchShortcut, isSearchShortcut } = exportsObject;
const devices = [
 [{ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }, true],
 [{ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }, false],
 [{ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' }, false],
 [{ userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)' }, true],
 [{ userAgent: 'Mozilla/5.0 (Linux; Android 14)' }, false],
 [{ userAgentData: { platform: 'macOS' } }, true],
 [{ userAgentData: { platform: 'Windows' }, platform: 'MacIntel' }, false],
 [{ platform: 'MacIntel' }, true],
 [{}, false],
];
for (const [device, command] of devices) {
 assert.equal(usesCommandKey(device), command);
 assert.equal(searchShortcut(device).label, command ? '⌘ K' : 'Ctrl K');
 assert.equal(searchShortcut(device).aria, command ? 'Meta+K' : 'Control+K');
}
const base = { code: 'KeyK', key: 'k', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, isComposing: false };
for (const command of [true, false]) {
 const event = { ...base, metaKey: command, ctrlKey: !command };
 for (const key of ['k', 'K', 'л', 'Л']) assert.equal(isSearchShortcut({...event, key}, command), true);
 assert.equal(isSearchShortcut({...event, code: '', key: 'л'}, command), true);
 for (const extra of [{altKey:true}, {shiftKey:true}, {isComposing:true}, {code:'KeyJ'}, {metaKey:false,ctrlKey:false}]) assert.equal(isSearchShortcut({...event,...extra},command), false);
 assert.equal(isSearchShortcut(event, !command), false);
}
console.log('PASS: Mac/Windows/Linux/iPad/Android platform hints and shortcuts with Latin/Cyrillic keys, modifiers and IME guards');
