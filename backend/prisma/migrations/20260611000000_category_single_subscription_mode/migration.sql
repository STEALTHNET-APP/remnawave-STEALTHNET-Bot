-- Режим «одна подписка из категории»: при покупке тарифа из такой категории
-- существующая подписка с тарифом этой категории конвертируется (pro-rata),
-- а не создаётся вторая.
ALTER TABLE "tariff_categories" ADD COLUMN "single_subscription_mode" BOOLEAN NOT NULL DEFAULT false;
