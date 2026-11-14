-- API key hardening: expiry, IP whitelist, audit log
-- Idempotent for re-application on existing installations.

ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "last_used_ip" TEXT;
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "expires_at" TIMESTAMP(3);
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "allowed_ips" TEXT;

CREATE TABLE IF NOT EXISTS "api_key_usage" (
    "id" TEXT NOT NULL,
    "api_key_id" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "ua" TEXT,
    "method" VARCHAR(10) NOT NULL,
    "path" TEXT NOT NULL,
    "status_code" INTEGER NOT NULL,

    CONSTRAINT "api_key_usage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "api_key_usage_api_key_id_ts_idx" ON "api_key_usage"("api_key_id", "ts" DESC);
CREATE INDEX IF NOT EXISTS "api_key_usage_ts_idx" ON "api_key_usage"("ts" DESC);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'api_key_usage_api_key_id_fkey'
    ) THEN
        ALTER TABLE "api_key_usage"
        ADD CONSTRAINT "api_key_usage_api_key_id_fkey"
        FOREIGN KEY ("api_key_id") REFERENCES "api_keys"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
