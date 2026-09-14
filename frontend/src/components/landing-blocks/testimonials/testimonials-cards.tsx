/**
 * Testimonials (variant: cards) — отзывы пользователей в карточках.
 */

import { Card, CardContent } from "@/components/ui/card";
import { Quote } from "lucide-react";
import { useScrollReveal } from "../scroll-reveal";
import { txt, arr, SECTION_SCROLL_OFFSET, useLandingTheme } from "../utils";
import type { LandingApiBlock } from "../types";

interface Testimonial {
  text: string;
  author: string;
  role?: string;
  avatar?: string;
}

const DEFAULT_TESTIMONIALS: Testimonial[] = [
  { text: "Подключился за минуту, всё работает стабильно — даже на мобильном интернете.", author: "Алексей", role: "клиент" },
  { text: "Цены прозрачные, поддержка отвечает быстро. Лучшее, что пробовал из VPN.", author: "Мария", role: "клиент" },
  { text: "Кабинет понятный, тарифы гибкие, оплата через СБП — то что надо.", author: "Дмитрий", role: "клиент" },
];

export function TestimonialsCards({ block }: { block: LandingApiBlock }) {
  const { accentTheme } = useLandingTheme();
  const items = arr<Testimonial>(block.text, "items", DEFAULT_TESTIMONIALS);
  const title = txt(block.text, "title", "Что говорят пользователи");
  const subtitle = txt(block.text, "subtitle");
  const gridRef = useScrollReveal<HTMLDivElement>([items.length], { y: 14, dur: 0.4, stagger: 0.05 });

  return (
    <section className={`max-w-7xl mx-auto px-4 py-16 md:py-24 ${SECTION_SCROLL_OFFSET}`}>
      <div className="text-center">
        <h2 className="text-3xl font-black tracking-[-0.04em] text-slate-950 md:text-4xl dark:text-white">{title}</h2>
        {subtitle ? <p className="mx-auto mt-3 max-w-xl text-base text-slate-600 dark:text-slate-300">{subtitle}</p> : null}
      </div>
      <div ref={gridRef} className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {items.slice(0, 6).map((it, idx) => (
          <div key={`${it.author}-${idx}`}>
            <Card className="h-full border-slate-200/70 dark:border-border bg-card dark:bg-card">
              <CardContent className="flex h-full flex-col p-6">
                <Quote className="h-7 w-7" style={{ color: accentTheme.primary }} />
                <p className="mt-4 flex-1 text-sm leading-relaxed text-slate-700 dark:text-slate-200">{it.text}</p>
                <div className="mt-5 flex items-center gap-3 border-t border-border pt-4">
                  {it.avatar ? (
                    <img src={it.avatar} alt={it.author} className="h-10 w-10 rounded-full object-cover" />
                  ) : (
                    <div
                      className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold"
                      style={{ background: accentTheme.ctaBg, color: accentTheme.ctaFg }}
                    >
                      {it.author.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div>
                    <div className="text-sm font-semibold text-slate-950 dark:text-white">{it.author}</div>
                    {it.role ? <div className="text-xs text-slate-500 dark:text-slate-400">{it.role}</div> : null}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        ))}
      </div>
    </section>
  );
}
