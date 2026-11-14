-- авторассылка с привязанным промокодом или индивидуальной скидкой.
-- Используется чтобы клиенту после окончания подписки слать персональную скидку/код,
-- при этом лимит активаций промокода = количество отправленных сообщений.

ALTER TABLE "auto_broadcast_rules"
  ADD COLUMN IF NOT EXISTS "promo_code_id" TEXT,
  ADD COLUMN IF NOT EXISTS "personal_discount_percent" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "max_recipients" INTEGER;

CREATE INDEX IF NOT EXISTS "auto_broadcast_rules_promo_code_id_idx" ON "auto_broadcast_rules" ("promo_code_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'auto_broadcast_rules_promo_code_id_fkey'
  ) THEN
    ALTER TABLE "auto_broadcast_rules"
      ADD CONSTRAINT "auto_broadcast_rules_promo_code_id_fkey"
      FOREIGN KEY ("promo_code_id") REFERENCES "promo_codes"("id") ON DELETE SET NULL;
  END IF;
END $$;
