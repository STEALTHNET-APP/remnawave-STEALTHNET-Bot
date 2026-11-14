-- ─── v5.0.0: текст баланса «💰 Баланс: » → «💰 Ваш Баланс: » в главном меню ─────
--
-- Текст строки баланса хранится в system_settings.bot_menu_texts (JSON) под ключом
-- balancePrefix. Старый дефолт = «💰 Баланс: ». Обновляем на «💰 Ваш Баланс: »
-- ТОЛЬКО если значение всё ещё равно старому дефолту (админ не переписал).
-- Жирность баланса делается в коде бота (обёртка **…**), здесь только текст.
--
-- Безопасно: DO-блок с проверкой что value — валидный JSON-объект.

DO $$
DECLARE
  cur jsonb;
BEGIN
  SELECT value::jsonb INTO cur
  FROM system_settings
  WHERE key = 'bot_menu_texts'
  LIMIT 1;

  IF cur IS NOT NULL AND jsonb_typeof(cur) = 'object'
     AND cur->>'balancePrefix' = '💰 Баланс: ' THEN
    UPDATE system_settings
    SET value = jsonb_set(value::jsonb, '{balancePrefix}', '"💰 Ваш Баланс: "'::jsonb)::text
    WHERE key = 'bot_menu_texts';
  END IF;
EXCEPTION WHEN others THEN
  -- value не JSON или иная ошибка — пропускаем (текст останется как был, не критично).
  RAISE NOTICE 'balance_label_yours: пропуск (bot_menu_texts не JSON или ошибка)';
END $$;
