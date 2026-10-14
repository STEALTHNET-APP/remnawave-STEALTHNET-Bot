// Issue #201: referral rewards must be credited only from real external money.
// Runs the real referral.service control flow against an in-memory prisma mock.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
const source=fs.readFileSync('src/modules/referral/referral.service.ts','utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;

let payment=null,writes=[];
const referrer={id:'ref1',isBlocked:false,referralPercent:null,referrer:null};
const tx={
  payment:{
    findUnique:async()=>payment,
    updateMany:async(args)=>{writes.push(['claim',args.where.id]);if(payment.referralDistributedAt)return {count:0};payment.referralDistributedAt=new Date();return {count:1};},
  },
  client:{update:async(args)=>{writes.push(['balance',args.where.id,args.data.balance.increment]);}},
  referralCredit:{create:async(args)=>{writes.push(['credit',args.data.referrerId,args.data.amount,args.data.level]);}},
};
const prisma={$transaction:async(fn)=>fn(tx)};
const moduleMock={exports:{}};
vm.runInNewContext(js,{exports:moduleMock.exports,require:(name)=>{
  if(name.includes('db.js'))return {prisma};
  if(name.includes('client.service'))return {getSystemConfig:async()=>({defaultReferralPercent:10,referralPercentLevel2:0,referralPercentLevel3:0})};
  throw Error(name);
}});
const {distributeReferralRewards,isReferralEligiblePayment}=moduleMock.exports;
const mk=(provider)=>({id:'p-'+provider,status:'PAID',provider,amount:500,referralDistributedAt:null,client:{id:'c',referrer}});

(async()=>{
  assert.equal(typeof isReferralEligiblePayment,'function','isReferralEligiblePayment must be exported');
  for(const p of ['platega','yookassa','yoomoney','yoomoney_form','cryptopay','heleket','lava','lavatop','overpay','paritypay','rollypay'])
    assert.equal(isReferralEligiblePayment(p),true,p);
  for(const p of ['balance','admin_grant',null,undefined,'','  '])
    assert.equal(isReferralEligiblePayment(p),false,String(p));

  // Platega top-up -> credited once
  payment=mk('platega');writes=[];
  let r=await distributeReferralRewards(payment.id);
  assert.equal(r.distributed,true);
  assert.deepEqual(writes.filter(w=>w[0]==='credit'),[['credit','ref1',50,1]]);
  writes=[];r=await distributeReferralRewards(payment.id);
  assert.equal(r.distributed,false);assert.equal(writes.length,0,'idempotent on repeat');

  // Tariff bought from internal balance -> nothing credited, nothing written
  for(const prov of ['balance','admin_grant']){
    payment=mk(prov);writes=[];
    r=await distributeReferralRewards(payment.id);
    assert.equal(r.distributed,false,prov);
    assert.deepEqual(writes,[],prov+' must not write credits or balances');
    assert.equal(payment.referralDistributedAt,null);
  }
  // Mixed auto-renew: card + balance, saved as yookassa with full amount -> reward only on card portion
  payment={...mk('yookassa'),metadata:JSON.stringify({autoRenew:true,cardPortion:200,balancePortion:300})};writes=[];
  r=await distributeReferralRewards(payment.id);
  assert.equal(r.distributed,true);
  assert.deepEqual(writes.filter(w=>w[0]==='credit'),[['credit','ref1',20,1]]);
  // Broken / absent / out-of-range metadata -> full amount
  for(const metadata of [null,'not json',JSON.stringify({cardPortion:'abc'}),JSON.stringify({cardPortion:-5}),JSON.stringify({cardPortion:9999})]){
    payment={...mk('yookassa'),metadata};writes=[];
    await distributeReferralRewards(payment.id);
    assert.deepEqual(writes.filter(w=>w[0]==='credit'),[['credit','ref1',50,1]],String(metadata));
  }
  console.log('PASS: external providers credited once, balance/admin_grant/null providers skipped, idempotent, mixed card+balance credited on card portion only');
})().catch(e=>{console.error(e);process.exitCode=1;});
