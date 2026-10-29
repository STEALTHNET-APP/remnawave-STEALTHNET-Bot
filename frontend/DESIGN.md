# Client cabinet design

The client cabinet helps a VPN subscriber connect, renew access and manage their account. It is a working account interface rather than a marketing landing page. Russian and English text, ordinary browsers and narrow phone screens must remain usable.

## Direction

Use neutral warm white and charcoal surfaces, Onest with Cyrillic support, thin separators, and one configured brand accent. Onest is self-hosted under public/fonts; its OFL license ships alongside it. Preserve the installation's chosen accent. Use colour for state or an important action, not to decorate every section.

Use the subscription as the main object: plan, expiry, devices, traffic, then connection. Do not call an active subscription a connected VPN. Unknown provider state must show an error and retry rather than an empty subscription or a successful status.

Give each page the structure its task needs. Subscription records, plan comparisons, a payment ledger and account settings should not all be interchangeable card grids. Use a card only when it groups an object or form. Avoid nested cards, decorative icon tiles, gradient text, glowing backgrounds, oversized radii, looping ornament and invented popularity badges.

## Components

The classic cabinet owns its tokens through body[data-cabinet-ui="minimal"]. Do not change admin or other Mini App themes globally. Keep portal dialogs within the same visual language. Onest body text uses normal and medium weights; headings use medium weight and modest size contrast. Values use tabular numerals where useful.

Primary actions are solid; secondary actions have an outline or underline. Selected options must be discernible by their border as well as colour. Keep keyboard focus visible. Use meaningful labels for icon buttons. Honour reduced motion. On phones, keep controls clear of the bottom navigation and Telegram safe areas. The support launcher belongs in the toolbar so it does not cover payment controls.

## Behaviour boundaries

Retain API contracts, payment providers, subscription identifiers, consent checks, trial eligibility, device limits, balance and renewal calculations. Never treat a screenshot as proof that a real payment or VPN connection works. Test visual states using the isolated QA backend before deploying.

## Review

Inspect light and dark themes, 390px mobile and desktop layouts. Check the dashboard, tariffs, pre-payment configuration, balance, profile, referrals, help, gifts and authentication. Check loading, empty, expired and provider-unavailable states. Do not publish until the user approves the new design.
