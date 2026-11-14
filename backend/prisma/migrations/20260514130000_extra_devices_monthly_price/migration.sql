-- T-extras-monthly-price
-- Цена доп. устройств подписки за 30 дней. При продлении:
--   finalPrice = selectedOption.price + extraDevicesMonthlyPrice × (days / 30)
-- НЕ зависит от tariff.pricePerExtraDevice (это отдельная фича создания тарифа).
-- Хранит цену из sell-options-products (пакета, которым было докуплено устройство).

ALTER TABLE "subscriptions"
  ADD COLUMN IF NOT EXISTS "extra_devices_monthly_price" DOUBLE PRECISION NOT NULL DEFAULT 0;
