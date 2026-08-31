import { useEffect, useState } from "react";
import {
  Loader2, RefreshCw, AlertTriangle, Activity,
  Users, Server, TrendingUp, ChevronDown, ChevronUp, Search, Copy, Check,
} from "lucide-react";
import { useAuth } from "@/contexts/auth";
import { api, type TrafficAbuseResponse, type TrafficAbuser } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { fmtMsk, fmtMskDate } from "@/lib/datetime";

// T-traffic-abuse-id (портировано из WolfVPN): кнопка копирования значения (telegramId/email) в буфер.
function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }).catch(() => {});
      }}
      className="inline-flex items-center justify-center h-5 w-5 rounded text-muted-foreground hover:text-foreground hover:bg-foreground/10 transition shrink-0"
      title="Скопировать"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let val = bytes;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
  return `${val.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

function severityColor(score: number): string {
  if (score >= 200) return "text-red-500 dark:text-red-400";
  if (score >= 100) return "text-orange-500 dark:text-orange-400";
  if (score >= 80) return "text-yellow-500 dark:text-yellow-400";
  return "text-muted-foreground";
}

function severityBg(score: number): string {
  if (score >= 200) return "bg-primary";
  if (score >= 100) return "bg-primary";
  if (score >= 80) return "bg-primary";
  return "bg-primary";
}

function severityLabel(score: number): string {
  if (score >= 200) return "Критический";
  if (score >= 100) return "Высокий";
  if (score >= 80) return "Средний";
  return "Низкий";
}

function AbuserRow({ user, index }: { user: TrafficAbuser; index: number }) {
  const [open, setOpen] = useState(false);
  const barWidth = Math.min(user.usagePercent, 100);

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.02, 0.3) }}
      className="rounded-xl border border-border bg-foreground/[0.03] dark:bg-white/[0.02] overflow-hidden hover:border-border transition-all"
    >
      <button
        type="button"
        className="w-full text-left p-4 flex items-center gap-4 hover:bg-foreground/[0.03] dark:hover:bg-white/[0.02] transition-colors"
        onClick={() => setOpen(!open)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold truncate">{user.username}</span>
            <span className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
              user.status === "ACTIVE" && "bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border-emerald-500/20",
              user.status === "EXPIRED" && "bg-red-500/10 text-red-500 dark:text-red-400 border-red-500/20",
              user.status !== "ACTIVE" && user.status !== "EXPIRED" && "bg-foreground/[0.05] dark:bg-white/[0.05] text-muted-foreground border-border",
            )}>
              {user.status}
            </span>
          </div>
          <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1">
            {user.email && <span className="inline-flex items-center gap-1">{user.email}<CopyBtn text={user.email} /></span>}
            {user.telegramId && <span className="inline-flex items-center gap-1">TG: <code className="text-foreground font-medium">{user.telegramId}</code><CopyBtn text={String(user.telegramId)} /></span>}
            {user.onlineAt && <span>Онлайн: {fmtMsk(user.onlineAt)}</span>}
          </div>
        </div>

        <div className="hidden sm:flex flex-col items-end gap-0.5 min-w-[140px]">
          <span className="text-sm font-semibold tabular-nums">{formatBytes(user.periodUsageBytes)}</span>
          <span className="text-xs text-muted-foreground">
            лимит: {user.trafficLimitBytes > 0 ? formatBytes(user.trafficLimitBytes) : "∞"}
          </span>
        </div>

        <div className="hidden md:flex flex-col items-center gap-0.5 min-w-[90px]">
          <span className={cn("text-[13.5px] font-bold tabular-nums", severityColor(user.abuseScore))}>
            {user.abuseScore.toFixed(0)}%
          </span>
          <span className={cn("text-[10px] font-semibold uppercase tracking-wider", severityColor(user.abuseScore))}>
            {severityLabel(user.abuseScore)}
          </span>
        </div>

        {open ? <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />}
      </button>

      {open && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="border-t border-border px-4 py-3 bg-foreground/[0.02] dark:bg-white/[0.01] space-y-3"
        >
          <div className="sm:hidden flex items-center justify-between text-sm">
            <span>Период: <strong>{formatBytes(user.periodUsageBytes)}</strong></span>
            <span className={cn("font-bold", severityColor(user.abuseScore))}>{user.abuseScore.toFixed(0)}% — {severityLabel(user.abuseScore)}</span>
          </div>

          {user.trafficLimitBytes > 0 && (
            <div>
              <div className="flex justify-between text-xs mb-1.5">
                <span className="text-muted-foreground">Использование лимита</span>
                <span className="font-medium tabular-nums">{user.usagePercent.toFixed(1)}%</span>
              </div>
              <div className="h-2 rounded-full bg-foreground/[0.06] dark:bg-card border border-border overflow-hidden">
                <motion.div
                  className={cn("h-full rounded-full ", severityBg(user.abuseScore))}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(barWidth, 100)}%` }}
                  transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div>
              <span className="text-muted-foreground block">Текущий трафик</span>
              <span className="font-medium tabular-nums">{formatBytes(user.usedTrafficBytes)}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">За всё время</span>
              <span className="font-medium tabular-nums">{formatBytes(user.lifetimeUsedTrafficBytes)}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">Стратегия</span>
              <span className="font-medium">{user.trafficLimitStrategy}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">Истекает</span>
              <span className="font-medium">{user.expireAt ? fmtMskDate(user.expireAt) : "—"}</span>
            </div>
          </div>

          {user.perNodeUsage.length > 0 && (
            <div>
              <span className="text-xs font-medium text-muted-foreground mb-2 block">Трафик по нодам:</span>
              <div className="space-y-1.5">
                {user.perNodeUsage.map((n, i) => {
                  const maxBytes = user.perNodeUsage[0]?.bytes ?? 1;
                  const pct = maxBytes > 0 ? (n.bytes / maxBytes) * 100 : 0;
                  return (
                    <div key={i} className="flex items-center gap-3 text-xs">
                      <span className="w-32 truncate text-muted-foreground">{n.nodeName}</span>
                      <div className="flex-1 h-1.5 rounded-full bg-foreground/[0.06] dark:bg-card overflow-hidden">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-20 text-right font-medium tabular-nums">{formatBytes(n.bytes)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </motion.div>
      )}
    </motion.div>
  );
}

export function TrafficAbusePage() {
  const token = useAuth().state.accessToken!;
  const [days, setDays] = useState("7");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<TrafficAbuseResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // фильтр по squads (тарифные группы Remnawave).
  // Пустой Set = «все»; иначе показываем только юзеров чьи squadNames пересекаются с фильтром.
  const [selectedSquads, setSelectedSquads] = useState<Set<string>>(new Set());

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.getTrafficAbuseAnalytics(token, { days: Number(days) || 7 });
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки аналитики");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Все уникальные squad-имена из текущей выборки — для рендера чипов фильтра.
  const allSquads = Array.from(
    new Set((data?.abusers ?? []).flatMap((u) => u.squadNames ?? []))
  ).sort();

  const filtered = data?.abusers.filter((u) => {
    // squad-фильтр (если выбрано хотя бы одно — оставляем только тех у кого есть пересечение)
    if (selectedSquads.size > 0) {
      const hasMatch = (u.squadNames ?? []).some((s) => selectedSquads.has(s));
      if (!hasMatch) return false;
    }
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return u.username.toLowerCase().includes(q) ||
      (u.email?.toLowerCase().includes(q)) ||
      (u.telegramId && String(u.telegramId).includes(q));
  }) ?? [];

  const toggleSquad = (name: string) => {
    setSelectedSquads((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
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
            <h1 className="text-xl font-extrabold tracking-[-0.3px] text-foreground">
              Анализ трафика
            </h1>
            <p className="text-[12.5px] text-muted-foreground mt-[3px]">Поиск пользователей с аномально высоким потреблением</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border border-border px-3 py-1.5 text-sm">
            <span className="text-muted-foreground text-xs">Период:</span>
            <Input
              className="w-12 h-7 text-center text-sm border-0 bg-transparent p-0 focus-visible:ring-0"
              value={days}
              onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))}
            />
            <span className="text-muted-foreground text-xs">дн.</span>
          </div>
          <Button variant="outline" size="sm" className="gap-1.5 rounded-xl" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Обновить
          </Button>
        </div>
      </motion.div>

      {error && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 flex items-start gap-3"
        >
          <AlertTriangle className="h-5 w-5 text-red-500 dark:text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-500 dark:text-red-400">Ошибка получения данных</p>
            <p className="text-xs text-muted-foreground mt-1">{error}</p>
          </div>
        </motion.div>
      )}

      {loading && !data ? (
        <Card className="bg-card border-border rounded-2xl py-16 flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Анализ данных с нод...</p>
        </Card>
      ) : data && (
        <>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            {[
              { icon: Users, label: "Всего пользователей", value: String(data.stats.totalUsers), gradient: "bg-muted", iconColor: "text-blue-500 dark:text-blue-400" },
              { icon: AlertTriangle, label: "Нарушителей", value: String(data.stats.abusersCount), extra: data.stats.abuserTrafficPercent > 0 ? `${data.stats.abuserTrafficPercent}% трафика` : null, gradient: "bg-muted", iconColor: "text-red-500 dark:text-red-400" },
              { icon: TrendingUp, label: "Трафик нарушителей", value: formatBytes(data.stats.abuserTrafficTotal), extra: `из ${formatBytes(data.stats.totalTrafficPeriod)}`, gradient: "bg-muted", iconColor: "text-orange-500 dark:text-orange-400" },
              { icon: Server, label: "Активные ноды", value: String(data.stats.activeNodes), extra: data.stats.nodesWithData != null ? `${data.stats.nodesWithData} с данными` : null, gradient: "bg-muted", iconColor: "text-emerald-500 dark:text-emerald-400" },
            ].map((c, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                whileHover={{ y: -2 }}
              >
                <Card className={cn("relative overflow-hidden  border border-border rounded-xl p-4 h-full", c.gradient)}>
                  <div className="flex items-start gap-3">
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.5px] text-muted-foreground">{c.label}</p>
                      <p className="text-2xl font-extrabold tabular-nums tracking-tight mt-0.5">{c.value}</p>
                      {c.extra && <p className="text-[10px] text-muted-foreground/80 mt-0.5">{c.extra}</p>}
                    </div>
                  </div>
                </Card>
              </motion.div>
            ))}
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border border-border px-3 py-2">
            <Activity className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Период: {data.stats.periodStart} — {data.stats.periodEnd} ({data.stats.periodDays} дн.) · Порог: {(data.stats.threshold * 100).toFixed(0)}% · Мин. трафик: {formatBytes(data.stats.minBytes)}</span>
          </div>

          <Card className="bg-card border-border rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-3">
                <div>
                  <h3 className="text-sm font-bold tracking-tight">
                    Список нарушителей
                    {filtered.length > 0 && <span className="text-muted-foreground font-normal ml-2">({filtered.length})</span>}
                  </h3>
                  <p className="text-xs text-muted-foreground">Раскройте строку для деталей</p>
                </div>
              </div>
              {data.abusers.length > 5 && (
                <div className="relative">
                  <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="h-9 w-48 pl-9 text-sm rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-border focus-visible:ring-primary/50"
                    placeholder="Поиск..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              )}
            </div>
            {allSquads.length > 0 && (
              <div className="px-4 py-2.5 border-t border-border bg-foreground/[0.015] flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground mr-1">Squad:</span>
                <button
                  type="button"
                  onClick={() => setSelectedSquads(new Set())}
                  className={`rounded-lg px-2.5 py-1 text-xs border transition-colors ${
                    selectedSquads.size === 0
                      ? "bg-primary/15 text-primary border-border"
                      : "bg-foreground/[0.02] text-muted-foreground border-border hover:border-border"
                  }`}
                >
                  Все
                </button>
                {allSquads.map((sq) => {
                  const active = selectedSquads.has(sq);
                  return (
                    <button
                      key={sq}
                      type="button"
                      onClick={() => toggleSquad(sq)}
                      className={`rounded-lg px-2.5 py-1 text-xs border transition-colors ${
                        active
                          ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
                          : "bg-foreground/[0.02] text-muted-foreground border-border hover:border-border"
                      }`}
                    >
                      {sq}
                    </button>
                  );
                })}
                {selectedSquads.size > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedSquads(new Set())}
                    className="text-xs text-muted-foreground hover:text-foreground ml-2 underline"
                  >
                    сброс
                  </button>
                )}
              </div>
            )}
            <div className="p-4 space-y-2">
              {filtered.length > 0 ? (
                filtered.map((u, i) => <AbuserRow key={`${u.uuid}-${u.username}`} user={u} index={i} />)
              ) : data.abusers.length > 0 ? (
                <div className="text-sm text-muted-foreground py-6 text-center">Нет совпадений по запросу «{search}»</div>
              ) : (
                <div className="py-12 flex flex-col items-center text-center gap-3 text-muted-foreground">
                  <p className="text-sm font-medium">Нарушители не обнаружены</p>
                  <p className="text-xs">Все пользователи в рамках допустимого потребления</p>
                </div>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
