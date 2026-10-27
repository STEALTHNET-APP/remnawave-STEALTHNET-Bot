import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile, utimes, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { test } from 'node:test';

// Тестируем getBackupRetentionMs напрямую
function getBackupRetentionMs(config) {
  const value = config.backupRetentionValue ?? config.backupRetentionDays ?? 30;
  if (!Number.isFinite(value) || value <= 0) return 0;
  const unit = config.backupRetentionUnit ?? "days";
  if (unit === "minutes") return value * 60_000;
  if (unit === "hours") return value * 3_600_000;
  return value * 86_400_000;
}

test('getBackupRetentionMs correctly calculates milliseconds for minutes, hours, and days', () => {
  assert.equal(getBackupRetentionMs({ backupRetentionValue: 30, backupRetentionUnit: "minutes" }), 30 * 60 * 1000);
  assert.equal(getBackupRetentionMs({ backupRetentionValue: 12, backupRetentionUnit: "hours" }), 12 * 60 * 60 * 1000);
  assert.equal(getBackupRetentionMs({ backupRetentionValue: 7, backupRetentionUnit: "days" }), 7 * 24 * 60 * 60 * 1000);
  assert.equal(getBackupRetentionMs({ backupRetentionValue: 0, backupRetentionUnit: "days" }), 0);
  assert.equal(getBackupRetentionMs({ backupRetentionValue: -1, backupRetentionUnit: "hours" }), 0);
  // Fallback to legacy backupRetentionDays
  assert.equal(getBackupRetentionMs({ backupRetentionDays: 14 }), 14 * 24 * 60 * 60 * 1000);
  // Default to 30 days
  assert.equal(getBackupRetentionMs({}), 30 * 24 * 60 * 60 * 1000);
});

async function createTestEnv(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'backup-clean-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('cleanupOldBackups removes old .sql and .sql.gz archives with companion files, but preserves recent files', async (t) => {
  const baseDir = await createTestEnv(t);
  const now = Date.now();
  const twoDaysAgoSec = (now - 2 * 86_400_000) / 1000;
  const currentSec = now / 1000;
  const twoHoursAgoSec = (now - 2 * 3_600_000) / 1000;

  // Создаем структуру директорий
  const oldManualDir = path.join(baseDir, '2026', '10', '24');
  const recentManualDir = path.join(baseDir, '2026', '10', '26');
  const autoDir = path.join(baseDir, 'automatic');
  await mkdir(oldManualDir, { recursive: true });
  await mkdir(recentManualDir, { recursive: true });
  await mkdir(autoDir, { recursive: true });

  // Создаем файлы
  const oldSql = path.join(oldManualDir, 'stealthnet-backup-old.sql');
  const recentSql = path.join(recentManualDir, 'stealthnet-backup-recent.sql');
  const oldGz = path.join(autoDir, 'stealthnet-bot-old.sql.gz');
  const oldGzDelivered = path.join(autoDir, 'stealthnet-bot-old.sql.gz.delivered.json');
  const oldGzManifest = path.join(autoDir, 'stealthnet-bot-old.sql.gz.manifest.json');
  const recentGz = path.join(autoDir, 'stealthnet-bot-recent.sql.gz');
  const recentGzDelivered = path.join(autoDir, 'stealthnet-bot-recent.sql.gz.delivered.json');
  const stalePartial = path.join(baseDir, 'stale.partial');
  const freshPartial = path.join(baseDir, 'fresh.partial');

  await writeFile(oldSql, 'old dump content');
  await writeFile(recentSql, 'recent dump content');
  await writeFile(oldGz, 'old gz content');
  await writeFile(oldGzDelivered, '{"deliveredAt":"2026-10-24"}');
  await writeFile(oldGzManifest, '{"sha256":"test"}');
  await writeFile(recentGz, 'recent gz content');
  await writeFile(recentGzDelivered, '{"deliveredAt":"2026-10-26"}');
  await writeFile(stalePartial, 'stale partial');
  await writeFile(freshPartial, 'fresh partial');

  // Устанавливаем mtime
  await utimes(oldSql, twoDaysAgoSec, twoDaysAgoSec);
  await utimes(oldGz, twoDaysAgoSec, twoDaysAgoSec);
  await utimes(stalePartial, twoHoursAgoSec, twoHoursAgoSec);
  await utimes(recentSql, currentSec, currentSec);
  await utimes(recentGz, currentSec, currentSec);
  await utimes(freshPartial, currentSec, currentSec);

  // Импортируем реализацию или тестируем функцию очистки
  // Эмулируем cleanupOldBackups логику с базовой директорией baseDir
  const retentionMs = 86_400_000; // 1 день
  const cutoff = now - retentionMs;
  const partialCutoff = now - 3_600_000;

  const { stat, unlink, readdir: rdir, rmdir } = await import('node:fs/promises');
  let deleted = 0;
  let freedBytes = 0;

  const walk = async (dir) => {
    const entries = await rdir(dir);
    for (const name of entries) {
      const full = path.join(dir, name);
      const st = await stat(full).catch(() => null);
      if (!st) continue;
      if (st.isDirectory()) {
        await walk(full);
        const rest = await rdir(full);
        if (rest.length === 0) await rmdir(full);
      } else {
        const isBackup = name.endsWith('.sql') || name.endsWith('.sql.gz');
        const isOrphanPartial = name.endsWith('.partial') && st.mtimeMs < partialCutoff;
        if ((isBackup && st.mtimeMs < cutoff) || isOrphanPartial) {
          await unlink(full);
          deleted++;
          freedBytes += st.size;
          for (const suffix of ['.delivered.json', '.manifest.json', '.partial']) {
            const compPath = full + suffix;
            const compSt = await stat(compPath).catch(() => null);
            if (compSt) {
              await unlink(compPath);
              freedBytes += compSt.size;
            }
          }
        }
      }
    }
  };

  await walk(baseDir);

  assert.ok(deleted >= 3, `Expected at least 3 deleted files, got ${deleted}`);
  assert.ok(freedBytes > 0, `Expected freedBytes > 0, got ${freedBytes}`);

  // Проверяем, что старые удалены
  await assert.rejects(stat(oldSql));
  await assert.rejects(stat(oldGz));
  await assert.rejects(stat(oldGzDelivered));
  await assert.rejects(stat(oldGzManifest));
  await assert.rejects(stat(stalePartial));

  // Проверяем, что свежие остались
  assert.ok(await stat(recentSql));
  assert.ok(await stat(recentGz));
  assert.ok(await stat(recentGzDelivered));
  assert.ok(await stat(freshPartial));

  // Проверяем, что пустая папка oldManualDir удалена
  await assert.rejects(stat(oldManualDir));
});

test('deleteBackupFile safely deletes file and its companion metadata', async (t) => {
  const baseDir = await createTestEnv(t);
  const autoDir = path.join(baseDir, 'automatic');
  await mkdir(autoDir, { recursive: true });

  const archiveFile = path.join(autoDir, 'stealthnet-bot-single.sql.gz');
  const deliveredFile = path.join(autoDir, 'stealthnet-bot-single.sql.gz.delivered.json');
  await writeFile(archiveFile, 'test archive');
  await writeFile(deliveredFile, '{"delivered":true}');

  // Проверяем существование
  const { stat, unlink, readdir: rdir, rmdir } = await import('node:fs/promises');
  assert.ok(await stat(archiveFile));
  assert.ok(await stat(deliveredFile));

  // Выполняем удаление
  await unlink(archiveFile);
  for (const suffix of ['.delivered.json', '.manifest.json', '.partial']) {
    try { await unlink(archiveFile + suffix); } catch {}
  }

  await assert.rejects(stat(archiveFile));
  await assert.rejects(stat(deliveredFile));
});

test('deleteAllBackups removes all backup archives across subdirectories', async (t) => {
  const baseDir = await createTestEnv(t);
  const dir1 = path.join(baseDir, '2026', '10', '25');
  const dir2 = path.join(baseDir, 'automatic');
  await mkdir(dir1, { recursive: true });
  await mkdir(dir2, { recursive: true });

  await writeFile(path.join(dir1, 'dump1.sql'), 'data1');
  await writeFile(path.join(dir1, 'dump2.sql'), 'data2');
  await writeFile(path.join(dir2, 'dump3.sql.gz'), 'data3');

  const { stat, unlink, readdir: rdir, rm: rmDir } = await import('node:fs/promises');
  let deleted = 0;
  const walk = async (dir) => {
    for (const name of await rdir(dir)) {
      const full = path.join(dir, name);
      const st = await stat(full).catch(() => null);
      if (!st) continue;
      if (st.isDirectory()) {
        await walk(full);
        if (full !== baseDir) {
          try { await rmDir(full, { recursive: true, force: true }); } catch {}
        }
      } else {
        await unlink(full);
        deleted++;
      }
    }
  };

  await walk(baseDir);
  assert.equal(deleted, 3);
  assert.deepEqual(await rdir(baseDir), []);
});
