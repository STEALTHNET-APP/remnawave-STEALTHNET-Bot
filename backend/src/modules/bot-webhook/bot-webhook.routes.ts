import { Router } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "../../db.js";
import { getSystemConfig, invalidateSystemConfigCache } from "../client/client.service.js";
import { requireAuth, requireAdminSection } from "../auth/middleware.js";
import { botInternalUrl, forwardBotUpdate, internalBotCredential, matchesSecret, validTelegramUpdate } from "./bot-webhook.transport.js";

export const botWebhookRouter = Router();
const runtimeCredential = () => internalBotCredential((process.env.BOT_TOKEN || "").trim());

botWebhookRouter.get("/runtime", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!matchesSecret(runtimeCredential(), req.headers["x-bot-internal-auth"])) return res.sendStatus(401);
  try {
    invalidateSystemConfigCache();
    const config = await getSystemConfig();
    const configuredToken = (config.telegramBotToken || process.env.BOT_TOKEN || "").trim();
    if (configuredToken !== (process.env.BOT_TOKEN || "").trim()) return res.status(409).json({ message: "Токен процесса бота отличается от токена панели. Обновите BOT_TOKEN и перезапустите бот." });
    return res.json({ enabled: config.botWebhookEnabled, url: config.botWebhookUrl, secret: config.botWebhookSecret });
  } catch {
    return res.sendStatus(503);
  }
});

botWebhookRouter.post("/webhook", async (req, res) => {
  try {
    const config = await getSystemConfig();
    if (!config.botWebhookEnabled) return res.sendStatus(503);
    if (!matchesSecret(config.botWebhookSecret || "", req.headers["x-telegram-bot-api-secret-token"])) return res.sendStatus(401);
    if (!validTelegramUpdate(req.body)) return res.sendStatus(400);
    const credential = runtimeCredential();
    if (!credential) return res.sendStatus(503);
    const delivered = await forwardBotUpdate(req.body, credential);
    return res.status(delivered ? 200 : 503).send(delivered ? "OK" : "Delivery failed");
  } catch {
    console.error("[bot-webhook] delivery failed; awaiting Telegram retry");
    return res.sendStatus(503);
  }
});

export const botWebhookAdminRouter = Router();
botWebhookAdminRouter.use(requireAuth, requireAdminSection);

botWebhookAdminRouter.get("/status", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const config = await getSystemConfig();
    const token = (config.telegramBotToken || process.env.BOT_TOKEN || "").trim();
    if (!token) return res.status(400).json({ ok: false, message: "Токен бота не задан" });
    const response = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`, { signal: AbortSignal.timeout(10_000) });
    const data = await response.json() as { ok: boolean; result?: unknown };
    if (!response.ok || !data.ok) return res.status(502).json({ ok: false, message: "Не удалось получить статус Telegram" });
    const runtime = await fetch(botInternalUrl("/health"), {
      headers: { "X-Bot-Internal-Auth": runtimeCredential() }, signal: AbortSignal.timeout(3000),
    }).then(async response => response.ok ? response.json() : null).catch(() => null) as { mode?: string } | null;
    return res.json({ ok: true, enabled: config.botWebhookEnabled, configuredUrl: config.botWebhookUrl, hasSecret: !!config.botWebhookSecret, runtimeMode: runtime?.mode ?? "unavailable", webhookInfo: data.result, checkedAt: new Date().toISOString() });
  } catch {
    return res.status(503).json({ ok: false, message: "Не удалось проверить соединение с Telegram" });
  }
});

const setWebhookSchema = z.object({
  url: z.string().url().refine(value => {
    const url = new URL(value);
    return url.protocol === "https:" && url.pathname === "/api/bot/webhook" && !url.username && !url.password && !url.search && !url.hash;
  }),
  secretToken: z.string().trim().regex(/^[A-Za-z0-9_-]{1,256}$/).optional(),
}).strict();

async function reloadBot(expected: "polling" | "webhook") {
  const response = await fetch(botInternalUrl("/internal/reload"), {
    method: "POST", headers: { "X-Bot-Internal-Auth": runtimeCredential() }, signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json() as { ok?: boolean; mode?: string };
  if (!response.ok || !result.ok || result.mode !== expected) throw new Error("Mode not confirmed");
}

botWebhookAdminRouter.post("/set", async (req, res) => {
  const parsed = setWebhookSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, message: "Укажите HTTPS-адрес панели с путём /api/bot/webhook. Секрет: 1–256 латинских букв, цифр, _ или -." });
  try {
    const config = await getSystemConfig();
    if (!runtimeCredential() || (config.telegramBotToken || process.env.BOT_TOKEN || "").trim() !== (process.env.BOT_TOKEN || "").trim()) return res.status(409).json({ ok: false, message: "Проверьте BOT_TOKEN: процесс бота и панель должны использовать один токен." });
    const secret = parsed.data.secretToken || config.botWebhookSecret || randomBytes(32).toString("hex");
    const settings = { bot_webhook_enabled: "true", bot_webhook_url: parsed.data.url, bot_webhook_secret: secret };
    await prisma.$transaction(Object.entries(settings).map(([key, value]) => prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } })));
    invalidateSystemConfigCache();
    await reloadBot("webhook");
    return res.json({ ok: true, message: "Бот подтвердил переключение на Webhook" });
  } catch {
    return res.status(503).json({ ok: false, message: "Переключение не подтверждено. Проверьте статус и доступность бота, затем повторите. Очередь сообщений сохранена." });
  }
});

botWebhookAdminRouter.post("/delete", async (_req, res) => {
  try {
    if (!runtimeCredential()) return res.status(409).json({ ok: false, message: "BOT_TOKEN не задан" });
    await prisma.systemSetting.upsert({ where: { key: "bot_webhook_enabled" }, create: { key: "bot_webhook_enabled", value: "false" }, update: { value: "false" } });
    invalidateSystemConfigCache();
    await reloadBot("polling");
    return res.json({ ok: true, message: "Вебхук удалён, бот подтвердил запуск Long Polling" });
  } catch {
    return res.status(503).json({ ok: false, message: "Переключение не подтверждено. Проверьте статус и повторите. Очередь сообщений сохранена." });
  }
});
