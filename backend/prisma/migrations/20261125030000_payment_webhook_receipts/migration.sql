CREATE TABLE IF NOT EXISTS "payment_webhook_receipts" (
    "provider" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payment_webhook_receipts_pkey" PRIMARY KEY ("provider", "event_id")
);
CREATE INDEX IF NOT EXISTS "payment_webhook_receipts_payment_id_idx" ON "payment_webhook_receipts"("payment_id");
