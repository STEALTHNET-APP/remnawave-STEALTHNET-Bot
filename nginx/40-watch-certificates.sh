#!/bin/sh
# The official nginx entrypoint runs this before starting nginx as PID 1.
# Watch certificate contents, including Certbot's rotating symlinks. No Docker
# socket, writable certificate volume or cross-container signals are required.
set -eu

ssl_dir=${SSL_CERTIFICATE_DIR:-/etc/nginx/ssl}
poll_seconds=${SSL_CERTIFICATE_POLL_SECONDS:-60}

certificate_snapshot() {
    for pem in "$ssl_dir"/live/*/fullchain.pem "$ssl_dir"/live/*/privkey.pem; do
        [ -f "$pem" ] || continue
        cksum "$pem" || return 1
    done
}

# Take the baseline BEFORE the entrypoint starts nginx, so a renewal during
# startup cannot silently become the baseline while nginx loads the old files.
initial_snapshot=$(certificate_snapshot) || initial_snapshot=

watch_certificates() {
    applied_snapshot=$initial_snapshot
    while sleep "$poll_seconds"; do
        current_snapshot=$(certificate_snapshot) || continue
        [ "$current_snapshot" != "$applied_snapshot" ] || continue

        # Keep retrying on a bad/incomplete certificate or a failed reload.
        # Existing workers continue serving their previously loaded certificate.
        if nginx -t && nginx -s reload; then
            applied_snapshot=$current_snapshot
            echo "[ssl-renewal] nginx reloaded after certificate change"
        else
            echo "[ssl-renewal] reload failed; retrying on the next check" >&2
        fi
    done
}

# Do not block nginx startup. Container shutdown also stops this watcher.
watch_certificates &
