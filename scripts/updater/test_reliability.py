import io
import json
from pathlib import Path
import shutil
import ssl
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch
import urllib.error

from agent import Updater
from reliability import CommandFailure, preflight


class ReliabilityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.updater = Updater({'project': self.temp.name, 'stateDir': self.temp.name + '/state'})

    def test_download_recovers_after_transient_failures(self):
        operation = Mock(side_effect=[CommandFailure('network'), TimeoutError('timeout'), 'ok'])
        with patch('reliability.time.sleep') as sleep:
            self.assertEqual(self.updater.download_retry('Git', operation), 'ok')
        self.assertEqual(operation.call_count, 3)
        self.assertEqual([c.args[0] for c in sleep.call_args_list], [5, 10])

    def test_download_stops_after_three_failures(self):
        operation = Mock(side_effect=CommandFailure('network'))
        with patch('reliability.time.sleep'), self.assertRaisesRegex(RuntimeError, 'Текущая версия продолжает'):
            self.updater.download_retry('Git', operation)
        self.assertEqual(operation.call_count, 3)

    def test_http_transient_errors_retry(self):
        for code in (429, 500, 502, 503, 504):
            operation = Mock(side_effect=[urllib.error.HTTPError('https://example.invalid', code, 'error', {}, None), 'ok'])
            with patch('reliability.time.sleep'):
                self.assertEqual(self.updater.download_retry('GitHub', operation), 'ok')
            self.assertEqual(operation.call_count, 2)

    def test_permanent_errors_are_not_retried(self):
        for error in [urllib.error.HTTPError('https://example.invalid', code, 'error', {}, None) for code in (401, 403, 404)] + [urllib.error.URLError(ssl.SSLCertVerificationError('certificate'))]:
            operation = Mock(side_effect=error)
            with patch('reliability.time.sleep') as sleep, self.assertRaises(RuntimeError):
                self.updater.download_retry('GitHub', operation)
            operation.assert_called_once()
            sleep.assert_not_called()

    def test_release_download_retry_and_json_validation(self):
        with patch('reliability.urllib.request.urlopen', side_effect=[urllib.error.URLError('network'), io.BytesIO(b'{"tag_name":"v7.0.0"}')]), patch('reliability.time.sleep'):
            self.assertEqual(self.updater.release_info('https://example.invalid')['tag_name'], 'v7.0.0')
        with patch('reliability.urllib.request.urlopen', return_value=io.BytesIO(b'invalid')) as load, self.assertRaises(ValueError):
            self.updater.release_info('https://example.invalid')
        load.assert_called_once()

    def test_missing_command_and_timeouts_are_readable(self):
        with patch('agent.subprocess.run', side_effect=FileNotFoundError()), self.assertRaisesRegex(RuntimeError, 'Не найдена команда git'):
            self.updater.git('status')
        with patch('agent.subprocess.run', side_effect=subprocess.TimeoutExpired('git', 120)), self.assertRaisesRegex(CommandFailure, '120 сек'):
            self.updater.git('fetch')

    def test_preflight_blocks_before_any_deployment_mutation(self):
        def checked():
            self.updater.status.update(available=True, current='old', target='new')
        with patch.object(self.updater, 'clean'), patch.object(self.updater, 'check', side_effect=checked), patch.object(self.updater, 'preflight', side_effect=RuntimeError('missing Docker')), patch.object(self.updater, 'service_images') as images, patch.object(self.updater, 'deploy_from_archive') as deploy:
            with self.assertRaisesRegex(RuntimeError, 'missing Docker'):
                self.updater.install()
        images.assert_not_called()
        deploy.assert_not_called()

    def test_cleanup_failure_does_not_block_update_checks(self):
        import datetime as dt
        with patch.object(self.updater, 'cleanup_backups', side_effect=RuntimeError('cleanup error')), patch.object(self.updater, 'start') as start:
            self.updater.scheduled(dt.datetime(2026, 11, 15, 3))
        start.assert_called_once_with('check')
        self.assertIn('cleanup error', self.updater.status['cleanupWarning'])

    def docker_run(self, args):
        if args == ['docker', 'compose', 'version']:
            return 'Docker Compose v2'
        if args == ['docker', 'compose', 'up', '--help']:
            return '--wait --wait-timeout --pull'
        if args == ['docker', 'info', '--format', '{{json .}}']:
            return json.dumps({'OSType': 'linux', 'DockerRootDir': self.temp.name, 'SecurityOptions': []})
        self.fail('Unexpected command: ' + str(args))

    def test_preflight_never_requires_make_and_only_reads_docker(self):
        with patch('reliability.shutil.which', side_effect=lambda name: '/bin/' + name if name != 'make' else None), patch('reliability.shutil.disk_usage', return_value=shutil._ntuple_diskusage(10*1024**3, 0, 10*1024**3)):
            preflight(self.docker_run)

    def test_missing_docker_old_compose_and_unavailable_daemon(self):
        with patch('reliability.shutil.which', return_value=None), self.assertRaisesRegex(RuntimeError, 'Не найдены команды'):
            preflight(self.docker_run)
        with patch('reliability.shutil.which', return_value='/bin/command'):
            with self.assertRaisesRegex(RuntimeError, 'Устаревший Docker Compose'):
                preflight(Mock(side_effect=['v2', '--wait --pull']))
            with self.assertRaisesRegex(RuntimeError, 'Docker daemon недоступен'):
                preflight(Mock(side_effect=['v2', '--wait --wait-timeout --pull', CommandFailure('offline')]))
            with self.assertRaisesRegex(RuntimeError, 'минимум 5 ГБ'), patch('reliability.shutil.disk_usage', return_value=shutil._ntuple_diskusage(100, 99, 1)):
                preflight(self.docker_run)

    def test_rootless_and_remote_docker_rejected(self):
        for info, message in [({'OSType': 'linux', 'SecurityOptions': ['name=rootless']}, 'rootless'), ({'OSType': 'linux', 'DockerRootDir': '/nonexistent-test-docker-root'}, 'том же хосте')]:
            with patch('reliability.shutil.which', return_value='/bin/command'), self.assertRaisesRegex(RuntimeError, message):
                preflight(Mock(side_effect=['v2', '--wait --wait-timeout --pull', json.dumps(info)]))


class DependenciesTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.bin = Path(self.temp.name)
        self.script = Path(__file__).with_name('dependencies.sh')
        for name in ('git', 'python3', 'curl', 'make', 'sleep'):
            self.stub(name, 'exit 0')
        self.stub('id', 'echo 0')
        self.stub('env', 'shift; exec "$@"')

    def stub(self, name, body):
        path = self.bin / name
        path.write_text('#!/bin/bash\n' + body + '\n')
        path.chmod(0o755)

    def execute(self):
        return subprocess.run(['/bin/bash', str(self.script)], env={'PATH': str(self.bin)}, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=10)

    def test_present_dependencies_do_not_touch_package_manager(self):
        self.stub('apt-get', 'echo CALLED; exit 90')
        result = self.execute()
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertNotIn('CALLED', result.stdout)

    def test_missing_make_installed_and_rechecked(self):
        (self.bin / 'make').unlink()
        self.stub('apt-get', '''printf '%s\\n' "$*" >> "$PATH/packages.log"
case " $* " in *" install "*) printf '#!/bin/bash\\nexit 0\\n' > "$PATH/make"; /bin/chmod +x "$PATH/make";; esac''')
        result = self.execute()
        self.assertEqual(result.returncode, 0, result.stdout)
        calls = (self.bin / 'packages.log').read_text()
        self.assertIn('install -y --no-install-recommends make', calls)
        self.assertNotIn(' upgrade', calls)
        self.assertNotIn('docker', calls)

    def test_failed_package_install_is_fatal_and_bounded(self):
        (self.bin / 'make').unlink()
        self.stub('apt-get', 'echo call >> "$PATH/packages.log"; exit 1')
        result = self.execute()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(len((self.bin / 'packages.log').read_text().splitlines()), 3)
        self.assertIn('Панель не остановлена', result.stdout)

    def test_false_success_does_not_skip_dependency_verification(self):
        (self.bin / 'make').unlink()
        self.stub('apt-get', 'exit 0')
        result = self.execute()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('После установки не найден make', result.stdout)

    def test_non_root_and_unsupported_manager_give_actionable_errors(self):
        (self.bin / 'make').unlink()
        self.stub('id', 'echo 1000')
        result = self.execute()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('sudo bash scripts/updater/dependencies.sh', result.stdout)
        self.stub('id', 'echo 0')
        result = self.execute()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Установите вручную: make', result.stdout)

    def test_old_python_is_rejected(self):
        self.stub('python3', 'case "$*" in *sys.version_info*) echo "Нужен Python 3.9+"; exit 1;; esac')
        result = self.execute()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Python 3.9+', result.stdout)
