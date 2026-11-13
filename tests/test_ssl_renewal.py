import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
WATCHER = ROOT / 'nginx/40-watch-certificates.sh'


class CertificateWatcherTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='ssl-renewal-')
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.live = self.base / 'ssl/live/example.test'
        self.live.mkdir(parents=True)
        self.bin = self.base / 'bin'
        self.bin.mkdir()
        self.events = self.base / 'events'
        self.events.touch()
        nginx = self.bin / 'nginx'
        nginx.write_text('''#!/bin/sh
printf '%s\\n' "$*" >> "$TEST_ROOT/events"
case "$*" in
  '-t') [ ! -f "$TEST_ROOT/fail-test" ] ;;
  '-s reload')
    [ ! -f "$TEST_ROOT/fail-reload" ] || exit 1
    echo reloaded >> "$TEST_ROOT/events" ;;
  *) exit 2 ;;
esac
''')
        nginx.chmod(0o755)

    def write_cert(self, text='certificate-v1'):
        (self.live / 'fullchain.pem').write_text(text)
        (self.live / 'privkey.pem').write_text('test-private-key')

    def start(self):
        env = dict(os.environ, PATH=str(self.bin) + os.pathsep + os.environ['PATH'],
                   TEST_ROOT=str(self.base), SSL_CERTIFICATE_DIR=str(self.base / 'ssl'),
                   SSL_CERTIFICATE_POLL_SECONDS='0.05')
        log = open(self.base / 'watcher.log', 'w')
        self.addCleanup(log.close)
        process = subprocess.Popen(['/bin/sh', str(WATCHER)], env=env,
                                   stdout=log, stderr=log, start_new_session=True)
        def stop():
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            process.wait(timeout=3)
        self.addCleanup(stop)
        self.assertEqual(process.wait(timeout=3), 0)

    def lines(self):
        return self.events.read_text().splitlines()

    def wait_for(self, predicate):
        deadline = time.monotonic() + 4
        while time.monotonic() < deadline:
            if predicate():
                return
            time.sleep(0.03)
        self.fail('watcher did not reach expected state: ' + str(self.lines()))

    def test_unchanged_certificate_does_not_reload(self):
        self.write_cert()
        self.start()
        time.sleep(0.25)
        self.assertEqual(self.lines(), [])

    def test_renewal_checks_config_then_reloads_once(self):
        self.write_cert()
        self.start()
        (self.live / 'fullchain.pem').write_text('certificate-v2')
        self.wait_for(lambda: 'reloaded' in self.lines())
        time.sleep(0.2)
        self.assertEqual(self.lines(), ['-t', '-s reload', 'reloaded'])

    def test_rotated_certbot_symlink_is_detected(self):
        archive = self.base / 'ssl/archive/example.test'
        archive.mkdir(parents=True)
        (archive / 'fullchain1.pem').write_text('old-certificate')
        (archive / 'fullchain2.pem').write_text('new-certificate')
        (self.live / 'fullchain.pem').symlink_to('../../archive/example.test/fullchain1.pem')
        self.start()
        replacement = self.live / 'replacement'
        replacement.symlink_to('../../archive/example.test/fullchain2.pem')
        replacement.replace(self.live / 'fullchain.pem')
        self.wait_for(lambda: 'reloaded' in self.lines())

    def test_key_only_change_is_detected(self):
        self.write_cert()
        self.start()
        (self.live / 'privkey.pem').write_text('rotated-test-key')
        self.wait_for(lambda: 'reloaded' in self.lines())

    def test_http_only_installation_without_certificates(self):
        self.start()
        time.sleep(0.15)
        self.assertEqual(self.lines(), [])
        self.write_cert()
        self.wait_for(lambda: 'reloaded' in self.lines())

    def test_invalid_config_keeps_retrying_without_reload(self):
        self.write_cert()
        (self.base / 'fail-test').touch()
        self.start()
        (self.live / 'fullchain.pem').write_text('renewed-certificate')
        self.wait_for(lambda: self.lines().count('-t') >= 2)
        self.assertNotIn('-s reload', self.lines())
        (self.base / 'fail-test').unlink()
        self.wait_for(lambda: 'reloaded' in self.lines())
        self.assertEqual(self.lines().count('reloaded'), 1)

    def test_failed_reload_retries_same_certificate(self):
        self.write_cert()
        (self.base / 'fail-reload').touch()
        self.start()
        (self.live / 'fullchain.pem').write_text('renewed-certificate')
        self.wait_for(lambda: self.lines().count('-s reload') >= 2)
        self.assertNotIn('reloaded', self.lines())
        (self.base / 'fail-reload').unlink()
        self.wait_for(lambda: 'reloaded' in self.lines())
        time.sleep(0.15)
        self.assertEqual(self.lines().count('reloaded'), 1)

    def test_watcher_is_executable_for_official_entrypoint(self):
        self.assertTrue(os.access(WATCHER, os.X_OK))
        subprocess.run(['/bin/sh', '-n', str(WATCHER)], check=True)


if __name__ == '__main__':
    unittest.main()
