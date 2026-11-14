import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { prisma } from '../dist/db.js';
import jwt from 'jsonwebtoken';

if (!new URL(process.env.DATABASE_URL).pathname.startsWith('/issue235_test')) throw new Error('isolated test database required');
const prefix='pr235-http-'+Date.now();
const admin=await prisma.admin.create({data:{id:prefix+'-admin',email:prefix+'@example.invalid',passwordHash:'unusable',mustChangePassword:false}});
const manager=await prisma.admin.create({data:{id:prefix+'-manager',email:prefix+'-manager@example.invalid',passwordHash:'unusable',role:'MANAGER',allowedSections:JSON.stringify(['dashboard']),mustChangePassword:false}});
const client=await prisma.client.create({data:{id:prefix+'-client',email:prefix+'-client@example.invalid',referralCode:prefix,remnawaveUuid:prefix+'-vpn',balance:1000}});
const sub=await prisma.subscription.create({data:{ownerId:client.id,subscriptionIndex:0,remnawaveUuid:client.remnawaveUuid,expireAt:new Date(Date.now()+86400000),remnaStatus:'ACTIVE',shortUuid:'short-test',trafficUsedBytes:7,trafficLimitBytes:100}});
const token=payload=>jwt.sign(payload,process.env.JWT_SECRET,{expiresIn:'10m'});
const adminToken=token({adminId:admin.id,email:admin.email,type:'access'});
const managerToken=token({adminId:manager.id,email:manager.email,type:'access'});
const clientToken=token({clientId:client.id,type:'client_access'});
let healthy=false;
let calls=0;
const remna=createServer((req,res)=>{
 calls++;
 assert.equal(req.headers.authorization,'Bearer test-only-token');
 assert.equal(req.headers.cookie,'gate=part:rest');
 res.setHeader('Content-Type','application/json');
 if(!healthy){res.writeHead(503);res.end('{"message":"test offline"}');return;}
 res.end(JSON.stringify({response:req.url.startsWith('/api/users?')?{users:[]}:{uuid:client.remnawaveUuid,expireAt:new Date(Date.now()+86400000).toISOString(),subscriptionUrl:'https://sub.example.invalid/test',status:'ACTIVE',userTraffic:{usedTrafficBytes:9},trafficLimitBytes:100}}));
});
await new Promise(r=>remna.listen(5099,'127.0.0.1',r));
async function request(path,method='GET',body,auth=adminToken){const res=await fetch('http://127.0.0.1:5000/api'+path,{method,headers:{Authorization:'Bearer '+auth,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:res.status,body:await res.json()};}
const settings={remnaApiUrl:'http://127.0.0.1:5099',remnaAdminToken:'test-only-token',remnaSecretKey:'gate=part:rest',happCryptEnabled:false};
try{
 for(let i=0;i<30;i++){try{await request('/public/config');break;}catch{await new Promise(r=>setTimeout(r,500));}}
 assert.equal((await request('/admin/settings','PATCH',settings)).status,200);
 for(const endpoint of ['/admin/remna/reset-config','/admin/remna/test-connection','/admin/bot/reset-token','/admin/bot/test-token'])assert.equal((await request(endpoint,'POST',{},managerToken)).status,403);
 console.log('PASS HTTP credential actions reject dashboard-only managers');
 for(let i=0;i<3;i++){
   const response=await request('/client/subscription/all','GET',undefined,clientToken);
   assert.equal(response.status,200);
   assert.equal(response.body.items[0].isOfflineSnapshot,true);
   assert.equal(response.body.items[0].subscription.response.subscriptionUrl,null);
   assert.equal(response.body.items[0].subscription.response.userTraffic.usedTrafficBytes,7);
 }
 assert.equal((await request('/public/tariffs')).body.remnaAvailable,false);
 const before=calls;
 assert.equal((await request('/client/payments/balance','POST',{tariffId:'missing'},clientToken)).status,503);
 for(const body of [{proxyTariffId:'missing'},{singboxTariffId:'missing'}])assert.notEqual((await request('/client/payments/balance','POST',body,clientToken)).status,503);
 assert.equal((await request('/client/telegram-stars/create-payment','POST',{amount:100,currency:'RUB'},clientToken)).body.message,'Оплата Stars не настроена');
 assert.equal(calls,before);
 assert.equal(await prisma.payment.count(),0);
 assert.equal((await prisma.client.findUnique({where:{id:client.id}})).balance,1000);
 console.log('PASS HTTP offline snapshots; Remna purchase blocked; independent products pass guard; no charge or payment created');
 healthy=true;
 console.log('Waiting 31 seconds for the real recovery cooldown');
 await new Promise(r=>setTimeout(r,31_000));
 assert.equal((await request('/public/tariffs')).body.remnaAvailable,true);
 const restored=await request('/client/subscription/all','GET',undefined,clientToken);
 assert.equal(restored.body.items[0].isOfflineSnapshot,false);
 assert.equal(restored.body.items[0].subscription.response.userTraffic.usedTrafficBytes,9);
 console.log('PASS HTTP recovery after cooldown reads live VPN data');
 for(const endpoint of ['/admin/remna/reset-config','/admin/bot/reset-token'])assert.deepEqual((await request(endpoint,'POST',{})).body,{ok:true});
 assert.equal((await prisma.subscription.findUnique({where:{id:sub.id}})).remnawaveUuid,client.remnawaveUuid);
 assert.equal((await prisma.client.findUnique({where:{id:client.id}})).remnawaveUuid,client.remnawaveUuid);
 console.log('PASS HTTP reset returns no credentials and preserves VPN mappings');
}finally{await new Promise(r=>remna.close(r));await prisma.$disconnect();}
