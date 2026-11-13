import assert from "node:assert/strict";
import { test, before, beforeEach, after, mock } from "node:test";
import { PrismaClient } from "@prisma/client";
const name = process.env.REMINDER_TEST_DATABASE;
if (!name || !/^issue113_test_[a-z0-9_]+$/.test(name)) throw Error("Dedicated test database required");
const url = new URL(process.env.DATABASE_URL); url.pathname = "/" + name;
const db = new PrismaClient({ datasourceUrl: url.href });
let deliveries = [], remote = new Map(), failSend = false, onConfig = null;
const config = { telegramBotToken: "test-token", serviceName: "Test", publicAppUrl: "https://example.invalid" };
mock.module("../dist/db.js", { namedExports: { prisma: db } });
mock.module("../dist/modules/client/client.service.js", { namedExports: { getSystemConfig: async () => { if (onConfig) { const cb = onConfig; onConfig = null; await cb(); } return config; } } });
mock.module("../dist/modules/remna/remna.client.js", { namedExports: { remnaGetUser: async id => typeof remote.get(id) === "function" ? remote.get(id)() : remote.get(id) ?? { error: "offline", status: 503 } } });
mock.module("../dist/modules/email-unsubscribe/email-unsubscribe.service.js", { namedExports: { subscribedEmailFilter: async () => ({ email: { not: null } }), isEmailUnsubscribed: async () => false, sendBroadcastEmail: async () => { throw Error("Unexpected email"); } } });
mock.module("../dist/modules/proxy-util/get-proxy-url.js", { namedExports: { getProxyUrl: async () => null } });
mock.module("../dist/modules/proxy-util/proxy-fetch.js", { namedExports: { proxyFetch: async (url, opts) => {
 assert.match(String(url), /^https:\/\/api\.telegram\.org\/bottest-token\/sendMessage$/);
 deliveries.push(JSON.parse(opts.body));
 return new Response(JSON.stringify(failSend ? { ok: false, description: "retry later" } : { ok: true, result: { message_id: deliveries.length } }), { status: failSend ? 503 : 200 });
} } });
const { getEligibleTargets, runRule } = await import("../dist/modules/auto-broadcast/auto-broadcast.service.js");
const { dispatchAutoRenewNotification: dispatch } = await import("../dist/modules/notification/auto-renew-notifications.service.js");
const date = minutes => new Date(Date.now() + minutes * 60000);
const setRemote = (id, expires) => remote.set(id, { data: { response: { expireAt: expires.toISOString() } } });
async function setup(trigger = "subscription_ending_soon", delayDays = 3) {
 await db.client.create({ data: { id: "client113", telegramId: "11300001" } });
 await db.tariff.create({ data: { id: "tariff113", name: "Test tariff", durationDays: 30, price: 100, currency: "RUB", category: { create: { name: "Test" } } } });
 await db.autoBroadcastRule.create({ data: { id: "rule113", name: "Reminder", triggerType: trigger, delayDays, channel: "telegram", message: "{{TARIFF}} {{SUBSCRIPTION_ID}}", enabled: true } });
}
async function sub(id, expires, extra = {}) {
 const count = await db.subscription.count();
 setRemote(id, expires);
 return db.subscription.create({ data: { id, ownerId: "client113", subscriptionIndex: count, tariffId: "tariff113", remnawaveUuid: id, expireAt: expires, ...extra } });
}
before(async () => { assert.equal(await db.client.count(), 0); });
beforeEach(async () => {
 deliveries = []; remote.clear(); failSend = false; onConfig = null;
 await db.autoBroadcastLog.deleteMany(); await db.autoBroadcastRule.deleteMany();
 await db.subscription.deleteMany(); await db.client.deleteMany(); await db.tariff.deleteMany(); await db.tariffCategory.deleteMany(); await db.autoRenewNotification.deleteMany();
});
after(async () => { await db.$disconnect(); });

test("renewal in Remna suppresses stale three-day reminders and refreshes the local expiry", async () => {
 await setup(); await sub("renewed", date(4000)); const expires = date(90000); setRemote("renewed", expires);
 assert.equal((await runRule("rule113")).sent, 0); assert.equal(deliveries.length, 0);
 assert.equal((await db.subscription.findUniqueOrThrow({ where: { id: "renewed" } })).expireAt.getTime(), expires.getTime());
 assert.equal(await db.autoBroadcastLog.count(), 0);
});

test("expired reminder is also checked against Remna and unavailable Remna never marks delivery", async () => {
 await setup("subscription_expired", 0); await sub("expired", date(-60)); setRemote("expired", date(90000));
 assert.equal((await runRule("rule113")).sent, 0);
 await db.subscription.update({ where: { id: "expired" }, data: { expireAt: date(-60) } }); remote.clear();
 assert.equal((await runRule("rule113")).sent, 0); assert.equal(deliveries.length, 0); assert.equal(await db.autoBroadcastLog.count(), 0);
});

test("a late minute tick catches the reminder once, but never sends after expiration", async () => {
 await setup("subscription_ending_minutes", 15); await sub("late", date(12));
 assert.equal((await runRule("rule113")).sent, 1); assert.equal((await runRule("rule113")).sent, 0);
 assert.equal(deliveries.length, 1);
 await db.autoBroadcastLog.deleteMany(); await db.subscription.update({ where: { id: "late" }, data: { expireAt: date(-1) } }); setRemote("late", date(-1));
 assert.equal((await runRule("rule113")).sent, 0);
});

test("unactivated gifts are excluded from both day and minute reminders", async () => {
 await setup(); await sub("gift", date(4000), { purchasedAsGift: true });
 assert.equal((await getEligibleTargets("rule113")).length, 0);
 await db.autoBroadcastRule.update({ where: { id: "rule113" }, data: { triggerType: "subscription_ending_minutes", delayDays: 15 } });
 await db.subscription.update({ where: { id: "gift" }, data: { expireAt: date(14.5) } });
 assert.equal((await getEligibleTargets("rule113")).length, 0);
});

test("renewal while the batch is being prepared is rechecked before sending", async () => {
 await setup(); await sub("during", date(4000));
 onConfig = async () => { const expires = date(90000); setRemote("during", expires); await db.subscription.update({ where: { id: "during" }, data: { expireAt: expires } }); };
 assert.equal((await runRule("rule113")).sent, 0); assert.equal(deliveries.length, 0);
});

test("every due subscription receives its own message and renewal permits a new cycle", async () => {
 await setup(); await sub("one", date(4000)); await sub("two", date(4100));
 assert.equal((await runRule("rule113")).sent, 2); assert.equal(deliveries.length, 2);
 assert.ok(deliveries.some(d => d.text.includes("one"))); assert.ok(deliveries.some(d => d.text.includes("two")));
 assert.equal((await runRule("rule113")).sent, 0);
 const next = date(4200); setRemote("one", next); await db.subscription.update({ where: { id: "one" }, data: { expireAt: next } });
 assert.equal((await runRule("rule113")).sent, 1);
});

test("failed Telegram delivery remains eligible and is retried", async () => {
 await setup(); await sub("retry", date(4000)); failSend = true;
 assert.equal((await runRule("rule113")).sent, 0); assert.equal(await db.autoBroadcastLog.count(), 0);
 failSend = false; assert.equal((await runRule("rule113")).sent, 1);
});

test("auto-renew templates release their claim when Telegram rejects the message", async () => {
 await setup(); const s = await sub("auto", date(4000), { autoRenewEnabled: true });
 await db.autoRenewNotification.create({ data: { id: "arn113", name: "Upcoming", triggerType: "UPCOMING", offsetMinutes: 4320, messageText: "Expires {expire_date}", enabled: true } });
 const ctx = { tariffName: "Test", amount: 100, currency: "RUB", minutesLeft: 4000, expireAt: s.expireAt, dedupKeyForSec: { secondarySubscriptionId: s.id } };
 failSend = true; assert.equal(await dispatch("client113", "UPCOMING", ctx), 0);
 failSend = false; assert.equal(await dispatch("client113", "UPCOMING", ctx), 1);
 assert.equal(await dispatch("client113", "UPCOMING", ctx), 0); assert.equal(deliveries.length, 2);
});


test("overlapping runs do not send the same reminder twice", async () => {
 await setup(); await sub("overlap", date(4000));
 await Promise.all([runRule("rule113"), runRule("rule113")]);
 assert.equal(deliveries.length, 1); assert.equal(await db.autoBroadcastLog.count(), 1);
});

test("an old Remna response cannot overwrite a renewal saved during the request", async () => {
 await setup(); const old = date(4000), fresh = date(90000); await sub("cas", old);
 remote.set("cas", async () => {
   await db.subscription.update({ where: { id: "cas" }, data: { expireAt: fresh } });
   return { data: { response: { expireAt: old.toISOString() } } };
 });
 assert.equal((await runRule("rule113")).sent, 0); assert.equal(deliveries.length, 0);
 assert.equal((await db.subscription.findUniqueOrThrow({ where: { id: "cas" } })).expireAt.getTime(), fresh.getTime());
});

test("invalid Remna dates are not sent or marked as delivered", async () => {
 await setup(); await sub("invalid", date(4000));
 for (const expireAt of [null, "invalid", 0]) {
   remote.set("invalid", { data: { response: { expireAt } } });
   const result = await runRule("rule113"); assert.equal(result.sent, 0); assert.equal(result.errors.length, 1);
 }
 assert.equal(deliveries.length, 0); assert.equal(await db.autoBroadcastLog.count(), 0);
});

test("legacy auto-renew delivery retries without erasing other template markers", async () => {
 await setup();
 await db.client.update({ where: { id: "client113" }, data: { lastArnNotifiedKey: JSON.stringify({ other: "keep" }) } });
 await db.autoRenewNotification.create({ data: { id: "root113", name: "Upcoming", triggerType: "UPCOMING", offsetMinutes: 4320, messageText: "Expires {expire_date}", enabled: true } });
 const ctx = { tariffName: "Test", amount: 100, currency: "RUB", minutesLeft: 4000, expireAt: date(4000), dedupKeyForRoot: { clientId: "client113" } };
 failSend = true; assert.equal(await dispatch("client113", "UPCOMING", ctx), 0);
 const client = await db.client.findUniqueOrThrow({ where: { id: "client113" } });
 assert.deepEqual(JSON.parse(client.lastArnNotifiedKey), { other: "keep" });
 failSend = false; assert.equal(await dispatch("client113", "UPCOMING", ctx), 1);
 assert.equal(await dispatch("client113", "UPCOMING", ctx), 0);
});
