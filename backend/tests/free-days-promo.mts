/** Integration regression for #210. Requires a disposable Postgres database whose name starts with issue210_test.
 * TEST_DATABASE_URL=postgresql://.../issue210_test node --import tsx tests/free-days-promo.mts
 * Apply prisma/schema.prisma to that database first. Remnawave is a local HTTP fake, never a live panel.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import express from 'express';
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || !new URL(testUrl).pathname.startsWith('/issue210_test')) throw new Error('Use a disposable issue210_test database');
process.env.DATABASE_URL=testUrl;
process.env.NODE_ENV='test';
process.env.JWT_SECRET='issue210-integration-only-secret-32-characters';
const squadA=randomUUID(), squadB=randomUUID();
const users=new Map<string,any>();
const writes:any[]=[];
let readError=false, writeError=false, nested=false;
const fake=http.createServer(async(req,res)=>{
  let raw='';for await(const b of req)raw+=b;
  const body=raw?JSON.parse(raw):{};
  res.setHeader('Content-Type','application/json');
  const pathname=new URL(req.url!,'http://local').pathname;
  if ((readError && req.method==='GET' && pathname.startsWith('/api/users/')) || (writeError && req.method!=='GET')) {
    res.statusCode=503;res.end(JSON.stringify({message:'Simulated upstream failure'}));return;
  }
  let data:any;
  if(pathname==='/api/internal-squads')data={internalSquads:[{uuid:squadA},{uuid:squadB}]};
  else if(pathname==='/api/users' && req.method==='POST'){
    if([...users.values()].some(u=>u.username===body.username)){res.statusCode=400;res.end(JSON.stringify({message:'already exists'}));return;}
    const uuid=randomUUID();data={...body,uuid,status:'ACTIVE',shortUuid:uuid,subscriptionUrl:`https://example.invalid/sub/${uuid}`,userTraffic:{usedTrafficBytes:0}};
    users.set(uuid,data);writes.push({method:'POST',body});
  } else if(pathname==='/api/users' && req.method==='PATCH'){
    data=users.get(body.uuid);if(!data){res.statusCode=404;res.end('{}');return;}
    Object.assign(data,body);writes.push({method:'PATCH',body});
  } else if(pathname.endsWith('/actions/reset-traffic'))data={};
  else if(pathname.startsWith('/api/users/')){
    data=users.get(pathname.split('/').pop()!);if(!data){res.statusCode=404;res.end('{}');return;}
  } else data={users:[]};
  res.end(JSON.stringify(nested?{data:{response:data}}:{response:data}));
});
await new Promise<void>(r=>fake.listen(0,'127.0.0.1',r));
process.env.REMNA_API_URL=`http://127.0.0.1:${(fake.address() as any).port}`;
process.env.REMNA_ADMIN_TOKEN='local-fake-only';
const {prisma}=await import('../src/db.js');
const {clientRouter}=await import('../src/modules/client/client.routes.js');
const {adminRouter}=await import('../src/modules/admin/admin.routes.js');
const {promoBulkRouter}=await import('../src/modules/promo-bulk/promo-bulk.routes.js');
const {signClientToken,invalidateSystemConfigCache}=await import('../src/modules/client/client.service.js');
const {signAccessToken}=await import('../src/modules/auth/auth.service.js');
const {grantSubscriptionTariff}=await import('../src/modules/admin/grant-subscription.service.js');
const {activateTariffByPaymentId}=await import('../src/modules/tariff/tariff-activation.service.js');
const app=express();app.use(express.json());
app.use('/api/client',clientRouter);app.use('/api/admin/promo-codes',promoBulkRouter);app.use('/api/admin',adminRouter);
app.use((error:any,_req:any,res:any,_next:any)=>{console.error(error);res.status(500).json({message:error.message});});
const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
const base=`http://127.0.0.1:${(server.address() as any).port}`;
const prefix=`issue210-${Date.now()}`;
const clientIds:string[]=[], promoIds:string[]=[];
let category:any, admin:any;
async function request(path:string, token:string, body?:any, method=body?'POST':'GET') {
 const r=await fetch(base+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 return {status:r.status,data:await r.json()};
}
async function newClient(){const c=await prisma.client.create({data:{email:`${prefix}-${clientIds.length}@local.test`}});clientIds.push(c.id);return c;}
async function promo(tariffId:string, extra:any={}){const p=await prisma.promoCode.create({data:{code:`${prefix}-${randomUUID()}`,name:prefix,type:'FREE_DAYS',tariffId,durationDays:30,...extra}});promoIds.push(p.id);return p;}
const activate=(c:any,p:any)=>request('/api/client/promo-code/activate',signClientToken(c.id),{code:p.code});
const primary=(c:any)=>prisma.subscription.findUniqueOrThrow({where:{ownerId_subscriptionIndex:{ownerId:c.id,subscriptionIndex:0}}});
function pass(name:string){console.log(`PASS ${name}`);}
try {
 category=await prisma.tariffCategory.create({data:{name:prefix}});
 const a=await prisma.tariff.create({data:{categoryId:category.id,name:'Promo A',durationDays:7,price:70,internalSquadUuids:[squadA],includedDevices:3,trafficLimitBytes:10n*1024n**3n}});
 const b=await prisma.tariff.create({data:{categoryId:category.id,name:'Paid B',durationDays:30,price:300,internalSquadUuids:[squadB],includedDevices:5,trafficLimitBytes:50n*1024n**3n}});
 const option=await prisma.tariffPriceOption.create({data:{tariffId:a.id,durationDays:31,price:250}});
 admin=await prisma.admin.create({data:{email:`${prefix}@admin.test`,passwordHash:'not-a-login-password',mustChangePassword:false}});
 const adminToken=signAccessToken({adminId:admin.id,email:admin.email},process.env.JWT_SECRET!,'1h');
 // Configure single mode only in the disposable DB; production settings are never read.
 await prisma.systemSetting.upsert({where:{key:'multi_subscriptions_enabled'},create:{key:'multi_subscriptions_enabled',value:'false'},update:{value:'false'}});
 invalidateSystemConfigCache();
 const created=await request('/api/admin/promo-codes',adminToken,{code:`${prefix}-admin`,name:prefix,type:'FREE_DAYS',tariffId:a.id,tariffPriceOptionId:option.id,durationDays:7,maxUses:0,maxUsesPerClient:1});
 assert.equal(created.status,200);promoIds.push(created.data.id);assert.equal(created.data.durationDays,31);assert.equal(created.data.squadUuid,null);
 const wrong=await request('/api/admin/promo-codes',adminToken,{code:`${prefix}-bad`,name:prefix,type:'FREE_DAYS',tariffId:b.id,tariffPriceOptionId:option.id});assert.equal(wrong.status,400);
 const bulk=await request('/api/admin/promo-codes/bulk-generate',adminToken,{count:2,prefix:'T210',type:'FREE_DAYS',tariffId:a.id,tariffPriceOptionId:option.id,maxUses:1,maxUsesPerClient:1});
 assert.equal(bulk.status,200);assert.equal(bulk.data.generated.length,2);
 const bulkRows=await prisma.promoCode.findMany({where:{code:{in:bulk.data.generated}}});promoIds.push(...bulkRows.map(p=>p.id));assert.ok(bulkRows.every(p=>p.tariffId===a.id&&p.durationDays===31));pass('single/bulk creation use tariff and matching duration option');
 const c=await newClient();let r=await activate(c,created.data);assert.equal(r.status,200);
 let sub=await primary(c);const uuid=sub.remnawaveUuid!;const originalId=sub.id;
 assert.equal(sub.tariffId,a.id);assert.equal(sub.expireAt!.toISOString(),users.get(uuid).expireAt);
 assert.deepEqual(users.get(uuid).activeInternalSquads,[squadA]);assert.equal(users.get(uuid).hwidDeviceLimit,3);
 assert.equal((await prisma.client.findUniqueOrThrow({where:{id:c.id}})).remnawaveUuid,uuid);
 const details=await request('/api/client/subscription',signClientToken(c.id));assert.equal(details.status,200);assert.ok(JSON.stringify(details.data).includes(`https://example.invalid/sub/${uuid}`));assert.equal(details.data.tariffDisplayName,'Promo A');
 pass('new client receives real Subscription[0], tariff, expiry and subscription link');
 const before=users.get(uuid).expireAt;const n=writes.length;r=await activate(c,created.data);assert.equal(r.status,400);assert.equal(writes.length,n);assert.equal(users.get(uuid).expireAt,before);pass('repeat activation adds no days and creates no user');
 const beforeGrant=users.size;const grant=await grantSubscriptionTariff(c.id,a);assert.equal(grant.ok,true);sub=await primary(c);assert.equal(sub.id,originalId);assert.equal(sub.remnawaveUuid,uuid);assert.equal(users.size,beforeGrant);
 const pay=await prisma.payment.create({data:{clientId:c.id,orderId:randomUUID(),amount:250,currency:'rub',status:'PAID',provider:'balance',tariffId:a.id,tariffPriceOptionId:option.id}});
 const purchase=await activateTariffByPaymentId(pay.id);assert.equal(purchase.ok,true);assert.equal((await primary(c)).remnawaveUuid,uuid);assert.equal(users.size,beforeGrant);pass('admin grant and paid activation in single mode reuse the same subscription and Remnawave user');
 // Promo-to-paid upgrade must also work in multi mode, including a different tariff.
 for (const multi of [false,true]) {
  await prisma.systemSetting.update({where:{key:'multi_subscriptions_enabled'},data:{value:String(multi)}});invalidateSystemConfigCache();
  for (const via of ['grant','payment']) for (const target of [a,b]) {
   const fresh=await newClient();assert.equal((await activate(fresh,await promo(a.id))).status,200);
   const original=await primary(fresh);assert.equal(original.promoGranted,true);
   const count=users.size;const expiry=Date.parse(users.get(original.remnawaveUuid!).expireAt);
   const preview=await request(`/api/client/tariff-conversion-preview?tariffId=${target.id}`,signClientToken(fresh.id));
   assert.equal(preview.status,200);assert.equal(preview.data.convertedDays,preview.data.remainingDays);
   const result=via==='grant' ? await grantSubscriptionTariff(fresh.id,target)
     : await activateTariffByPaymentId((await prisma.payment.create({data:{clientId:fresh.id,orderId:randomUUID(),amount:target.price,currency:'rub',status:'PAID',provider:'balance',tariffId:target.id}})).id);
   assert.equal(result.ok,true);const upgraded=await primary(fresh);
   assert.equal(upgraded.id,original.id);assert.equal(upgraded.remnawaveUuid,original.remnawaveUuid);assert.equal(upgraded.tariffId,target.id);assert.equal(upgraded.promoGranted,false);
   assert.equal(users.size,count);assert.equal(Date.parse(users.get(upgraded.remnawaveUuid!).expireAt)-expiry,target.durationDays*86400000);
  }
 }
 // After the promo has become paid, normal multi-subscription grants are still new purchases.
 const ordinary=await newClient();await activate(ordinary,await promo(a.id));await grantSubscriptionTariff(ordinary.id,a);
 const beforeOrdinary=users.size;await grantSubscriptionTariff(ordinary.id,a);assert.equal(users.size,beforeOrdinary+1);
 await prisma.systemSetting.update({where:{key:'multi_subscriptions_enabled'},data:{value:'false'}});invalidateSystemConfigCache();
 pass('first promo upgrade reuses UUID and all remaining days for both modes, both purchase paths, same/different tariff; normal multi grants preserved');
 // An empty primary placeholder must become a promo subscription as well.
 const placeholder=await newClient();const empty=await prisma.subscription.create({data:{ownerId:placeholder.id,subscriptionIndex:0}});
 assert.equal((await activate(placeholder,await promo(a.id))).status,200);
 const filled=await primary(placeholder);assert.equal(filled.id,empty.id);assert.equal(filled.promoGranted,true);assert.equal(filled.tariffId,a.id);
 pass('empty primary placeholder is populated and remains eligible for the first paid upgrade');
 // Existing paid subscription is authoritative even with a stale client.remnawaveUuid.
 await prisma.subscription.update({where:{id:sub.id},data:{tariffId:b.id,extraDevices:2,customPrice:777,autoRenewEnabled:true}});
 const paidUser=users.get(uuid);Object.assign(paidUser,{activeInternalSquads:[squadB,'addon'],hwidDeviceLimit:7,trafficLimitBytes:999,status:'DISABLED'});
 const orphan=randomUUID();users.set(orphan,{uuid:orphan,expireAt:new Date(Date.now()+86400000).toISOString(),activeInternalSquads:[squadA],status:'ACTIVE'});
 await prisma.client.update({where:{id:c.id},data:{remnawaveUuid:orphan}});
 const paidBefore=structuredClone(paidUser);nested=true;const bonus=await promo(a.id);r=await activate(c,bonus);nested=false;assert.equal(r.status,200);
 const patched=writes.at(-1).body;assert.deepEqual(Object.keys(patched).sort(),['expireAt','uuid']);assert.equal(patched.uuid,uuid);
 assert.equal(Date.parse(paidUser.expireAt)-Date.parse(paidBefore.expireAt),30*86400000);
 for(const key of ['activeInternalSquads','hwidDeviceLimit','trafficLimitBytes','status'])assert.deepEqual(paidUser[key],paidBefore[key]);
 sub=await primary(c);assert.equal(sub.tariffId,b.id);assert.equal(sub.customPrice,777);assert.equal(sub.extraDevices,2);assert.equal(sub.autoRenewEnabled,true);assert.equal(sub.remnaStatus,'DISABLED');pass('paid tariff, add-on squads, device/traffic limits, manual block and renewal preferences preserved; nested response handled');
 // Legacy orphan belonging to this client is adopted, not duplicated.
 const legacy=await newClient();const legacyUuid=randomUUID();users.set(legacyUuid,{uuid:legacyUuid,username:'legacy-'+legacy.id,expireAt:new Date(Date.now()+86400000).toISOString(),status:'ACTIVE',activeInternalSquads:[squadA]});
 await prisma.client.update({where:{id:legacy.id},data:{remnawaveUuid:legacyUuid}});
 const legacyPromo=await promo(a.id,{tariffId:null,squadUuid:squadA});const legacyCount=users.size;r=await activate(legacy,legacyPromo);assert.equal(r.status,200);assert.equal((await primary(legacy)).remnawaveUuid,legacyUuid);assert.equal(users.size,legacyCount);pass('old squad-only promo resolves an unambiguous tariff and adopts an existing legacy user');
 // Expired status is reactivated, while existing limits remain.
 users.get(legacyUuid).status='EXPIRED';users.get(legacyUuid).expireAt=new Date(Date.now()-86400000).toISOString();
 r=await activate(legacy,await promo(a.id));assert.equal(r.status,200);assert.equal(users.get(legacyUuid).status,'ACTIVE');assert.ok(Date.parse(users.get(legacyUuid).expireAt)>Date.now()+29*86400000);pass('expired subscription extends from now and is reactivated');
 const failing=await promo(a.id);const saved=(await primary(c)).expireAt!.toISOString();readError=true;r=await activate(c,failing);readError=false;assert.equal(r.status,502);
 writeError=true;r=await activate(c,failing);writeError=false;assert.equal(r.status,502);assert.equal(await prisma.promoCodeUsage.count({where:{promoCodeId:failing.id}}),0);assert.equal((await primary(c)).expireAt!.toISOString(),saved);
 const newFail=await newClient();writeError=true;r=await activate(newFail,failing);writeError=false;assert.equal(r.status,502);assert.equal(await prisma.subscription.count({where:{ownerId:newFail.id}}),0);pass('Remnawave read/create/update failures never report success or consume a code');
 const concurrent=await newClient(),concurrentPromo=await promo(a.id);const size=users.size;
 const parallel=await Promise.all([activate(concurrent,concurrentPromo),activate(concurrent,concurrentPromo)]);assert.deepEqual(parallel.map(x=>x.status).sort(),[200,400]);assert.equal(users.size,size+1);assert.equal(await prisma.promoCodeUsage.count({where:{promoCodeId:concurrentPromo.id}}),1);pass('concurrent duplicate requests create one user and one usage');
 const limited=await promo(a.id,{maxUses:1});const c1=await newClient(),c2=await newClient();const limitResults=await Promise.all([activate(c1,limited),activate(c2,limited)]);assert.deepEqual(limitResults.map(x=>x.status).sort(),[200,400]);pass('global maxUses enforced across concurrent clients');
 const third=await prisma.tariff.create({data:{categoryId:category.id,name:'Ambiguous',durationDays:7,internalSquadUuids:[squadA]}});
 const ambiguous=await promo(a.id,{tariffId:null,squadUuid:squadA});const unchanged=writes.length;r=await activate(c,ambiguous);assert.equal(r.status,400);assert.equal(writes.length,unchanged);pass('ambiguous legacy tariff is rejected without consuming the code');
 console.log('ALL FREE_DAYS INTEGRATION CHECKS PASSED');
} finally {
 readError=false;writeError=false;
 await prisma.promoCode.deleteMany({where:{id:{in:promoIds}}});
 await prisma.client.deleteMany({where:{id:{in:clientIds}}});
 if(category)await prisma.tariffCategory.delete({where:{id:category.id}});
 if(admin)await prisma.admin.delete({where:{id:admin.id}});
 server.closeAllConnections();server.close();fake.closeAllConnections();fake.close();await prisma.$disconnect();
}
