import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
if (new URL(process.env.DATABASE_URL || 'http://invalid').pathname !== '/cloudpayments_test') throw Error('Use isolated cloudpayments_test');
process.env.JWT_SECRET = 'cloudpayments-settings-test-secret-at-least-32';
process.env.NODE_ENV = 'test';
const { prisma } = await import('../dist/db.js');
const mkdir = fs.mkdirSync;
fs.mkdirSync = (path, options) => String(path).startsWith('/app/uploads/') ? undefined : mkdir(path, options);
const { adminRouter } = await import('../dist/modules/admin/admin.routes.js');
fs.mkdirSync = mkdir;
const { getSystemConfig, getPublicConfig, invalidateSystemConfigCache } = await import('../dist/modules/client/client.service.js');
const { signAccessToken } = await import('../dist/modules/auth/auth.service.js');
const { default: express } = await import('express');
const receipt = { enabled: true, taxationSystem: 2, vat: 22, method: 4, object: 4, label: 'Доступ: {product}' };
const keys = ['cloudpayments_receipt', 'cloudpayments_bot_direct', 'bot_commands'];
test('admin saves receipt, direct-payment and command controls; invalid input and unauthorized access are rejected', async () => {
 const saved=await prisma.systemSetting.findMany({where:{key:{in:keys}}});
 const admin=await prisma.admin.create({data:{email:`${randomUUID()}@example.invalid`,passwordHash:'unusable',role:'ADMIN'}});
 const app=express();app.use(express.json());app.use('/api/admin',adminRouter);
 app.use((err,req,res,next)=>res.status(500).json({message:err.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const token=signAccessToken({adminId:admin.id,email:admin.email},process.env.JWT_SECRET,'10m');
 const call=(method,path,body,authorized=true)=>fetch(origin+path,{method,headers:{'Content-Type':'application/json',...(authorized?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
 try {
  assert.equal((await call('PATCH','/api/admin/settings',{cloudpaymentsReceipt:receipt},false)).status,401);
  const commands=[{command:'autopay',description:'Мои списания',visible:true},{command:'support',description:'Помощь',visible:false}];
  const save=await call('PATCH','/api/admin/settings',{cloudpaymentsReceipt:receipt,cloudpaymentsBotDirect:true,botCommands:commands});assert.equal(save.status,200,await save.text());
  const data=await (await call('GET','/api/admin/settings')).json();
  assert.deepEqual(data.cloudpaymentsReceipt,receipt);assert.equal(data.cloudpaymentsBotDirect,true);assert.deepEqual(data.botCommands,commands);
  assert.equal(data.cloudpaymentsApiSecret,'********');
  const pub=await getPublicConfig();assert.equal(pub.cloudpaymentsBotDirect,true);assert.deepEqual(pub.botCommands,commands);assert.equal(pub.cloudpaymentsApiSecret,undefined);assert.equal(pub.cloudpaymentsReceipt,undefined);
  assert.equal((await call('PATCH','/api/admin/settings',{cloudpaymentsReceipt:{...receipt,vat:999}})).status,400);
  assert.equal((await call('PATCH','/api/admin/settings',{botCommands:[...commands,commands[0]]})).status,400);
  assert.equal((await call('PATCH','/api/admin/settings',{botCommands:[{command:'made_up',description:'X',visible:true}]})).status,400);
  assert.deepEqual((await getSystemConfig()).cloudpaymentsReceipt,receipt);
  assert.equal((await call('POST','/api/admin/settings/cloudpayments-subscriptions/unknown/cancel',{},false)).status,401);
 } finally {
  await prisma.systemSetting.deleteMany({where:{key:{in:keys}}});if(saved.length)await prisma.systemSetting.createMany({data:saved});invalidateSystemConfigCache();
  await prisma.admin.delete({where:{id:admin.id}});await new Promise(resolve=>server.close(resolve));
 }
});
test('receipt migration keeps existing agreements and is nullable for older plans',async()=>{
 const count=await prisma.cloudPaymentAgreement.count();const migration=await readFile(new URL('../prisma/migrations/20261101120000_cloudpayments_receipts/migration.sql',import.meta.url),'utf8');
 const rollback=new Error('rollback migration test');
 await assert.rejects(prisma.$transaction(async tx=>{
  await tx.$executeRawUnsafe('ALTER TABLE "cloudpayment_agreements" DROP COLUMN "receipt_json"');
  await tx.$executeRawUnsafe(migration);
  assert.equal(await tx.cloudPaymentAgreement.count(),count);
  assert.equal(await tx.cloudPaymentAgreement.count({where:{receiptJson:{not:null}}}),0);
  throw rollback;
 }),error=>error===rollback);
});
test.after(async()=>{await prisma.$disconnect();});
