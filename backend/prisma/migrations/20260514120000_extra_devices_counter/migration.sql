-- T-extras-counter
-- Заменяем накопительный customPrice на чистый счётчик доп. устройств в подписке.
-- Цена при продлении считается формулой:
--   selectedOption.price + extraDevices × pricePerExtraDevice × (days/30)
-- Это позволяет корректно масштабировать цену устройств при смене длительности.

ALTER TABLE "subscriptions"
  ADD COLUMN IF NOT EXISTS "extra_devices" INTEGER NOT NULL DEFAULT 0;

-- Backfill из customPrice: пытаемся угадать сколько устройств было докуплено.
-- Старая логика складывала amount каждой purchase в customPrice. Если у подписки
-- customPrice > price_options[0].price (минимальная цена тарифа за 30 дней),
-- значит что-то докупали — извлекаем (custom_price - tariff base) / 50.
-- Если результат отрицательный или 0 — оставляем extra_devices = 0.
-- Этот backfill приблизительный — точная синхронизация делается отдельным
-- скриптом backfill-extras.ts через чтение Remna user.hwidDeviceLimit.
UPDATE "subscriptions" s
SET "extra_devices" = GREATEST(
  0,
  LEAST(
    20,  -- разумный максимум
    ROUND(
      (s."custom_price" - t."price") / NULLIF(t."price_per_extra_device", 0)
    )::INTEGER
  )
)
FROM "tariffs" t
WHERE s."tariff_id" = t."id"
  AND s."custom_price" IS NOT NULL
  AND s."custom_price" > t."price"
  AND t."price_per_extra_device" > 0;

-- НЕ удаляем customPrice сразу — оставляем как deprecated fallback на 1-2 релиза.
-- Новые apply будут писать в extra_devices, customPrice остаётся только для legacy чтения.
