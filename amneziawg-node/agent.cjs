const fs = require('node:fs');
const { execFileSync, spawn } = require('node:child_process');
const path = require('node:path');
const dataDir = process.env.DATA_DIR || '/data';
const api = (process.env.STEALTHNET_API_URL || '').replace(/\/$/, '');
const token = process.env.SINGBOX_NODE_TOKEN;
const configKeys = ['Jc', 'Jmin', 'Jmax', 'S1', 'S2', 'S3', 'S4', 'H1', 'H2', 'H3', 'H4'];
const keyPattern = /^[A-Za-z0-9+/]{43}=$/;
const run = (cmd, args, input) => execFileSync(cmd, args, { input, encoding: 'utf8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let child;
let stopping = false;
let peers = [];
let leaseUntil = 0;
let applied = '';
let privateKey;
let registration;
let totals = {};
let lastCounters = {};
let connected = {};
let traffic = { rx: "0", tx: "0" };
let lastDirections = {};

function save(name, value) {
  const target = path.join(dataDir, name);
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, value, { mode: 0o600 });
  fs.renameSync(temporary, target);
}

async function request(route, body) {
  const response = await fetch(`${api}/api/amneziawg-nodes/${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-singbox-node-token': token, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(4000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`Panel API ${response.status}`);
  return response.json();
}

function readCounters() {
  const rows = run('awg', ['show', 'awg0', 'dump']).split('\n').slice(1);
  for (const row of rows) {
    const fields = row.split('\t');
    if (fields.length < 8) continue;
    const key = fields[0];
    const rx = BigInt(fields[5]), tx = BigInt(fields[6]);
    const old = lastDirections[key] || { rx: 0n, tx: 0n };
    traffic.rx = (BigInt(traffic.rx) + (rx >= old.rx ? rx - old.rx : rx)).toString();
    traffic.tx = (BigInt(traffic.tx) + (tx >= old.tx ? tx - old.tx : tx)).toString();
    lastDirections[key] = { rx, tx };
    const sum = rx + tx;
    const previous = lastCounters[key] || 0n;
    const delta = sum >= previous ? sum - previous : sum;
    totals[key] = (BigInt(totals[key] || '0') + delta).toString();
    lastCounters[key] = sum;
    connected[key] = Number(fields[4]) > Date.now() / 1000 - 180 ? 1 : 0;
  }
  save('usage.json', JSON.stringify(totals));
  save('traffic.json', JSON.stringify(traffic));
}

function activePeers(now = Date.now()) {
  if (now >= leaseUntil) return [];
  return peers.filter(p => now < Date.parse(p.expiresAt) && (!p.trafficLimit || BigInt(p.trafficLimit) === 0n || BigInt(totals[p.publicKey] || '0') < BigInt(p.trafficLimit)));
}

function reconcile() {
  const active = activePeers();
  const content = ['[Interface]', `PrivateKey = ${privateKey}`, `ListenPort = ${registration.port}`,
    ...configKeys.map(k => `${k} = ${registration.config[k]}`),
    ...active.flatMap(p => ['', '[Peer]', `PublicKey = ${p.publicKey}`, `PresharedKey = ${p.presharedKey}`, `AllowedIPs = ${p.address}/32`]), ''].join('\n');
  if (content === applied) return;
  save('awg0.conf', content);
  run('awg', ['syncconf', 'awg0', path.join(dataDir, 'awg0.conf')]);
  const keys = new Set(active.map(p => p.publicKey));
  for (const key of Object.keys(lastCounters)) if (!keys.has(key)) { delete lastCounters[key]; delete lastDirections[key]; }
  applied = content;
}

function validatePeers(result) {
  if (!Array.isArray(result.peers) || result.peers.length > 65533 || !Number.isFinite(Date.parse(result.leaseUntil))) throw new Error('Invalid peer response');
  const addresses = new Set();
  const keys = new Set();
  for (const p of result.peers) {
    if (!keyPattern.test(p.publicKey) || !keyPattern.test(p.presharedKey) || !/^10\.88\.\d{1,3}\.\d{1,3}$/.test(p.address) || p.address.split('.').some(x => Number(x) > 255) || !Number.isFinite(Date.parse(p.expiresAt)) || !/^\d+$/.test(p.trafficUsed) || (p.trafficLimit !== null && !/^\d+$/.test(p.trafficLimit))) throw new Error('Invalid peer');
    if (addresses.has(p.address) || keys.has(p.publicKey)) throw new Error('Duplicate peer');
    addresses.add(p.address);
    keys.add(p.publicKey);
  }
  return result.peers;
}

async function sync() {
  await request('heartbeat', { trafficIn: traffic.rx, trafficOut: traffic.tx, peers: peers.map(p => ({ id: p.id, trafficUsed: totals[p.publicKey] || p.trafficUsed, connections: connected[p.publicKey] || 0 })) });
  const result = await request('peers');
  const next = validatePeers(result);
  for (const p of next) if (BigInt(p.trafficUsed) > BigInt(totals[p.publicKey] || '0')) totals[p.publicKey] = p.trafficUsed;
  peers = next;
  leaseUntil = Math.min(Date.parse(result.leaseUntil), Date.now() + 300000);
  save('usage.json', JSON.stringify(totals));
  save('traffic.json', JSON.stringify(traffic));
}

function setupNetwork() {
  run('ip', ['address', 'add', '10.88.0.1/16', 'dev', 'awg0']);
  run('ip', ['link', 'set', 'dev', 'awg0', 'mtu', '1280', 'up']);
  run('iptables', ['-P', 'FORWARD', 'DROP']);
  run('iptables', ['-A', 'FORWARD', '-i', 'eth0', '-o', 'awg0', '-m', 'conntrack', '--ctstate', 'ESTABLISHED,RELATED', '-j', 'ACCEPT']);
  for (const subnet of ['0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.168.0.0/16', '224.0.0.0/4', '240.0.0.0/4']) {
    run('iptables', ['-A', 'FORWARD', '-i', 'awg0', '-d', subnet, '-j', 'DROP']);
  }
  run('iptables', ['-A', 'FORWARD', '-i', 'awg0', '-o', 'eth0', '-j', 'ACCEPT']);
  run('iptables', ['-t', 'nat', '-A', 'POSTROUTING', '-s', '10.88.0.0/16', '-o', 'eth0', '-j', 'MASQUERADE']);
  run('iptables', ['-A', 'INPUT', '-i', 'awg0', '-p', 'icmp', '--icmp-type', 'echo-request', '-j', 'ACCEPT']);
  run('iptables', ['-A', 'INPUT', '-i', 'awg0', '-j', 'DROP']);
}

async function main() {
  if (!token || !api.startsWith('https://')) throw new Error('HTTPS panel URL and node token are required');
  process.umask(0o077);
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const keyPath = path.join(dataDir, 'private.key');
  if (!fs.existsSync(keyPath)) save('private.key', run('awg', ['genkey']) + '\n');
  privateKey = fs.readFileSync(keyPath, 'utf8').trim();
  if (!keyPattern.test(privateKey)) throw new Error('Invalid server key');
  if (fs.existsSync(path.join(dataDir, 'usage.json'))) totals = JSON.parse(fs.readFileSync(path.join(dataDir, 'usage.json'), 'utf8'));
  if (fs.existsSync(path.join(dataDir, 'traffic.json'))) traffic = JSON.parse(fs.readFileSync(path.join(dataDir, 'traffic.json'), 'utf8'));
  const publicKey = run('awg', ['pubkey'], privateKey + '\n');
  registration = await request('register', { publicKey });
  if (!Number.isInteger(registration.port) || registration.port < 1 || registration.port > 65535 || configKeys.some(k => !Number.isInteger(registration.config[k]) || registration.config[k] < 0 || registration.config[k] > 4294967295)) throw new Error('Invalid node configuration');
  child = spawn('amneziawg-go', ['-f', 'awg0'], { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, LOG_LEVEL: 'error' } });
  child.on('exit', () => { if (!stopping) process.exit(1); });
  for (let i = 0; i < 50 && !fs.existsSync('/var/run/amneziawg/awg0.sock'); i++) await wait(100);
  reconcile();
  setupNetwork();
  let nextSync = 0;
  console.log('AmneziaWG node started');
  while (!stopping) {
    readCounters();
    reconcile();
    if (Date.now() >= nextSync) {
      try { await sync(); reconcile(); } catch (error) { console.error(error.message); }
      nextSync = Date.now() + 5000;
    }
    await wait(1000);
  }
}

for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  stopping = true;
  try { readCounters(); } catch {}
  child?.kill('SIGTERM');
  process.exit(0);
});

if (require.main === module) main().catch(error => {
  console.error(error.message);
  stopping = true;
  child?.kill('SIGTERM');
  process.exit(1);
});
module.exports = { validatePeers };
