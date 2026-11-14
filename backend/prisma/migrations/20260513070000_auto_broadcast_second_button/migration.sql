-- вторая кнопка для авторассылки.
-- Используется для рассылки «подписка истекла» — кнопка #1 «🔄 Продлить» (динамический deep-link
-- с tariffId), кнопка #2 «🏠 Главное меню».

ALTER TABLE "auto_broadcast_rules"
  ADD COLUMN IF NOT EXISTS "button2_text" TEXT,
  ADD COLUMN IF NOT EXISTS "button2_url" TEXT;
