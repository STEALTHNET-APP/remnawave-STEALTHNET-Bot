const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
function load(path, mocks={}) {
 const exports={};
 const code=ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,require:n=>mocks[n]??require(n),Buffer,URL,AbortSignal,fetch:(...a)=>global.fetch(...a),console,Date}); return exports;
}
const service=load('src/modules/paritypay/paritypay.service.ts');
const cfg={shopId:'shop',apiKey:'api-secret',signingSecret:'webhook-secret',enabled:true};
const invoice={id:'invoice',order_id:'order',shop_id:'shop',amount:100,status:'PAID',link:'https://pay.paritypay.net/invoice'};
const signature=b=>crypto.createHmac('sha256',cfg.signingSecret).update(Object.keys(b).sort().map(k=>b[k]===null?'':String(b[k])).join('')).digest('hex');
(async()=>{
 const body={...invoice,amount:'100.00',custom_fields:null};
 assert(service.verifyParitypayWebhookSignature(cfg.signingSecret,body,signature(body)));
 assert(!service.verifyParitypayWebhookSignature(cfg.signingSecret,{...body,amount:200},signature(body)));
 assert(!service.verifyParitypayWebhookSignature('wrong',body,signature(body)));
 assert(!service.verifyParitypayWebhookSignature(cfg.signingSecret,body,'bad'));
 let requests=0;
 global.fetch=async(url,opts)=>{requests++; assert.equal(opts.headers['X-SecretKey'],cfg.apiKey); assert.equal(opts.headers['X-ShopId'],'shop'); if(opts.body){const p=JSON.parse(opts.body);assert.equal(p.amount,100);assert.equal(p.order_id,'order');assert(!opts.body.includes(cfg.apiKey));} return {ok:true,json:async()=>invoice};};
 const params={config:cfg,amount:'100',currency:'RUB',orderId:'order'};
 assert((await service.createParitypayPayment(params)).ok);
 assert(!(await service.createParitypayPayment({...params,currency:'USD'})).ok);
 assert(!(await service.createParitypayPayment({...params,config:{...cfg,enabled:false}})).ok);
 assert.equal(requests,1);
 assert(!service.matchesParitypayInvoice({...invoice,amount:99},{orderId:'order',shopId:'shop',amount:100}));
 global.fetch=async()=>({ok:true,json:async()=>({...invoice,link:'https://evil.test/'})});
 assert(!(await service.createParitypayPayment(params)).ok);
 let handler, row, balance, activations, fail;
 const payment={findFirst:async()=>({...row}),findUnique:async()=>({...row}),updateMany:async({where,data})=>{if(row.status!==where.status || ('metadata' in where && row.metadata!==where.metadata))return {count:0};Object.assign(row,data);return {count:1}},update:async({data})=>Object.assign(row,data)};
 const db={payment,client:{update:async({data})=>{balance+=data.balance.increment}},$transaction:async fn=>fn(db)};
 const noop=async()=>{};
 const activate=async()=>{activations++;return fail?{ok:false,error:'test failure'}:{ok:true}};
 load('src/modules/webhooks/paritypay.webhooks.routes.ts',{
 express:{Router:()=>({post:(_,fn)=>handler=fn})},'../../db.js':{prisma:db},
 '../client/client.service.js':{getSystemConfig:async()=>({paritypayShopId:cfg.shopId,paritypayApiKey:cfg.apiKey,paritypaySigningSecret:cfg.signingSecret,paritypayEnabled:false})},
 '../paritypay/paritypay.service.js':{...service,getParitypayInvoice:async()=>invoice},
 '../tariff/tariff-activation.service.js':{activateTariffByPaymentId:activate},
 '../proxy/proxy-slots-activation.service.js':{},'../singbox/singbox-slots-activation.service.js':{},'../extra-options/extra-options.service.js':{},
 '../referral/referral.service.js':{distributeReferralRewards:noop},
 '../notification/telegram-notify.service.js':{notifyBalanceToppedUp:noop,notifyTariffActivated:noop},
 '../payment/promo-code-usage.util.js':{recordPromoCodeUsageFromPayment:noop},'../client/personal-discount.js':{extinguishOneTimeDiscount:noop}
 });
 const reset=(tariffId=null)=>{row={id:'p',clientId:'c',orderId:'order',externalId:'invoice',amount:100,currency:'RUB',status:'PENDING',metadata:null,tariffId};balance=0;activations=0;fail=false};
 async function call(b=body,sig=signature(b)){const res={code:200,status(c){this.code=c;return this},send(){return this}};await handler({body:Buffer.from(JSON.stringify(b)),header:()=>sig},res);return res.code;}
 reset();assert.equal(await call(body,'bad'),401);assert.equal(balance,0);
 assert.equal(await call({...body,shop_id:'wrong'}),400);assert.equal(balance,0);
 assert.equal(await call({...body,amount:'200'}),400);assert.equal(balance,0);
 assert.equal(await call(),200);assert.equal(await call(),200);assert.equal(balance,100);
 reset('tariff');await Promise.all([call(),call()]);assert.equal(activations,1);assert.equal(await call(),200);assert.equal(activations,1);
 reset('tariff');fail=true;assert.equal(await call(),503);assert.equal(await call(),503);assert.equal(activations,1);
 console.log('PASS: ParityPay API validation, signatures, disabled checkout, callback matching, duplicate/concurrent credit and activation, failed activation guard');
})().catch(e=>{console.error(e);process.exitCode=1});
