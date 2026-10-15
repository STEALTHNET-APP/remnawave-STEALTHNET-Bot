CREATE TABLE "email_unsubscribes" (
    "email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "email_unsubscribes_pkey" PRIMARY KEY ("email")
);
