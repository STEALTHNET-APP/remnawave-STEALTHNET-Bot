CREATE TABLE "referral_rewards" (
  "id" TEXT NOT NULL,
  "referee_id" TEXT NOT NULL,
  "referrer_id" TEXT NOT NULL,
  "payment_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "days" INTEGER NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL,
  "subscription_id" TEXT,
  "remnawave_uuid" TEXT,
  "target_expire_at" TIMESTAMP(3),
  "applied_at" TIMESTAMP(3),
  "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "referral_rewards_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "referral_rewards_referee_id_fkey" FOREIGN KEY ("referee_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "referral_rewards_referrer_id_fkey" FOREIGN KEY ("referrer_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "referral_rewards_value_check" CHECK (("kind" = 'balance' AND "amount" > 0 AND "days" = 0) OR ("kind" = 'days' AND "days" > 0 AND "amount" = 0))
);
CREATE UNIQUE INDEX "referral_rewards_referee_id_key" ON "referral_rewards"("referee_id");
CREATE UNIQUE INDEX "referral_rewards_payment_id_key" ON "referral_rewards"("payment_id");
CREATE INDEX "referral_rewards_referrer_id_applied_at_idx" ON "referral_rewards"("referrer_id", "applied_at");
CREATE INDEX "referral_rewards_kind_applied_at_next_attempt_at_idx" ON "referral_rewards"("kind", "applied_at", "next_attempt_at");
