/**
 * What's New 5.1.0 — одноразовый онбординг для админов.
 *
 * При первом входе в админку на версии 5.1.0 показывает стеклянный визард
 * со слайдами новых фич: анимированные орбы, stagger-списки, конфетти на финале.
 * Факт просмотра хранится в localStorage (per-browser) — не надоедает.
 *
 * Анимации — gsap (gsap.context + revert, prefers-reduced-motion guard).
 * tailwindcss-animate классы (animate-in и т.п.) не используются.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import gsap from "gsap";
import {
  Sparkles, Gift, Gem, Wrench, ShieldCheck, Bot,
  ChevronRight, ChevronLeft, X, Rocket, PartyPopper,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EASE_OUT, reducedMotion } from "@/lib/gsap-utils";

const STORAGE_KEY = "stealthnet_whatsnew_5.1.0_seen";

interface Slide {
  icon: typeof Sparkles;
  accent: string; // tailwind text-цвет иконки
  glow: string;   // tailwind bg-цвет орба
  title: string;
  items: string[];
}

const SLIDES: Slide[] = [
  {
    icon: Sparkles,
    accent: "text-violet-400",
    glow: "bg-violet-500/25",
    title: "Стеклянный кабинет",
    items: [
      "Новый стеклянный дизайн кабинета и админки",
      "Плавные gsap-переходы вместо резких подстановок",
      "Мгновенный поиск по клиентам и серверам",
    ],
  },
  {
    icon: Gift,
    accent: "text-emerald-400",
    glow: "bg-emerald-500/25",
    title: "Триал 2.0",
    items: [
      "Пробники активируются в один клик из модалки выбора",
      "Кастомные длительности и лимиты трафика",
      "Гибкая настройка триалов в разделе «Триалы»",
    ],
  },
  {
    icon: Gem,
    accent: "text-cyan-400",
    glow: "bg-cyan-500/25",
    title: "Умные подписки",
    items: [
      "Продление с сохранением позиции и бонусов",
      "Автопродление с напоминаниями",
      "Балансная оплата без перехода на платежку",
    ],
  },
  {
    icon: Wrench,
    accent: "text-amber-400",
    glow: "bg-amber-500/25",
    title: "Настройка подписки",
    items: [
      "Редактирование proxied-статусов и лимитов",
      "Переключение тарифа без потери данных",
      "Ручная активация триала для клиента",
    ],
  },
  {
    icon: ShieldCheck,
    accent: "text-rose-400",
    glow: "bg-rose-500/25",
    title: "Антибрутфорс",
    items: [
      "Защита от перебора паролей на всех формах входа",
      "Требование капчи при подозрительной активности",
      "Логи блокировок в аудите",
    ],
  },
  {
    icon: Bot,
    accent: "text-sky-400",
    glow: "bg-sky-500/25",
    title: "Телеграм-бот",
    items: [
      "Управление подписками прямо из бота",
      "Уведомления об истечении подписки",
      "Полная мультиподписочность — паритет с классик-кабинетом",
      "Левитирующая стеклянная нижняя панель",
      "Триалы, модалка оплаты и автосписание прямо в миниаппке",
    ],
  },
];

const CONFETTI_COLORS = ["bg-rose-500", "bg-violet-500", "bg-amber-400", "bg-emerald-400", "bg-fuchsia-500", "bg-cyan-400"];
const CONFETTI_COUNT = 26;

/** Статичные глухие span-ы конфетти; движение гоняет gsap-твин на контейнере. */
function confettiStyle(i: number): CSSProperties {
  const left = (i * 37) % 100;
  const size = 5 + (i % 3) * 3;
  return { left: `${left}%`, width: size, height: size * 1.6 };
}

export function WhatsNew510() {
  const [open, setOpen] = useState(false);
  // step: 0 = приветствие, 1..SLIDES.length = фичи, SLIDES.length+1 = финал
  const [step, setStep] = useState(0);
  const lastStep = SLIDES.length + 1;
  const overlayRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const confettiWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setOpen(true);
    } catch { /* private mode — просто не показываем */ }
  }, []);

  const close = () => {
    try { localStorage.setItem(STORAGE_KEY, new Date().toISOString()); } catch { /* ignore */ }
    const overlay = overlayRef.current;
    if (!overlay || reducedMotion()) { setOpen(false); return; }
    gsap.to(overlay, { opacity: 0, duration: 0.2, ease: "power2.in", onComplete: () => setOpen(false) });
  };

  const confetti = useMemo(() => Array.from({ length: CONFETTI_COUNT }, (_, i) => i), []);


  const slide = step >= 1 && step <= SLIDES.length ? SLIDES[step - 1] : null;

  // Анимации, зависящие от step, идут через key на контейнере контента.
  const slideKey = step === 0 ? "welcome" : step === lastStep ? "finale" : `slide-${step}`;

  // Открытие: fade оверлея + spring-поп карточки, один раз на mount.
  useEffect(() => {
    if (!open) return;
    const overlay = overlayRef.current;
    const card = cardRef.current;
    if (!overlay || !card || reducedMotion()) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(overlay, { opacity: 0 }, { opacity: 1, duration: 0.25, ease: EASE_OUT });
      gsap.fromTo(
        card,
        { y: 32, scale: 0.95, opacity: 0 },
        { y: 0, scale: 1, opacity: 1, duration: 0.55, ease: "back.out(1.4)", delay: 0.05 },
      );
      // ambient-орбы — бесконечное дыхание
      gsap.to("[data-orb-top]", { scale: 1.15, opacity: 0.8, duration: 6, repeat: -1, yoyo: true, ease: "sine.inOut" });
      gsap.to("[data-orb-bottom]", { scale: 1, opacity: 0.7, duration: 7, repeat: -1, yoyo: true, ease: "sine.inOut" });
    }, overlay);
    return () => ctx.revert();
  }, [open]);

  // Смена слайдов: вход контента (slide-in) + микро-анимации внутри.
  useEffect(() => {
    if (!open) return;
    const root = overlayRef.current;
    const slideEl = root?.querySelector("[data-slide]") as HTMLElement | null;
    if (!root || !slideEl || reducedMotion()) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(slideEl, { opacity: 0, x: 40 }, { opacity: 1, x: 0, duration: 0.3, ease: EASE_OUT });
      if (step === 0) {
        const badge = slideEl.querySelector("[data-welcome-badge]");
        const text = slideEl.querySelector("[data-welcome-text]");
        if (badge) gsap.fromTo(badge, { scale: 0, rotate: -20 }, { scale: 1, rotate: 0, duration: 0.5, ease: "back.out(1.4)", delay: 0.15 });
        if (text) gsap.fromTo(text.children, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.3, stagger: 0.1, delay: 0.3, ease: EASE_OUT });
        const ring = slideEl.querySelector("[data-badge-ring]");
        if (ring) gsap.to(ring, { scale: 1.45, opacity: 0, duration: 2, repeat: -1, ease: "power1.out" });
      } else if (step === lastStep) {
        const badge = slideEl.querySelector("[data-finale-badge]");
        if (badge) gsap.fromTo(badge, { scale: 0 }, { scale: 1, duration: 0.5, ease: "back.out(1.4)" });
        const confetti = confettiWrapRef.current;
        if (confetti) {
          const pieces = confetti.children;
          Array.from(pieces).forEach((piece, i) => {
            gsap.fromTo(
              piece,
              { y: 0, opacity: 0, rotate: 0 },
              {
                y: "115vh", opacity: 0.6, rotate: 360 + (i % 4) * 180,
                duration: 2.2 + (i % 5) * 0.35, delay: (i % 10) * 0.12,
                ease: "power1.in", repeat: -1, repeatDelay: 1.2,
              },
            );
          });
        }
      } else {
        const icon = slideEl.querySelector("[data-slide-icon]");
        const items = slideEl.querySelectorAll("ul > li");
        if (icon) gsap.fromTo(icon, { scale: 0 }, { scale: 1, duration: 0.45, ease: "back.out(1.4)", delay: 0.1 });
        if (items.length) gsap.fromTo(items, { opacity: 0, x: 24 }, { opacity: 1, x: 0, duration: 0.35, stagger: 0.1, delay: 0.15, ease: EASE_OUT });
      }
    }, root);
    return () => ctx.revert();
  }, [open, step, lastStep]);

  // Guard ПОСЛЕ всех хуков (Rules of Hooks): рендерим оверлей только когда открыт.
  if (!open) return null;

  return (
    <div ref={overlayRef} className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/70">
      {/* ambient-орбы под карточкой */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div data-orb-top className={cn("absolute -top-24 -left-24 h-96 w-96 rounded-full blur-3xl", slide?.glow ?? "bg-primary/25")} />
        <div data-orb-bottom className="absolute -bottom-24 -right-24 h-96 w-96 rounded-full bg-primary/20 blur-3xl" />
      </div>

      <div ref={cardRef} className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-card">
        {/* верхний блик */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-transparent" />


        {/* конфетти на финале */}
        {step === lastStep && (
          <div ref={confettiWrapRef} className="pointer-events-none absolute inset-0 overflow-hidden" data-confetti>
            {confetti.map((i) => (
              <span
                key={i}
                className={cn("absolute top-[-5%] rounded-[2px]", CONFETTI_COLORS[i % CONFETTI_COLORS.length])}
                style={confettiStyle(i)}
              />
            ))}
          </div>
        )}

        <button
          onClick={close}
          className="absolute right-4 top-4 z-10 rounded-full p-1.5 text-muted-foreground hover:text-foreground hover:bg-card transition-colors"
          aria-label="Закрыть"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="relative px-7 pt-10 pb-7 min-h-[430px] flex flex-col">
          {/* Смена слайдов: key + gsap slide-in; выход — мгновенная подмена (младше по touch) */}
          <div key={slideKey} className="flex flex-1 flex-col" data-slide>
            {step === 0 && (
              <div className="flex flex-1 flex-col items-center justify-center text-center gap-5">
                <div
                  data-welcome-badge
                  className="relative flex h-24 w-24 items-center justify-center rounded-[1.75rem] bg-primary shadow-primary/60"
                >
                  <Sparkles className="h-12 w-12 text-white" />
                  <span data-badge-ring className="absolute inset-0 rounded-[1.75rem] border-2 border-border" />
                </div>
                <div className="space-y-2" data-welcome-text>
                  <p className="text-xs font-bold uppercase tracking-[0.3em] text-primary">Обновление установлено</p>
                  <h2 className="text-4xl font-black tracking-tight text-foreground">STEALTHNET 5.1.0</h2>
                  <p className="text-sm text-muted-foreground max-w-sm leading-relaxed">
                    Добро пожаловать! Это крупнейший релиз: умные подписки, триал 2.0,
                    glass-редизайн и десятки фиксов. Покажем главное за минуту.
                  </p>
                </div>
              </div>
            )}

            {slide && (
              <div className="flex flex-1 flex-col gap-5">
                <div className="flex items-center gap-4">
                  <div
                    data-slide-icon
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-white/[0.06]"
                  >
                    <slide.icon className={cn("h-7 w-7", slide.accent)} />
                  </div>
                  <h3 className="text-xl font-bold leading-tight">{slide.title}</h3>
                </div>
                <ul className="space-y-3">
                  {slide.items.map((item) => (
                    <li
                      key={item}
                      className="flex items-start gap-3 rounded-xl border border-border bg-white/[0.04] px-4 py-3"
                    >
                      <span className={cn("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", slide.accent.replace("text-", "bg-"))} />
                      <span className="text-sm leading-relaxed text-foreground/90">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {step === lastStep && (
              <div className="flex flex-1 flex-col items-center justify-center text-center gap-5">
                <div
                  data-finale-badge
                  className="flex h-24 w-24 items-center justify-center rounded-full bg-primary shadow-emerald-500/60"
                >
                  <PartyPopper className="h-12 w-12 text-white" />
                </div>
                <div className="space-y-2">
                  <h2 className="text-3xl font-black tracking-tight">Всё готово!</h2>
                  <p className="text-sm text-muted-foreground max-w-sm leading-relaxed">
                    Загляните в «Тарифы» (режим одной подписки), «Триалы» (новые тогглы)
                    и «Настройки  Рефералка» (заявки на вывод). Хорошего релиза! 
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* прогресс-дотс + навигация */}
          <div className="mt-6 flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              {Array.from({ length: lastStep + 1 }, (_, i) => (
                <span
                  key={i}
                  className={cn(
                    "h-1.5 rounded-full transition-all duration-300",
                    i === step ? "w-6 bg-primary" : "w-1.5 bg-card",
                  )}
                />
              ))}
            </div>
            <div className="flex items-center gap-2">
              {step > 0 && step <= SLIDES.length && (
                <Button variant="ghost" size="sm" onClick={() => setStep((s) => s - 1)} className="rounded-xl gap-1">
                  <ChevronLeft className="h-4 w-4" /> Назад
                </Button>
              )}
              {step < lastStep ? (
                <Button
                  size="sm"
                  onClick={() => setStep((s) => s + 1)}
                  className="rounded-xl gap-1 bg-primary text-white border-0 shadow-primary/30 hover:opacity-90"
                >
                  {step === 0 ? "Показать новое" : "Далее"} <ChevronRight className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={close}
                  className="rounded-xl gap-2 bg-primary text-white border-0 shadow-emerald-500/30 hover:opacity-90"
                >
                  <Rocket className="h-4 w-4" /> Поехали!
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
