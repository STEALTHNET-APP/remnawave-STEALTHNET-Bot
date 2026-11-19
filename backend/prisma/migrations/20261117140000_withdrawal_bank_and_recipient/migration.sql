ALTER TABLE "withdrawal_requests" ADD COLUMN IF NOT EXISTS "bank_name" TEXT;
ALTER TABLE "withdrawal_requests" ADD COLUMN IF NOT EXISTS "recipient_name" TEXT;
