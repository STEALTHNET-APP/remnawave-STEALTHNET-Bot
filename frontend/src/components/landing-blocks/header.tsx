/**
 * Шапка лендинга с навигацией. Не блок — рендерится статически в LandingPage сверху.
 */

import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import gsap from "gsap";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";
import { EASE_OUT, reducedMotion } from "@/lib/gsap-utils";
import { useUtmCaptureAndBuildLink, useLandingTheme } from "./utils";

interface LandingHeaderProps {
  serviceName: string;
  logoUrl?: string | null;
  navItems: { label: string; href: string }[];
  loginText: string;
  ctaText: string;
  headerBadge?: string;
}

export function LandingHeader({ serviceName, logoUrl, navItems, loginText, ctaText, headerBadge }: LandingHeaderProps) {
  const { accentTheme } = useLandingTheme();
  const buildLink = useUtmCaptureAndBuildLink();

  const actionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = actionsRef.current;
    if (!el || reducedMotion()) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        el,
        { opacity: 0, x: 8 },
        { opacity: 1, x: 0, duration: 0.4, ease: EASE_OUT, overwrite: "auto", clearProps: "transform" },
      );
    }, el);
    return () => ctx.revert();
  }, []);
  const accentBg = accentTheme.ctaBg;

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/60 dark:border-border bg-card dark:bg-slate-950/70">
      <div className="max-w-7xl mx-auto flex h-16 items-center justify-between px-4">
        <Link to="/" className="flex items-center gap-3">
          {logoUrl ? (
            <img src={logoUrl} alt={serviceName} className="h-9 w-9 rounded-xl object-contain" />
          ) : (
            <div
              className="flex h-9 w-9 items-center justify-center rounded-xl text-base font-black text-white"
              style={{ background: accentBg }}
            >
              {serviceName.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="leading-tight">
            {headerBadge ? (
              <div className="text-[10px] font-semibold uppercase tracking-[0.32em]" style={{ color: accentTheme.primary }}>
                {headerBadge}
              </div>
            ) : null}
            <div className="text-base font-black tracking-tight text-slate-950 dark:text-white">{serviceName}</div>
          </div>
        </Link>

        <nav className="hidden items-center gap-7 text-sm font-medium text-slate-600 dark:text-slate-300 md:flex">
          {navItems.map((it) => (
            <a key={it.href} href={it.href} className="transition-colors hover:text-slate-950 dark:hover:text-white">
              {it.label}
            </a>
          ))}
        </nav>

        <div ref={actionsRef} className="flex items-center gap-2">
          <Button asChild variant="ghost" className="hidden h-9 rounded-full px-4 text-sm font-medium text-slate-900 dark:text-slate-100 sm:inline-flex">
            <Link to={buildLink("/cabinet/login")}>{loginText}</Link>
          </Button>
          <Button asChild className="h-9 rounded-full px-4 text-sm font-semibold" style={{ background: accentBg, color: accentTheme.ctaFg }}>
            <Link to={buildLink("/cabinet/register")}>
              <Sparkles className="h-3.5 w-3.5" />
              {ctaText}
            </Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
