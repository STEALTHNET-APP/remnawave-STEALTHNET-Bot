const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const ts=require(process.env.TYPESCRIPT_PATH || 'typescript');
const source=fs.readFileSync('src/keyboard.ts','utf8');
const box={exports:{},require:()=>({t:k=>k})};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,box);
const kb=box.exports.topupPaymentMethodButtons;
const providers=['yoomoney','yookassa','cryptopay','heleket','rollypay','lava'];
for(const provider of providers){
 const result=kb('500',[],null,undefined,undefined,{[provider+'Enabled']:true});
 const callbacks=result.inline_keyboard.flat().map(x=>x.callback_data);
 assert.deepEqual(Array.from(callbacks),[`topup_${provider}:500`,'menu:topup']);
}
const mixed=kb('250.5',[{id:2,label:'Card'}],null,undefined,undefined,{rollypayEnabled:true,lavaEnabled:true});
assert.deepEqual(Array.from(mixed.inline_keyboard.flat().map(x=>x.callback_data)),['topup_lava:250.5','topup_rollypay:250.5','topup:250.5:2','menu:topup']);
assert.equal(kb('500',[],null,undefined,undefined,{lavatopEnabled:true}).inline_keyboard.length,1);
// Check real call sites: all amount entry paths must supply named RollyPay config.
const index=fs.readFileSync('src/index.ts','utf8'),ast=ts.createSourceFile('index.ts',index,ts.ScriptTarget.Latest,true);
assert.equal(ast.parseDiagnostics.length,0);let count=0;
function visit(node){if(ts.isCallExpression(node)&&node.expression.getText(ast)==='topupPaymentMethodButtons'){
 count++;assert.equal(node.arguments.length,6);
 const options=node.arguments[5];assert.ok(ts.isObjectLiteralExpression(options));
 assert.ok(options.properties.some(p=>p.name?.getText(ast)==='rollypayEnabled'));
}ts.forEachChild(node,visit);}visit(ast);assert.equal(count,3);
console.log('PASS: each provider alone, RollyPay + Lava + Platega, fractional amounts, tariff-only Lava.top excluded, all 3 bot entry paths');
