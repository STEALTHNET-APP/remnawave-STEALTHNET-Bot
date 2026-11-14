ALTER TABLE "singbox_slots"
ADD COLUMN "renewal_base_expires_at" TIMESTAMP(3),
ADD COLUMN "renewal_base_traffic_limit_bytes" BIGINT,
ADD COLUMN "renewal_adjustment_ms" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "sync_pending" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "singbox_renewals" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "slot_id" TEXT NOT NULL REFERENCES "singbox_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "payment_id" TEXT NOT NULL REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "duration_days" INTEGER NOT NULL,
  "traffic_bytes" BIGINT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "singbox_renewals_payment_id_key" ON "singbox_renewals"("payment_id");
CREATE INDEX "singbox_renewals_slot_id_idx" ON "singbox_renewals"("slot_id");
