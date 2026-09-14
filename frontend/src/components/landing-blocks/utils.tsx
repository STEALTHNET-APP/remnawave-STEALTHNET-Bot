/**
 * Общие утилиты блоков: UTM-капчер, лейаут-помощники, акцентные стили.
 */

import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useTheme } from "@/contexts/theme";

interface LandingAccentTheme {
  primary: string;
  secondary: string;
  tertiary: string;
  /** Фон CTA-кнопок/баннеров: градиент в тёмной теме, сплошной primary в светлой. */
  ctaBg: string;
  /** Цвет текста НА ctaBg/primary-поверхностях — выбран по контрасту (WCAG AA). */
  ctaFg: string;
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(c * 255);
  };
  return { r: f(0), g: f(8), b: f(4) };
}

function relLuminance(c: { r: number; g: number; b: number }): number {
  const f = (v: number) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

function contrastRatio(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): number {
  const la = relLuminance(a), lb = relLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const WHITE = { r: 255, g: 255, b: 255 };
const DARK_FG = { r: 11, g: 13, b: 18 }; // #0B0D12

/** Из CSS-токена "--primary" ("344 100% 57%") собирает HSL-строку и RGB. */
function parsePrimaryToken(raw: string): { css: string; rgb: { r: number; g: number; b: number } } | null {
  const m = raw.trim().match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
  if (!m) return null;
  const [, h, s, l] = m;
  return {
    css: `hsl(${h} ${s}% ${l}%)`,
    rgb: hslToRgb(parseFloat(h), parseFloat(s) / 100, parseFloat(l) / 100),
  };
}

function mixWithWhite(rgb: { r: number; g: number; b: number }, t: number): string {
  const c = (v: number) => Math.round(v + (255 - v) * t);
  return `rgb(${c(rgb.r)} ${c(rgb.g)} ${c(rgb.b)})`;
}

/**
 * Акцентная палитра лендинга, выведенная из РЕАЛЬНЫХ токенов темы (--primary),
 * а не из жёстко зашитых цветов: подсветка/иконки/CTA совпадают с брендом кабинета.
 * ctaFg выбирается автоматом: какой из белого/#0B0D12 даёт лучший контраст на primary.
 */
export function useLandingTheme() {
  const { resolvedMode } = useTheme();
  const dark = resolvedMode === "dark";
  const raw = typeof document !== "undefined"
    ? getComputedStyle(document.documentElement).getPropertyValue("--primary")
    : "";
  const primary = parsePrimaryToken(raw) ?? { css: "hsl(344 100% 57%)", rgb: hslToRgb(344, 1, 0.57) };
  const tertiary = mixWithWhite(primary.rgb, dark ? 0.45 : 0.2);
  const secondary = mixWithWhite(primary.rgb, dark ? 0.2 : 0.1);
  const ctaFg = contrastRatio(WHITE, primary.rgb) >= contrastRatio(DARK_FG, primary.rgb) ? "#FFFFFF" : "#0B0D12";
  const accentTheme: LandingAccentTheme = {
    primary: primary.css,
    secondary,
    tertiary,
    // Светлая тема: tertiary-микс осветляет фон до контраста < 4.5 для белого текста,
    // поэтому кнопка остаётся сплошной primary; тёмная — мягкий градиент.
    ctaBg: dark ? `linear-gradient(135deg, ${primary.css}, ${tertiary})` : primary.css,
    ctaFg,
  };
  return { accentTheme, resolvedMode };
}

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;
const UTM_STORAGE_KEY = "stealthnet_utm";

/**
 * Сохраняет UTM-метки из URL в localStorage и возвращает builder ссылок,
 * который добавляет сохранённые UTM к любой относительной ссылке.
 * Применяется ко всем CTA-кнопкам лендинга.
 */
export function useUtmCaptureAndBuildLink() {
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const fromUrl: Partial<Record<(typeof UTM_KEYS)[number], string>> = {};
    for (const key of UTM_KEYS) {
      const v = searchParams.get(key);
      if (v) fromUrl[key] = v;
    }
    if (Object.keys(fromUrl).length === 0) return;
    try {
      const raw = localStorage.getItem(UTM_STORAGE_KEY);
      const existing = raw ? (JSON.parse(raw) as Record<string, string>) : {};
      localStorage.setItem(UTM_STORAGE_KEY, JSON.stringify({ ...existing, ...fromUrl }));
    } catch {
      // ignore corrupt storage
    }
  }, [searchParams]);

  return useMemo(() => {
    return (path: string) => {
      try {
        const stored = localStorage.getItem(UTM_STORAGE_KEY);
        if (!stored) return path;
        const data = JSON.parse(stored) as Record<string, string>;
        const params = new URLSearchParams();
        for (const k of UTM_KEYS) if (data[k]) params.set(k, data[k]);
        const qs = params.toString();
        if (!qs) return path;
        return path.includes("?") ? `${path}&${qs}` : `${path}?${qs}`;
      } catch {
        return path;
      }
    };
  }, []);
}

export const SECTION_SCROLL_OFFSET = "scroll-mt-24 md:scroll-mt-28";

/** Безопасный getter для локализованных строк. */
export function txt(text: Record<string, unknown>, key: string, fallback?: string): string {
  const v = text[key];
  if (typeof v === "string" && v.trim()) return v;
  return fallback ?? "";
}

/** Безопасный getter для строковых props. */
export function p(props: Record<string, unknown>, key: string, fallback?: string): string {
  const v = props[key];
  if (typeof v === "string" && v.trim()) return v;
  return fallback ?? "";
}

/** Получить массив из text/props с fallback на дефолтный. */
export function arr<T>(source: Record<string, unknown>, key: string, fallback: T[]): T[] {
  const v = source[key];
  if (Array.isArray(v) && v.length > 0) return v as T[];
  return fallback;
}
