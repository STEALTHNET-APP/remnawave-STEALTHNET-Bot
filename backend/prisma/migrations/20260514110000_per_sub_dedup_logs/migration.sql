-- T-per-sub-dedup
-- Раньше дедуп авторассылки шёл по (ruleId, clientId) с cooldown 30 дней — это
-- блокировало повторные отправки правил типа subscription_ending_minutes/etc для
-- РАЗНЫХ подписок одного клиента. Если у юзера 5 подписок, и каждая истекает в
-- разное время — он получал уведомление только ОДИН раз за 30 дней (плохо).
--
-- Теперь логи хранят subscription_id. Дедуп для триггеров subscription_* идёт
-- по (rule_id, subscription_id). Для остальных триггеров — по-прежнему (rule_id, client_id).

ALTER TABLE "auto_broadcast_logs"
  ADD COLUMN IF NOT EXISTS "subscription_id" TEXT;

CREATE INDEX IF NOT EXISTS "auto_broadcast_logs_rule_id_subscription_id_idx"
  ON "auto_broadcast_logs" ("rule_id", "subscription_id");
