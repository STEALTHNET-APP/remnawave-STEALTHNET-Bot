/**
 * Stats (variant: strip-3 | strip-4) — горизонтальная полоса с цифрами.
 */

import { useScrollReveal } from "../scroll-reveal";
import { txt, useLandingTheme } from "../utils";
import type { LandingApiBlock } from "../types";

interface Stat {
  value: string;
  label: string;
}

export function StatsStrip({ block }: { block: LandingApiBlock }) {
  const { accentTheme } = useLandingTheme();

  // Сначала пытаемся читать stats как массив, иначе — старую плоскую структуру.
  const itemsRaw = block.text.items;
  const items: Stat[] = Array.isArray(itemsRaw) && itemsRaw.length > 0
    ? (itemsRaw as Stat[])
    : [
        { value: txt(block.text, "platforms", "5+"), label: "платформ" },
        { value: txt(block.text, "tariffsCount", "10"), label: txt(block.text, "tariffsLabel", "тарифов онлайн") },
        { value: txt(block.text, "paymentMethods", "6"), label: txt(block.text, "accessLabel", "способов оплаты") },
      ];
  const cap = block.variant === "strip-4" ? 4 : 3;
  const displayed = items.slice(0, cap);
  const gridRef = useScrollReveal<HTMLDivElement>([displayed.length], { y: 16, dur: 0.4, stagger: 0.06 });

  return (
    <section className="max-w-7xl mx-auto px-4 py-8 md:py-12">
      <div ref={gridRef} className={`grid gap-3 ${cap === 4 ? "grid-cols-2 md:grid-cols-4" : "grid-cols-3"}`}>
        {displayed.map((s, idx) => (
          <div
            key={`${s.label}-${idx}`}
            className="rounded-xl border border-slate-200/60 dark:border-border bg-card dark:bg-card p-4 text-center md:p-6"
          >
            <div className="text-4xl font-black tracking-tight md:text-5xl" style={{ color: accentTheme.primary }}>
              {s.value}
            </div>
            <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">{s.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
