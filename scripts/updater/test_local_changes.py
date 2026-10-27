import datetime as dt
import unittest
import json
import subprocess
from unittest.mock import patch
import test_agent


class LocalChangesTests(unittest.TestCase):
    setUp = test_agent.UpdaterTests.setUp
    commit = test_agent.UpdaterTests.commit

    def backup(self):
        backup = self.state / 'backup-local'
        backup.mkdir()
        return backup

    def test_round_trip_preserves_index_binary_untracked_and_existing_stash(self):
        (self.root / 'prior.txt').write_text('prior')
        self.updater.git('stash', 'push', '-u')
        prior = self.updater.git('rev-parse', 'refs/stash')
        (self.root / 'version.json').write_text('staged')
        self.updater.git('add', 'version.json')
        (self.root / 'version.json').write_text('unstaged')
        (self.root / 'new file.bin').write_bytes(bytes(range(256)))
        before = self.updater.local_changes()
        backup = self.backup()
        stash = self.updater.save_local_changes(backup, before['id'])
        self.assertIsNone(self.updater.local_changes())
        self.assertFalse((self.root / 'new file.bin').exists())
        self.assertIn(prior, self.updater.git('stash', 'list', '--format=%H'))
        self.assertTrue((backup / 'local-changes.bundle').is_file())
        self.updater.restore_local_changes(stash)
        self.assertEqual(self.updater.local_changes(), before)
        self.assertEqual(self.updater.git('show', ':version.json'), 'staged')
        self.assertEqual((self.root / 'version.json').read_text(), 'unstaged')
        self.assertEqual((self.root / 'new file.bin').read_bytes(), bytes(range(256)))
        clone = self.state / 'recovered'
        subprocess.run(['git', 'clone', '-q', str(backup / 'local-changes.bundle'), str(clone)], check=True, capture_output=True)
        subprocess.run(['git', '-C', str(clone), 'fetch', '-q', str(backup / 'local-changes.bundle'), 'refs/stash:refs/recovery/local-changes'], check=True)
        recovered = subprocess.check_output(['git', '-C', str(clone), 'show', 'refs/recovery/local-changes:version.json'])
        self.assertEqual(recovered, b'unstaged')

    def test_runtime_configuration_stays_in_place(self):
        (self.root / '.gitignore').write_text('.env\n')
        self.commit()
        (self.root / '.env').write_text('TEST=keep')
        (self.root / 'docker-compose.override.yml').write_text('services: {}')
        self.updater.clean()
        (self.root / 'version.json').write_text('changed')
        stash = self.updater.save_local_changes(self.backup(), self.updater.local_changes()['id'])
        for name in ('.env', 'docker-compose.override.yml'):
            self.assertTrue((self.root / name).exists())
        self.updater.restore_local_changes(stash)
        self.assertEqual((self.root / '.env').read_text(), 'TEST=keep')

    def test_changed_approval_does_not_remove_files(self):
        (self.root / 'version.json').write_text('first')
        approval = self.updater.local_changes()['id']
        (self.root / 'version.json').write_text('second')
        with self.assertRaises(RuntimeError):
            self.updater.save_local_changes(self.backup(), approval)
        self.assertEqual((self.root / 'version.json').read_text(), 'second')

    def test_bundle_failure_restores_index_and_worktree(self):
        (self.root / 'version.json').write_text('staged')
        self.updater.git('add', '.')
        (self.root / 'version.json').write_text('unstaged')
        before = self.updater.local_changes()
        git = self.updater.git
        def fail(*args):
            if args[:2] == ('bundle', 'create'):
                raise RuntimeError('disk full')
            return git(*args)
        with patch.object(self.updater, 'git', side_effect=fail), self.assertRaisesRegex(RuntimeError, 'disk full'):
            self.updater.save_local_changes(self.backup(), before['id'])
        self.assertEqual(self.updater.local_changes(), before)
        self.assertFalse(self.updater.status['localChangesRecoveryRequired'])

    def test_failed_restore_requires_manual_recovery(self):
        (self.root / 'version.json').write_text('keep')
        approval = self.updater.local_changes()['id']
        git = self.updater.git
        def fail(*args):
            if args[:2] in (('bundle', 'create'), ('stash', 'apply')):
                raise RuntimeError('failure')
            return git(*args)
        backup = self.backup()
        with patch.object(self.updater, 'git', side_effect=fail), self.assertRaises(RuntimeError):
            self.updater.save_local_changes(backup, approval)
        self.assertTrue(self.updater.status['localChangesRecoveryRequired'])
        stash = json.loads((backup / 'local-changes.json').read_text())['stash']
        self.assertEqual(git('show', stash + ':version.json'), 'keep')

    def test_tracked_runtime_config_needs_manual_review(self):
        (self.root / 'docker-compose.override.yml').write_text('services: {}')
        self.commit()
        (self.root / 'docker-compose.override.yml').write_text('services: {api: {}}')
        changes = self.updater.local_changes()
        self.assertFalse(changes['canPreserve'])
        with self.assertRaises(RuntimeError):
            self.updater.clean(changes['id'])


    def test_renames_deletions_and_symlinks_round_trip(self):
        (self.root / 'delete-me').write_text('delete')
        self.commit()
        self.updater.git('mv', 'version.json', 'renamed.json')
        (self.root / 'delete-me').unlink()
        (self.root / 'link').symlink_to('renamed.json')
        before = self.updater.local_changes()
        stash = self.updater.save_local_changes(self.backup(), before['id'])
        self.updater.restore_local_changes(stash)
        self.assertEqual(self.updater.local_changes(), before)
        self.assertTrue((self.root / 'link').is_symlink())

    def test_scheduled_install_cannot_preserve_without_confirmation(self):
        (self.root / 'version.json').write_text('keep')
        with patch.object(self.updater, 'check') as check, self.assertRaises(RuntimeError):
            self.updater.install()
        check.assert_not_called()
        self.assertEqual((self.root / 'version.json').read_text(), 'keep')

    def test_local_backup_never_expires(self):
        backup = self.backup()
        self.updater.write_json(backup / 'manifest.json', {'createdAt': '2000-01-01T00:00:00+00:00', 'outcome': 'success', 'localChanges': True})
        self.updater.cleanup_backups(dt.datetime.now(dt.timezone.utc))
        self.assertTrue(backup.exists())

    def test_generated_nginx_does_not_block_and_survives_upstream_change(self):
        (self.root / 'nginx').mkdir()
        config = self.root / 'nginx/nginx.conf'
        config.write_text('upstream initial')
        previous = self.commit()
        config.write_text('upstream new')
        target = self.commit()
        self.updater.git('reset', '--hard', previous)
        config.write_text('server_name customer.example;')
        self.updater.clean()
        self.assertIsNone(self.updater.local_changes())
        backup = self.backup()
        stash = self.updater.save_local_changes(backup, None)
        self.updater.git('merge', '--ff-only', target)
        self.updater.restore_runtime_config(backup)
        self.assertEqual(config.read_text(), 'server_name customer.example;')
        self.updater.clean()
        self.updater.git('reset', '--hard', previous)
        self.updater.restore_local_changes(stash)
        self.updater.restore_runtime_config(backup)
        self.assertEqual(config.read_text(), 'server_name customer.example;')

    def test_unmodified_nginx_is_also_preserved(self):
        (self.root / 'nginx').mkdir()
        config = self.root / 'nginx/nginx.conf'
        config.write_text('configured domain')
        self.commit()
        backup = self.backup()
        self.assertIsNone(self.updater.save_local_changes(backup, None))
        config.write_text('upstream domain')
        self.updater.restore_runtime_config(backup)
        self.assertEqual(config.read_text(), 'configured domain')

    def test_deleted_or_staged_nginx_requires_manual_confirmation(self):
        (self.root / 'nginx').mkdir()
        config = self.root / 'nginx/nginx.conf'
        config.write_text('original')
        self.commit()
        config.unlink()
        with self.assertRaises(RuntimeError):
            self.updater.clean()
        config.write_text('staged')
        self.updater.git('add', '.')
        with self.assertRaises(RuntimeError):
            self.updater.clean()

    def test_detached_release_allows_fast_forward_and_preserves_config(self):
        (self.root / 'nginx').mkdir()
        config = self.root / 'nginx/nginx.conf'
        config.write_text('release config')
        previous = self.commit()
        (self.root / 'fix').write_text('new release')
        target = self.commit()
        self.updater.git('checkout', '--detach', previous)
        config.write_text('customer domain')
        self.updater.clean()
        backup = self.backup()
        stash = self.updater.save_local_changes(backup, None)
        self.updater.git('merge', '--ff-only', target)
        self.updater.restore_runtime_config(backup)
        self.assertEqual(self.updater.git('rev-parse', 'HEAD'), target)
        self.assertEqual(self.updater.git('branch', '--show-current'), '')
        self.assertEqual(config.read_text(), 'customer domain')
        self.updater.clean()
        self.updater.git('reset', '--hard', previous)
        self.updater.restore_local_changes(stash)
        self.assertEqual(config.read_text(), 'customer domain')
