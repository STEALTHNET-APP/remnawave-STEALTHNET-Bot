const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
const source=fs.readFileSync('src/lib/client-onboarding.ts','utf8');
const box={exports:{}};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,box);
const {onboardingSteps:steps,nextOnboardingStep:next,needsClientOnboarding:needs}=box.exports;
assert.equal(needs({onboardingCompleted:true},true),false,'server completed beats device hint');
assert.equal(needs({onboardingCompleted:false},false),true);
assert.equal(needs({},true),true);
assert.equal(needs({},false),false);
for(const email of [null,'a@example.test']) {
 assert.equal(steps({email,hasPassword:true}).includes('password'),false,'existing password must never be requested');
 assert.equal(steps({email,hasPassword:false}).includes('password'),true);
}
assert.equal(steps({}).includes('password'),false,'unknown state is not a missing password');
assert.equal(steps({totpEnabled:true}).includes('2fa'),false);
assert.equal(next('email',steps({email:'a@example.test',hasPassword:true})),'2fa','removing completed email cannot restart welcome');
assert.equal(next('password',steps({email:'a@example.test',hasPassword:true,totpEnabled:true})),'done');
assert.equal(next('welcome',steps({email:'a@example.test',hasPassword:true,totpEnabled:true})),'done');
console.log('PASS: existing/new passwords, fresh-device hints, completed onboarding, email transition and enabled 2FA');
