/**
 * Stealth-layout — обёртка для всех страниц нового дизайна кабинета.
 *
 * Структура:
 *   ┌─────────────────────────────┐
 *   │  Header (бренд по центру)    │
 *   │─────────────────────────────│
 *   │  <Outlet/> — контент стр.   │
 *   │─────────────────────────────│
 *   │  BottomTabs (Главная/...)    │
 *   └─────────────────────────────┘
 *
 * + NetworkBg (фикс. фон) на весь экран позади всего.
 */

import { Outlet } from "react-router-dom";
import { useEffect, useState } from "react";
import { api, type PublicConfig } from "@/lib/api";
import { NetworkBg } from "@/components/stealth/network-bg";
import { BottomTabs } from "@/components/stealth/bottom-tabs";

// hex (#RRGGBB) → "R G B" (пробел-разделённые каналы для rgb(var(--stealth-accent) / a)).
function hexToRgbTriple(hex: string | null | undefined, fallback = "255 35 87"): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec((hex ?? "").trim());
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

export function StealthLayout() {
  const [config, setConfig] = useState<PublicConfig | null>(null);

  useEffect(() => {
    api.getPublicConfig().then(setConfig).catch(() => {});
  }, []);

  const brand = (config?.serviceName ?? "STEALTHNET").toUpperCase();
  const accent = hexToRgbTriple((config as { stealthAccent?: string | null } | null)?.stealthAccent);

  // Ставим акцент ГЛОБАЛЬНО на :root — контент кабинета рендерится в отдельном
  // поддереве (не внутри этого div), поэтому inline-style на div его не покрывает.
  useEffect(() => {
    document.documentElement.style.setProperty("--stealth-accent", accent);
  }, [accent]);

  return (
    <div
      className="tg-fs-pad min-h-screen w-full text-white relative overflow-x-hidden"
      style={{ ["--stealth-accent" as string]: accent }}
    >
      <NetworkBg />

      {/* Header: бренд по центру + ambient glow */}
      <header className="relative pt-6 pb-3 px-4 text-center">
        <div className="inline-block relative">
          <span
            className="absolute inset-0 -z-10 blur-2xl opacity-50"
            style={{ background: "radial-gradient(closest-side, rgba(255,255,255,0.18), transparent 70%)" }}
          />
          <h1
            className="text-base md:text-lg font-bold tracking-[0.18em] text-white"
            style={{ fontFamily: '"Syncopate", "Inter", system-ui, sans-serif' }}
          >
            {brand}
          </h1>
        </div>
      </header>

      {/* запас снизу под левитирующую glass-панель (высота + отступ + safe-area). */}
      <main className="relative pb-32 max-w-md mx-auto">
        <Outlet />
      </main>

      <BottomTabs />
    </div>
  );
}
