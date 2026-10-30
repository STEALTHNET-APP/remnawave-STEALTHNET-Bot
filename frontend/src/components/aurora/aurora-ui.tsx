import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { Check, Copy, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Мелкие переиспользуемые блоки экранов Aurora. */

export function AuPage({ children }: { children: ReactNode }) {
  return <div className="space-y-3">{children}</div>;
}

export function AuHeader({ title, subtitle }: { title: ReactNode; subtitle?: ReactNode }) {
  return (
    <header className="px-1 pb-1">
      <h1 className="text-[26px] font-extrabold leading-tight tracking-tight text-[var(--au-ink)]">{title}</h1>
      {subtitle && <p className="mt-0.5 text-[14px] text-[var(--au-muted)]">{subtitle}</p>}
    </header>
  );
}

export function AuSection({
  title,
  action,
  children,
  className,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-[22px] bg-[var(--au-surface)] p-4", className)}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && <p className="text-[13px] font-semibold text-[var(--au-muted)]">{title}</p>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function AuRow({
  icon,
  title,
  subtitle,
  right,
  onClick,
  href,
  danger,
  disabled,
}: {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  onClick?: () => void;
  href?: string;
  danger?: boolean;
  disabled?: boolean;
}) {
  const content = (
    <>
      {icon && (
        <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--au-bg)]", danger ? "text-red-500" : "text-[var(--au-from)]")}>
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className={cn("block text-[14.5px] font-semibold", danger ? "text-red-600 dark:text-red-400" : "text-[var(--au-ink)]")}>{title}</span>
        {subtitle && <span className="mt-0.5 block text-[12.5px] leading-snug text-[var(--au-muted)]">{subtitle}</span>}
      </span>
      {right}
    </>
  );
  const className = "flex w-full items-center gap-3 rounded-[16px] p-3 text-left transition-transform enabled:active:scale-[0.99] disabled:opacity-45";
  if (href) {
    return (
      <a className={className} href={href} target="_blank" rel="noopener noreferrer">
        {content}
      </a>
    );
  }
  return (
    <button type="button" className={className} onClick={onClick} disabled={disabled}>
      {content}
    </button>
  );
}

export function AuEmpty({ icon, title, hint, action }: { icon?: ReactNode; title: ReactNode; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="grid justify-items-center gap-2 rounded-[22px] bg-[var(--au-surface)] p-6 text-center">
      {icon && <span className="text-[var(--au-muted)]">{icon}</span>}
      <p className="text-[14px] font-semibold text-[var(--au-ink)]">{title}</p>
      {hint && <p className="max-w-[280px] text-[13px] leading-snug text-[var(--au-muted)]">{hint}</p>}
      {action}
    </div>
  );
}

export function AuLoading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-[76px] animate-pulse rounded-[22px] bg-[var(--au-surface)]" />
      ))}
    </div>
  );
}

export function AuNotice({ tone = "info", children }: { tone?: "info" | "error" | "success"; children: ReactNode }) {
  const cls =
    tone === "error"
      ? "border-red-500/25 bg-red-500/10 text-red-600 dark:text-red-400"
      : tone === "success"
        ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
        : "border-[var(--color-border)] bg-[var(--au-surface)] text-[var(--au-muted)]";
  return <div className={cn("rounded-[16px] border p-3.5 text-[13px] leading-snug", cls)}>{children}</div>;
}

export function AuButton({
  children,
  variant = "primary",
  loading,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" | "surface"; loading?: boolean }) {
  const styles =
    variant === "primary"
      ? "bg-[linear-gradient(135deg,var(--au-from),var(--au-to))] text-white shadow-md"
      : variant === "danger"
        ? "border-2 border-red-500/25 bg-red-500/10 text-red-600 dark:text-red-400"
        : variant === "surface"
          ? "bg-[var(--au-surface)] text-[var(--au-ink)]"
          : "border-2 border-transparent bg-[var(--au-bg)] text-[var(--au-ink)]";
  return (
    <button
      {...rest}
      className={cn(
        "flex w-full items-center justify-center gap-2 rounded-[18px] px-5 py-3.5 text-[15px] font-bold transition-transform enabled:active:scale-[0.99] disabled:opacity-45",
        styles,
        className,
      )}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

export function AuInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...rest}
      className={cn(
        "w-full rounded-[16px] border-2 border-transparent bg-[var(--au-bg)] px-4 py-3 text-[15px] text-[var(--au-ink)] outline-none transition-colors placeholder:text-[var(--au-muted)] focus:border-[var(--au-from)]",
        className,
      )}
    />
  );
}

export function AuBadge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "success" | "danger" | "accent" }) {
  const cls =
    tone === "success"
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
      : tone === "danger"
        ? "bg-red-500/15 text-red-600 dark:text-red-400"
        : tone === "accent"
          ? "bg-[var(--au-from)]/12 text-[var(--au-from)]"
          : "bg-[var(--au-bg)] text-[var(--au-muted)]";
  return <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-semibold", cls)}>{children}</span>;
}

export function CopyButton({
  value,
  label,
  copiedLabel,
  onCopied,
  copied,
  className,
}: {
  value: string;
  label?: ReactNode;
  copiedLabel?: ReactNode;
  copied: boolean;
  onCopied: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          onCopied();
        } catch {
          /* буфер недоступен */
        }
      }}
      className={cn(
        "flex items-center justify-center gap-2 rounded-[16px] bg-[var(--au-bg)] px-4 py-3 text-[14px] font-bold text-[var(--au-ink)] transition-transform active:scale-[0.97]",
        className,
      )}
    >
      {copied ? <Check className="h-[18px] w-[18px] text-emerald-500" /> : <Copy className="h-[18px] w-[18px]" />}
      {copied ? copiedLabel ?? label : label}
    </button>
  );
}

export function AuSheetClose({ onClose, label }: { onClose: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label={label}
      className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-[var(--au-surface)] text-[var(--au-muted)]"
    >
      <X className="h-5 w-5" />
    </button>
  );
}
