ALTER TABLE "singbox_tariffs" ADD COLUMN "protocol" TEXT NOT NULL DEFAULT 'SINGBOX';
ALTER TABLE "singbox_slots" ADD COLUMN "source_payment_id" TEXT;
CREATE INDEX "singbox_slots_source_payment_id_idx" ON "singbox_slots"("source_payment_id");
