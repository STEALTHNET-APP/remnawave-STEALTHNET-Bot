import { Router, type Request } from "express";
import { z } from "zod";
import { prisma, asClientWhere, asClientSelect, type ClientEmptyCloneRow } from "../../db.js";
import { mergeClients, isBotOnlyAccount } from "./merge-clients.service.js";
import { getSystemConfig, getPublicConfig } from "./client.service.js";
import { probeRemnaHealth } from "../remna/remna.client.js";
import { applyMarkup } from "../bot/bot.service.js";
import { optionalBot, type ReqWithBot } from "../bot/bot.middleware.js";

// Публичный конфиг для бота, mini app, сайта (без паролей и секретов)
export const publicConfigRouter = Router();
publicConfigRouter.get("/availability", async (_req, res, next) => {
  try {
    const config = await getSystemConfig();
    res.setHeader("Cache-Control", "no-store");
    return res.json({ enabled: config.maintenanceEnabled, message: config.maintenanceMessage });
  } catch (error) { next(error); }
});

publicConfigRouter.use(optionalBot);
publicConfigRouter.get("/config", async (req, res) => {
  const bot = (req as Request & Partial<ReqWithBot>).bot;
  const config = await getPublicConfig(bot ?? null);
  return res.json(config);
});

/**
 * Динамический PWA-манифест.
 *
 * Статический /manifest.webmanifest содержит дефолтные иконки и имя
 * «STEALTHNET». Этот эндпоинт строит манифест на лету с пользовательским
 * serviceName и favicon. Frontend в App.tsx переключает <link rel="manifest">
 * на /api/public/manifest.webmanifest когда custom favicon задан.
 *
 * Кэш 60 сек — баланс между актуальностью после save и нагрузкой
 * (Chrome дёргает URL каждый раз при show install banner).
 */
publicConfigRouter.get("/manifest.webmanifest", async (_req, res) => {
  try {
    const cfg = (await getSystemConfig().catch(() => null)) as { serviceName?: string | null; serviceDescription?: string | null; favicon?: string | null } | null;
    const brand = (cfg?.serviceName ?? "").trim() || "STEALTHNET";
    const description = (cfg?.serviceDescription ?? "").trim() || `${brand} — личный кабинет и админка VPN`;
    const favicon = (cfg?.favicon ?? "").trim() || null;

    const icons = favicon
      ? [
          { src: favicon, sizes: "192x192", type: "image/png", purpose: "any" },
          { src: favicon, sizes: "512x512", type: "image/png", purpose: "any" },
          { src: favicon, sizes: "512x512", type: "image/png", purpose: "maskable" },
        ]
      : [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ];
    const shortcutIcon = favicon ?? "/icon-192.png";

    const manifest = {
      name: brand,
      short_name: brand.length <= 12 ? brand : brand.slice(0, 12),
      lang: "ru",
      description,
      start_url: "/cabinet",
      scope: "/",
      display: "standalone",
      orientation: "portrait",
      background_color: "#0f172a",
      theme_color: "#0f172a",
      categories: ["productivity", "utilities"],
      icons,
      shortcuts: [
        { name: "Кабинет", short_name: "Кабинет", description: "Личный кабинет: тарифы, подписки, подключения", url: "/cabinet", icons: [{ src: shortcutIcon, sizes: "192x192" }] },
        { name: "Админка", short_name: "Админ", description: "Управление клиентами и тарифами", url: "/admin", icons: [{ src: shortcutIcon, sizes: "192x192" }] },
      ],
    };

    res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=60");
    return res.json(manifest);
  } catch (e) {
    console.error("[manifest] render failed:", e);
    return res.status(500).type("text/plain").send("Failed to render manifest");
  }
});

/**
 * Промежуточная страница для диплинков: открывается через Telegram.WebApp.openLink() в системном браузере,
 * который уже может обработать кастомную URL-схему (happ://, stash://, v2rayng:// и т.д.).
 * В Telegram Mini App WebView кастомные схемы заблокированы — это единственный рабочий обходной путь.
 */
publicConfigRouter.get("/deeplink", (req, res) => {
  const url = typeof req.query.url === "string" ? req.query.url : "";
  if (!url) return res.status(400).send("Missing url parameter");
  // 🔒 SECURITY: reflected XSS fix (CSP в helmet отключён). В легитимных диплинках нет
  // символов < > " ' ` / переводов строк и они не бывают javascript:/data:/vbscript:.
  if (/[<>"'`\r\n]/.test(url) || /^\s*(javascript|data|vbscript):/i.test(url)) {
    return res.status(400).send("Invalid url");
  }
  const skipAuto = req.query.skip_auto === "1" || req.query.skip_auto === "true";
  const safeUrl = url.replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const safeUrlJs = JSON.stringify(url).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
  const autoRedirectScript = skipAuto
    ? "/* skip_auto: только кнопка, без авто-редиректа (из мини-аппа) */"
    : `setTimeout(function(){ try { window.location.href = ${safeUrlJs}; } catch (e) {} }, 300);`;
  const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Открытие приложения…</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0d1117;color:#e6edf3;padding:16px;box-sizing:border-box}
  .btn{display:inline-block;margin-top:24px;padding:14px 32px;background:#2ea043;color:#fff;border:none;border-radius:12px;font-size:17px;text-decoration:none;cursor:pointer}
  .btn:active{opacity:.85}
  .sub{margin-top:16px;font-size:13px;color:#8b949e;max-width:90%;text-align:center;word-break:break-all}
  .hint{margin-top:12px;font-size:12px;color:#8b949e;max-width:90%;text-align:center}
</style>
</head><body>
<p>Открываем приложение…</p>
<a class="btn" href="${safeUrl}" id="open">Открыть приложение</a>
<p class="sub">Если приложение не открылось — нажмите кнопку выше.<br>Ссылка подписки скопирована в буфер обмена.</p>
<p class="hint" id="androidHint" style="display:none">На Android или в Telegram на ПК: если страница открылась внутри Telegram, зайдите в Настройки → Чаты → «Открывать ссылки во внешнем браузере» и нажмите кнопку ещё раз.</p>
<script>
  (function(){
    var ua = navigator.userAgent || "";
    if (/Android|Windows|tdesktop/i.test(ua)) document.getElementById("androidHint").style.display = "block";
    ${autoRedirectScript}
  })();
</script>
</body></html>`;
  res.type("html").send(html);
});

/** Привязка Telegram к аккаунту по коду (вызывается ботом после /link КОД) */
const linkTelegramFromBotSchema = z.object({
  code: z.string().min(1),
  telegramId: z.number(),
  telegramUsername: z.string().optional(),
});
publicConfigRouter.post("/link-telegram-from-bot", async (req, res) => {
  // v5.0.0: токен один (основной BOT_TOKEN).
  const headerToken = typeof req.headers["x-telegram-bot-token"] === "string" ? req.headers["x-telegram-bot-token"].trim() : "";
  const expectedToken = (process.env.BOT_TOKEN ?? "").trim();
  if (!headerToken || !expectedToken || headerToken !== expectedToken) {
    return res.status(401).json({ message: "Требуется авторизация" });
  }
  const body = linkTelegramFromBotSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Проверьте введённые данные", errors: body.error.flatten() });
  const { code, telegramId, telegramUsername } = body.data;
  const tid = String(telegramId);
  const pending = await prisma.pendingTelegramLink.findUnique({ where: { code: code.trim() } });
  if (!pending) return res.status(400).json({ message: "Неверный или просроченный код" });
  if (new Date() > pending.expiresAt) {
    await prisma.pendingTelegramLink.deleteMany({ where: { id: pending.id } }).catch(() => {});
    return res.status(400).json({ message: "Код истёк. Запросите новый в кабинете." });
  }
  const other = (await prisma.client.findFirst({
    where: asClientWhere({ telegramId: tid}),
    select: asClientSelect({
      id: true,
      email: true,
      passwordHash: true,
      googleId: true,
      appleId: true,
      remnawaveUuid: true,
      balance: true,
      _count: { select: { payments: true, ownedSubscriptions: true } },
    }),
  })) as ClientEmptyCloneRow | null;
  if (other && other.id !== pending.clientId) {
    // Второй аккаунт с этим telegramId. Сливаем в инициатора (владельца кода),
    // если TG-аккаунт НЕ является самостоятельной web-идентичностью (нет email/пароля/OAuth):
    //   - «пустой клон» (нажал /start до ввода кода) — сливается;
    //   - бот-аккаунт С подписками/балансом/платежами — тоже сливается (схема Алекса:
    //     подписки, баланс и рефералы объединяются, дубль удаляется).
    // Если у TG-аккаунта есть email/OAuth — это полноценный отдельный аккаунт, отказ.
    if (!isBotOnlyAccount(other)) {
      await prisma.pendingTelegramLink.deleteMany({ where: { id: pending.id } }).catch(() => {});
      return res.status(409).json({ message: "Этот Telegram-аккаунт уже привязан к другому аккаунту с почтой. Войдите в тот аккаунт и отвяжите Telegram, либо обратитесь в поддержку." });
    }
    try {
      await mergeClients(pending.clientId, other.id, {
        telegramId: tid,
        telegramUsername: (telegramUsername ?? "").trim() || null,
      });
    } catch (e) {
      console.error("[link-telegram-from-bot] merge failed:", e);
      await prisma.pendingTelegramLink.deleteMany({ where: { id: pending.id } }).catch(() => {});
      return res.status(500).json({ message: "Не удалось объединить аккаунты. Обратитесь в поддержку." });
    }
  } else {
    await prisma.client.update({
      where: { id: pending.clientId },
      data: { telegramId: tid, telegramUsername: (telegramUsername ?? "").trim() || null },
    });
  }
  await prisma.pendingTelegramLink.deleteMany({ where: { id: pending.id } }).catch(() => {});
  return res.json({ message: "Telegram привязан" });
});

/** Конфиг страницы подписки (приложения по платформам, тексты) — для кабинета /cabinet/subscribe */
publicConfigRouter.get("/subscription-page", async (_req, res) => {
  try {
    const row = await prisma.systemSetting.findUnique({
      where: { key: "subscription_page_config" },
    });
    if (!row?.value) return res.json(null);
    const parsed = JSON.parse(row.value) as unknown;
    return res.json(parsed);
  } catch {
    return res.json(null);
  }
});

function tariffToJson(
  t: {
    id: string;
    name: string;
    description: string | null;
    durationDays: number;
    internalSquadUuids: string[];
    trafficLimitBytes: bigint | null;
    trafficResetMode?: string;
    deviceLimit: number | null;
    includedDevices?: number;
    pricePerExtraDevice?: number;
    maxExtraDevices?: number;
    deviceDiscountTiers?: unknown;
    price: number;
    currency: string;
    locations?: string | null; // T11+T12 (11.05.2026): rich-text список локаций
    menuEmoji?: string | null; // T16: эмодзи-префикс для витрины кабинета (задаётся в /admin/tariffs)
    priceOptions?: { id: string; durationDays: number; price: number; sortOrder: number }[];
  },
  markupPercent = 0,
) {
  const m = (n: number) => applyMarkup(n, markupPercent);
  return {
    id: t.id,
    name: t.name,
    description: t.description ?? null,
    durationDays: t.durationDays,
    trafficLimitBytes: t.trafficLimitBytes != null ? Number(t.trafficLimitBytes) : null,
    trafficResetMode: t.trafficResetMode ?? "no_reset",
    deviceLimit: t.deviceLimit,
    includedDevices: t.includedDevices ?? 1,
    pricePerExtraDevice: m(t.pricePerExtraDevice ?? 0),
    maxExtraDevices: t.maxExtraDevices ?? 0,
    deviceDiscountTiers: Array.isArray(t.deviceDiscountTiers)
      ? (t.deviceDiscountTiers as { minExtraDevices: number; discountPercent: number }[])
      : [],
    price: m(t.price),
    currency: t.currency,
    // Эмодзи тарифа для витрины кабинета (админ задаёт в /admin/tariffs).
    menuEmoji: (t.menuEmoji ?? "").trim() || null,
    // локации тарифа отдаются клиенту/боту.
    locations: t.locations ?? null,
    priceOptions: (t.priceOptions ?? []).map((o) => ({
      id: o.id,
      durationDays: o.durationDays,
      price: m(o.price),
      sortOrder: o.sortOrder,
    })),
  };
}

publicConfigRouter.get("/tariffs", async (req, res) => {
  try {
    const markupPct = (req as Request & Partial<ReqWithBot>).bot?.markupPercent ?? 0;
    const config = await getSystemConfig();
    const categoryEmojis = config.categoryEmojis ?? { ordinary: "📦", premium: "⭐" };
    const list = await prisma.tariffCategory.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: {
        tariffs: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          include: {
            priceOptions: { orderBy: [{ sortOrder: "asc" }, { durationDays: "asc" }] },
          },
        },
      },
    });
    return res.json({
      items: list.map((c) => {
        const emoji = (c.emojiKey && categoryEmojis[c.emojiKey]) ? categoryEmojis[c.emojiKey] : "";
        return {
          id: c.id,
          name: c.name,
          emojiKey: c.emojiKey ?? null,
          emoji,
          // UI показывает предупреждение о конвертации при покупке из single-категории.
          singleSubscriptionMode: c.singleSubscriptionMode,
          tariffs: c.tariffs.map((t) => tariffToJson(t, markupPct)),
        };
      }),
      remnaAvailable: await probeRemnaHealth(),
    });
  } catch (e) {
    console.error("GET /public/tariffs error:", e);
    return res.status(500).json({ message: "Ошибка загрузки тарифов" });
  }
});

// GET /api/public/proxy-tariffs — публичный список тарифов прокси (для бота и кабинета)
publicConfigRouter.get("/proxy-tariffs", async (req, res) => {
  try {
    const markupPct = (req as Request & Partial<ReqWithBot>).bot?.markupPercent ?? 0;
    const list = await prisma.proxyCategory.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: { tariffs: { where: { enabled: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
    });
    return res.json({
      items: list.map((c) => ({
        id: c.id,
        name: c.name,
        sortOrder: c.sortOrder,
        tariffs: c.tariffs.map((t) => ({
          id: t.id,
          name: t.name,
          proxyCount: t.proxyCount,
          durationDays: t.durationDays,
          trafficLimitBytes: t.trafficLimitBytes?.toString() ?? null,
          connectionLimit: t.connectionLimit,
          price: applyMarkup(t.price, markupPct),
          currency: t.currency,
        })),
      })),
    });
  } catch (e) {
    console.error("GET /public/proxy-tariffs error:", e);
    return res.status(500).json({ message: "Ошибка загрузки тарифов прокси" });
  }
});

// GET /api/public/singbox-tariffs — публичный список тарифов Sing-box (для бота и кабинета)
publicConfigRouter.get("/singbox-tariffs", async (req, res) => {
  try {
    const markupPct = (req as Request & Partial<ReqWithBot>).bot?.markupPercent ?? 0;
    const list = await prisma.singboxCategory.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: { tariffs: { where: { enabled: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
    });
    return res.json({
      items: list.map((c) => ({
        id: c.id,
        name: c.name,
        sortOrder: c.sortOrder,
        tariffs: c.tariffs.map((t) => ({
          id: t.id,
          name: t.name,
          protocol: t.protocol,
          slotCount: t.slotCount,
          durationDays: t.durationDays,
          trafficLimitBytes: t.trafficLimitBytes?.toString() ?? null,
          price: applyMarkup(t.price, markupPct),
          currency: t.currency,
        })),
      })),
    });
  } catch (e) {
    console.error("GET /public/singbox-tariffs error:", e);
    return res.status(500).json({ message: "Ошибка загрузки тарифов Sing-box" });
  }
});
