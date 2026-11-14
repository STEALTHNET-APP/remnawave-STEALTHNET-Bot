import assert from 'node:assert/strict';
import {mock,test,before,after} from 'node:test';
import {PrismaClient} from '@prisma/client';
import {createHash} from 'node:crypto';
const databaseName=process.env.HELEKET_TEST_DATABASE;
if (!databaseName || !/^issue44_test_[a-z0-9_]+$/.test(databaseName)) throw Error('Dedicated test database required');
const url=new URL(process.env.DATABASE_URL);url.pathname='/'+databaseName;
const db=new PrismaClient({datasourceUrl:url.href});
let failCredit=false, notifications=0, remaining=0, release, barrier;
const prisma=db.$extends({query:{payment:{async findFirst({args,query}){const row=await query(args);if(remaining){remaining--;if(!remaining)release();await barrier;}return row;}},client:{async update({args,query}){if(failCredit)throw Error('Injected credit failure');return query(args);}}}});
const noop=async()=>{};
mock.module('../dist/db.js',{namedExports:{prisma}});
mock.module('../dist/modules/client/client.service.js',{namedExports:{getSystemConfig:async()=>({heleketApiKey:'test-key'})}});
mock.module('../dist/modules/tariff/tariff-activation.service.js',{namedExports:{activateTariffByPaymentId:async()=>{throw Error('Unexpected activation');}}});
mock.module('../dist/modules/proxy/proxy-slots-activation.service.js',{namedExports:{createProxySlotsByPaymentId:noop}});
mock.module('../dist/modules/singbox/singbox-slots-activation.service.js',{namedExports:{createSingboxSlotsByPaymentId:noop}});
mock.module('../dist/modules/extra-options/extra-options.service.js',{namedExports:{applyExtraOptionByPaymentId:noop}});
mock.module('../dist/modules/referral/referral.service.js',{namedExports:{distributeReferralRewards:noop}});
mock.module('../dist/modules/notification/telegram-notify.service.js',{namedExports:{notifyBalanceToppedUp:async()=>{notifications++;},notifyTariffActivated:noop,notifyProxySlotsCreated:noop,notifySingboxSlotsCreated:noop}});
mock.module('../dist/modules/payment/promo-code-usage.util.js',{namedExports:{recordPromoCodeUsageFromPayment:noop}});
mock.module('../dist/modules/payment/payment-webhook-audit.util.js',{namedExports:{auditPaymentClientBotAlignment:noop}});
const {heleketWebhooksRouter}=await import('../dist/modules/webhooks/heleket.webhooks.routes.js');
const handler=heleketWebhooksRouter.stack.find(l=>l.route).route.stack.at(-1).handle;
let client;
before(async()=>{assert.equal(await db.client.count(),0);client=await db.client.create({data:{id:'issue44-client',email:'issue44@example.invalid',referralCode:'issue44-test',balance:0}});});
after(async()=>{await db.$disconnect();});
function payload(order_id){const data={type:'payment',uuid:'invoice-'+order_id,order_id,status:'paid',amount:'100.00000000',currency:'USD'};const sign=createHash('md5').update(Buffer.from(JSON.stringify(data)).toString('base64')+'test-key').digest('hex');return Buffer.from(JSON.stringify({...data,sign}));}
async function send(id){const res={statusCode:200,status(code){this.statusCode=code;return this;},send(){return this;}};await handler({body:payload(id)},res);return res.statusCode;}
async function create(id){return db.payment.create({data:{id,orderId:id,clientId:client.id,provider:'heleket',amount:100,currency:'USD',status:'PENDING'}});}
test('8 simultaneous signed callbacks credit once in PostgreSQL',async()=>{await create('concurrent');remaining=8;barrier=new Promise(r=>release=r);assert.deepEqual(await Promise.all(Array.from({length:8},()=>send('concurrent'))),Array(8).fill(200));assert.equal((await db.client.findUniqueOrThrow({where:{id:client.id}})).balance,100);assert.equal(notifications,1);assert.equal(await send('concurrent'),200);assert.equal((await db.client.findUniqueOrThrow({where:{id:client.id}})).balance,100);});
test('failed credit rolls back status; retry credits once',async()=>{await create('rollback');failCredit=true;assert.equal(await send('rollback'),503);assert.equal((await db.payment.findUniqueOrThrow({where:{id:'rollback'}})).status,'PENDING');assert.equal((await db.client.findUniqueOrThrow({where:{id:client.id}})).balance,100);failCredit=false;assert.equal(await send('rollback'),200);assert.equal((await db.client.findUniqueOrThrow({where:{id:client.id}})).balance,200);});
