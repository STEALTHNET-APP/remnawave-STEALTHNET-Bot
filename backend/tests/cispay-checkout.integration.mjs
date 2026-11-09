import test,{mock,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import express from 'express';
import multer from 'multer';
if(!process.env.DATABASE_URL?.includes('/updaterqa_review'))throw Error('Isolated database required');
process.env.NODE_ENV='test';process.env.JWT_SECRET='isolated-checkout-secret-123456789';
const upload=multer({storage:multer.memoryStorage()});
mock.module(new URL('../dist/lib/upload.js',import.meta.url),{namedExports:{uploadMascotImage:upload,uploadVideo:upload,uploadTicketAttachment:upload,removeUploadedFile(){},mascotUrl:n=>n,videoUploadUrl:n=>n,ticketAttachmentUrl:n=>n}});
const remna=await import('../dist/modules/remna/remna.client.js');
mock.module(new URL('../dist/modules/remna/remna.client.js',import.meta.url),{namedExports:{...remna,probeRemnaHealth:async()=>true}});
const {prisma}=await import('../dist/db.js');
const {signAccessToken}=await import('../dist/modules/auth/auth.service.js');
const {signClientToken,getPublicConfig,invalidateSystemConfigCache}=await import('../dist/modules/client/client.service.js');
const {adminRouter}=await import('../dist/modules/admin/admin.routes.js');
const {clientRouter}=await import('../dist/modules/client/client.routes.js');
const admin=await prisma.admin.create({data:{email:`${randomUUID()}@example.invalid`,passwordHash:'fixture',mustChangePassword:false}});
const client=await prisma.client.create({data:{}});
const category=await prisma.tariffCategory.create({data:{name:'CisPay fixture'}});
const tariff=await prisma.tariff.create({data:{categoryId:category.id,name:'Fixture',durationDays:30,price:100,currency:'RUB',internalSquadUuids:[],maxExtraDevices:5,pricePerExtraDevice:10}});
const sub=await prisma.subscription.create({data:{ownerId:client.id,subscriptionIndex:0,tariffId:tariff.id,extraDevices:4,extraDevicesMonthlyPrice:40,remnawaveUuid:randomUUID(),expireAt:new Date(Date.now()+86400000)}});
const keys=['cispay_enabled','cispay_shop_id','cispay_api_key','cispay_sandbox','bot_htmlbubbles_test'];
const before=await prisma.systemSetting.findMany({where:{key:{in:keys}}});
const app=express();app.use(express.json());app.use('/admin',adminRouter);app.use('/client',clientRouter);app.use((e,req,res,next)=>res.status(500).json({message:e.message}));
const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
const base=`http://127.0.0.1:${server.address().port}`;
const adminToken=signAccessToken({adminId:admin.id,email:admin.email},process.env.JWT_SECRET,'10m'),clientToken=signClientToken(client.id);
let creates=0,failCreate=false,lastAmount=0;const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,init)=>{
 if(String(url)==='https://api.cispay.app/payments'){creates++;const b=JSON.parse(init.body);lastAmount=b.amount;if(failCreate)throw Error('Response lost');return Response.json({id:randomUUID(),order_id:b.order_id,payment_url:'https://pay.cispay.app/fixture'});}
 return originalFetch(url,init);
};
async function request(path,body,token=clientToken,method='POST'){
 const r=await fetch(base+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json()};
}
after(async()=>{globalThis.fetch=originalFetch;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await prisma.client.delete({where:{id:client.id}});await prisma.tariff.delete({where:{id:tariff.id}});await prisma.tariffCategory.delete({where:{id:category.id}});await prisma.admin.delete({where:{id:admin.id}});await prisma.systemSetting.deleteMany({where:{key:{in:keys}}});for(const s of before)await prisma.systemSetting.create({data:{key:s.key,value:s.value}});invalidateSystemConfigCache();await prisma.$disconnect();});
test('admin settings roundtrip masks key and public config only exposes capability flags',async()=>{
 const patch={cispayEnabled:true,cispayShopId:randomUUID(),cispayApiKey:'cis_sec_fixture',cispaySandbox:false,botHtmlBubblesTest:true};
 const r=await request('/admin/settings',patch,adminToken,'PATCH');assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.cispayApiKey,'********');assert.equal(r.data.botHtmlBubblesTest,true);
 const publicConfig=await getPublicConfig();assert.equal(publicConfig.cispayEnabled,true);assert.equal(publicConfig.botHtmlBubblesTest,true);assert.equal(publicConfig.cispayApiKey,undefined);assert.equal(publicConfig.cispayShopId,undefined);
 const masked=await request('/admin/settings',{cispayApiKey:'********'},adminToken,'PATCH');assert.equal(masked.status,200);assert.equal((await prisma.systemSetting.findUnique({where:{key:'cispay_api_key'}})).value,'cis_sec_fixture');
 assert.equal((await request('/admin/settings',{cispayEnabled:false},clientToken,'PATCH')).status,401);
});
test('device-cap incident is rejected before creating an invoice; valid renewal uses server price',async()=>{
 creates=0;const invalid=await request('/client/cispay/create-payment',{tariffId:tariff.id,extendsSecondarySubId:sub.id,deviceCount:2,amount:1});assert.equal(invalid.status,400,JSON.stringify(invalid.data));assert.equal(creates,0);
 const valid=await request('/client/cispay/create-payment',{tariffId:tariff.id,extendsSecondarySubId:sub.id,deviceCount:1,amount:1});assert.equal(valid.status,201,JSON.stringify(valid.data));assert.equal(lastAmount,15000);assert.equal(creates,1);
 const p=await prisma.payment.findUnique({where:{id:valid.data.paymentId}});assert.equal(p.amount,150);assert.equal(p.provider,'cispay');assert.equal(JSON.parse(p.metadata).extendsSecondarySubId,sub.id);assert.ok(p.externalId);
});
test('wrong duration and unsupported currency do not create an invoice',async()=>{
 const n=creates;assert.equal((await request('/client/cispay/create-payment',{tariffId:tariff.id,tariffPriceOptionId:'unknown'})).status,400);assert.equal((await request('/client/cispay/create-payment',{amount:12,currency:'EUR'})).status,400);assert.equal(creates,n);
});
test('lost creation response retains the pending order for later webhook reconciliation',async()=>{
 failCreate=true;const n=await prisma.payment.count({where:{clientId:client.id}});const r=await request('/client/cispay/create-payment',{amount:260,currency:'RUB'});assert.equal(r.status,502);assert.ok(r.data.paymentId);assert.equal(await prisma.payment.count({where:{clientId:client.id}}),n+1);assert.equal((await prisma.payment.findUnique({where:{id:r.data.paymentId}})).status,'PENDING');failCreate=false;
});
