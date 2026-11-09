import test, { mock, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHmac } from 'node:crypto';
if (!process.env.DATABASE_URL?.includes('/updaterqa_review')) throw Error('Requires isolated updaterqa_review database');
process.env.NODE_ENV='test';process.env.JWT_SECRET='isolated-cispay-test-secret-123456789';
const cfg={cispayShopId:randomUUID(),cispayApiKey:'isolated-cispay-secret',cispayEnabled:false};
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
const {cispayWebhooksRouter}=await import('../dist/modules/cispay/cispay.webhooks.js');
const {requestCispayRefund}=await import('../dist/modules/cispay/cispay-refund.js');
const {default:express}=await import('express');
const app=express();app.use(express.raw({type:'*/*'}));app.use(cispayWebhooksRouter);
const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
const originalFetch=globalThis.fetch, records=new Map(),clients=[];
let failApi=false,refundCalls=0,failRefund=false;
globalThis.fetch=async(url,options)=>{
 if(String(url).startsWith('https://api.cispay.app/')){
  if(failApi)throw Error('status unavailable');
  if(String(url).includes('/refund')){refundCalls++;if(failRefund)throw Error('refund response lost');return Response.json({status:'PAID'});}
  const id=new URL(url).searchParams.get('order_id');const r=records.get(id);return Response.json(r??{}, {status:r?200:404});
 }
 return originalFetch(url,options);
};
after(async()=>{globalThis.fetch=originalFetch;await new Promise(resolve=>server.close(resolve));await prisma.webhookEvent.deleteMany({where:{provider:'cispay'}});await prisma.client.deleteMany({where:{id:{in:clients}}});await prisma.$disconnect();});
async function fixture(product=false){
 const client=await prisma.client.create({data:{}});clients.push(client.id);
 const p=await prisma.payment.create({data:{clientId:client.id,orderId:randomUUID(),amount:260,currency:'RUB',provider:'cispay',metadata:JSON.stringify({cispayShopId:cfg.cispayShopId,cispaySandbox:false,...(product?{customBuild:{days:30}}:{})})}});
 records.set(p.orderId,{id:randomUUID(),store_id:cfg.cispayShopId,order_id:p.orderId,status:'PAID',amount:26000,charged_amount:27000,currency:'RUB',is_sandbox:false,payment_method:'SBP'});return p;
}
async function send(p,patch={},valid=true){
 const body=JSON.stringify({...records.get(p.orderId),...patch});
 const sig=createHmac('sha256',valid?cfg.cispayApiKey:'wrong').update(body).digest('hex');
 return fetch(`http://127.0.0.1:${server.address().port}/`,{method:'POST',headers:{'Content-Type':'application/json','X-Signature':sig},body});
}
test('reject mismatched signatures and identity; unavailable status is retryable and never credits',async()=>{
 const p=await fixture();assert.equal((await send(p,{},false)).status,401);
 for(const patch of [{amount:1},{is_sandbox:true},{store_id:randomUUID()},{id:randomUUID()}])assert.equal((await send(p,patch)).status,400);
 failApi=true;assert.equal((await send(p)).status,503);failApi=false;
 assert.equal((await prisma.client.findUnique({where:{id:p.clientId}})).balance,0);
});
test('concurrent notifications credit once even if new checkout is disabled; refund is once and paid replay ignored',async()=>{
 const p=await fixture();const replies=await Promise.all(Array.from({length:8},()=>send(p)));assert.ok(replies.every(r=>r.status===200));
 assert.equal((await prisma.client.findUnique({where:{id:p.clientId}})).balance,260);
 records.get(p.orderId).status='REFUNDED';assert.ok((await Promise.all([send(p),send(p),send(p)])).every(r=>r.status===200));
 assert.equal((await prisma.client.findUnique({where:{id:p.clientId}})).balance,0);
 records.get(p.orderId).status='PAID';await send(p);assert.equal((await prisma.client.findUnique({where:{id:p.clientId}})).balance,0);
});
test('product payment queues once, refund before activation prevents granting access',async()=>{
 const p=await fixture(true);await Promise.all([send(p),send(p)]);assert.equal(await prisma.paymentDelivery.count({where:{paymentId:p.id}}),1);
 records.get(p.orderId).status='REFUNDED';await send(p);activations=0;await processPaymentDelivery(p.id);assert.equal(activations,0);
 assert.equal((await prisma.paymentDelivery.findUnique({where:{paymentId:p.id}})).state,'REVIEW');
});
test('refund during in-flight fulfillment is retryable without changing payment state',async()=>{
 const p=await fixture(true);await send(p);await prisma.paymentDelivery.update({where:{paymentId:p.id},data:{state:'PROCESSING'}});
 records.get(p.orderId).status='REFUNDED';assert.equal((await send(p)).status,503);assert.equal((await prisma.payment.findUnique({where:{id:p.id}})).status,'PAID');
 await prisma.paymentDelivery.update({where:{paymentId:p.id},data:{state:'DONE'}});assert.equal((await send(p)).status,200);
});
test('concurrent refund requests submit once; lost response remains blocked for manual reconciliation',async()=>{
 const p=await fixture();await send(p);refundCalls=0;failRefund=true;
 const result=await Promise.allSettled([requestCispayRefund(p.id),requestCispayRefund(p.id)]);assert.ok(result.every(r=>r.status==='rejected'));assert.equal(refundCalls,1);
 await assert.rejects(()=>requestCispayRefund(p.id));assert.equal(refundCalls,1);failRefund=false;
 assert.equal((await prisma.payment.findUnique({where:{id:p.id}})).status,'PAID');
});
