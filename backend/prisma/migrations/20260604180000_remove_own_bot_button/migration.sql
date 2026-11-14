-- ─── v5.0.0: убрать кнопку «🤖 Свой бот» (own_bot) из меню бота ────────────────
--
-- Кнопка own_bot — остаток фичи clone-bots (предлагала создать свой бот-клон).
-- После выпила multi-bot она бессмысленна. Удалена из кода; здесь убираем её из
-- сохранённого JSON-массива кнопок в существующих БД (system_settings.bot_buttons).
-- Идемпотентно и безопасно (DO-блок с проверкой что value — JSON-массив).

DO $$
DECLARE
  cur jsonb;
  filtered jsonb;
BEGIN
  SELECT value::jsonb INTO cur
  FROM system_settings
  WHERE key = 'bot_buttons'
  LIMIT 1;

  IF cur IS NOT NULL AND jsonb_typeof(cur) = 'array' THEN
    SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb) INTO filtered
    FROM jsonb_array_elements(cur) elem
    WHERE elem->>'id' IS DISTINCT FROM 'own_bot';

    IF filtered <> cur THEN
      UPDATE system_settings
      SET value = filtered::text
      WHERE key = 'bot_buttons';
    END IF;
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'remove_own_bot_button: пропуск (bot_buttons не JSON-массив или ошибка)';
END $$;
