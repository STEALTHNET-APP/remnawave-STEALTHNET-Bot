-- Зеркало состояния подписки из Remnawave в нашей БД (T-remna-mirror).
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "short_uuid" TEXT;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "remna_status" TEXT;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "traffic_used_bytes" DOUBLE PRECISION;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "traffic_limit_bytes" DOUBLE PRECISION;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "last_traffic_reset_at" TIMESTAMP(3);
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "sub_revoked_at" TIMESTAMP(3);
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "remna_synced_at" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "subscriptions_short_uuid_idx" ON "subscriptions"("short_uuid");
