/**
 * GSAP-хелперы: единый easing/timing и готовые микро-анимации для кабинета.
 *
 * Правила:
 *  - gsap.context() для авто-очистки (revert при unmount) — без утечек твинов.
 *  - respects prefers-reduced-motion: анимации пропускаются, состояние финальное.
 *  - stagger для списков (карточки дашборда, тарифы) — вместо animate-in классов,
 *    которые мерцают при повторном монтировании (React re-render сбрасывает CSS-анимацию).
 */
import { useEffect, useRef, type RefObject } from "react";
import gsap from "gsap";

/** Правильный exit: [y-=12, opacity=0, blur] со скроллом-контекстом — мягкий вход секций. */
export const EASE_OUT = "power2.out";
export const EASE_SPRING = "back.out(1.4)";

export function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export function useStaggerReveal<T extends HTMLElement>(
  deps: unknown[] = [],
  opts: { y?: number; dur?: number; stagger?: number; selector?: string } = {},
): RefObject<T> {
  const ref = useRef<T>(null) as RefObject<T>;
  useEffect(() => {
    const el = ref.current;
    if (!el || reducedMotion()) return;
    const targets = opts.selector ? el.querySelectorAll(opts.selector) : el.children;
    if (!targets.length) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        targets,
        { y: opts.y ?? 14, opacity: 0, filter: "blur(3px)" },
        {
          y: 0,
          opacity: 1,
          filter: "blur(0px)",
          duration: opts.dur ?? 0.45,
          ease: EASE_OUT,
          stagger: opts.stagger ?? 0.06,
          overwrite: "auto",
          clearProps: "filter,transform",
        },
      );
    }, el);
    return () => ctx.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

/**
 * Появление элемента после загрузки данных БЕЗ «допрыгивания»:
 * место резервируется через min-height, контент плавно fade-in (один раз).
 * Использовать на контейнерах, чей контент зависит от query.isLoading.
 */
export function useFadeOnReady<T extends HTMLElement>(
  ready: boolean,
  deps: unknown[] = [],
): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const firstRef = useRef(false);
  useEffect(() => {
    if (!ready) return;
    const el = ref.current;
    if (!el || reducedMotion()) return;
    if (firstRef.current) return; // анимируем только первый показ — без ре-мерцания
    firstRef.current = true;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        el,
        { opacity: 0, y: 8 },
        { opacity: 1, y: 0, duration: 0.3, ease: EASE_OUT, clearProps: "transform" },
      );
    }, el);
    return () => ctx.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, ...deps]);
  return ref;
}

/** Микро-подтверждение действия (checkmark pop) — для кнопок после успеха. */
export function pulse(el: Element | null): void {
  if (!el || reducedMotion()) return;
  gsap.fromTo(
    el,
    { scale: 1 },
    { scale: 1.08, duration: 0.12, yoyo: true, repeat: 1, ease: "power1.inOut", overwrite: "auto" },
  );
}
