ALTER TABLE "withdrawal_requests" ADD COLUMN IF NOT EXISTS "method" TEXT NOT NULL DEFAULT 'usdt';
ALTER TABLE "withdrawal_requests" ADD COLUMN IF NOT EXISTS "details" TEXT NOT NULL DEFAULT '';
ALTER TABLE "withdrawal_requests" ALTER COLUMN "wallet_trc20" DROP NOT NULL;

UPDATE "withdrawal_requests" SET "details" = "wallet_trc20" WHERE "details" = '' AND "wallet_trc20" IS NOT NULL;
