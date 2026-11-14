-- T-tariff-restriction (портировано из WolfVPN): ограничение покупки/продления выбранных тарифов клиенту.
-- Идемпотентно (ADD COLUMN IF NOT EXISTS) — безопасно на свежей инсталляции и на проде.
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "restricted_tariff_ids" TEXT;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "tariff_restriction_reason" TEXT;
