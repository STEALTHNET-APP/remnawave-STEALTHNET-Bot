-- ─── Выпил multi-bot/clone-bots функциональности (v5.0.0) ────────────────────
--
-- Откатывает 20260502160000_clone_bots: возвращает clients.@unique(telegram_id),
-- дропает payments.bot_id/base_amount/bot_markup_*, telegram_auth_tokens.confirmed_bot_id
-- и таблицы bots, bot_payouts.
--
-- На свежих инсталляциях (где clone_bots не применялась) — всё DROP IF EXISTS / нет колонок,
-- миграция отрабатывает no-op. На старых проде сначала проверяем что нет дубликатов
-- telegram_id между разными ботами — если есть, миграция падает с подсказкой.

-- ─── 1. Проверка дубликатов telegram_id (если были клоны кроме primary) ─────
DO $$
DECLARE
  dup_count INTEGER := 0;
BEGIN
  -- Колонка bot_id могла быть удалена ранее — в свежей инсталляции пропускаем.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'clients' AND column_name = 'bot_id'
  ) THEN
    SELECT count(*) INTO dup_count FROM (
      SELECT telegram_id
      FROM clients
      WHERE telegram_id IS NOT NULL
      GROUP BY telegram_id
      HAVING count(*) > 1
    ) sub;

    IF dup_count > 0 THEN
      RAISE EXCEPTION
        'Найдено % дубликатов telegram_id в clients (один TG-юзер в нескольких клонах). '
        'Нельзя автоматически восстановить @unique(telegram_id). Разрулите вручную: '
        'оставьте одного клиента на telegram_id (последний по created_at) и удалите дубликаты, '
        'затем повторите миграцию.', dup_count;
    END IF;
  END IF;
END $$;

-- ─── 2. payments ───────────────────────────────────────────────────────────
ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "payments_bot_id_fkey";
DROP INDEX IF EXISTS "payments_bot_id_idx";
ALTER TABLE "payments"
  DROP COLUMN IF EXISTS "bot_id",
  DROP COLUMN IF EXISTS "base_amount",
  DROP COLUMN IF EXISTS "bot_markup_percent",
  DROP COLUMN IF EXISTS "bot_markup_amount";

-- ─── 3. telegram_auth_tokens ───────────────────────────────────────────────
ALTER TABLE "telegram_auth_tokens" DROP COLUMN IF EXISTS "confirmed_bot_id";

-- ─── 4. clients: восстановить @unique(telegram_id) ─────────────────────────
DROP INDEX IF EXISTS "clients_bot_id_telegram_id_unique";
DROP INDEX IF EXISTS "clients_telegram_id_idx";
DROP INDEX IF EXISTS "clients_bot_id_idx";

ALTER TABLE "clients" DROP CONSTRAINT IF EXISTS "clients_bot_id_fkey";
ALTER TABLE "clients" DROP COLUMN IF EXISTS "bot_id";

-- Восстанавливаем уникальный индекс по telegram_id (как было до clone_bots).
-- Prisma при @unique генерирует индекс с именем "clients_telegram_id_key".
CREATE UNIQUE INDEX IF NOT EXISTS "clients_telegram_id_key"
  ON "clients"("telegram_id");

-- ─── 5. Таблицы bot_payouts, bots ──────────────────────────────────────────
DROP TABLE IF EXISTS "bot_payouts" CASCADE;
DROP TABLE IF EXISTS "bots" CASCADE;
