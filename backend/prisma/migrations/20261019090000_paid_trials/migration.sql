ALTER TABLE "trials" ADD COLUMN "price" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "trials" ADD CONSTRAINT "trials_price_valid" CHECK ("price" >= 0 AND "price" <= 1000000);
