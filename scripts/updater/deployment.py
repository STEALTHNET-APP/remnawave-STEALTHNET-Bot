import datetime as dt
import json
from pathlib import Path
import secrets
import shutil
import subprocess
import tarfile
import time
from urllib.parse import urlsplit, urlunsplit, quote


class Deployment:
    def compose_config(self, source=None):
        return json.loads(self.compose('config', '--format', 'json', source=source))

    def validate_layout(self, before, after):
        allowed = {'api', 'bot', 'broadcast-worker', 'frontend', 'console', 'nginx'}
        if set(before['services']) != set(after['services']):
            raise RuntimeError('Меняется состав служб. Сначала требуется подготовка сервера по инструкции релиза.')
        for key in ('name', 'volumes', 'networks', 'secrets', 'configs'):
            if before.get(key) != after.get(key):
                raise RuntimeError('Меняются хранилища или сеть Docker. Нужна отдельная подготовка сервера.')
        for name, service in before['services'].items():
            candidate = after['services'][name]
            if name not in allowed and service != candidate:
                raise RuntimeError(f'Обновление меняет службу {name}. Смена PostgreSQL и внешней инфраструктуры выполняется отдельно.')
            for key in ('volumes', 'networks', 'network_mode', 'container_name'):
                if service.get(key) != candidate.get(key):
                    raise RuntimeError(f'Меняются подключения или хранилища службы {name}. Нужна подготовка сервера.')

    def health(self, override, services):
        self.compose('up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '600', *services, override=override, capture=False, timeout=660)
        time.sleep(5)
        for name in services:
            container = self.compose('ps', '-q', name)
            state = json.loads(self.run(['docker', 'inspect', '--format', '{{json .State}}', container]))
            restarts = int(self.run(['docker', 'inspect', '--format', '{{.RestartCount}}', container]))
            if not state.get('Running') or state.get('Health', {}).get('Status', 'healthy') != 'healthy' or restarts:
                raise RuntimeError(f'Служба {name} не прошла проверку запуска')

    def dump_database(self, path):
        with path.open('wb') as stream:
            self.compose('exec', '-T', 'postgres', 'sh', '-ec', 'pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB"', output=stream, timeout=1800)
        with path.open('rb') as stream:
            if stream.read(5) != b'PGDMP':
                raise RuntimeError('Резервная копия базы данных не создана')
        with path.open('rb') as stream:
            self.compose('exec', '-T', 'postgres', 'pg_restore', '--list', input=stream, timeout=1800)

    def restore_database(self, path):
        self.compose('exec', '-T', 'postgres', 'sh', '-ec', 'dropdb --force --if-exists -U "$POSTGRES_USER" "$POSTGRES_DB"; createdb -U "$POSTGRES_USER" "$POSTGRES_DB"', capture=False, timeout=120)
        with path.open('rb') as stream:
            self.compose('exec', '-T', 'postgres', 'sh', '-ec', 'pg_restore --exit-on-error --single-transaction -U "$POSTGRES_USER" -d "$POSTGRES_DB"', input=stream, capture=False, timeout=1800)

    def backup_files(self, backup, images):
        mounts = []
        for service in ('api', 'console', 'broadcast-worker'):
            if service not in images:
                continue
            container = self.compose('ps', '-a', '-q', service)
            for mount in json.loads(self.run(['docker', 'inspect', '--format', '{{json .Mounts}}', container])):
                if mount['Destination'] not in ('/app/uploads', '/data', '/data/broadcast-attachments'):
                    continue
                if not mount.get('RW') or mount['Source'] in [item['source'] for item in mounts]:
                    continue
                path = Path(mount['Source'])
                name = f'files-{len(mounts)}.tar.gz'
                with tarfile.open(backup / name, 'w:gz') as bundle:
                    bundle.add(path, arcname='.')
                mounts.append({'source': str(path), 'archive': name})
        self.write_json(backup / 'files.json', mounts)

    def restore_files(self, backup):
        for mount in json.loads((backup / 'files.json').read_text()):
            path = Path(mount['source'])
            for child in path.iterdir():
                if child.is_dir() and not child.is_symlink():
                    shutil.rmtree(child)
                else:
                    child.unlink()
            with tarfile.open(backup / mount['archive']) as bundle:
                bundle.extractall(path, filter='data') if hasattr(tarfile, 'data_filter') else bundle.extractall(path)

    def wait_probe(self, container, timeout=600):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            state = json.loads(self.run(['docker', 'inspect', '--format', '{{json .State}}', container]))
            if not state.get('Running'):
                self.run(['docker', 'logs', '--tail', '80', container], capture=False)
                raise RuntimeError('Проверка новой версии завершилась ошибкой. Рабочая база не изменялась, если установка ещё не началась.')
            try:
                self.run(['docker', 'exec', container, 'node', '-e', 'fetch("http://127.0.0.1:"+(process.env.PORT||5000)+"/api/health").then(async r=>{if(!r.ok||!(await r.json()).maintenance)process.exit(1);const blocked=await fetch("http://127.0.0.1:"+(process.env.PORT||5000)+"/api/client/auth/register",{method:"POST"});if(blocked.status!==503)process.exit(1)}).catch(()=>process.exit(1))'], timeout=10)
                return
            except RuntimeError:
                time.sleep(2)
        raise RuntimeError('Новая версия не прошла проверку за 10 минут')

    def rehearse(self, build, image, config):
        self.phase('rehearsal', 'Проверяем миграции и API на отдельной копии базы')
        dump = build / 'rehearsal.dump'
        self.dump_database(dump)
        name = 'stealthnet-probe-' + secrets.token_hex(6)
        database = name + '-db'
        password = secrets.token_hex(24)
        postgres = self.compose('ps', '-q', 'postgres')
        pg_image = self.run(['docker', 'inspect', '--format', '{{.Image}}', postgres])
        network_created = False
        try:
            self.run(['docker', 'network', 'create', '--internal', name])
            network_created = True
            self.run(['docker', 'run', '-d', '--name', database, '--network', name,
                      '-e', 'POSTGRES_USER=updater', '-e', 'POSTGRES_PASSWORD=' + password, '-e', 'POSTGRES_DB=updater', pg_image])
            for _ in range(60):
                try:
                    self.run(['docker', 'exec', database, 'pg_isready', '-U', 'updater'])
                    break
                except RuntimeError:
                    time.sleep(1)
            else:
                raise RuntimeError('Не удалось запустить проверочную базу')
            with dump.open('rb') as stream:
                self.run(['docker', 'exec', '-i', database, 'pg_restore', '--exit-on-error', '--no-owner', '--no-privileges', '-U', 'updater', '-d', 'updater'], input=stream, capture=False, timeout=1800)
            env = dict(config['services']['api'].get('environment', {}))
            url = urlsplit(env['DATABASE_URL'])
            env.update(DATABASE_URL=urlunsplit((url.scheme, 'updater:' + quote(password) + '@' + database + ':5432', '/updater', url.query, '')), UPDATER_VERIFY_ONLY='1')
            envfile = build / 'probe.env'
            if any('\n' in str(value) or '\r' in str(value) for value in env.values()):
                raise RuntimeError('Многострочные переменные окружения требуют отдельной настройки проверки')
            envfile.write_text(''.join(f'{key}={value}\n' for key, value in env.items() if value is not None))
            envfile.chmod(0o600)
            self.run(['docker', 'run', '-d', '--name', name, '--network', name, '--env-file', str(envfile), image])
            self.wait_probe(name)
        finally:
            for container in (name, database):
                subprocess.run(['docker', 'rm', '-fv', container], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if network_created:
                subprocess.run(['docker', 'network', 'rm', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            dump.unlink(missing_ok=True)
            (build / 'probe.env').unlink(missing_ok=True)

    def backup_list(self):
        result = []
        for path in sorted(self.state_dir.glob('backup-*'), reverse=True):
            if path.is_symlink() or not (path / 'manifest.json').is_file():
                continue
            try:
                value = json.loads((path / 'manifest.json').read_text())
            except FileNotFoundError:
                continue
            created = dt.datetime.fromisoformat(value['createdAt'])
            protected = value.get('outcome') not in ('success', 'rolledBack')
            result.append({'name': path.name, 'createdAt': value['createdAt'], 'expiresAt': (created + dt.timedelta(days=self.settings['backupRetentionDays'])).isoformat(), 'protected': protected, 'complete': value.get('complete', False)})
        return result

    def cleanup_images(self):
        protected = set()
        for path in self.state_dir.glob('backup-*/images.json'):
            for service in json.loads(path.read_text()).get('services', {}).values():
                protected.add(service['image'])
        containers = self.run(['docker', 'ps', '-aq']).splitlines()
        if containers:
            protected.update(self.run(['docker', 'inspect', '--format', '{{.Image}}', *containers]).splitlines())
        entries = self.run(['docker', 'image', 'ls', '--no-trunc', '--filter', 'reference=stealthnet-update-*', '--format', '{{json .}}']).splitlines()
        for line in entries:
            image = json.loads(line)
            if image['ID'] not in protected and image['Tag'] != '<none>':
                self.run(['docker', 'image', 'rm', image['Repository'] + ':' + image['Tag']], capture=False)

    def cleanup_backups(self, instant):
        for backup in self.backup_list():
            if backup['protected'] or dt.datetime.fromisoformat(backup['expiresAt']) > instant:
                continue
            path = self.state_dir / backup['name']
            manifest = json.loads((path / 'manifest.json').read_text())
            for tag in manifest.get('imageTags', []):
                if tag.startswith('stealthnet-backup-'):
                    subprocess.run(['docker', 'image', 'rm', tag], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            shutil.rmtree(path)

    def check_space(self):
        database_size = int(self.compose('exec', '-T', 'postgres', 'sh', '-ec', 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT pg_database_size(current_database())"'))
        required = max(5 * 1024 ** 3, database_size * 3 + 2 * 1024 ** 3)
        if shutil.disk_usage(self.state_dir).free < required:
            raise RuntimeError(f'Недостаточно места для сборки и двух копий базы: нужно минимум {required // (1024 ** 3) + 1} ГБ свободного места')

    def deploy(self):
        self.clean()
        self.check()
        if not self.status['available']:
            return
        target, previous = self.status['target'], self.status['current']
        self.check_space()
        images = self.service_images()
        api_revision = self.run(['docker', 'image', 'inspect', '--format', '{{index .Config.Labels "org.opencontainers.image.revision"}}', images['api']])
        if api_revision != previous:
            raise RuntimeError('Запущенный API не соответствует текущему коммиту Git. Сначала пересоберите установленную версию по инструкции.')
        build = self.state_dir / ('build-' + target[:12])
        if build.exists():
            shutil.rmtree(build)
        build.mkdir(mode=0o700)
        try:
            self.deploy_from_archive(build, images, previous, target)
        finally:
            shutil.rmtree(build, ignore_errors=True)

    def deploy_from_archive(self, build, images, previous, target):
        archive = build / 'source.tar'
        with archive.open('wb') as stream:
            self.run(['git', 'archive', target], output=stream)
        with tarfile.open(archive) as source:
            for entry in source:
                if entry.issym() or entry.islnk() or not (entry.isfile() or entry.isdir()) or not (build / entry.name).resolve().is_relative_to(build):
                    raise RuntimeError('Архив исходников содержит неподдерживаемые пути или ссылки')
                source.extract(entry, build)
        archive.unlink()
        if 'UPDATER_VERIFY_ONLY' not in (build / 'backend/docker-entrypoint.sh').read_text():
            raise RuntimeError('Эта версия ещё не поддерживает проверку миграций. Сначала обновите установку вручную до 6.7.1.')
        before, after = self.compose_config(), self.compose_config(build)
        self.validate_layout(before, after)
        built = {}
        self.phase('building', 'Собираем новую версию. Текущая продолжает работать.')
        specifications = [('api', 'backend/Dockerfile', build), ('bot', 'bot/Dockerfile', build / 'bot'), ('frontend', 'frontend/Dockerfile', build)]
        if 'console' in images:
            specifications.append(('console', 'console/Dockerfile', build / 'console'))
        for service, dockerfile, context in specifications:
            tag = 'stealthnet-update-' + service + ':' + target
            self.run(['docker', 'build', '--label', 'org.opencontainers.image.revision=' + target,
                      '--build-arg', 'BUILD_COMMIT=' + target, '--build-arg', 'BUILD_DATE=' + dt.datetime.now(dt.timezone.utc).isoformat(),
                      '-t', tag, '-f', str(build / dockerfile), str(context)], timeout=3600, capture=False)
            built[service] = tag
        built['broadcast-worker'] = built['api']
        if 'nginx' in images:
            tag = after['services']['nginx']['image']
            self.run(['docker', 'pull', tag], capture=False, timeout=600)
            built['nginx'] = self.run(['docker', 'image', 'inspect', '--format', '{{.Id}}', tag])
        self.check_space()
        self.rehearse(build, built['api'], after)
        self.clean()
        if self.git('rev-parse', 'HEAD') != previous:
            raise RuntimeError('Исходники изменились во время сборки. Повторите проверку.')
        backup = self.state_dir / ('backup-' + dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S%f'))
        backup.mkdir(mode=0o700)
        manifest = {'createdAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'previous': previous, 'target': target, 'complete': False, 'outcome': 'pending', 'imageTags': []}
        self.write_json(backup / 'manifest.json', manifest)
        for name, image in images.items():
            tag = 'stealthnet-backup-' + name + ':' + backup.name
            self.run(['docker', 'tag', image, tag])
            manifest['imageTags'].append(tag)
        self.write_json(backup / 'manifest.json', manifest)
        rollback = self.override(backup / 'images.json', images)
        deployment = self.override(build / 'images.json', built)
        verification = json.loads(deployment.read_text())
        verification['services']['api']['environment'] = {'UPDATER_VERIFY_ONLY': '1'}
        self.write_json(build / 'verify.json', verification)
        self.phase('backup', 'Сохраняем базу данных, настройки и файлы', backup=str(backup), writesResumed=False)
        with (backup / 'source.tar').open('wb') as stream:
            self.run(['git', 'archive', previous], output=stream)
        with tarfile.open(backup / 'settings.tar.gz', 'w:gz') as bundle:
            for name in ('.env', 'docker-compose.yml', 'docker-compose.override.yml', 'nginx', 'version.json'):
                if (self.root / name).exists():
                    bundle.add(self.root / name, arcname=name)
        stopped = False
        switched = False
        writes_resumed = False
        writers = [name for name in ('api', 'bot', 'broadcast-worker', 'console') if name in images]
        try:
            stopped = True
            self.compose('stop', *writers, capture=False)
            self.dump_database(backup / 'database.dump')
            self.backup_files(backup, images)
            manifest['complete'] = True
            self.write_json(backup / 'manifest.json', manifest)
            self.phase('installing', 'Устанавливаем обновление и миграции. Приём запросов временно приостановлен.')
            self.git('merge', '--ff-only', target)
            switched = True
            self.frontend(deployment)
            self.health(build / 'verify.json', ['api'])
            self.wait_probe(self.compose('ps', '-q', 'api'))
            if 'nginx' in images:
                self.health(deployment, ['nginx'])
            self.phase('verifying', 'Проверка завершена. Возобновляем работу панели и бота.', writesResumed=True)
            writes_resumed = True
            self.health(deployment, ['api'])
            self.health(deployment, [name for name in writers if name != 'api'])
            for name in ('api', 'bot', 'frontend', 'console'):
                if name in built:
                    self.run(['docker', 'tag', built[name], 'stealthnet-' + name + ':latest'])
            manifest['outcome'] = 'success'
            self.write_json(backup / 'manifest.json', manifest)
            self.phase('success', 'Обновление установлено', available=False, current=target, finishedAt=dt.datetime.now(dt.timezone.utc).isoformat())
            self.restart_needed = True
        except Exception:
            if writes_resumed:
                self.phase('failed', 'Ошибка после возобновления работы. База сохранена без отката, чтобы не потерять новые операции. Проверьте службы на сервере.', recoveryRequired=True)
                raise RuntimeError(self.status['message'])
            if stopped:
                self.status['recoveryRequired'] = True
                self.persist()
                self.compose('stop', *writers, capture=False)
                if switched:
                    self.git('reset', '--hard', previous)
                    self.restore_database(backup / 'database.dump')
                    self.restore_files(backup)
                    self.frontend(rollback)
                self.health(rollback, writers)
                if 'nginx' in images:
                    self.health(rollback, ['nginx'])
                self.status.update(rolledBack=True, recoveryRequired=False)
                manifest['outcome'] = 'rolledBack'
                self.write_json(backup / 'manifest.json', manifest)
                self.persist()
            raise
