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
 * Анимация въезда/выезда — аппаратный CSS transition (translate-y 100% ↔ 0,
 * opacity 0 ↔ 1): устойчив к перерисовкам React при вводе текста, без
 * матричных сбоев JS-библиотек.
 */

import { useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  /** Приклеен к низу, не участвует в прокрутке тела. */
  footer?: ReactNode;
  children: ReactNode;
}

export function AuroraSheet({ open, onClose, title, footer, children }: Props) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const raf = requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setVisible(true);
        });
      });
      return () => cancelAnimationFrame(raf);
    } else {
      setVisible(false);
      const timer = setTimeout(() => {
        setMounted(false);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.dataset.auSheet = "1";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      delete document.documentElement.dataset.auSheet;
    };
  }, [open, onClose]);

  if (!mounted) return null;

  return (
    <div
      className={cn(
        "fixed inset-0 z-[55] flex items-end justify-center bg-black/45 transition-opacity duration-300 ease-out",
        visible ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
      )}
      onClick={onClose}
    >
      <div
        className={cn(
          "flex max-h-[88vh] w-full max-w-md flex-col rounded-t-[28px] bg-[var(--au-bg)] pt-3 text-[var(--au-ink)] [backface-visibility:hidden] [isolation:isolate] transition-transform duration-300 ease-out",
          visible ? "translate-y-0" : "translate-y-full"
        )}
        style={{
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
