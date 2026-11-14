/**
 * Business Analytics — KPI/Cohort/Funnel/Provider compare.
 *
 * Грузит /api/admin/business-analytics?days=N и рендерит:
 *   1. Period selector (7/30/90/180 days)
 *   2. KPI карточки по валюте: MRR / Revenue / ARPU / LTV / Churn
 *   3. Cohort retention таблица (12 недель)
 *   4. Funnel: register  trial  paid  repeat  auto-renew
 *   5. Provider comparison таблица
 */

import { useEffect, useState } from "react";
import {
  TrendingUp, Users, DollarSign, Repeat, Activity, Wallet, Loader2, AlertCircle, RefreshCw, } from "lucide-react";
import { useAuth } from "@/contexts/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { businessAnalyticsApi, type BusinessAnalyticsResponse, type CohortRow } from "@/lib/admin-extras-api";
import { fmtMsk } from "@/lib/datetime";

const PERIOD_OPTIONS = [
  { value: 7, label: "7д" },
  { value: 30, label: "30д" },
  { value: 90, label: "90д" },
  { value: 180, label: "180д" },
];

function fmtMoney(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(2);
}
function fmtNum(n: number): string {
  return n.toLocaleString("ru-RU");
}
function fmtPct(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}
function fmtDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds.toFixed(0)}с`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)}мин`;
  return `${(seconds / 3600).toFixed(1)}ч`;
}

function retentionColor(pct: number): string {
  if (pct === 0) return "bg-foreground/[0.03] text-muted-foreground";
  if (pct < 0.05) return "bg-rose-500/10 text-rose-600 dark:text-rose-400";
  if (pct < 0.15) return "bg-amber-500/10 text-amber-600 dark:text-amber-400";
  if (pct < 0.30) return "bg-sky-500/10 text-sky-600 dark:text-sky-400";
  return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
}

export function AdminBusinessAnalyticsPage() {
  const { state } = useAuth();
  const [data, setData] = useState<BusinessAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [days, setDays] = useState<number>(30);

  async function load() {
    if (!state.accessToken) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await businessAnalyticsApi.get(state.accessToken, days);
      setData(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "load error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.accessToken, days]);

  return (
    <div className="w-full space-y-6 px-4 sm:px-6 md:px-8 pt-6 pb-10">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between !bg-transparent !border-0 ! !shadow-none">
        <div className="flex items-start gap-3">
          <div>
            <h1 className="text-xl font-extrabold tracking-[-0.3px] text-foreground">
              Бизнес-аналитика
            </h1>
            <p className="text-[12.5px] text-muted-foreground mt-[3px]">MRR · ARPU · LTV · Churn · Cohorts · Funnel · Providers</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 bg-foreground/[0.03] dark:bg-white/[0.02] p-1 rounded-xl border border-border">
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setDays(opt.value)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
                  days === opt.value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-card"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="rounded-xl gap-2">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Обновить
          </Button>
        </div>
      </div>

      {err && (
        <Card className="p-4 bg-rose-500/10 border-rose-500/30 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 text-rose-500 shrink-0" />
          <p className="text-sm text-rose-500">{err}</p>
        </Card>
      )}

      {loading && !data ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : data ? (
        <>
          {/* KPI Cards — by currency */}
          {data.kpis.length === 0 ? (
            <Card className="p-8 text-center bg-card border-border rounded-2xl">
              <p className="text-sm text-muted-foreground">Нет PAID-платежей за выбранный период.</p>
            </Card>
          ) : (
            data.kpis.map((kpi) => (
              <section key={kpi.currency}>
                <div className="flex items-center gap-2 mb-3 px-2">
                  <Wallet className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold tracking-wider uppercase text-muted-foreground">
                    {kpi.currency.toUpperCase()}
                  </h2>
                </div>
                <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
                  <KpiCard
                    icon={DollarSign}
                    label={`MRR (${data.windowDays}д)`}
                    value={fmtMoney(kpi.mrr)}
                    sub="С подписочных платежей"
                    accent="primary"
                  />
                  <KpiCard
                    icon={TrendingUp}
                    label={`Total Revenue (${data.windowDays}д)`}
                    value={fmtMoney(kpi.totalRevenue)}
                    sub={`${fmtNum(kpi.paidCount)} платежей · ${fmtNum(kpi.payingClients)} клиентов`}
                    accent="emerald"
                  />
                  <KpiCard
                    icon={Users}
                    label="ARPU"
                    value={fmtMoney(kpi.arpu)}
                    sub="Average Revenue Per User"
                    accent="cyan"
                  />
                  <KpiCard
                    icon={Activity}
                    label="LTV"
                    value={fmtMoney(kpi.ltv)}
                    sub="Lifetime value (за всё время)"
                    accent="violet"
                  />
                  <KpiCard
                    icon={Repeat}
                    label="Churn rate"
                    value={fmtPct(data.churn.churnRate)}
                    sub={`Из ${data.churn.prevPeriodPayingClients} платящих ушло ${data.churn.churnedClients}`}
                    accent={data.churn.churnRate > 0.3 ? "rose" : data.churn.churnRate > 0.15 ? "amber" : "emerald"}
                  />
                </div>
              </section>
            ))
          )}

          {/* Cohort retention */}
          <Card className="bg-card border-border rounded-2xl p-4">
            <div className="flex items-center gap-3 mb-4">
              <div>
                <h2 className="text-[13.5px] font-bold">Cohort retention (12 недель)</h2>
                <p className="text-xs text-muted-foreground">% клиентов из недельной когорты, кто сделал хоть одну оплату на N-й неделе после регистрации</p>
              </div>
            </div>

            {data.cohorts.length === 0 ? (
              <p className="text-sm text-muted-foreground italic py-4">Нет когорт за последние 12 недель.</p>
            ) : (
              <div className="overflow-x-auto -mx-2">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase text-muted-foreground border-b border-border">
                    <tr>
                      <th className="px-4 py-2.5 text-left font-semibold">Когорта (нед.)</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Размер</th>
                      <th className="px-4 py-2.5 text-center font-semibold">W1</th>
                      <th className="px-4 py-2.5 text-center font-semibold">W2</th>
                      <th className="px-4 py-2.5 text-center font-semibold">W4</th>
                      <th className="px-4 py-2.5 text-center font-semibold">W8</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.cohorts.map((c) => (
                      <CohortTableRow key={c.weekStart} c={c} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Funnel */}
          <Card className="bg-card border-border rounded-2xl p-4">
            <div className="flex items-center gap-3 mb-4">
              <div>
                <h2 className="text-[13.5px] font-bold">Воронка конверсии</h2>
                <p className="text-xs text-muted-foreground">От регистрации до подписчика с авто-продлением (по всем клиентам)</p>
              </div>
            </div>

            <div className="space-y-2">
              {data.funnel.map((step, i) => {
                const widthPct = step.pctOfStart * 100;
                return (
                  <div key={step.key} className="relative">
                    <div className="relative h-12 rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border border-border overflow-hidden">
                      <div
                        className={cn(
                          "absolute inset-y-0 left-0 rounded-xl transition-all duration-500",
                          i === 0 && "bg-muted",
                          i === 1 && "bg-muted",
                          i === 2 && "bg-muted",
                          i === 3 && "bg-muted",
                          i === 4 && "bg-muted",
                        )}
                        style={{ width: `${Math.max(widthPct, 2)}%` }}
                      />
                      <div className="relative h-full px-4 flex items-center justify-between">
                        <span className="text-sm font-medium text-foreground">{step.label}</span>
                        <div className="flex items-center gap-3 text-xs">
                          <span className="font-bold tabular-nums text-foreground">{fmtNum(step.count)}</span>
                          {i > 0 && (
                            <span className="text-muted-foreground tabular-nums">
                              {fmtPct(step.pctOfPrev)} от пред.
                            </span>
                          )}
                          <span className="text-muted-foreground tabular-nums w-14 text-right">
                            {fmtPct(step.pctOfStart)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Providers */}
          <Card className="bg-card border-border rounded-2xl p-4">
            <div className="flex items-center gap-3 mb-4">
              <div>
                <h2 className="text-[13.5px] font-bold">Сравнение провайдеров</h2>
                <p className="text-xs text-muted-foreground">За последние {data.windowDays} дней</p>
              </div>
            </div>

            {data.providers.length === 0 ? (
              <p className="text-sm text-muted-foreground italic py-4">Нет платежей за период.</p>
            ) : (
              <div className="overflow-x-auto -mx-2">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase text-muted-foreground border-b border-border">
                    <tr>
                      <th className="px-3 py-2.5 text-left font-semibold">Провайдер</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Всего</th>
                      <th className="px-3 py-2.5 text-right font-semibold text-emerald-500">PAID</th>
                      <th className="px-3 py-2.5 text-right font-semibold text-rose-500">FAILED</th>
                      <th className="px-3 py-2.5 text-right font-semibold text-violet-500">REFUND</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Success</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Ø время</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Выручка</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Ø чек</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.providers.map((p) => (
                      <tr key={p.provider} className="hover:bg-card transition-colors">
                        <td className="px-3 py-3 font-medium">{p.provider}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{fmtNum(p.total)}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-emerald-500">{fmtNum(p.paid)}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-rose-500">{fmtNum(p.failed)}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-violet-500">{fmtNum(p.refunded)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          <span className={cn(
                            "px-2 py-0.5 rounded-md text-xs font-semibold",
                            p.successRate >= 0.7 && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                            p.successRate >= 0.4 && p.successRate < 0.7 && "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                            p.successRate < 0.4 && "bg-rose-500/10 text-rose-600 dark:text-rose-400",
                          )}>
                            {fmtPct(p.successRate)}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                          {fmtDuration(p.avgSecondsToPaid)}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          <div className="flex flex-col items-end gap-0.5">
                            {p.revenueByCurrency.length === 0 ? "—" : p.revenueByCurrency.map((rc) => (
                              <span key={rc.currency} className="font-medium">
                                {fmtMoney(rc.amount)} <span className="text-[10px] text-muted-foreground">{rc.currency.toUpperCase()}</span>
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          <div className="flex flex-col items-end gap-0.5 text-muted-foreground">
                            {p.avgAmountByCurrency.length === 0 ? "—" : p.avgAmountByCurrency.map((rc) => (
                              <span key={rc.currency}>
                                {fmtMoney(rc.amount)} <span className="text-[10px]">{rc.currency.toUpperCase()}</span>
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <p className="text-[11px] text-muted-foreground text-center pt-2">
            Сгенерировано: {fmtMsk(data.generatedAt)}
          </p>
        </>
      ) : null}
    </div>
  );
}

function KpiCard({
  icon: Icon, label, value, sub, accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub: string;
  accent: "primary" | "emerald" | "cyan" | "violet" | "amber" | "rose";
}) {
  const accentColors: Record<typeof accent, { iconBg: string; iconText: string }> = {
    primary: { iconBg: "bg-muted", iconText: "text-primary" },
    emerald: { iconBg: "bg-muted", iconText: "text-emerald-500" },
    cyan: { iconBg: "bg-muted", iconText: "text-cyan-500" },
    violet: { iconBg: "bg-muted", iconText: "text-violet-500" },
    amber: { iconBg: "bg-muted", iconText: "text-amber-500" },
    rose: { iconBg: "bg-muted", iconText: "text-rose-500" },
  };
  const a = accentColors[accent];
  return (
    <Card className="relative overflow-hidden bg-card border-border rounded-[1.5rem] p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground truncate">{label}</p>
          <div className="mt-2 text-[13.5px] font-bold tracking-tight tabular-nums text-foreground">{value}</div>
          <p className="mt-1 text-[10px] text-muted-foreground/80">{sub}</p>
        </div>
        <div className={cn(
          "h-9 w-9 rounded-xl  border border-border flex items-center justify-center shrink-0",
          a.iconBg,
        )}>
          <Icon className={cn("h-4 w-4", a.iconText)} />
        </div>
      </div>
    </Card>
  );
}

function CohortTableRow({ c }: { c: CohortRow }) {
  return (
    <tr className="hover:bg-card transition-colors">
      <td className="px-4 py-2.5 font-mono text-xs text-foreground">{c.weekStart}</td>
      <td className="px-4 py-2.5 text-right tabular-nums font-medium">{c.cohortSize}</td>
      {c.retention.map((r) => (
        <td key={r.week} className="px-4 py-2.5 text-center">
          <div className={cn(
            "inline-flex flex-col items-center gap-0 rounded-lg px-2 py-1 min-w-[60px]",
            retentionColor(r.pct),
          )}>
            <span className="font-semibold text-xs">{fmtPct(r.pct)}</span>
            <span className="text-[10px] opacity-70">{r.active}</span>
          </div>
        </td>
      ))}
    </tr>
  );
}
