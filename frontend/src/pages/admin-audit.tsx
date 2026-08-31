/**
 * Аудит-лог админских действий: фильтры (kind, actor, targetType, диапазон дат, поиск),
 * пагинация по cursor'у, JSON payload в дровере.
 */

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Search, RefreshCw, ChevronRight } from "lucide-react";
import { auditApi, type AdminEvent, type AuditFacets } from "@/lib/admin-extras-api";
import { fmtMsk } from "@/lib/datetime";
import { motion } from "framer-motion";

const KIND_COLOR: Record<string, string> = {
  block: "text-red-600 dark:text-red-400",
  unblock: "text-emerald-600 dark:text-emerald-400",
  refund: "text-amber-600 dark:text-amber-400",
  delete: "text-red-600 dark:text-red-400",
  create: "text-emerald-600 dark:text-emerald-400",
  update: "text-blue-600 dark:text-blue-400",
  publish: "text-violet-600 dark:text-violet-400",
  draw: "text-violet-600 dark:text-violet-400",
  login: "text-slate-600 dark:text-slate-400",
  logout: "text-slate-600 dark:text-slate-400",
  trigger: "text-orange-600 dark:text-orange-400",
  replay: "text-cyan-600 dark:text-cyan-400",
};

function colorOfKind(kind: string): string {
  for (const [k, v] of Object.entries(KIND_COLOR)) {
    if (kind.includes(k)) return v;
  }
  return "text-foreground";
}

const selectCls =
  "mt-1.5 flex h-9 w-full rounded-xl border border-border bg-foreground/[0.03] dark:bg-white/[0.02] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50";

export function AdminAuditPage() {
  const { state } = useAuth();
  const token = state.accessToken;

  const [items, setItems] = useState<AdminEvent[]>([]);
  const [facets, setFacets] = useState<AuditFacets | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AdminEvent | null>(null);

  const [filters, setFilters] = useState({ kind: "", actorId: "", targetType: "", q: "" });

  const load = useCallback(async (reset = true) => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const result = await auditApi.list(token, {
        kind: filters.kind || undefined,
        actorId: filters.actorId || undefined,
        targetType: filters.targetType || undefined,
        q: filters.q || undefined,
        cursor: reset ? undefined : cursor || undefined,
        limit: 50,
      });
      setItems((prev) => (reset ? result.items : [...prev, ...result.items]));
      setCursor(result.nextCursor);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [token, filters, cursor]);

  useEffect(() => {
    if (!token) return;
    auditApi.facets(token).then(setFacets).catch(() => {});
  }, [token]);

  useEffect(() => {
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.kind, filters.actorId, filters.targetType]);

  return (
    <div className="flex flex-col gap-3.5 relative">

      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
      >
        <div className="flex items-start gap-3">
          <div>
            <h1 className="text-xl font-extrabold tracking-[-0.3px] text-foreground">Аудит-лог</h1>
            <p className="text-[12.5px] text-muted-foreground mt-[3px]">Журнал действий администраторов — кто, что и когда менял.</p>
          </div>
        </div>
        <Button onClick={() => load(true)} variant="outline" size="sm" disabled={loading} className="gap-1.5 rounded-xl">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Обновить
        </Button>
      </motion.div>

      <Card className="bg-card border-border rounded-2xl p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <div>
            <Label className="text-xs text-muted-foreground">Тип события</Label>
            <select
              value={filters.kind}
              onChange={(e) => setFilters((f) => ({ ...f, kind: e.target.value }))}
              className={selectCls}
            >
              <option value="">Все</option>
              {facets?.kinds.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Кто (admin email)</Label>
            <select
              value={filters.actorId}
              onChange={(e) => setFilters((f) => ({ ...f, actorId: e.target.value }))}
              className={selectCls}
            >
              <option value="">Все</option>
              {facets?.actors.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Объект</Label>
            <select
              value={filters.targetType}
              onChange={(e) => setFilters((f) => ({ ...f, targetType: e.target.value }))}
              className={selectCls}
            >
              <option value="">Все</option>
              {facets?.targetTypes.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Поиск</Label>
            <div className="mt-1.5 relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={filters.q}
                onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && load(true)}
                placeholder="kind, actor, targetId…"
                className="pl-8 rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-border focus-visible:ring-primary/50"
              />
            </div>
          </div>
        </div>
      </Card>

      {error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500 dark:text-red-400">
          {error}
        </div>
      ) : null}

      <Card className="bg-card border-border rounded-2xl overflow-hidden py-0">
        {items.length === 0 && !loading ? (
          <div className="flex flex-col items-center justify-center text-center py-14">
            <h3 className="text-[13.5px] font-bold tracking-tight">Нет событий</h3>
            <p className="text-[12.5px] text-muted-foreground mt-[3px]">Журнал начинает заполняться по мере действий админов.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {items.map((ev) => (
              <button
                key={ev.id}
                onClick={() => setSelected(ev)}
                className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-foreground/5"
              >
                <div className="text-xs text-muted-foreground font-mono w-32 shrink-0">
                  {fmtMsk(ev.createdAt)}
                </div>
                <div
                  className={`text-sm font-semibold w-48 md:w-64 shrink-0 truncate ${colorOfKind(ev.kind)}`}
                  title={ev.kind}
                >
                  {ev.kind}
                </div>
                <div className="text-sm text-foreground/90 w-40 shrink-0 truncate hidden sm:block" title={ev.actorId ?? "system"}>
                  {ev.actorId ?? <span className="text-muted-foreground italic">system</span>}
                </div>
                <div className="text-xs text-muted-foreground flex-1 min-w-0 truncate">
                  {ev.targetType ? `${ev.targetType}` : ""}
                  {ev.targetId ? ` ${ev.targetId.slice(0, 16)}…` : ""}
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </button>
            ))}
            {cursor ? (
              <div className="p-3 text-center">
                <Button onClick={() => load(false)} variant="outline" size="sm" disabled={loading} className="rounded-xl">
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Загрузить ещё"}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </Card>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto bg-card border-border rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 min-w-0">
              <span className={`truncate ${colorOfKind(selected?.kind ?? "")}`} title={selected?.kind}>{selected?.kind}</span>
              <span className="text-sm text-muted-foreground font-mono shrink-0">{selected?.id.slice(0, 12)}…</span>
            </DialogTitle>
          </DialogHeader>
          {selected ? (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-[120px_1fr] gap-2">
                <span className="text-muted-foreground">Время:</span>
                <span className="font-mono">{fmtMsk(selected.createdAt)}</span>
                <span className="text-muted-foreground">Админ:</span>
                <span>{selected.actorId ?? <span className="text-muted-foreground italic">system</span>}</span>
                <span className="text-muted-foreground">IP:</span>
                <span className="font-mono">{selected.actorIp ?? "—"}</span>
                <span className="text-muted-foreground">Объект:</span>
                <span className="font-mono break-all">{selected.targetType ?? "—"} {selected.targetId ? selected.targetId : ""}</span>
              </div>
              {selected.payload ? (
                <div>
                  <Label className="text-xs text-muted-foreground">payload</Label>
                  <pre className="mt-1 max-h-96 overflow-auto rounded-xl border border-border bg-foreground/[0.03] dark:bg-white/[0.02] p-3 text-xs font-mono">
                    {JSON.stringify(selected.payload, null, 2)}
                  </pre>
                </div>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
