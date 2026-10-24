/**
 * AuroraPaymentsSheet — история платежей клиента в стиле Aurora.
 *
 * Использует api.clientPayments(token).
 * Показывает:
 *  - Статусы: PAID (Оплачено), PENDING (Ожидает), FAILED (Неудачно), REFUNDED (Возврат);
 *  - Сумму с валютой (+500 ₽);
 *  - Дату и время операции, номер заказа;
 *  - Empty state при отсутствии транзакций;
 *  - Полная поддержка светлой и тёмной тем Aurora.
 */

import { useEffect, useState } from "react";
import {
  CreditCard, Loader2, Receipt, CheckCircle2, Clock, XCircle, RotateCcw, AlertCircle,
} from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { api, type ClientPayment } from "@/lib/api";
import { AuroraSheet } from "@/components/aurora/aurora-sheet";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
}

function statusMeta(status: string) {
  const s = (status || "").toUpperCase();
  if (s === "PAID") {
    return {
      label: "Оплачено",
      badgeCls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25",
      iconCls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25",
      Icon: CheckCircle2,
    };
  }
  if (s === "FAILED" || s === "CANCELED" || s === "CANCELLED") {
    return {
      label: "Неудачно",
      badgeCls: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/25",
      iconCls: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/25",
      Icon: XCircle,
    };
  }
  if (s === "REFUNDED") {
    return {
      label: "Возврат",
      badgeCls: "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/25",
      iconCls: "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/25",
      Icon: RotateCcw,
    };
  }
  return {
    label: "Ожидает",
    badgeCls: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25",
    iconCls: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25",
    Icon: Clock,
  };
}

function fmtAmount(amount: number, currency: string) {
  const isRub = (currency || "").toUpperCase() === "RUB";
  const sym = isRub ? "₽" : (currency || "").toUpperCase() === "USD" ? "$" : (currency || "").toUpperCase();
  return `${amount.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ${sym}`;
}

function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function AuroraPaymentsSheet({ open, onClose }: Props) {
  const { state } = useClientAuth();
  const token = state.token;

  const [items, setItems] = useState<ClientPayment[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !token) return;
    let alive = true;
    setLoading(true);
    setError(null);

    api.clientPayments(token)
      .then((r) => {
        if (alive) setItems(r.items ?? []);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "Не удалось загрузить историю платежей");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [open, token]);

  return (
    <AuroraSheet
      open={open}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--au-surface)] text-[var(--au-from)]">
            <CreditCard className="h-4 w-4" />
          </span>
          <span>История платежей</span>
        </div>
      }
    >
      <div className="space-y-3 pb-3">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 text-[var(--au-muted)]">
            <Loader2 className="h-7 w-7 animate-spin text-[var(--au-from)]" />
            <p className="mt-3 text-[14px]">Загружаем операции…</p>
          </div>
        ) : error ? (
          <div className="rounded-[20px] border border-red-500/25 bg-red-500/10 p-4 text-center">
            <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-red-500/15 text-red-500">
              <AlertCircle className="h-5 w-5" />
            </div>
            <p className="text-[14px] font-semibold text-red-600 dark:text-red-400">{error}</p>
            <button
              type="button"
              onClick={() => {
                if (!token) return;
                setLoading(true);
                setError(null);
                api.clientPayments(token)
                  .then((r) => setItems(r.items ?? []))
                  .catch((e) => setError(e instanceof Error ? e.message : "Ошибка"))
                  .finally(() => setLoading(false));
              }}
              className="mt-3 rounded-[14px] bg-[var(--au-surface)] px-4 py-2 text-[13px] font-bold text-[var(--au-ink)] transition-transform active:scale-95"
            >
              Повторить попытку
            </button>
          </div>
        ) : !items || items.length === 0 ? (
          <div className="rounded-[24px] bg-[var(--au-surface)] p-8 text-center text-[var(--au-muted)]">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--au-bg)] text-[var(--au-muted)]">
              <Receipt className="h-6 w-6" />
            </div>
            <p className="text-[16px] font-bold text-[var(--au-ink)]">Платежей пока нет</p>
            <p className="mt-1 text-[13px]">Здесь появятся ваши пополнения баланса и оплаты тарифов</p>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((p) => {
              const meta = statusMeta(p.status);
              const Icon = meta.Icon;
              return (
                <div
                  key={p.id}
                  className="flex items-center gap-3.5 rounded-[20px] bg-[var(--au-surface)] p-3.5 transition-transform active:scale-[0.99]"
                >
                  <div
                    className={cn(
                      "flex h-11 w-11 shrink-0 items-center justify-center rounded-[16px] border",
                      meta.iconCls,
                    )}
                  >
                    <Icon className="h-5 w-5" strokeWidth={2.2} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-0.5 flex items-center justify-between gap-2">
                      <span className="text-[15.5px] font-extrabold tabular-nums text-[var(--au-ink)]">
                        {fmtAmount(p.amount, p.currency)}
                      </span>
                      <span
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-[11px] font-bold tracking-wide",
                          meta.badgeCls,
                        )}
                      >
                        {meta.label}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[12px] text-[var(--au-muted)]">
                      <span>{fmtDate(p.paidAt || p.createdAt)}</span>
                      <span className="font-mono text-[11px] opacity-75">
                        #{p.orderId ? p.orderId.slice(-8).toUpperCase() : p.id.slice(-6).toUpperCase()}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AuroraSheet>
  );
}
