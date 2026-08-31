import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/auth";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { motion } from "framer-motion";
import {
  Download, DollarSign, ShoppingCart, TrendingUp, Search, CalendarDays,
  RefreshCw, CreditCard, User, Package, Hash, X, Trash2, MoreVertical,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PaymentActionsDrawer } from "@/components/payment-actions-drawer";
import { fmtMskShort } from "@/lib/datetime";

function fmtDate(s: string | null) {
  if (!s) return "—";
  try {
    return fmtMskShort(s);
  } catch {
    return s;
  }
}

function fmtMoney(n: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(n);
}

interface SaleItem {
  id: string;
  orderId: string;
  amount: number;
  currency: string;
  provider: string;
  status: string;
  tariffName: string | null;
  tariffId: string | null;
  clientId: string | null;
  clientEmail: string | null;
  clientTelegramId: string | null;
  clientTelegramUsername: string | null;
  paidAt: string | null;
  createdAt: string;
  metadata: string | null;
}

interface SalesData {
  items: SaleItem[];
  total: number;
  page: number;
  limit: number;
  totalAmount: number;
  totalCount: number;
  byCurrency: Record<string, { sum: number; count: number }>;
  byProvider: Record<string, number>;
}

const PROVIDERS: { value: string; label: string; color: string }[] = [
  { value: "", label: "Все", color: "" },
  { value: "balance", label: "Баланс", color: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/20" },
  { value: "platega", label: "Platega", color: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" },
  { value: "yoomoney_form", label: "ЮMoney", color: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20" },
  { value: "yookassa", label: "ЮKassa", color: "bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/20" },
  { value: "heleket", label: "Heleket", color: "bg-teal-500/15 text-teal-600 dark:text-teal-400 border-teal-500/20" },
];

function providerLabel(p: string) {
  const found = PROVIDERS.find((x) => x.value === p);
  if (found) return found.label;
  if (p === "yoomoney") return "ЮMoney";
  return p;
}

function providerColor(p: string) {
  const found = PROVIDERS.find((x) => x.value === p);
  if (found && found.color) return found.color;
  if (p === "yoomoney") return "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20";
  return "bg-foreground/[0.05] dark:bg-white/[0.05] text-muted-foreground border-border";
}

const DATE_PRESETS = [
  { label: "Сегодня", days: 0 },
  { label: "7 дней", days: 7 },
  { label: "30 дней", days: 30 },
  { label: "90 дней", days: 90 },
] as const;

export function SalesReportPage() {
  const { state } = useAuth();
  const token = state.accessToken;
  const [data, setData] = useState<SalesData | null>(null);
  const [loading, setLoading] = useState(true);

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [provider, setProvider] = useState("");
  const [search, setSearch] = useState("");
  const [searchApplied, setSearchApplied] = useState("");
  const [page, setPage] = useState(1);
  const [activePreset, setActivePreset] = useState<number | null>(null);
  const [actionsPaymentId, setActionsPaymentId] = useState<string | null>(null);
  const limit = 50;

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await api.getSalesReport(token, {
        from: dateFrom || undefined,
        to: dateTo || undefined,
        provider: provider || undefined,
        search: searchApplied || undefined,
        page,
        limit,
      });
      setData(res);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [token, dateFrom, dateTo, provider, searchApplied, page]);

  useEffect(() => { load(); }, [load]);

  function applySearch() {
    setSearchApplied(search);
    setPage(1);
  }

  function clearFilters() {
    setDateFrom("");
    setDateTo("");
    setProvider("");
    setSearch("");
    setSearchApplied("");
    setActivePreset(null);
    setPage(1);
  }

  function applyPreset(days: number) {
    const to = new Date();
    const from = new Date();
    if (days > 0) from.setDate(from.getDate() - days);
    setDateFrom(from.toISOString().slice(0, 10));
    setDateTo(to.toISOString().slice(0, 10));
    setActivePreset(days);
    setPage(1);
  }

  function exportCSV() {
    if (!data?.items.length) return;
    const header = "Дата;Заказ;Клиент;Telegram;Тариф;Сумма;Валюта;Провайдер";
    const rows = data.items.map((r) =>
      [fmtDate(r.paidAt), r.orderId, r.clientEmail ?? "", r.clientTelegramUsername ?? r.clientTelegramId ?? "", r.tariffName ?? "", r.amount.toFixed(2), r.currency, r.provider].join(";"),
    );
    const csv = "\uFEFF" + header + "\n" + rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sales-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function deletePayment(id: string) {
    if (!token) return;
    if (!confirm("Удалить этот платёж? Это действие необратимо.")) return;
    try {
      await api.deleteSalePayment(token, id);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка удаления");
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / limit)) : 1;
  const hasFilters = dateFrom || dateTo || provider || searchApplied;
  const avgAmount = data && data.totalCount > 0 ? data.totalAmount / data.totalCount : 0;

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
              Отчёты продаж
            </h1>
            <p className="text-[12.5px] text-muted-foreground mt-[3px]">Все оплаченные платежи и пополнения</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5 rounded-xl">
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            <span className="hidden sm:inline">Обновить</span>
          </Button>
          <Button variant="outline" size="sm" onClick={exportCSV} disabled={!data?.items.length} className="gap-1.5 rounded-xl">
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">CSV</span>
          </Button>
        </div>
      </motion.div>

      {/* Summary cards */}
      {data && (
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          {[
            {
              icon: DollarSign,
              label: "Выручка",
              value: fmtMoney(data.totalAmount),
              color: "primary",
              extra: Object.keys(data.byCurrency).length > 1 ? (
                <div className="flex flex-wrap gap-x-2 mt-0.5">
                  {Object.entries(data.byCurrency).map(([cur, v]) => (
                    <span key={cur} className="text-[10px] text-muted-foreground">{fmtMoney(v.sum)} {cur}</span>
                  ))}
                </div>
              ) : null,
              gradient: "bg-muted",
              iconColor: "text-primary",
            },
            {
              icon: ShoppingCart,
              label: "Продаж",
              value: String(data.totalCount),
              color: "emerald",
              extra: <p className="text-[10px] text-muted-foreground">{data.items.length < data.total ? `показано ${data.items.length}` : "все на стр."}</p>,
              gradient: "bg-muted",
              iconColor: "text-emerald-500 dark:text-emerald-400",
            },
            {
              icon: TrendingUp,
              label: "Средний чек",
              value: fmtMoney(avgAmount),
              color: "amber",
              extra: null,
              gradient: "bg-muted",
              iconColor: "text-amber-500 dark:text-amber-400",
            },
          ].map((c, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              whileHover={{ y: -2 }}
            >
              <Card className={cn(
                "relative overflow-hidden  border border-border rounded-xl p-4 h-full",
                c.gradient
              )}>
                <div className="flex items-center gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.5px] text-muted-foreground">{c.label}</p>
                    <p className="text-[23px] font-extrabold tabular-nums tracking-[-0.4px] truncate mt-[5px]">{c.value}</p>
                    {c.extra}
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}

          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            whileHover={{ y: -2 }}
          >
            <Card className="relative overflow-hidden bg-muted border border-border rounded-xl p-4 h-full">
              <p className="text-[11px] font-semibold uppercase tracking-[0.5px] text-muted-foreground mb-2">По способу</p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(data.byProvider).sort((a, b) => b[1] - a[1]).map(([prov, cnt]) => (
                  <span key={prov} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border", providerColor(prov))}>
                    {providerLabel(prov)} <span className="opacity-70">{cnt}</span>
                  </span>
                ))}
              </div>
            </Card>
          </motion.div>
        </div>
      )}

      {/* Filters */}
      <Card className="bg-card border-border rounded-2xl p-4 space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Email, Telegram, заказ, тариф…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applySearch()}
              className="pl-9 pr-20 rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-border focus-visible:ring-primary/50"
            />
            <Button variant="secondary" size="sm" className="absolute right-1 top-1/2 -translate-y-1/2 h-7 px-3 text-xs rounded-lg bg-card hover:bg-card" onClick={applySearch}>
              Найти
            </Button>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap bg-foreground/[0.03] dark:bg-white/[0.02] p-1 rounded-xl border border-border">
            <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0 ml-2" />
            {DATE_PRESETS.map((p) => (
              <button
                key={p.days}
                onClick={() => applyPreset(p.days)}
                className={cn(
                  "rounded-lg px-3 py-1 text-xs font-medium transition-all",
                  activePreset === p.days
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-card"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 flex-wrap bg-foreground/[0.03] dark:bg-white/[0.02] p-1 rounded-xl border border-border">
            <CreditCard className="h-4 w-4 text-muted-foreground shrink-0 ml-2" />
            {PROVIDERS.map((p) => (
              <button
                key={p.value}
                onClick={() => { setProvider(p.value); setPage(1); }}
                className={cn(
                  "rounded-lg px-3 py-1 text-xs font-medium transition-all",
                  provider === p.value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-card"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5 ml-auto">
            <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setActivePreset(null); setPage(1); }} className="h-8 w-[130px] text-xs rounded-lg bg-foreground/[0.03] dark:bg-white/[0.02] border-border" />
            <span className="text-muted-foreground text-xs">—</span>
            <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setActivePreset(null); setPage(1); }} className="h-8 w-[130px] text-xs rounded-lg bg-foreground/[0.03] dark:bg-white/[0.02] border-border" />
          </div>

          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="h-7 gap-1 text-xs text-muted-foreground rounded-lg">
              <X className="h-3 w-3" /> Сбросить
            </Button>
          )}
        </div>
      </Card>

      {/* Sales list */}
      <div className="space-y-2">
        {loading && !data ? (
          <Card className="bg-card border-border rounded-2xl py-16 flex items-center justify-center">
            <RefreshCw className="h-8 w-8 animate-spin text-primary/60" />
          </Card>
        ) : !data?.items.length ? (
          <Card className="bg-card border-border rounded-2xl py-16 flex flex-col items-center text-center">
            <p className="text-muted-foreground">Платежи не найдены</p>
            {hasFilters && (
              <Button variant="link" size="sm" className="mt-2 text-primary" onClick={clearFilters}>
                Сбросить фильтры
              </Button>
            )}
          </Card>
        ) : (
          data.items.map((r, i) => (
            <motion.div
              key={r.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.015, 0.4) }}
              whileHover={{ y: -1 }}
            >
              <Card className="group relative overflow-hidden flex items-center gap-4 bg-card border-border rounded-xl p-4 hover:border-border transition-all duration-300">
                {/* Amount circle */}
                {/* Main info */}
                <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-y-1 gap-x-6">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm tracking-tight">
                        {fmtMoney(r.amount)} <span className="text-xs font-normal text-muted-foreground">{r.currency}</span>
                      </span>
                      <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border", providerColor(r.provider))}>
                        {providerLabel(r.provider)}
                      </span>
                      {r.tariffName && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-foreground/[0.05] dark:bg-white/[0.05] border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                          <Package className="h-3 w-3" /> {r.tariffName}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground flex-wrap">
                      {r.clientTelegramUsername && (
                        <span className="inline-flex items-center gap-1">
                          <User className="h-3 w-3" /> @{r.clientTelegramUsername}
                        </span>
                      )}
                      {!r.clientTelegramUsername && r.clientEmail && (
                        <span className="inline-flex items-center gap-1">
                          <User className="h-3 w-3" /> {r.clientEmail}
                        </span>
                      )}
                      {!r.clientTelegramUsername && !r.clientEmail && r.clientTelegramId && (
                        <span className="inline-flex items-center gap-1">
                          <User className="h-3 w-3" /> TG: {r.clientTelegramId}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1">
                        <Hash className="h-3 w-3" />
                        <span className="font-mono select-all">{r.orderId}</span>
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-muted-foreground sm:justify-end">
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays className="h-3 w-3" /> {fmtDate(r.paidAt)}
                    </span>
                  </div>
                </div>

                <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    variant="ghost" size="icon"
                    className="h-8 w-8 rounded-full hover:bg-foreground/10"
                    onClick={() => setActionsPaymentId(r.id)}
                    title="Действия (refund / mark-failed / retry)"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost" size="icon"
                    className="h-8 w-8 rounded-full text-red-500 dark:text-red-400 hover:bg-red-500/10"
                    onClick={() => deletePayment(r.id)}
                    title="Удалить платёж"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </Card>
            </motion.div>
          ))
        )}
      </div>

      {/* Pagination */}
      {data && totalPages > 1 && (
        <Card className="bg-card border-border rounded-[1.5rem] p-3 flex items-center justify-between gap-2 flex-wrap">
          <span className="text-sm text-muted-foreground">
            Стр. <span className="font-semibold text-foreground">{page}</span> из {totalPages} · {data.total} записей
          </span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(1)} className="h-8 px-2 rounded-lg">«</Button>
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="h-8 px-3 rounded-lg">Назад</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="h-8 px-3 rounded-lg">Вперёд</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(totalPages)} className="h-8 px-2 rounded-lg">»</Button>
          </div>
        </Card>
      )}

      {/* Payment actions drawer (refund / mark-failed / retry) */}
      <PaymentActionsDrawer
        paymentId={actionsPaymentId}
        onClose={() => setActionsPaymentId(null)}
        onRefreshList={() => load()}
      />
    </div>
  );
}
