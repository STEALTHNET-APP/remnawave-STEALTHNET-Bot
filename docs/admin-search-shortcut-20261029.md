# Admin search shortcut

The search palette uses physical KeyK, allowing Latin and Cyrillic layouts. Platform detection reads User-Agent Client Hints when available, then user agent and navigator.platform fallback. Mac/iOS use Meta+K; Windows/Linux/Android use Control+K. Modern and legacy admin headers display the corresponding label and aria-keyshortcuts.

The handler runs in capture phase, prevents the browser default, ignores IME composition and extra modifiers, and suppresses repeated toggles while a key is held. Header clicks dispatch a dedicated open-search event rather than fabricated keyboard input.

Validation: both production frontend builds pass. tests/search-shortcut.cjs covers platform detection, Latin/Cyrillic keys, modifiers and composition; git diff --check passes. On the deployed stand, macOS Meta+K opens search and focuses its input; repeating Meta+K closes it. Button opening and Escape also pass, with no browser console errors. Windows/Linux are covered by logic tests, not a physical Windows/Linux browser session.

Stand rollback: bash /var/backups/stealthnet-admin-shortcut-20261029/rollback-frontend.sh
