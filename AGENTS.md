# Repository guide

Use this file to locate code, then read the implementation and tests for the behavior being changed. Open pull requests describe proposed changes, not guarantees about the current checkout. Package manifests, the Prisma schema, and deployment files are the source of truth for versions and configuration.

## Applications and deployment

| Component | Source | Responsibility |
| --- | --- | --- |
| API | `backend/src/index.ts`, `backend/src/modules/` | Express API, authentication, billing, subscriptions, integrations and scheduled jobs |
| Telegram bot | `bot/src/index.ts`, `bot/src/api.ts`, `bot/src/keyboard.ts` | grammY bot, Telegram menus and requests to the API |
| Web UI | `frontend/src/` | React/Vite admin interface, client cabinet and Telegram Mini App |
| Broadcast worker | `backend/src/worker/broadcast-worker.ts` | Separate process that polls broadcast jobs in the database |
| SSH console | `console/main.go` | Go/Bubble Tea read-only SSH dashboard; it does not serve the React application |
| Database | `backend/prisma/schema.prisma` | PostgreSQL data model managed with Prisma |
| Update agent | `scripts/updater/` | Host-side update and backup workflow |

`docker-compose.yml` defines the services and the `stealthnet` bridge network. The frontend service copies its built assets into a shared volume and exits. Nginx serves those assets and forwards API requests; the API also reads the frontend bundle for the branded SPA shell. The built-in nginx and certbot services use the `builtin-nginx` profile. The SSH console uses host networking and obtains its configuration from the API.

Read the actual Compose file and deployment overrides before changing ports or volumes. Do not infer exposure from comments: the repository currently publishes API port 5000 on `0.0.0.0`. PostgreSQL has no published host port in the base Compose file. Local deployment settings may differ.

Node packages require Node.js 22 or newer. Install and build each package in its own directory. The console is a separate Go module.

## Data model and subscription behavior

Read `backend/prisma/schema.prisma` before writing queries or migrations.

- `Client` represents the panel account. Its ID uses Prisma's `cuid()` default; `telegramId` is a nullable unique string.
- `Subscription` belongs to a client and stores the subscription index, optional Remna UUID, tariff or trial association, gift state and cached VPN data.
- Index 0 is the primary subscription when present. New or migrated accounts can lack this record. Do not assume every client already has one.
- `Client.remnawaveUuid` is a legacy primary-profile reference. Check it together with the subscription records when repairing migrated data.
- A null `tariffId` does not prove that a subscription is empty or disposable. Imported subscriptions and standalone trials require separate handling.
- Multiple VPN profiles with the same Telegram ID can represent legitimate separate subscriptions. Do not merge or delete them solely because the Telegram ID matches.
- `Payment` records payment details and purchase metadata. Receiving money and successfully delivering the purchased service are distinct steps.
- `SystemSetting` holds runtime settings loaded by `getSystemConfig()` in `backend/src/modules/client/client.service.ts`.

Follow the purchase intent in `backend/src/modules/tariff/tariff-activation.service.ts`: an explicit target requests a renewal; another purchase may create a new subscription. Also inspect single-subscription mode, trial conversion, gifts and additional devices before changing this behavior. Do not unconditionally reuse slot 0.

## Backend navigation

Paths in this table are relative to `backend/src/modules/`.

| Area | Modules |
| --- | --- |
| Remna integration and synchronization | `remna/`, `sync/` |
| Subscriptions, purchases and trials | `subscription/`, `tariff/`, `trial/`, `gift/`, `extra-options/` |
| Other VPN products | `singbox/`, `proxy/`, `amnezia-web/` |
| Admin and client access | `admin/`, `admin-permissions/`, `auth/`, `client/`, `api-keys/` |
| Payments and renewals | `payment/`, `payment-actions/`, `payment-redirect/` and the provider-specific directories |
| Payment/event intake | `webhooks/`, `webhook-inbox/` and provider routes |
| Marketing | `referral/`, `promo-code/`, `promo-bulk/`, `contest/`, `roulette/` |
| Messaging and support | `broadcast/`, `auto-broadcast/`, `ticket/`, `notification/`, `mail/`, `bot-messages/`, `bot-conversations/` |
| Operations | `backup/`, `diagnostics/`, `update/`, `server/`, `audit/` |

Provider implementations include `yookassa/`, `yoomoney/`, `platega/`, `cryptopay/`, `telegram-stars/`, `heleket/`, `lava/`, `lavatop/`, `overpay/`, `rollypay/` and `paritypay/`. Inspect the route mounting in the API entry point as well as the provider service; webhook handling is not necessarily contained in one directory.

For scheduled work, inspect the scheduler registration and the called service together. Useful starting points include `payment/auto-renew.cron.ts`, `sync/sync.scheduler.ts`, `referral/referral-rewards.scheduler.ts` and `gift/gift-expiry.cron.ts`. Frequencies and enabled conditions belong to the implementation and runtime settings; do not assume a fixed schedule from this document.

## Frontend and bot navigation

Admin pages live in `frontend/src/pages/`; client pages are in `frontend/src/pages/cabinet/`. Shared UI and behavior live in `frontend/src/components/`, API types and calls in `frontend/src/lib/api.ts`, and translations in `frontend/src/i18n/locales/`.

Check `frontend/src/lib/use-cabinet-design.ts` and the relevant page wrapper for Classic, Aurora and Stealth routing. A component's presence on disk does not prove that a route currently renders it. Test browser and Telegram Mini App behavior separately where it matters.

PWA update behavior is in `frontend/src/components/pwa/pwa-update-prompt.tsx`. Preserve unsaved input and in-progress payment flows when changing reload behavior.

Bot callbacks are handled in `bot/src/index.ts`, with keyboards in `bot/src/keyboard.ts` and API calls in `bot/src/api.ts`. Read existing callback handlers before choosing a namespace. Menu buttons may open inline Telegram flows or cabinet routes depending on settings.

## Rules for changes involving money or VPN state

1. Follow the payment provider's current official documentation and existing verification code. Do not substitute a generic signature algorithm for the provider's required one.
2. Authenticate and validate payment notifications independently of VPN availability. Do not place a blanket Remna availability guard in front of a bank webhook. Follow the provider's acknowledgement and retry contract after recording the verified event durably.
3. Keep payment receipt, fulfillment success and retry state distinct. Do not tell a user that access has been issued merely because money arrived.
4. A timeout or server error does not mean a VPN user is absent. An operation may have succeeded remotely before the response was lost. Reconcile uncertain results before creating another user or applying another renewal.
5. Retry processing must claim work safely and prevent duplicate effects across overlapping runs, multiple processes and repeated webhooks. A read followed by an unrelated update is not an exclusive claim.
6. Remna outages must not automatically disable independent Sing-box, proxy or balance operations.
7. Preserve existing subscription mappings until a migration has successfully reconciled each affected subscription. Back up data before destructive migration work.
8. Keep credentials out of logs, committed files and unmasked API responses.

These are review requirements, not a claim that every current code path already enforces them. Verify the paths being changed. Do not assume a circuit breaker or pending-activation worker exists merely because an open PR proposes one.

## Adding settings

Inspect all parts of an existing similar setting:

- The settings keys, defaults, loading and cache invalidation in `backend/src/modules/client/client.service.ts`.
- Validation, persistence, permissions and response masking in `backend/src/modules/admin/admin.routes.ts`.
- The public config response, if clients need a safe public value.
- API types in `frontend/src/lib/api.ts` and the relevant admin controls.
- Bot configuration or worker processes that consume the value.

A setting stored in PostgreSQL does not automatically reconfigure another running process. Check the lifetime of cached configuration and long-running connections explicitly.

## Build and verification

From the repository root, with dependencies installed:

```bash
npm --prefix backend run db:generate
npm --prefix backend run build
npm --prefix bot run build
npm --prefix frontend run build
```

Run focused tests from `backend/tests/` or `frontend/tests/` according to their setup requirements. There is no universal test command for every script: files include Node tests, TypeScript scripts, Python helpers and database integration tests. Read the selected test before running it. Database tests require an isolated test database; browser tests may require Playwright and downloaded browsers. Never run fixture cleanup against an operator's database.

For deployment validation, inspect [Makefile](Makefile), [docker-compose.yml](docker-compose.yml), [installation instructions](README.md), [update documentation](docs/auto-update.md) and the appropriate feature guide in [docs](docs/). Building images and restarting a deployment are separate actions. Keep local configuration and persistent volumes intact.

## Operator instructions

Write installation, update and recovery instructions for a nontechnical panel owner. Explain where to run each command, what to copy, what success looks like, how long to wait, and what to do on failure. Distinguish starting a job from its successful completion. Prefer a small number of clearly named paths over a wall of alternatives. Never assume Git, SSH or Docker knowledge. Preserve local configuration and backups; do not suggest destructive reset or cleanup as a routine update step. Keep new implementation code free of explanatory inline comments, per the project owner's preference.
