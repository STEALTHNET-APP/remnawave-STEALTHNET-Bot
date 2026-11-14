-- флаг "код создан админом".
-- Используется в redeemGiftCode чтобы пропустить проверку «нельзя активировать свой код»
-- когда админ выдаёт подарочный код через /admin/gift-codes/create (creator=recipient
-- в этом сценарии, но активация должна работать).

ALTER TABLE "gift_codes"
  ADD COLUMN IF NOT EXISTS "created_by_admin" BOOLEAN NOT NULL DEFAULT FALSE;
