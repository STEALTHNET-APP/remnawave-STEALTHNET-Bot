# STEALTHNET

VPN subscription management with a Telegram bot, client cabinet, Mini App and admin panel. Built with TypeScript, React, Node.js, PostgreSQL and Docker; integrates with Remnawave.

[Русский](docs/ru/README.md) · [中文](docs/cn/README.md) · [فارسی](docs/fa/README.md)

[Documentation](docs/README.md) · [Latest release](https://github.com/STEALTHNET-APP/remnawave-STEALTHNET-Bot/releases/latest) · [Changelog](CHANGELOG.md) · [Telegram](https://t.me/stealthnet_admin_panel)

## Start here

| Task | Guide |
| --- | --- |
| Install on a new server | [Installation and first launch](docs/getting-started/installation.md) |
| Update an existing installation | [Updates and recovery](docs/auto-update.md) |
| Configure the Telegram bot | [Menus, buttons and widgets](docs/bot/README.md) |
| Configure payments | [Payment providers](docs/payments/README.md) |
| Customize the client cabinet | [Design editor](docs/cabinet-design-editor.md) |
| Diagnose a problem | [Troubleshooting](docs/operations/troubleshooting.md) |
| Integrate another application | [External API v1](docs/API_DOCUMENTATION.md) |

The linked operator guides are currently in Russian. The [documentation index](docs/README.md) groups them by task. Installation and updates have separate instructions; do not rerun the installer to update a working service.

## Prebuilt images

The publication workflow builds multi-arch (`linux/amd64`, `linux/arm64`) images for new commits on main and release tags. After that workflow succeeds, an administrator can deploy them without compiling locally:

```bash
bash scripts/run-prebuilt.sh
```

The script downloads images for the checked-out commit, verifies that all four images match, backs up an existing database and preserves Compose overrides. Images are published as `sha-<full commit>` after the GitHub workflow completes. If any image is unavailable, the running installation is left intact. This is an opt-in server deployment mode; panel auto-updates currently support source builds only. See [installation](docs/getting-started/installation.md) for prerequisites and recovery. The installer still builds from source.


## What is included

- Tariffs, trials, subscriptions, renewals and device limits.
- Payment provider integrations, balance payments and provider-specific recurring payments and receipts.
- Configurable Telegram menus with a preview and compact layout. HTML widgets depend on Telegram availability; see [current limitations](docs/bot/widgets.md).
- Client cabinet and Mini App with configurable appearance.
- Client management, referrals, promo codes, analytics and support tickets.
- Backups, update management and diagnostic reports.

## Development

See [developer documentation](docs/development/README.md) for API references and [AGENTS.md](AGENTS.md) for source layout, implementation rules and verification commands. Deployment configuration lives in [docker-compose.yml](docker-compose.yml); environment setup is explained in [Configuration](docs/getting-started/configuration.md).

Historical implementation plans and validation reports are kept in the [development archive](docs/archive/README.md).

## Support and license

[Report a bug or request a feature](https://github.com/STEALTHNET-APP/remnawave-STEALTHNET-Bot/issues) · [Telegram channel](https://t.me/stealthnet_admin_panel)

Licensed under [GNU AGPL-3.0](LICENSE).
