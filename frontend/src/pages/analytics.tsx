import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Loader2,
  TrendingUp,
  Users,
  RussianRuble,
  ShoppingCart,
  Gift,
  Tag,
  Percent,
  UserPlus,
  Bot,
  Globe,
  Zap,
  Award,
  Wallet,
  Target,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Line,
  ComposedChart,
} from "recharts";

const COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#14b8a6", "#f97316", "#84cc16"];

function fmt(n: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(n);
}
function fmtDec(n: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(n);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
interface AnalyticsData {
  revenueSeries: { date: string; value: number }[];
  clientsSeries: { date: string; value: number }[];
  trialsSeries: { date: string; value: number }[];
  promoActsSeries: { date: string; value: number }[];
  promoUsagesSeries: { date: string; value: number }[];
  refCreditsSeries: { date: string; value: number }[];
  topTariffs: { name: string; count: number; revenue: number }[];
  providerSeries: { provider: string; amount: number }[];
  topReferrers: { id: string; name: string; referrals: number; earnings: number; l1: number; l2: number; l3: number; credits: number }[];
  promoGroupStats: { name: string; code: string; maxActivations: number; activations: number }[];
  promoCodeStats: { code: string; name: string; type: string; maxUses: number; usages: number }[];
  summary: {
    totalClients: number;
    activeClients: number;
    totalRevenue: number;
    totalPayments: number;
    totalReferralPaid: number;
    promoActivations: number;
    promoCodeUsages: number;
    clientsNew24h: number;
    clientsNew7d: number;
    clientsNew30d: number;
    botClients: number;
    siteClients: number;
    bothClients: number;
    trialUsedCount: number;
    trialToPaid: number;
    trialConversionRate: number;
    avgCheck: number;
    arpu: number;
    payingClients: number;
    payingPercent: number;
    rev7: number;
    rev30: number;
    cnt7: number;
    cnt30: number;
    paymentsPending: number;
    totalBalance: number;
    withReferrer: number;
  };
}

export function AnalyticsPage() {
  const { state } = useAuth();
  const token = state.accessToken;
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    api.getAnalytics(token).then(setData).catch(() => {}).finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) {
    return <p className="text-sm text-destructive py-8">Ошибка загрузки аналитики</p>;
  }

  const s = data.summary;
  const revenueWeekly = aggregateByWeek(data.revenueSeries);
  const clientsWeekly = aggregateByWeek(data.clientsSeries);
  const trialsWeekly = aggregateByWeek(data.trialsSeries);
  const refCreditsWeekly = aggregateByWeek(data.refCreditsSeries);

  // Combine promo acts + usages for chart
  const promoWeekly = aggregateByWeekTwo(data.promoActsSeries, data.promoUsagesSeries, "Промо-ссылки", "Промокоды");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Аналитика</h1>
        <p className="text-muted-foreground mt-1">Полная статистика по всем направлениям</p>
      </div>

      {/* ═══ ОСНОВНЫЕ МЕТРИКИ ═══ */}
      <section>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary" />
          Основные метрики
        </h2>
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
          <MetricCard icon={RussianRuble} label="Общий доход" value={fmt(s.totalRevenue)} color="text-green-500" />
          <MetricCard icon={RussianRuble} label="Доход 7 дн." value={fmt(s.rev7)} sub={`${s.cnt7} платежей`} color="text-green-500" />
          <MetricCard icon={RussianRuble} label="Доход 30 дн." value={fmt(s.rev30)} sub={`${s.cnt30} платежей`} color="text-green-500" />
          <MetricCard icon={ShoppingCart} label="Всего платежей" value={fmt(s.totalPayments)} sub={`${s.paymentsPending} ожидают`} color="text-blue-500" />
          <MetricCard icon={Target} label="Средний чек" value={fmtDec(s.avgCheck)} color="text-indigo-500" />
        </div>
      </section>

      {/* ═══ КЛИЕНТЫ ═══ */}
      <section>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          Клиенты
        </h2>
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
          <MetricCard icon={Users} label="Всего клиентов" value={fmt(s.totalClients)} sub={`${s.activeClients} с подпиской`} color="text-blue-500" />
          <MetricCard icon={UserPlus} label="Новые 24ч / 7д / 30д" value={`${s.clientsNew24h} / ${s.clientsNew7d} / ${s.clientsNew30d}`} color="text-cyan-500" />
          <MetricCard icon={Bot} label="Только бот" value={fmt(s.botClients)} color="text-violet-500" />
          <MetricCard icon={Globe} label="Только сайт" value={fmt(s.siteClients)} color="text-orange-500" />
          <MetricCard icon={Users} label="Бот + Сайт" value={fmt(s.bothClients)} color="text-emerald-500" />
          <MetricCard icon={Wallet} label="Общий баланс" value={fmtDec(s.totalBalance)} color="text-amber-500" />
          <MetricCard icon={Percent} label="Платящих" value={`${s.payingClients} (${s.payingPercent}%)`} color="text-rose-500" />
          <MetricCard icon={RussianRuble} label="ARPU" value={fmtDec(s.arpu)} sub="доход / клиент" color="text-indigo-500" />
          <MetricCard icon={Award} label="По рефералу" value={fmt(s.withReferrer)} sub={`${s.totalClients > 0 ? Math.round((s.withReferrer / s.totalClients) * 100) : 0}% от всех`} color="text-pink-500" />
        </div>
      </section>

      {/* ═══ ТРИАЛЫ ═══ */}
      <section>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Zap className="h-5 w-5 text-primary" />
          Триалы
        </h2>
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
          <MetricCard icon={Zap} label="Всего триалов" value={fmt(s.trialUsedCount)} color="text-yellow-500" />
          <MetricCard
            icon={s.trialConversionRate > 20 ? ArrowUpRight : ArrowDownRight}
            label="Конверсия триал → покупка"
            value={`${s.trialConversionRate}%`}
            sub={`${s.trialToPaid} из ${s.trialUsedCount}`}
            color={s.trialConversionRate > 20 ? "text-green-500" : "text-orange-500"}
          />
        </div>
      </section>

      {/* ═══ ГРАФИКИ ═══ */}
      <div className="grid gap-6 lg:grid-cols-2">

        {/* Доход по неделям */}
        <ChartCard title="Доход по неделям (90 дн.)" icon={TrendingUp}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={revenueWeekly}>
              <defs>
                <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} className="text-muted-foreground" />
              <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" />
              <Tooltip formatter={(v) => [fmt(Number(v ?? 0)), "Доход"]} />
              <Area type="monotone" dataKey="value" stroke="#6366f1" fillOpacity={1} fill="url(#revGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Новые пользователи */}
        <ChartCard title="Новые пользователи по неделям (90 дн.)" icon={UserPlus}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={clientsWeekly}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} className="text-muted-foreground" />
              <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" allowDecimals={false} />
              <Tooltip formatter={(v) => [Number(v ?? 0), "Пользователей"]} />
              <Bar dataKey="value" fill="#22c55e" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Триалы по неделям */}
        <ChartCard title="Триалы по неделям (90 дн.)" icon={Zap}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={trialsWeekly}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} className="text-muted-foreground" />
              <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" allowDecimals={false} />
              <Tooltip formatter={(v) => [Number(v ?? 0), "Триалов"]} />
              <Bar dataKey="value" fill="#f59e0b" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Реферальные выплаты по неделям */}
        <ChartCard title="Реферальные выплаты по неделям (90 дн.)" icon={Award}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={refCreditsWeekly}>
              <defs>
                <linearGradient id="refGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ec4899" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#ec4899" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} className="text-muted-foreground" />
              <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" />
              <Tooltip formatter={(v) => [fmtDec(Number(v ?? 0)), "Выплаты"]} />
              <Area type="monotone" dataKey="value" stroke="#ec4899" fillOpacity={1} fill="url(#refGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Промо активации (ссылки + коды) */}
        <ChartCard title="Промо активации по неделям (90 дн.)" icon={Gift}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={promoWeekly}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} className="text-muted-foreground" />
              <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="v1" name="Промо-ссылки" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
              <Line type="monotone" dataKey="v2" name="Промокоды" stroke="#06b6d4" strokeWidth={2} dot={false} />
              <Legend />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Источники клиентов — пирог */}
        <ChartCard title="Источники клиентов" icon={Users}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={[
                  { name: "Только бот", value: s.botClients },
                  { name: "Только сайт", value: s.siteClients },
                  { name: "Бот + сайт", value: s.bothClients },
                ].filter((d) => d.value > 0)}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={90}
                label={({ name, percent }: { name?: string; percent?: number }) => `${name ?? ""} ${((percent ?? 0) * 100).toFixed(0)}%`}
              >
                {[COLORS[0], COLORS[2], COLORS[1]].map((c, i) => (
                  <Cell key={i} fill={c} />
                ))}
              </Pie>
              <Tooltip formatter={(v) => [Number(v ?? 0), "Клиентов"]} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Доход по провайдерам */}
        <ChartCard title="Доход по способам оплаты (90 дн.)" icon={Tag}>
          {data.providerSeries.length === 0 ? (
            <NoData />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.providerSeries}
                  dataKey="amount"
                  nameKey="provider"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  label={({ name, percent }: { name?: string; percent?: number }) => `${name ?? ""} ${((percent ?? 0) * 100).toFixed(0)}%`}
                >
                  {data.providerSeries.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => [fmt(Number(v ?? 0)), "Сумма"]} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {/* Топ тарифов */}
        <ChartCard title="Топ тарифов по доходу (90 дн.)" icon={ShoppingCart}>
          {data.topTariffs.length === 0 ? (
            <NoData />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.topTariffs} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={130} />
                <Tooltip formatter={(v: any) => [fmt(Number(v ?? 0)), "Доход"]} />
                <Bar dataKey="revenue" fill="#6366f1" name="Доход" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* ═══ ТОП РЕФЕРАЛОВ ═══ */}
      <section>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Award className="h-5 w-5 text-primary" />
          Топ рефералов
        </h2>
        {data.topReferrers.length === 0 ? (
          <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Нет данных</CardContent></Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">#</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Реферер</th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground">Рефералов</th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground">Заработок</th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground">L1</th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground">L2</th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground">L3</th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground">Начислений</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topReferrers.map((r, i) => (
                      <tr key={r.id} className="border-b hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 text-muted-foreground">{i + 1}</td>
                        <td className="px-4 py-3 font-medium">{r.name}</td>
                        <td className="px-4 py-3 text-right">{r.referrals}</td>
                        <td className="px-4 py-3 text-right font-medium text-green-600 dark:text-green-400">{fmtDec(r.earnings)}</td>
                        <td className="px-4 py-3 text-right text-muted-foreground">{fmtDec(r.l1)}</td>
                        <td className="px-4 py-3 text-right text-muted-foreground">{fmtDec(r.l2)}</td>
                        <td className="px-4 py-3 text-right text-muted-foreground">{fmtDec(r.l3)}</td>
                        <td className="px-4 py-3 text-right">{r.credits}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </section>

      {/* ═══ ПРОМО СТАТИСТИКА ═══ */}
      <section>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Gift className="h-5 w-5 text-primary" />
          Промо-статистика
        </h2>
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-4 mb-4">
          <MetricCard icon={Gift} label="Промо-ссылки активаций" value={fmt(s.promoActivations)} color="text-violet-500" />
          <MetricCard icon={Tag} label="Промокоды использований" value={fmt(s.promoCodeUsages)} color="text-cyan-500" />
          <MetricCard icon={Percent} label="Реферальные выплаты" value={fmtDec(s.totalReferralPaid)} color="text-pink-500" />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Промо-ссылки */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Промо-ссылки (топ 10)</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {data.promoGroupStats.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">Нет данных</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">Название</th>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">Код</th>
                        <th className="text-right px-4 py-2 font-medium text-muted-foreground">Активаций</th>
                        <th className="text-right px-4 py-2 font-medium text-muted-foreground">Лимит</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.promoGroupStats.map((g) => (
                        <tr key={g.code} className="border-b hover:bg-muted/30">
                          <td className="px-4 py-2">{g.name}</td>
                          <td className="px-4 py-2 font-mono text-xs">{g.code}</td>
                          <td className="px-4 py-2 text-right font-medium">{g.activations}</td>
                          <td className="px-4 py-2 text-right text-muted-foreground">{g.maxActivations || "∞"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Промокоды */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Промокоды (топ 10)</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {data.promoCodeStats.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">Нет данных</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">Код</th>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">Тип</th>
                        <th className="text-right px-4 py-2 font-medium text-muted-foreground">Использований</th>
                        <th className="text-right px-4 py-2 font-medium text-muted-foreground">Лимит</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.promoCodeStats.map((c) => (
                        <tr key={c.code} className="border-b hover:bg-muted/30">
                          <td className="px-4 py-2 font-mono text-xs">{c.code}</td>
                          <td className="px-4 py-2">
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                              c.type === "DISCOUNT" ? "bg-green-500/15 text-green-700 dark:text-green-400" : "bg-blue-500/15 text-blue-700 dark:text-blue-400"
                            }`}>
                              {c.type === "DISCOUNT" ? "Скидка" : "Дни"}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-right font-medium">{c.usages}</td>
                          <td className="px-4 py-2 text-right text-muted-foreground">{c.maxUses || "∞"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}

// ─── Компоненты ───

function MetricCard({ icon: Icon, label, value, sub, color }: { icon: React.ElementType; label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4 px-4">
        <div className="flex items-start gap-3">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted ${color ?? "text-primary"}`}>
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] text-muted-foreground leading-tight truncate">{label}</p>
            <p className="text-lg font-bold leading-tight mt-0.5">{value}</p>
            {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ChartCard({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-5 w-5 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-72">{children}</div>
      </CardContent>
    </Card>
  );
}

function NoData() {
  return <p className="text-sm text-muted-foreground py-8 text-center h-72 flex items-center justify-center">Нет данных</p>;
}

// ─── Утилиты ───

function aggregateByWeek(series: { date: string; value: number }[]): { label: string; value: number }[] {
  const weeks: { label: string; value: number }[] = [];
  let weekSum = 0;
  let weekStart = "";
  for (let i = 0; i < series.length; i++) {
    if (i % 7 === 0) {
      if (i > 0) weeks.push({ label: weekStart, value: weekSum });
      weekStart = series[i].date.slice(5);
      weekSum = 0;
    }
    weekSum += series[i].value;
  }
  if (weekStart) weeks.push({ label: weekStart, value: weekSum });
  return weeks;
}

function aggregateByWeekTwo(
  s1: { date: string; value: number }[],
  s2: { date: string; value: number }[],
  _name1: string,
  _name2: string,
): { label: string; v1: number; v2: number }[] {
  const weeks: { label: string; v1: number; v2: number }[] = [];
  let w1 = 0, w2 = 0, weekStart = "";
  const len = Math.max(s1.length, s2.length);
  for (let i = 0; i < len; i++) {
    if (i % 7 === 0) {
      if (i > 0) weeks.push({ label: weekStart, v1: w1, v2: w2 });
      weekStart = (s1[i]?.date ?? s2[i]?.date ?? "").slice(5);
      w1 = 0; w2 = 0;
    }
    w1 += s1[i]?.value ?? 0;
    w2 += s2[i]?.value ?? 0;
  }
  if (weekStart) weeks.push({ label: weekStart, v1: w1, v2: w2 });
  return weeks;
}

