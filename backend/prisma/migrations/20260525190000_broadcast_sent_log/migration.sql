-- CreateTable
CREATE TABLE "broadcast_sent_log" (
    "id" BIGSERIAL NOT NULL,
    "broadcast_id" TEXT NOT NULL,
    "tgid" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "broadcast_sent_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "broadcast_sent_log_broadcast_id_tgid_key" ON "broadcast_sent_log"("broadcast_id", "tgid");

-- CreateIndex
CREATE INDEX "broadcast_sent_log_broadcast_id_idx" ON "broadcast_sent_log"("broadcast_id");

-- AddForeignKey
ALTER TABLE "broadcast_sent_log" ADD CONSTRAINT "broadcast_sent_log_broadcast_id_fkey" FOREIGN KEY ("broadcast_id") REFERENCES "broadcast_history"("id") ON DELETE CASCADE ON UPDATE CASCADE;
