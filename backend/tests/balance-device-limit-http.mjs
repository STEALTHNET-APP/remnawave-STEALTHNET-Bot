import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const database = new URL(process.env.DATABASE_URL ?? 'http://invalid').pathname.slice(1);
if (!database.startsWith('issue43_test_') && database !== 'candidate') throw new Error('Use an isolated issue43_test_ database');
const { default: app } = await import('../dist/app.js');
const { prisma } = await import('../dist/db.js');
const { signClientToken } = await import('../dist/modules/client/client.service.js');
const marker = randomUUID();
let client, category, tariff, server;
try {
  category = await prisma.tariffCategory.create({data:{name:'HTTP device guard '+marker}});
  tariff = await prisma.tariff.create({data:{categoryId:category.id,name:marker,durationDays:30,price:10,currency:'rub',maxExtraDevices:1,internalSquadUuids:[]}});
  client = await prisma.client.create({data:{email:marker+'@example.invalid',balance:100}});
  server = app.listen(0,'127.0.0.1');
  await new Promise(resolve => server.once('listening',resolve));
  const base = 'http://127.0.0.1:'+server.address().port;
  for (const deviceCount of [2,100]) {
    const response = await fetch(base+'/api/client/payments/balance',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+signClientToken(client.id)},body:JSON.stringify({tariffId:tariff.id,deviceCount})});
    assert.equal(response.status,409);
    const result=await response.json();
    assert.equal(result.code,'EXTRA_DEVICE_LIMIT');
    assert.match(result.message,/1/);
    assert.equal((await fetch(base+'/api/health')).status,200);
  }
  assert.equal((await prisma.client.findUniqueOrThrow({where:{id:client.id}})).balance,100);
  assert.equal(await prisma.payment.count({where:{clientId:client.id}}),0);
  assert.equal(await prisma.subscription.count({where:{ownerId:client.id}}),0);
  console.log('PASS: HTTP device-limit rejection, API survives repeated requests, no debit or subscription');
} finally {
  if(server)await new Promise(resolve=>server.close(resolve));
  if(client)await prisma.client.delete({where:{id:client.id}});
  if(tariff)await prisma.tariff.delete({where:{id:tariff.id}});
  if(category)await prisma.tariffCategory.delete({where:{id:category.id}});
  await prisma.$disconnect();
}
