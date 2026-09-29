import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { mock, test, beforeEach } from 'node:test';

let calls = [];
mock.module('node:child_process', { namedExports: { spawn: (_command, args) => {
  calls.push(args);
  const child = new EventEmitter();
  process.nextTick(() => child.emit('close', 0));
  return child;
} } });
const { prepareRestore, runPgRestore } = await import('../dist/modules/backup/backup-restore.js');
const db = { host: 'test', port: 5432, user: 'test', password: '', database: 'test' };
beforeEach(() => { calls = []; });
async function workspace(t) {
  const root = fileURLToPath(new URL('../../temp/', import.meta.url));
  await mkdir(root, { recursive: true });
  const dir = await mkdtemp(path.join(root, 'restore-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('gzip streams to SQL and preserves table values matching a compatibility SET', async t => {
  const dir = await workspace(t);
  const target = path.join(dir, 'restore.sql');
  const sql = '-- header\nSET transaction_timeout = 0;\n--\n-- Name: test\nCOPY test FROM stdin;\nSET transaction_timeout = 0;\n\\.\n';
  const gz = gzipSync(sql);
  await prepareRestore(Readable.from([...gz].map(byte => Buffer.from([byte]))), target);
  assert.equal(await readFile(target, 'utf8'), sql.replace('SET transaction_timeout = 0;\n', ''));
});

test('corrupt and truncated gzip cannot invoke destructive psql', async () => {
  const valid = gzipSync('SELECT 1;\n');
  for (const input of [Buffer.from('not gzip'), valid.subarray(0, valid.length - 4), gzipSync('')]) {
    await assert.rejects(runPgRestore(db, input, 'backup.sql.gz'));
    assert.equal(calls.length, 0);
  }
});

test('a late input failure cannot invoke destructive psql', async () => {
  const input = Readable.from((async function* () { yield Buffer.from('SELECT 1;\n'); throw new Error('late input failure'); })());
  await assert.rejects(runPgRestore(db, input));
  assert.equal(calls.length, 0);
});

test('gzip expansion exceeding the preparation cap cannot invoke psql', async () => {
  await assert.rejects(runPgRestore(db, gzipSync('SELECT 1;\n'.repeat(10000)), 'backup.sql.gz', { maxBytes: 1000 }), /лимит/);
  assert.equal(calls.length, 0);
});

test('slow preparation times out before invoking psql', async () => {
  const stream = new Readable({ read() {} });
  const keepAlive = setTimeout(() => stream.push(null), 1000);
  try {
    await assert.rejects(runPgRestore(db, stream, 'backup.sql', { timeoutMs: 10 }), /лимит/);
    assert.equal(calls.length, 0);
  } finally { clearTimeout(keepAlive); }
});

test('overlapping restore is rejected and failed preparation releases the guard', async () => {
  const input = new Readable({ read() {} });
  const first = runPgRestore(db, input, 'backup.sql.gz');
  await assert.rejects(runPgRestore(db, Buffer.from('SELECT 1;')), /уже выполняется/);
  assert.equal(calls.length, 0);
  input.push(Buffer.from('not a gzip archive'));
  input.push(null);
  await assert.rejects(first);
  assert.equal(calls.length, 0);
  await runPgRestore(db, Buffer.from('SELECT 1;'));
  assert.equal(calls.length, 2);
});

test('server gzip file is fully prepared before schema clear and import', async t => {
  const dir = await workspace(t);
  const file = path.join(dir, 'saved.sql.gz');
  await writeFile(file, gzipSync('SELECT 1;\n'));
  await runPgRestore(db, file, 'saved.sql.gz');
  assert.equal(calls.length, 2);
  assert.ok(calls[0].some(arg => arg.startsWith('DROP SCHEMA')));
  assert.ok(calls[1].includes('-f'));
});

test('missing server file is a caught preparation failure and never invokes psql', async t => {
  const dir = await workspace(t);
  await assert.rejects(runPgRestore(db, path.join(dir, 'missing.sql.gz'), 'missing.sql.gz'), /подготовить/);
  assert.equal(calls.length, 0);
});
