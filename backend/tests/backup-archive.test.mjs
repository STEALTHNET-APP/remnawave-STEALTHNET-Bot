import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { test } from 'node:test';
import { writeGzipArchive, readFileParts, pruneDeliveredBackups, compatibleDumpHeader } from '../dist/modules/backup/backup-archive.js';
import { Readable } from 'node:stream';

async function workspace(t) {
  const dir = await mkdtemp(fileURLToPath(new URL('../../temp/backup-test-', import.meta.url)));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('streams a dump to gzip and publishes only after successful process exit', async t => {
  const dir = await workspace(t);
  const file = path.join(dir, 'dump.sql.gz');
  const line = 'CREATE TABLE example (id integer);\n';
  const sql = line.repeat(10000);
  const child = spawn(process.execPath, ['-e', `process.stdout.write(${JSON.stringify(line)}.repeat(10000))`]);
  await writeGzipArchive(child, file);
  assert.equal(gunzipSync(await readFile(file)).toString(), sql);
  assert.deepEqual(await readdir(dir), ['dump.sql.gz']);
});

test('a dump failing after stdout closes is not published as a successful backup', async t => {
  const dir = await workspace(t);
  const file = path.join(dir, 'failed.sql.gz');
  const child = spawn(process.execPath, ['-e', 'process.stdout.end("partial SQL"); setTimeout(() => process.exit(2), 100)']);
  await assert.rejects(writeGzipArchive(child, file), /code 2/);
  assert.deepEqual(await readdir(dir), []);
});

test('spawn failure removes partial archive', async t => {
  const dir = await workspace(t);
  await assert.rejects(writeGzipArchive(spawn('missing-backup-test-executable'), path.join(dir, 'failed.sql.gz')));
  assert.deepEqual(await readdir(dir), []);
});

test('PG18 dump header restores on PG16 without changing a matching value in table data', async () => {
  const sql = '-- Dumped from database version 16.13\nSET transaction_timeout = 0;\n--\n-- Name: example; Type: TABLE\nCREATE TABLE example (value text);\nCOPY example FROM stdin;\nSET transaction_timeout = 0;\n\\.\n';
  const output = [];
  for await (const chunk of Readable.from([Buffer.from(sql.slice(0, 51)), Buffer.from(sql.slice(51))]).pipe(compatibleDumpHeader())) output.push(chunk);
  assert.equal(Buffer.concat(output).toString(), sql.replace('SET transaction_timeout = 0;\n', ''));
});

test('multipart reassembly is lossless and every part respects the limit', async t => {
  const dir = await workspace(t);
  const file = path.join(dir, 'parts.bin');
  const original = Buffer.from(Array.from({ length: 2501 }, (_, i) => i % 256));
  await writeFile(file, original);
  const parts = [];
  for await (const part of readFileParts(file, 1000)) parts.push(part);
  assert.deepEqual(parts.map(p => p.length), [1000, 1000, 501]);
  assert.deepEqual(Buffer.concat(parts), original);
});

test('retention requires age and seven newer deliveries; failed/manual archives survive', async t => {
  const dir = await workspace(t);
  const now = Date.parse('2026-09-29T00:00:00Z');
  for (let i = 1; i <= 10; i++) {
    const name = `stealthnet-bot-${String(i).padStart(2, '0')}.sql.gz`;
    await writeFile(path.join(dir, name), 'archive');
    const age = i <= 2 ? 60 : i === 3 ? 5 : 1;
    await writeFile(path.join(dir, name + '.delivered.json'), JSON.stringify({ deliveredAt: new Date(now - age * 86400000 + i).toISOString() }));
  }
  await writeFile(path.join(dir, 'stealthnet-bot-failed.sql.gz'), 'not delivered');
  await writeFile(path.join(dir, 'stealthnet-bot-corrupt.sql.gz'), 'archive');
  await writeFile(path.join(dir, 'stealthnet-bot-corrupt.sql.gz.delivered.json'), '{}');
  await writeFile(path.join(dir, 'manual.sql'), 'manual backup');
  await pruneDeliveredBackups(dir, 'stealthnet-bot-', 30, 7, now);
  const files = await readdir(dir);
  assert.ok(!files.includes('stealthnet-bot-01.sql.gz'));
  assert.ok(!files.includes('stealthnet-bot-02.sql.gz'));
  assert.ok(files.includes('stealthnet-bot-03.sql.gz')); // young despite being outside last seven
  assert.ok(files.includes('stealthnet-bot-failed.sql.gz'));
  assert.ok(files.includes('stealthnet-bot-corrupt.sql.gz'));
  assert.ok(files.includes('manual.sql'));
  await pruneDeliveredBackups(dir, 'stealthnet-bot-', 30, 7, now + 100 * 86400000);
  assert.equal((await readdir(dir)).filter(n => /^stealthnet-bot-\d+\.sql\.gz$/.test(n)).length, 7);
});

test('zero retention keeps every delivered archive', async t => {
  const dir = await workspace(t);
  const file = path.join(dir, 'stealthnet-bot-old.sql.gz');
  await writeFile(file, 'archive');
  await writeFile(file + '.delivered.json', JSON.stringify({ deliveredAt: '2000-01-01' }));
  await pruneDeliveredBackups(dir, 'stealthnet-bot-', 0);
  assert.equal((await readdir(dir)).length, 2);
});

test('actual gzip multipart reassembly passes integrity validation', async t => {
  const dir = await workspace(t);
  const file = path.join(dir, 'dump.sql.gz');
  const sql = 'SELECT 1;\n'.repeat(10000);
  await writeGzipArchive(spawn(process.execPath, ['-e', `process.stdout.write(${JSON.stringify('SELECT 1;\n')}.repeat(10000))`]), file);
  const parts = [];
  for await (const part of readFileParts(file, 50)) { assert.ok(part.length <= 50); parts.push(part); }
  assert.ok(parts.length > 1);
  assert.equal(gunzipSync(Buffer.concat(parts)).toString(), sql);
});
