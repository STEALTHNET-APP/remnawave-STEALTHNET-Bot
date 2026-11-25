import test, { mock, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHmac } from 'node:crypto';
if (!['rivarapay_test','email_case_test'].includes(new URL(process.env.DATABASE_URL).pathname.slice(1))) throw Error('Isolated database required');
process.env.NODE_ENV='test';process.env.JWT_SECRET='isolated-cispay-test-secret-123456789';
const cfg={rivarapayApiKey:'live_fixture',rivarapayWebhookSecret:'fixture-webhook-secret',rivarapaySandbox:false,rivarapayFranchiseType:''};
mock.module(new URL('../dist/modules/client/client.service.js',import.meta.url),{namedExports:{getSystemConfig:async()=>cfg}});
let activations=0;
const noop=async()=>{};
for(const [path,namedExports] of Object.entries({
 'tariff/tariff-activation.service.js':{activateTariffByPaymentId:async()=>{activations++;return {ok:true};}},
 'proxy/proxy-slots-activation.service.js':{createProxySlotsByPaymentId:async()=>({ok:true,slotIds:[]})},
 'singbox/singbox-slots-activation.service.js':{createSingboxSlotsByPaymentId:async()=>({ok:true,slotIds:[]})},
 'extra-options/extra-options.service.js':{applyExtraOptionByPaymentId:async()=>({ok:true})},
 'referral/referral.service.js':{distributeReferralRewards:noop},
 'payment/promo-code-usage.util.js':{recordPromoCodeUsageFromPayment:noop},
 'client/personal-discount.js':{extinguishOneTimeDiscount:noop},
 'payment/payment-fulfillment.util.js':{handlePaymentActivationResult:noop},
 'notification/telegram-notify.service.js':{notifyBalanceToppedUp:noop,notifyExtraOptionApplied:noop,notifyProxySlotsCreated:noop,notifySingboxSlotsCreated:noop},
})) mock.module(new URL('../dist/modules/'+path,import.meta.url),{namedExports});
const {prisma}=await import('../dist/db.js');
const {processPaymentDelivery}=await import('../dist/modules/payment/payment-delivery.service.js');
const {rivarapayWebhooksRouter}=await import('../dist/modules/rivarapay/rivarapay.webhooks.js');
const {default:express}=await import('express');
const app=express();app.use(express.raw({type:'*/*'}));app.use(rivarapayWebhooksRouter);
const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
const originalFetch=globalThis.fetch, records=new Map(),clients=[],paymentIds=[];
let failApi=false;
globalThis.fetch=async(url,options)=>{
 if(String(url).startsWith('https://api.rivarapay.io/')){
  if(failApi)throw Error('status unavailable');
  const r=records.get(String(url).split('/').at(-1));return Response.json(r??{}, {status:r?200:404});
 }
 return originalFetch(url,options);
};
after(async()=>{globalThis.fetch=originalFetch;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await prisma.webhookEvent.deleteMany({where:{provider:'rivarapay'}});await prisma.paymentWebhookReceipt.deleteMany({where:{paymentId:{in:paymentIds}}});await prisma.client.deleteMany({where:{id:{in:clients}}});await prisma.$disconnect();});
async function fixture(product=false,sandbox=false){
 const client=await prisma.client.create({data:{}});clients.push(client.id);
 const p=await prisma.payment.create({data:{clientId:client.id,orderId:randomUUID(),externalId:'pi_'+randomUUID(),amount:260,currency:'RUB',provider:'rivarapay',metadata:JSON.stringify({rivarapaySandbox:sandbox,...(product?{customBuild:{days:30}}:{})})}});paymentIds.push(p.id);
 records.set(p.externalId,{id:p.externalId,merchantOrderId:p.orderId,status:'SUCCEEDED',amount:{amount:'26000',currency:'RUB'},refunded:{amount:'0',currency:'RUB'},livemode:!sandbox});return p;
}
async function send(p,patch={},options={}){
 const body=JSON.stringify({event_type:'payment.paid',status:'paid',amount:'260.00',currency:'RUB',test:false,payment_id:p.externalId,order_id:p.orderId,...patch});
 const timestamp=String(Math.floor(Date.now()/1000)+(options.offset??0));
 const sig=createHmac('sha256',options.invalid?'wrong':cfg.rivarapayWebhookSecret).update(timestamp+'.'+body).digest('hex');
 return fetch(`http://127.0.0.1:${server.address().port}/`,{method:'POST',headers:{'Content-Type':'application/json','X-Signature':sig,'X-Timestamp':timestamp,'X-Event-Id':options.id??randomUUID()},body});
}
async function balance(p){return (await prisma.client.findUniqueOrThrow({where:{id:p.clientId}})).balance;}
function refunded(p,partial=false){const r=records.get(p.externalId);r.status=partial?'PARTIALLY_REFUNDED':'REFUNDED';r.refunded.amount=partial?'10000':'26000';return {event_type:'payment.refunded',status:'succeeded',refund_id:'re_fixture',amount:partial?'100.00':'260.00'};}
test('bad signatures, stale timestamps, amounts, identity and mode never credit; provider outage is retryable',async()=>{
 const p=await fixture();
 for(const opt of [{invalid:true},{offset:-301},{offset:301}])assert.equal((await send(p,{},opt)).status,400);
 for(const patch of [{amount:'2.60'},{currency:'USD'},{test:true},{payment_id:'pi_other'}])assert.equal((await send(p,patch)).status,400);
 const r=records.get(p.externalId);r.merchantOrderId='other';assert.equal((await send(p)).status,400);r.merchantOrderId=p.orderId;
 failApi=true;assert.equal((await send(p)).status,503);failApi=false;assert.equal(await balance(p),0);
 assert.equal(await prisma.paymentWebhookReceipt.count({where:{paymentId:p.id}}),0);
});
test('concurrent duplicate and distinct paid events credit once and commit event receipts',async()=>{
 const p=await fixture(),id=randomUUID();
 const replies=await Promise.all(Array.from({length:6},()=>send(p,{}, {id})));assert.ok(replies.every(r=>r.status===200));
 await Promise.all([send(p),send(p)]);assert.equal(await balance(p),260);assert.equal(await prisma.paymentWebhookReceipt.count({where:{paymentId:p.id}}),3);
 assert.equal((await send(p,{total:'261.00'},{id})).status,503);assert.equal(await balance(p),260);
 const other=await fixture();assert.equal((await send(other,{}, {id})).status,503);assert.equal(await balance(other),0);
});
test('failure writing a receipt rolls back PAID and balance; retry can recover',async()=>{
 const p=await fixture();const create=prisma.$transaction.bind(prisma);let inject=true;
 prisma.$transaction=(fn,...args)=>create(async tx=>{const proxy=new Proxy(tx,{get(target,key){if(key==='paymentWebhookReceipt'&&inject)return {...target.paymentWebhookReceipt,create:async()=>{throw Error('simulated storage failure');}};return target[key];}});return fn(proxy);},...args);
 try {assert.equal((await send(p)).status,503);assert.equal(await balance(p),0);assert.equal((await prisma.payment.findUniqueOrThrow({where:{id:p.id}})).status,'PENDING');inject=false;assert.equal((await send(p)).status,200);assert.equal(await balance(p),260);}finally{prisma.$transaction=create;}
});
test('lost invoice response recovers by signed payment id and REST order identity; late paid revives FAILED',async()=>{
 const p=await fixture();await prisma.payment.update({where:{id:p.id},data:{externalId:null,status:'FAILED'}});
 assert.equal((await send(p)).status,200);assert.equal(await balance(p),260);assert.equal((await prisma.payment.findUniqueOrThrow({where:{id:p.id}})).externalId,p.externalId);
});
test('sandbox notification is verified but grants neither money nor access',async()=>{
 cfg.rivarapaySandbox=true;cfg.rivarapayApiKey='test_fixture';
 try {for(const product of [false,true]){const p=await fixture(product,true);assert.equal((await send(p,{test:true})).status,200);assert.equal(await balance(p),0);assert.equal(await prisma.paymentDelivery.count({where:{paymentId:p.id}}),0);assert.equal((await prisma.payment.findUniqueOrThrow({where:{id:p.id}})).status,'PENDING');}}
 finally{cfg.rivarapaySandbox=false;cfg.rivarapayApiKey='live_fixture';}
});
test('full refund is idempotent, reverses topup, and prevents a late paid replay',async()=>{
 const p=await fixture();await send(p);const referrer=await prisma.client.create({data:{balance:26}});clients.push(referrer.id);await prisma.referralCredit.create({data:{paymentId:p.id,referrerId:referrer.id,amount:26,level:1}});const patch=refunded(p),id=randomUUID();assert.ok((await Promise.all([send(p,patch,{id}),send(p,patch,{id}),send(p,patch)])).every(r=>r.status===200));assert.equal(await balance(p),0);
 assert.equal((await prisma.client.findUniqueOrThrow({where:{id:referrer.id}})).balance,0);assert.equal(await prisma.referralCredit.count({where:{paymentId:p.id}}),0);records.get(p.externalId).status='SUCCEEDED';await send(p);assert.equal(await balance(p),0);assert.equal((await prisma.payment.findUniqueOrThrow({where:{id:p.id}})).status,'REFUNDED');
});
test('product queues once; partial refund blocks delivery and requests manual review',async()=>{
 const p=await fixture(true);await Promise.all([send(p),send(p)]);assert.equal(await prisma.paymentDelivery.count({where:{paymentId:p.id}}),1);
 assert.equal((await send(p,refunded(p,true))).status,200);activations=0;await processPaymentDelivery(p.id);assert.equal(activations,0);assert.equal((await prisma.paymentDelivery.findUnique({where:{paymentId:p.id}})).state,'REVIEW');
});
test('refund racing with delivery returns a retry without losing its event',async()=>{
 const p=await fixture(true);await send(p);await prisma.paymentDelivery.update({where:{paymentId:p.id},data:{state:'PROCESSING'}});const patch=refunded(p),id=randomUUID();
 assert.equal((await send(p,patch,{id})).status,503);assert.equal(await prisma.paymentWebhookReceipt.count({where:{eventId:id}}),0);assert.equal((await prisma.payment.findUniqueOrThrow({where:{id:p.id}})).status,'PAID');
 await prisma.paymentDelivery.update({where:{paymentId:p.id},data:{state:'DONE'}});assert.equal((await send(p,patch,{id})).status,200);
});

test('successful product delivery executes once even when worker ticks race',async()=>{
 const p=await fixture(true);await send(p);activations=0;
 await Promise.all([processPaymentDelivery(p.id),processPaymentDelivery(p.id)]);await processPaymentDelivery(p.id);
 assert.equal(activations,1);assert.equal((await prisma.paymentDelivery.findUniqueOrThrow({where:{paymentId:p.id}})).state,'DONE');assert.equal(await balance(p),0);
});
