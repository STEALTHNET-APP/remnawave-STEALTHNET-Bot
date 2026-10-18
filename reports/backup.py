import datetime
import os
from pathlib import Path
import sqlite3
import tarfile
import tempfile
import time

root = Path(os.environ.get('DATA_DIR', '/data'))
backups = root / 'backups'
backups.mkdir(mode=0o700, exist_ok=True)
name = 'reports-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '.tar.gz'
with tempfile.TemporaryDirectory(dir=root) as temporary:
    snapshot = Path(temporary) / 'reports.sqlite'
    with sqlite3.connect(root / 'reports.sqlite') as source, sqlite3.connect(snapshot) as target:
        source.backup(target)
        attachments = [row[0] for row in target.execute('SELECT id FROM attachments')]
    pending = backups / (name + '.tmp')
    with tarfile.open(pending, 'w:gz') as archive:
        archive.add(snapshot, arcname='reports.sqlite')
        for attachment in attachments:
            archive.add(root / 'uploads' / attachment, arcname='uploads/' + attachment)
    pending.chmod(0o600)
    pending.rename(backups / name)
for old in backups.glob('reports-*.tar.gz'):
    if old.stat().st_mtime < time.time() - 3 * 86400:
        old.unlink()
print(name)
