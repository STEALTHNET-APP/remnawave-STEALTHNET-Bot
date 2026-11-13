const assert=require('node:assert/strict'), fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),{createHash}=require('node:crypto');
function load(path,mocks={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>mocks[n]??require(n),Buffer,URL,console,Date,Number,Math,JSON,Promise,Set,AbortController,setTimeout,clearTimeout});return exports;}
const noop=async()=>{};
const service=load('src/modules/heleket/heleket.service.ts',{'../proxy-util/proxy-fetch.js':{},'../proxy-util/get-proxy-url.js':{}});
let handler,row,balance,notifications,failCredit,activations,queue=Promise.resolve();
const payment={findFirst:async()=>({...row}),update:async({data})=>Object.assign(row,data),updateMany:async({where,data})=>{if(where.status?.not&&row.status===where.status.not)return {count:0};if(typeof where.status==='string'&&row.status!==where.status)return {count:0};Object.assign(row,data);return {count:1};}};
const client={update:async({data})=>{if(failCredit)throw Error('credit failure');balance+=data.balance.increment;}};
const prisma={payment,client,$transaction:async fn=>{const prior=queue;let release;queue=new Promise(r=>release=r);await prior;const saved={...row},old=balance;try{return await fn({payment,client});}catch(e){row=saved;balance=old;throw e;}finally{release();}}};
load('src/modules/webhooks/heleket.webhooks.routes.ts',{
 express:{Router:()=>({post:(_,...f)=>handler=f.at(-1)})},'../../db.js':{prisma},'../client/client.service.js':{getSystemConfig:async()=>({heleketApiKey:'test-key'})},'../heleket/heleket.service.js':service,
 '../tariff/tariff-activation.service.js':{activateTariffByPaymentId:async()=>{activations++;return {ok:true};}},'../proxy/proxy-slots-activation.service.js':{},'../singbox/singbox-slots-activation.service.js':{},'../extra-options/extra-options.service.js':{},'../referral/referral.service.js':{distributeReferralRewards:noop},'../notification/telegram-notify.service.js':{notifyBalanceToppedUp:async()=>{notifications++;},notifyTariffActivated:noop},'../payment/promo-code-usage.util.js':{recordPromoCodeUsageFromPayment:noop},'../payment/payment-webhook-audit.util.js':{auditPaymentClientBotAlignment:noop},'../client/personal-discount.js':{extinguishOneTimeDiscount:noop},
});
function reset(){row={id:'payment',clientId:'client',orderId:'order',externalId:'invoice',amount:100,currency:'USD',status:'PENDING',tariffId:null,proxyTariffId:null,singboxTariffId:null,metadata:null};balance=0;notifications=0;activations=0;failCredit=false;}
function signed(body={type:'payment',uuid:'invoice',order_id:'order',status:'paid',amount:'100.00000000',currency:'USD'}){const sign=createHash('md5').update(Buffer.from(JSON.stringify(body).replace(/\//g,'\\/')).toString('base64')+'test-key').digest('hex');return JSON.stringify({...body,sign});}
async function send(raw=signed()){const res={statusCode:200,status(n){this.statusCode=n;return this;},send(v){this.body=v;return this;}};await handler({body:Buffer.from(raw)},res);return res;}
(async()=>{
 reset();await Promise.all(Array.from({length:8},()=>send()));assert.equal(balance,100,'concurrent callbacks must credit only once');assert.equal(notifications,1);await send();assert.equal(balance,100);
 reset();failCredit=true;await send().catch(()=>{});assert.equal(balance,0);assert.equal(row.status,'PENDING','failed credit must roll back PAID');failCredit=false;await send();assert.equal(balance,100);
 reset();assert.equal((await send(signed().replace('paid','paid_over'))).statusCode,401);assert.equal(balance,0);
 for(const raw of ['null','[]','{"sign":123}','{"sign":{}}']){const r=await send(raw);assert.ok(r.statusCode>=400);}
 reset();row.tariffId='tariff';await Promise.all([send(),send()]);assert.equal(activations,1,'concurrent callbacks must not activate twice');
 console.log('PASS: concurrent callbacks, retries, atomic rollback, invalid signatures, malformed payloads, single activation');
})().catch(e=>{console.error(e);process.exitCode=1;});
