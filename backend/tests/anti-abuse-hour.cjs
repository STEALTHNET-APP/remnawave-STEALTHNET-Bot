const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
const ts=require('typescript');
let time=Date.parse('2026-10-14T12:05:00Z');
class Clock extends Date { constructor(...args){super(...(args.length?args:[time]));} static now(){return time;} }
function load(name,deps){const module={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/modules/anti-abuse',name),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:module.exports,Date:Clock,Map,Set,Error,console:{log(){},warn(){},error(){}},require:n=>{if(n in deps)return deps[n];throw Error(n);}});return module.exports;}
(async()=>{
 let counter=5000, sample=time, state=null, dailyCalls=0;
 const events=[];
 const rule={id:'hour',enabled:true,windowKind:'hour',limitBytes:100n,action:'WARN',scopeKind:'all',priority:0,createdAt:new Date(),channels:{}};
 const usage=load('anti-abuse.usage.ts',{'../remna/remna.client.js':{}});
 const prisma={systemSetting:{findUnique:async({where})=>({value:where.key==='anti_abuse_enabled'?'true':'500'})},
 trafficAbuseRule:{findUnique:async()=>rule,findMany:async()=>[],update:async()=>{}},
 subscription:{findMany:async()=>[{id:'sub',remnawaveUuid:'uuid',owner:{id:'client'},subscriptionIndex:0}]},
 trafficAbuseState:{findUnique:async()=>state,upsert:async({create,update})=>{state=state?{...state,...update}:{...create};return state;}},
 trafficAbuseEvent:{create:async({data})=>events.push(data)}};
 const deps={'node-cron':{},'../../db.js':{prisma},'../remna/remna.client.js':{},'../diagnostics/cron-registry.js':{},
 './anti-abuse.notify.js':{sendAbuseNotification:async()=>({})},
 './anti-abuse.usage.js':{...usage,collectLifetimeUsage:async()=>new Map([['uuid',{uuid:'uuid',lifetimeBytes:counter,sampledAt:sample,periodBytes:999999}]]),collectUsageForWindow:async()=>{dailyCalls++;throw Error('hour must not use daily usage');}}};
 let scheduler=load('anti-abuse.scheduler.ts',deps);
 const tick=async(minutes,bytes)=>{time+=minutes*60000;sample=time;counter=bytes;await scheduler.runRuleTick('hour');};
 await tick(0,5000); assert.equal(events.length,0); // all earlier traffic excluded
 await tick(5,5050); assert.equal(events.length,0);
 scheduler=load('anti-abuse.scheduler.ts',deps); // state must survive a process restart
 await tick(5,5110); assert.equal(events.length,1);assert.equal(events[0].periodBytes,110n);
 await tick(5,5200);assert.equal(events.length,1); // warning dedup
 await tick(40,9000);assert.equal(events.length,1); // new hour starts at first sample
 await tick(5,9010);assert.equal(events.length,1);
 await tick(5,9120);assert.equal(events.length,2);assert.equal(events[1].periodBytes,120n);
 await tick(5,10);assert.equal(events.length,2); // counter reset starts a new baseline
 await tick(5,50);assert.equal(events.length,2);
 await tick(5,120);assert.equal(events.length,3);assert.equal(events[2].periodBytes,110n);
 time=Date.parse('2026-10-14T14:00:10Z');sample=Date.parse('2026-10-14T13:59:50Z');counter=99999;
 await scheduler.runRuleTick('hour');assert.equal(events.length,3);assert.equal(state.windowKey,'2026-10-14-13');
 await tick(1,100000);assert.equal(events.length,3);
 await tick(1,Number.NaN);assert.equal(events.length,3);assert.equal(state.lastLifetimeBytes,100000n);
 assert.equal(dailyCalls,0);
 console.log('PASS: hourly baseline, accumulated usage, restart, hour rollover, counter reset, stale and invalid samples');
 let calls=0;
 const collection=load('anti-abuse.usage.ts',{'../remna/remna.client.js':{remnaGetUsers:async()=>{calls++;return{data:{response:{users:[{username:'a',uuid:'one',userTraffic:{lifetimeUsedTrafficBytes:'500'}},{username:'b',uuid:'two'}],total:2}}};}}});
 const first=await collection.collectLifetimeUsage(time);
 assert.equal(first.size,1);assert.equal(first.get('one').lifetimeBytes,500);assert.equal(first.get('one').sampledAt,time);
 await collection.collectLifetimeUsage(time+1000);assert.equal(calls,1);
 console.log('PASS: missing lifetime counters excluded; shared sampling cache');
})().catch(e=>{console.error(e);process.exitCode=1;});
