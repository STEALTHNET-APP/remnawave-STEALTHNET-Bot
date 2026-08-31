-- ── Платежи: статусы и последние 20 транзакций ──────────────────
-- Использование:
--   docker compose exec -T postgres psql -U stealthnet -d stealthnet -f /tmp/q.sql
--   или с локального хоста (если docker-compose.override.yml включён):
--   psql -h 127.0.0.1 -U stealthnet -d stealthnet -f scripts/sql/payments-status.sql

\echo '=== Сводка по статусам платежей за 24 часа ==='
SELECT
  provider,
  status,
  COUNT(*)         AS cnt,
  SUM(amount)::int AS total_amount
FROM payments
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY provider, status
ORDER BY provider, status;

\echo ''
\echo '=== Последние 20 транзакций ==='
SELECT
  id,
  provider,
  status,
  amount,
  currency,
  to_char(created_at, 'YYYY-MM-DD HH24:MI') AS created,
  CASE WHEN paid_at IS NULL THEN '—'
       ELSE to_char(paid_at, 'YYYY-MM-DD HH24:MI') END AS paid
FROM payments
ORDER BY created_at DESC
LIMIT 20;

\echo ''
\echo '=== PENDING-платежи старше 1 часа (потенциально зависшие) ==='
SELECT
  id,
  provider,
  amount,
  currency,
  to_char(created_at, 'YYYY-MM-DD HH24:MI') AS created,
  EXTRACT(EPOCH FROM (NOW() - created_at)) / 60 AS age_min
FROM payments
WHERE status = 'PENDING'
  AND created_at < NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC;
