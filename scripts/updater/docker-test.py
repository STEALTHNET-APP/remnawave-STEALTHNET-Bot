import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

if os.environ.get('STEALTHNET_UPDATER_DOCKER_TEST') != '1':
    raise SystemExit('Set STEALTHNET_UPDATER_DOCKER_TEST=1 to run isolated Docker tests')
sys.path.insert(0, str(Path(__file__).parent))
import agent
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


def namespace(value):
    for name in ('update-', 'backup-', 'api:latest', 'bot:latest', 'frontend:latest', 'console:latest'):
        value = str(value).replace('stealthnet-' + name, prefix + name)
    return value


class TestUpdater(agent.Updater):
    def run(self, args, **kwargs):
        args = [namespace(value) for value in args]
        args = ['20' if value == '600' else value for value in args]
        return super().run(args, **kwargs)

    def override(self, path, images):
        return super().override(path, {name: namespace(image) for name, image in images.items()})

    def wait_probe(self, container, timeout=600):
        return super().wait_probe(container, timeout=30)

    def check(self):
        current = self.git('rev-parse', 'HEAD')
        self.phase('ready', 'fixture', available=current != self.target, current=current, target=self.target, version='6.7.1')


def fixture():
    command('git', 'init', '-q')
    command('git', 'config', 'user.email', 'test@example.invalid')
    command('git', 'config', 'user.name', 'Test')
    for name in ('backend', 'bot', 'frontend', 'console'):
        (root / name).mkdir()
    (root / 'backend/marker').write_text('good')
    (root / 'backend/server.cjs').write_text('''const fs = require('fs');
const marker = fs.readFileSync('/app/marker','utf8');
if (marker === 'bad-resume' && process.env.UPDATER_VERIFY_ONLY !== '1') {
  require('child_process').execFileSync('psql',[process.env.DATABASE_URL,'-c',"INSERT INTO preserved VALUES ('new-operation');"]);
  process.exit(1);
}
require('http').createServer((req,res)=>{
  if(req.url !== '/api/health' && process.env.UPDATER_VERIFY_ONLY === '1') {res.statusCode=503; return res.end('maintenance');}
  res.end(JSON.stringify({status:'ok', maintenance:process.env.UPDATER_VERIFY_ONLY === '1'}));
}).listen(5000);
''')
    (root / 'backend/docker-entrypoint.sh').write_text('''#!/bin/sh
set -eu
if [ "${UPDATER_VERIFY_ONLY:-}" = "1" ]; then
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c 'CREATE TABLE IF NOT EXISTS migration_result (value text);'
  if [ "$(cat /app/marker)" = "bad-migration" ]; then exit 1; fi
  if [ "$(cat /app/marker)" = "bad-live" ]; then
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "ALTER TABLE preserved ADD COLUMN rollback_column text; UPDATE preserved SET value = 'changed';"
    case "$DATABASE_URL" in *probe*) ;; *) echo broken-file > /app/uploads/example.txt; exit 1 ;; esac
  fi
fi
exec node /app/server.cjs
''')
    (root / 'backend/Dockerfile').write_text('FROM node:22-alpine\nRUN apk add --no-cache postgresql-client\nWORKDIR /app\nCOPY backend/marker backend/server.cjs backend/docker-entrypoint.sh ./\nRUN chmod +x docker-entrypoint.sh\nHEALTHCHECK --interval=1s --timeout=2s --retries=2 CMD node -e "fetch(\'http://localhost:5000/api/health\').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"\nENTRYPOINT ["/app/docker-entrypoint.sh"]\n')
    for name in ('bot','console'):
        (root / name / 'Dockerfile').write_text('FROM alpine:3.20\nCMD ["sleep", "3600"]\n')
    (root / 'frontend/Dockerfile').write_text('FROM alpine:3.20\nCOPY frontend/index.html /dist/index.html\n')
    (root / 'frontend/index.html').write_text('old frontend')
    (root / 'version.json').write_text('{"version":"6.7.1"}')
    services = {
        'postgres': {'image': 'postgres:16-alpine', 'environment': {'POSTGRES_USER': 'fixture', 'POSTGRES_PASSWORD': 'fixture', 'POSTGRES_DB': 'fixture'}, 'healthcheck': {'test': ['CMD-SHELL', 'pg_isready -U fixture'], 'interval': '1s', 'retries': 20}, 'tmpfs': ['/var/lib/postgresql/data']},
        'api': {'image': prefix + 'api:latest', 'stop_grace_period': '1s', 'environment': {'DATABASE_URL': 'postgresql://fixture:fixture@postgres:5432/fixture'}, 'volumes': ['uploads:/app/uploads']},
        'bot': {'image': prefix + 'bot:latest', 'stop_grace_period': '1s'},
        'console': {'image': prefix + 'console:latest', 'stop_grace_period': '1s'},
        'broadcast-worker': {'image': prefix + 'api:latest', 'stop_grace_period': '1s', 'entrypoint': ['sleep','3600'], 'healthcheck': {'disable': True}},
        'frontend': {'image': prefix + 'frontend:latest', 'entrypoint': ['sh', '-ec', 'rm -rf /out/*; cp -a /dist/. /out/'], 'volumes': ['front:/out']},
    }
    (root / 'docker-compose.yml').write_text(json.dumps({'name': project, 'services': services, 'volumes': {'front': {}, 'uploads': {}}, 'networks': {'default': {'internal': True}}}))
    previous = commit()
    for service, context in [('api', root), ('bot', root / 'bot'), ('frontend', root), ('console', root / 'console')]:
        dockerfile = root / ('backend' if service == 'api' else service) / 'Dockerfile'
        command('docker', 'build', '-q', '--label', 'org.opencontainers.image.revision=' + previous, '-t', prefix + service + ':latest', '-f', str(dockerfile), str(context))
    return previous


def install(updater, label, fail=False):
    with (workspace / (label + '.log')).open('w') as log:
        updater.log = log
        try:
            updater.install()
            assert not fail, 'Expected failure'
        except RuntimeError:
            if not fail:
                raise
    updater.log = None


updater = None
try:
    previous = fixture()
    updater = TestUpdater({'project': str(root), 'stateDir': str(workspace / 'state')})
    updater.compose('up', '-d', '--wait', 'postgres', 'api', 'bot', 'broadcast-worker', 'console', timeout=120)
    updater.compose('up', '--no-deps', '--exit-code-from', 'frontend', 'frontend')
    updater.compose('exec', '-T', 'postgres', 'psql', '-U', 'fixture', '-c', "CREATE TABLE preserved (value text); INSERT INTO preserved VALUES ('keep-me');")
    updater.compose('exec', '-T', 'api', 'sh', '-c', 'echo preserved-file > /app/uploads/example.txt')
    (root / 'frontend/index.html').write_text('new frontend')
    updater.target = commit()
    updater.git('reset', '--hard', previous)
    install(updater, 'success')
    assert updater.status['phase'] == 'success', updater.status
    assert updater.git('rev-parse', 'HEAD') == updater.target
    assert updater.compose('exec', '-T', 'postgres', 'psql', '-U', 'fixture', '-Atc', 'SELECT value FROM preserved') == 'keep-me'
    assert updater.compose('exec', '-T', 'postgres', 'psql', '-U', 'fixture', '-Atc', "SELECT to_regclass('migration_result')") == 'migration_result'
    assert Path(updater.status['backup'], 'database.dump').stat().st_size > 100
    assert Path(updater.status['backup'], 'files-0.tar.gz').is_file()
    assert 'new frontend' in command('docker', 'run', '--rm', '-v', project + '_front:/out', 'alpine:3.20', 'cat', '/out/index.html')
    print('PASS: full update, migration, frontend, console, database/files backup, preserved data', flush=True)
    previous = updater.target
    for marker in ('bad-migration', 'bad-live'):
        (root / 'backend/marker').write_text(marker)
        (root / 'frontend/index.html').write_text('broken frontend')
        updater.target = commit()
        updater.git('reset', '--hard', previous)
        updater.status.update(rolledBack=False)
        install(updater, marker, fail=True)
        assert updater.git('rev-parse', 'HEAD') == previous
        assert updater.compose('exec', '-T', 'postgres', 'psql', '-U', 'fixture', '-Atc', 'SELECT value FROM preserved') == 'keep-me'
        assert updater.compose('exec', '-T', 'postgres', 'psql', '-U', 'fixture', '-Atc', "SELECT count(*) FROM information_schema.columns WHERE table_name='preserved' AND column_name='rollback_column'") == '0'
        assert 'preserved-file' in updater.compose('exec', '-T', 'api', 'cat', '/app/uploads/example.txt')
        if marker == 'bad-live':
            assert updater.status.get('rolledBack'), updater.status
            assert not updater.status.get('recoveryRequired'), updater.status
        print('PASS: ' + marker + ' preserved original data, schema, files and Git', flush=True)
    (root / 'backend/marker').write_text('bad-resume')
    updater.target = commit()
    updater.git('reset', '--hard', previous)
    updater.status.update(rolledBack=False)
    install(updater, 'bad-resume', fail=True)
    assert updater.status.get('recoveryRequired') and updater.status.get('writesResumed'), updater.status
    assert not updater.status.get('rolledBack')
    assert updater.compose('exec', '-T', 'postgres', 'psql', '-U', 'fixture', '-Atc', "SELECT count(*) FROM preserved WHERE value='new-operation'") == '1'
    assert updater.git('rev-parse', 'HEAD') == updater.target
    print('PASS: after traffic resumes a failure never restores an old database', flush=True)
except Exception:
    for file in workspace.glob('*.log'):
        print(file.name, file.read_text()[-6000:])
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
