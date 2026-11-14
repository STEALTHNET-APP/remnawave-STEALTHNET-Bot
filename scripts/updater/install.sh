#!/usr/bin/env bash
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo 'Запустите через sudo'; exit 1; }
project="$(cd "$(dirname "$0")/../.." && pwd)"
[[ "$project" =~ ^/[a-zA-Z0-9/_.-]+$ ]] || { echo 'Путь проекта должен быть без пробелов'; exit 1; }
command -v systemctl >/dev/null || { echo 'Для службы обновления нужен Linux с systemd'; exit 1; }
[ -d /run/systemd/system ] || { echo 'systemd не запущен. Службу обновления нужно устанавливать на хосте, а не внутри контейнера.'; exit 1; }
bash "$project/scripts/updater/dependencies.sh"
python_bin="$(command -v python3)"
"$python_bin" "$project/scripts/updater/reliability.py" "$project"
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
ExecStart=$python_bin $project/scripts/updater/agent.py /etc/stealthnet-updater/config.json
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
printf 'Служба установлена. Существующие настройки и расписание сохранены. При первой установке автоматическая установка выключена. Настройте её в панели: Настройки → Обновления.\n'
