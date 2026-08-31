/**
 * админ-страница «Заявки на вывод» (USDT TRC20).
 *
 * Список заявок с фильтром по статусу. Действия: одобрить / отклонить.
 * - При approve клиенту автоматически уходит TG-уведомление.
 * - При reject баланс возвращается клиенту атомарно (см. backend).
 */

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth";
import { api } from "@/lib/api";
import type { WithdrawalRequestRecord } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Check, X, RefreshCw, Copy, Clock3 } from "lucide-react";
import { fmtMsk } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

type StatusFilter = "ALL" | "PENDING" | "APPROVED" | "REJECTED";

const STATUS_LABEL: Record<WithdrawalRequestRecord["status"], string> = {
  PENDING: "Ожидает",
  APPROVED: "Одобрено",
  REJECTED: "Отклонено",
};

const STATUS_CHIP: Record<WithdrawalRequestRecord["status"], string> = {
  PENDING: "bg-amber-500/15 text-amber-500 dark:text-amber-400 border-amber-500/30",
  APPROVED: "bg-emerald-500/15 text-emerald-500 dark:text-emerald-400 border-emerald-500/30",
  REJECTED: "bg-rose-500/15 text-rose-500 dark:text-rose-400 border-rose-500/30",
};

const STATUS_DOT: Record<WithdrawalRequestRecord["status"], string> = {
  PENDING: "bg-amber-400",
  APPROVED: "bg-emerald-400",
  REJECTED: "bg-rose-400",
};

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "PENDING", label: "Ожидают" },
  { key: "APPROVED", label: "Одобрены" },
  { key: "REJECTED", label: "Отклонены" },
  { key: "ALL", label: "Все" },
];

export function WithdrawalsPage() {
  const { state } = useAuth();
  const token = state.accessToken ?? null;

  const [items, setItems] = useState<WithdrawalRequestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("PENDING");
  const [processing, setProcessing] = useState<string | null>(null);

  const load = async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.getWithdrawals(token, filter === "ALL" ? undefined : filter);
      setItems(res.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, filter]);

  const handleApprove = async (id: string) => {
    if (!token) return;
    if (!confirm("Одобрить заявку? Клиенту придёт уведомление в Telegram.\n\nДеньги переводи на USDT TRC20 кошелёк вручную после нажатия.")) return;
    setProcessing(id);
    try {
      await api.approveWithdrawal(token, id);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка одобрения");
    } finally {
      setProcessing(null);
    }
  };

  const handleReject = async (id: string) => {
    if (!token) return;
    const comment = prompt("Причина отклонения (необязательно):");
    if (comment === null) return;
    if (!confirm("Отклонить заявку? Баланс автоматически вернётся клиенту.")) return;
    setProcessing(id);
    try {
      await api.rejectWithdrawal(token, id, comment.trim() || undefined);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка отклонения");
    } finally {
      setProcessing(null);
    }
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore
    }
  };

  const clientLabel = (c: WithdrawalRequestRecord["client"]) => {
    if (c.telegramUsername) return `@${c.telegramUsername}`;
    if (c.email) return c.email;
    if (c.telegramId) return `TG:${c.telegramId}`;
    return c.id.slice(0, 8);
  };

  return (
    <div className="flex flex-col gap-3.5 relative">

      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
      >
        <div className="flex items-start gap-3">
          <div>
            <h1 className="text-xl font-extrabold tracking-[-0.3px] text-foreground">Заявки на вывод</h1>
            <p className="text-[12.5px] text-muted-foreground mt-[3px]">USDT TRC20 · Минимальная сумма заявки 3000₽ · reject возвращает баланс автоматически.</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5 rounded-xl">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Обновить
        </Button>
      </motion.div>

      <div className="flex flex-wrap gap-1.5 bg-card border border-border rounded-xl p-1.5 w-fit">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              "px-3.5 py-1.5 rounded-xl text-sm font-medium transition-all",
              filter === f.key
                ? "bg-primary text-primary-foreground shadow"
                : "text-muted-foreground hover:text-foreground hover:bg-foreground/5"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500 dark:text-red-400">{error}</div>
      )}

      {loading ? (
        <Card className="bg-card border-border rounded-2xl py-16 flex flex-col items-center justify-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Загружаем заявки…</p>
        </Card>
      ) : items.length === 0 ? (
        <Card className="bg-card border-border rounded-2xl p-12">
          <div className="flex flex-col items-center justify-center text-center">
            <h3 className="text-[13.5px] font-bold tracking-tight">Нет заявок</h3>
            <p className="text-[12.5px] text-muted-foreground mt-[3px]">
              {filter === "ALL" ? "Заявок на вывод пока не было." : `Со статусом «${filter === "PENDING" ? "Ожидает" : filter === "APPROVED" ? "Одобрено" : "Отклонено"}» ничего нет.`}
            </p>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4">
          {items.map((item, idx) => (
            <motion.div key={item.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(idx * 0.03, 0.3) }} whileHover={{ y: -2 }}>
              <Card className="bg-card border-border rounded-2xl p-5 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={cn("inline-flex items-center gap-1.5 border rounded-full px-2.5 py-0.5 text-xs font-semibold", STATUS_CHIP[item.status])}>
                        <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[item.status])} />
                        {STATUS_LABEL[item.status]}
                      </span>
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock3 className="h-3 w-3" />
                        {fmtMsk(item.createdAt)}
                      </span>
                    </div>
                    <p className="text-[13.5px] font-bold tracking-tight">{item.amount.toFixed(2)} ₽</p>
                  </div>
                  {item.status === "PENDING" && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white"
                        onClick={() => handleApprove(item.id)}
                        disabled={processing === item.id}
                      >
                        {processing === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                        Одобрить
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="gap-1.5 rounded-xl"
                        onClick={() => handleReject(item.id)}
                        disabled={processing === item.id}
                      >
                        <X className="h-4 w-4" />
                        Отклонить
                      </Button>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm rounded-xl border border-border bg-foreground/[0.02] p-4">
                  <div className="space-y-1">
                    <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Клиент</p>
                    <p className="font-medium">{clientLabel(item.client)}</p>
                    {item.client.telegramId && (
                      <p className="text-xs text-muted-foreground">TG ID: <code>{item.client.telegramId}</code></p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Кошелёк TRC20</p>
                    <div className="flex items-center gap-2">
                      <code className="text-xs bg-foreground/5 border border-border px-2 py-1 rounded-lg break-all">{item.walletTrc20}</code>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 shrink-0 rounded-lg"
                        onClick={() => copyText(item.walletTrc20)}
                        title="Скопировать кошелёк"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>

                {item.adminComment && (
                  <div className="text-sm pt-2 border-t border-border">
                    <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Комментарий админа</p>
                    <p className="text-muted-foreground">{item.adminComment}</p>
                  </div>
                )}

                {item.processedAt && (
                  <p className="text-xs text-muted-foreground">
                    Обработано: {fmtMsk(item.processedAt)}
                  </p>
                )}
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

export default WithdrawalsPage;
