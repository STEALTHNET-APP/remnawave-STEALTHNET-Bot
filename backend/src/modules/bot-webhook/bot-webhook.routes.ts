import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { getSystemConfig, invalidateSystemConfigCache } from "../client/client.service.js";
import { requireAuth } from "../auth/middleware.js";

export const botWebhookRouter = Router();

/**
 * Public Webhook endpoint for Telegram updates:
 * POST /api/bot/webhook
 */
botWebhookRouter.post("/webhook", async (req: Request, res: Response) => {
  try {
    const config = await getSystemConfig();
    const expectedSecret = config.botWebhookSecret?.trim();
    if (expectedSecret) {
      const headerSecret = req.headers["x-telegram-bot-api-secret-token"];
      if (headerSecret !== expectedSecret) {
        return res.status(401).json({ message: "Invalid secret token" });
      }
    }

    // Forward update to the bot internal HTTP listener
    const botUrl = process.env.BOT_INTERNAL_URL || "http://bot:8080/webhook";
    const forwardHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      ...(req.headers["x-telegram-bot-api-secret-token"] && {
        "X-Telegram-Bot-Api-Secret-Token": String(req.headers["x-telegram-bot-api-secret-token"]),
      }),
    };
    const bodyStr = JSON.stringify(req.body);

    let forwardResponse: globalThis.Response;
    try {
      forwardResponse = await fetch(botUrl, {
        method: "POST",
        headers: forwardHeaders,
        body: bodyStr,
      });
    } catch {
      // Быстрый retry при разрыве неактивного (idle) keep-alive сокета:
      // открывает свежее соединение (<3мс), предотвращая потерю первого клика пользователя
      forwardResponse = await fetch(botUrl, {
        method: "POST",
        headers: forwardHeaders,
        body: bodyStr,
      });
    }

    // Check if bot returned a Webhook Reply (JSON payload)
    const contentType = forwardResponse.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const text = await forwardResponse.text().catch(() => "");
      if (text && text.trim().startsWith("{")) {
        res.setHeader("Content-Type", "application/json");
        return res.status(200).send(text);
      }
    }

    return res.status(200).send("OK");
  } catch (err) {
    console.error("[bot-webhook] forwarding error:", err);
    // Return 200 OK to Telegram so it doesn't storm with repeated delivery on internal errors
    return res.status(200).send("OK");
  }
});

/**
 * Admin Webhook management endpoints
 */
export const botWebhookAdminRouter = Router();
botWebhookAdminRouter.use(requireAuth);

botWebhookAdminRouter.get("/status", async (_req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  try {
    const config = await getSystemConfig();
    const token = (config.telegramBotToken || process.env.BOT_TOKEN || "").trim();
    if (!token) {
      return res.status(400).json({ ok: false, error: "Токен бота не задан" });
    }

    const tgRes = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
    const data = (await tgRes.json()) as { ok: boolean; result?: unknown; description?: string };
    if (!data.ok) {
      return res.status(400).json({ ok: false, error: data.description || "Не удалось получить статус вебхука" });
    }

    return res.json({
      ok: true,
      enabled: config.botWebhookEnabled ?? false,
      configuredUrl: config.botWebhookUrl,
      hasSecret: Boolean(config.botWebhookSecret && config.botWebhookSecret.trim().length > 0),
      webhookInfo: data.result,
      checkedAt: new Date().toISOString(),
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

const setWebhookSchema = z.object({
  url: z.string().url(),
  secretToken: z.string().optional(),
  clearSecret: z.boolean().optional(),
  dropPendingUpdates: z.boolean().optional(),
});

botWebhookAdminRouter.post("/set", async (req: Request, res: Response) => {
  try {
    const parsed = setWebhookSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: "Некорректный URL вебхука" });
    }
    const { url, secretToken, clearSecret, dropPendingUpdates } = parsed.data;

    const config = await getSystemConfig();
    const token = (config.telegramBotToken || process.env.BOT_TOKEN || "").trim();
    if (!token) {
      return res.status(400).json({ ok: false, error: "Токен бота не задан" });
    }

    // Retain existing secret if not explicitly cleared or overwritten
    let effectiveSecret = (config.botWebhookSecret || "").trim();
    if (clearSecret) {
      effectiveSecret = "";
    } else if (secretToken !== undefined && secretToken.trim().length > 0) {
      effectiveSecret = secretToken.trim();
    }

    const payload: Record<string, unknown> = {
      url,
      allowed_updates: ["message", "callback_query", "pre_checkout_query", "my_chat_member"],
      drop_pending_updates: Boolean(dropPendingUpdates),
    };
    if (effectiveSecret) {
      payload.secret_token = effectiveSecret;
    }

    const tgRes = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await tgRes.json()) as { ok: boolean; description?: string };
    if (!data.ok) {
      return res.status(400).json({ ok: false, error: data.description || "Ошибка установки вебхука в Telegram" });
    }

    // Save in database
    await prisma.$transaction([
      prisma.systemSetting.upsert({
        where: { key: "bot_webhook_enabled" },
        update: { value: "true" },
        create: { key: "bot_webhook_enabled", value: "true" },
      }),
      prisma.systemSetting.upsert({
        where: { key: "bot_webhook_url" },
        update: { value: url },
        create: { key: "bot_webhook_url", value: url },
      }),
      prisma.systemSetting.upsert({
        where: { key: "bot_webhook_secret" },
        update: { value: effectiveSecret },
        create: { key: "bot_webhook_secret", value: effectiveSecret },
      }),
    ]);
    invalidateSystemConfigCache();

    // Signal bot to switch to webhook mode
    await fetch("http://bot:8080/internal/reload", { method: "POST" }).catch(() => {});

    return res.json({ ok: true, message: "Вебхук успешно установлен" });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

botWebhookAdminRouter.post("/delete", async (req: Request, res: Response) => {
  try {
    const config = await getSystemConfig();
    const token = (config.telegramBotToken || process.env.BOT_TOKEN || "").trim();
    if (!token) {
      return res.status(400).json({ ok: false, error: "Токен бота не задан" });
    }

    const dropPendingUpdates = Boolean(req.body?.dropPendingUpdates);
    const tgRes = await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ drop_pending_updates: dropPendingUpdates }),
    });
    const data = (await tgRes.json()) as { ok: boolean; description?: string };
    if (!data.ok) {
      return res.status(400).json({ ok: false, error: data.description || "Ошибка удаления вебхука в Telegram" });
    }

    await prisma.systemSetting.upsert({
      where: { key: "bot_webhook_enabled" },
      update: { value: "false" },
      create: { key: "bot_webhook_enabled", value: "false" },
    });
    invalidateSystemConfigCache();

    // Signal bot to switch to polling mode
    await fetch("http://bot:8080/internal/reload", { method: "POST" }).catch(() => {});

    return res.json({ ok: true, message: "Вебхук удалён, бот переключён на Long Polling" });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
