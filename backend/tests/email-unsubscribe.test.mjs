import assert from "node:assert/strict";
import { mock, test, beforeEach, after } from "node:test";
import express from "express";

const secret = "test-secret-for-email-unsubscribe";
const blocked = new Set();
const deliveries = [];
const telegram = [];
let databaseFailure = false;
let clients = [];
let rule;
let clientQueries = [];
let discountUpdates = 0;
const config = { smtpHost: "smtp.test", smtpPort: 587, smtpFromEmail: "sender@example.test", publicAppUrl: "https://example.test", telegramBotToken: "test-token" };
const prisma = {
  emailUnsubscribe: {
    findUnique: async ({ where }) => { if (databaseFailure) throw new Error("offline"); return blocked.has(where.email) ? { email: where.email } : null; },
    findMany: async () => [...blocked].map(email => ({ email })),
    upsert: async ({ where }) => { if (databaseFailure) throw new Error("offline"); blocked.add(where.email); return { email: where.email }; },
  },
  client: {
    findUnique: async ({ where }) => clients.find(c => c.id === where.id) ?? null,
    findMany: async args => { clientQueries.push(args); return args.skip ? [] : clients; },
    count: async args => { clientQueries.push(args); return clients.length; },
    update: async () => { discountUpdates++; },
  },
  autoBroadcastRule: { findUnique: async () => rule },
  autoBroadcastLog: { findMany: async () => [], create: async () => ({}) },
  subscription: { findFirst: async () => null },
};
mock.module("../dist/db.js", { namedExports: { prisma } });
mock.module("../dist/config/index.js", { namedExports: { env: { JWT_SECRET: secret } } });
mock.module("../dist/modules/client/client.service.js", { namedExports: { getSystemConfig: async () => config } });
mock.module("../dist/modules/proxy-util/get-proxy-url.js", { namedExports: { getProxyUrl: async () => null } });
mock.module("../dist/modules/proxy-util/proxy-fetch.js", { namedExports: { proxyFetch: async (url, options) => { telegram.push({ url, options }); return new Response(JSON.stringify({ ok: true, result: {} })); } } });
mock.module("nodemailer", { defaultExport: { createTransport: () => ({ sendMail: async mail => { deliveries.push(mail); return {}; } }) } });
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (String(url) === "https://api.resend.com/emails") { deliveries.push(JSON.parse(options.body)); return new Response("{}"); }
  return originalFetch(url, options);
};
const { signUnsubscribeToken, readUnsubscribeToken } = await import("../dist/modules/email-unsubscribe/unsubscribe-token.js");
const { sendBroadcastEmail, unsubscribeUrl } = await import("../dist/modules/email-unsubscribe/email-unsubscribe.service.js");
const { sendEmail } = await import("../dist/modules/mail/mail.service.js");
const { emailUnsubscribeRouter } = await import("../dist/modules/email-unsubscribe/email-unsubscribe.routes.js");
const { sendDirectEmail, startListSendJob, getListSendJob, runBroadcast } = await import("../dist/modules/broadcast/broadcast.service.js");
const { runRule, getEligibleTargets } = await import("../dist/modules/auto-broadcast/auto-broadcast.service.js");
const app = express();
app.use(express.urlencoded({ extended: false }));
app.use("/nested/api/public/email-unsubscribe", emailUnsubscribeRouter);
const server = app.listen(0, "127.0.0.1");
await new Promise(resolve => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}/nested/api/public/email-unsubscribe`;
const urlFor = email => `${base}?token=${signUnsubscribeToken(email, secret)}`;
const smtp = { host: "smtp.test", port: 587, fromEmail: "sender@example.test" };
const resend = { ...smtp, provider: "resend", resendApiKey: "test-key" };
beforeEach(() => { blocked.clear(); deliveries.length = 0; telegram.length = 0; clientQueries = []; clients = []; databaseFailure = false; discountUpdates = 0; });
after(async () => { globalThis.fetch = originalFetch; await new Promise(resolve => server.close(resolve)); });

test("tokens normalize addresses and reject tampering, wrong secrets and malformed input", () => {
  const token = signUnsubscribeToken(" User@Example.test ", secret);
  assert.equal(readUnsubscribeToken(token, secret), "user@example.test");
  for (const value of [undefined, [], "", token + ".extra", "x".repeat(1025), token.replace(/^./, "X")]) assert.equal(readUnsubscribeToken(value, secret), null);
  assert.equal(readUnsubscribeToken(token, "another-secret"), null);
  assert.throws(() => signUnsubscribeToken("not an email", secret));
});

test("GET only confirms, POST unsubscribes idempotently, and form works below a URL prefix", async () => {
  const url = urlFor("USER@example.test");
  const first = await fetch(url);
  const html = await first.text();
  assert.equal(first.status, 200);
  assert.match(html, /Отписаться от рассылки\?/);
  assert.match(html, /action="\?token=/);
  assert.equal(blocked.size, 0);
  assert.equal(first.headers.get("cache-control"), "no-store");
  for (let i = 0; i < 2; i++) {
    const response = await fetch(url, { method: "POST", body: new URLSearchParams({ confirm: "1" }) });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Вы отписались/);
  }
  assert.deepEqual([...blocked], ["user@example.test"]);
  assert.match(await (await fetch(url)).text(), /Вы отписались/);
});

test("one-click accepts urlencoded and multipart without login", async () => {
  const multipart = new FormData();
  multipart.set("List-Unsubscribe", "One-Click");
  for (const body of [new URLSearchParams({ "List-Unsubscribe": "One-Click" }), multipart]) {
    blocked.clear();
    assert.equal((await fetch(urlFor("user@example.test"), { method: "POST", body })).status, 200);
    assert.equal(blocked.has("user@example.test"), true);
  }
});

test("invalid tokens, unconfirmed POST and database errors never claim success", async () => {
  assert.equal((await fetch(base + "?token=invalid", { method: "POST", body: new URLSearchParams({ confirm: "1" }) })).status, 400);
  assert.equal((await fetch(urlFor("user@example.test"), { method: "POST" })).status, 400);
  assert.equal(blocked.size, 0);
  databaseFailure = true;
  assert.equal((await fetch(urlFor("user@example.test"))).status, 503);
  assert.equal((await fetch(urlFor("user@example.test"), { method: "POST", body: new URLSearchParams({ confirm: "1" }) })).status, 503);
});

for (const transport of [smtp, resend]) {
  test(`${transport.provider ?? "smtp"}: footer, one-click headers and attachments survive; opt-out blocks broadcasts only`, async () => {
    const attachment = { filename: "test.txt", content: Buffer.from("hello") };
    assert.equal((await sendBroadcastEmail(transport, "https://example.test", " User@example.test ", "news", "<body>Hello</body>", [attachment])).ok, true);
    const mail = deliveries.at(-1);
    assert.match(mail.html, /Отписаться от рассылки/);
    assert.match(mail.html, /Отписаться[\s\S]*<\/body>$/);
    assert.equal(mail.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
    const url = new URL(mail.headers["List-Unsubscribe"].slice(1, -1));
    assert.equal(readUnsubscribeToken(url.searchParams.get("token"), secret), "user@example.test");
    assert.equal(mail.attachments[0].filename, "test.txt");
    blocked.add("user@example.test");
    assert.equal((await sendBroadcastEmail(transport, "https://example.test", "USER@example.test", "news", "hello")).skipped, true);
    assert.equal(deliveries.length, 1);
    assert.equal((await sendEmail(transport, "user@example.test", "Password reset", "Reset password")).ok, true);
    assert.equal(deliveries.length, 2);
    assert.equal(deliveries.at(-1).headers, undefined);
  });
}

test("unsafe or missing public URL and unavailable suppression storage fail closed", async () => {
  for (const url of [null, "", "broken", "http://example.test", "https://user:pass@example.test"]) {
    assert.equal((await sendBroadcastEmail(smtp, url, "user@example.test", "news", "hello")).ok, false);
  }
  assert.equal(new URL(unsubscribeUrl("https://example.test/nested/?old=1#fragment", "user@example.test")).pathname, "/nested/api/public/email-unsubscribe");
  databaseFailure = true;
  assert.equal((await sendBroadcastEmail(smtp, "https://example.test", "user@example.test", "news", "hello")).ok, false);
  assert.equal(deliveries.length, 0);
});

test("direct, list and bulk send all enforce suppression at delivery time", async () => {
  blocked.add("blocked@example.test");
  assert.equal((await sendDirectEmail("BLOCKED@example.test", "news", "hello")).ok, false);
  const { jobId } = startListSendJob(["blocked@example.test", "allowed@example.test"], "hello", { channel: "email" });
  for (let i = 0; i < 100 && !getListSendJob(jobId).done; i++) await new Promise(r => setTimeout(r, 20));
  const job = getListSendJob(jobId);
  assert.equal(job.done, true);
  assert.equal(job.sent, 1);
  assert.equal(job.failed, 1);
  clients = [{ id: "1", email: "BLOCKED@example.test" }, { id: "2", email: "allowed@example.test" }];
  const result = await runBroadcast({ channel: "email", subject: "news", message: "hello" });
  assert.equal(result.sentEmail, 1);
  assert.equal(deliveries.length, 2);
  assert.match(JSON.stringify(clientQueries), /notIn/);
});

test("email opt-out excludes automatic email targets and preserves Telegram in both-channel rules", async () => {
  blocked.add("blocked@example.test");
  clients = [{ id: "1", email: "BLOCKED@example.test", telegramId: "123", isBlocked: false }];
  rule = { id: "rule", name: "test", enabled: true, channel: "email", triggerType: "after_registration", delayDays: 0, message: "hello", _count: { logs: 0 }, personalDiscountPercent: 10 };
  assert.deepEqual(await getEligibleTargets("rule", { onlyClientId: "1" }), []);
  assert.equal((await runRule("rule", { onlyClientId: "1" })).sent, 0);
  assert.equal(discountUpdates, 0);
  rule.channel = "both";
  const result = await runRule("rule", { onlyClientId: "1" });
  assert.equal(result.sent, 1);
  assert.equal(result.skipped, 0);
  assert.equal(result.errors.length, 0);
  assert.equal(telegram.length, 1);
  assert.equal(deliveries.length, 0);
});
