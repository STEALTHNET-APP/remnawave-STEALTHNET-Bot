// Runs without database/Remnawave writes. Real service control flow, isolated collaborators.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
const source=fs.readFileSync('src/modules/admin/grant-subscription.service.ts','utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
let multi=false,candidate=null,failure=false,configFailure=false,calls=[];
const moduleMock={exports:{}};
vm.runInNewContext(js,{exports:moduleMock.exports,require:(name)=>{
 if(name.includes('client.service'))return {getSystemConfig:async()=>{if(configFailure)throw Error('config unavailable');return {multiSubscriptionsEnabled:multi};}};
 if(name.includes('gift.service'))return {createAdditionalSubscription:async(...args)=>{calls.push(['create',...args]);return {ok:true,data:{subscriptionId:'new',subscriptionIndex:1}};}};
 if(name.includes('tariff-activation'))return {findConvertibleSubscription:async(...args)=>{calls.push(['find',...args]);return candidate;},extendSecondarySubscription:async(...args)=>{calls.push(['extend',...args]);return failure?{ok:false,error:'Remnawave down',status:503}:{ok:true};},consolidateToSingleSubscription:async(...args)=>{calls.push(['consolidate',...args]);}};
 throw Error(name);
}});
const grant=moduleMock.exports.grantSubscriptionTariff;
const tariff={id:'paid',durationDays:7,price:15,trafficLimitBytes:123n,includedDevices:3,deviceLimit:3,internalSquadUuids:['squad']};
(async()=>{
 for(const kind of ['trial','different','same']){
  calls=[];candidate={id:'existing',subscriptionIndex:0,sameTariff:kind==='same'};
  const r=await grant('client',tariff,2);
  assert.equal(r.data.subscriptionId,'existing');assert.equal(r.data.subscriptionIndex,0);
  assert.equal(calls.some(x=>x[0]==='create'),false);assert.equal(calls[0][3],false);
  const e=calls.find(x=>x[0]==='extend');assert.equal(e[2],tariff);assert.equal(e[4],2);assert.equal(e[7],kind!=='same');
 }
 failure=true;calls=[];assert.equal((await grant('client',tariff)).ok,false);assert.equal(calls.some(x=>x[0]==='create'),false);failure=false;
 candidate=null;calls=[];assert.equal((await grant('client',tariff)).data.subscriptionId,'new');assert.equal(calls.filter(x=>x[0]==='create').length,1);
 assert.deepEqual(calls.find(x=>x[0]==='consolidate'),['consolidate','client','new']);
 multi=true;candidate={id:'trial'};calls=[];await grant('client',tariff,1);assert.equal(calls.length,1);assert.equal(calls[0][0],'create');assert.equal(calls[0][3].purchasedAsGift,false);
 configFailure=true;calls=[];await assert.rejects(()=>grant('client',tariff));assert.equal(calls.length,0);
 console.log('PASS: single trial/different/same, new client, multi enabled, update failure, config failure, overrides and existing subscription identity');
})().catch(e=>{console.error(e);process.exitCode=1;});
