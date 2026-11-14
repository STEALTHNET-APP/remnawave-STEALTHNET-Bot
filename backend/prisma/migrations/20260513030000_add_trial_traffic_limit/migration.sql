-- отдельный лимит трафика для триала.
-- Если NULL — используется trafficLimitBytes тарифа (бэк-совместимость со старыми триалами).
-- При конвертации триала в платную (extendSecondarySubscription) применяется полный
-- лимит тарифа, а не триальный — клиент получает полный пакет после оплаты.

ALTER TABLE "trials"
  ADD COLUMN IF NOT EXISTS "traffic_limit_bytes" BIGINT;
