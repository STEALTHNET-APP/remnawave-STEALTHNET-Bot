-- Anti-bot signup protection: track registration metadata
-- Idempotent for re-application.

ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "registration_ip" TEXT;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "registration_ua" TEXT;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "registration_source" VARCHAR(20);

CREATE INDEX IF NOT EXISTS "clients_registration_ip_idx" ON "clients"("registration_ip");
CREATE INDEX IF NOT EXISTS "clients_created_at_idx" ON "clients"("created_at" DESC);
