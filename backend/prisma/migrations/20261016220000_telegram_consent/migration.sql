CREATE TABLE "telegram_consents" (
  "telegram_id" TEXT NOT NULL,
  "presented_version" TEXT NOT NULL,
  "accepted_version" TEXT,
  "accepted_documents" TEXT,
  "accepted_at" TIMESTAMP(3),
  "pending_start" TEXT,
  CONSTRAINT "telegram_consents_pkey" PRIMARY KEY ("telegram_id")
);
