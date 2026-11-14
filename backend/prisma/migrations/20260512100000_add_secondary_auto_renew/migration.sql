-- индивидуальное автосписание для secondary подписок.
-- Каждая secondary может иметь свой флаг autoRenew (включается из «Мои подписки → деталь»).
ALTER TABLE "secondary_subscriptions" ADD COLUMN IF NOT EXISTS "auto_renew_enabled" BOOLEAN NOT NULL DEFAULT false;
