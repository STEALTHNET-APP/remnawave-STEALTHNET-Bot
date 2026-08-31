/**
 * AuroraLayout — обёртка третьего дизайна кабинета (мини-апп «Aurora»).
 *
 * Отличается от Classic и Stealth: светлый фон, крупная градиентная карточка
 * подписки, плитки-метрики и плавающее нижнее меню из четырёх вкладок.
 *
 * Структура:
 *   ┌──────────────────────────────┐
 *   │  <Outlet/> — контент страницы │
 *   │──────────────────────────────│
 *   │  AuroraTabs (плавающее меню)  │
 *   └──────────────────────────────┘
 *
 * Акцент берётся из настройки панели (тот же `stealthAccent`, что и у Stealth —
 * чтобы владелец задавал фирменный цвет один раз для всех мини-аппов).
 * Из него считается градиент: основной цвет → более светлый/голубой оттенок.
 */

import { Outlet } from "react-router-dom";
import { useEffect, useState } from "react";
import { api, type PublicConfig } from "@/lib/api";
import { AuroraTabs } from "@/components/aurora/aurora-tabs";

/** hex → [r,g,b]; при мусоре — индиго по умолчанию (#5B4BE8). */
function hexToRgb(hex: string | null | undefined): [number, number, number] {
  const m = /^#?([0-9a-fA-F]{6})$/.exec((hex ?? "").trim());
  if (!m) return [91, 75, 232];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Осветляет цвет и уводит в голубой — вторая точка градиента, как в макете. */
function toGradientEnd([r, g, b]: [number, number, number]): string {
  const mix = (c: number, target: number) => Math.round(c + (target - c) * 0.45);
  return `rgb(${mix(r, 56)} ${mix(g, 170)} ${mix(b, 225)})`;
}

export function AuroraLayout() {
  const [config, setConfig] = useState<PublicConfig | null>(null);

  useEffect(() => {
    api.getPublicConfig().then(setConfig).catch(() => {});
  }, []);

  // Aurora светлый, а в полноэкранном режиме иконки статус-бара Telegram
  // рисует по цвету шапки. Не сказать ему про белый фон — белые часы и
  // батарея сольются с белой полосой отступа.
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg?.initData?.trim()) return;
    try {
      tg.setHeaderColor?.("#ffffff");
      tg.setBackgroundColor?.("#ffffff");
    } catch {
      /* Bot API < 6.9 не принимает произвольный hex */
    }
  }, []);

  const rgb = hexToRgb((config as { stealthAccent?: string | null } | null)?.stealthAccent);
  const from = `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`;
  const to = toGradientEnd(rgb);

  return (
    <div
      className="tg-fs-pad min-h-screen w-full bg-[var(--au-bg)] text-[var(--au-ink)] relative overflow-x-hidden"
      style={
        {
          "--au-from": from,
          "--au-to": to,
          "--au-bg": "#ffffff",
          "--au-surface": "#f2f3f7",
          "--au-nav": "#f2f3f7",
          "--au-ink": "#0f1222",
          "--au-muted": "#8b90a3",
        } as React.CSSProperties
      }
    >
      {/* запас снизу под плавающее меню + safe-area */}
      <main className="relative mx-auto max-w-md px-4 pt-4 pb-32">
        <Outlet />
      </main>

      <AuroraTabs />
    </div>
  );
}
