-- тарифы, в которые можно конвертировать триал
-- (JSON-массив tariffId). null/пусто — только тариф триала.
ALTER TABLE "trials" ADD COLUMN "convert_tariff_ids" TEXT;
