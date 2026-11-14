-- CreateTable
CREATE TABLE "cloudpayment_agreements" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "subscription_id" TEXT,
    "provider_id" TEXT,
    "terminal_id" TEXT NOT NULL,
    "tariff_id" TEXT NOT NULL,
    "price_option_id" TEXT,
    "token_encrypted" TEXT,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "trial_days" INTEGER NOT NULL DEFAULT 0,
    "trial_ends_at" TIMESTAMP(3),
    "grace_ends_at" TIMESTAMP(3),
    "next_charge_at" TIMESTAMP(3),
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "period_days" INTEGER NOT NULL,
    "consent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consent_text" TEXT NOT NULL,
    "create_requested_at" TIMESTAMP(3),
    "last_error" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cloudpayment_agreements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cloudpayment_events" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "cloudpayment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cloudpayment_jobs" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "agreement_id" TEXT,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "plan" JSONB,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cloudpayment_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cloudpayment_agreements_provider_id_key" ON "cloudpayment_agreements"("provider_id");

-- CreateIndex
CREATE INDEX "cloudpayment_agreements_state_idx" ON "cloudpayment_agreements"("state");

-- CreateIndex
CREATE INDEX "cloudpayment_events_processed_at_idx" ON "cloudpayment_events"("processed_at");

-- CreateIndex
CREATE UNIQUE INDEX "cloudpayment_jobs_payment_id_key" ON "cloudpayment_jobs"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "cloudpayment_jobs_transaction_id_key" ON "cloudpayment_jobs"("transaction_id");

-- CreateIndex
CREATE INDEX "cloudpayment_jobs_state_idx" ON "cloudpayment_jobs"("state");

-- AddForeignKey
ALTER TABLE "cloudpayment_agreements" ADD CONSTRAINT "cloudpayment_agreements_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cloudpayment_agreements" ADD CONSTRAINT "cloudpayment_agreements_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cloudpayment_jobs" ADD CONSTRAINT "cloudpayment_jobs_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


CREATE UNIQUE INDEX "cloudpayment_agreements_active_subscription_key" ON "cloudpayment_agreements"("subscription_id") WHERE "state" IN ('PENDING', 'ACTIVE', 'PAST_DUE', 'CANCEL_PENDING');
