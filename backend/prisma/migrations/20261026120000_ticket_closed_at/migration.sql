-- AlterTable
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "closed_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "tickets_closed_at_idx" ON "tickets"("closed_at");

-- Backfill closed_at for already closed tickets
UPDATE "tickets" SET "closed_at" = "updated_at" WHERE "status" = 'closed' AND "closed_at" IS NULL;
