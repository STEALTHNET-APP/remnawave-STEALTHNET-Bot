#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
cd "$(dirname "$0")/.."
test -f .env || { echo 'Configure .env before starting prebuilt images.' >&2; exit 1; }
command -v python3 >/dev/null
command -v flock >/dev/null
mkdir -p backups
exec 9>backups/prebuilt.lock
flock -n 9 || { echo 'Another prebuilt deployment is running.' >&2; exit 1; }
if [ -d /var/lib/stealthnet-updater ]; then
  exec 8>/var/lib/stealthnet-updater/operation.lock
  flock -n 8 || { echo 'The updater is running. Wait for it to finish.' >&2; exit 1; }
fi
set -a
source ./.env
set +a
revision=$(git rev-parse HEAD)
export STEALTHNET_IMAGE_TAG="sha-$revision"
export STEALTHNET_IMAGE_REPO="${STEALTHNET_IMAGE_REPO:-stealthnet-app}"
if [[ ! "$STEALTHNET_IMAGE_REPO" =~ ^[a-z0-9][a-z0-9._-]*$ ]]; then
  echo 'Invalid STEALTHNET_IMAGE_REPO.' >&2
  exit 1
fi
if [ -z "${COMPOSE_FILE:-}" ]; then
  COMPOSE_FILE=docker-compose.yml
  if [ -f docker-compose.override.yml ]; then COMPOSE_FILE+=:docker-compose.override.yml; fi
fi
export COMPOSE_FILE
export COMPOSE_PATH_SEPARATOR=:
case ":$COMPOSE_FILE:" in *:compose.ghcr.yaml:*) ;; *) COMPOSE_FILE+=:compose.ghcr.yaml ;; esac
compose=(docker compose)
if [ "${USE_BUILTIN_NGINX:-false}" = true ]; then
  compose+=(--profile builtin-nginx)
elif [ -z "${FRONTEND_OUT_DIR:-}" ] || [ ! -d "$FRONTEND_OUT_DIR" ]; then
  echo 'Set FRONTEND_OUT_DIR to the existing document root of your external nginx.' >&2
  exit 1
fi
"${compose[@]}" up --help | grep -q -- --wait-timeout
"${compose[@]}" config --quiet
for attempt in 1 2 3; do
  if "${compose[@]}" pull api bot frontend console postgres; then break; fi
  if [ "$attempt" = 3 ]; then echo 'Image download failed; running containers were not changed.' >&2; exit 1; fi
  sleep "$((attempt * 5))"
done
for image in api bot frontend console; do
  actual=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "ghcr.io/$STEALTHNET_IMAGE_REPO/stealthnet-$image:$STEALTHNET_IMAGE_TAG")
  if [ "$actual" != "$revision" ]; then
    echo "Image $image does not match the checked-out commit; deployment cancelled." >&2
    exit 1
  fi
done
backup="backups/prebuilt-$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -p "$backup"
cp .env "$backup/env"
"${compose[@]}" config > "$backup/compose.yaml"
"${compose[@]}" ps --all --format json > "$backup/containers.json"
if [ -n "$("${compose[@]}" ps -q postgres)" ]; then
  bash scripts/backup-db.sh "${compose[@]}"
fi
if [ -f docker-compose.override.yml ]; then cp docker-compose.override.yml "$backup/override.yml"; fi
export PREBUILT_BACKUP="$backup"
python3 - <<'PY'
import os
from pathlib import Path
p = Path('.env')
values = {k: os.environ[k] for k in ('COMPOSE_FILE', 'COMPOSE_PATH_SEPARATOR', 'STEALTHNET_IMAGE_TAG', 'STEALTHNET_IMAGE_REPO')}
lines = [line for line in p.read_text().splitlines() if line.split('=', 1)[0] not in values]
lines += [f'{key}={value}' for key, value in values.items()]
temp = p.with_name('.env.prebuilt')
temp.write_text('\n'.join(lines) + '\n')
temp.chmod(0o600)
temp.replace(p)
PY
trap 'echo "Deployment failed. Settings and previous containers: $PREBUILT_BACKUP. Check service logs before retrying; the database was not rolled back." >&2' ERR
"${compose[@]}" up -d --no-build --pull never --wait --wait-timeout 120 postgres
"${compose[@]}" up -d --no-build --pull never --no-deps --wait --wait-timeout 600 api
"${compose[@]}" up -d --no-build --pull never --no-deps --wait --wait-timeout 120 bot broadcast-worker console
"${compose[@]}" run --rm --no-deps --no-build frontend
if [ "${USE_BUILTIN_NGINX:-false}" = true ]; then
  "${compose[@]}" up -d --no-build --no-deps --wait --wait-timeout 120 nginx
else
  docker run --rm --entrypoint sh --mount "type=bind,source=$FRONTEND_OUT_DIR,target=/out" "ghcr.io/$STEALTHNET_IMAGE_REPO/stealthnet-frontend:$STEALTHNET_IMAGE_TAG" -ec 'cp -a /dist/. /out/'
fi
trap - ERR
"${compose[@]}" ps
printf 'Installed commit %s. Previous settings: %s\n' "$revision" "$backup"
