-- T-abuse-grace (29.06.2026, WolfVPN): иммунитет от авто-бана анти-абьюза после ручного разбана.
ALTER TABLE "subscriptions" ADD COLUMN "abuse_immune_until" TIMESTAMP(3);
