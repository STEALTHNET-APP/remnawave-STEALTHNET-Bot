-- ── Клиенты: активность и состояние ─────────────────────────────
\echo '=== Сводка по клиентам ==='
SELECT
  COUNT(*)                                                        AS total,
  COUNT(*) FILTER (WHERE is_blocked = false)                      AS active,
  COUNT(*) FILTER (WHERE current_tariff_id IS NOT NULL)           AS with_tariff,
  COUNT(*) FILTER (WHERE auto_renew_enabled = true)               AS auto_renew_on,
  COUNT(*) FILTER (WHERE trial_used = true)                       AS trial_used,
  COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') AS new_24h,
  COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')   AS new_7d
FROM clients;

\echo ''
\echo '=== Топ-10 клиентов по балансу ==='
SELECT
  id,
  COALESCE(NULLIF(telegram_username, ''), telegram_id, email, 'no-id') AS who,
  balance,
  current_tariff_id,
  auto_renew_enabled,
  to_char(created_at, 'YYYY-MM-DD') AS registered
FROM clients
ORDER BY balance DESC NULLS LAST
LIMIT 10;

\echo ''
\echo '=== Новые регистрации за 24 часа ==='
SELECT
  id,
  COALESCE(NULLIF(telegram_username, ''), telegram_id, email, 'no-id') AS who,
  trial_used,
  to_char(created_at, 'YYYY-MM-DD HH24:MI') AS created
FROM clients
WHERE created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC
LIMIT 20;
