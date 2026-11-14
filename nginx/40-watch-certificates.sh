#!/bin/sh
set -eu

ssl_dir=${SSL_CERTIFICATE_DIR:-/etc/nginx/ssl}
poll_seconds=${SSL_CERTIFICATE_POLL_SECONDS:-60}

certificate_snapshot() {
    for pem in "$ssl_dir"/live/*/fullchain.pem "$ssl_dir"/live/*/privkey.pem; do
        [ -f "$pem" ] || continue
        cksum "$pem" || return 1
    done
}

initial_snapshot=$(certificate_snapshot) || initial_snapshot=

watch_certificates() {
    applied_snapshot=$initial_snapshot
    while sleep "$poll_seconds"; do
        current_snapshot=$(certificate_snapshot) || continue
        [ "$current_snapshot" != "$applied_snapshot" ] || continue

        if nginx -t && nginx -s reload; then
            applied_snapshot=$current_snapshot
            echo "[ssl-renewal] nginx reloaded after certificate change"
        else
            echo "[ssl-renewal] reload failed; retrying on the next check" >&2
        fi
    done
}

watch_certificates &
