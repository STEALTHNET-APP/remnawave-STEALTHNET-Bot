#!/usr/bin/env bash
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo 'Запустите через sudo'; exit 1; }
project="$(cd "$(dirname "$0")/../.." && pwd)"
[[ "$project" =~ ^/[a-zA-Z0-9/_.-]+$ ]] || { echo 'Путь проекта должен быть без пробелов'; exit 1; }
command -v python3 >/dev/null
command -v systemctl >/dev/null
command -v git >/dev/null
docker compose version >/dev/null
python3 -c 'import sys; assert sys.version_info >= (3, 9), "Нужен Python 3.9+"'
install -d -m 700 /var/lib/stealthnet-updater /etc/stealthnet-updater /run/stealthnet-updater
if [ ! -e /etc/stealthnet-updater/config.json ]; then
  python3 - "$project" "${1:-}" <<'PY'
import json, os, sys
from pathlib import Path
os.umask(0o077)
external = sys.argv[2]
if external and (not Path(external).is_absolute() or external in ('/', '/var', '/var/www')):
    raise SystemExit('Укажите отдельную абсолютную папку фронтенда, например /var/www/stealthnet')
Path('/etc/stealthnet-updater/config.json').write_text(json.dumps({'project': sys.argv[1], 'externalFrontend': external or None}))
PY
fi
cat > /etc/systemd/system/stealthnet-updater.service <<EOF
[Unit]
Description=STEALTHNET update service
After=docker.service network-online.target
Wants=network-online.target
Requires=docker.service
[Service]
Type=simple
ExecStart=/usr/bin/python3 $project/scripts/updater/agent.py /etc/stealthnet-updater/config.json
Restart=on-failure
RestartSec=10
UMask=0077
RuntimeDirectory=stealthnet-updater
RuntimeDirectoryMode=0700
RuntimeDirectoryPreserve=yes
TimeoutStopSec=30
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now stealthnet-updater
systemctl restart stealthnet-updater
printf 'Служба установлена. Проверка обновлений включена, автоматическая установка выключена. Настройте её в панели: Настройки → Обновления.\n'
