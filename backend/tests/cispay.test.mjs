import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createCispayPayment, getCispayStatus, verifyCispaySignature, cispayMatchesPayment } from '../dist/modules/cispay/cispay.service.js';
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const id = '00000000-0000-4000-8000-000000000001';
const config = { shopId: '00000000-0000-4000-8000-000000000002', apiKey: 'fixture-secret' };
const status = { id, order_id: 'order', status: 'PAID', amount: 26000, charged_amount: 27000, currency: 'RUB', is_sandbox: false, payment_method: 'SBP' };
const payment = { orderId: 'order', amount: 260, currency: 'RUB', externalId: id };
test('signature verifies exact raw bytes and rejects malformed, missing and tampered signatures', () => {
 const raw=Buffer.from('{"a":1}'), sig=createHmac('sha256',config.apiKey).update(raw).digest('hex');
 assert.equal(verifyCispaySignature(config.apiKey,raw,sig),true);
 for(const s of [undefined,'x',sig.slice(1),'0'.repeat(64)]) assert.equal(verifyCispaySignature(config.apiKey,raw,s),false);
 assert.equal(verifyCispaySignature(config.apiKey,Buffer.from('{ "a":1}'),sig),false);
});
test('payment binds order, provider id, currency, original amount and sandbox independently of charged fees', () => {
 assert.equal(cispayMatchesPayment(status,payment,false),true);
 for(const patch of [{order_id:'other'},{id:'other'},{amount:26001},{currency:'USD'},{is_sandbox:true},{block_reason:'blocked'}]) assert.equal(cispayMatchesPayment({...status,...patch},payment,false),false);
 assert.equal(cispayMatchesPayment({...status,payment_method:'CRYPTO',currency:'USD',amount:300,source_currency:'RUB',source_amount:26000},payment,false),true);
 assert.equal(cispayMatchesPayment({...status,payment_method:'CRYPTO',currency:'USD',amount:300,source_currency:'RUB',source_amount:25999},payment,false),false);
});
test('create uses minor units, merchant headers, stable order and hosted method selection', async () => {
 let calls=0;
 globalThis.fetch=async(url,init)=>{ calls++; assert.equal(url,'https://api.cispay.app/payments');assert.equal(init.method,'POST');assert.equal(init.headers['X-Shop-ID'],config.shopId);assert.equal(init.headers['X-Api-Key'],config.apiKey); const b=JSON.parse(init.body);assert.equal(b.amount,12345);assert.equal(b.order_id,'order');assert.equal(b.currency,'RUB');assert.equal(b.customer_id,'client');assert.equal(b.payment_method,undefined);return Response.json({id,order_id:'order',payment_url:'https://pay.cispay.app/test'}); };
 const result=await createCispayPayment({config,amount:123.45,currency:'RUB',orderId:'order',customerId:'client',description:'Test'});
 assert.equal(result.ok,true);assert.equal(calls,1);
});
test('uncertain create is not retried; invalid currencies never reach provider',async()=>{
 let calls=0;globalThis.fetch=async()=>{calls++;throw Error('timeout after remote creation');};
 const p={config,amount:12,currency:'RUB',orderId:'order',customerId:'client',description:'Test'};
 assert.equal((await createCispayPayment(p)).ok,false);assert.equal(calls,1);
 assert.equal((await createCispayPayment({...p,currency:'EUR'})).ok,false);assert.equal(calls,1);
});
test('status queries use order_id and validate provider response',async()=>{
 globalThis.fetch=async(url,init)=>{assert.equal(url,'https://api.cispay.app/payments/status?order_id=order');assert.equal(init.method,'GET');return Response.json(status);};
 assert.equal((await getCispayStatus(config,'order')).id,id);
 globalThis.fetch=async()=>Response.json({...status,amount:'26000'});await assert.rejects(()=>getCispayStatus(config,'order'));
});
