-- персональная (накопительная) цена подписки.
-- Каждая extra-option (+устройство) увеличивает customPrice → продление = customPrice (а не tariff.price).
ALTER TABLE "secondary_subscriptions" ADD COLUMN IF NOT EXISTS "custom_price" DOUBLE PRECISION;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "custom_primary_price" DOUBLE PRECISION;
