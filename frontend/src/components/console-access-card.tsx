/**
 * Карточка «SSH-консоль мониторинга» в админке.
 * Показывает готовую ssh-команду + пароль + IP/порт + подсказку про фаервол,
 * с копированием и кнопкой перегенерации доступа. Данные — из /api/admin/console.
 */
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Terminal, Copy, Check, RefreshCw, Eye, EyeOff, Loader2 } from "lucide-react";
import { consoleApi, type ConsoleAccess } from "@/lib/admin-extras-api";

export function ConsoleAccessCard({ token }: { token: string | null }) {
  const [data, setData] = useState<ConsoleAccess | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      setData(await consoleApi.get(token));
    } catch {
      /* тихо */
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const copy = (text: string, key: string) => {
    navigator.clipboard?.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
  };

  const regenerate = async () => {
    if (!token) return;
    if (!confirm("Сгенерировать новый доступ? Старые логин/порт/пароль перестанут работать.")) return;
    setRegenerating(true);
    try {
      setData(await consoleApi.regenerate(token));
      setShowPass(false);
    } catch {
      /* тихо */
    } finally {
      setRegenerating(false);
    }
  };

  const cell = "flex-1 px-3 py-2 rounded-xl bg-muted font-mono text-sm break-all";

  return (
    <Card className="border overflow-hidden">
      <div className="px-5 pt-5 pb-3 flex items-center gap-3 border-b border-border/50">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted border border-border">
          <Terminal className="h-5 w-5 text-emerald-500" />
        </span>
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">SSH-консоль мониторинга</h2>
          <p className="text-xs text-muted-foreground/70">Живой терминальный дашборд этого сервера по SSH</p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => void load()} className="ml-auto rounded-xl" disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </div>
      <CardContent className="p-5 space-y-3">
        {!data ? (
          <p className="text-sm text-muted-foreground">{loading ? "Загрузка…" : "Нет данных"}</p>
        ) : (
          <>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Команда подключения</div>
              <div className="flex items-center gap-2">
                <code className={cell}>{data.sshCommand}</code>
                <Button size="sm" variant="outline" className="rounded-xl" onClick={() => copy(data.sshCommand, "cmd")}>
                  {copied === "cmd" ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-muted-foreground mb-1">Пароль</div>
                <div className="flex items-center gap-2">
                  <code className={cell}>{showPass ? data.password : "••••••••••••"}</code>
                  <Button size="sm" variant="outline" className="rounded-xl" onClick={() => setShowPass((v) => !v)}>
                    {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                  <Button size="sm" variant="outline" className="rounded-xl" onClick={() => copy(data.password, "pass")}>
                    {copied === "pass" ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">IP</div>
                  <code className="block px-3 py-2 rounded-xl bg-muted font-mono text-sm">{data.ip ?? "—"}</code>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Порт</div>
                  <code className="block px-3 py-2 rounded-xl bg-muted font-mono text-sm">{data.port || "—"}</code>
                </div>
              </div>
            </div>
            <div className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/25 rounded-xl px-3 py-2">
              <span></span>
              <span>
                Если на сервере включён фаервол — откройте порт:{" "}
                <code className="font-mono bg-black/10 dark:bg-card px-1 rounded">{data.ufwHint}</code>
              </span>
            </div>
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="outline"
                className="rounded-xl gap-1.5 text-muted-foreground"
                onClick={() => void regenerate()}
                disabled={regenerating}
              >
                {regenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Сгенерировать новый доступ
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
