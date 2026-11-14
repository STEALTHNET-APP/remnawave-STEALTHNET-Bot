// Exercises the actual cron entry point; database, VPN and card requests are isolated.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function load(path,mocks={}){
 const exports={};
 const code=ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,require:n=>{if(n in mocks)return mocks[n];if(n==='crypto')return require(n);throw Error('Unexpected dependency '+n);},console,Date,Math,JSON,Number,Set});return exports;
}
const plan=load('src/modules/payment/secondary-renew-plan.ts');
const noop=async()=>{};
let sub,balance,charged,paymentRow,extension,cardRequests;
const tariff={id:'own',name:'Own',price:70,durationDays:7,currency:'RUB',internalSquadUuids:[],includedDevices:1};
const options=[{id:'week',tariffId:'own',durationDays:7,price:70},{id:'month',tariffId:'own',durationDays:31,price:250}];
const db={
 client:{findMany:async()=>[],updateMany:async({where,data})=>{if(balance<where.balance.gte)return {count:0};balance-=data.balance.decrement;charged+=data.balance.decrement;return {count:1};}},
 subscription:{findMany:async({where})=>where.tariffId===null?[]:[sub],update:noop},
 tariffPriceOption:{findMany:async({where})=>{assert.equal(where.tariffId,'own');return options;}},
 payment:{findFirst:async()=>null,create:async({data})=>{paymentRow=data;return {id:'paid',...data};}},
};
const cron=load('src/modules/payment/auto-renew.cron.ts',{
 'node-cron':{},'../../db.js':{prisma:db},
 '../tariff/tariff-activation.service.js':{extendSecondarySubscription:async(...args)=>{extension=args;return {ok:true};}},
 '../remna/remna.client.js':{isRemnaConfigured:()=>true,remnaGetUser:async()=>({data:{expireAt:new Date(Date.now()+3600000).toISOString()}})},
 '../client/client.service.js':{getSystemConfig:async()=>({yookassaRecurringEnabled:true,yookassaShopId:'test',yookassaSecretKey:'test'})},
 '../yookassa/yookassa.service.js':{createYookassaAutopayment:async p=>{cardRequests.push(p);return {ok:true,paymentId:'card'};}},
 '../client/personal-discount.js':{},
 '../notification/telegram-notify.service.js':{notifyAutoRenewYookassaSuccess:noop},
 '../notification/auto-renew-notifications.service.js':{dispatchAutoRenewNotification:noop,tryMarkSubDedup:async()=>true},
 './legacy-auto-renew-scope.js':{LEGACY_AUTO_RENEW_CLIENT_WHERE:{}},
 './secondary-renew-plan.js':plan,
});
function reset(overrides={},funds=1000){
 balance=funds;charged=0;paymentRow=null;extension=null;cardRequests=[];
 sub={id:'subscription-own',subscriptionIndex:1,remnawaveUuid:'vpn-own',tariffId:'own',autoRenewTariffId:'foreign',tariff,autoRenewTariff:{id:'foreign',price:999,durationDays:365},autoRenewPriceOptionId:'month',customPrice:250,extraDevicesMonthlyPrice:0,owner:{id:'owner',balance:funds,isBlocked:false,personalDiscountPercent:0,yookassaPaymentMethodId:'saved-test'},...overrides};
}
(async()=>{
 reset();await cron.processAutoRenewals();
 assert.equal(charged,250);assert.equal(extension[0],'subscription-own');assert.equal(extension[1].id,'own');assert.equal(extension[1].durationDays,31);assert.equal(extension[2].id,'month');assert.equal(paymentRow.tariffPriceOptionId,'month');assert.equal(cardRequests.length,0);
 reset({autoRenewPriceOptionId:'foreign-option'});await cron.processAutoRenewals();assert.equal(charged,250);assert.equal(extension[2].id,'month');
 reset({extraDevicesMonthlyPrice:60});await cron.processAutoRenewals();assert.equal(charged,312);assert.equal(extension[1].durationDays,31);
 reset({},100);await cron.processAutoRenewals();assert.equal(charged,100);assert.equal(cardRequests.length,1);assert.equal(cardRequests[0].amount,150);assert.equal(cardRequests[0].metadata.extendsSecondarySubId,'subscription-own');assert.equal(paymentRow.amount,250);assert.equal(paymentRow.tariffPriceOptionId,'month');assert.equal(extension[2].durationDays,31);
 console.log('PASS: real cron keeps own tariff, 31-day option, extras, balance and card portions aligned');
})().catch(e=>{console.error(e);process.exitCode=1});
