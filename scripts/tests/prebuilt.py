import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
REVISION = 'a' * 40


class PrebuiltTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'scripts').mkdir()
        (self.root / 'bin').mkdir()
        for name in ('run-prebuilt.sh', 'backup-db.sh'):
            shutil.copy(ROOT / 'scripts' / name, self.root / 'scripts' / name)
        (self.root / '.env').write_text('USE_BUILTIN_NGINX=true\nSECRET=fixture-only\n')
        (self.root / 'docker-compose.override.yml').write_text('services: {}\n')
        self.env = {**os.environ, 'PATH': str(self.root / 'bin') + ':' + os.environ['PATH'], 'FIXTURE_ROOT': str(self.root)}
        for name, body in {
            'git': '#!/bin/sh\nprintf "' + REVISION + '\\n"\n',
            'flock': '#!/bin/sh\nexit 0\n',
            'sleep': '#!/bin/sh\nexit 0\n',
            'docker': '''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
args = sys.argv[1:]
root = Path(os.environ['FIXTURE_ROOT'])
with (root / 'calls').open('a') as f: f.write(json.dumps({'args': args, 'compose': os.getenv('COMPOSE_FILE'), 'tag': os.getenv('STEALTHNET_IMAGE_TAG')}) + '\\n')
if '--help' in args: print('--wait --wait-timeout'); sys.exit(0)
if 'pull' in args and os.getenv('FAIL_PULL'): sys.exit(1)
if args[:2] == ['image', 'inspect']: print('wrong' if os.getenv('BAD_REVISION') else 'a' * 40)
if 'ps' in args and '-q' in args: print('fixture-postgres')
if 'exec' in args: print('-- PostgreSQL database dump')
if 'up' in args and args[-1] == 'api' and os.getenv('FAIL_START'): sys.exit(1)
''',
        }.items():
            p = self.root / 'bin' / name
            p.write_text(body)
            p.chmod(0o755)

    def run_script(self, **env):
        result = subprocess.run(['bash', 'scripts/run-prebuilt.sh'], cwd=self.root, env={**self.env, **env}, capture_output=True, text=True)
        self.calls = [json.loads(line) for line in (self.root / 'calls').read_text().splitlines()]
        return result

    def test_missing_image_leaves_running_stack_and_settings_alone(self):
        before = (self.root / '.env').read_bytes()
        result = self.run_script(FAIL_PULL='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.root / '.env').read_bytes(), before)
        self.assertEqual(sum('pull' in c['args'] for c in self.calls), 3)
        self.assertFalse(any('up' in c['args'] and '--help' not in c['args'] for c in self.calls))

    def test_mixed_image_revisions_never_start(self):
        result = self.run_script(BAD_REVISION='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any('up' in c['args'] and '--help' not in c['args'] for c in self.calls))

    def test_override_and_commit_are_preserved_and_backup_precedes_start(self):
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        env = (self.root / '.env').read_text()
        self.assertIn('COMPOSE_FILE=docker-compose.yml:docker-compose.override.yml:compose.ghcr.yaml', env)
        self.assertIn('STEALTHNET_IMAGE_TAG=sha-' + REVISION, env)
        self.assertIn('SECRET=fixture-only', env)
        self.assertNotIn('fixture-only', result.stdout + result.stderr)
        backup = next((self.root / 'backups').glob('prebuilt-*'))
        self.assertIn('SECRET=fixture-only', (backup / 'env').read_text())
        self.assertTrue(list((self.root / 'backups').glob('*.sql')))
        dump = next(i for i, c in enumerate(self.calls) if 'exec' in c['args'])
        start = next(i for i, c in enumerate(self.calls) if 'up' in c['args'] and '--help' not in c['args'])
        self.assertLess(dump, start)
        self.assertTrue(all('--no-build' in c['args'] for c in self.calls if 'up' in c['args'] and '--help' not in c['args']))

    def test_start_failure_keeps_backup_and_reports_recovery_path(self):
        result = self.run_script(FAIL_START='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('database was not rolled back', result.stderr)
        self.assertTrue(list((self.root / 'backups').glob('*.sql')))


if __name__ == '__main__':
    unittest.main()
