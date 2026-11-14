-- эмодзи-префикс для отображения тарифа в главном меню бота.
-- Поле опциональное: если пусто — бот применяет fallback по типу подписки
-- (root → 🌐, secondary → 🔒). Заполняется админом руками в форме тарифа.

ALTER TABLE "tariffs"
  ADD COLUMN IF NOT EXISTS "menu_emoji" TEXT;
