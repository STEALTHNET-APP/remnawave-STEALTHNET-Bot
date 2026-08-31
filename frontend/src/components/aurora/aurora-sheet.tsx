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
 * Плюс фон не скроллится, пока шторка открыта.
 */

import { useEffect, type ReactNode } from "react";
import { motion } from "framer-motion";
import { X } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  /** Приклеен к низу, не участвует в прокрутке тела. */
  footer?: ReactNode;
  children: ReactNode;
}

export function AuroraSheet({ open, onClose, title, footer, children }: Props) {
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

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[55] flex items-end justify-center bg-black/45"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        transition={{ type: "spring", stiffness: 340, damping: 34 }}
        className="flex max-h-[88vh] w-full max-w-md flex-col rounded-t-[28px] bg-[var(--au-bg)] pt-3 text-[var(--au-ink)] [backface-visibility:hidden] [isolation:isolate]"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}
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
      </motion.div>
    </div>
  );
}
