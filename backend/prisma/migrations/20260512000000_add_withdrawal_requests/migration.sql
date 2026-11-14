-- заявка на вывод реферального баланса USDT TRC20.
CREATE TABLE IF NOT EXISTS "withdrawal_requests" (
  "id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "wallet_trc20" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "admin_comment" TEXT,
  "processed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "withdrawal_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "withdrawal_requests_client_id_idx" ON "withdrawal_requests"("client_id");
CREATE INDEX IF NOT EXISTS "withdrawal_requests_status_idx" ON "withdrawal_requests"("status");
CREATE INDEX IF NOT EXISTS "withdrawal_requests_created_at_idx" ON "withdrawal_requests"("created_at");

ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
