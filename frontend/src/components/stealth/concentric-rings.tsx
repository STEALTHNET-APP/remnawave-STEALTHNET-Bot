/**
 * ConcentricRings — большая иконочная капля с тремя концентрическими красными
 * кольцами вокруг (как у Hundler VPN на каждом шаге wizard'а).
 *
 * Структура:
 *  - 3 ring-обводки (size: 100, 130, 160 px, цвет тающий — opacity 60%/30%/15%)
 *  - центральный чёрный круг 90px с bordered red glow
 *  - иконка 28px по центру (любая Lucide-иконка)
 *
 * Используется на wizard-шагах + где нужно «фокусировать внимание» на одном
 * крупном иконочном элементе.
 */

import { useEffect, useRef } from "react";
import { type LucideIcon } from "lucide-react";
import gsap from "gsap";
import { EASE_SPRING, reducedMotion } from "@/lib/gsap-utils";
import { cn } from "@/lib/utils";

interface Props {
  icon: LucideIcon;
  /** Размер центрального круга в px (внешние кольца масштабируются от него). */
  size?: number;
  /** Custom CSS color для всех колец и glow. По умолчанию saccent-500. */
  accent?: string;
  className?: string;
}

export function ConcentricRings({ icon: Icon, size = 88, accent = "rgb(255 35 87)", className }: Props) {
  const r1 = size + 24;
  const r2 = size + 56;
  const r3 = size + 88;
  const rootRef = useRef<HTMLDivElement>(null);

  // Вход центрального круга (spring-pop) + бесконечная «дыхательная»
  // пульсация колец и glow — всё в одном gsap.context с revert.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const ctx = gsap.context(() => {
      const center = root.querySelector<HTMLElement>("[data-ring-center]");
      if (center) {
        if (reducedMotion()) {
          gsap.set(center, { scale: 1, opacity: 1 });
        } else {
          gsap.fromTo(
            center,
            { scale: 0.9, opacity: 0 },
            { scale: 1, opacity: 1, duration: 0.55, ease: EASE_SPRING, clearProps: "transform" },
          );
        }
      }
      if (reducedMotion()) return;
      // yoyo-пульсация: циклы 3.6s, задержки по слоям — как раньше во framer-motion.
      root.querySelectorAll<HTMLElement>("[data-ring-pulse]").forEach((el) => {
        const o = Number(el.dataset.ringOpacity ?? "0.2");
        const delay = Number(el.dataset.ringDelay ?? "0");
        gsap.fromTo(
          el,
          { opacity: o, scale: 1 },
          {
            opacity: o * 0.45,
            scale: 1.04,
            duration: 1.8,
            yoyo: true,
            repeat: -1,
            ease: "sine.inOut",
            delay,
          },
        );
      });
      const glow = root.querySelector<HTMLElement>("[data-ring-glow]");
      if (glow) {
        gsap.fromTo(
          glow,
          { opacity: 0.8, scale: 1 },
          { opacity: 1, scale: 1.08, duration: 1.8, yoyo: true, repeat: -1, ease: "sine.inOut" },
        );
      }
    }, root);
    return () => ctx.revert();
  }, []);

  return (
    <div
      ref={rootRef}
      className={cn("relative flex items-center justify-center", className)}
      style={{ width: r3, height: r3, margin: "0 auto" }}
    >
      {/* Outer rings (тающие, с мягкой дышащей пульсацией) */}
      {([
        { d: r3, o: 0.12, delay: 0.5 },
        { d: r2, o: 0.22, delay: 0.25 },
        { d: r1, o: 0.4, delay: 0 },
      ] as const).map(({ d, o, delay }) => (
        <div
          key={d}
          data-ring-pulse
          data-ring-opacity={o}
          data-ring-delay={delay}
          className="absolute rounded-full border"
          style={{ width: d, height: d, borderColor: accent }}
        />
      ))}
      {/* Glow */}
      <div
        data-ring-glow
        className="absolute rounded-full"
        style={{ width: size + 12, height: size + 12, background: `radial-gradient(circle, ${accent}33 0%, transparent 70%)`, filter: "blur(12px)" }}
      />
      {/* Central circle */}
      <div
        data-ring-center
        className="relative rounded-full bg-zinc-950 border flex items-center justify-center"
        style={{
          width: size,
          height: size,
          borderColor: `${accent}55`,
          boxShadow: `0 0 30px -8px ${accent}66, inset 0 0 24px ${accent}1a`,
        }}
      >
        <Icon className="h-7 w-7 text-white" strokeWidth={1.8} />
      </div>
    </div>
  );
}
