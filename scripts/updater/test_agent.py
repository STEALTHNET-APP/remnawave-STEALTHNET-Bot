import datetime as dt
import importlib.util
import json
import io
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('agent', Path(__file__).with_name('agent.py'))
agent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent)


class UpdaterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'repo'
        self.root.mkdir()
        subprocess.run(['git', 'init', '-q', str(self.root)], check=True)
        subprocess.run(['git', '-C', str(self.root), 'config', 'user.email', 'test@example.invalid'], check=True)
        subprocess.run(['git', '-C', str(self.root), 'config', 'user.name', 'Test'], check=True)
        (self.root / 'version.json').write_text('{"version":"6.7.0"}')
        self.commit()
        self.state = Path(self.temp.name) / 'state'
        self.updater = agent.Updater({'project': str(self.root), 'stateDir': str(self.state)})

    def commit(self):
        subprocess.run(['git', '-C', str(self.root), 'add', '.'], check=True)
        subprocess.run(['git', '-C', str(self.root), 'commit', '-qm', 'fixture'], check=True)
        return subprocess.check_output(['git', '-C', str(self.root), 'rev-parse', 'HEAD']).decode().strip()

    def test_dirty_worktree_blocked(self):
        self.updater.clean()
        (self.root / 'version.json').write_text('{}')
        with self.assertRaisesRegex(RuntimeError, 'локальные изменения'):
            self.updater.clean()

    def test_untracked_changes_blocked(self):
        (self.root / 'local-file').write_text('keep')
        with self.assertRaises(RuntimeError):
            self.updater.clean()

    def test_settings_strict(self):
        self.updater.configure({'enabled': True, 'channel': 'main', 'hourUtc': 6})
        self.assertEqual(json.loads((self.state / 'settings.json').read_text())['channel'], 'main')
        for invalid in [{'enabled': 'true', 'channel': 'main', 'hourUtc': 6}, {'enabled': True, 'channel': '../bad', 'hourUtc': 6}, {'enabled': True, 'channel': 'main', 'hourUtc': 24}, {'enabled': True, 'channel': 'main', 'hourUtc': True}, {'enabled': True, 'channel': 'main', 'hourUtc': 6, 'command': 'anything'}]:
            with self.assertRaises(ValueError):
                self.updater.configure(invalid)

    def test_schedule_once_daily_only_in_selected_hour(self):
        self.updater.configure({'enabled': True, 'channel': 'main', 'hourUtc': 6})
        with patch.object(self.updater, 'start') as start:
            for instant in [dt.datetime(2026, 10, 16, 5), dt.datetime(2026, 10, 16, 6), dt.datetime(2026, 10, 16, 6, 10), dt.datetime(2026, 10, 17, 6)]:
                self.updater.scheduled(instant)
            self.assertEqual(start.call_count, 2)

    def test_schedule_disabled_by_default(self):
        with patch.object(self.updater, 'start') as start:
            self.updater.scheduled(dt.datetime(2026, 10, 16, 3))
            start.assert_not_called()

    def test_busy_operation_rejected(self):
        self.updater.lock.acquire()
        with self.assertRaises(RuntimeError):
            self.updater.start('install')
        with self.assertRaises(RuntimeError):
            self.updater.configure({'enabled': True, 'channel': 'main', 'hourUtc': 3})
        self.updater.lock.release()

    def test_interrupted_update_cannot_restart_even_after_check(self):
        agent.save(self.state / 'status.json', {'phase': 'installing'})
        updater = agent.Updater({'project': str(self.root), 'stateDir': str(self.state)})
        self.assertEqual(updater.status['phase'], 'interrupted')
        updater.phase('ready', 'checked')
        with self.assertRaises(RuntimeError):
            updater.start('install')
        updater.settings['enabled'] = True
        with patch.object(updater, 'start') as start:
            updater.scheduled(dt.datetime(2026, 10, 16, 3))
            start.assert_not_called()

    def test_database_and_infrastructure_changes_never_stop_services(self):
        for path in ['backend/prisma/schema.prisma', 'docker-compose.yml', 'backend/docker-entrypoint.sh', 'scripts/updater/agent.py', 'nginx/default.conf']:
            updater = self.updater
            with patch.object(updater, 'check'), patch.object(updater, 'git', return_value=path), patch.object(updater, 'clean'), patch.object(updater, 'compose') as compose:
                updater.status.update(available=True, target='b' * 40, current='a' * 40)
                with self.assertRaises(RuntimeError):
                    updater.install()
                compose.assert_not_called()

    def test_check_fetches_fixed_origin_and_rejects_downgrade(self):
        previous = self.updater.git('rev-parse', 'HEAD')
        (self.root / 'version.json').write_text('{"version":"6.7.1"}')
        latest = self.commit()
        real = self.updater.git
        def fetch(*args):
            if args[0] == 'fetch':
                self.assertEqual(args[2], agent.REPOSITORY)
                (self.root / '.git' / 'FETCH_HEAD').write_text(previous + '\n')
                return ''
            return real(*args)
        self.updater.settings['channel'] = 'main'
        with patch.object(self.updater, 'git', side_effect=fetch):
            self.updater.check()
        self.assertFalse(self.updater.status['available'])
        self.assertEqual(self.updater.status['current'], latest)

    def test_draft_and_prerelease_never_install(self):
        for flags in [{'draft': True, 'prerelease': False}, {'draft': False, 'prerelease': True}]:
            response = io.BytesIO(json.dumps({**flags, 'tag_name': 'v6.7.0'}).encode())
            with patch.object(agent.urllib.request, 'urlopen', return_value=response), patch.object(self.updater, 'git') as git:
                with self.assertRaises(RuntimeError):
                    self.updater.check()
                git.assert_not_called()

    def test_new_commit_same_version_is_available(self):
        previous = self.updater.git('rev-parse', 'HEAD')
        (self.root / 'fix.txt').write_text('fix')
        latest = self.commit()
        self.updater.git('reset', '--hard', previous)
        real = self.updater.git
        def fetch(*args):
            if args[0] == 'fetch':
                (self.root / '.git' / 'FETCH_HEAD').write_text(latest + '\n')
                return ''
            return real(*args)
        self.updater.settings['channel'] = 'main'
        with patch.object(self.updater, 'git', side_effect=fetch):
            self.updater.check()
        self.assertTrue(self.updater.status['available'])
        self.assertEqual(self.updater.status['version'], '6.7.0')


if __name__ == '__main__':
    unittest.main()
