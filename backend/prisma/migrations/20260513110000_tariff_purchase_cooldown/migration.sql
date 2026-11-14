-- кулдаун между покупками тарифа одним клиентом.
-- null/0 = без ограничения (default). > 0 = N дней между покупками.
-- Применяется в эндпоинтах создания платежа (balance + yookassa/yoomoney/cryptopay/heleket/lava/lavatop/platega).

ALTER TABLE "tariffs"
  ADD COLUMN IF NOT EXISTS "purchase_cooldown_days" INTEGER;
