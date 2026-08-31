/**
 * AuroraTabs — нижняя навигация дизайна Aurora.
 *
 * Стиль: iOS-подобная плавающая панель из «жидкого стекла» — только иконки,
 * без подписей. Стекло сделано ЧИСТЫМ CSS (backdrop-filter + полупрозрачная
 * заливка + внутренний блик), без сторонних библиотек: liquid-glass-обёртки
 * не рендерятся в WebKit (Telegram-вебвью, Safari).
 *
 * Активная вкладка — круглая градиентная кнопка со свечением, плавно
 * перетекающая между позициями (framer-motion layoutId).
 *
 * Fixed bottom + safe-area iOS.
 */

import { Link, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { Globe, Wallet, UserPlus, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";

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
];

export function AuroraTabs() {
  const location = useLocation();

  return (
    <nav
      aria-label="Основная навигация"
      className="au-nav fixed inset-x-0 bottom-0 z-30 pointer-events-none px-5"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}
    >
      <div
        className="pointer-events-auto mx-auto flex max-w-[340px] items-center justify-between gap-1 rounded-full px-2 py-2"
        style={{
          // «Жидкое стекло»: размытие фона + лёгкая заливка + блик по верхней кромке
          background: "rgba(255, 255, 255, 0.62)",
          backdropFilter: "blur(22px) saturate(180%)",
          WebkitBackdropFilter: "blur(22px) saturate(180%)",
          border: "1px solid rgba(255, 255, 255, 0.75)",
          boxShadow:
            "0 8px 32px -8px rgba(17, 24, 39, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.85)",
        }}
      >
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
              className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full active:scale-95 transition-transform"
            >
              {active && (
                <motion.span
                  layoutId="aurora-tab-dot"
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  className="absolute inset-0 rounded-full"
                  style={{
                    background: "linear-gradient(135deg, var(--au-from), var(--au-to))",
                    boxShadow:
                      "0 6px 16px -4px color-mix(in srgb, var(--au-from) 55%, transparent), inset 0 1px 0 rgba(255,255,255,0.45)",
                  }}
                />
              )}
              <Icon
                className={cn(
                  "relative z-10 h-[22px] w-[22px] transition-colors",
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
