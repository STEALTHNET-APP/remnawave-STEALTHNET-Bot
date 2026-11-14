import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma, createPayment } from '../dist/db.js';
const client = await prisma.client.create({ data: { email: randomUUID() + '@example.invalid', balance: 50 } });
try {
  const orderId = randomUUID();
  const data = { clientId: client.id, orderId, amount: 30, currency: 'RUB', status: 'PAID', provider: 'balance' };
  await createPayment({ data }, true);
  await assert.rejects(() => createPayment({ data: { ...data, amount: 10 } }, true));
  assert.equal((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).balance, 20);
  const attempts = await Promise.allSettled(Array.from({ length: 5 }, () => createPayment({ data: { ...data, orderId: randomUUID(), amount: 15 } }, true)));
  assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).balance, 5);
  assert.equal(await prisma.payment.count({ where: { clientId: client.id } }), 2);
  console.log('PASS: atomic balance debit, rollback on payment failure, concurrent purchases');
} finally {
  await prisma.client.delete({ where: { id: client.id } });
  await prisma.$disconnect();
}
