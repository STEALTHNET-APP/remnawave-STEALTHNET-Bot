-- добавляем expireAt в Subscription для точных фильтров.
-- До: дата истечения хранилась только в Remna (нужен был API-запрос на каждую проверку).
-- После: кешируется в БД, синхронизируется при upsert/extend подписки.
-- Используется в:
--   • broadcast targetGroup="expired_subs" → точная фильтрация без аппроксимации
--   • auto-renew cron → быстрая выборка истекающих
--   • admin UI → отображение даты без запроса в Remna

ALTER TABLE "subscriptions"
  ADD COLUMN IF NOT EXISTS "expire_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "subscriptions_expire_at_idx" ON "subscriptions" ("expire_at");

-- Бэкфилл из payments: для каждой подписки берём дату последнего успешного платежа
-- + tariff.durationDays. Это аппроксимация но лучше чем null — точные значения подтянутся
-- автоматически при первом sync через cron / upsert / при покупке.
-- Триал-подписки: createdAt + trial.durationDays.

-- 1. Бэкфилл через payments (платные подписки)
UPDATE "subscriptions" s
SET "expire_at" = (
  SELECT p."paid_at" + (COALESCE(t."duration_days", 30) * INTERVAL '1 day')
  FROM "payments" p
  LEFT JOIN "tariffs" t ON t."id" = p."tariff_id"
  WHERE p."subscription_id" = s."id"
    AND p."status" = 'PAID'
    AND p."paid_at" IS NOT NULL
  ORDER BY p."paid_at" DESC
  LIMIT 1
)
WHERE s."expire_at" IS NULL
  AND s."remnawave_uuid" IS NOT NULL;

-- 2. Бэкфилл триалов
UPDATE "subscriptions" s
SET "expire_at" = s."created_at" + (COALESCE(tr."duration_days", 3) * INTERVAL '1 day')
FROM "trials" tr
WHERE s."trial_id" = tr."id"
  AND s."expire_at" IS NULL;
