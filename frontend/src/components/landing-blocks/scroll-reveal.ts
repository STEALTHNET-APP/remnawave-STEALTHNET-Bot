/**
 * Появление детей контейнера при скролле (once, как whileInView в старой анимационной либе).
 * Один ScrollTrigger на контейнер (start "top 85%", once) — триггеры живут внутри
 * gsap.context и снимаются при revert/unmount. Уважает prefers-reduced-motion.
 */
import { useEffect, useRef, type RefObject } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { EASE_OUT, reducedMotion } from "@/lib/gsap-utils";

gsap.registerPlugin(ScrollTrigger);

export function useScrollReveal<T extends HTMLElement>(
  deps: unknown[] = [],
  opts: { y?: number; dur?: number; stagger?: number; selector?: string } = {},
): RefObject<T> {
  const ref = useRef<T>(null) as RefObject<T>;
  useEffect(() => {
    const el = ref.current;
    if (!el || reducedMotion()) return;
    const targets = opts.selector ? Array.from(el.querySelectorAll<HTMLElement>(opts.selector)) : Array.from(el.children) as HTMLElement[];
    if (!targets.length) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        targets,
        { y: opts.y ?? 14, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: opts.dur ?? 0.4,
          ease: EASE_OUT,
          stagger: opts.stagger ?? 0.05,
          overwrite: "auto",
          clearProps: "transform",
          scrollTrigger: { trigger: el, start: "top 85%", once: true },
        },
      );
    }, el);
    return () => ctx.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}
