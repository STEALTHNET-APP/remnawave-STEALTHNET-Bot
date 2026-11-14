import hashlib
import os
import shutil
import subprocess


class LocalChanges:
    def local_changes(self):
        raw = subprocess.check_output(['git', 'status', '--porcelain=v1', '-z', '--untracked-files=all'], cwd=self.root)
        records = raw.split(b'\0')
        paths = []
        digest = hashlib.sha256(self.git('rev-parse', 'HEAD').encode())
        conflicts = False
        while records and records[0]:
            record = records.pop(0)
            code, path = record[:2], os.fsdecode(record[3:])
            if code == b'??' and path == 'docker-compose.override.yml':
                continue
            if code == b' M' and path == 'nginx/nginx.conf' and (self.root / path).is_file() and not (self.root / path).is_symlink():
                continue
            digest.update(record + b'\0')
            if b'R' in code or b'C' in code:
                digest.update(records.pop(0) + b'\0')
            conflicts |= b'U' in code or code in (b'AA', b'DD') or path in ('.env', 'docker-compose.override.yml')
            paths.append(path)
            file = self.root / path
            if path == 'nginx/nginx.conf' and (file.is_symlink() or not file.is_file()):
                conflicts = True
            if file.is_symlink():
                digest.update(os.fsencode(os.readlink(file)))
            elif file.is_file():
                digest.update(str((file.stat().st_size, file.stat().st_mode)).encode() + b'\0')
                with file.open('rb') as stream:
                    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                        digest.update(chunk)
            elif file.exists():
                conflicts = True
        if not paths:
            return None
        for args in [('diff', '--binary', 'HEAD'), ('diff', '--binary', '--cached')]:
            digest.update(subprocess.check_output(['git', *args], cwd=self.root))
        return {'id': digest.hexdigest(), 'files': paths[:50], 'count': len(paths), 'canPreserve': not conflicts}

    def save_local_changes(self, backup, expected):
        self.clean(expected)
        runtime = self.root / 'nginx/nginx.conf'
        if runtime.is_symlink():
            raise RuntimeError('nginx/nginx.conf должен быть обычным файлом. Проверьте конфигурацию на сервере.')
        if runtime.is_file():
            shutil.copy2(runtime, backup / 'nginx-runtime.conf')
        runtime_dirty = bool(self.git('status', '--porcelain', '--', 'nginx/nginx.conf'))
        if not self.local_changes() and not runtime_dirty:
            return None
        self.status['localChangesRecoveryRequired'] = True
        self.persist()
        self.git('stash', 'push', '--include-untracked', '-m', 'STEALTHNET ' + backup.name,
                 '--', '.', ':(exclude)docker-compose.override.yml')
        stash = self.git('rev-parse', 'refs/stash')
        try:
            self.write_json(backup / 'local-changes.json', {'stash': stash, 'previous': self.git('rev-parse', 'HEAD')})
            self.clean()
            self.git('bundle', 'create', str(backup / 'local-changes.bundle'), 'refs/stash')
            self.git('bundle', 'verify', str(backup / 'local-changes.bundle'))
        except Exception:
            self.restore_local_changes(stash)
            self.status['localChangesRecoveryRequired'] = False
            self.persist()
            raise
        self.status['localChangesRecoveryRequired'] = False
        self.persist()
        return stash

    def restore_local_changes(self, stash):
        self.git('stash', 'apply', '--index', stash)

    def restore_runtime_config(self, backup):
        saved = backup / 'nginx-runtime.conf'
        if saved.is_file():
            target = self.root / 'nginx/nginx.conf'
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.is_symlink():
                raise RuntimeError('Обновление заменяет конфигурацию Nginx ссылкой. Требуется проверка на сервере.')
            shutil.copy2(saved, target)
