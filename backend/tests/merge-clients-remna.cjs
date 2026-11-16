// Issue #186: account merge must not delete a Remnawave user still used by a moved subscription.
// Runs the real mergeClients control flow against an in-memory prisma mock; no DB/Remnawave writes.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
const file=process.env.MERGE_SRC||'src/modules/client/merge-clients.service.ts';
const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
let db,deleted;
const noop=()=>async()=>({count:0});
const model=(name)=>new Proxy({},{get:(_,op)=>{
 if(name==='client'){
  if(op==='findFirst')return async({where})=>db.clients.find(c=>c.remnawaveUuid===where.remnawaveUuid&&!where.id.notIn.includes(c.id))??null;
  if(op==='findUnique')return async({where})=>db.clients.find(c=>c.id===where.id)??null;
  if(op==='delete')return async({where})=>{db.clients=db.clients.filter(c=>c.id!==where.id);};
  if(op==='update')return async({where,data})=>Object.assign(db.clients.find(c=>c.id===where.id),data);
  if(op==='count')return async({where})=>db.clients.filter(c=>c.remnawaveUuid===where.remnawaveUuid).length;
 }
 if(name==='subscription'){
  if(op==='aggregate')return async({where})=>{const xs=db.subs.filter(s=>s.ownerId===where.ownerId).map(s=>s.subscriptionIndex);return {_max:{subscriptionIndex:xs.length?Math.max(...xs):null}};};
  if(op==='findMany')return async({where})=>db.subs.filter(s=>where.remnawaveUuid?s.remnawaveUuid===where.remnawaveUuid:s.ownerId===where.ownerId).sort((a,b)=>a.subscriptionIndex-b.subscriptionIndex);
  if(op==='create')return async({data})=>{const s={id:'new-'+db.subs.length,...data};db.subs.push(s);return s;};
  if(op==='update')return async({where,data})=>{const s=db.subs.find(x=>x.id===where.id);if(db.subs.some(x=>x!==s&&x.ownerId===data.ownerId&&x.subscriptionIndex===data.subscriptionIndex))throw Error('unique(ownerId,subscriptionIndex)');return Object.assign(s,data);};
  if(op==='count')return async({where})=>db.subs.filter(s=>s.remnawaveUuid===where.remnawaveUuid).length;
 }
 if(op==='findMany')return async()=>[];
 return noop();
}});
const prisma=new Proxy({},{get:(_,k)=>k==='$transaction'?async(fn)=>{const before=structuredClone(db);try{return await fn(prisma);}catch(e){db=before;throw e;}}:model(k)});
const m={exports:{}};
vm.runInNewContext(js,{exports:m.exports,console:{...console,info(){}},Promise,Set,require:(n)=>{
 if(n.includes('db.js'))return {prisma};
 if(n.includes('remna.client'))return {isRemnaConfigured:()=>true,remnaDeleteUser:async(u)=>{deleted.push(u);return {status:200};}};
 throw Error(n);
}});
const {mergeClients}=m.exports;
const client=(id,uuid)=>({id,remnawaveUuid:uuid,balance:0,trialUsed:false,referrerId:null,passwordHash:null,googleId:null,appleId:null,currentTariffId:null,telegramId:null});
(async()=>{
 // 1. Bug #186: absorbed root uuid == its sub #0 uuid, primary has its own root → must NOT delete.
 deleted=[];db={clients:[client('P','u-p'),client('A','u-a')],subs:[{id:'p0',ownerId:'P',subscriptionIndex:0,remnawaveUuid:'u-p'},{id:'a0',ownerId:'A',subscriptionIndex:0,remnawaveUuid:'u-a'},{id:'a1',ownerId:'A',subscriptionIndex:1,remnawaveUuid:'u-a2'}]};
 const r=await mergeClients('P','A',{telegramId:'1'});
 assert.deepEqual(deleted,[],'Remna user of moved subscription must survive merge');
 assert.equal(r.movedSubscriptions,2);
 assert.deepEqual(db.subs.filter(s=>s.ownerId==='P').map(s=>s.subscriptionIndex).sort(),[0,1,2],'moved subs reindexed after primary max');
 assert.equal(db.clients.find(c=>c.id==='P').remnawaveUuid,'u-p','primary keeps own root');

 deleted=[];db={clients:[client('P','u-p'),client('A','u-orphan')],subs:[{id:'a0',ownerId:'A',subscriptionIndex:0,remnawaveUuid:'u-a'}]};
 await mergeClients('P','A');
 assert.deepEqual(deleted,[]);
 assert.deepEqual(db.subs.map(s=>s.remnawaveUuid).sort(),['u-a','u-orphan','u-p']);
 assert.ok(db.subs.every(s=>s.ownerId==='P'));
 // 3. Primary without root adopts absorbed root → never deleted.
 deleted=[];db={clients:[client('P',null),client('A','u-a')],subs:[{id:'a0',ownerId:'A',subscriptionIndex:0,remnawaveUuid:'u-a'}]};
 await mergeClients('P','A');
 assert.deepEqual(deleted,[]);assert.equal(db.clients.find(c=>c.id==='P').remnawaveUuid,'u-a');
 deleted=[];db={clients:[client('P','same'),client('A','same')],subs:[]};
 await mergeClients('P','A');
 assert.equal(db.subs.length,1);assert.equal(db.subs[0].remnawaveUuid,'same');
 assert.equal(db.subs[0].ownerId,'P');
 db={clients:[client('P','p'),client('A','shared'),client('OTHER','shared')],subs:[]};
 await assert.rejects(()=>mergeClients('P','A'),/другому аккаунту/);
 assert.equal(db.clients.length,3);assert.equal(db.subs.length,0);
 db={clients:[client('P',null),{...client('A','legacy'),currentTariffId:'tariff',autoRenewEnabled:true,autoRenewExtraDevices:2,balance:50}],subs:[]};
 await mergeClients('P','A');
 assert.equal(db.subs[0].tariffId,'tariff');assert.equal(db.subs[0].autoRenewEnabled,true);
 assert.equal(db.subs[0].autoRenewExtraDevices,2);assert.equal(db.clients[0].balance,50);
 assert.deepEqual(deleted,[]);
 console.log('PASS: merge preserves existing and legacy subscriptions, rejects other owners and transfers renewal settings');
})().catch(e=>{console.error(e);process.exitCode=1;});
