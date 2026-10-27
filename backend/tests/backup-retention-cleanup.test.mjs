import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, utimes, symlink, access, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
const temp = await mkdtemp(path.join(os.tmpdir(), 'backup-retention-test-'));
process.env.BACKUPS_DIR = path.join(temp, 'backups');
await mkdir(process.env.BACKUPS_DIR);
const { cleanupOldBackups, deleteAllBackups, deleteBackupFile, resolveBackupPath } = await import('../dist/modules/backup/backup.service.js');
const { getBackupRetentionMs, holdBackup } = await import('../dist/modules/backup/backup-retention.js');
const exists = p => access(p).then(() => true, () => false);
async function archive(name, days = 0) {
  const file = path.join(process.env.BACKUPS_DIR, name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, 'test backup');
  const age = new Date(Date.now() - days * 86400000);
  await utimes(file, age, age);
  return file;
}
try {
  await test('retention units and zero preserve legacy day semantics', async () => {
    assert.equal(getBackupRetentionMs({ backupRetentionValue: 2, backupRetentionUnit: 'minutes' }), 120000);
    assert.equal(getBackupRetentionMs({ backupRetentionValue: 2, backupRetentionUnit: 'hours' }), 7200000);
    const file = await archive('legacy.sql', 2);
    assert.equal((await cleanupOldBackups(1000)).deleted, 0);
    assert.equal((await cleanupOldBackups({ backupRetentionValue: 0 })).deleted, 0);
    assert.ok(await exists(file));
    assert.equal((await cleanupOldBackups({ backupRetentionValue: 1, backupRetentionUnit: 'days' })).deleted, 1);
  });
  await test('retention removes expired archives and metadata but preserves partial writes', async () => {
    const old = await archive('2026/10/old.sql.gz', 2);
    await writeFile(old + '.delivered.json', '{}');
    const recent = await archive('2026/10/recent.sql');
    const partial = await archive('long-running.sql.partial', 2);
    assert.equal((await cleanupOldBackups({ backupRetentionValue: 1, backupRetentionUnit: 'hours' })).deleted, 1);
    assert.equal(await exists(old + '.delivered.json'), false);
    assert.ok(await exists(recent));
    assert.ok(await exists(partial));
  });
  await test('delete all and direct paths never follow symlinks outside backup root', async () => {
    const outside = path.join(temp, 'outside');
    await mkdir(outside);
    await writeFile(path.join(outside, 'private.sql'), 'keep');
    await symlink(outside, path.join(process.env.BACKUPS_DIR, 'linked'));
    await symlink(path.join(outside, 'private.sql'), path.join(process.env.BACKUPS_DIR, 'linked.sql'));
    assert.equal(resolveBackupPath('linked/private.sql'), null);
    assert.equal(await deleteBackupFile('linked/private.sql'), false);
    assert.equal(await deleteBackupFile('../outside/private.sql'), false);
    await cleanupOldBackups({ backupRetentionValue: 1, backupRetentionUnit: 'minutes' });
    await deleteAllBackups();
    assert.ok(await exists(path.join(outside, 'private.sql')));
  });
  await test('active archives and unrelated files survive delete all', async () => {
    const file = await archive('sending.sql.gz', 2);
    const note = await archive('operator-notes.txt', 2);
    const release = holdBackup(file);
    await cleanupOldBackups(1);
    await deleteAllBackups();
    assert.ok(await exists(file));
    assert.ok(await exists(note));
    release();
    assert.equal(await deleteBackupFile('sending.sql.gz'), true);
    assert.equal(await exists(file), false);
  });
} finally { await rm(temp, { recursive: true, force: true }); }
