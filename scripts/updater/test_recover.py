import fcntl
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('recover_update', Path(__file__).with_name('recover-update.py'))
recovery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recovery)


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.state = Path(self.temp.name)
        self.config = {'project': str(self.state / 'repo'), 'stateDir': str(self.state)}
        (self.state / 'status.json').write_text(json.dumps({'phase': 'ready'}))

    def test_active_operation_is_not_interrupted(self):
        with (self.state / 'operation.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with patch.object(recovery.subprocess, 'run') as systemctl, self.assertRaisesRegex(RuntimeError, 'выполняется'):
                recovery.recover(self.config, 'main')
            systemctl.assert_not_called()

    def test_interrupted_install_requires_review(self):
        for status in ({'phase': 'installing'}, {'phase': 'failed', 'recoveryRequired': True}):
            (self.state / 'status.json').write_text(json.dumps(status))
            with patch.object(recovery.subprocess, 'run') as systemctl, self.assertRaises(RuntimeError):
                recovery.recover(self.config, 'main')
            systemctl.assert_not_called()

    def test_service_restored_after_success_or_failure_without_saving_settings(self):
        for failure in (False, True):
            updater = Mock(settings={'channel': 'stable'}, status={'message': 'done'})
            if failure:
                updater.install.side_effect = RuntimeError('test failure')
            with patch.object(recovery, 'Updater', return_value=updater), patch.object(recovery.subprocess, 'run', return_value=Mock(returncode=0)) as systemctl:
                if failure:
                    with self.assertRaisesRegex(RuntimeError, 'test failure'):
                        recovery.recover(self.config, 'main')
                    updater.phase.assert_called_once_with('failed', 'test failure')
                else:
                    recovery.recover(self.config, 'main')
                self.assertEqual([call.args[0][1] for call in systemctl.call_args_list], ['is-active', 'stop', 'start'])
                self.assertEqual(updater.settings['channel'], 'main')
                updater.configure.assert_not_called()

    def test_previously_stopped_service_stays_stopped(self):
        updater = Mock(settings={}, status={})
        with patch.object(recovery, 'Updater', return_value=updater), patch.object(recovery.subprocess, 'run', return_value=Mock(returncode=3)) as systemctl:
            recovery.recover(self.config, 'main')
        self.assertEqual(systemctl.call_count, 1)
