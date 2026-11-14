-- УНИФИКАЦИЯ подписок в одну таблицу.
-- До: Client.{remnawaveUuid,currentTariffId,autoRenew*} (primary) + secondary_subscriptions (доп.).
-- После: ВСЁ в одной таблице subscriptions. subscription_index=0 = главная.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Переименование таблицы secondary_subscriptions → subscriptions
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE "secondary_subscriptions" RENAME TO "subscriptions";

-- Переименовать индексы (Postgres делает это автоматически с CONSTRAINT, но имена индексов могут отличаться)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'secondary_subscriptions_pkey') THEN
    ALTER INDEX "secondary_subscriptions_pkey" RENAME TO "subscriptions_pkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'secondary_subscriptions_owner_id_subscription_index_key') THEN
    ALTER INDEX "secondary_subscriptions_owner_id_subscription_index_key" RENAME TO "subscriptions_owner_id_subscription_index_key";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'secondary_subscriptions_owner_id_idx') THEN
    ALTER INDEX "secondary_subscriptions_owner_id_idx" RENAME TO "subscriptions_owner_id_idx";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'secondary_subscriptions_remnawave_uuid_idx') THEN
    ALTER INDEX "secondary_subscriptions_remnawave_uuid_idx" RENAME TO "subscriptions_remnawave_uuid_idx";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'secondary_subscriptions_gift_status_idx') THEN
    ALTER INDEX "secondary_subscriptions_gift_status_idx" RENAME TO "subscriptions_gift_status_idx";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'secondary_subscriptions_trial_id_idx') THEN
    ALTER INDEX "secondary_subscriptions_trial_id_idx" RENAME TO "subscriptions_trial_id_idx";
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Добавить новые колонки (переезжают от Client.autoRenew*)
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE "subscriptions"
  ADD COLUMN IF NOT EXISTS "auto_renew_tariff_id" TEXT,
  ADD COLUMN IF NOT EXISTS "auto_renew_price_option_id" TEXT,
  ADD COLUMN IF NOT EXISTS "auto_renew_extra_devices" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "auto_renew_retry_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "auto_renew_notified_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "auto_renew_promo_code" TEXT,
  ADD COLUMN IF NOT EXISTS "current_price_per_day" DOUBLE PRECISION;

-- Индекс для cron автопродления (быстрый перебор включённых)
CREATE INDEX IF NOT EXISTS "subscriptions_auto_renew_enabled_idx" ON "subscriptions" ("auto_renew_enabled");

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Foreign key для auto_renew_tariff_id → tariffs(id)
-- ─────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'subscriptions_auto_renew_tariff_id_fkey'
  ) THEN
    ALTER TABLE "subscriptions"
      ADD CONSTRAINT "subscriptions_auto_renew_tariff_id_fkey"
      FOREIGN KEY ("auto_renew_tariff_id") REFERENCES "tariffs"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Добавить subscription_id в payments (FK на subscriptions)
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "subscription_id" TEXT;

CREATE INDEX IF NOT EXISTS "payments_subscription_id_idx" ON "payments" ("subscription_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'payments_subscription_id_fkey'
  ) THEN
    ALTER TABLE "payments"
      ADD CONSTRAINT "payments_subscription_id_fkey"
      FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Перенести FK constraint в gift_codes
-- Старый FK был на secondary_subscriptions(id) — таблица переименована,
-- Postgres должен был сохранить связь автоматически (FK ссылается на таблицу по OID).
-- Но имя constraint оставим — на проде увидим точное имя если потребуется rename.
-- ─────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────
-- 6. SEED: создать Subscription[0] для каждого клиента с remnawaveUuid
-- Это превращает Client.remnawaveUuid + currentTariffId + autoRenew* в первую запись
-- в subscriptions (subscription_index=0 = главная).
-- ─────────────────────────────────────────────────────────────────────────
INSERT INTO "subscriptions" (
  "id",
  "owner_id",
  "remnawave_uuid",
  "subscription_index",
  "tariff_id",
  "gift_status",
  "trial_id",
  "custom_price",
  "purchased_as_gift",
  "auto_renew_enabled",
  "auto_renew_tariff_id",
  "auto_renew_price_option_id",
  "auto_renew_extra_devices",
  "auto_renew_retry_count",
  "auto_renew_notified_at",
  "auto_renew_promo_code",
  "current_price_per_day",
  "last_notified_key",
  "created_at",
  "updated_at"
)
SELECT
  -- cuid-like id: префикс 'umig' + первые 21 hex символ md5(client.id) → 25 символов
  ('umig' || SUBSTRING(MD5(c."id"), 1, 21))::TEXT AS id,
  c."id" AS owner_id,
  c."remnawave_uuid",
  0 AS subscription_index,
  c."current_tariff_id" AS tariff_id,
  NULL AS gift_status,
  NULL AS trial_id,
  c."custom_primary_price" AS custom_price,
  FALSE AS purchased_as_gift,
  COALESCE(c."auto_renew_enabled", FALSE) AS auto_renew_enabled,
  c."auto_renew_tariff_id",
  c."auto_renew_price_option_id",
  COALESCE(c."auto_renew_extra_devices", 0) AS auto_renew_extra_devices,
  COALESCE(c."auto_renew_retry_count", 0) AS auto_renew_retry_count,
  c."auto_renew_notified_at",
  c."auto_renew_promo_code",
  c."current_price_per_day",
  c."last_arn_notified_key" AS last_notified_key,
  c."created_at",
  NOW() AS updated_at
FROM "clients" c
WHERE c."remnawave_uuid" IS NOT NULL
  -- Не дублируем если уже есть subscription с index=0 (на случай повторного запуска)
  AND NOT EXISTS (
    SELECT 1 FROM "subscriptions" s
    WHERE s."owner_id" = c."id" AND s."subscription_index" = 0
  );

-- ─────────────────────────────────────────────────────────────────────────
-- 7. Старые колонки Client.{remnawaveUuid,currentTariffId,autoRenew*}
-- ОСТАВЛЯЕМ как deprecated. Кабинет временно их читает. Удалим в фазе 2.
-- ─────────────────────────────────────────────────────────────────────────
