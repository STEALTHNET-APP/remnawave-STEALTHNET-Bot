import datetime as dt
import fcntl
import http.server
import json
import os
from pathlib import Path
import re
import shutil
import socketserver
import subprocess
import sys
import tarfile
import threading
import time
import urllib.request

REPOSITORY = 'https://github.com/STEALTHNET-APP/remnawave-STEALTHNET-Bot.git'
RELEASES = 'https://api.github.com/repos/STEALTHNET-APP/remnawave-STEALTHNET-Bot/releases/latest'
ACTIVE = {'checking', 'building', 'backup', 'installing', 'verifying'}


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def save(path, value):
    path = Path(path)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    temporary.chmod(0o600)
    temporary.replace(path)


def read(path, default):
    try:
        return json.loads(Path(path).read_text())
    except FileNotFoundError:
        return default


def validate_settings(value):
    if set(value) != {'enabled', 'channel', 'hourUtc'}:
        raise ValueError('Нужны enabled, channel и hourUtc')
    if type(value['enabled']) is not bool or value['channel'] not in ('stable', 'main'):
        raise ValueError('Некорректный канал или режим обновления')
    if type(value['hourUtc']) is not int or not 0 <= value['hourUtc'] <= 23:
        raise ValueError('Час обновления должен быть от 0 до 23 UTC')
    return value


class Updater:
    def __init__(self, config):
        self.root = Path(config['project']).resolve()
        self.state_dir = Path(config.get('stateDir', '/var/lib/stealthnet-updater'))
        self.state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.external_frontend = config.get('externalFrontend')
        self.lock = threading.Lock()
        self.status = read(self.state_dir / 'status.json', {'phase': 'idle'})
        if self.status['phase'] in ACTIVE:
            self.status.update(recoveryRequired=True, phase='interrupted', message='Обновление прервано. Проверьте службы и резервную копию перед повторным запуском.')
            self.persist()
        self.settings = read(self.state_dir / 'settings.json', {'enabled': False, 'channel': 'stable', 'hourUtc': 3})
        validate_settings(self.settings)
        self.log = None

    def persist(self):
        save(self.state_dir / 'status.json', self.status)

    def phase(self, phase, message, **kwargs):
        self.status.update(phase=phase, message=message, updatedAt=now(), **kwargs)
        self.persist()

    def run(self, args, timeout=120, capture=True, output=None):
        result = subprocess.run(args, cwd=self.root, stdin=subprocess.DEVNULL,
                                stdout=output or (subprocess.PIPE if capture else self.log),
                                stderr=self.log or subprocess.DEVNULL, timeout=timeout,
                                env={**os.environ, 'GIT_TERMINAL_PROMPT': '0'})
        if result.returncode:
            raise RuntimeError(f'Команда {args[0]} завершилась с кодом {result.returncode}. Подробности в журнале службы.')
        return result.stdout.decode().strip() if capture and output is None else ''

    def git(self, *args):
        return self.run(['git', *args])

    def compose(self, *args, override=None, **kwargs):
        command = ['docker', 'compose', '--project-directory', str(self.root), '-f', str(self.root / 'docker-compose.yml')]
        extra = self.root / 'docker-compose.override.yml'
        if extra.exists():
            command += ['-f', str(extra)]
        if override:
            command += ['-f', str(override)]
        return self.run(command + list(args), **kwargs)

    def snapshot(self):
        return {'installed': read(self.root / 'version.json', {}), 'settings': self.settings, 'status': self.status}

    def clean(self):
        if self.git('status', '--porcelain', '--untracked-files=normal'):
            raise RuntimeError('В папке проекта есть локальные изменения. Сохраните их отдельно перед обновлением.')
        if not self.git('branch', '--show-current'):
            raise RuntimeError('Проект должен находиться на ветке Git, а не на отдельном коммите.')

    def check(self):
        self.phase('checking', 'Проверяем GitHub', available=False)
        ref = 'refs/heads/main'
        release = None
        if self.settings['channel'] == 'stable':
            request = urllib.request.Request(RELEASES, headers={'User-Agent': 'STEALTHNET-Updater', 'Accept': 'application/vnd.github+json'})
            with urllib.request.urlopen(request, timeout=30) as response:
                release = json.load(response)
            if release.get('draft') or release.get('prerelease') or not re.fullmatch(r'v?\d+\.\d+\.\d+(?:-lts)?', release['tag_name']):
                raise RuntimeError('Не найден подходящий стабильный релиз')
            ref = 'refs/tags/' + release['tag_name']
        self.git('fetch', '--no-tags', REPOSITORY, ref)
        target = self.git('rev-parse', 'FETCH_HEAD^{commit}')
        current = self.git('rev-parse', 'HEAD')
        version = json.loads(self.git('show', target + ':version.json'))['version']
        forward = subprocess.run(['git', 'merge-base', '--is-ancestor', current, target], cwd=self.root).returncode == 0
        available = target != current and forward
        message = 'Доступно обновление' if available else 'Новых обновлений в выбранном канале нет'
        if target != current and not forward:
            message = 'Релиз старее установленного кода или история Git отличается. Автоматический откат не выполняется.'
        changes = self.git('log', '--format=%s', '-15', current + '..' + target) if available else ''
        self.phase('ready', message, available=available, target=target, current=current,
                   version=version, checkedAt=now(), changes=changes, channel=self.settings['channel'])
        return self.status

    def service_images(self):
        images = {}
        for service in ('api', 'broadcast-worker', 'bot', 'frontend'):
            ids = self.compose('ps', '-a', '-q', service).splitlines()
            if len(ids) != 1:
                raise RuntimeError(f'Не найден единственный контейнер {service}. Нужна стандартная установка Docker Compose.')
            images[service] = self.run(['docker', 'inspect', '--format', '{{.Image}}', ids[0]])
        return images

    def override(self, path, images):
        save(path, {'services': {name: {'image': image} for name, image in images.items()}})
        return path

    def frontend(self, override):
        self.compose('up', '--no-deps', '--no-build', '--pull', 'never', '--force-recreate', '--exit-code-from', 'frontend', 'frontend', override=override, capture=False, timeout=180)
        if self.external_frontend:
            self.run(['docker', 'run', '--rm', '--entrypoint', 'sh', '-v', self.external_frontend + ':/out',
                      read(override, {})['services']['frontend']['image'], '-ec',
                      'find /out -mindepth 1 -maxdepth 1 -exec rm -rf {} +; cp -a /dist/. /out/'], timeout=180, capture=False)

    def install(self):
        self.clean()
        self.check()
        if not self.status['available']:
            return
        target, previous = self.status['target'], self.status['current']
        changed = self.git('diff', '--name-only', previous, target).splitlines()
        protected = ('docker-compose', 'nginx/', 'scripts/updater/', 'backend/docker-entrypoint.sh')
        if any(name.startswith(protected) for name in changed):
            raise RuntimeError('Обновление меняет инфраструктуру или службу обновления. Установите его вручную по инструкции в docs/auto-update.md.')
        if any(name.startswith('backend/prisma/') for name in changed):
            raise RuntimeError('Обновление меняет базу данных. Нужна ручная установка с проверкой миграций; текущая версия продолжит работать.')
        images = self.service_images()
        api_revision = self.run(['docker', 'image', 'inspect', '--format', '{{index .Config.Labels "org.opencontainers.image.revision"}}', images['api']])
        if api_revision != previous:
            raise RuntimeError('Запущенный API не соответствует текущему коммиту Git. Сначала пересоберите установленную версию по инструкции.')
        if shutil.disk_usage(self.state_dir).free < 5 * 1024 ** 3:
            raise RuntimeError('Для обновления нужно минимум 5 ГБ свободного места')
        build = self.state_dir / ('build-' + target[:12])
        if build.exists():
            shutil.rmtree(build)
        build.mkdir(mode=0o700)
        archive = build / 'source.tar'
        with archive.open('wb') as stream:
            self.run(['git', 'archive', target], output=stream)
        with tarfile.open(archive) as source:
            for entry in source:
                if entry.issym() or entry.islnk() or not (entry.isfile() or entry.isdir()):
                    raise RuntimeError('Архив исходников содержит неподдерживаемые ссылки')
                destination = (build / entry.name).resolve()
                if not destination.is_relative_to(build):
                    raise RuntimeError('Недопустимый путь в архиве')
                source.extract(entry, build)
        archive.unlink()
        built = {}
        self.phase('building', 'Собираем новую версию. Текущая продолжает работать.')
        for service, dockerfile, context in [('api', 'backend/Dockerfile', build), ('bot', 'bot/Dockerfile', build / 'bot'), ('frontend', 'frontend/Dockerfile', build)]:
            tag = 'stealthnet-update-' + service + ':' + target
            self.run(['docker', 'build', '--label', 'org.opencontainers.image.revision=' + target,
                      '--build-arg', 'BUILD_COMMIT=' + target, '--build-arg', 'BUILD_DATE=' + now(),
                      '-t', tag, '-f', str(build / dockerfile), str(context)], timeout=3600, capture=False)
            built[service] = tag
        built['broadcast-worker'] = built['api']
        backup = self.state_dir / ('backup-' + dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S%f'))
        backup.mkdir(mode=0o700)
        rollback = self.override(backup / 'images.json', images)
        deployment = self.override(build / 'images.json', built)
        self.clean()
        if self.git('rev-parse', 'HEAD') != previous:
            raise RuntimeError('Исходники изменились во время сборки. Повторите проверку.')
        self.phase('backup', 'Сохраняем базу данных и настройки', backup=str(backup))
        with tarfile.open(backup / 'settings.tar.gz', 'w:gz') as bundle:
            for name in ('.env', 'docker-compose.yml', 'docker-compose.override.yml', 'nginx', 'version.json'):
                if (self.root / name).exists():
                    bundle.add(self.root / name, arcname=name)
        stopped = False
        switched = False
        try:
            stopped = True
            self.compose('stop', 'bot', 'broadcast-worker', 'api', capture=False)
            with (backup / 'database.dump').open('wb') as stream:
                self.compose('exec', '-T', 'postgres', 'sh', '-ec', 'pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB"', output=stream, timeout=1800)
            with (backup / 'database.dump').open('rb') as stream:
                if stream.read(5) != b'PGDMP':
                    raise RuntimeError('Резервная копия базы данных не создана')
            self.phase('installing', 'Устанавливаем обновление')
            self.git('merge', '--ff-only', target)
            switched = True
            self.frontend(deployment)
            self.compose('up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '600', 'api', override=deployment, capture=False, timeout=660)
            self.phase('verifying', 'Проверяем запуск API, бота и обработчика рассылок')
            self.compose('up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '90', 'bot', 'broadcast-worker', override=deployment, capture=False, timeout=120)
            time.sleep(10)
            for name in ('api', 'bot', 'broadcast-worker'):
                container = self.compose('ps', '-q', name)
                state = json.loads(self.run(['docker', 'inspect', '--format', '{{json .State}}', container]))
                restarts = int(self.run(['docker', 'inspect', '--format', '{{.RestartCount}}', container]))
                if not state.get('Running') or state.get('Health', {}).get('Status', 'healthy') != 'healthy' or restarts:
                    raise RuntimeError(f'Служба {name} не прошла проверку запуска')
            for name in ('api', 'bot', 'frontend'):
                self.run(['docker', 'tag', built[name], 'stealthnet-' + name + ':latest'])
            self.phase('success', 'Обновление установлено', available=False, current=target, finishedAt=now())
        except Exception:
            if stopped:
                self.status['recoveryRequired'] = True
                self.persist()
                self.compose('stop', 'api', 'bot', 'broadcast-worker', capture=False)
                if switched:
                    self.git('reset', '--hard', previous)
                self.frontend(rollback)
                self.compose('up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '600', 'api', 'bot', 'broadcast-worker', override=rollback, capture=False, timeout=660)
                for name in ('api', 'bot', 'frontend'):
                    self.run(['docker', 'tag', images[name], 'stealthnet-' + name + ':latest'])
                self.status['rolledBack'] = True
                self.status['recoveryRequired'] = False
            raise
        finally:
            shutil.rmtree(build, ignore_errors=True)

    def start(self, action):
        if self.status.get('recoveryRequired') and action == 'install':
            raise RuntimeError('После прерванного обновления требуется проверка администратора на сервере')
        if not self.lock.acquire(blocking=False):
            raise RuntimeError('Операция уже выполняется')
        self.phase('checking', 'Начинаем проверку', rolledBack=False)
        threading.Thread(target=self.job, args=(action,), daemon=True).start()

    def job(self, action):
        try:
            with (self.state_dir / 'operation.lock').open('w') as lockfile:
                fcntl.flock(lockfile, fcntl.LOCK_EX | fcntl.LOCK_NB)
                with (self.state_dir / 'update.log').open('a') as log:
                    self.log = log
                    self.install() if action == 'install' else self.check()
        except Exception as error:
            self.phase('failed', str(error))
        finally:
            self.log = None
            self.lock.release()

    def configure(self, value):
        validate_settings(value)
        if not self.lock.acquire(blocking=False):
            raise RuntimeError('Дождитесь завершения текущей операции')
        try:
            save(self.state_dir / 'settings.json', value)
            self.settings = value
            self.status.update(available=False)
            self.persist()
        finally:
            self.lock.release()

    def scheduled(self, instant):
        day = instant.strftime('%Y-%m-%d')
        if (self.settings['enabled'] and instant.hour == self.settings['hourUtc']
                and self.status.get('lastScheduledDay') != day and not self.status.get('recoveryRequired') and not self.lock.locked()):
            self.status['lastScheduledDay'] = day
            self.persist()
            self.start('install')


def serve(config):
    updater = Updater(config)

    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def respond(self, status, payload):
            data = json.dumps(payload, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            self.respond(200, updater.snapshot()) if self.path == '/status' else self.respond(404, {})

        def do_POST(self):
            self.connection.settimeout(5)
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 1024:
                    raise ValueError('Некорректный размер запроса')
                body = json.loads(self.rfile.read(length))
                if self.path == '/settings':
                    updater.configure(body)
                elif self.path in ('/check', '/install') and body == {}:
                    updater.start(self.path[1:])
                else:
                    raise ValueError('Неизвестная операция')
                self.respond(202, updater.snapshot())
            except (ValueError, TypeError) as error:
                self.respond(400, {'message': str(error)})
            except RuntimeError as error:
                self.respond(409, {'message': str(error)})

    class Server(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
        daemon_threads = True

    socket = Path(config.get('socket', '/run/stealthnet-updater/control.sock'))
    socket.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    socket.unlink(missing_ok=True)
    server = Server(str(socket), Handler)
    socket.chmod(0o600)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    while True:
        updater.scheduled(dt.datetime.now(dt.timezone.utc))
        time.sleep(30)


if __name__ == '__main__':
    os.umask(0o077)
    serve(read(sys.argv[1], {}))
