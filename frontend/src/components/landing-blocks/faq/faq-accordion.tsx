/**
 * FAQ (variant: accordion) — раскрывающиеся вопросы.
 * Анимация раскрытия — gsap height 0 ↔ auto + fade, стрелка — rotate.
 */

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ChevronDown } from "lucide-react";
import { EASE_OUT, reducedMotion } from "@/lib/gsap-utils";
import { txt, arr, SECTION_SCROLL_OFFSET } from "../utils";
import type { LandingApiBlock } from "../types";

const DEFAULT_FAQ = [
  { q: "Что такое VPN и зачем он нужен?", a: "VPN шифрует трафик, помогает обойти блокировки и обеспечивает стабильный доступ к нужным сервисам — дома, в поездках и за рубежом." },
  { q: "Ведётся ли логирование подключений?", a: "Нет. Сервис придерживается zero-log подхода: история активности не хранится, действия не привязываются к личности." },
  { q: "Сколько устройств можно подключить?", a: "Зависит от выбранного тарифа. Лимиты, срок и условия отображаются в кабинете и могут гибко настраиваться." },
  { q: "Как быстро начать?", a: "Регистрируешься, выбираешь тариф, оплачиваешь и сразу получаешь инструкции в кабинете и в Telegram-боте." },
];

interface FaqItem {
  q: string;
  a: string;
}

export function FaqAccordion({ block }: { block: LandingApiBlock }) {
  const items = arr<FaqItem>(block.text, "items", DEFAULT_FAQ);
  const title = txt(block.text, "title", "Частые вопросы");
  const [open, setOpen] = useState<number | null>(0);
  const answerRefs = useRef<(HTMLDivElement | null)[]>([]);
  const chevronRefs = useRef<(HTMLSpanElement | null)[]>([]);

  // Анимация раскрытия/закрытия по смене open (gsap умеет height: "auto").
  useEffect(() => {
    if (reducedMotion()) return;
    const ctx = gsap.context(() => {
      items.forEach((_, idx) => {
        const answer = answerRefs.current[idx];
        const chevron = chevronRefs.current[idx];
        if (!answer) return;
        if (open === idx) {
          gsap.to(answer, { height: "auto", opacity: 1, duration: 0.25, ease: EASE_OUT, overwrite: "auto" });
        } else {
          gsap.to(answer, { height: 0, opacity: 0, duration: 0.25, ease: EASE_OUT, overwrite: "auto" });
        }
        if (chevron) {
          gsap.to(chevron, { rotate: open === idx ? 180 : 0, duration: 0.25, ease: EASE_OUT, overwrite: "auto" });
        }
      });
    });
    return () => ctx.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Начальное состояние: контент открытого (idx 0) виден, остальные — свёрнуты.
  useEffect(() => {
    items.forEach((_, idx) => {
      const answer = answerRefs.current[idx];
      if (answer) answer.style.height = open === idx ? "auto" : "0px";
      // eslint-disable-next-line react-hooks/exhaustive-deps
    });
  }, [items]);

  return (
    <section id="faq" className={`max-w-7xl mx-auto px-4 py-16 md:py-24 ${SECTION_SCROLL_OFFSET}`}>
      <div className="mx-auto max-w-3xl">
        <h2 className="text-center text-3xl font-black tracking-[-0.04em] text-slate-950 md:text-4xl dark:text-white">{title}</h2>

        <div className="mt-10 space-y-3">
          {items.map((item, idx) => {
            const isOpen = open === idx;
            return (
              <div
                key={`${item.q}-${idx}`}
                className="overflow-hidden rounded-xl border border-slate-200/70 dark:border-border bg-card dark:bg-card"
              >
                <button
                  onClick={() => setOpen(isOpen ? null : idx)}
                  className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left transition-colors hover:bg-slate-50/60 dark:hover:bg-card"
                >
                  <span className="text-base font-semibold text-slate-950 dark:text-white md:text-lg">{item.q}</span>
                  <span ref={(el) => { chevronRefs.current[idx] = el; }} style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0deg)" }} className="shrink-0">
                    <ChevronDown className="h-5 w-5 text-slate-500 dark:text-slate-400" />
                  </span>
                </button>
                <div
                  ref={(el) => { answerRefs.current[idx] = el; }}
                  style={{ height: isOpen ? "auto" : 0, opacity: isOpen ? 1 : 0 }}
                >
                  <div className="px-6 pb-5 text-sm leading-relaxed text-slate-600 dark:text-slate-300 md:text-base">
                    {item.a}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
