-- несколько пробных подписок (триалов).
-- Каждый триал привязан к одному из тарифов; настройки сквадов/устройств наследуются из тарифа,
-- длительность задаётся отдельно. Один клиент может активировать каждый триал максимум 1 раз.
-- Когда клиент активировал ВСЕ доступные триалы — кнопка «Получить пробную» в боте скрывается.

-- 1) Триал-пресет
CREATE TABLE "trials" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "tariff_id" TEXT NOT NULL,
  "duration_days" INTEGER NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "description" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "trials_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "trials_tariff_id_idx" ON "trials"("tariff_id");

ALTER TABLE "trials"
  ADD CONSTRAINT "trials_tariff_id_fkey"
  FOREIGN KEY ("tariff_id") REFERENCES "tariffs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2) Лог использования триалов клиентом
CREATE TABLE "client_trial_usages" (
  "id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "trial_id" TEXT NOT NULL,
  "activated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "subscription_id" TEXT,
  CONSTRAINT "client_trial_usages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "client_trial_usages_client_id_trial_id_key" ON "client_trial_usages"("client_id", "trial_id");
CREATE INDEX "client_trial_usages_client_id_idx" ON "client_trial_usages"("client_id");
CREATE INDEX "client_trial_usages_trial_id_idx" ON "client_trial_usages"("trial_id");

ALTER TABLE "client_trial_usages"
  ADD CONSTRAINT "client_trial_usages_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "client_trial_usages"
  ADD CONSTRAINT "client_trial_usages_trial_id_fkey"
  FOREIGN KEY ("trial_id") REFERENCES "trials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3) Маркер «эта secondary создана через триал» — для пометки в боте + кнопки «Конвертировать»
ALTER TABLE "secondary_subscriptions" ADD COLUMN "trial_id" TEXT;
CREATE INDEX "secondary_subscriptions_trial_id_idx" ON "secondary_subscriptions"("trial_id");

ALTER TABLE "secondary_subscriptions"
  ADD CONSTRAINT "secondary_subscriptions_trial_id_fkey"
  FOREIGN KEY ("trial_id") REFERENCES "trials"("id") ON DELETE SET NULL ON UPDATE CASCADE;
