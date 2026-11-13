#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
DRY_RUN=false
if [[ ${1:-} == --dry-run ]]; then DRY_RUN=true; shift; fi
if [[ $# -lt 3 ]]; then
  echo 'Usage: bash scripts/cloudflare-ssl.sh [--dry-run] panel.example.com admin@example.com /root/cloudflare.ini [example.com "*.example.com"]' >&2
  exit 2
fi
DOMAIN=$1
EMAIL=$2
CREDENTIALS=$3
shift 3
[[ -f .env && -r "$CREDENTIALS" ]] || { echo 'Required: project .env and readable credentials file' >&2; exit 2; }
[[ $DOMAIN != \*.* && $EMAIL == *@*.* ]] || { echo 'Invalid panel domain or email' >&2; exit 2; }
DOMAINS=("$DOMAIN" "$@")
for host in "${DOMAINS[@]}"; do
  [[ $host =~ ^(\*\.)?[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}$ && $host != *..* ]] || { echo 'Invalid DNS name' >&2; exit 2; }
done
python3 - "$DOMAIN" <<'PY'
from pathlib import Path
import sys
lines=Path('.env').read_text().splitlines()
values=[line.split('=',1)[1].strip().strip('"\x27') for line in lines if line.startswith('DOMAIN=')]
if not values or values[-1]!=sys.argv[1]: raise SystemExit('Domain must match DOMAIN in project .env; nginx uses this certificate name')
PY
export CERTBOT_IMAGE=certbot/dns-cloudflare:latest
COMPOSE=(docker compose --profile builtin-nginx)
"${COMPOSE[@]}" config --quiet
REMOTE_CREDENTIALS="/etc/letsencrypt/cloudflare-${DOMAIN}-$(date +%s)-$$.ini"
KEEP_CREDENTIALS=false
cleanup() {
  if [[ $KEEP_CREDENTIALS == false ]]; then
    "${COMPOSE[@]}" run --rm --no-deps -T --entrypoint sh certbot -c 'rm -f "$1"' sh "$REMOTE_CREDENTIALS" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT
"${COMPOSE[@]}" run --rm --no-deps -T --entrypoint sh certbot -c 'umask 077; cat > "$1"' sh "$REMOTE_CREDENTIALS" < "$CREDENTIALS"
ARGS=(certonly --non-interactive --agree-tos --email "$EMAIL" --dns-cloudflare --dns-cloudflare-credentials "$REMOTE_CREDENTIALS" --dns-cloudflare-propagation-seconds 60 --cert-name "$DOMAIN")
for host in "${DOMAINS[@]}"; do ARGS+=(-d "$host"); done
if [[ $DRY_RUN == true ]]; then ARGS+=(--dry-run); else ARGS+=(--force-renewal); fi
"${COMPOSE[@]}" run --rm --no-deps -T --entrypoint certbot certbot "${ARGS[@]}"
if [[ $DRY_RUN == true ]]; then echo 'DNS challenge check passed; production certificate unchanged'; exit 0; fi
KEEP_CREDENTIALS=true
python3 - <<'PY'
from pathlib import Path
import os,tempfile
p=Path('.env');data=p.read_text();lines=data.splitlines()
lines=[line for line in lines if not line.startswith('CERTBOT_IMAGE=')]
lines.append('CERTBOT_IMAGE=certbot/dns-cloudflare:latest')
fd,name=tempfile.mkstemp(prefix='.env-',dir='.')
try:
 os.fchmod(fd,p.stat().st_mode & 0o777)
 with os.fdopen(fd,'w') as f:f.write('\n'.join(lines)+'\n')
 os.replace(name,p)
finally:
 if os.path.exists(name):os.unlink(name)
PY
"${COMPOSE[@]}" up -d --no-deps certbot
"${COMPOSE[@]}" exec -T nginx nginx -t
"${COMPOSE[@]}" exec -T nginx nginx -s reload
echo 'Cloudflare certificate installed; DNS credentials retained in the private certbot volume for renewal'
