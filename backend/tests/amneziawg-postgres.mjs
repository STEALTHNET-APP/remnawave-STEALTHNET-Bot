import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as crypto from 'node:crypto';
import * as net from 'node:net';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import express from 'express';

const prisma = new PrismaClient();
const context = vm.createContext({ console, Date, JSON, Set, Map, BigInt, Buffer });
const modules = new Map();
async function synthetic(name, values) {
  if (modules.has(name)) return modules.get(name);
  const m = new vm.SyntheticModule(Object.keys(values), function () { for (const [k, v] of Object.entries(values)) this.setExport(k, v); }, { context });
  modules.set(name, m); await m.link(() => {}); await m.evaluate(); return m;
}
async function load(file) {
  file = path.resolve(file);
  if (modules.has(file)) return modules.get(file);
  const m = new vm.SourceTextModule(fs.readFileSync(file, 'utf8'), { context, identifier: file });
  modules.set(file, m);
  await m.link(spec => spec.endsWith('/db.js') ? synthetic('db', { prisma }) : spec === 'node:crypto' ? synthetic('crypto', crypto) : spec === 'node:net' ? synthetic('net', net) : spec === 'zod' ? synthetic('zod', { z }) : spec === 'express' ? synthetic('express', { Router: express.Router }) : load(path.resolve(path.dirname(file), spec)));
  await m.evaluate(); return m;
}
const mod = 'dist/modules/singbox/';
const awg = (await load(mod + 'amneziawg.js')).namespace;
const allocate = (await load(mod + 'singbox-slots-activation.service.js')).namespace.createSingboxSlotsByPaymentId;
const router = (await load(mod + 'amneziawg.routes.js')).namespace.amneziawgRouter;
const app = express(); app.use(express.json()); app.use(router);
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const ids = { clients: [], nodes: [], categories: [] };
let passed = 0;
try {
  const config = awg.newAwgConfig();
  const serverKeys = awg.newAwgPeer('10.88.0.1');
  const n = await prisma.singboxNode.create({ data: { name: 'AWG regression', token: randomUUID(), protocol: 'AMNEZIAWG', publicHost: 'vpn.example.com', port: 51820, status: 'ONLINE', lastSeenAt: new Date(), customConfigJson: JSON.stringify({ ...config, publicKey: serverKeys.publicKey }), capacity: 3 } }); ids.nodes.push(n.id);
  const legacy = await prisma.singboxNode.create({ data: { name: 'Legacy regression', token: randomUUID(), protocol: 'VLESS', status: 'ONLINE', lastSeenAt: new Date(), capacity: 2 } }); ids.nodes.push(legacy.id);
  const cat = await prisma.singboxCategory.create({ data: { name: 'AWG regression' } }); ids.categories.push(cat.id);
  const tariff = await prisma.singboxTariff.create({ data: { categoryId: cat.id, name: 'AWG', protocol: 'AMNEZIAWG', slotCount: 2, durationDays: 30, price: 1 } });
  const client = await prisma.client.create({ data: { email: `${randomUUID()}@example.invalid` } }); ids.clients.push(client.id);
  const payment = async (tariffId = tariff.id, status = 'PAID') => prisma.payment.create({ data: { clientId: client.id, orderId: randomUUID(), amount: 1, currency: 'RUB', provider: 'test', status, singboxTariffId: tariffId } });
  const p = await payment();
  const results = await Promise.all(Array.from({ length: 5 }, () => allocate(p.id)));
  assert(results.every(r => r.ok && r.slotsCreated === 2));
  const slots = await prisma.singboxSlot.findMany({ where: { sourcePaymentId: p.id } });
  assert.equal(slots.length, 2); assert(slots.every(s => s.nodeId === n.id)); assert.equal(new Set(slots.map(s => s.userIdentifier)).size, 2); passed++;
  const unavailable = await payment(); assert.equal((await allocate(unavailable.id)).ok, false); assert.equal(await prisma.singboxSlot.count({ where: { sourcePaymentId: unavailable.id } }), 0); passed++;
  const pending = await payment(tariff.id, 'PENDING'); assert.equal((await allocate(pending.id)).ok, false); passed++;
  const oldTariff = await prisma.singboxTariff.create({ data: { categoryId: cat.id, name: 'Legacy', slotCount: 1, durationDays: 30 } });
  const oldPayment = await payment(oldTariff.id); assert.equal((await allocate(oldPayment.id)).ok, true);
  assert.equal((await prisma.singboxSlot.findFirst({ where: { sourcePaymentId: oldPayment.id } })).nodeId, legacy.id); passed++;
  const headers = { 'x-singbox-node-token': n.token, 'content-type': 'application/json' };
  assert.equal((await fetch(base + '/peers')).status, 401);
  assert.equal((await fetch(base + '/peers', { headers: { 'x-singbox-node-token': legacy.token } })).status, 401); passed++;
  let peers = await (await fetch(base + '/peers', { headers })).json();
  assert.equal(peers.peers.length, 2); assert(!JSON.stringify(peers).includes('privateKey')); assert(!JSON.stringify(peers).includes(JSON.parse(slots[0].secret).privateKey)); passed++;
  assert.equal((await fetch(base + '/register', { method: 'POST', headers, body: JSON.stringify({ publicKey: serverKeys.publicKey }) })).status, 200);
  assert.equal((await fetch(base + '/register', { method: 'POST', headers, body: JSON.stringify({ publicKey: awg.newAwgPeer('10.88.0.1').publicKey }) })).status, 409); passed++;
  for (const used of ['150', '50']) assert.equal((await fetch(base + '/heartbeat', { method: 'POST', headers, body: JSON.stringify({ peers: [{ id: slots[0].id, trafficUsed: used, connections: 1 }] }) })).status, 200);
  assert.equal((await prisma.singboxSlot.findUnique({ where: { id: slots[0].id } })).trafficUsedBytes, 150n); passed++;
  await prisma.singboxSlot.update({ where: { id: slots[0].id }, data: { trafficLimitBytes: 100n } });
  assert.equal((await (await fetch(base + '/peers', { headers })).json()).peers.length, 1); passed++;
  await prisma.payment.update({ where: { id: p.id }, data: { status: 'REFUNDED' } });
  assert.equal((await (await fetch(base + '/peers', { headers })).json()).peers.length, 0); passed++;
  await prisma.payment.update({ where: { id: p.id }, data: { status: 'PAID' } });
  await prisma.client.update({ where: { id: client.id }, data: { isBlocked: true } });
  assert.equal((await (await fetch(base + '/peers', { headers })).json()).peers.length, 0); passed++;
  await prisma.client.update({ where: { id: client.id }, data: { isBlocked: false } });
  await prisma.singboxSlot.update({ where: { id: slots[1].id }, data: { expiresAt: new Date(0) } });
  assert.equal((await (await fetch(base + '/peers', { headers })).json()).peers.length, 0); passed++;
  await prisma.singboxNode.update({ where: { id: n.id }, data: { status: 'DISABLED' } });
  await fetch(base + '/register', { method: 'POST', headers, body: JSON.stringify({ publicKey: serverKeys.publicKey }) });
  assert.equal((await prisma.singboxNode.findUnique({ where: { id: n.id } })).status, 'DISABLED'); passed++;
  const text = awg.buildAwgClientConfig(n, slots[0].secret);
  assert(text.includes('Endpoint = vpn.example.com:51820')); assert(text.includes('[Peer]')); assert(!text.includes(serverKeys.privateKey));
  assert.throws(() => awg.buildAwgClientConfig({ ...n, publicHost: 'host\nPostUp = malicious' }, slots[0].secret)); passed++;
  console.log(`PASS: ${passed} AmneziaWG database/API scenarios`);
} finally {
  server.close();
  for (const clientId of ids.clients) { await prisma.payment.deleteMany({ where: { clientId } }); await prisma.client.delete({ where: { id: clientId } }); }
  for (const id of ids.nodes) await prisma.singboxNode.delete({ where: { id } });
  for (const id of ids.categories) await prisma.singboxCategory.delete({ where: { id } });
  await prisma.$disconnect();
}
