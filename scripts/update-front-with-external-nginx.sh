#!/usr/bin/env bash
set -euo pipefail
printf 'Copying frontend into /var/www/stealthnet...\n'
mkdir -p /var/www/stealthnet
docker compose cp frontend:/dist/. /var/www/stealthnet/
index_tmp=$(mktemp /var/www/stealthnet/.index.XXXXXX)
manifest_tmp=$(mktemp /var/www/stealthnet/.manifest.XXXXXX)
trap 'rm -f "$index_tmp" "$manifest_tmp"' EXIT
curl --retry 30 --retry-delay 2 --retry-connrefused --max-time 10 -fsS http://127.0.0.1:5000/_spa -o "$index_tmp"
curl --retry 30 --retry-delay 2 --retry-connrefused --max-time 10 -fsS http://127.0.0.1:5000/api/public/manifest.webmanifest -o "$manifest_tmp"
test -s "$index_tmp"
test -s "$manifest_tmp"
chmod 644 "$index_tmp" "$manifest_tmp"
mv "$index_tmp" /var/www/stealthnet/index.html
mv "$manifest_tmp" /var/www/stealthnet/manifest.webmanifest
printf 'Frontend copied into /var/www/stealthnet/\n'
