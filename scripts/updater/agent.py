import datetime as dt
import fcntl
import http.server
import json
import os
from pathlib import Path
import re
import socketserver
import subprocess
import sys
import threading
import time
import urllib.request

from deployment import Deployment
from local_changes import LocalChanges

REPOSITORY = 'https://github.com/STEALTHNET-APP/remnawave-STEALTHNET-Bot.git'
RELEASES = 'https://api.github.com/repos/STEALTHNET-APP/remnawave-STEALTHNET-Bot/releases/latest'
ACTIVE = {'checking', 'building', 'rehearsal', 'backup', 'installing', 'verifying'}


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def save(path, value):
    path = Path(path)
    temporary = path.with_suffix('.tmp')
    with temporary.open('w') as stream:
        stream.write(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
        stream.flush()
        os.fsync(stream.fileno())
    temporary.chmod(0o600)
    temporary.replace(path)
    descriptor = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def read(path, default):
    try:
        return json.loads(Path(path).read_text())
    except FileNotFoundError:
        return default


def validate_settings(value):
    if not isinstance(value, dict) or set(value) - {'enabled', 'channel', 'hourUtc', 'backupRetentionDays'} or not {'enabled', 'channel', 'hourUtc'} <= set(value):
        raise ValueError('Нужны enabled, channel и hourUtc')
    if type(value['enabled']) is not bool or value['channel'] not in ('stable', 'main'):
        raise ValueError('Некорректный канал или режим обновления')
    if type(value['hourUtc']) is not int or not 0 <= value['hourUtc'] <= 23:
        raise ValueError('Час обновления должен быть от 0 до 23 UTC')
    days = value.get('backupRetentionDays', 3)
    if type(days) is not int or not 1 <= days <= 30:
        raise ValueError('Хранение резервных копий должно быть от 1 до 30 дней')
    return {**value, 'backupRetentionDays': days}


class Updater(Deployment, LocalChanges):
    write_json = staticmethod(save)

    def __init__(self, config):
        self.root = Path(config['project']).resolve()
        self.state_dir = Path(config.get('stateDir', '/var/lib/stealthnet-updater'))
        self.state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.external_frontend = config.get('externalFrontend')
        self.lock = threading.Lock()
        self.status = read(self.state_dir / 'status.json', {'phase': 'idle'})
        if self.status['phase'] in ACTIVE - {'checking', 'building', 'rehearsal'}:
            self.status.update(recoveryRequired=True, phase='interrupted', message='Обновление прервано. Проверьте службы и резервную копию перед повторным запуском.')
            self.persist()
        if self.status['phase'] in {'checking', 'building', 'rehearsal'}:
            self.status.update(phase='idle', available=False)
            self.persist()
        self.settings = read(self.state_dir / 'settings.json', {'enabled': False, 'channel': 'stable', 'hourUtc': 3})
        self.settings = validate_settings(self.settings)
        self.restart_needed = False
        self.log = None

    def persist(self):
        save(self.state_dir / 'status.json', self.status)

    def phase(self, phase, message, **kwargs):
        self.status.update(phase=phase, message=message, updatedAt=now(), **kwargs)
        self.persist()

    def run(self, args, timeout=120, capture=True, output=None, input=None):
        result = subprocess.run(args, cwd=self.root, stdin=input if input is not None else subprocess.DEVNULL,
                                stdout=output or (subprocess.PIPE if capture else self.log),
                                stderr=self.log or subprocess.DEVNULL, timeout=timeout,
                                env={**os.environ, 'GIT_TERMINAL_PROMPT': '0'})
        if result.returncode:
            raise RuntimeError(f'Команда {args[0]} завершилась с кодом {result.returncode}. Подробности в журнале службы.')
        return result.stdout.decode().strip() if capture and output is None else ''

    def git(self, *args):
        return self.run(['git', *args])

    def compose(self, *args, override=None, source=None, **kwargs):
        command = ['docker', 'compose', '--project-directory', str(self.root), '-f', str((source or self.root) / 'docker-compose.yml')]
        extra = self.root / 'docker-compose.override.yml'
        if extra.exists():
            command += ['-f', str(extra)]
        if override:
            command += ['-f', str(override)]
        return self.run(command + list(args), **kwargs)

    def snapshot(self):
        return {'installed': read(self.root / 'version.json', {}), 'settings': self.settings, 'status': self.status, 'backups': self.backup_list()[:50]}

    def clean(self, local_changes_id=None):
        changes = self.local_changes()
        if changes and (not changes['canPreserve'] or changes['id'] != local_changes_id):
            raise RuntimeError('В папке проекта есть локальные изменения. Сохраните их отдельно или подтвердите обновление с резервной копией правок.')

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
        blocked = None
        try:
            self.clean()
        except RuntimeError as error:
            blocked = str(error)
        changes = self.git('log', '--format=%s', '-15', current + '..' + target) if available else ''
        self.phase('ready', message, available=available, target=target, current=current,
                   version=version, checkedAt=now(), changes=changes, channel=self.settings['channel'], blockedReason=blocked, localChanges=self.local_changes())
        return self.status

    def service_images(self):
        images = {}
        for service in ('api', 'broadcast-worker', 'bot', 'frontend', 'console', 'nginx'):
            if service not in self.compose_config()['services']:
                continue
            ids = self.compose('ps', '-a', '-q', service).splitlines()
            if not ids and service in ('console', 'nginx'):
                continue
            if service in ('console', 'nginx') and ids and self.run(['docker', 'inspect', '--format', '{{.State.Running}}', ids[0]]) != 'true':
                continue
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

    def install(self, local_changes_id=None):
        self.deploy(local_changes_id)

    def start(self, action, local_changes_id=None):
        if local_changes_id is not None:
            if action != "install" or not isinstance(local_changes_id, str) or not re.fullmatch(r"[a-f0-9]{64}", local_changes_id):
                raise ValueError("Некорректное подтверждение локальных изменений")
            self.clean(local_changes_id)
        if self.status.get('recoveryRequired') and action == 'install':
            raise RuntimeError('После прерванного обновления требуется проверка администратора на сервере')
        if not self.lock.acquire(blocking=False):
            raise RuntimeError('Операция уже выполняется')
        self.phase('checking', 'Начинаем проверку', rolledBack=False)
        threading.Thread(target=self.job, args=(action, local_changes_id), daemon=True).start()

    def job(self, action, local_changes_id=None):
        try:
            with (self.state_dir / 'operation.lock').open('w') as lockfile:
                fcntl.flock(lockfile, fcntl.LOCK_EX | fcntl.LOCK_NB)
                with (self.state_dir / 'update.log').open('a') as log:
                    self.log = log
                    self.install(local_changes_id) if action == 'install' else self.check()
        except Exception as error:
            self.phase('failed', str(error))
        finally:
            self.log = None
            self.lock.release()

    def configure(self, value):
        value = validate_settings(value)
        if not self.lock.acquire(blocking=False):
            raise RuntimeError('Дождитесь завершения текущей операции')
        try:
            save(self.state_dir / 'settings.json', value)
            self.settings = value
            self.status.update(available=False, lastCheckAttempt=None)
            self.persist()
        finally:
            self.lock.release()

    def scheduled(self, instant):
        if instant.tzinfo is None:
            instant = instant.replace(tzinfo=dt.timezone.utc)
        if not self.lock.acquire(blocking=False):
            return
        action = None
        try:
            if self.status.get('recoveryRequired'):
                return
            day = instant.strftime('%Y-%m-%d')
            if self.status.get('lastCleanupDay') != day:
                self.cleanup_backups(instant)
                self.cleanup_images()
                self.status['lastCleanupDay'] = day
                self.persist()
            if (self.settings['enabled'] and instant.hour == self.settings['hourUtc']
                    and self.status.get('lastScheduledDay') != day):
                self.status.update(lastScheduledDay=day, lastCheckAttempt=instant.isoformat())
                self.persist()
                action = 'install'
            else:
                previous = self.status.get('lastCheckAttempt')
                if previous is None or (instant - dt.datetime.fromisoformat(previous)).total_seconds() >= 900:
                    self.status['lastCheckAttempt'] = instant.isoformat()
                    self.persist()
                    action = 'check'
        finally:
            self.lock.release()
        if action:
            self.start(action)


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
                elif self.path == '/install' and isinstance(body, dict) and set(body) == {'localChangesId'}:
                    updater.start('install', body['localChangesId'])
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
        if updater.restart_needed and not updater.lock.locked():
            os.execv(sys.executable, [sys.executable, *sys.argv])
        try:
            updater.scheduled(dt.datetime.now(dt.timezone.utc))
        except Exception as error:
            print(str(error), file=sys.stderr, flush=True)
        time.sleep(30)


if __name__ == '__main__':
    os.umask(0o077)
    serve(read(sys.argv[1], {}))
