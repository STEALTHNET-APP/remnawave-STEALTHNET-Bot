#!/bin/sh
set -u
renewal_dir=${CERTBOT_RENEWAL_DIR:-/etc/letsencrypt/renewal}
result=0
found=0
for config in "$renewal_dir"/*.conf; do
    [ -f "$config" ] || continue
    found=1
    name=${config##*/}
    name=${name%.conf}
    if grep -Eq '^[[:space:]]*authenticator[[:space:]]*=[[:space:]]*standalone[[:space:]]*$' "$config"; then
        certbot renew --non-interactive --cert-name "$name" --webroot --webroot-path /var/www/certbot "$@" || result=1
    else
        certbot renew --non-interactive --cert-name "$name" "$@" || result=1
    fi
done
if [ "$found" = 0 ]; then
    certbot renew --non-interactive "$@" || result=1
fi
exit "$result"
