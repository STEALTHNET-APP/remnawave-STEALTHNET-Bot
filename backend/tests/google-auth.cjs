const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript'),{z}=require('zod');
const source=fs.readFileSync('src/modules/client/client.routes.ts','utf8');
const code=source.slice(source.indexOf('const googleAuthSchema ='),source.indexOf('// ——— Apple Sign In:'));
let handler,enabled,payload,existing,byEmail,created,linked,notifications,invalid;
const reset=()=>{enabled=true;payload={sub:'google-user',email:'test@example.invalid',email_verified:true};existing=null;byEmail=null;created=null;linked=null;notifications=0;invalid=false;};
vm.runInNewContext(ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
 z,console:{error:()=>{}},clientAuthRouter:{post:(_,fn)=>handler=fn},getSystemConfig:async()=>({googleLoginEnabled:enabled,googleClientId:'client-id'}),
 require:n=>{assert.equal(n,'google-auth-library');return {OAuth2Client:class{async verifyIdToken(args){assert.equal(args.audience,'client-id');if(invalid)throw Error('invalid');return {getPayload:()=>payload};}}};},
 prisma:{client:{findUnique:async({where})=>where.googleId?existing:byEmail,update:async({data})=>{linked=data;},create:async({data})=>{created=data;return {...data,id:'new'};}}},
 buildAuthResponse:c=>c.totpEnabled?{requires2FA:true,tempToken:'pending'}:{token:'session',client:{id:c.id}},isRemnaConfigured:()=>false,generateReferralCode:()=> 'REF-TEST',asClientUncheckedCreate:d=>d,notifyAdminsAboutNewClient:async()=>{notifications++;},signClientToken:()=> 'session',toClientShape:c=>({id:c.id}),
});
async function send(body={idToken:'signed-google-token'}){const res={statusCode:200,status(n){this.statusCode=n;return this;},json(data){this.data=data;return this;}};await handler({body},res);return res;}
(async()=>{
 reset();enabled=false;assert.equal((await send()).statusCode,403);
 reset();assert.equal((await send({})).statusCode,400);
 reset();invalid=true;assert.equal((await send()).statusCode,401);assert.equal(created,null);
 reset();existing={id:'existing',isBlocked:true};assert.equal((await send()).statusCode,403);
 reset();existing={id:'existing',totpEnabled:true};assert.equal((await send()).data.requires2FA,true);assert.equal(created,null);
 reset();existing={id:'existing'};assert.equal((await send()).data.client.id,'existing');assert.equal(created,null);
 reset();byEmail={id:'email-client'};assert.equal((await send()).data.client.id,'email-client');assert.equal(linked.googleId,'google-user');assert.equal(created,null);
 reset();payload.email_verified=false;byEmail={id:'victim'};await send();assert.equal(linked,null);assert.equal(created.email,null,'unverified email must not be stored or linked');
 reset();const res=await send();assert.equal(res.statusCode,201);assert.equal(created.googleId,'google-user');assert.equal(created.passwordHash,null);assert.equal(notifications,1);
 console.log('PASS: Google token verification with audience, disabled/invalid/blocked login, 2FA, existing account, verified-email linking, new registration');
})().catch(e=>{console.error(e);process.exitCode=1;});
