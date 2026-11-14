-- dedup-ключ для конструктора уведомлений у root.
-- Аналогичен secondary_subscriptions.last_notified_key.
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "last_arn_notified_key" TEXT;
