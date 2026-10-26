import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { updateRouter } from '../dist/modules/update/update.routes.js';

let server, agent, base, directory;
const calls = [];
before(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'st-upd-'));
  process.env.UPDATER_SOCKET = path.join(directory, 'control.sock');
  agent = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    calls.push([req.method, req.url, body ? JSON.parse(body) : null]);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ settings: { enabled: false, channel: 'stable', hourUtc: 3 }, status: { phase: 'idle' } }));
  });
  await new Promise(resolve => agent.listen(process.env.UPDATER_SOCKET, resolve));
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.adminRole = req.headers['x-test-role']; next(); });
  app.use('/updates', updateRouter);
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/updates`;
});
after(async () => {
  await new Promise(resolve => server.close(resolve));
  await new Promise(resolve => agent.close(resolve));
  await fs.rm(directory, { recursive: true, force: true });
});
test('manager and missing identity cannot reach update service', async () => {
  for (const role of ['MANAGER', '']) {
    for (const action of ['', '/check', '/install', '/settings']) {
      const response = await fetch(base + action, { method: action ? 'POST' : 'GET', headers: { 'x-test-role': role, 'Content-Type': 'application/json' }, ...(action ? { body: '{}' } : {}) });
      assert.equal(response.status, 403);
    }
  }
  assert.equal(calls.length, 0);
});
test('admin gets running build metadata and agent state', async () => {
  const response = await fetch(base, { headers: { 'x-test-role': 'ADMIN' } });
  const data = await response.json();
  assert.equal(data.connected, true);
  assert.equal(data.installed.version, JSON.parse(await fs.readFile(new URL('../../version.json', import.meta.url), 'utf8')).version);
  assert.equal(data.status.phase, 'idle');
});
test('invalid settings and arbitrary commands are rejected before proxying', async () => {
  const count = calls.length;
  for (const [action, body] of [['settings', { enabled: true, channel: 'bad', hourUtc: 3 }], ['settings', { enabled: true, channel: 'main', hourUtc: 24 }], ['install', { command: 'anything' }]]) {
    const response = await fetch(base + '/' + action, { method: 'POST', headers: { 'x-test-role': 'ADMIN', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status, 400);
  }
  assert.equal(calls.length, count);
});
test('admin can request a check and save a valid schedule', async () => {
  for (const [action, body] of [['check', {}], ['settings', { enabled: true, channel: 'main', hourUtc: 3 }]]) {
    const response = await fetch(base + '/' + action, { method: 'POST', headers: { 'x-test-role': 'ADMIN', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status, 200);
    assert.equal(calls.at(-1)[1], '/' + action);
  }
});
test('manual local-change confirmation is forwarded and validated', async () => {
  const id = 'a'.repeat(64);
  const response = await fetch(base + '/install', { method: 'POST', headers: { 'x-test-role': 'ADMIN', 'Content-Type': 'application/json' }, body: JSON.stringify({ localChangesId: id }) });
  assert.equal(response.status, 200);
  assert.deepEqual(calls.at(-1), ['POST', '/install', { localChangesId: id }]);
  const count = calls.length;
  for (const body of [{ localChangesId: true }, { localChangesId: 'invalid' }, { localChangesId: id, force: true }]) {
    const rejected = await fetch(base + '/install', { method: 'POST', headers: { 'x-test-role': 'ADMIN', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(rejected.status, 400);
  }
  assert.equal(calls.length, count);
});
test('missing agent is reported honestly and install fails', async () => {
  process.env.UPDATER_SOCKET = path.join(directory, 'absent.sock');
  const response = await fetch(base, { headers: { 'x-test-role': 'ADMIN' } });
  assert.equal((await response.json()).connected, false);
  const install = await fetch(base + '/install', { method: 'POST', headers: { 'x-test-role': 'ADMIN', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(install.status, 503);
});
