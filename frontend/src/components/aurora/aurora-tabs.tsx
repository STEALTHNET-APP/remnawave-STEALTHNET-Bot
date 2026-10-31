import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { Globe, Wallet, UserPlus, MessageCircle, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCabinetConfig } from "@/contexts/cabinet-config";

interface Tab {
  to: string;
  label: string;
  icon: typeof Globe;
}

const TABS: Tab[] = [
  { to: "/cabinet/dashboard", label: "aurora.home", icon: Globe },
  { to: "/cabinet/tariffs", label: "aurora.tariffs", icon: Wallet },
  { to: "/cabinet/referral", label: "aurora.friends", icon: UserPlus },
  { to: "/cabinet/tickets", label: "aurora.support", icon: MessageCircle },
  { to: "/cabinet/profile", label: "aurora.profile", icon: User },
];

export function AuroraTabs() {
  const location = useLocation();
  const reduceMotion = useReducedMotion();
  const { t: translate } = useTranslation();
  const config = useCabinetConfig();
  const tabs: Tab[] = TABS.map((tab) =>
    tab.label === "aurora.support" && !config?.ticketsEnabled ? { ...tab, to: "/cabinet/help" } : tab,
  );

  return (
    <nav
      aria-label={translate("aurora.main_navigation")}
      className="au-nav fixed inset-x-0 bottom-0 z-30 pointer-events-none px-4"
      style={{ paddingBottom: "calc(max(env(safe-area-inset-bottom, 0px), var(--app-tg-bottom, 0px)) + 10px)" }}
    >
      <div
        className="pointer-events-auto mx-auto flex max-w-[360px] items-stretch justify-between gap-0.5 rounded-[26px] px-1.5 py-1.5"
        style={{
          background: "color-mix(in srgb, var(--au-nav) 82%, transparent)",
          backdropFilter: "blur(22px) saturate(180%)",
          WebkitBackdropFilter: "blur(22px) saturate(180%)",
          border: "1px solid color-mix(in srgb, var(--au-muted) 18%, transparent)",
          boxShadow: "0 10px 34px -12px rgba(17, 24, 39, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.55)",
        }}
      >
        {tabs.map((tab) => {
          const active = location.pathname === tab.to || location.pathname.startsWith(tab.to + "/");
          const Icon = tab.icon;
          return (
            <Link
              key={tab.to}
              to={tab.to}
              aria-label={translate(tab.label)}
              aria-current={active ? "page" : undefined}
              className="flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-[20px] px-1 pb-1 pt-1.5 active:scale-95 transition-transform"
            >
              <span className="relative flex h-8 w-full items-center justify-center">
                {active && (
                  <motion.span
                    layoutId="aurora-tab-pill"
                    transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34 }}
                    className="absolute inset-x-2 inset-y-0 rounded-full"
                    style={{
                      background: "var(--au-from)",
                      boxShadow: "0 5px 14px -5px color-mix(in srgb, var(--au-from) 60%, transparent), inset 0 1px 0 rgba(255,255,255,0.4)",
                    }}
                  />
                )}
                <Icon
                  className={cn(
                    "relative z-10 h-[19px] w-[19px] transition-colors",
                    active ? "text-white" : "text-[color:var(--au-muted)]",
                  )}
                  strokeWidth={active ? 2.4 : 2}
                />
              </span>
              <span
                className={cn(
                  "max-w-full truncate text-[10px] leading-[13px] tracking-tight transition-colors",
                  active ? "font-bold text-[var(--au-ink)]" : "font-medium text-[var(--au-muted)]",
                )}
              >
                {translate(tab.label)}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
