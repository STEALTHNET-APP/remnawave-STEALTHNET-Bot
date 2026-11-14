-- триал 2.0:
--  • standalone-триал из сквада (tariff_id nullable + squad_uuids/device_limit);
--  • тоггл конвертации (convert_enabled) и «конвертация в любой тариф» (convert_all_tariffs).
ALTER TABLE "trials" ALTER COLUMN "tariff_id" DROP NOT NULL;
ALTER TABLE "trials" ADD COLUMN "squad_uuids" TEXT;
ALTER TABLE "trials" ADD COLUMN "device_limit" INTEGER;
ALTER TABLE "trials" ADD COLUMN "convert_enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "trials" ADD COLUMN "convert_all_tariffs" BOOLEAN NOT NULL DEFAULT false;

-- onDelete Cascade → SetNull для связи с тарифом.
ALTER TABLE "trials" DROP CONSTRAINT IF EXISTS "trials_tariff_id_fkey";
ALTER TABLE "trials" ADD CONSTRAINT "trials_tariff_id_fkey"
  FOREIGN KEY ("tariff_id") REFERENCES "tariffs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
