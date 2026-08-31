-- ── Состояние Prisma миграций ───────────────────────────────────
\echo '=== Применённые миграции ==='
SELECT
  migration_name,
  to_char(finished_at, 'YYYY-MM-DD HH24:MI') AS finished,
  CASE WHEN logs IS NULL THEN '—' ELSE 'есть лог' END AS log_state,
  CASE WHEN rolled_back_at IS NULL THEN 'OK' ELSE 'ROLLED BACK' END AS state
FROM _prisma_migrations
ORDER BY finished_at DESC NULLS FIRST
LIMIT 30;

\echo ''
\echo '=== Незавершённые миграции (если есть — runtime упадёт) ==='
SELECT migration_name, started_at, finished_at, rolled_back_at
FROM _prisma_migrations
WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL;
