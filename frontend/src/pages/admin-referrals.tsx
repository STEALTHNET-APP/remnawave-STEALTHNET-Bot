/**
 * Admin  Рефералка (редизайн 30.05.2026)
 *
 * При открытии — обзор: hero-статистика сети + топ-рефереры (медали).
 * Поиск клиента (живой автокомплит)  детальная карточка:
 *  - Реферер (изменить / отвязать)
 *  - Заработок: суммарно + L1/L2/L3
 *  - Приглашённые + история начислений
 */
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Users, Search, RefreshCw, UserPlus, UserMinus, Link2, Copy,
  TrendingUp, Award, ChevronRight, Loader2, Crown, Medal, Wallet,
  ArrowLeft, Gift, Hash,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtMskShort } from "@/lib/datetime";

type LookupClient = {
  id: string;
  telegramId: string | null;
  telegramUsername: string | null;
  email: string | null;
  referralCode: string | null;
  referrerId: string | null;
  balance: number;
  _count: { referrals: number; referralCredits: number };
};

type Detail = Awaited<ReturnType<typeof api.getReferralDetail>>;
type NetworkNode = {
  id: string; name: string; status: string;
  referralsCount: number; subscriptionIncome: number; referralIncome: number; campaign: string | null;
};
type NetworkStats = {
  totalUsers: number; totalReferrers: number; totalCampaigns: number;
  totalSubscriptionIncome: number; totalReferralIncome: number;
};

const LEVEL_LABELS: Record<number, string> = { 1: "L1 · прямые", 2: "L2", 3: "L3" };
const LEVEL_RING: Record<number, string> = {
  1: "bg-muted border-emerald-500/25 text-emerald-300",
  2: "bg-muted border-sky-500/25 text-sky-300",
  3: "bg-muted border-violet-500/25 text-violet-300",
};

function fmtRub(v: number): string {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(v) + " ₽";
}

function clientHandle(c: { telegramUsername: string | null; email?: string | null; telegramId: string | null } | null): string {
  if (!c) return "—";
  return c.telegramUsername ? `@${c.telegramUsername}` : (c.email ?? null) || `tg:${c.telegramId ?? "?"}`;
}

function ClientChip({ c }: { c: { telegramId: string | null; telegramUsername: string | null; email?: string | null } | null }) {
  if (!c) return <span className="text-zinc-500">—</span>;
  return <span className="text-zinc-100">{clientHandle(c)}</span>;
}

// Медаль топ-3
const MEDAL = ["text-amber-300", "text-zinc-300", "text-orange-400"];
const MEDAL_BG = [
  "bg-muted border-amber-500/30",
  "bg-muted border-zinc-400/25",
  "bg-muted border-orange-500/25",
];

export function AdminReferralsPage() {
  const token = useAuth().state.accessToken!;
  const [query, setQuery] = useState("");
  const [lookupResults, setLookupResults] = useState<LookupClient[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Обзор сети (топ-рефереры + статистика)
  const [nodes, setNodes] = useState<NetworkNode[]>([]);
  const [stats, setStats] = useState<NetworkStats | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(true);

  // Редактор реферера
  const [editorOpen, setEditorOpen] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [editLookupBy, setEditLookupBy] = useState<"id" | "tgid" | "username" | "referralCode">("username");
  const [savingReferrer, setSavingReferrer] = useState(false);

  const loadOverview = useCallback(async () => {
    setLoadingOverview(true);
    try {
      const res = await api.getReferralNetwork(token);
      setNodes(res.nodes ?? []);
      setStats(res.stats ?? null);
    } catch {
      /* обзор не критичен */
    } finally {
      setLoadingOverview(false);
    }
  }, [token]);

  useEffect(() => { loadOverview(); }, [loadOverview]);

  // Живой поиск (debounce)
  useEffect(() => {
    if (query.trim().length < 2) { setLookupResults([]); return; }
    const handle = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.lookupReferralClient(token, query.trim());
        setLookupResults(res.clients);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Ошибка поиска");
      } finally {
        setSearching(false);
      }
    }, 280);
    return () => clearTimeout(handle);
  }, [query, token]);

  const loadDetail = async (clientId: string) => {
    setLoadingDetail(true);
    setError(null);
    setLookupResults([]);
    setQuery("");
    try {
      const d = await api.getReferralDetail(token, clientId);
      setDetail(d);
      setSelectedId(clientId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
      setDetail(null);
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleSaveReferrer = async (referrerId: string | null) => {
    if (!selectedId) return;
    setSavingReferrer(true);
    try {
      await api.setReferralReferrer(token, selectedId, referrerId, referrerId ? editLookupBy : undefined);
      setEditorOpen(false);
      setEditValue("");
      await loadDetail(selectedId);
      loadOverview();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setSavingReferrer(false);
    }
  };

  const topReferrers = [...nodes]
    .filter((n) => n.referralsCount > 0)
    .sort((a, b) => b.referralsCount - a.referralsCount || b.referralIncome - a.referralIncome)
    .slice(0, 12);

  return (
    <div className="relative space-y-6 px-4 sm:px-6 md:px-8 pt-6 pb-12">
      {/* Атмосферные блобы */}
      <div className="pointer-events-none fixed -z-10 -left-32 top-10 h-80 w-80 rounded-full bg-emerald-500/10 blur-[130px]" />
      <div className="pointer-events-none fixed -z-10 right-0 top-1/3 h-72 w-72 rounded-full bg-teal-500/8 blur-[120px]" />

      {/* Header */}
      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div>
            <h1 className="text-xl font-extrabold tracking-[-0.3px] text-foreground">Реферальная программа</h1>
            <p className="mt-1 text-sm text-muted-foreground">Топ-рефереры, поиск, привязка реферера и заработок по уровням</p>
          </div>
        </div>
        <Button variant="outline" onClick={loadOverview} className="gap-2 rounded-xl border-emerald-500/30 hover:bg-emerald-500/10">
          <RefreshCw className={loadingOverview ? "h-4 w-4 animate-spin" : "h-4 w-4"} /> Обновить
        </Button>
      </div>

      {/* Hero-статистика */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { icon: Users, label: "Всего клиентов", value: stats.totalUsers.toLocaleString("ru-RU"), grad: "bg-muted border-sky-500/25", ic: "text-sky-300" },
            { icon: Award, label: "Активных рефереров", value: stats.totalReferrers.toLocaleString("ru-RU"), grad: "bg-muted border-emerald-500/25", ic: "text-emerald-300" },
            { icon: Wallet, label: "Реф. выплаты", value: fmtRub(stats.totalReferralIncome), grad: "bg-muted border-amber-500/25", ic: "text-amber-300" },
            { icon: TrendingUp, label: "Доход с подписок", value: fmtRub(stats.totalSubscriptionIncome), grad: "bg-muted border-violet-500/25", ic: "text-violet-300" },
          ].map((s, i) => (
            <div key={i} className={cn("rounded-xl border  p-4", s.grad)}>
              <div className="flex items-center gap-2">
                <s.icon className={cn("h-4 w-4", s.ic)} />
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{s.label}</span>
              </div>
              <div className="mt-2 text-[13.5px] font-bold tracking-tight text-foreground">{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Поиск */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-400/70" />
          <Input
            placeholder="Поиск: @username, Telegram ID, email, реф. код или ID клиента…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-12 rounded-xl border-border bg-card pl-11 text-sm focus-visible:ring-emerald-500/40"
          />
          {searching && <Loader2 className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-emerald-400" />}
        </div>
        {lookupResults.length > 0 && (
          <div className="mt-3 max-h-72 divide-y divide-border overflow-y-auto rounded-xl border border-border bg-card">
            {lookupResults.map((c) => (
              <button
                key={c.id}
                onClick={() => loadDetail(c.id)}
                className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-emerald-500/10"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">{clientHandle(c)}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    код: {c.referralCode ?? "—"} · рефералов: {c._count.referrals} · начислений: {c._count.referralCredits}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-emerald-400/60" />
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</div>
      )}

      {/*  ДЕТАЛЬ КЛИЕНТА  */}
      {loadingDetail && (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-emerald-400" /></div>
      )}

      {!loadingDetail && detail && (
        <div className="space-y-4">
          <button onClick={() => { setDetail(null); setSelectedId(null); }} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-emerald-300">
            <ArrowLeft className="h-4 w-4" /> к обзору
          </button>

          {/* Клиент */}
          <div className="overflow-hidden rounded-xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted text-xl font-bold text-emerald-200 ring-1 ring-emerald-500/30">
                  {clientHandle(detail.client).replace(/^@/, "").slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <div className="text-xl font-bold text-foreground">{clientHandle(detail.client)}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {detail.client.referralCode && <span className="inline-flex items-center gap-1"><Hash className="h-3 w-3" />{detail.client.referralCode}</span>}
                    {detail.client.referralPercent != null && <span className="text-emerald-400">% реф.: {detail.client.referralPercent}%</span>}
                    <span>Баланс: <span className="text-foreground/90">{fmtRub(detail.client.balance)}</span></span>
                  </div>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => selectedId && loadDetail(selectedId)} className="gap-2 rounded-xl">
                <RefreshCw className="h-3.5 w-3.5" /> Обновить
              </Button>
            </div>
          </div>

          {/* Реферер */}
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground"><Link2 className="h-4 w-4 text-emerald-400" /> Реферер (кто пригласил)</div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => { setEditorOpen((v) => !v); setEditValue(""); }} className="gap-1.5 rounded-lg">
                  <UserPlus className="h-3.5 w-3.5" /> {detail.referrer ? "Изменить" : "Привязать"}
                </Button>
                {detail.referrer && (
                  <Button variant="outline" size="sm" onClick={() => { if (confirm("Отвязать реферера?")) handleSaveReferrer(null); }} className="gap-1.5 rounded-lg border-rose-500/30 text-rose-300 hover:bg-rose-500/10">
                    <UserMinus className="h-3.5 w-3.5" /> Отвязать
                  </Button>
                )}
              </div>
            </div>
            {detail.referrer ? (
              <button onClick={() => loadDetail(detail.referrer!.id)} className="flex w-full items-center gap-3 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:bg-emerald-500/10">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground"><ClientChip c={detail.referrer} /></div>
                  {detail.referrer.referralCode && <div className="truncate text-xs text-muted-foreground">код: {detail.referrer.referralCode}</div>}
                </div>
                <ChevronRight className="h-4 w-4 text-emerald-400/60" />
              </button>
            ) : (
              <div className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">Реферер не привязан</div>
            )}

            {editorOpen && (
              <div className="mt-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
                <div className="grid gap-2 sm:grid-cols-[170px_1fr_auto]">
                  <select
                    value={editLookupBy}
                    onChange={(e) => setEditLookupBy(e.target.value as typeof editLookupBy)}
                    className="h-10 rounded-lg border border-border bg-card px-2 text-sm"
                  >
                    <option value="username">по @username</option>
                    <option value="tgid">по Telegram ID</option>
                    <option value="referralCode">по реф. коду</option>
                    <option value="id">по Client ID</option>
                  </select>
                  <Input value={editValue} onChange={(e) => setEditValue(e.target.value)} placeholder="значение" className="h-10 rounded-lg" onKeyDown={(e) => { if (e.key === "Enter" && editValue.trim()) handleSaveReferrer(editValue.trim()); }} />
                  <Button size="sm" disabled={!editValue.trim() || savingReferrer} onClick={() => handleSaveReferrer(editValue.trim())} className="h-10 rounded-lg">
                    {savingReferrer ? <Loader2 className="h-4 w-4 animate-spin" /> : "Сохранить"}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Заработок */}
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground"><TrendingUp className="h-4 w-4 text-emerald-400" /> Заработок с рефералки</div>
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-emerald-500/30 bg-muted p-4">
                <div className="text-[11px] uppercase tracking-wider text-emerald-200/80">Всего</div>
                <div className="mt-1 text-[13.5px] font-bold text-emerald-100">{fmtRub(detail.earnings.totalAll)}</div>
                <div className="text-xs text-emerald-200/60">{detail.earnings.totalCount} начисл.</div>
              </div>
              {[1, 2, 3].map((lvl) => {
                const v = detail.earnings.byLevel[lvl] ?? { amount: 0, count: 0 };
                return (
                  <div key={lvl} className={cn("rounded-xl border  p-4", LEVEL_RING[lvl])}>
                    <div className="text-[11px] uppercase tracking-wider opacity-80">{LEVEL_LABELS[lvl]}</div>
                    <div className="mt-1 text-[13.5px] font-bold">{fmtRub(v.amount)}</div>
                    <div className="text-xs opacity-70">{v.count} начисл.</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Приглашённые */}
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground"><Award className="h-4 w-4 text-emerald-400" /> Приглашённые · {detail.referrals.length}</div>
            {detail.referrals.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">Пока никого не пригласил</div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {detail.referrals.map((r) => (
                  <button key={r.id} onClick={() => loadDetail(r.id)} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-left transition-colors hover:bg-emerald-500/10">
                    <div className="min-w-0">
                      <div className="truncate text-sm text-foreground">{r.telegramUsername ? `@${r.telegramUsername}` : (r.email ?? `tg:${r.telegramId ?? "?"}`)}</div>
                      <div className="truncate text-xs text-muted-foreground">своих реф.: {r._count.referrals} · {fmtMskShort(new Date(r.createdAt).getTime())}</div>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-emerald-400/60" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* История начислений */}
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground"><Copy className="h-4 w-4 text-emerald-400" /> Последние начисления · {detail.recentCredits.length}</div>
            {detail.recentCredits.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">Начислений ещё не было</div>
            ) : (
              <div className="max-h-96 overflow-y-auto rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Когда</th>
                      <th className="px-3 py-2 text-center font-medium">Ур.</th>
                      <th className="px-3 py-2 text-right font-medium">Сумма</th>
                      <th className="px-3 py-2 text-left font-medium">От кого</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.recentCredits.map((cr) => (
                      <tr key={cr.id} className="border-t border-border">
                        <td className="px-3 py-2 text-muted-foreground">{fmtMskShort(new Date(cr.createdAt).getTime())}</td>
                        <td className="px-3 py-2 text-center"><span className={cn("rounded-full border  px-2 py-0.5 text-xs", LEVEL_RING[cr.level] ?? "")}>L{cr.level}</span></td>
                        <td className="px-3 py-2 text-right font-semibold text-emerald-300">{fmtRub(cr.amount)}</td>
                        <td className="px-3 py-2 text-foreground/80"><ClientChip c={cr.payment?.client ?? null} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/*  ОБЗОР: ТОП-РЕФЕРЕРЫ (когда деталь не открыта)  */}
      {!detail && !loadingDetail && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
            <Crown className="h-4 w-4 text-amber-300" /> Топ-рефереры
          </div>
          {loadingOverview ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-emerald-400" /></div>
          ) : topReferrers.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Gift className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">Пока нет клиентов с рефералами.<br />Найди клиента через поиск выше и привяжи реферера.</p>
            </div>
          ) : (
            <div className="grid gap-2.5 lg:grid-cols-2">
              {topReferrers.map((n, i) => (
                <button
                  key={n.id}
                  onClick={() => loadDetail(n.id)}
                  className={cn(
                    "group flex items-center gap-3 rounded-xl border  p-3 text-left transition-all hover:scale-[1.01]",
                    i < 3 ? MEDAL_BG[i] : "border-border bg-transparent",
                  )}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-card font-bold">
                    {i < 3 ? <Medal className={cn("h-5 w-5", MEDAL[i])} /> : <span className="text-sm text-muted-foreground">{i + 1}</span>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-foreground">{n.name}</div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" /> {n.referralsCount}</span>
                      {n.referralIncome > 0 && <span className="inline-flex items-center gap-1 text-amber-300/80"><Wallet className="h-3 w-3" /> {fmtRub(n.referralIncome)}</span>}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-emerald-400" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
