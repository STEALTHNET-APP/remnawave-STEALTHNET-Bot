/**
 * SSR-подстановка имени сервиса, описания и OG-тегов в `index.html` на лету.
 *
 * Зачем: meta-теги (<title>, og:title, og:description, og:image, description)
 * захардкожены при сборке фронтенда как «STEALTHNET». Telegram, Twitter, VK и
 * прочие крауллеры читают их статически — JS не выполняют. Поэтому мы
 * рендерим index.html на стороне api и подставляем актуальные данные из
 * `service_name`, `service_description`, `og_image` / `favicon` (Настройки → Брендинг).
 *
 * Frontend dist лежит в общем docker-volume `frontend_dist`, который
 * примонтирован в api как `/var/www/stealthnet:ro`.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Request, Response } from "express";
import { getSystemConfig } from "../client/client.service.js";

const DIST_PATH = process.env.FRONTEND_DIST_PATH || "/var/www/stealthnet";
const INDEX_FILE = path.join(DIST_PATH, "index.html");
const DEFAULT_BRAND = "STEALTHNET";
const DEFAULT_DESC = "STEALTHNET — личный кабинет и админка VPN на базе Remnawave";
const BRAND_PLACEHOLDERS = [DEFAULT_BRAND, "VPN Service"];

interface CachedTemplate {
  raw: string;
  mtimeMs: number;
}

let templateCache: CachedTemplate | null = null;

async function loadTemplate(): Promise<string> {
  const stat = await fs.stat(INDEX_FILE);
  if (templateCache && templateCache.mtimeMs === stat.mtimeMs) {
    return templateCache.raw;
  }
  const raw = await fs.readFile(INDEX_FILE, "utf8");
  templateCache = { raw, mtimeMs: stat.mtimeMs };
  return raw;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export interface BrandValues {
  brand: string;
  description: string;
  ogImage: string | null;
  publicAppUrl: string | null;
}

let brandCache: { at: number; value: BrandValues } | null = null;
const BRAND_TTL_MS = 30_000;

export async function resolveBrand(): Promise<BrandValues> {
  if (brandCache && Date.now() - brandCache.at < BRAND_TTL_MS) return brandCache.value;
  const cfg = await getSystemConfig().catch(() => null);
  const brand = (cfg?.serviceName ?? "").trim() || DEFAULT_BRAND;
  const customDescription = (cfg?.serviceDescription ?? "").trim();
  const description = customDescription ? customDescription :
    brand === DEFAULT_BRAND
      ? DEFAULT_DESC
      : `${brand} — сервис для быстрого и безопасного доступа к интернету`;

  const publicAppUrl = (cfg?.publicAppUrl || "").trim().replace(/\/+$/, "") || null;

  // Приоритет картинки для превью:
  // 1. Кастомный ogImage
  // 2. Фавикон сайта (как просил пользователь: fallback на фавикон)
  // 3. Логотип панели
  // 4. Логотип бота
  const rawImage = ((cfg as { ogImage?: string | null })?.ogImage || cfg?.favicon || cfg?.logo || cfg?.logoBot || "").trim();
  let ogImage: string | null = null;
  if (/^https?:\/\//i.test(rawImage)) {
    ogImage = rawImage;
  } else if (rawImage || publicAppUrl) {
    ogImage = publicAppUrl ? `${publicAppUrl}/api/public/brand/og-image.png` : `/api/public/brand/og-image.png`;
  }

  brandCache = {
    at: Date.now(),
    value: { brand, description, ogImage, publicAppUrl },
  };
  return brandCache.value;
}

/** Сбрасывает кеш бренда — вызывается при сохранении настроек. */
export function invalidateBrandCache() {
  brandCache = null;
}

/** Сбрасывает закешированный шаблон index.html (например, после деплоя). */
export function invalidateTemplateCache() {
  templateCache = null;
}

export function replaceOrInsertMeta(html: string, attrName: string, attrVal: string, content: string): string {
  const regex = new RegExp(`<meta\\s+[^>]*?${attrName}=["']${attrVal}["'][^>]*?>`, "gi");
  const newTag = `<meta ${attrName}="${escapeAttr(attrVal)}" content="${escapeAttr(content)}" />`;
  if (regex.test(html)) {
    return html.replace(regex, newTag);
  }
  return html.replace(/<\/head>/i, `    ${newTag}\n  </head>`);
}

export function renderHtml(tpl: string, b: BrandValues): string {
  let out = tpl;

  // 1. Заменяем бренд-плейсхолдеры в тексте
  for (const placeholder of BRAND_PLACEHOLDERS) {
    out = out.replaceAll(placeholder, escapeHtml(b.brand));
  }

  // 2. Замена или вставка <title>
  if (/<title>.*?<\/title>/i.test(out)) {
    out = out.replace(/<title>.*?<\/title>/i, `<title>${escapeHtml(b.brand)}</title>`);
  } else {
    out = out.replace(/<\/head>/i, `    <title>${escapeHtml(b.brand)}</title>\n  </head>`);
  }

  // 3. Стандартные теги описания и PWA имени
  out = replaceOrInsertMeta(out, "name", "description", b.description);
  out = replaceOrInsertMeta(out, "name", "application-name", b.brand);
  out = replaceOrInsertMeta(out, "name", "apple-mobile-web-app-title", b.brand);

  // 4. OpenGraph теги (Telegram, WhatsApp, VK, Facebook, Discord)
  out = replaceOrInsertMeta(out, "property", "og:title", b.brand);
  out = replaceOrInsertMeta(out, "property", "og:description", b.description);
  out = replaceOrInsertMeta(out, "property", "og:type", "website");
  out = replaceOrInsertMeta(out, "property", "og:site_name", b.brand);
  if (b.publicAppUrl) {
    out = replaceOrInsertMeta(out, "property", "og:url", `${b.publicAppUrl}/`);
  }
  if (b.ogImage) {
    out = replaceOrInsertMeta(out, "property", "og:image", b.ogImage);
  }

  // 5. Twitter Card теги
  out = replaceOrInsertMeta(out, "name", "twitter:title", b.brand);
  out = replaceOrInsertMeta(out, "name", "twitter:description", b.description);
  out = replaceOrInsertMeta(out, "name", "twitter:card", b.ogImage ? "summary_large_image" : "summary");
  if (b.ogImage) {
    out = replaceOrInsertMeta(out, "name", "twitter:image", b.ogImage);
  }

  return out;
}

export async function renderSpaIndex(_req: Request, res: Response) {
  try {
    const [tpl, brand] = await Promise.all([loadTemplate(), resolveBrand()]);
    const html = renderHtml(tpl, brand);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("X-Brand", encodeURIComponent(brand.brand));
    res.send(html);
  } catch (e) {
    console.warn("[spa-html] render failed:", e instanceof Error ? e.message : e);
    res.status(500).type("text/plain").send("SPA template not available yet, please retry");
  }
}
