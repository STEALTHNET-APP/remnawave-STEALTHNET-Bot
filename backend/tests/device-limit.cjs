const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function load(path,mocks={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>mocks[n]??require(n),console,Date,JSON,process,globalThis:{},Buffer});return exports;}
const cap=load('src/modules/extra-options/device-limit.ts');
let state,tail=Promise.resolve(),remote=1,updates=0,failCreate=false;
const db={
 $executeRaw:async()=>1,
 subscription:{findFirst:async({where})=>where.ownerId==='client'&&(!where.id||where.id==='sub')?structuredClone(state.sub):null,findUnique:async()=>structuredClone(state.sub),update:async({data})=>{for(const [k,v]of Object.entries(data))state.sub[k]=typeof v==='object'&&v&&'increment'in v?state.sub[k]+v.increment:v;return structuredClone(state.sub);}},
 client:{update:async({data})=>{state.balance+=data.balance.increment;return{};},findUnique:async()=>({restrictedTariffIds:null}),updateMany:async({where,data})=>{if(state.balance<where.balance.gte)return{count:0};state.balance-=data.balance.decrement;return{count:1};}},
 payment:{findMany:async()=>state.payments.filter(p=>['PENDING','PAID'].includes(p.status)),findUnique:async({where})=>structuredClone(state.payments.find(p=>p.id===where.id)??null),create:async({data})=>{if(failCreate)throw Error('database unavailable');const p={...data,id:'pay-'+state.payments.length};state.payments.push(p);return structuredClone(p);},update:async({where,data})=>{const p=state.payments.find(p=>p.id===where.id);Object.assign(p,data);return structuredClone(p);}},
 $transaction:async fn=>{const prev=tail;let unlock;tail=new Promise(r=>unlock=r);await prev;const snapshot=structuredClone(state);try{return await fn(db);}catch(e){state=snapshot;throw e;}finally{unlock();}},
};
const payments=load('src/db.ts',{'@prisma/client':{PrismaClient:class{constructor(){return db;}}},'./modules/extra-options/device-limit.js':cap,'./modules/payment/payment-intent.js':{parsePaymentIntentMetadata:()=>({})}});
const apply=load('src/modules/extra-options/extra-options.service.ts',{'../../db.js':{prisma:db},'./device-limit.js':cap,'../remna/remna.client.js':{isRemnaConfigured:()=>true,remnaGetUser:async()=>({data:{response:{hwidDeviceLimit:remote,status:'ACTIVE'}},status:200}),remnaUpdateUser:async({hwidDeviceLimit})=>{updates++;remote=hwidDeviceLimit;return{data:{},status:200};}}});
function reset(){state={balance:100,payments:[],sub:{id:'sub',ownerId:'client',subscriptionIndex:0,remnawaveUuid:'uuid',expireAt:new Date(Date.now()+86400000),extraDevices:0,extraDevicesMonthlyPrice:0,customPrice:null,tariff:{maxExtraDevices:3,includedDevices:1,deviceLimit:1}}};remote=1;updates=0;failCreate=false;}
const create=count=>payments.createPayment({data:{clientId:'client',amount:10,currency:'RUB',provider:'balance',status:'PAID',orderId:'test',metadata:JSON.stringify({extraOption:{kind:'devices',deviceCount:count,productPriceMonthly:10}})}},true);
(async()=>{
 reset();let results=await Promise.allSettled([create(2),create(2)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,2);assert.equal(state.balance,80);
 const applied=await Promise.all([apply.applyExtraOptionByPaymentId('pay-0'),apply.applyExtraOptionByPaymentId('pay-1')]);assert(applied.every(r=>r.ok));assert.equal(applied.filter(r=>r.creditedToBalance).length,1);assert.equal(updates,1);assert.equal(remote,3);assert.equal(state.sub.extraDevices,2);assert.equal(state.balance,90);
 await apply.applyExtraOptionByPaymentId('pay-0');await apply.applyExtraOptionByPaymentId('pay-1');assert.equal(updates,1);assert.equal(state.balance,90);
 await assert.rejects(()=>create(2));
 const third=await create(1);await apply.applyExtraOptionByPaymentId(third.id);assert.equal(state.sub.extraDevices,3);await assert.rejects(()=>create(1));assert.equal(state.balance,80);
 reset();failCreate=true;await assert.rejects(()=>create(1));assert.equal(state.balance,100);assert.equal(state.payments.length,0);
 reset();state.balance=0;await assert.rejects(()=>create(1));assert.equal(state.payments.length,0);
 reset();await create(2);state.sub.tariff.maxExtraDevices=1;const blocked=await apply.applyExtraOptionByPaymentId('pay-0');assert.equal(blocked.creditedToBalance,true);assert.equal(updates,0);assert.equal(state.balance,100);
 reset();state.sub.expireAt=new Date(0);await assert.rejects(()=>create(1));assert.equal(state.balance,100);
 reset();const pending=await create(2);state.payments[0].status='PENDING';await create(2);assert.equal(state.payments.length,2);assert.equal((await apply.applyExtraOptionByPaymentId(pending.id)).ok,false);
 console.log('PASS: common createPayment guard, concurrent balance orders, atomic debit rollback, duplicate activation, persisted counters, changed cap and expired subscription');
})().catch(e=>{console.error(e);process.exitCode=1});
