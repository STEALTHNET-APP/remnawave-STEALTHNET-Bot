import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest

class BackupTests(unittest.TestCase):
    def test_snapshot_restore_and_retention(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'uploads').mkdir();(root/'uploads'/'image').write_bytes(b'picture')
            with sqlite3.connect(root/'reports.sqlite') as conn:
                conn.execute('CREATE TABLE attachments(id TEXT)');conn.execute("INSERT INTO attachments VALUES ('image')")
            backups=root/'backups';backups.mkdir()
            old=backups/'reports-old.tar.gz';old.write_bytes(b'old');os.utime(old,(time.time()-4*86400,)*2)
            unrelated=backups/'keep.txt';unrelated.write_text('keep')
            subprocess.run([sys.executable,str(Path(__file__).resolve().parents[1]/'backup.py')],env=dict(os.environ,DATA_DIR=tmp),check=True,capture_output=True)
            self.assertFalse(old.exists());self.assertTrue(unrelated.exists())
            archives=list(backups.glob('reports-*.tar.gz'));self.assertEqual(len(archives),1)
            with tarfile.open(archives[0]) as archive:
                restored=root/'restored';archive.extractall(restored,filter='data')
            with sqlite3.connect(restored/'reports.sqlite') as conn:
                self.assertEqual(conn.execute('SELECT id FROM attachments').fetchone()[0],'image')
            self.assertEqual((restored/'uploads'/'image').read_bytes(),b'picture')

if __name__=='__main__':unittest.main()
