import assert from 'node:assert/strict';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
const url=process.env.TEST_DATABASE_URL;
if(!url || !new URL(url).pathname.startsWith('/issue210_test')) throw Error('Use a disposable issue210_test database');
process.env.DATABASE_URL=url;process.env.NODE_ENV='test';process.env.JWT_SECRET='roulette-local-test-secret-at-least-32';
const users=new Map<string,any>(),patches:any[]=[];
let failRead=false,failWrite=false,ambiguous=false;
const fake=http.createServer(async(req,res)=>{
 let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{};
 res.setHeader('Content-Type','application/json');
 if(req.method==='GET'){
  if(failRead){res.statusCode=503;res.end('{}');return;}
  const user=users.get(req.url!.split('/').pop()!);if(!user){res.statusCode=404;res.end('{}');return;}
  res.end(JSON.stringify({response:user}));return;
 }
 if(failWrite){res.statusCode=503;res.end('{}');return;}
 const user=users.get(body.uuid);if(!user){res.statusCode=404;res.end('{}');return;}
 Object.assign(user,body);patches.push(body);
 if(ambiguous){res.statusCode=503;res.end('{}');return;}
 res.end(JSON.stringify({response:user}));
});
await new Promise<void>(r=>fake.listen(0,'127.0.0.1',r));
process.env.REMNA_API_URL=`http://127.0.0.1:${(fake.address() as any).port}`;process.env.REMNA_ADMIN_TOKEN='local-test';
const {prisma}=await import('../src/db.js');
const service=await import('../src/modules/roulette/roulette.service.js');
const ids:string[]=[],keys=['roulette_enabled','roulette_cooldown_hours','roulette_sectors'];
const saved=await prisma.systemSetting.findMany({where:{key:{in:keys}}});
const makeClient=async(data:any={})=>{const c=await prisma.client.create({data});ids.push(c.id);return c;};
async function setup(type:string,value=5){await service.updateRouletteSettings({enabled:true,cooldownHours:24,sectors:[{id:'only',type:type as any,value,label:`reward ${type}`,weight:1}]});}
async function subscription(clientId:string,limit=100,status='ACTIVE'){
 const uuid=randomUUID(),expireAt=new Date(Date.now()+86400000*10);
 users.set(uuid,{uuid,trafficLimitBytes:limit,expireAt:expireAt.toISOString(),status});
 return prisma.subscription.create({data:{ownerId:clientId,subscriptionIndex:0,remnawaveUuid:uuid,expireAt,trafficLimitBytes:limit,remnaStatus:status}});
}
async function failFinalization(enable:boolean){
 if(enable){
  await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION roulette_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status = 'APPLIED' THEN RAISE EXCEPTION 'test finalization failure'; END IF; RETURN NEW; END $$`);
  await prisma.$executeRawUnsafe('CREATE TRIGGER roulette_test_fail BEFORE UPDATE ON client_roulette_spins FOR EACH ROW EXECUTE FUNCTION roulette_test_fail()');
 }else{
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS roulette_test_fail ON client_roulette_spins');
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS roulette_test_fail()');
 }
}
try{
 await setup('balance',50);const c=await makeClient();
 const results=await Promise.allSettled(Array.from({length:8},()=>service.spinRoulette(c.id)));
 assert(results.some(r=>r.status==='fulfilled'));assert.equal((await prisma.client.findUniqueOrThrow({where:{id:c.id}})).balance,50);
 assert.equal(await prisma.clientRouletteSpin.count({where:{clientId:c.id}}),1);
 console.log('PASS: concurrent requests credit exactly once using database locking');
 const retry=await makeClient();await failFinalization(true);await assert.rejects(service.spinRoulette(retry.id));
 assert.equal((await prisma.client.findUniqueOrThrow({where:{id:retry.id}})).balance,0);
 assert.equal((await prisma.clientRouletteSpin.findFirstOrThrow({where:{clientId:retry.id}})).status,'PENDING');
 await failFinalization(false);await setup('balance',999);await service.spinRoulette(retry.id);
 assert.equal((await prisma.client.findUniqueOrThrow({where:{id:retry.id}})).balance,50);
 console.log('PASS: failed DB finalization rolls balance back; retry delivers saved prize after settings change');
 await setup('days');const d=await makeClient(),sub=await subscription(d.id),initial=sub.expireAt!.getTime();
 failRead=true;await assert.rejects(service.spinRoulette(d.id,sub.id));failRead=false;
 assert.equal(await prisma.clientRouletteSpin.count({where:{clientId:d.id}}),0);
 failWrite=true;await assert.rejects(service.spinRoulette(d.id,sub.id));failWrite=false;
 assert.equal((await prisma.subscription.findUniqueOrThrow({where:{id:sub.id}})).expireAt!.getTime(),initial);
 const pending=await service.getRouletteStatus(d.id);assert.equal(pending.pendingReward,true);assert.equal(pending.canSpin,true);assert.equal(pending.recentSpins.length,0);
 ambiguous=true;await assert.rejects(service.spinRoulette(d.id,sub.id));ambiguous=false;
 const target=Date.parse(users.get(sub.remnawaveUuid!).expireAt);assert.equal(target,initial+5*86400000);
 await failFinalization(true);await assert.rejects(service.spinRoulette(d.id,sub.id));await failFinalization(false);
 const loaded=await import('../src/modules/roulette/roulette.service.js?restart');await loaded.spinRoulette(d.id,sub.id);
 assert.equal(Date.parse(users.get(sub.remnawaveUuid!).expireAt),target);
 assert.equal((await prisma.subscription.findUniqueOrThrow({where:{id:sub.id}})).expireAt!.getTime(),target);
 assert.equal(await prisma.clientRouletteSpin.count({where:{clientId:d.id}}),1);
 console.log('PASS: failed reads/writes, ambiguous success, DB failure and restart preserve the days reward');
 await setup('traffic');const unlimited=await makeClient(),unlimitedSub=await subscription(unlimited.id,0),count=patches.length;
 const noLimit=await service.spinRoulette(unlimited.id,unlimitedSub.id);assert.equal(patches.length,count);
 assert.equal(users.get(unlimitedSub.remnawaveUuid!).trafficLimitBytes,0);assert.match(noLimit.reward.label,/безлимит/);
 const finite=await makeClient(),finiteSub=await subscription(finite.id,100);await service.spinRoulette(finite.id,finiteSub.id);
 assert.equal(users.get(finiteSub.remnawaveUuid!).trafficLimitBytes,100+5*1024**3);
 console.log('PASS: unlimited stays unlimited, finite traffic reward is added');
 await setup('days');const disabled=await makeClient(),disabledSub=await subscription(disabled.id,100,'DISABLED');await service.spinRoulette(disabled.id,disabledSub.id);
 assert.equal(users.get(disabledSub.remnawaveUuid!).status,'DISABLED');
 const blocked=await makeClient({isBlocked:true});await assert.rejects(service.spinRoulette(blocked.id));
 const stranger=await makeClient();await assert.rejects(service.spinRoulette(stranger.id,disabledSub.id),/не найдена/);
 assert.equal(await prisma.clientRouletteSpin.count({where:{clientId:stranger.id}}),0);
 const expired=await makeClient(),expiredSub=await subscription(expired.id,100,'EXPIRED');
 users.get(expiredSub.remnawaveUuid!).expireAt=new Date(Date.now()-86400000).toISOString();
 await service.spinRoulette(expired.id,expiredSub.id);assert.equal(users.get(expiredSub.remnawaveUuid!).status,'ACTIVE');
 const banned=await makeClient(),bannedSub=await subscription(banned.id,100,'EXPIRED');
 await prisma.subscription.update({where:{id:bannedSub.id},data:{bannedUntil:new Date(Date.now()+86400000)}});
 await service.spinRoulette(banned.id,bannedSub.id);assert.equal(users.get(bannedSub.remnawaveUuid!).status,'EXPIRED');
 console.log('PASS: disabled subscriptions remain disabled; blocked and foreign owners cannot claim');
 await setup('discount',10);const discount=await makeClient({personalDiscountPercent:30,personalDiscountIsOneTime:false});await service.spinRoulette(discount.id);
 const after=await prisma.client.findUniqueOrThrow({where:{id:discount.id}});assert.equal(after.personalDiscountPercent,30);assert.equal(after.personalDiscountIsOneTime,false);
 console.log('PASS: existing permanent discount is preserved');
 console.log('ALL ROULETTE DELIVERY CHECKS PASSED');
}finally{
 await failFinalization(false);await prisma.client.deleteMany({where:{id:{in:ids}}});
 await prisma.systemSetting.deleteMany({where:{key:{in:keys}}});for(const s of saved)await prisma.systemSetting.create({data:s});
 await prisma.$disconnect();await new Promise<void>(r=>fake.close(()=>r()));
}
