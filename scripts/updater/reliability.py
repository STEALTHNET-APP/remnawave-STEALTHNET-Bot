import json
from pathlib import Path
import shutil
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.request


class CommandFailure(RuntimeError):
    pass


def preflight(run):
    missing = [name for name in ('git', 'docker') if not shutil.which(name)]
    if missing:
        raise RuntimeError('Не найдены команды: ' + ', '.join(missing) + '. Для Git запустите sudo bash scripts/updater/dependencies.sh; Docker установите по инструкции проекта.')
    try:
        run(['docker', 'compose', 'version'])
        help_text = run(['docker', 'compose', 'up', '--help'])
    except CommandFailure as error:
        raise RuntimeError('Docker Compose недоступен. Установите или обновите плагин Docker Compose V2.') from error
    if not all(option in help_text for option in ('--wait', '--wait-timeout', '--pull')):
        raise RuntimeError('Устаревший Docker Compose: нужны up --wait, --wait-timeout и --pull. Обновите плагин Docker Compose V2.')
    try:
        info = json.loads(run(['docker', 'info', '--format', '{{json .}}']))
    except (CommandFailure, ValueError) as error:
        raise RuntimeError('Docker daemon недоступен. Проверьте sudo systemctl status docker и доступ службы к Docker socket.') from error
    if info.get('OSType') != 'linux':
        raise RuntimeError('Обновлятору нужен Docker с Linux-контейнерами.')
    if any('rootless' in option for option in info.get('SecurityOptions', [])):
        raise RuntimeError('Docker rootless требует отдельной настройки и не поддерживается штатным обновлятором.')
    data_root = info.get('DockerRootDir')
    if not data_root or not Path(data_root).is_dir():
        raise RuntimeError('Хранилище Docker недоступно на этом сервере. Обновлятор должен работать на том же хосте, что и Docker.')
    if shutil.disk_usage(data_root).free < 5 * 1024 ** 3:
        raise RuntimeError('В хранилище Docker нужно минимум 5 ГБ свободного места для сборки. Освободите место без удаления рабочих томов и резервных копий.')


class Reliability:
    def preflight(self):
        preflight(self.run)

    def download_retry(self, label, operation):
        for attempt in range(3):
            try:
                return operation()
            except (CommandFailure, urllib.error.URLError, TimeoutError, ConnectionError) as error:
                transient = True
                if isinstance(error, urllib.error.HTTPError):
                    transient = error.code in (408, 429, 500, 502, 503, 504)
                if isinstance(error, urllib.error.URLError) and isinstance(error.reason, ssl.SSLCertVerificationError):
                    transient = False
                if not transient or attempt == 2:
                    raise RuntimeError(f'{label}: загрузка не выполнена. {error}. Текущая версия продолжает работать; проверьте сеть и журнал, затем повторите обновление.') from error
                delay = 5 * (attempt + 1)
                message = f'{label}: повтор загрузки {attempt + 2}/3 через {delay} сек. Текущая версия продолжает работать.'
                self.phase(self.status['phase'], message)
                if self.log:
                    self.log.write(message + '\n')
                    self.log.flush()
                time.sleep(delay)

    def release_info(self, url):
        def load():
            request = urllib.request.Request(url, headers={'User-Agent': 'STEALTHNET-Updater', 'Accept': 'application/vnd.github+json'})
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.load(response)
        return self.download_retry('GitHub Release', load)


if __name__ == '__main__':
    def run(args):
        try:
            return subprocess.check_output(args, cwd=sys.argv[1], stderr=subprocess.DEVNULL, timeout=30).decode()
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
            raise CommandFailure(str(error)) from error
    try:
        preflight(run)
    except RuntimeError as error:
        raise SystemExit(str(error))
    print('Docker готов к обновлению. Рабочие контейнеры не изменены.')
