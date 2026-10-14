-- T-anti-abuse (15.06.2026, WolfVPN): Анти-абьюз система (теневые лимиты трафика).
-- Клиент видит безлимит (Remna trafficLimitBytes=0); мы поверх считаем потребление за окно
-- и при превышении предупреждаем/баним (remnaDisableUser). Per-subscription.
-- Поля бана на subscriptions + 3 таблицы (правила / состояние / журнал).

-- AlterTable: поля теневого бана на подписке (для UI бота/сайта + авто-разбан)
ALTER TABLE "subscriptions" ADD COLUMN "banned_until" TIMESTAMP(3);
ALTER TABLE "subscriptions" ADD COLUMN "ban_reason" TEXT;
ALTER TABLE "subscriptions" ADD COLUMN "ban_rule_id" TEXT;
ALTER TABLE "subscriptions" ADD COLUMN "ban_notified_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "subscriptions_banned_until_idx" ON "subscriptions"("banned_until");

-- CreateTable
CREATE TABLE "traffic_abuse_rules" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "schedules" JSONB NOT NULL DEFAULT '[]',
    "window_kind" VARCHAR(16) NOT NULL,
    "window_value_hours" INTEGER,
    "limit_bytes" BIGINT NOT NULL,
    "action" VARCHAR(8) NOT NULL,
    "ban_duration_kind" VARCHAR(20),
    "ban_duration_hours" INTEGER,
    "channels" JSONB NOT NULL DEFAULT '{}',
    "message_text" TEXT NOT NULL,
    "email_subject" VARCHAR(200),
    "scope_kind" VARCHAR(16) NOT NULL DEFAULT 'all',
    "scope_values" JSONB,
    "exclude_subscription_ids" JSONB,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "last_run_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "traffic_abuse_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "traffic_abuse_rules_enabled_idx" ON "traffic_abuse_rules"("enabled");

-- CreateTable
CREATE TABLE "traffic_abuse_states" (
    "id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "window_key" VARCHAR(32) NOT NULL,
    "warned_at" TIMESTAMP(3),
    "last_period_bytes" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "traffic_abuse_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "traffic_abuse_states_subscription_id_rule_id_key" ON "traffic_abuse_states"("subscription_id", "rule_id");

-- CreateIndex
CREATE INDEX "traffic_abuse_states_rule_id_idx" ON "traffic_abuse_states"("rule_id");

-- CreateTable
CREATE TABLE "traffic_abuse_events" (
    "id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "rule_id" TEXT,
    "event_type" VARCHAR(8) NOT NULL,
    "period_bytes" BIGINT,
    "window_key" VARCHAR(32),
    "channels_sent" JSONB,
    "detail" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "traffic_abuse_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "traffic_abuse_events_subscription_id_idx" ON "traffic_abuse_events"("subscription_id");

-- CreateIndex
CREATE INDEX "traffic_abuse_events_event_type_idx" ON "traffic_abuse_events"("event_type");

-- CreateIndex
CREATE INDEX "traffic_abuse_events_created_at_idx" ON "traffic_abuse_events"("created_at" DESC);

-- AddForeignKey
ALTER TABLE "traffic_abuse_states" ADD CONSTRAINT "traffic_abuse_states_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "traffic_abuse_states" ADD CONSTRAINT "traffic_abuse_states_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "traffic_abuse_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "traffic_abuse_events" ADD CONSTRAINT "traffic_abuse_events_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "traffic_abuse_events" ADD CONSTRAINT "traffic_abuse_events_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "traffic_abuse_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
