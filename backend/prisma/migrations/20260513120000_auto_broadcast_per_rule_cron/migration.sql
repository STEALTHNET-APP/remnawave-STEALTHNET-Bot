-- индивидуальное расписание каждого правила авто-рассылки.
-- Раньше был один глобальный cron (autoBroadcastCron), все правила дёргались одновременно.
-- Теперь каждое правило имеет свой cron_expression. Если null — scheduler берёт дефолт по типу
-- триггера (см. auto-broadcast-scheduler.ts).

ALTER TABLE "auto_broadcast_rules"
  ADD COLUMN IF NOT EXISTS "cron_expression" TEXT,
  ADD COLUMN IF NOT EXISTS "last_run_at" TIMESTAMP(3);
