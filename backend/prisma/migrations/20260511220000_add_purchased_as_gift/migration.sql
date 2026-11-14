-- разграничение «купил себе» vs «купил для подарка».
ALTER TABLE "secondary_subscriptions" ADD COLUMN IF NOT EXISTS "purchased_as_gift" BOOLEAN NOT NULL DEFAULT false;
