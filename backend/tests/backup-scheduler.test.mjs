import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
const config = { autoBackupEnabled: true, telegramBotToken: 'test-secret', notificationTelegramGroupId: '-1001', notificationTopicBackups: '2', backupRetentionDays: 30 };
let sent, saved, markers, pruned, rejectUpload, rejectSource, waiting, rejectAt;
mock.module('../dist/modules/backup/backup.service.js', { namedExports: { parseDatabaseUrl: url => url ? { database: 'test' } : null } });
process.env.DATABASE_URL = 'postgresql://user:password@database/bot';
mock.module('../dist/modules/client/client.service.js', { namedExports: { getSystemConfig: async () => ({ ...config }) } });
mock.module('../dist/modules/proxy-util/get-proxy-url.js', { namedExports: { getProxyUrl: async () => null } });
mock.module('node:fs/promises', { namedExports: { writeFile: async (...args) => markers.push(args), mkdtemp: async () => '', readFile: async () => '', rm: async () => {}, readdir: async () => [], stat: async () => ({}), mkdir: async () => {} } });
mock.module('../dist/modules/backup/backup-archive.js', { namedExports: {
  AUTO_BACKUPS_DIR: '/backups', TELEGRAM_PART_BYTES: 10,
  saveCompressedBackup: async (_db, source) => {
    saved.push(source);
    if (waiting) await waiting;
    if (rejectSource === source) throw new Error('dump failed');
    return { filename: `${source}.sql.gz`, fullPath: `/backups/${source}.sql.gz`, bytes: 15, sha256: 'test-hash' };
  },
  readFileParts: async function* () { yield Buffer.alloc(10); yield Buffer.alloc(5); },
  pruneDeliveredBackups: async (...args) => pruned.push(args),
} });
mock.module('../dist/modules/proxy-util/proxy-fetch.js', { namedExports: { proxyFetch: async (_url, init) => {
  sent.push(init.body);
  return { json: async () => (rejectUpload || sent.length === rejectAt) ? { ok: false, description: 'forbidden' } : { ok: true, result: { message_id: sent.length } } };
} } });
const { runAutoBackup } = await import('../dist/modules/backup/auto-backup.scheduler.js');
beforeEach(() => { sent = []; saved = []; markers = []; pruned = []; rejectUpload = false; rejectAt = 0; rejectSource = ''; waiting = null; config.autoBackupEnabled = true; });

test('bot database delivers all parts and manifest to the configured topic', async () => {
  await runAutoBackup();
  assert.deepEqual(saved, ['bot']);
  assert.equal(sent.length, 3);
  assert.ok(sent.every(form => form.get('chat_id') === '-1001' && form.get('message_thread_id') === '2'));
  assert.equal(sent[0].get('document').name, 'bot.sql.gz.part001-of-002');
  assert.equal(markers.length, 1);
  assert.equal(pruned.length, 1);
  assert.equal(pruned[0][2], 30);
});
test('Telegram rejection propagates and never marks or prunes failed deliveries', async () => {
  rejectUpload = true;
  await assert.rejects(runAutoBackup(), /Telegram rejected/);
  assert.equal(markers.length, 0);
  assert.equal(pruned.length, 0);
});
test('dump failure propagates and does not upload backup parts', async () => {
  rejectSource = 'bot';
  await assert.rejects(runAutoBackup(), /dump failed/);
  assert.deepEqual(saved, ['bot']);
  assert.equal(markers.length, 0);
  assert.equal(pruned.length, 0);
});
test('disabled scheduled backups skip; force sends using existing configuration', async () => {
  config.autoBackupEnabled = false;
  await runAutoBackup();
  assert.equal(saved.length, 0);
  await runAutoBackup({ force: true });
  assert.deepEqual(saved, ['bot']);
});
test('concurrent manual and scheduled runs do not create duplicate dumps', async () => {
  let release;
  waiting = new Promise(resolve => { release = resolve; });
  const first = runAutoBackup();
  await assert.rejects(runAutoBackup(), /уже выполняется/);
  release();
  await first;
  assert.deepEqual(saved, ['bot']);
});

test('manifest rejection prevents marking or pruning that archive', async () => {
  rejectAt = 3;
  await assert.rejects(runAutoBackup({ force: true }), /Telegram rejected/);
  assert.equal(markers.length, 0);
  assert.equal(pruned.length, 0);
});
