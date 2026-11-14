-- дефолтные правила авто-рассылки для всех 9 триггеров.
-- Идемпотентно: создаём только если правил с таким triggerType ещё нет в БД.
-- Каждое правило — с собственным cron-расписанием подходящей частоты и осмысленным текстом.
-- Админ потом отредактирует через UI или поменяет enabled=false.

-- Хелпер: добавить только если нет ни одного правила с этим triggerType.
DO $$
BEGIN

-- 1. ☀️ Приветствие через день после регистрации (one-time)
IF NOT EXISTS (SELECT 1 FROM auto_broadcast_rules WHERE trigger_type = 'after_registration') THEN
  INSERT INTO auto_broadcast_rules (id, name, trigger_type, delay_days, channel, message, button_text, button_url, enabled, cron_expression, created_at, updated_at)
  VALUES (
    'abr_' || substring(md5(random()::text || clock_timestamp()::text), 1, 21),
    '☀️ Приветствие новичка (через 1 день)',
    'after_registration', 1, 'telegram',
    'Привет! 👋\n\nТы зарегистрировался у нас вчера — заходи попробуй наш VPN. Если что-то непонятно — мы поможем!',
    '📋 Тарифы', 'menu:tariffs',
    true, '0 9 * * *',
    NOW(), NOW()
  );
END IF;

-- 2. 💸 Нет оплаты через 3 дня после регистрации
IF NOT EXISTS (SELECT 1 FROM auto_broadcast_rules WHERE trigger_type = 'no_payment') THEN
  INSERT INTO auto_broadcast_rules (id, name, trigger_type, delay_days, channel, message, button_text, button_url, enabled, cron_expression, created_at, updated_at)
  VALUES (
    'abr_' || substring(md5(random()::text || clock_timestamp()::text), 1, 21),
    '💸 Нет первой оплаты (через 3 дня)',
    'no_payment', 3, 'telegram',
    'Ты уже 3 дня с нами, но ещё не оформил подписку 😊\n\nВыбери тариф — настройка занимает 30 секунд, а скорость и безопасность ты получишь сразу.',
    '🛒 Выбрать тариф', 'menu:tariffs',
    true, '0 9 * * *',
    NOW(), NOW()
  );
END IF;

-- 3. 🎁 Триал не активирован за 2 дня
IF NOT EXISTS (SELECT 1 FROM auto_broadcast_rules WHERE trigger_type = 'trial_not_connected') THEN
  INSERT INTO auto_broadcast_rules (id, name, trigger_type, delay_days, channel, message, button_text, button_url, enabled, cron_expression, created_at, updated_at)
  VALUES (
    'abr_' || substring(md5(random()::text || clock_timestamp()::text), 1, 21),
    '🎁 Триал не активирован (через 2 дня)',
    'trial_not_connected', 2, 'telegram',
    '🎁 Ты ещё не попробовал бесплатный пробный период!\n\nНажми кнопку ниже — мы выдадим тебе VPN на тест без какой-либо оплаты.',
    '🎁 Получить пробную', 'menu:trial',
    true, '0 9 * * *',
    NOW(), NOW()
  );
END IF;

-- 4. 🪙 Триал использован, но не платил
IF NOT EXISTS (SELECT 1 FROM auto_broadcast_rules WHERE trigger_type = 'trial_used_never_paid') THEN
  INSERT INTO auto_broadcast_rules (id, name, trigger_type, delay_days, channel, message, button_text, button_url, enabled, cron_expression, created_at, updated_at)
  VALUES (
    'abr_' || substring(md5(random()::text || clock_timestamp()::text), 1, 21),
    '🪙 После триала без оплаты',
    'trial_used_never_paid', 5, 'telegram',
    'Как тебе пробная подписка? 🤔\n\nЕсли понравилось — продли тариф со скидкой. Используй промокод <b>COMEBACK15</b> на первую оплату.',
    '🛒 Тарифы', 'menu:tariffs',
    true, '0 9 * * *',
    NOW(), NOW()
  );
END IF;

-- 5. 📊 Нет трафика (подключился но не платил)
IF NOT EXISTS (SELECT 1 FROM auto_broadcast_rules WHERE trigger_type = 'no_traffic') THEN
  INSERT INTO auto_broadcast_rules (id, name, trigger_type, delay_days, channel, message, button_text, button_url, enabled, cron_expression, created_at, updated_at)
  VALUES (
    'abr_' || substring(md5(random()::text || clock_timestamp()::text), 1, 21),
    '📊 Активный, но без оплаты',
    'no_traffic', 7, 'telegram',
    'Ты подключился, но ещё не оплатил тариф 🛡\n\nЧтобы продолжить пользоваться — выбери подходящий тариф.',
    '🛒 Тарифы', 'menu:tariffs',
    true, '0 9 * * *',
    NOW(), NOW()
  );
END IF;

-- 6. 💤 Неактивность 30 дней (платил, но давно)
IF NOT EXISTS (SELECT 1 FROM auto_broadcast_rules WHERE trigger_type = 'inactivity') THEN
  INSERT INTO auto_broadcast_rules (id, name, trigger_type, delay_days, channel, message, button_text, button_url, enabled, cron_expression, created_at, updated_at)
  VALUES (
    'abr_' || substring(md5(random()::text || clock_timestamp()::text), 1, 21),
    '💤 Неактивный клиент (30 дней без оплаты)',
    'inactivity', 30, 'telegram',
    'Скучаем по тебе! 💔\n\nВозвращайся — для тебя промокод <b>COMEBACK25</b> на скидку 25%.',
    '🔄 Продлить подписку', 'menu:tariffs',
    true, '0 9 * * *',
    NOW(), NOW()
  );
END IF;

-- 7. ⏰ Подписка истекает через 3 дня (уведомление заранее)
IF NOT EXISTS (SELECT 1 FROM auto_broadcast_rules WHERE trigger_type = 'subscription_ending_soon') THEN
  INSERT INTO auto_broadcast_rules (id, name, trigger_type, delay_days, channel, message, button_text, button_url, button2_text, button2_url, enabled, cron_expression, created_at, updated_at)
  VALUES (
    'abr_' || substring(md5(random()::text || clock_timestamp()::text), 1, 21),
    '⏰ Подписка истекает через 3 дня',
    'subscription_ending_soon', 3, 'telegram',
    '⏰ Твоя подписка <b>{{TARIFF}}</b> истекает через 3 дня!\n\nПродли заранее, чтобы не остаться без интернета.',
    '💰 Продлить', 'menu:tariffs',
    '📋 Мои подписки', 'menu:my_subs',
    true, '0 9 * * *',
    NOW(), NOW()
  );
END IF;

-- 8. 🚨 Подписка истекает через 15 минут (срочное уведомление)
IF NOT EXISTS (SELECT 1 FROM auto_broadcast_rules WHERE trigger_type = 'subscription_ending_minutes') THEN
  INSERT INTO auto_broadcast_rules (id, name, trigger_type, delay_days, channel, message, button_text, button_url, button2_text, button2_url, enabled, cron_expression, created_at, updated_at)
  VALUES (
    'abr_' || substring(md5(random()::text || clock_timestamp()::text), 1, 21),
    '🚨 Подписка истекает через 15 минут',
    'subscription_ending_minutes', 15, 'telegram',
    '🚨 Подписка <b>{{TARIFF}}</b> истекает через 15 минут!\n\nЕсли продлить сейчас, дни добавятся к текущим — без простоя.',
    '💰 Продлить сейчас', 'menu:tariffs',
    '🏠 Главное меню', 'menu:main',
    true, '* * * * *',
    NOW(), NOW()
  );
END IF;

-- 9. ❌ Подписка истекла (с промокодом возврата)
IF NOT EXISTS (SELECT 1 FROM auto_broadcast_rules WHERE trigger_type = 'subscription_expired') THEN
  INSERT INTO auto_broadcast_rules (id, name, trigger_type, delay_days, channel, message, button_text, button_url, button2_text, button2_url, enabled, cron_expression, created_at, updated_at)
  VALUES (
    'abr_' || substring(md5(random()::text || clock_timestamp()::text), 1, 21),
    '❌ Подписка истекла (с промокодом 25%)',
    'subscription_expired', 0, 'telegram',
    '😢 Твоя подписка <b>{{TARIFF}}</b> истекла.\n\nВозвращайся — для тебя промокод <b>COMEBACK25</b> со скидкой 25% на следующее продление!',
    '🔄 Продлить со скидкой', 'menu:tariffs',
    '🏠 Главное меню', 'menu:main',
    true, '0 * * * *',
    NOW(), NOW()
  );
END IF;

END $$;
