/**
 * AuroraTabs — нижняя навигация дизайна Aurora.
 *
 * Стиль: iOS-подобная плавающая панель из «жидкого стекла» — только иконки,
 * без подписей. Стекло сделано ЧИСТЫМ CSS (backdrop-filter + полупрозрачная
 * заливка + внутренний блик), без сторонних библиотек: liquid-glass-обёртки
 * не рендерятся в WebKit (Telegram-вебвью, Safari).
 *
 * Активная вкладка — круглая градиентная кнопка со свечением, плавно
 * перетекающая между позициями (gsap-твин по x/width индикатора).
 *
 * Fixed bottom + safe-area iOS.
 */

import { Link, useLocation } from "react-router-dom";
<<<<<<< HEAD
import { motion } from "framer-motion";
import { Globe, Wallet, UserPlus, MessageCircle, User } from "lucide-react";
=======
import gsap from "gsap";
import { Globe, Wallet, UserPlus, MessageCircle } from "lucide-react";
import { reducedMotion } from "@/lib/gsap-utils";
>>>>>>> 3d6b243 (feat(frontend): TanStack Query + Zustand everywhere, GSAP animations, UI redesign)
import { cn } from "@/lib/utils";
import { useLayoutEffect, useRef } from "react";

interface Tab {
  to: string;
  /** доступное имя — подписи на экране нет, но скринридеру нужно */
  label: string;
  icon: typeof Globe;
}

const TABS: Tab[] = [
  { to: "/cabinet/dashboard", label: "Подписка", icon: Globe },
  { to: "/cabinet/tariffs", label: "Тарифы", icon: Wallet },
  { to: "/cabinet/referral", label: "Друзья", icon: UserPlus },
  { to: "/cabinet/tickets", label: "Поддержка", icon: MessageCircle },
  { to: "/cabinet/profile", label: "Профиль", icon: User },
];

export function AuroraTabs() {
  const location = useLocation();
  const pillRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLSpanElement>(null);
  // первый расчёт ставим индикатор сразу, без анимации «из угла»
  const placedRef = useRef(false);

  // Индикатор активной вкладки: один стабильный tween без context-revert —
  // revert на каждый pathname откатывал dot в стартовую позицию (видимый скачок/дрожание).
  // Первый рендер: ставим мгновенно; дальнейшие смены роута: плавный переезд.
  useLayoutEffect(() => {
    const pill = pillRef.current;
    const dot = dotRef.current;
    if (!pill || !dot) return;
    const activeIdx = TABS.findIndex(
      (t) => location.pathname === t.to || location.pathname.startsWith(t.to + "/"),
    );
    const link = pill.querySelectorAll<HTMLAnchorElement>("a")[activeIdx];
    if (!link) return;
    const x = link.offsetLeft;
    const width = link.offsetWidth;
    if (reducedMotion()) {
      gsap.set(dot, { x, width });
      placedRef.current = true;
      return;
    }
    if (!placedRef.current) {
      placedRef.current = true;
      gsap.set(dot, { x, width });
      return;
    }
    gsap.to(dot, { x, width, duration: 0.3, ease: "power2.out", overwrite: "auto" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  return (
    <nav
      aria-label="Основная навигация"
      className="au-nav fixed inset-x-0 bottom-0 z-30 pointer-events-none px-5"
      style={{ paddingBottom: "calc(max(env(safe-area-inset-bottom, 0px), var(--app-tg-bottom, 0px)) + 12px)" }}
    >
      <div
        ref={pillRef}
        className="pointer-events-auto relative mx-auto flex max-w-[340px] items-center justify-between gap-1 rounded-full px-2 py-2"
        style={{
          // «Жидкое стекло»: размытие фона + лёгкая заливка + блик по верхней кромке
          background: "color-mix(in srgb, var(--au-nav) 85%, transparent)",
          backdropFilter: "blur(22px) saturate(180%)",
          WebkitBackdropFilter: "blur(22px) saturate(180%)",
          border: "1px solid color-mix(in srgb, var(--au-muted) 20%, transparent)",
          boxShadow:
            "0 8px 32px -8px rgba(17, 24, 39, 0.22), inset 0 1px 0 rgba(255,255,255,0.85)",
        }}
      >
        {/* индикатор активной вкладки: один элемент, переезжает gsap-ом */}
        <span
          ref={dotRef}
          aria-hidden
          className="absolute left-0 top-2 bottom-2 w-12 rounded-full"
          style={{
            background: "linear-gradient(135deg, var(--au-from), var(--au-to))",
            boxShadow:
              "0 6px 16px -4px color-mix(in srgb, var(--au-from) 55%, transparent), inset 0 1px 0 rgba(255,255,255,0.45)",
          }}
        />
        {TABS.map((t) => {
          const active =
            location.pathname === t.to || location.pathname.startsWith(t.to + "/");
          const Icon = t.icon;
          return (
            <Link
              key={t.to}
              to={t.to}
              aria-label={t.label}
              aria-current={active ? "page" : undefined}
              className="relative z-10 flex h-12 w-12 shrink-0 items-center justify-center rounded-full active:scale-95 transition-transform"
            >
              <Icon
                className={cn(
                  "h-[22px] w-[22px] transition-colors",
                  active ? "text-white" : "text-[color:var(--au-muted)]",
                )}
                strokeWidth={active ? 2.5 : 2}
              />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
