-- конструктор уведомлений автосписания.

CREATE TABLE IF NOT EXISTS "auto_renew_notifications" (
  "id" TEXT NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "trigger_type" VARCHAR(20) NOT NULL,
  "offset_minutes" INTEGER NOT NULL DEFAULT 15,
  "message_text" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "auto_renew_notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "auto_renew_notifications_trigger_type_enabled_idx"
  ON "auto_renew_notifications"("trigger_type", "enabled");
CREATE INDEX IF NOT EXISTS "auto_renew_notifications_sort_order_idx"
  ON "auto_renew_notifications"("sort_order");

ALTER TABLE "secondary_subscriptions"
  ADD COLUMN IF NOT EXISTS "last_notified_key" TEXT;

-- Дефолтные шаблоны уведомлений (на старте админ их видит и может модифицировать / удалить).
INSERT INTO "auto_renew_notifications" ("id", "name", "trigger_type", "offset_minutes", "message_text", "enabled", "sort_order", "created_at", "updated_at") VALUES
('arn_default_upcoming_3d', 'Уведомление за 3 дня', 'UPCOMING', 4320,
E'⚠️ <b>Скоро автосписание</b>\n\nЧерез <b>{days_left} {days_unit}</b> с вашей подписки «<b>{tariff_name}</b>» спишется <b>{amount} {currency}</b> с вашего баланса.\n\n💡 Убедитесь, что на балансе достаточно средств.',
true, 1, NOW(), NOW()),
('arn_default_upcoming_1d', 'Уведомление за 1 день', 'UPCOMING', 1440,
E'⏰ <b>Автосписание завтра</b>\n\nЗавтра с вашей подписки «<b>{tariff_name}</b>» спишется <b>{amount} {currency}</b>.\n\n💵 Текущий баланс: {balance} {currency}',
true, 2, NOW(), NOW()),
('arn_default_upcoming_15m', 'Уведомление за 15 минут', 'UPCOMING', 15,
E'🟡 <b>Ваша подписка истекает через 15 минут!</b>\n\nПродлите подписку, чтобы не потерять доступ.',
true, 3, NOW(), NOW()),
('arn_default_success', 'Успешное продление', 'SUCCESS', 0,
E'✅ <b>Подписка продлена</b>\n\nПодписка «<b>{tariff_name}</b>» успешно продлена. С вашего баланса списано <b>{amount} {currency}</b>.\n\n💵 Остаток на балансе: {balance} {currency}',
true, 10, NOW(), NOW()),
('arn_default_failed', 'Списание не удалось', 'FAILED', 0,
E'❌ <b>Не удалось продлить подписку</b>\n\nПодписка «<b>{tariff_name}</b>» не была продлена — недостаточно средств на балансе и/или ошибка YooKassa.\n\n💡 Пополните баланс, чтобы не потерять доступ.',
true, 20, NOW(), NOW()),
('arn_default_expired', 'Автосписание отключено', 'EXPIRED', 0,
E'🛑 <b>Автосписание отключено</b>\n\nМы пытались продлить вашу подписку несколько раз, но не получилось. Автосписание было выключено.\n\nЧтобы продолжить пользоваться сервисом — продлите подписку вручную.',
true, 30, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;
