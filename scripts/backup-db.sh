#!/usr/bin/env bash
set -euo pipefail
umask 077
mkdir -p backups
file="backups/stealthnet_$(date -u +%Y%m%d_%H%M%S)_$$.sql"
tmp="$file.partial"
trap 'rm -f "$tmp"' EXIT
"$@" exec -T postgres sh -c 'exec pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$tmp"
test -s "$tmp"
mv "$tmp" "$file"
printf 'Backup created: %s\n' "$file"
