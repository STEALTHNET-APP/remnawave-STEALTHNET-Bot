import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

if os.environ.get('STEALTHNET_UPDATER_DOCKER_TEST') != '1':
    raise SystemExit('Set STEALTHNET_UPDATER_DOCKER_TEST=1 to run isolated Docker tests')
spec = importlib.util.spec_from_file_location('agent', Path(__file__).with_name('agent.py'))
agent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent)
workspace = Path(tempfile.mkdtemp(prefix='stealthnet-updater-test-', dir='/var/tmp'))
root = workspace / 'repo'
root.mkdir()
project = 'updater-test-' + str(os.getpid())
prefix = project + '-'


def command(*args):
    return subprocess.check_output(args, cwd=root, stderr=subprocess.STDOUT).decode().strip()


def commit():
    command('git', 'add', '.')
    command('git', 'commit', '-qm', 'fixture')
    return command('git', 'rev-parse', 'HEAD')


class TestUpdater(agent.Updater):
    def run(self, args, **kwargs):
        args = [str(value).replace('stealthnet-update-', prefix + 'update-').replace('stealthnet-api:latest', prefix + 'api:latest').replace('stealthnet-bot:latest', prefix + 'bot:latest').replace('stealthnet-frontend:latest', prefix + 'frontend:latest') for value in args]
        args = ['15' if value == '600' else value for value in args]
        return super().run(args, **kwargs)

    def override(self, path, images):
        return super().override(path, {name: image.replace('stealthnet-update-', prefix + 'update-') for name, image in images.items()})

    def check(self):
        current = self.git('rev-parse', 'HEAD')
        self.phase('ready', 'fixture', available=current != self.target, current=current, target=self.target, version='6.7.0')


def fixture():
    command('git', 'init', '-q')
    command('git', 'config', 'user.email', 'test@example.invalid')
    command('git', 'config', 'user.name', 'Test')
    for name in ('backend', 'bot', 'frontend'):
        (root / name).mkdir()
    (root / 'backend' / 'marker').write_text('good')
    (root / 'backend' / 'Dockerfile').write_text('FROM alpine:3.20\nCOPY backend/marker /app/marker\nHEALTHCHECK --interval=1s --timeout=1s --retries=2 CMD test -f /tmp/ready\nCMD ["sh", "-c", "if [ $(cat /app/marker) != good ]; then exit 1; fi; touch /tmp/ready; exec sleep 3600"]\n')
    (root / 'bot' / 'Dockerfile').write_text('FROM alpine:3.20\nCMD ["sleep", "3600"]\n')
    (root / 'frontend' / 'Dockerfile').write_text('FROM alpine:3.20\nCOPY frontend/index.html /dist/index.html\n')
    (root / 'frontend' / 'index.html').write_text('old frontend')
    (root / 'version.json').write_text('{"version":"6.7.0"}')
    services = {
        'postgres': {'image': 'postgres:16-alpine', 'environment': {'POSTGRES_USER': 'fixture', 'POSTGRES_PASSWORD': 'fixture', 'POSTGRES_DB': 'fixture'}, 'healthcheck': {'test': ['CMD-SHELL', 'pg_isready -U fixture'], 'interval': '1s', 'retries': 20}, 'tmpfs': ['/var/lib/postgresql/data']},
        'api': {'image': prefix + 'api:latest', 'stop_grace_period': '1s'},
        'bot': {'image': prefix + 'bot:latest', 'stop_grace_period': '1s'},
        'broadcast-worker': {'image': prefix + 'api:latest', 'stop_grace_period': '1s'},
        'frontend': {'image': prefix + 'frontend:latest', 'entrypoint': ['sh', '-ec', 'rm -rf /out/*; cp -a /dist/. /out/'], 'volumes': ['front:/out']},
    }
    (root / 'docker-compose.yml').write_text(json.dumps({'name': project, 'services': services, 'volumes': {'front': {}}, 'networks': {'default': {'internal': True}}}))
    previous = commit()
    for service, context in [('api', root), ('bot', root / 'bot'), ('frontend', root)]:
        dockerfile = root / ('backend' if service == 'api' else service) / 'Dockerfile'
        command('docker', 'build', '-q', '--label', 'org.opencontainers.image.revision=' + previous, '-t', prefix + service + ':latest', '-f', str(dockerfile), str(context))
    return previous


updater = None
try:
    previous = fixture()
    updater = TestUpdater({'project': str(root), 'stateDir': str(workspace / 'state')})
    updater.compose('up', '-d', '--wait', 'postgres', 'api', 'bot', 'broadcast-worker', timeout=120)
    updater.compose('up', '--no-deps', '--exit-code-from', 'frontend', 'frontend')
    updater.compose('exec', '-T', 'postgres', 'psql', '-U', 'fixture', '-c', 'CREATE TABLE preserved (value text); INSERT INTO preserved VALUES (\'keep-me\');')
    (root / 'frontend' / 'index.html').write_text('new frontend')
    updater.target = commit()
    updater.git('reset', '--hard', previous)
    with (workspace / 'install.log').open('w') as log:
        updater.log = log
        updater.install()
    updater.log = None
    assert updater.status['phase'] == 'success', updater.status
    assert updater.git('rev-parse', 'HEAD') == updater.target
    assert updater.compose('exec', '-T', 'postgres', 'psql', '-U', 'fixture', '-Atc', 'SELECT value FROM preserved') == 'keep-me'
    assert Path(updater.status['backup'], 'database.dump').stat().st_size > 100
    assert 'new frontend' in command('docker', 'run', '--rm', '-v', project + '_front:/out', 'alpine:3.20', 'cat', '/out/index.html')
    print('PASS: new images installed, Git advanced, frontend updated, backup created, DB record preserved', flush=True)
    previous = updater.target
    (root / 'backend' / 'marker').write_text('bad')
    (root / 'frontend' / 'index.html').write_text('broken frontend')
    updater.target = commit()
    updater.git('reset', '--hard', previous)
    with (workspace / 'rollback.log').open('w') as log:
        updater.log = log
        try:
            updater.install()
            raise AssertionError('Broken API must fail')
        except RuntimeError:
            pass
    updater.log = None
    assert updater.status.get('rolledBack'), updater.status
    assert not updater.status.get('recoveryRequired'), updater.status
    assert updater.git('rev-parse', 'HEAD') == previous
    assert updater.compose('exec', '-T', 'postgres', 'psql', '-U', 'fixture', '-Atc', 'SELECT value FROM preserved') == 'keep-me'
    assert 'new frontend' in command('docker', 'run', '--rm', '-v', project + '_front:/out', 'alpine:3.20', 'cat', '/out/index.html')
    print('PASS: failed API rolled back Git, images and frontend; DB preserved', flush=True)
except Exception:
    for file in workspace.glob('*.log'):
        print(file.name, file.read_text()[-5000:])
    raise
finally:
    if updater:
        updater.log = None
        updater.compose('down', '--volumes', '--remove-orphans', timeout=120)
    images = command('docker', 'image', 'ls', '--format', '{{.Repository}}:{{.Tag}}').splitlines()
    for image in images:
        if image.startswith(prefix):
            command('docker', 'image', 'rm', image)
    shutil.rmtree(workspace)
