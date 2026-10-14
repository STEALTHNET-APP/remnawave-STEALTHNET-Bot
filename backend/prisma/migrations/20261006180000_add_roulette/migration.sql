-- CreateTable
CREATE TABLE "client_roulette_spins" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "reward_type" TEXT NOT NULL,
    "reward_value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reward_label" TEXT NOT NULL,
    "sector_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_roulette_spins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_roulette_spins_client_id_created_at_idx" ON "client_roulette_spins"("client_id", "created_at");

-- AddForeignKey
ALTER TABLE "client_roulette_spins" ADD CONSTRAINT "client_roulette_spins_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
