import argparse
import fcntl
import os
from pathlib import Path
import subprocess
import sys

from agent import ACTIVE, Updater, read


def recover(config, channel):
    state = Path(config.get('stateDir', '/var/lib/stealthnet-updater'))
    if not config.get('project') or not (state / 'status.json').is_file():
        raise RuntimeError('Не найдена настроенная служба обновления. Проверьте путь конфигурации.')
    with (state / 'operation.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('Сейчас выполняется обновление. Дождитесь завершения.')
        status = read(state / 'status.json', {})
        if status.get('phase') in ACTIVE or status.get('recoveryRequired'):
            raise RuntimeError('Служба сообщает об активной или прерванной установке. Сначала проверьте её состояние.')
        active = subprocess.run(['systemctl', 'is-active', '--quiet', 'stealthnet-updater']).returncode == 0
        if active:
            subprocess.run(['systemctl', 'stop', 'stealthnet-updater'], check=True)
        try:
            updater = Updater(config)
            updater.settings['channel'] = channel
            with (state / 'update.log').open('a') as log:
                updater.log = log
                try:
                    print('Проверяем обновление, создаём резервную копию и выполняем установку. Журнал: ' + str(state / 'update.log'), flush=True)
                    updater.install()
                except Exception as error:
                    updater.phase('failed', str(error))
                    raise
            print(updater.status.get('message', 'Проверка завершена'))
            if updater.status.get('backup'):
                print('Резервная копия: ' + updater.status['backup'])
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)
            if active:
                subprocess.run(['systemctl', 'start', 'stealthnet-updater'], check=True)


if __name__ == '__main__':
    os.umask(0o077)
    parser = argparse.ArgumentParser(description='Однократное обновление старой панели с сохранением конфигурации Nginx')
    parser.add_argument('--config', default='/etc/stealthnet-updater/config.json')
    parser.add_argument('--channel', required=True, choices=['main', 'stable'])
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error('Запустите через sudo')
    try:
        recover(read(args.config, {}), args.channel)
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
