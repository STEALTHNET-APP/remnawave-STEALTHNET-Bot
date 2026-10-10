// Issue #200: e-mail sign-up without a dummy password + idempotent /verify-email.
// Pure helpers run for real (transpiled); route/page wiring is checked against the source.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
const load=(p)=>{const js=ts.transpileModule(fs.readFileSync(p,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const m={exports:{}};vm.runInNewContext(js,{exports:m.exports,module:m,Date});return m.exports;};
const h=load('src/modules/client/email-registration.ts');

// 1. register routing: email-only is a valid e-mail registration
assert.equal(h.resolveRegisterRoute({email:'a@b.c'}),'email');
assert.equal(h.resolveRegisterRoute({email:'a@b.c',password:'longpassword'}),'email');
assert.equal(h.resolveRegisterRoute({email:'a@b.c',password:'x',telegramId:'1'}),'email');
assert.equal(h.resolveRegisterRoute({email:'a@b.c',telegramId:'1'}),'telegram');
assert.equal(h.resolveRegisterRoute({telegramId:'1'}),'telegram');
assert.equal(h.resolveRegisterRoute({}),null);
assert.equal(h.resolveRegisterRoute({password:'longpassword'}),null);

// 2. no password -> client.passwordHash null (=> /me hasPassword false => onboarding password step)
assert.equal(h.clientPasswordHashFromPending(h.NO_PASSWORD_HASH),null);
assert.equal(h.clientPasswordHashFromPending('  '),null);
assert.equal(h.clientPasswordHashFromPending('$2b$10$hash'),'$2b$10$hash');
const onboarding=load('../frontend/src/lib/client-onboarding.ts');
assert.ok(onboarding.onboardingSteps({email:'a@b.c',hasPassword:false,totpEnabled:false}).includes('password'));
assert.ok(!onboarding.onboardingSteps({email:'a@b.c',hasPassword:true,totpEnabled:false}).includes('password'));

// 3. verify-email decisions: a used link never yields a session
assert.equal(h.decideVerifyEmail({pendingExists:false,expired:false,clientExists:false}),'invalid');
assert.equal(h.decideVerifyEmail({pendingExists:true,expired:false,clientExists:false}),'create');
assert.equal(h.decideVerifyEmail({pendingExists:true,expired:true,clientExists:false}),'expired');
assert.equal(h.decideVerifyEmail({pendingExists:true,expired:false,clientExists:true}),'already_verified');
assert.equal(h.decideVerifyEmail({pendingExists:true,expired:true,clientExists:true}),'already_verified');
const now=new Date('2026-01-01T00:00:00Z');
assert.equal(h.consumedPendingExpiry(now,new Date('2026-01-02T00:00:00Z')).getTime(),now.getTime()+h.VERIFY_EMAIL_REPLAY_WINDOW_MS);
assert.equal(h.consumedPendingExpiry(now,new Date('2026-01-01T00:05:00Z')).toISOString(),'2026-01-01T00:05:00.000Z');

// 4. password reset works for accounts without a password and stays one-time
assert.equal(h.passwordResetFingerprint(null),'');
assert.equal(h.passwordResetFingerprint('abcdefghijklmnopqrstuvwxyz'),'opqrstuvwxyz');
assert.notEqual(h.passwordResetFingerprint(null),h.passwordResetFingerprint('$2b$10$newhashvalue1234'));

// 5. wiring
const routes=fs.readFileSync('src/modules/client/client.routes.ts','utf8');
const verify=routes.slice(routes.indexOf('clientAuthRouter.post("/verify-email"'),routes.indexOf('const loginSchema'));
assert.ok(verify.includes('decideVerifyEmail('),'verify-email uses decideVerifyEmail');
assert.ok(!verify.includes('buildAuthResponse('),'verify-email must not issue a session for an existing client');
assert.ok(verify.includes('res.json(alreadyVerifiedResponse)')&&/const alreadyVerifiedResponse = \{\s*alreadyVerified: true,/.test(routes),'verify-email answers alreadyVerified');
assert.ok(!/pendingEmailRegistration\.delete\(\{ where: \{ id: pending\.id \} \}\)[^\n]*\n\s*\n\s*const signToken/.test(verify),'pending is not deleted right after create');
assert.ok(verify.includes('clientPasswordHashFromPending('),'client gets null passwordHash when none was chosen');
const register=routes.slice(routes.indexOf('clientAuthRouter.post("/register"'),routes.indexOf('const verifyEmailSchema'));
assert.ok(register.includes('resolveRegisterRoute('),'register uses resolveRegisterRoute');
assert.ok(!register.includes('hashPassword(data.password!)'),'register must not require a password');
const reset=routes.slice(routes.indexOf('clientAuthRouter.post("/forgot-password"'),routes.indexOf('const telegramMiniappSchema'));
assert.ok(!reset.includes('!client.passwordHash ||'),'reset flow must accept accounts without a password');
const page=fs.readFileSync('../frontend/src/pages/cabinet/client-register.tsx','utf8');
assert.ok(!page.includes('dummy password')&&!page.includes('slice(-8) + "A1!"'),'register page must not send a random password');
const verifyPage=fs.readFileSync('../frontend/src/pages/cabinet/client-verify-email.tsx','utf8');
assert.ok(verifyPage.includes('already_verified'),'verify page handles already-verified links');
console.log('PASS: email-only register route, null password -> onboarding step, verify-email replay without session, reset for passwordless accounts, frontend wiring');
