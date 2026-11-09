CREATE TABLE "payment_deliveries" (
  "payment_id" TEXT PRIMARY KEY REFERENCES "payments"("id") ON DELETE CASCADE,
  "state" TEXT NOT NULL DEFAULT 'PENDING',
  "error" TEXT,
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "payment_deliveries_state_created_at_idx" ON "payment_deliveries"("state", "created_at");
