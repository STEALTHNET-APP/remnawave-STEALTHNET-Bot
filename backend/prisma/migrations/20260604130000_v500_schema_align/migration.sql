-- ─── v5.0.0: выравнивание схемы с schema.prisma ──────────────────────────────
--
-- v5-база была собрана из инсталляции, чьи `schema.prisma` ушёл вперёд от
-- миграций. Эта миграция накатывает недостающий DDL так, чтобы на любом состоянии
-- (свежая инсталляция / прод сразу с архива / прод с частично применёнными
-- изменениями) результат был идентичен. Все шаги идемпотентны.

-- 1) auto_broadcast_logs.expire_at_snapshot — TIMESTAMP(3), nullable.
ALTER TABLE "auto_broadcast_logs" ADD COLUMN IF NOT EXISTS "expire_at_snapshot" TIMESTAMP(3);

-- 2) Индекс под новый snapshot (используется dedup-логикой broadcast_worker).
CREATE INDEX IF NOT EXISTS "auto_broadcast_logs_rule_id_subscription_id_expire_at_snaps_idx"
  ON "auto_broadcast_logs"("rule_id", "subscription_id", "expire_at_snapshot");

-- 3) auto_broadcast_rules.event_driven — флаг event-driven рассылок (after_registration etc).
ALTER TABLE "auto_broadcast_rules" ADD COLUMN IF NOT EXISTS "event_driven" BOOLEAN NOT NULL DEFAULT false;

-- 4) auto_renew_notifications.updated_at — снять DEFAULT (Prisma управляет @updatedAt).
ALTER TABLE "auto_renew_notifications" ALTER COLUMN "updated_at" DROP DEFAULT;

-- 5) withdrawal_requests.updated_at — то же.
ALTER TABLE "withdrawal_requests" ALTER COLUMN "updated_at" DROP DEFAULT;

-- 6) Переименовать FK с legacy-имени "secondary_subscriptions_*" на "subscriptions_*"
--    (таблица переименована в unify_subscriptions, но имена FK остались старые).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'secondary_subscriptions_gifted_to_client_id_fkey')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_gifted_to_client_id_fkey') THEN
    ALTER TABLE "subscriptions" RENAME CONSTRAINT "secondary_subscriptions_gifted_to_client_id_fkey" TO "subscriptions_gifted_to_client_id_fkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'secondary_subscriptions_owner_id_fkey')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_owner_id_fkey') THEN
    ALTER TABLE "subscriptions" RENAME CONSTRAINT "secondary_subscriptions_owner_id_fkey" TO "subscriptions_owner_id_fkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'secondary_subscriptions_tariff_id_fkey')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_tariff_id_fkey') THEN
    ALTER TABLE "subscriptions" RENAME CONSTRAINT "secondary_subscriptions_tariff_id_fkey" TO "subscriptions_tariff_id_fkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'secondary_subscriptions_trial_id_fkey')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_trial_id_fkey') THEN
    ALTER TABLE "subscriptions" RENAME CONSTRAINT "secondary_subscriptions_trial_id_fkey" TO "subscriptions_trial_id_fkey";
  END IF;
END $$;

-- 7) Drop+re-add FK с обновлённым ON DELETE/UPDATE поведением (никаких изменений
--    в данных — только в правилах ограничения). Делаем через DO для идемпотентности.
DO $$
BEGIN
  -- payments_subscription_id_fkey: ON DELETE SET NULL ON UPDATE CASCADE
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_subscription_id_fkey') THEN
    ALTER TABLE "payments" DROP CONSTRAINT "payments_subscription_id_fkey";
  END IF;
  ALTER TABLE "payments"
    ADD CONSTRAINT "payments_subscription_id_fkey"
    FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

  -- auto_broadcast_rules_promo_code_id_fkey
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_broadcast_rules_promo_code_id_fkey') THEN
    ALTER TABLE "auto_broadcast_rules" DROP CONSTRAINT "auto_broadcast_rules_promo_code_id_fkey";
  END IF;
  ALTER TABLE "auto_broadcast_rules"
    ADD CONSTRAINT "auto_broadcast_rules_promo_code_id_fkey"
    FOREIGN KEY ("promo_code_id") REFERENCES "promo_codes"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

  -- subscriptions_auto_renew_tariff_id_fkey
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_auto_renew_tariff_id_fkey') THEN
    ALTER TABLE "subscriptions" DROP CONSTRAINT "subscriptions_auto_renew_tariff_id_fkey";
  END IF;
  ALTER TABLE "subscriptions"
    ADD CONSTRAINT "subscriptions_auto_renew_tariff_id_fkey"
    FOREIGN KEY ("auto_renew_tariff_id") REFERENCES "tariffs"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
END $$;
