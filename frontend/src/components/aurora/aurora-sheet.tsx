/**
 * AuroraSheet — нижняя шторка дизайна Aurora.
 *
 * Общая оболочка для модальных окон: заголовок, прокручиваемое тело и
 * необязательный «подвал», приклеенный к низу (например поле ввода в чате).
 *
 * Внутри уже учтены две грабли мобильного WebKit:
 *   • затемнение БЕЗ `backdrop-filter` — иначе оно наложится на размытие
 *     стеклянного нижнего меню, и при каждой перерисовке содержимого шторка
 *     стробит и проваливается в прозрачность;
 *   • на время показа меню прячется (атрибут `data-au-sheet` на <html>,
 *     правило в index.css) — по той же причине.
 * Плюс фон не скроллит, пока шторка открыта.
 *
 * Анимация въезда/выезда — gsap (yPercent 100 ↔ 0): шторка остаётся в DOM,
 * пока играет exit (onComplete убирает её через ~300 мс), поэтому закрытие
 * плавное, как раньше с AnimatePresence.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import gsap from "gsap";
import { X } from "lucide-react";
import { EASE_OUT, reducedMotion } from "@/lib/gsap-utils";

interface Props {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  /** Приклеен к низу, не участвует в прокрутке тела. */
  footer?: ReactNode;
  children: ReactNode;
}

export function AuroraSheet({ open, onClose, title, footer, children }: Props) {
  // Шторка смонтирована, пока открыта И пока играет анимация выхода.
  const [mounted, setMounted] = useState(open);
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.dataset.auSheet = "1";
    return () => {
      document.body.style.overflow = prev;
      delete document.documentElement.dataset.auSheet;
    };
  }, [open]);

  useEffect(() => {
    const overlay = overlayRef.current;
    const panel = panelRef.current;
    if (!overlay || !panel) return;
    if (reducedMotion()) {
      // Без анимаций: мгновенно в финальное состояние, размонтируем сразу.
      gsap.set(panel, { yPercent: open ? 0 : 100 });
      gsap.set(overlay, { opacity: open ? 1 : 0 });
      if (!open) setMounted(false);
      return;
    }
    const ctx = gsap.context(() => {
      if (open) {
        gsap.fromTo(
          overlay,
          { opacity: 0 },
          { opacity: 1, duration: 0.35, ease: EASE_OUT },
        );
        gsap.fromTo(
          panel,
          { yPercent: 100 },
          { yPercent: 0, duration: 0.35, ease: EASE_OUT },
        );
      } else {
        gsap.to(overlay, { opacity: 0, duration: 0.3, ease: EASE_OUT });
        gsap.to(panel, {
          yPercent: 100,
          duration: 0.3,
          ease: EASE_OUT,
          // убираем из DOM сразу по завершении выхода (~300 мс)
          onComplete: () => setMounted(false),
        });
      }
    }, overlay);
    return () => ctx.revert();
  }, [open, mounted]);

  if (!mounted) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[55] flex items-end justify-center bg-black/45"
      style={{ opacity: 0 }}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        className="flex max-h-[88vh] w-full max-w-md flex-col rounded-t-[28px] bg-[var(--au-bg)] pt-3 text-[var(--au-ink)] [backface-visibility:hidden] [isolation:isolate]"
        style={{
          // стартовое состояние до первого твина — без вспышки на 1 кадр
          transform: "translate3d(0, 100%, 0)",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* «ручка» шторки */}
        <div className="mx-auto mb-3 h-1.5 w-10 shrink-0 rounded-full bg-[var(--au-surface)]" />

        {title && (
          <div className="flex shrink-0 items-center gap-3 px-5 pb-3">
            <h2 className="min-w-0 flex-1 truncate text-[19px] font-extrabold">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Закрыть"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--au-surface)] text-[var(--au-muted)] active:scale-95 transition-transform"
            >
              <X className="h-[18px] w-[18px]" />
            </button>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-5">{children}</div>

        {footer && <div className="shrink-0 px-5 pt-3">{footer}</div>}
      </div>
    </div>
  );
}
