import assert from 'node:assert/strict';
import { mock, test, after } from 'node:test';
import { RemnaCircuit } from '../dist/modules/remna/remna-circuit.js';
import { offlineSubscriptionSnapshot } from '../dist/modules/remna/offline-snapshot.js';

let now = 100_000;
const clock = mock.method(Date, 'now', () => now);
let remna;
let settings = { apiUrl: 'https://remna.invalid', adminToken: 'token', secretKey: '', source: 'database' };
mock.module('../dist/config/index.js', { namedExports: { env: {} } });
mock.module('../dist/modules/client/client.service.js', { namedExports: { getSystemConfig: async () => { remna.setRemnaRuntimeConfig(settings); return {}; } } });
remna = await import('../dist/modules/remna/remna.client.js');
after(() => clock.mock.restore());

test('only one recovery probe is allowed; stale success cannot close a tripped circuit', () => {
  const circuit = new RemnaCircuit(() => now);
  const oldTicket = circuit.acquire();
  for (let i = 0; i < 3; i++) circuit.failure(oldTicket);
  assert.equal(circuit.state, 'OPEN');
  circuit.success(oldTicket);
  assert.equal(circuit.state, 'OPEN');
  assert.equal(circuit.acquire(), null);
  now += 30_001;
  const probe = circuit.acquire();
  assert.equal(circuit.state, 'HALF_OPEN');
  assert.equal(circuit.acquire(), null);
  circuit.failure(probe);
  assert.equal(circuit.state, 'OPEN');
  now += 30_001;
  circuit.success(circuit.acquire());
  assert.equal(circuit.state, 'CLOSED');
});

test('real client fast-fails after three failures and probes before allowing a mutation', async () => {
  let requests = [];
  let healthy = false;
  let release;
  let probeStarted;
  const started = new Promise(resolve => { probeStarted = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const fetch = mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, method: options.method ?? 'GET' });
    if (!healthy) return new Response('', { status: 503 });
    if (url.endsWith('?size=1')) { probeStarted(); await gate; }
    return new Response(JSON.stringify({ response: { users: [] } }), { status: 200 });
  });
  try {
    for (let i = 0; i < 3; i++) assert.equal((await remna.remnaGetUser('test')).status, 503);
    assert.equal(remna.isRemnaOnline(), false);
    assert.equal((await remna.remnaGetUser('test')).isCircuitOpen, true);
    assert.equal(requests.length, 3);
    now += 30_001;
    assert.equal(remna.isRemnaOnline(), false);
    healthy = true;
    const mutation = remna.remnaFetch('/api/users', { method: 'PATCH', body: '{}' });
    await started;
    const overlapping = await Promise.all(Array.from({ length: 8 }, () => remna.remnaGetUser('test')));
    assert.ok(overlapping.every(result => result.status === 503));
    assert.equal(requests.length, 4);
    assert.equal(requests[3].method, 'GET');
    release();
    assert.equal((await mutation).status, 200);
    assert.equal(requests[4].method, 'PATCH');
    assert.equal(remna.isRemnaOnline(), true);
    healthy = false;
    for (let i = 0; i < 3; i++) await remna.remnaGetUser('test');
    settings = { ...settings, apiUrl: 'https://replacement.invalid' };
    healthy = true;
    assert.equal((await remna.remnaGetUser('test')).status, 200);
    assert.equal(requests.at(-1).url, 'https://replacement.invalid/api/users/test');
  } finally { release(); fetch.mock.restore(); }
});

test('offline snapshot has no invented subscription URL and serializes BigInt counters', () => {
  const snapshot = offlineSubscriptionSnapshot({ remnawaveUuid: 'uuid', shortUuid: 'short', remnaStatus: 'ACTIVE', expireAt: new Date(now - 1), trafficUsedBytes: 7n, trafficLimitBytes: 100n });
  assert.equal(snapshot.response.subscriptionUrl, null);
  assert.equal(snapshot.response.status, 'EXPIRED');
  assert.equal(snapshot.isOfflineSnapshot, true);
  assert.equal(JSON.parse(JSON.stringify(snapshot)).response.userTraffic.usedTrafficBytes, 7);
});
