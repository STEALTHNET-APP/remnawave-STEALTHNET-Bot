import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]

class ManualUpdate(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)
        shutil.copy(ROOT / 'Makefile', self.path)
        shutil.copytree(ROOT / 'scripts', self.path / 'scripts')
        (self.path / '.env').write_text('USE_BUILTIN_NGINX=true\n')
        (self.path / 'version.json').write_text('{"version":"test"}')
        self.bin = self.path / 'bin'
        self.bin.mkdir()
        for name, body in {
            'git': 'printf "%s\\n" "git $*" >> "$CALL_LOG"\ncase "$1" in rev-parse) echo revision;; pull) exit "${PULL_FAIL:-0}";; esac\n',
            'docker': 'printf "%s\\n" "docker $*" >> "$CALL_LOG"\ncase " $* " in *" pg_dump "*) echo dump; exit "${DUMP_FAIL:-0}";; *" build "*) exit "${BUILD_FAIL:-0}";; esac\n',
        }.items():
            f = self.bin / name
            f.write_text('#!/bin/sh\n' + body)
            f.chmod(0o755)
        self.env = dict(os.environ, PATH=str(self.bin)+':'+os.environ['PATH'], CALL_LOG=str(self.path / 'calls'))

    def run_make(self, **env):
        return subprocess.run(['make', 'upgrade'], cwd=self.path, env=dict(self.env, **env), text=True, capture_output=True)

    def test_order_and_worker(self):
        result = self.run_make()
        self.assertEqual(result.returncode, 0, result.stderr)
        log = (self.path / 'calls').read_text()
        self.assertLess(log.index('exec -T postgres'), log.index('git pull --ff-only'))
        self.assertLess(log.index(' build'), log.index(' up -d --no-build'))
        self.assertIn('--no-deps --no-build --force-recreate broadcast-worker', log)
        files = list((self.path / 'backups').glob('*.sql'))
        self.assertEqual(len(files), 1)
        self.assertEqual(files[0].stat().st_mode & 0o777, 0o600)

    def test_failed_dump_prevents_pull_and_cleans_partial(self):
        result = self.run_make(DUMP_FAIL='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('git pull', (self.path / 'calls').read_text())
        self.assertEqual(list((self.path / 'backups').iterdir()), [])

    def test_failed_build_never_recreates(self):
        result = self.run_make(BUILD_FAIL='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('up -d', (self.path / 'calls').read_text())
        self.assertNotIn('Upgrade complete!', result.stdout)

    def test_failed_pull_prevents_build(self):
        self.assertNotEqual(self.run_make(PULL_FAIL='1').returncode, 0)
        self.assertNotIn('docker compose --profile builtin-nginx build', (self.path / 'calls').read_text())

if __name__ == '__main__':
    unittest.main()
