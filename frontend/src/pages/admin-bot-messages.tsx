/**
 * Bot message editor — единый редактор всех bot_* строк.
 *
 * Сгруппирован по разделам (Меню / Тарифы / UI / Прочее). По клику открывается
 * редактор для конкретного ключа (text/json/markdown/boolean/number).
 */

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, RefreshCw, Save, Check, AlertCircle } from "lucide-react";
import { useAuth } from "@/contexts/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { botMessagesApi, type BotMessage } from "@/lib/admin-extras-api";

export function AdminBotMessagesPage() {
  const { state } = useAuth();
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [val, setVal] = useState("");
  const [saved, setSaved] = useState(false);

  const token = state.accessToken;

  const listQuery = useQuery({
    queryKey: ["admin", "bot-messages"] as const,
    queryFn: () => botMessagesApi.list(token!).catch(() => null),
    enabled: !!token,
  });
  const items = listQuery.data?.items ?? [];
  const loading = listQuery.isFetching;
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const err = [
    listQuery.error ? (listQuery.error instanceof Error ? listQuery.error.message : "load error") : null,
    saveErr,
  ].find(Boolean) ?? null;

  function select(item: BotMessage) {
    setActiveKey(item.key);
    setVal(item.value);
    setSaved(false);
  }

  const active = items.find((i) => i.key === activeKey);

  const saveMutation = useMutation({
    mutationFn: () => {
      // local validate JSON
      if (active?.valueType === "json" && val.trim()) {
        try { JSON.parse(val); }
        catch { return Promise.reject(new Error("Невалидный JSON")); }
      }
      return botMessagesApi.update(token!, active!.key, val);
    },
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      void listQuery.refetch();
    },
    onError: (e) => setSaveErr(e instanceof Error ? e.message : "save error"),
  });
  const busy = saveMutation.isPending;

  // group by .group
  const groups = items.reduce<Record<string, BotMessage[]>>((acc, m) => {
    if (!acc[m.group]) acc[m.group] = [];
    acc[m.group].push(m);
    return acc;
  }, {});

  return (
    <div className="w-full space-y-4 px-4 sm:px-6 md:px-8 pt-6 pb-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between !bg-transparent !border-0 ! !shadow-none">
        <div className="flex items-start gap-3">
          <div>
            <h1 className="text-xl font-extrabold tracking-[-0.3px] text-foreground">Тексты бота</h1>
            <p className="text-[12.5px] text-muted-foreground mt-[3px]">Все bot_* настройки в одном месте: меню, тарифы, оплата, кнопки</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => void listQuery.refetch()} disabled={loading} className="rounded-xl gap-2">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Обновить
        </Button>
      </div>

      {err && (
        <Card className="p-3 bg-rose-500/10 border-rose-500/30 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-rose-500 shrink-0" />
          <p className="text-xs text-rose-500">{err}</p>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        {/* LEFT: groups */}
        <Card className="bg-card border-border rounded-xl p-3 lg:sticky lg:top-24 lg:self-start lg:max-h-[calc(100vh-7rem)] overflow-y-auto">
          {loading && items.length === 0 ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : (
            Object.entries(groups).map(([gname, gitems]) => (
              <div key={gname} className="mb-3">
                <h4 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-2 mb-1">{gname}</h4>
                <div className="space-y-1">
                  {gitems.map((m) => (
                    <button
                      key={m.key}
                      onClick={() => select(m)}
                      className={cn(
                        "w-full text-left rounded-xl px-3 py-2 text-sm transition",
                        m.key === activeKey
                          ? "bg-primary/15 text-foreground font-medium border border-border"
                          : "hover:bg-foreground/[0.04] text-muted-foreground border border-transparent",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className="truncate">{m.label}</span>
                        <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60 ml-auto">{m.valueType}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </Card>

        {/* RIGHT: editor */}
        {active ? (
          <Card className="bg-card border-border rounded-xl p-4 space-y-3">
            <div>
              <h2 className="text-[13.5px] font-bold">{active.label}</h2>
              <p className="text-xs text-muted-foreground">{active.description}</p>
              <p className="text-[10px] font-mono text-muted-foreground/60 mt-1">key: {active.key}</p>
              {active.variables && active.variables.length > 0 && (
                <p className="text-[10px] text-muted-foreground mt-1">Переменные: {active.variables.map((v) => <code key={v} className="bg-foreground/[0.05] px-1 rounded mx-0.5">{v}</code>)}</p>
              )}
            </div>

            {active.valueType === "boolean" ? (
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={val === "true"}
                  onChange={(e) => { setVal(e.target.checked ? "true" : "false"); setSaved(false); }}
                  className="h-4 w-4 accent-primary"
                />
                <span className="text-sm">Включено: {val === "true" ? "да" : "нет"}</span>
              </div>
            ) : active.valueType === "number" ? (
              <Input type="number" value={val} onChange={(e) => { setVal(e.target.value); setSaved(false); }} />
            ) : (
              <textarea
                value={val}
                onChange={(e) => { setVal(e.target.value); setSaved(false); }}
                className={cn(
                  "w-full rounded-lg bg-foreground/[0.03] dark:bg-white/[0.02] border border-border p-3",
                  active.valueType === "json" || active.valueType === "markdown" ? "min-h-[320px] font-mono text-xs" : "min-h-[100px] text-sm",
                )}
                spellCheck={false}
              />
            )}
            <div className="flex items-center gap-2 pt-2 border-t border-border">
              <Button onClick={() => { setSaveErr(null); if (active) saveMutation.mutate(); }} disabled={busy} className="gap-2">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                {saved ? "Сохранено" : "Сохранить"}
              </Button>
            </div>
          </Card>
        ) : (
          <Card className="bg-card border-border rounded-xl p-8 text-center text-sm text-muted-foreground">
            Выберите ключ слева
          </Card>
        )}
      </div>
    </div>
  );
}
