-- T-anti-abuse resend (15.06.2026, WolfVPN): повторные предупреждения.
-- resend_after_hours — через сколько часов повторить WARN, если юзер не снизил потребление.
-- null = слать один раз (прежнее поведение).

ALTER TABLE "traffic_abuse_rules" ADD COLUMN "resend_after_hours" INTEGER;
