import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, XCircle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

//  Лёгкий toast-store (без провайдера). Императивный API как у sonner:
//    toast.success("Готово"), toast.error("Ошибка", "детали"), toast.info(...)
//    Рендерится один раз через <Toaster /> в App.tsx.

export type ToastVariant = "success" | "error" | "info";

export type ToastItem = {
  id: number;
  variant: ToastVariant;
  title: string;
  description?: string;
  duration: number;
};

type ToastInput = {
  variant?: ToastVariant;
  title: string;
  description?: string;
  duration?: number;
};

let items: ToastItem[] = [];
let counter = 0;
const listeners = new Set<(items: ToastItem[]) => void>();

function emit() {
  const snapshot = [...items];
  listeners.forEach((l) => l(snapshot));
}

function dismiss(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

function push(input: ToastInput): number {
  const id = ++counter;
  const item: ToastItem = {
    id,
    variant: input.variant ?? "info",
    title: input.title,
    description: input.description,
    duration: input.duration ?? 4500,
  };
  // не копим бесконечно — максимум 4 на экране
  items = [...items, item].slice(-4);
  emit();
  if (item.duration > 0 && typeof window !== "undefined") {
    window.setTimeout(() => dismiss(id), item.duration);
  }
  return id;
}

type ToastFn = ((input: ToastInput) => number) & {
  success: (title: string, description?: string) => number;
  error: (title: string, description?: string) => number;
  info: (title: string, description?: string) => number;
  dismiss: (id: number) => void;
};

export const toast: ToastFn = Object.assign(
  (input: ToastInput) => push(input),
  {
    success: (title: string, description?: string) => push({ variant: "success", title, description }),
    error: (title: string, description?: string) => push({ variant: "error", title, description, duration: 6000 }),
    info: (title: string, description?: string) => push({ variant: "info", title, description }),
    dismiss,
  },
);

function useToasts(): ToastItem[] {
  const [list, setList] = useState<ToastItem[]>(items);
  useEffect(() => {
    listeners.add(setList);
    setList([...items]);
    return () => {
      listeners.delete(setList);
    };
  }, []);
  return list;
}

const VARIANT_STYLE: Record<ToastVariant, { icon: typeof CheckCircle2; ring: string; iconColor: string; glow: string }> = {
  success: { icon: CheckCircle2, ring: "border-emerald-500/40", iconColor: "text-emerald-400", glow: "shadow-emerald-500/20" },
  error: { icon: XCircle, ring: "border-rose-500/40", iconColor: "text-rose-400", glow: "shadow-rose-500/20" },
  info: { icon: Info, ring: "border-border", iconColor: "text-primary", glow: "shadow-primary/20" },
};

function ToastCard({ item }: { item: ToastItem }) {
  const style = VARIANT_STYLE[item.variant];
  const Icon = style.icon;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -24, scale: 0.92 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -16, scale: 0.92, transition: { duration: 0.18 } }}
      transition={{ type: "spring", stiffness: 380, damping: 30 }}
      className={cn(
        "pointer-events-auto relative flex w-[calc(100vw-2rem)] max-w-sm items-start gap-3 overflow-hidden rounded-xl border bg-card/90 px-4 py-3.5",
        style.ring,
        style.glow,
      )}
    >
      <span className={cn("mt-0.5 shrink-0", style.iconColor)}>
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold leading-snug text-foreground">{item.title}</p>
        {item.description && (
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground break-words">{item.description}</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => dismiss(item.id)}
        className="shrink-0 rounded-md p-1 text-muted-foreground/60 transition-colors hover:bg-muted/40 hover:text-foreground"
        aria-label="Закрыть"
      >
        <X className="h-4 w-4" />
      </button>
    </motion.div>
  );
}

export function Toaster() {
  const list = useToasts();
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex flex-col items-center gap-2 px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)]"
      role="region"
      aria-live="polite"
    >
      <AnimatePresence initial={false}>
        {list.map((item) => (
          <ToastCard key={item.id} item={item} />
        ))}
      </AnimatePresence>
    </div>,
    document.body,
  );
}
