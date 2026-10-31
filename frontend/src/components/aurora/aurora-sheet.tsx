import { useTranslation } from "react-i18next";
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

import { useEffect, useRef, useState, type ReactNode } from "react";
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

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function AuroraSheet({ open, onClose, title, footer, children }: Props) {
  const { t } = useTranslation();
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);

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
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const node = panel.current;
      if (!node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.dataset.auSheet = "1";
    restoreFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = window.setTimeout(() => {
      const node = panel.current;
      if (!node) return;
      const target = node.querySelector<HTMLElement>(FOCUSABLE) ?? node;
      target.focus({ preventScroll: true });
    }, 60);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(timer);
      document.body.style.overflow = prev;
      delete document.documentElement.dataset.auSheet;
      restoreFocus.current?.focus({ preventScroll: true });
    };
  }, [open, onClose]);

  if (!mounted) return null;

  return (
    <div
      className={cn(
        "app-viewport-overlay au-sheet-overlay fixed inset-0 z-[55] flex items-end justify-center bg-black/45 transition-opacity duration-300 ease-out",
        visible ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
      )}
      onClick={onClose}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        tabIndex={-1}
        className={cn(
          "flex max-h-[min(88dvh,100%)] w-full max-w-md flex-col rounded-t-[28px] bg-[var(--au-bg)] pt-3 text-[var(--au-ink)] [backface-visibility:hidden] [isolation:isolate] transition-transform duration-300 ease-out",
          visible ? "translate-y-0" : "translate-y-full"
        )}
        style={{
          paddingBottom: "calc(var(--app-safe-bottom) + 12px)",
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
              aria-label={t("aurora.close")}
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
