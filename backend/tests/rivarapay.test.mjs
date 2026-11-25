import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { decimalMinor, verifyRivarapaySignature, rivarapayMatchesPayment, createRivarapayPayment, rivarapayIdentity } from '../dist/modules/rivarapay/rivarapay.service.js';
const originalFetch=globalThis.fetch;
afterEach(()=>{globalThis.fetch=originalFetch;});
const config={apiKey:'test_fixture',webhookSecret:'secret',sandbox:true};
const orderId=randomUUID();
const status={id:'pi_fixture',merchantOrderId:orderId,livemode:false,status:'CREATED',amount:{amount:'12345',currency:'RUB'},checkoutUrl:'https://pay.rivarapay.io/checkout/fixture'};
const payment={orderId,amount:123.45,currency:'RUB',externalId:null};
test('signature binds timestamp and exact bytes and rejects malformed or replayed requests',()=>{
 const now=Date.now(),ts=String(Math.floor(now/1000)),raw=Buffer.from('{"paid":true}');
 const signature=createHmac('sha256','secret').update(ts+'.').update(raw).digest('hex');
 assert.equal(verifyRivarapaySignature('secret',raw,signature,ts,now),true);
 for(const s of [undefined,'0'.repeat(64),'z'.repeat(64),signature.slice(1)])assert.equal(verifyRivarapaySignature('secret',raw,s,ts,now),false);
 assert.equal(verifyRivarapaySignature('secret',Buffer.from('{ "paid":true}'),signature,ts,now),false);
 assert.equal(verifyRivarapaySignature('secret',raw,signature,ts,now+301000),false);
 assert.equal(verifyRivarapaySignature('secret',raw,signature,'NaN',now),false);
});
test('money conversion is exact and REST values are bound to order, mode and currency',()=>{
 assert.equal(decimalMinor('0.29'),29n);assert.equal(decimalMinor('12345678901234567890.01'),1234567890123456789001n);
 for(const s of ['1.001','1e2','-1','NaN'])assert.equal(decimalMinor(s),null);
 assert.equal(rivarapayMatchesPayment(status,payment,true),true);
 for(const patch of [{merchantOrderId:'wrong'},{livemode:true},{amount:{amount:'12344',currency:'RUB'}},{amount:{amount:'12345',currency:'USD'}}])assert.equal(rivarapayMatchesPayment({...status,...patch},payment,true),false);
 assert.equal(rivarapayMatchesPayment(status,{...payment,externalId:'other'},true),false);
});
test('create sends stable idempotency, minor-unit string, required identity and franchise details',async()=>{
 let calls=0;
 globalThis.fetch=async(url,init)=>{calls++;assert.equal(url,'https://api.rivarapay.io/api/v1/payment-intents');assert.equal(init.headers['Idempotency-Key'],orderId);assert.equal(init.headers['X-API-Key'],'test_fixture');const b=JSON.parse(init.body);assert.equal(b.amount,'12345');assert.equal(b.customerEmail,'123456@telegram.org');assert.equal(b.userIdentity.type,'telegram_id');assert.equal(b.userIdentity.telegramUsername,'tester');assert.equal(b.franchise.owner_telegram_id,'987654');return Response.json(status);};
 const result=await createRivarapayPayment({config:{...config,franchise:{type:'website',address:'https://example.test',owner_telegram_id:'987654'}},...payment,client:{email:null,telegramId:'123456',telegramUsername:'@TeSter'},description:'Fixture'});
 assert.equal(result.ok,true);assert.equal(calls,1);
});
test('invalid configuration, currency and missing identity never create an invoice; lost responses are not blindly retried',async()=>{
 let calls=0;globalThis.fetch=async()=>{calls++;throw Error('lost response');};
 const params={config,...payment,client:{email:'fixture@example.test',telegramId:null,telegramUsername:null},description:'Fixture'};
 assert.equal((await createRivarapayPayment({...params,currency:'USD'})).ok,false);
 assert.equal((await createRivarapayPayment({...params,config:{...config,sandbox:false}})).ok,false);
 assert.equal((await createRivarapayPayment({...params,client:{email:null,telegramId:null,telegramUsername:null}})).ok,false);assert.equal(calls,0);
 assert.equal((await createRivarapayPayment(params)).ok,false);assert.equal(calls,1);
 assert.equal(rivarapayIdentity({email:'User@example.test',telegramId:null,telegramUsername:null}).userIdentity.type,'email');
});
