import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {prisma} from '../dist/db.js';
const dist=process.env.QA_DIST || path.resolve(import.meta.dirname,'../dist');
const context=vm.createContext({console,Date,JSON,Promise,Error,Number,Math,Set,Map});
const loaded=new Map();
let remoteDevices=1, remoteUpdates=0, giftCalls=0, giftFailure=false;
const synthetic=async(key,exports)=>{
 if(loaded.has(key))return loaded.get(key);
 const m=new vm.SyntheticModule(Object.keys(exports),function(){for(const [k,v]of Object.entries(exports))this.setExport(k,v);},{context});
 loaded.set(key,m);await m.link(()=>{});await m.evaluate();return m;
};
async function moduleAt(file){
 if(loaded.has(file))return loaded.get(file);
 const m=new vm.SourceTextModule(fs.readFileSync(file,'utf8'),{context,identifier:file,importModuleDynamically:async(spec,ref)=>{const child=await resolve(spec,ref);if(child.status!=='evaluated')await child.evaluate();return child;}});
 loaded.set(file,m);await m.link(resolve);await m.evaluate();return m;
}
async function resolve(spec,ref){
 if(spec.endsWith('/db.js'))return synthetic('db',{prisma});
 if(spec==='node:crypto')return synthetic('crypto',{randomUUID});
 if(spec.endsWith('/client.service.js'))return synthetic('config',{getSystemConfig:async()=>({multiSubscriptionsEnabled:true})});
 if(spec.endsWith('/telegram-notify.service.js'))return synthetic('notify',{notifyAdminsAboutTrialActivated:async()=>{}});
 if(spec.endsWith('/subscription.helpers.js'))return synthetic('subscriptionHelpers',{upsertSubscriptionByRemnaUuid:()=>{throw Error('Unexpected upsert');}});
 if(spec.endsWith('/multi-subscriptions.js'))return synthetic('multi',{isMultiSubscriptionsEnabled:()=>true});
 if(spec.endsWith('/remna.client.js'))return synthetic('remna',{remnaCreateUser:()=>{},remnaGetUserByTelegramId:()=>{},remnaGetUserByEmail:()=>{},extractRemnaUuid:()=>{},remnaUsernameFromClient:()=>{},remnaResetUserTraffic:async()=>({status:200}),remnaDeleteUser:()=>{},isRemnaConfigured:()=>true,remnaGetUser:async()=>({data:{response:{hwidDeviceLimit:remoteDevices,status:'ACTIVE',expireAt:new Date(Date.now()+86400000).toISOString(),subscriptionUrl:'https://example.invalid/qa'}}}),remnaUpdateUser:async({hwidDeviceLimit})=>{await new Promise(resolve=>setTimeout(resolve,10));remoteDevices=hwidDeviceLimit;remoteUpdates++;return{data:{},status:200};}});
 if(spec.endsWith('/gift.service.js'))return synthetic('gift',{deleteSubscription:()=>{throw Error('Unexpected delete');},createAdditionalSubscription:async(clientId)=>{
  giftCalls++;
  if(giftFailure)return{ok:false,status:400,error:'test refusal'};
  const sub=await prisma.subscription.create({data:{ownerId:clientId,subscriptionIndex:0,remnawaveUuid:'qa-'+randomUUID(),expireAt:new Date(Date.now()+86400000)}});
  return{ok:true,data:{subscriptionId:sub.id,subscriptionIndex:0}};
 }});
 return moduleAt(path.resolve(path.dirname(ref.identifier),spec));
}
const tag='qa42-43-'+Date.now();let category,tariff,trial;const clients=[];
try{
 category=await prisma.tariffCategory.create({data:{name:tag}});
 tariff=await prisma.tariff.create({data:{name:tag,categoryId:category.id,durationDays:30,maxExtraDevices:5,includedDevices:1,internalSquadUuids:[]}});
 trial=await prisma.trial.create({data:{name:tag,price:10,durationDays:1,squadUuids:'["qa"]'}});
 const fresh=async()=>{const c=await prisma.client.create({data:{email:randomUUID()+'@example.invalid',balance:100}});clients.push(c);return c;};
 const trialService=(await moduleAt(path.join(dist,'modules/trial/trial.service.js'))).namespace;
 const paid=await fresh();
 const results=await Promise.all(Array.from({length:8},()=>trialService.activateTrial(paid.id,trial.id,10)));
 assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(giftCalls,1);
 assert.equal((await prisma.client.findUnique({where:{id:paid.id}})).balance,90);
 assert.equal(await prisma.payment.count({where:{clientId:paid.id,status:'PAID'}}),1);
 const poor=await fresh();await prisma.client.update({where:{id:poor.id},data:{balance:1}});
 assert.equal((await trialService.activateTrial(poor.id,trial.id,10)).body.code,'INSUFFICIENT_BALANCE');
 assert.equal(await prisma.clientTrialUsage.count({where:{clientId:poor.id}}),0);
 const refused=await fresh();giftFailure=true;
 assert.equal((await trialService.activateTrial(refused.id,trial.id,10)).status,400);
 assert.equal((await prisma.client.findUnique({where:{id:refused.id}})).balance,100);
 assert.equal(await prisma.payment.count({where:{clientId:refused.id,status:'FAILED'}}),1);
 giftFailure=false;
 const deviceClient=await fresh();
 const sub=await prisma.subscription.create({data:{ownerId:deviceClient.id,subscriptionIndex:0,tariffId:tariff.id,remnawaveUuid:'qa-'+randomUUID(),expireAt:new Date(Date.now()+86400000)}});
 const cap=(await moduleAt(path.join(dist,'modules/extra-options/device-limit.js'))).namespace;
 const extra=(await moduleAt(path.join(dist,'modules/extra-options/extra-options.service.js'))).namespace;
 await cap.validateTariffDevices(prisma,deviceClient.id,tariff.id,5);
 await assert.rejects(()=>cap.validateTariffDevices(prisma,deviceClient.id,tariff.id,6));
 const invoices=[];
 for(let n=0;n<5;n++){
  const metadata=await prisma.$transaction(tx=>cap.validateDevicePurchase(tx,deviceClient.id,JSON.stringify({extraOption:{kind:'devices',deviceCount:2,productPriceMonthly:10}})));
  invoices.push(await prisma.payment.create({data:{clientId:deviceClient.id,orderId:randomUUID(),amount:10,currency:'RUB',provider:'qa',status:'PAID',metadata}}));
 }
 const deliveries=await Promise.all(invoices.map(p=>extra.applyExtraOptionByPaymentId(p.id)));
 assert.equal(deliveries.filter(r=>r.creditedToBalance).length,3);
 assert.equal((await prisma.subscription.findUnique({where:{id:sub.id}})).extraDevices,4);
 assert.equal(remoteDevices,5);assert.equal(remoteUpdates,2);
 await assert.rejects(()=>cap.validateTariffDevices(prisma,deviceClient.id,tariff.id,2,{extendsSecondarySubId:sub.id}));
 await cap.validateTariffDevices(prisma,deviceClient.id,tariff.id,5,{extendsSecondarySubId:sub.id,removeExtrasOnActivate:true});
 assert.equal((await prisma.client.findUnique({where:{id:deviceClient.id}})).balance,130);
 await Promise.all(invoices.map(p=>extra.applyExtraOptionByPaymentId(p.id)));
 assert.equal(remoteUpdates,2);
 assert.equal((await prisma.client.findUnique({where:{id:deviceClient.id}})).balance,130);
 await assert.rejects(()=>prisma.$transaction(tx=>cap.validateDevicePurchase(tx,deviceClient.id,JSON.stringify({extraOption:{kind:'devices',deviceCount:2}}))));
 const renewals=(await moduleAt(path.join(dist,'modules/tariff/tariff-activation.service.js'))).namespace;
 await prisma.tariff.update({where:{id:tariff.id},data:{maxExtraDevices:1}});
 const racing=await fresh();
 const racingSub=await prisma.subscription.create({data:{ownerId:racing.id,subscriptionIndex:0,tariffId:tariff.id,remnawaveUuid:'qa-'+randomUUID(),expireAt:new Date(Date.now()+86400000)}});
 const racingMeta=await cap.validateDevicePurchase(prisma,racing.id,JSON.stringify({extraOption:{kind:'devices',deviceCount:1,productPriceMonthly:10}}));
 const racingPayment=await prisma.payment.create({data:{clientId:racing.id,orderId:randomUUID(),amount:10,currency:'RUB',provider:'qa',status:'PAID',metadata:racingMeta}});
 remoteDevices=1;remoteUpdates=0;
 const [renewed,packageResult]=await Promise.all([
  renewals.extendSecondarySubscription(racingSub.id,{...tariff,maxExtraDevices:1},undefined,1),
  extra.applyExtraOptionByPaymentId(racingPayment.id)
 ]);
 assert.equal((await prisma.subscription.findUnique({where:{id:racingSub.id}})).extraDevices,1);
 assert.equal(remoteDevices,2);assert.equal(remoteUpdates,1);
 assert(renewed.ok ? packageResult.creditedToBalance : packageResult.ok && !packageResult.creditedToBalance);
 console.log('PASS PostgreSQL: renewal and separate device package share one lock and cannot exceed the cap');
 console.log('PASS PostgreSQL: concurrent paid trials debit once; insufficient balance rolls back; rejection refunds; device cap and late invoice credit are atomic and idempotent');
}finally{
 for(const client of clients){await prisma.clientTrialUsage.deleteMany({where:{clientId:client.id}});await prisma.payment.deleteMany({where:{clientId:client.id}});await prisma.subscription.deleteMany({where:{ownerId:client.id}});await prisma.client.delete({where:{id:client.id}});}
 if(trial)await prisma.trial.delete({where:{id:trial.id}});
 if(tariff)await prisma.tariff.delete({where:{id:tariff.id}});
 if(category)await prisma.tariffCategory.delete({where:{id:category.id}});
 await prisma.$disconnect();
}
