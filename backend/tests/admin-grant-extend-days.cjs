// Admin "Продлить подписку" for trial / tariff-less subscriptions: days-only extension.
// Runs without database/Remnawave writes. Real service control flow, isolated collaborators.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
const source=fs.readFileSync('src/modules/admin/grant-extend-days.service.ts','utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const DAY=86_400_000;
let remnaUser=null,getError=null,updateError=null,calls=[];
const moduleMock={exports:{}};
vm.runInNewContext(js,{exports:moduleMock.exports,console,Date,Number,Math,require:(name)=>{
 if(name.includes('db'))return {prisma:{subscription:{update:async(args)=>{calls.push(['db',args]);return {};}}}};
 if(name.includes('remna.client'))return {
  remnaGetUser:async(uuid)=>{calls.push(['get',uuid]);return getError?{error:getError,status:502}:{data:{response:remnaUser},status:200};},
  remnaUpdateUser:async(body)=>{calls.push(['update',body]);return updateError?{error:updateError,status:500}:{data:{},status:200};},
 };
 throw Error(name);
}});
const m=moduleMock.exports;
const now=new Date('2026-10-07T12:00:00.000Z');

// ── mode selection ──
assert.equal(m.chooseGrantExtendMode({tariffId:null,trialId:'t1'},undefined),'days_only','trial preset without explicit tariff');
assert.equal(m.chooseGrantExtendMode({tariffId:null,trialId:null},undefined),'days_only','legacy trial without tariff');
assert.equal(m.chooseGrantExtendMode({tariffId:'paid',trialId:'t1'},undefined),'days_only','trial carrying a tariffId is still a trial');
assert.equal(m.chooseGrantExtendMode({tariffId:null,trialId:'t1'},'paid'),'tariff','explicit tariff converts trial');
assert.equal(m.chooseGrantExtendMode({tariffId:null,trialId:null},'paid'),'tariff');
assert.equal(m.chooseGrantExtendMode({tariffId:'paid',trialId:null},undefined),'tariff','paid sub keeps tariff path');

// ── new expireAt = max(now, current) + days ──
assert.equal(m.computeDaysOnlyExpireAt(new Date(now.getTime()+3*DAY),5,now).toISOString(),new Date(now.getTime()+8*DAY).toISOString(),'stacks on active');
assert.equal(m.computeDaysOnlyExpireAt(new Date(now.getTime()-10*DAY),5,now).toISOString(),new Date(now.getTime()+5*DAY).toISOString(),'expired counts from now');
assert.equal(m.computeDaysOnlyExpireAt(null,2,now).toISOString(),new Date(now.getTime()+2*DAY).toISOString(),'no expiry counts from now');

// ── Remnawave parsing ──
assert.deepEqual(JSON.parse(JSON.stringify(m.extractRemnaExpireAndStatus({response:{expireAt:'2026-10-01T00:00:00.000Z',status:'EXPIRED'}}))),{expireAt:'2026-10-01T00:00:00.000Z',status:'EXPIRED'});
assert.deepEqual({...m.extractRemnaExpireAndStatus({response:{expireAt:'garbage'}})},{expireAt:null,status:null});
assert.deepEqual({...m.extractRemnaExpireAndStatus(null)},{expireAt:null,status:null});

(async()=>{
 // expired trial: date-only PATCH + re-activation, DB mirror of expireAt only
 remnaUser={uuid:'u1',expireAt:new Date(now.getTime()-2*DAY).toISOString(),status:'EXPIRED',trafficLimitBytes:1,activeInternalSquads:[{uuid:'trial-squad'}]};
 calls=[];
 let r=await m.extendSubscriptionDaysOnly({id:'sub1',remnawaveUuid:'u1'},7,now);
 assert.equal(r.ok,true);assert.equal(r.reactivated,true);
 const want=new Date(now.getTime()+7*DAY);
 assert.equal(r.expireAt.toISOString(),want.toISOString());
 const upd=calls.find(c=>c[0]==='update')[1];
 assert.deepEqual(Object.keys(upd).sort(),['expireAt','status','uuid'],'only expireAt/status are sent — limits, squads, traffic untouched');
 assert.equal(upd.uuid,'u1');assert.equal(upd.expireAt,want.toISOString());assert.equal(upd.status,'ACTIVE');
 const db=calls.find(c=>c[0]==='db')[1];
 assert.deepEqual({...db.where},{id:'sub1'});assert.deepEqual(Object.keys(db.data),['expireAt'],'trialId/tariffId stay as they are');
 assert.equal(db.data.expireAt.toISOString(),want.toISOString());

 // active trial: stack, no status change
 remnaUser={expireAt:new Date(now.getTime()+1*DAY).toISOString(),status:'ACTIVE'};calls=[];
 r=await m.extendSubscriptionDaysOnly({id:'sub1',remnawaveUuid:'u1'},3,now);
 assert.equal(r.expireAt.toISOString(),new Date(now.getTime()+4*DAY).toISOString());assert.equal(r.reactivated,false);
 assert.deepEqual(Object.keys(calls.find(c=>c[0]==='update')[1]).sort(),['expireAt','uuid']);

 // manually DISABLED (admin block) is NOT silently unblocked
 remnaUser={expireAt:new Date(now.getTime()-1*DAY).toISOString(),status:'DISABLED'};calls=[];
 r=await m.extendSubscriptionDaysOnly({id:'sub1',remnawaveUuid:'u1'},3,now);
 assert.equal(r.ok,true);assert.equal(r.reactivated,false);assert.equal('status' in calls.find(c=>c[0]==='update')[1],false);

 // Remnawave read failure: no writes
 getError='boom';calls=[];
 r=await m.extendSubscriptionDaysOnly({id:'sub1',remnawaveUuid:'u1'},3,now);
 assert.equal(r.ok,false);assert.equal(calls.some(c=>c[0]==='update'||c[0]==='db'),false);getError=null;

 // Remnawave update failure: DB untouched
 remnaUser={expireAt:null,status:'ACTIVE'};updateError='nope';calls=[];
 r=await m.extendSubscriptionDaysOnly({id:'sub1',remnawaveUuid:'u1'},3,now);
 assert.equal(r.ok,false);assert.equal(r.error,'nope');assert.equal(calls.some(c=>c[0]==='db'),false);updateError=null;

 console.log('PASS: mode selection, expireAt math, remna parsing, expired re-activation, active stacking, disabled kept, read/update failures');
})().catch(e=>{console.error(e);process.exitCode=1;});
