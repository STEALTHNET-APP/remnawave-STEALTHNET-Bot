import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('patcher', Path(__file__).resolve().parents[2] / 'scripts/patch-amnezia-web-panel.py')
patcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(patcher)
helpers = '\n'.join(f'def {name}(*args): return None' for name in ('_resolve_api_token', '_touch_api_token', 'load_data', 'save_data')) + '\n'

class PatchTests(unittest.TestCase):
    def test_backup_check_idempotence(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'app.py'
            original = helpers + patcher.ORIGINAL
            path.write_text(original)
            path.chmod(0o640)
            patcher.patch(path)
            self.assertEqual(path.read_text(), original)
            self.assertEqual(len(list(Path(tmp).glob('*.bak'))), 0)
            patcher.patch(path, True)
            self.assertEqual(path.read_text(), helpers + patcher.PATCHED)
            self.assertEqual(path.stat().st_mode & 0o777, 0o640)
            backups = list(Path(tmp).glob('*.bak'))
            self.assertEqual(len(backups), 1)
            self.assertEqual(backups[0].read_text(), original)
            patcher.patch(path, True)
            self.assertEqual(len(list(Path(tmp).glob('*.bak'))), 1)
    def test_unknown_version_not_changed(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'app.py'
            original = helpers + 'def get_current_user(request): return None\n'
            path.write_text(original)
            with self.assertRaises(ValueError): patcher.patch(path, True)
            self.assertEqual(path.read_text(), original)
    def test_missing_token_validation_not_changed(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'app.py'
            path.write_text(patcher.ORIGINAL)
            with self.assertRaises(ValueError): patcher.patch(path, True)
            self.assertEqual(path.read_text(), patcher.ORIGINAL)

if __name__ == '__main__': unittest.main()
