import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]

class RenewalModes(unittest.TestCase):
    def test_mixed_certificates_keep_their_authenticator(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'bin').mkdir()
            (root / 'renewal').mkdir()
            for name, mode in [('old', 'standalone'), ('wildcard', 'dns-cloudflare'), ('web', 'webroot')]:
                (root / 'renewal' / (name + '.conf')).write_text('[renewalparams]\nauthenticator = ' + mode + '\n')
            certbot = root / 'bin/certbot'
            certbot.write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALLS"\ncase "$*" in *old*) exit 1;; esac\n')
            certbot.chmod(0o755)
            env = dict(os.environ, PATH=str(root / 'bin') + ':' + os.environ['PATH'], CERTBOT_RENEWAL_DIR=str(root / 'renewal'), CALLS=str(root / 'calls'))
            result = subprocess.run(['sh', str(ROOT / 'nginx/renew-certificates.sh'), '--dry-run'], env=env)
            self.assertEqual(result.returncode, 1)
            calls = (root / 'calls').read_text().splitlines()
            self.assertEqual(len(calls), 3)
            self.assertIn('--webroot --webroot-path /var/www/certbot', next(x for x in calls if '--cert-name old ' in x))
            for name in ['wildcard', 'web']:
                self.assertNotIn('--webroot', next(x for x in calls if '--cert-name ' + name + ' ' in x))
            self.assertTrue(all(x.endswith('--dry-run') for x in calls))

if __name__ == '__main__':
    unittest.main()
