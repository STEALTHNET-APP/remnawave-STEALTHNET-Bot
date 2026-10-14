const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../src/modules/auth/middleware.ts'),'utf8');
const moduleResult={exports:{}};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:moduleResult.exports,require:()=>({}),console});
for(const [originalUrl,allowed,expected] of [
 ['/api/admin/roulette',[],403],['/api/admin/roulette',['clients'],403],['/api/admin/roulette?x=1',['settings'],200],
 ['/api/admin/anti-abuse/rules',[],403],['/api/admin/anti-abuse/rules',['anti-abuse'],200],
 ['/api/admin/referrals',['clients'],200],['/api/admin/tickets',['tickets'],200],
]){
 let status=200,passed=false;
 moduleResult.exports.requireAdminSection({path:'/',originalUrl,adminRole:'MANAGER',adminAllowedSections:allowed},{status(n){status=n;return this;},json(){}},()=>{passed=true;});
 assert.equal(status,expected);assert.equal(passed,expected===200);
}
console.log('PASS: mounted admin routers check their actual section, including roulette settings');
