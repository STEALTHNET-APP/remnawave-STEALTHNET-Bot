/**
 * BottomTabs — нижняя навигация для Stealth-дизайна.
 *
 * левитирующая glass-капсула: отступы от краёв
 * экрана, скруглённые края, backdrop-blur, rose-glow. Активная вкладка —
 * стеклянная pill-подсветка, плавно перетекающая между вкладками
 * (gsap-твин по x, бывший framer-motion layoutId) + underline.
 *
 * Fixed bottom с безопасной зоной iOS (env(safe-area-inset-bottom)).
 */

import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import gsap from "gsap";
import { EASE_OUT, EASE_SPRING, reducedMotion } from "@/lib/gsap-utils";
import { Shield, HelpCircle, User } from "lucide-react";
import { cn } from "@/lib/utils";

interface Tab {
  to: string;
  label: string;
  icon: typeof Shield;
}

const TABS: Tab[] = [
  { to: "/cabinet/dashboard", label: "ГЛАВНАЯ", icon: Shield },
  { to: "/cabinet/tickets", label: "ПОДДЕРЖКА", icon: HelpCircle },
  { to: "/cabinet/profile", label: "ПРОФИЛЬ", icon: User },
];

export function BottomTabs() {
  const location = useLocation();
  const navRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const underlineRef = useRef<HTMLSpanElement>(null);
  const prevActiveRef = useRef<number | null>(null);
  const tabRefs = useRef<(HTMLAnchorElement | null)[]>([]);

  const activeIndex = TABS.findIndex(
    (t) =>
      location.pathname === t.to ||
      (t.to === "/cabinet/dashboard" && location.pathname === "/cabinet"),
  );
  const active = activeIndex >= 0 ? activeIndex : 0;

  // Вход капсулы — один раз на монтировании (gsap.context + revert на unmount).
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const ctx = gsap.context(() => {
      if (reducedMotion()) {
        gsap.set(nav, { y: 0, opacity: 1 });
      } else {
        gsap.fromTo(
          nav,
          { y: 24, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.5, ease: EASE_SPRING, clearProps: "transform" },
        );
      }
    }, nav);
    return () => ctx.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Позиционирование pill/underline. Первый показ — set, смена таба —
  // плавный твин x (0.25s, EASE_OUT, overwrite auto).
  useEffect(() => {
    const pill = pillRef.current;
    const underline = underlineRef.current;
    const link = tabRefs.current[active];
    if (!pill || !underline || !link) return;
    const place = () => {
      gsap.set(pill, {
        x: link.offsetLeft,
        y: link.offsetTop,
        width: link.offsetWidth,
        height: link.offsetHeight,
        visibility: "visible",
      });
      gsap.set(underline, {
        x: link.offsetLeft + link.offsetWidth / 2 - underline.offsetWidth / 2,
        visibility: "visible",
      });
    };
    const slide = () => {
      gsap.to(pill, { x: link.offsetLeft, duration: 0.25, ease: EASE_OUT, overwrite: "auto" });
      gsap.to(underline, {
        x: link.offsetLeft + link.offsetWidth / 2 - underline.offsetWidth / 2,
        duration: 0.25,
        ease: EASE_OUT,
        overwrite: "auto",
      });
    };
    const first = prevActiveRef.current === null;
    prevActiveRef.current = active;
    if (first || reducedMotion()) {
      place();
    } else {
      slide();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 pointer-events-none px-4"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}
    >
      <div
        ref={navRef}
        style={{ opacity: 0 }}
        className={cn(
          "pointer-events-auto relative mx-auto max-w-md overflow-hidden",
          "rounded-[1.75rem] border border-white/[0.08]",
          "bg-zinc-900/70 backdrop-blur-2xl",
          "shadow-[0_12px_40px_-12px_rgba(0,0,0,0.85),0_0_28px_-14px_rgb(var(--stealth-accent)_/_0.35),inset_0_1px_0_rgba(255,255,255,0.06)]",
        )}
      >
        {/* верхний стеклянный блик */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
        <div className="pointer-events-none absolute -top-10 left-1/2 h-16 w-40 -translate-x-1/2 rounded-full bg-saccent-500/10 blur-2xl" />

        <div className="relative grid grid-cols-3 px-3 py-2">
          {/* стеклянная pill активной вкладки — один оверлей, gsap перегоняет x/width */}
          <span
            ref={pillRef}
            style={{ visibility: "hidden" }}
            className="pointer-events-none absolute left-0 top-0 rounded-2xl bg-white/[0.06] border border-saccent-500/25 shadow-[0_0_18px_-6px_rgb(var(--stealth-accent)_/_0.5),inset_0_1px_0_rgba(255,255,255,0.06)]"
          />
          {TABS.map((t, i) => {
            const isActive = i === active;
            const Icon = t.icon;
            return (
              <Link
                key={t.to}
                to={t.to}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                className="relative flex flex-col items-center gap-1 rounded-2xl px-2 py-1.5 transition-all active:scale-95"
                aria-current={isActive ? "page" : undefined}
              >
                <Icon
                  className={cn(
                    "relative h-5 w-5 transition-colors duration-300",
                    isActive
                      ? "text-saccent-500 drop-shadow-[0_0_6px_rgb(var(--stealth-accent)_/_0.6)]"
                      : "text-zinc-500",
                  )}
                  strokeWidth={isActive ? 2.4 : 2}
                />
                <span
                  className={cn(
                    "relative text-[10px] font-bold tracking-[0.12em] transition-colors duration-300",
                    isActive ? "text-saccent-400" : "text-zinc-500",
                  )}
                >
                  {t.label}
                </span>
              </Link>
            );
          })}
          {/* underline активной вкладки — один оверлей, съезжает вместе с pill */}
          <span
            ref={underlineRef}
            style={{ visibility: "hidden" }}
            className="pointer-events-none absolute bottom-2 left-0 h-[3px] w-6 rounded-full bg-gradient-to-r from-saccent-500 to-fuchsia-500 shadow-[0_0_10px_rgb(var(--stealth-accent)_/_0.7)]"
          />
        </div>
      </div>
    </nav>
  );
}
