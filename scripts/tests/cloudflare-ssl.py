from pathlib import Path
import tempfile,subprocess,os,json,shutil
source=Path(__file__).resolve().parents[1]/'cloudflare-ssl.sh'
with tempfile.TemporaryDirectory() as tmp:
 root=Path(tmp);(root/'scripts').mkdir();shutil.copy2(source,root/'scripts/cloudflare-ssl.sh')
 (root/'docker-compose.yml').write_text('services: {}\n');(root/'.env').write_text('DOMAIN=panel.example.com\nSENTINEL=keep\n')
 (root/'token.ini').write_text('dns_cloudflare_api_token = dummy\n');(root/'bin').mkdir();log=root/'calls.jsonl'
 docker=root/'bin/docker';docker.write_text('''#!/usr/bin/env python3
import os,sys,json
with open(os.environ['CALLS'],'a') as f:f.write(json.dumps(sys.argv[1:])+'\\n')
if 'cat > "$1"' in sys.argv:sys.stdin.read()
if 'certonly' in sys.argv and os.environ.get('FAIL_CERT')=='1':sys.exit(1)
''');docker.chmod(0o755)
 env={**os.environ,'PATH':str(root/'bin')+':'+os.environ['PATH'],'CALLS':str(log)}
 def run(args,extra={}):return subprocess.run(['bash',str(root/'scripts/cloudflare-ssl.sh'),*args],env={**env,**extra},capture_output=True,text=True)
 args=['panel.example.com','a@example.com',str(root/'token.ini'),'example.com','*.example.com']
 res=run(['--dry-run',*args]);assert res.returncode==0,res.stderr
 calls=[json.loads(x) for x in log.read_text().splitlines()];issue=next(x for x in calls if 'certonly' in x)
 assert '*.example.com' in issue and '--dry-run' in issue
 assert 'CERTBOT_IMAGE' not in (root/'.env').read_text()
 assert not any('reload' in x for x in calls)
 log.write_text('');res=run(args,{'FAIL_CERT':'1'});assert res.returncode!=0
 assert 'CERTBOT_IMAGE' not in (root/'.env').read_text()
 calls=[json.loads(x) for x in log.read_text().splitlines()];assert any('rm -f "$1"' in x for x in calls)
 log.write_text('');res=run(args);assert res.returncode==0,res.stderr
 assert 'CERTBOT_IMAGE=certbot/dns-cloudflare:latest' in (root/'.env').read_text()
 assert 'SENTINEL=keep' in (root/'.env').read_text()
 calls=[json.loads(x) for x in log.read_text().splitlines()];assert any('reload' in x for x in calls)
 assert not any('rm -f "$1"' in x for x in calls)
 log.write_text('');res=run(['other.example.com',*args[1:]]);assert res.returncode!=0;assert log.read_text()==''
 res=run([args[0],args[1],args[2],';bad']);assert res.returncode!=0;assert log.read_text()==''
 print('PASS: DNS dry-run, literal wildcard, failure cleanup, persistent plugin, nginx reload, domain validation; Docker mocked')
