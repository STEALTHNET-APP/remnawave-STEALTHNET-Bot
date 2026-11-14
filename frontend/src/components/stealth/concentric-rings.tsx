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
 * крупном иконичном элементе.
 */

import { motion, useReducedMotion } from "framer-motion";
import { type LucideIcon } from "lucide-react";
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
  const reduceMotion = useReducedMotion();

  return (
    <div
      className={cn("relative flex items-center justify-center", className)}
      style={{ width: r3, height: r3, margin: "0 auto" }}
    >
      {/* Outer rings (тающие, с мягкой дышащей пульсацией) */}
      {([
        { d: r3, o: 0.12, delay: 0.5 },
        { d: r2, o: 0.22, delay: 0.25 },
        { d: r1, o: 0.4, delay: 0 },
      ] as const).map(({ d, o, delay }) => (
        <motion.div
          key={d}
          className="absolute rounded-full border"
          style={{ width: d, height: d, borderColor: accent }}
          initial={{ opacity: o, scale: 1 }}
          animate={reduceMotion ? undefined : { opacity: o * 0.45, scale: 1.04 }}
          transition={{ duration: 1.8, repeat: Infinity, repeatType: "reverse", ease: "easeInOut", delay }}
        />
      ))}
      {/* Glow */}
      <motion.div
        className="absolute rounded-full"
        style={{ width: size + 12, height: size + 12, background: `radial-gradient(circle, ${accent}33 0%, transparent 70%)`, filter: "blur(12px)" }}
        initial={{ opacity: 0.8, scale: 1 }}
        animate={reduceMotion ? undefined : { opacity: 1, scale: 1.08 }}
        transition={{ duration: 1.8, repeat: Infinity, repeatType: "reverse", ease: "easeInOut" }}
      />
      {/* Central circle */}
      <motion.div
        className="relative rounded-full bg-zinc-950 border flex items-center justify-center"
        style={{
          width: size,
          height: size,
          borderColor: `${accent}55`,
          boxShadow: `0 0 30px -8px ${accent}66, inset 0 0 24px ${accent}1a`,
        }}
        initial={reduceMotion ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.55, ease: "backOut" }}
      >
        <Icon className="h-7 w-7 text-white" strokeWidth={1.8} />
      </motion.div>
    </div>
  );
}
