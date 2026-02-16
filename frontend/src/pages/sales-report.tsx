import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/auth";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Download, ChevronLeft, ChevronRight, RussianRuble, ShoppingCart, Filter } from "lucide-react";

function formatDate(s: string | null) {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return s;
  }
}

function formatMoney(n: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(n);
}

interface SaleItem {
  id: string;
  orderId: string;
  amount: number;
  currency: string;
  provider: string;
  status: string;
  tariffName: string | null;
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
}

const PROVIDERS = [
  { value: "", label: "Все" },
  { value: "balance", label: "Баланс" },
  { value: "platega", label: "Platega" },
  { value: "yoomoney_form", label: "ЮMoney" },
  { value: "yookassa", label: "ЮKassa" },
];

export function SalesReportPage() {
  const { state } = useAuth();
  const token = state.accessToken;
  const [data, setData] = useState<SalesData | null>(null);
  const [loading, setLoading] = useState(true);

  // Фильтры
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [provider, setProvider] = useState("");
  const [page, setPage] = useState(1);
  const limit = 50;

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await api.getSalesReport(token, {
        from: dateFrom || undefined,
        to: dateTo || undefined,
        provider: provider || undefined,
        page,
        limit,
      });
      setData(res);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [token, dateFrom, dateTo, provider, page]);

  useEffect(() => { load(); }, [load]);

  function applyFilters() {
    setPage(1);
    load();
  }

  function exportCSV() {
    if (!data?.items.length) return;
    const header = "Дата;Заказ;Клиент;Telegram;Тариф;Сумма;Валюта;Провайдер";
    const rows = data.items.map((r) =>
      [
        formatDate(r.paidAt),
        r.orderId,
        r.clientEmail ?? "",
        r.clientTelegramUsername ?? r.clientTelegramId ?? "",
        r.tariffName ?? "",
        r.amount.toFixed(2),
        r.currency,
        r.provider,
      ].join(";")
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

  const totalPages = data ? Math.max(1, Math.ceil(data.total / limit)) : 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Отчёты продаж</h1>
          <p className="text-muted-foreground mt-1">Все оплаченные платежи и пополнения</p>
        </div>
        <Button variant="outline" className="gap-2 shrink-0" onClick={exportCSV} disabled={!data?.items.length}>
          <Download className="h-4 w-4" />
          Экспорт CSV
        </Button>
      </div>

      {/* Сводные карточки */}
      {data && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardContent className="pt-6 flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <RussianRuble className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Общая сумма (фильтр)</p>
                <p className="text-xl font-bold">{formatMoney(data.totalAmount)}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <ShoppingCart className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Количество (фильтр)</p>
                <p className="text-xl font-bold">{data.totalCount}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Filter className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Показано</p>
                <p className="text-xl font-bold">{data.items.length} из {data.total}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Фильтры */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Фильтры</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="text-xs text-muted-foreground">Дата от</label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Дата до</label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Способ оплаты</label>
              <select
                className="flex h-9 w-40 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
              >
                {PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
            <Button size="sm" onClick={applyFilters}>Применить</Button>
            <Button size="sm" variant="ghost" onClick={() => { setDateFrom(""); setDateTo(""); setProvider(""); setPage(1); }}>Сбросить</Button>
          </div>
        </CardContent>
      </Card>

      {/* Таблица */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !data?.items.length ? (
            <p className="text-sm text-muted-foreground text-center py-16">Нет данных</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Дата</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Клиент</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Тариф</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">Сумма</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Способ</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Заказ</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((r) => (
                    <tr key={r.id} className="border-b hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap">{formatDate(r.paidAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col">
                          {r.clientEmail && <span className="truncate max-w-[180px]" title={r.clientEmail}>{r.clientEmail}</span>}
                          {r.clientTelegramUsername && <span className="text-xs text-muted-foreground">@{r.clientTelegramUsername}</span>}
                          {!r.clientEmail && !r.clientTelegramUsername && r.clientTelegramId && (
                            <span className="text-xs text-muted-foreground">TG: {r.clientTelegramId}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">{r.tariffName ?? <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-4 py-3 text-right font-medium whitespace-nowrap">
                        {formatMoney(r.amount)} {r.currency}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          r.provider === "balance" ? "bg-blue-500/15 text-blue-700 dark:text-blue-400" : r.provider === "yoomoney" || r.provider === "yoomoney_form" ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" : r.provider === "yookassa" ? "bg-violet-500/15 text-violet-700 dark:text-violet-400" : "bg-green-500/15 text-green-700 dark:text-green-400"
                        }`}>
                          {r.provider === "balance" ? "Баланс" : r.provider === "platega" ? "Platega" : r.provider === "yoomoney" || r.provider === "yoomoney_form" ? "ЮMoney" : r.provider === "yookassa" ? "ЮKassa" : r.provider}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-muted-foreground font-mono truncate max-w-[120px] block" title={r.orderId}>
                          {r.orderId.slice(0, 8)}...
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Пагинация */}
      {data && totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            {page} / {totalPages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
