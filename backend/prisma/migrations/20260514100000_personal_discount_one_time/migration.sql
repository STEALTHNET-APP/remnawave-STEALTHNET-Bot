-- T-one-time-discount
-- Делаем персональную скидку одноразовой (опция).
-- Client.personalDiscountIsOneTime — если true, скидка сгорает после первой
-- продуктовой покупки (см. mark-paid.service.ts).
-- AutoBroadcastRule.personalDiscountIsOneTime — флаг, с которым выдаётся скидка
-- при отправке правила: ставится у каждого получателя на Client.

ALTER TABLE "clients"
  ADD COLUMN IF NOT EXISTS "personal_discount_is_one_time" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "auto_broadcast_rules"
  ADD COLUMN IF NOT EXISTS "personal_discount_is_one_time" BOOLEAN NOT NULL DEFAULT true;

-- Существующие правила со скидкой → помечаем как one-time (запрос юзера 14.05.2026).
UPDATE "auto_broadcast_rules"
SET "personal_discount_is_one_time" = true
WHERE "personal_discount_percent" IS NOT NULL
  AND "personal_discount_percent" > 0;
