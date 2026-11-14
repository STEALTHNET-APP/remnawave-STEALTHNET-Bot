-- ─── v5.0.0: убрать брендинг из шаблонов автосписания (auto_renew_notifications) ──
--
-- Отдельной миграцией (а не дополнением к 20260604140000), потому что та уже могла
-- быть применена на части инсталляций. Эта применится и на них тоже.
-- Дефолтный шаблон UPCOMING из 20260513000000_add_auto_renew_notifications содержал
-- «спишется ... с баланса». Если админ не переписал текст — чистим.
-- Идемпотентно.

UPDATE auto_renew_notifications
SET message_text = REPLACE(message_text, 'с баланса WolfPN', 'с вашего баланса'),
    updated_at = NOW()
WHERE message_text LIKE '%с баланса WolfPN%';

-- Fallback на остатки брендинга в шаблонах автосписания.
UPDATE auto_renew_notifications
SET message_text = REPLACE(REPLACE(message_text, ' WolfPN', ''), 'WolfPN', ''),
    updated_at = NOW()
WHERE message_text LIKE '%WolfPN%';

-- Волчий emoji 🐺 → нейтральный щит 🛡.
UPDATE auto_renew_notifications
SET message_text = REGEXP_REPLACE(message_text, '\s*🐺\s*', ' 🛡 ', 'g'),
    updated_at = NOW()
WHERE message_text LIKE '%🐺%';
