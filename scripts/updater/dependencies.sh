#!/usr/bin/env bash
set -euo pipefail

retry_packages() {
  local attempt
  for attempt in 1 2 3; do
    if "$@"; then return 0; fi
    if [ "$attempt" -lt 3 ]; then
      echo "Не удалось получить пакеты. Повтор $((attempt + 1))/3 через $((attempt * 5)) сек." >&2
      sleep "$((attempt * 5))"
    fi
  done
  echo 'Не удалось установить зависимости. Проверьте сеть и журнал пакетного менеджера выше. Панель не остановлена.' >&2
  return 1
}

ensure_dependencies() {
  local dependency
  local missing=()
  for dependency in make git python3 curl; do
    command -v "$dependency" >/dev/null 2>&1 || missing+=("$dependency")
  done
  if ! command -v python3 >/dev/null 2>&1 || ! python3 -c 'import ssl; p = ssl.get_default_verify_paths(); assert p.cafile or p.capath' >/dev/null 2>&1; then
    missing+=(ca-certificates)
  fi
  if [ "${#missing[@]}" -gt 0 ]; then
    echo "Не хватает зависимостей: ${missing[*]}"
    if [ "$(id -u)" != 0 ]; then
      echo 'Запустите sudo bash scripts/updater/dependencies.sh из папки проекта, затем повторите установку.' >&2
      return 1
    fi
    if command -v apt-get >/dev/null 2>&1; then
      retry_packages apt-get -o DPkg::Lock::Timeout=120 -o Acquire::Retries=2 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 -o APT::Update::Error-Mode=any update
      retry_packages env DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=120 -o Acquire::Retries=2 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 install -y --no-install-recommends "${missing[@]}"
    elif command -v dnf >/dev/null 2>&1; then
      retry_packages dnf --setopt=timeout=30 --setopt=retries=2 install -y "${missing[@]}"
    elif command -v yum >/dev/null 2>&1; then
      retry_packages yum --setopt=timeout=30 --setopt=retries=2 install -y "${missing[@]}"
    elif command -v apk >/dev/null 2>&1; then
      retry_packages apk --timeout 30 add --no-cache "${missing[@]}"
    else
      echo "Не найден поддерживаемый менеджер пакетов (apt-get, dnf, yum, apk). Установите вручную: ${missing[*]}" >&2
      return 1
    fi
  fi
  for dependency in make git python3 curl; do
    command -v "$dependency" >/dev/null 2>&1 || { echo "После установки не найден $dependency" >&2; return 1; }
  done
  python3 -c 'import ssl, sys; assert sys.version_info >= (3, 9), "Нужен Python 3.9+; обновите Python средствами своей ОС"; p = ssl.get_default_verify_paths(); assert p.cafile or p.capath, "Не найдено хранилище доверенных TLS-сертификатов"'
  echo 'Зависимости готовы: make, git, Python 3.9+, curl и TLS-сертификаты.'
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  ensure_dependencies
fi
