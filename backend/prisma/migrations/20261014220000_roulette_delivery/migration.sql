ALTER TABLE "client_roulette_spins" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'APPLIED', ADD COLUMN "award_plan" JSONB;
