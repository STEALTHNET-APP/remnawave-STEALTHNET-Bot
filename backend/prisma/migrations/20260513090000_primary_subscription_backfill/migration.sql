-- re-backfill для Subscription[0].
-- Изначальный seed (миграция 20260513040000_unify_subscriptions) создал Subscription[0]
-- для клиентов с Client.remnawaveUuid. НО:
--   1. Клиенты, активировавшие триал ПОСЛЕ unify-миграции, не получили запись (триал-код
--      не писал в Subscription).
--   2. Клиенты, у которых Client.remnawaveUuid установлен (например, восстановление через
--      Telegram-логин) тоже могли остаться без Subscription[0].
--   3. Покупка тарифа после доп. подписки уходила в idx=max+1, а не в [0] (фикс кода — см.
--      activateTariffForClient).
--
-- Этот SQL идемпотентный: только клиенты с remnawaveUuid и без существующей Subscription[0].

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
  ('ubkf' || SUBSTRING(MD5(c."id" || NOW()::TEXT), 1, 21))::TEXT AS id,
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
  AND NOT EXISTS (
    SELECT 1 FROM "subscriptions" s
    WHERE s."owner_id" = c."id" AND s."subscription_index" = 0
  );
