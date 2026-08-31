/**
 * отчёт продаж через баланс.
 * Минималистичная страница для менеджеров-девочек: видят только то, что было оплачено
 * через начисление баланса вручную (provider=balance), без всех остальных платёжек.
 * Доступ — через action `view_balance_sales`.
 */
import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/auth";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { motion } from "framer-motion";
import { Search, CalendarDays, RefreshCw, Package, X } from "lucide-react";
import { fmtMskShort } from "@/lib/datetime";

function fmtDate(s: string | null) {
  if (!s) return "—";
  try { return fmtMskShort(s); } catch { return s; }
}

function fmtMoney(n: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(n);
}

interface BalanceSaleItem {
  id: string;
  amount: number;
  currency: string;
  tariffName: string | null;
  clientId: string | null;
  clientEmail: string | null;
  clientTelegramId: string | null;
  clientTelegramUsername: string | null;
  paidAt: string | null;
}

export function BalanceSalesPage() {
  const { state } = useAuth();
  const token = state.accessToken;

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [limit] = useState(50);

  const [items, setItems] = useState<BalanceSaleItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalAmount, setTotalAmount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.getBalanceSales(token, {
        from: from || undefined,
        to: to || undefined,
        search: search || undefined,
        page,
        limit,
      });
      setItems(res.items);
      setTotal(res.total);
      setTotalAmount(res.totalAmount);
      setTotalCount(res.totalCount);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, [token, from, to, search, page, limit]);

  useEffect(() => { load(); }, [load]);

  function resetFilters() {
    setFrom("");
    setTo("");
    setSearch("");
    setPage(1);
  }

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="flex flex-col gap-3.5 relative">

      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
      >
        <div className="flex items-start gap-3">
          <div>
            <h1 className="text-xl font-extrabold tracking-[-0.3px] text-foreground">
              Продажи через баланс
            </h1>
            <p className="text-[12.5px] text-muted-foreground mt-[3px]">
              Только платежи, оплаченные с баланса клиентов
            </p>
          </div>
        </div>
        <Button onClick={() => load()} variant="outline" className="gap-2 rounded-xl">
          <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} /> Обновить
        </Button>
      </motion.div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="bg-card border-border rounded-xl p-5">
          <div className="flex items-center gap-3">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Сумма продаж</p>
              <p className="text-[13.5px] font-bold">{fmtMoney(totalAmount)}</p>
            </div>
          </div>
        </Card>
        <Card className="bg-card border-border rounded-xl p-5">
          <div className="flex items-center gap-3">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Кол-во продаж</p>
              <p className="text-[13.5px] font-bold">{totalCount}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Filters */}
      <Card className="bg-card border-border rounded-xl p-5">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground flex items-center gap-1"><CalendarDays className="h-3 w-3" /> С даты</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-xl bg-foreground/[0.03] border-border" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground flex items-center gap-1"><CalendarDays className="h-3 w-3" /> По дату</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-xl bg-foreground/[0.03] border-border" />
          </div>
          <div className="sm:col-span-2 space-y-1.5">
            <label className="text-xs text-muted-foreground flex items-center gap-1"><Search className="h-3 w-3" /> Поиск (email/TG/тариф)</label>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="например, manager@example.com" className="rounded-xl bg-foreground/[0.03] border-border" />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-3">
          <Button variant="ghost" size="sm" onClick={resetFilters} className="rounded-xl gap-1">
            <X className="h-3.5 w-3.5" /> Сбросить
          </Button>
        </div>
      </Card>

      {/* Table */}
      <Card className="bg-card border-border rounded-2xl overflow-hidden">
        {error && (
          <div className="bg-rose-500/10 border-b border-rose-500/30 px-5 py-3 text-sm text-rose-500">{error}</div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-border">
                <th className="px-5 py-3.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Дата</th>
                <th className="px-5 py-3.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Клиент</th>
                <th className="px-5 py-3.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Тариф</th>
                <th className="px-5 py-3.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground text-right">Сумма</th>
              </tr>
            </thead>
            <tbody>
              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <p className="text-sm text-muted-foreground">Ничего не найдено — измените фильтры или период.</p>
                    </div>
                  </td>
                </tr>
              )}
              {items.map((it) => (
                <tr key={it.id} className="border-t border-border hover:bg-white/[0.02] transition-colors">
                  <td className="px-4 py-3 whitespace-nowrap text-xs text-muted-foreground">{fmtDate(it.paidAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="min-w-0">
                        {it.clientEmail && <div className="text-xs font-medium truncate">{it.clientEmail}</div>}
                        {it.clientTelegramUsername && <div className="text-xs text-muted-foreground truncate">@{it.clientTelegramUsername}</div>}
                        {!it.clientEmail && !it.clientTelegramUsername && it.clientTelegramId && <div className="text-xs text-muted-foreground">TG: {it.clientTelegramId}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 text-xs">
                      <Package className="h-3 w-3 text-violet-500 shrink-0" />
                      <span className="truncate">{it.tariffName ?? "—"}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <span className="font-bold text-emerald-500">{fmtMoney(it.amount)}</span>
                    <span className="text-[10px] text-muted-foreground ml-1">{it.currency}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-border flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Страница {page} из {totalPages} · всего {total}</span>
            <div className="flex gap-1.5">
              <Button size="sm" variant="outline" className="rounded-lg h-8" disabled={page <= 1} onClick={() => setPage(page - 1)}>Назад</Button>
              <Button size="sm" variant="outline" className="rounded-lg h-8" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Вперёд</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
