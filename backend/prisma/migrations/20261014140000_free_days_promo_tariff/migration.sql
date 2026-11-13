-- Additive: old promo codes remain intact; no subscriptions or Remnawave users are deleted.
ALTER TABLE "promo_codes" ADD COLUMN "tariff_id" TEXT, ADD COLUMN "tariff_price_option_id" TEXT;
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_tariff_id_fkey" FOREIGN KEY ("tariff_id") REFERENCES "tariffs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_tariff_price_option_id_fkey" FOREIGN KEY ("tariff_price_option_id") REFERENCES "tariff_price_options"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "subscriptions" ADD COLUMN "promo_granted" BOOLEAN NOT NULL DEFAULT false;
