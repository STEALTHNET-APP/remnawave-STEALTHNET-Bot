#!/usr/bin/env bash
# Запуск миграции из старой панели (remnawave-STEALTHNET-Panel) в новую (STEALTHNET 3.0 Bot backend)
# Требуется: обе БД доступны (см. ниже как открыть порты).

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PANEL_ROOT="${OLD_PANEL_ROOT:-/opt/remnawave-STEALTHNET-Panel}"

# Загружаем только нужные переменные из .env старой панели (без source из-за пробелов в значениях)
if [[ -f "$PANEL_ROOT/.env" ]]; then
  echo "Загрузка OLD_DB из $PANEL_ROOT/.env"
  while IFS= read -r line; do
    [[ "$line" =~ ^# ]] && continue
    if [[ "$line" =~ ^DATABASE_URL=(.+) ]]; then
      url="${BASH_REMATCH[1]}"
      if [[ "$url" =~ postgresql://([^:]+):([^@]+)@([^:]+):([0-9]+)/([^?\s]+) ]]; then
        export OLD_DB_USER="${BASH_REMATCH[1]}"
        export OLD_DB_PASSWORD="${BASH_REMATCH[2]}"
        export OLD_DB_HOST="${BASH_REMATCH[3]}"
        export OLD_DB_PORT="${BASH_REMATCH[4]}"
        export OLD_DB_NAME="${BASH_REMATCH[5]}"
      fi
    fi
    if [[ "$line" =~ ^DB_HOST=(.+) ]]; then export OLD_DB_HOST="${BASH_REMATCH[1]}"; fi
    if [[ "$line" =~ ^DB_PORT=(.+) ]]; then export OLD_DB_PORT="${BASH_REMATCH[1]}"; fi
    if [[ "$line" =~ ^DB_NAME=(.+) ]]; then export OLD_DB_NAME="${BASH_REMATCH[1]}"; fi
    if [[ "$line" =~ ^DB_USER=(.+) ]]; then export OLD_DB_USER="${BASH_REMATCH[1]}"; fi
    if [[ "$line" =~ ^DB_PASSWORD=(.+) ]]; then export OLD_DB_PASSWORD="${BASH_REMATCH[1]}"; fi
  done < "$PANEL_ROOT/.env"
  # При запуске с хоста: если хост = postgres (Docker), подключаемся к localhost
  if [[ "$OLD_DB_HOST" == "postgres" ]]; then
    export OLD_DB_HOST="127.0.0.1"
    export OLD_DB_PORT="5432"
  fi
fi
export OLD_DB_HOST="${OLD_DB_HOST:-localhost}"
export OLD_DB_PORT="${OLD_DB_PORT:-5432}"
export OLD_DB_NAME="${OLD_DB_NAME:-stealthnet}"
export OLD_DB_USER="${OLD_DB_USER:-stealthnet}"
export OLD_DB_PASSWORD="${OLD_DB_PASSWORD:-stealthnet_password_change_me}"

# Загружаем .env бота (новая панель v3)
if [[ -f "$BOT_ROOT/.env" ]]; then
  echo "Загрузка NEW_DB из $BOT_ROOT/.env"
  export NEW_DB_HOST="${NEW_DB_HOST:-localhost}"
  export NEW_DB_PORT="${NEW_DB_PORT:-5433}"
  export NEW_DB_NAME="${NEW_DB_NAME:-${POSTGRES_DB:-stealthnet}}"
  export NEW_DB_USER="${NEW_DB_USER:-${POSTGRES_USER:-stealthnet}}"
  export NEW_DB_PASSWORD="${NEW_DB_PASSWORD:-${POSTGRES_PASSWORD:-stealthnet_change_me}}"
  # Читаем POSTGRES_* из .env без source (чтобы не перезаписать OLD_*)
  while IFS= read -r line; do
    if [[ "$line" =~ ^POSTGRES_DB= ]]; then NEW_DB_NAME="${line#*=}"; fi
    if [[ "$line" =~ ^POSTGRES_USER= ]]; then NEW_DB_USER="${line#*=}"; fi
    if [[ "$line" =~ ^POSTGRES_PASSWORD= ]]; then NEW_DB_PASSWORD="${line#*=}"; fi
  done < "$BOT_ROOT/.env"
else
  export NEW_DB_HOST="${NEW_DB_HOST:-localhost}"
  export NEW_DB_PORT="${NEW_DB_PORT:-5433}"
  export NEW_DB_NAME="${NEW_DB_NAME:-stealthnet}"
  export NEW_DB_USER="${NEW_DB_USER:-stealthnet}"
  export NEW_DB_PASSWORD="${NEW_DB_PASSWORD:-stealthnet_change_me}"
fi

echo "OLD_DB: $OLD_DB_HOST:$OLD_DB_PORT/$OLD_DB_NAME (user $OLD_DB_USER)"
echo "NEW_DB: $NEW_DB_HOST:$NEW_DB_PORT/$NEW_DB_NAME (user $NEW_DB_USER)"
echo ""

cd "$SCRIPT_DIR"
if ! command -v node &>/dev/null; then
  echo "Node.js не найден. Запуск миграции через Docker..."
  exec docker run --rm -v "$SCRIPT_DIR:/app" -w /app --network host \
    -e OLD_DB_HOST -e OLD_DB_PORT -e OLD_DB_NAME -e OLD_DB_USER -e OLD_DB_PASSWORD \
    -e NEW_DB_HOST -e NEW_DB_PORT -e NEW_DB_NAME -e NEW_DB_USER -e NEW_DB_PASSWORD \
    node:20-alpine sh -c "npm install && node migrate-from-old-panel.js"
fi
if [[ ! -d node_modules ]]; then
  echo "Установка зависимостей (pg)..."
  npm install
fi
node migrate-from-old-panel.js
