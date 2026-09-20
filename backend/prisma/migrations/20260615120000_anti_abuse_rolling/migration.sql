-- T-anti-abuse rolling (15.06.2026, WolfVPN): точный час через дельту накопительного счётчика.
-- Снапшот lifetimeUsedTrafficBytes + время замера на состоянии (подписка×правило);
-- дельта между замерами = трафик за интервал проверки (любая гранулярность).

ALTER TABLE "traffic_abuse_states" ADD COLUMN "last_lifetime_bytes" BIGINT;
ALTER TABLE "traffic_abuse_states" ADD COLUMN "last_snapshot_at" TIMESTAMP(3);
