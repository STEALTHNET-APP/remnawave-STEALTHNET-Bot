/**
 * CTA (variant: full-banner) — финальный призыв с акцентным фоном.
 */

import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useScrollReveal } from "../scroll-reveal";
import { useUtmCaptureAndBuildLink, txt, p, useLandingTheme } from "../utils";
import type { LandingApiBlock } from "../types";

export function CtaBanner({ block }: { block: LandingApiBlock }) {
  const { accentTheme } = useLandingTheme();
  const buildLink = useUtmCaptureAndBuildLink();

  const eyebrow = txt(block.text, "eyebrow", "Готов начать?");
  const title = txt(block.text, "title", "Подключись за 30 секунд");
  const desc = txt(block.text, "desc", "Регистрация без лишних полей, оплата привычным способом, доступ — сразу.");
  const ctaText = txt(block.text, "ctaText", "Начать сейчас");
  const ctaUrl = p(block.props, "ctaUrl", "/cabinet/register");

  const accentBg = accentTheme.ctaBg;
  const bannerRef = useScrollReveal<HTMLDivElement>([], { y: 20, dur: 0.45, stagger: 0 });

  return (
    <section className="max-w-7xl mx-auto px-4 pb-20 pt-4 md:pb-28">
      <div
        ref={bannerRef}
        className="relative overflow-hidden rounded-[36px] p-10 text-center md:p-16"
        style={{ background: accentBg }}
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.18),transparent_55%),radial-gradient(circle_at_75%_80%,rgba(255,255,255,0.12),transparent_50%)]" />

        <div className="relative mx-auto max-w-2xl">
          <div className="text-xs font-semibold uppercase tracking-[0.32em]" style={{ color: accentTheme.ctaFg, opacity: 0.85 }}>{eyebrow}</div>
          <h2 className="mt-4 text-3xl font-black tracking-[-0.04em] md:text-5xl" style={{ color: accentTheme.ctaFg }}>{title}</h2>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed md:text-lg" style={{ color: accentTheme.ctaFg, opacity: 0.92 }}>{desc}</p>
          <Button asChild size="lg" className="group mt-8 h-14 rounded-full bg-white px-8 text-base font-semibold hover:bg-card" style={{ color: "#0B0D12" }}>
            <Link to={buildLink(ctaUrl)} className="flex items-center gap-2">
              {ctaText}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
