/**
 * Публичные image-ассеты для rich-сообщений бота (Telegram Bot API 10.1).
 *
 * Telegram rich `![](url)` требует ПУБЛИЧНЫЙ URL, отдающий реальные байты картинки
 * (file_id и data-URL прямо в markdown НЕ работают — RICH_MESSAGE_PHOTO_URL_INVALID /
 * RICH_MESSAGE_PHOTO_NO_MEDIA_FOUND). Логотип в настройках хранится как data-URL
 * base64 → этот роутер декодит его и отдаёт как image/*, чтобы Telegram мог зафетчить.
 *
 * Монтируется на /api/public (см. app.ts) → итоговый URL:
 *   https://<DOMAIN>/api/public/bot-asset/logo.png
 */
import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { getSystemConfig } from "./client.service.js";

export const botAssetsRouter = Router();

botAssetsRouter.get("/bot-asset/logo.png", async (_req, res) => {
  try {
    // logoBot = «Логотип бота» из админки (БД: logo_bot). Приоритет ему,
    // botWelcomeImage (приветственный баннер) — fallback.
    const config = (await getSystemConfig()) as { logoBot?: string | null; botWelcomeImage?: string | null };
    const logo = (config.logoBot || config.botWelcomeImage || "").trim();
    if (!logo) return res.status(404).send("no logo configured");

    // data:image/<subtype>;base64,<payload>
    const dataUrl = /^data:image\/([a-z0-9.+-]+);base64,(.+)$/i.exec(logo);
    if (dataUrl) {
      const subtype = (dataUrl[1] || "png").toLowerCase();
      const buf = Buffer.from(dataUrl[2]!, "base64");
      if (!buf.length) return res.status(404).send("empty logo");
      res.set("Content-Type", `image/${subtype === "jpg" ? "jpeg" : subtype}`);
      res.set("Cache-Control", "public, max-age=300");
      return res.send(buf);
    }

    // http(s) URL → проксируем байты с нашего домена (Telegram фетчит отсюда)
    if (/^https?:\/\//i.test(logo)) {
      const upstream = await fetch(logo);
      if (!upstream.ok) return res.status(404).send("logo fetch failed");
      const ct = upstream.headers.get("content-type") || "image/png";
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.set("Content-Type", ct);
      res.set("Cache-Control", "public, max-age=300");
      return res.send(buf);
    }

    // голый base64 без data-URL префикса
    try {
      const buf = Buffer.from(logo, "base64");
      if (buf.length) {
        res.set("Content-Type", "image/png");
        res.set("Cache-Control", "public, max-age=300");
        return res.send(buf);
      }
    } catch {
      /* ignore */
    }

    return res.status(404).send("unsupported logo format");
  } catch (e) {
    console.error("[bot-asset/logo] error:", e instanceof Error ? e.message : e);
    return res.status(500).send("error");
  }
});

/**
 * Публичный эндпоинт для OpenGraph / Telegram link preview изображения.
 * Telegram требует реальный URL с байтами картинки (не data-URL).
 * Приоритет: кастомный ogImage -> фавикон (favicon) -> логотип (logo) -> apple-touch-icon.png
 */
botAssetsRouter.get(["/brand/og-image.png", "/bot-asset/og-image.png"], async (_req, res) => {
  try {
    const config = (await getSystemConfig()) as {
      ogImage?: string | null;
      favicon?: string | null;
      logo?: string | null;
      logoBot?: string | null;
    };
    const image = (config.ogImage || config.favicon || config.logo || config.logoBot || "").trim();

    if (!image) {
      const distPath = process.env.FRONTEND_DIST_PATH || "/var/www/stealthnet";
      const fallbackApple = path.join(distPath, "apple-touch-icon.png");
      const fallback512 = path.join(distPath, "icon-512.png");
      if (fs.existsSync(fallbackApple)) {
        res.set("Content-Type", "image/png");
        res.set("Cache-Control", "public, max-age=3600");
        return res.sendFile(fallbackApple);
      }
      if (fs.existsSync(fallback512)) {
        res.set("Content-Type", "image/png");
        res.set("Cache-Control", "public, max-age=3600");
        return res.sendFile(fallback512);
      }
      return res.status(404).send("no og image configured");
    }

    const dataUrl = /^data:image\/([a-z0-9.+-]+);base64,(.+)$/i.exec(image);
    if (dataUrl) {
      const subtype = (dataUrl[1] || "png").toLowerCase();
      const buf = Buffer.from(dataUrl[2]!, "base64");
      if (!buf.length) return res.status(404).send("empty og image");
      res.set("Content-Type", `image/${subtype === "jpg" ? "jpeg" : subtype}`);
      res.set("Cache-Control", "public, max-age=300");
      return res.send(buf);
    }

    if (/^https?:\/\//i.test(image)) {
      const upstream = await fetch(image);
      if (!upstream.ok) return res.status(404).send("og image fetch failed");
      const ct = upstream.headers.get("content-type") || "image/png";
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.set("Content-Type", ct);
      res.set("Cache-Control", "public, max-age=300");
      return res.send(buf);
    }

    try {
      const buf = Buffer.from(image, "base64");
      if (buf.length) {
        res.set("Content-Type", "image/png");
        res.set("Cache-Control", "public, max-age=300");
        return res.send(buf);
      }
    } catch {
      /* ignore */
    }

    return res.status(404).send("unsupported og image format");
  } catch (e) {
    console.error("[brand/og-image] error:", e instanceof Error ? e.message : e);
    return res.status(500).send("error");
  }
});
