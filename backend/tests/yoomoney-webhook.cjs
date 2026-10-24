const assert=require('node:assert/strict'), fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),{createHmac}=require('node:crypto');
function load(path,mocks={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>mocks[n]??require(n),Buffer,URL,console,Date,Number,Math,JSON,Promise,Set,AbortController,setTimeout,clearTimeout});return exports;}
const noop=async()=>{};
const service=load('src/modules/webhooks/yoomoney.signature.ts');
let handler,row,balance,notifications,failCredit,activations,queue=Promise.resolve();
const payment={findFirst:async()=>({...row}),update:async({data})=>Object.assign(row,data),updateMany:async({where,data})=>{if(where.status?.not&&row.status===where.status.not)return {count:0};if(typeof where.status==='string'&&row.status!==where.status)return {count:0};Object.assign(row,data);return {count:1};}};
const client={update:async({data})=>{if(failCredit)throw Error('credit failure');balance+=data.balance.increment;}};
const prisma={payment,client,$transaction:async fn=>{const prior=queue;let release;queue=new Promise(r=>release=r);await prior;const saved={...row},old=balance;try{return await fn({payment,client});}catch(e){row=saved;balance=old;throw e;}finally{release();}}};
load('src/modules/webhooks/yoomoney.webhooks.routes.ts',{
 express:{Router:()=>({get:()=>{},post:(_,...f)=>handler=f.at(-1)})},'../../db.js':{prisma},'../client/client.service.js':{getSystemConfig:async()=>({yoomoneyNotificationSecret:'test-key'})},'./yoomoney.signature.js':service,
 '../tariff/tariff-activation.service.js':{activateTariffByPaymentId:async()=>{activations++;return {ok:true};}},'../proxy/proxy-slots-activation.service.js':{},'../singbox/singbox-slots-activation.service.js':{},'../extra-options/extra-options.service.js':{},'../referral/referral.service.js':{distributeReferralRewards:noop},'../notification/telegram-notify.service.js':{notifyBalanceToppedUp:async()=>{notifications++;},notifyTariffActivated:noop},'../payment/promo-code-usage.util.js':{recordPromoCodeUsageFromPayment:noop},'../payment/payment-webhook-audit.util.js':{auditPaymentClientBotAlignment:noop},'../client/personal-discount.js':{extinguishOneTimeDiscount:noop},
});
function reset(){row={id:'payment',clientId:'client',orderId:'order',externalId:'invoice',amount:100,currency:'USD',status:'PENDING',tariffId:null,proxyTariffId:null,singboxTariffId:null,metadata:null};balance=0;notifications=0;activations=0;failCredit=false;}
function signed(body={notification_type:'p2p-incoming',operation_id:'op1',amount:'100.00',currency:'643',datetime:'2026-10-24T10:00:00Z',sender:'41000000000',codepro:'false',label:'payment',unaccepted:'false'}){const data=Object.keys(body).sort().map(k=>`${k}=${encodeURIComponent(body[k])}`).join('&');return {...body,sign:createHmac('sha256','test-key').update(data).digest('hex')};}
async function send(raw=signed()){const res={statusCode:200,status(n){this.statusCode=n;return this;},send(v){this.body=v;return this;}};await handler({body:raw},res);return res;}
(async()=>{
 reset();await Promise.all(Array.from({length:8},()=>send()));assert.equal(balance,100,'concurrent callbacks must credit only once');assert.equal(notifications,1);await send();assert.equal(balance,100);
 reset();failCredit=true;assert.equal((await send()).statusCode,503);assert.equal(balance,0);assert.equal(row.status,'PENDING','failed credit must roll back PAID');failCredit=false;await send();assert.equal(balance,100);
 reset();assert.equal((await send({...signed(),amount:'999.00'})).statusCode,403);assert.equal(balance,0);
 for(const raw of [null,[],{sign:123},{sign:{}},{...signed(),amount:['100.00','999.00']}]){const r=await send(raw);assert.ok(r.statusCode>=400);}
 reset();const legacy={...signed()};delete legacy.sign;legacy.sha1_hash=service.computeYooMoneySha1(legacy.notification_type,legacy.operation_id,legacy.amount,legacy.currency,legacy.datetime,legacy.sender,legacy.codepro,'test-key',legacy.label);assert.equal((await send({...legacy,sign:'invalid'})).statusCode,403);assert.equal(balance,0);assert.equal((await send(legacy)).statusCode,200);assert.equal(balance,100);
 reset();row.tariffId='tariff';await Promise.all([send(),send()]);assert.equal(activations,1,'concurrent callbacks must not activate twice');
 console.log('PASS: concurrent callbacks, retries, atomic rollback, invalid signatures, malformed payloads, single activation');
})().catch(e=>{console.error(e);process.exitCode=1;});
