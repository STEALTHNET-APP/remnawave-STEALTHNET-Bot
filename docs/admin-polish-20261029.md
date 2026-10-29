# Admin interface corrections — 2026-10-29

The stand frontend has been updated without changing backend services or client records. GitHub was not pushed.

## Changes

- Corrected the shared tab container height and wrapping, including proxy and client dialogs.
- Replaced the conflicting sticky utility combination on activity, bot text and email template sidebars. Their top edges now align with the editor panel.
- Added a shared asynchronous Radix dialog host for admin confirmations, prompts and messages, including marketplace and landing editor actions. Cancel/Escape return false or null; a second simultaneous confirmation fails closed. Browser beforeunload protection remains for actual page unloads with unsaved edits.
- Updated global search with a modal focus boundary, accessible result selection, keyboard hints, stale request protection and mobile sizing.
- Removed accidental muted header backgrounds from settings and restored missing Wallet, Link and Shield icons.

## Verification

Both the main frontend and stand-compatible frontend pass TypeScript and production builds. The async dialog behavior test passes, including canceled destructive actions, acceptance, duplicate suppression and prompt cancellation. Navigation, appearance policy and PWA update tests passed; git diff --check passed.

On the deployed stand at 1440 × 960: activity, email template and bot text sidebar/panel pairs all begin at y=210. Proxy tabs fit their container; the client editing dialog has no horizontal overflow. Settings title/card header backgrounds are transparent and the Happ/antibot icons render. The console-access confirmation was opened and canceled using both Escape and Cancel; no access regeneration was submitted.

Search returns results and ArrowDown updates the active result. Its desktop width is 672px, centered at x=384 in a 1440px viewport. At 390 × 844 it occupies x=12…378; document width remains 390px. Mobile proxy actions and tabs fit without horizontal scrolling. Destructive acceptance and real payments/messages were not exercised on stand data.

## Rollback

Verified pre-change frontend snapshot:
`/var/backups/stealthnet-admin-polish-20261029/frontend-dist.tar.gz`

Restore:
`bash /var/backups/stealthnet-admin-polish-20261029/rollback-frontend.sh`

The directory also contains the deployed frontend/source archives. Browser users may need to apply the PWA update after deployment or rollback.
