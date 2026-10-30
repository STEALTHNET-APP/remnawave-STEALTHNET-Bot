import { useState, useEffect, useCallback, useMemo } from "react";
import { Check, RefreshCw, Loader2, Radio, ShieldCheck, Trash2, Undo2 } from "lucide-react";
import { api } from "@/lib/api";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Status = Awaited<ReturnType<typeof api.getBotWebhookStatus>>;

export function BotWebhookManager({ token }: { token: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [droppingQueue, setDroppingQueue] = useState(false);
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [url, setUrl] = useState(() => window.location.origin + "/api/bot/webhook");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmPolling, setConfirmPolling] = useState(false);
  const [confirmDropQueue, setConfirmDropQueue] = useState(false);
  const [dropPendingOnPolling, setDropPendingOnPolling] = useState(false);

  const refresh = useCallback(async (initialize = false, manual = false) => {
    setLoading(true);
    if (manual) {
      setError("");
      setMessage("");
    }
    try {
      const next = await api.getBotWebhookStatus(token);
      setStatus(next);
      const now = new Date().toLocaleTimeString("ru-RU");
      setLastChecked(now);
      if (initialize && next.configuredUrl) setUrl(next.configuredUrl);
      if (manual) {
        const pending = next.webhookInfo?.pending_update_count ?? 0;
        const modeLabel = next.enabled ? "Webhook" : "Long Polling";
        const msg = `Статус проверен в ${now}: режим ${modeLabel}, в очереди Telegram: ${pending} шт.`;
        setMessage(msg);
        toast.success("Статус бота обновлён", `Режим: ${modeLabel}, в очереди: ${pending} шт.`);
      }
      return next;
    } catch (error) {
      setStatus(null);
      const errStr = error instanceof Error ? error.message : "Не удалось проверить статус";
      setError(errStr);
      if (manual) {
        toast.error("Ошибка проверки статуса", errStr);
      }
      return null;
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void refresh(true); }, [refresh]);

  const changeMode = async (webhook: boolean, dropPending = false) => {
    setConfirmPolling(false);
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const result = webhook
        ? await api.setBotWebhook(token, { url: url.trim(), ...(secret.trim() ? { secretToken: secret.trim() } : {}) })
        : await api.deleteBotWebhook(token, dropPending);
      const successMsg = result.message || "Режим изменён";
      setMessage(successMsg);
      toast.success("Режим бота изменён", successMsg);
      setSecret("");
    } catch (error) {
      const errStr = error instanceof Error ? error.message : "Не удалось переключить режим";
      setError(errStr);
      toast.error("Ошибка смены режима", errStr);
    } finally {
      await refresh();
      setSaving(false);
    }
  };

  const handleDropQueue = async () => {
    setConfirmDropQueue(false);
    setDroppingQueue(true);
    setError("");
    setMessage("");
    try {
      const result = await api.dropBotWebhookPending(token);
      const successMsg = result.message || "Очередь сообщений сброшена";
      setMessage(successMsg);
      toast.success("Очередь Telegram очищена", successMsg);
    } catch (e) {
      const errStr = e instanceof Error ? e.message : "Не удалось сбросить очередь";
      setError(errStr);
      toast.error("Ошибка очистки очереди", errStr);
    } finally {
      await refresh();
      setDroppingQueue(false);
    }
  };

  const activeWebhook = status?.enabled && status.runtimeMode === "webhook" && status.webhookInfo?.url === status.configuredUrl;
  const activePolling = status && !status.enabled && status.runtimeMode === "polling" && !status.webhookInfo?.url;
  const mode = activeWebhook ? "Webhook" : activePolling ? "Long Polling" : "Режим не подтверждён";

  const configuredUrl = status?.configuredUrl || "";
  const isDirty = useMemo(() => {
    return (url.trim() !== configuredUrl.trim()) || secret.trim().length > 0;
  }, [url, configuredUrl, secret]);

  const handleResetForm = () => {
    if (configuredUrl) setUrl(configuredUrl);
    setSecret("");
  };

  return <>
    <Card className="mt-6">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="inline-flex items-center gap-2"><Radio className="h-4 w-4 shrink-0" />Получение сообщений бота</CardTitle>
          <div className="flex items-center gap-2">
            {lastChecked && (
              <span className="text-xs text-muted-foreground hidden sm:inline">
                Проверено: {lastChecked}
              </span>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading || saving || droppingQueue}
              onClick={() => void refresh(false, true)}
              className="gap-1.5"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Проверить статус
            </Button>
          </div>
        </div>
        <CardDescription>Webhook принимает события Telegram по HTTPS. Long Polling получает их через постоянное соединение бота с Telegram.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {message && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-400 flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2">
              <Check className="h-4 w-4 shrink-0" />
              {message}
            </span>
            <button type="button" onClick={() => setMessage("")} className="hover:opacity-75 text-xs font-semibold">✕</button>
          </div>
        )}
        <dl className="grid gap-4 sm:grid-cols-3">
          <div><dt className="text-xs text-muted-foreground">Текущий режим</dt><dd className="mt-1 text-sm font-medium">{loading && !status ? "Проверяем…" : mode}</dd></div>
          <div>
            <dt className="text-xs text-muted-foreground">В очереди Telegram</dt>
            <dd className="mt-1 text-sm flex items-center gap-2">
              <span>{status?.webhookInfo?.pending_update_count ?? "—"}</span>
              {Number(status?.webhookInfo?.pending_update_count) > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                  disabled={saving || droppingQueue}
                  onClick={() => setConfirmDropQueue(true)}
                >
                  <Trash2 className="h-3 w-3 mr-1" />
                  Очистить
                </Button>
              )}
            </dd>
          </div>
          <div><dt className="text-xs text-muted-foreground">Процесс бота</dt><dd className="mt-1 text-sm">{status?.runtimeMode === "unavailable" ? "Недоступен" : status?.runtimeMode ?? "—"}</dd></div>
        </dl>
        {status?.webhookInfo?.last_error_message && <p className="text-sm text-destructive break-words">Последняя ошибка Telegram: {status.webhookInfo.last_error_message}</p>}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="webhook-url">Адрес webhook</Label>
            <button
              type="button"
              className="text-xs text-primary hover:underline cursor-pointer"
              onClick={() => {
                if (typeof window !== "undefined") {
                  const target = window.location.origin + "/api/bot/webhook";
                  setUrl(target);
                  toast.info("Адрес подставлен", target);
                }
              }}
            >
              Подставить адрес текущей панели
            </button>
          </div>
          <Input id="webhook-url" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://example.com/api/bot/webhook" disabled={saving || droppingQueue} />
          <p className="text-xs text-muted-foreground">Укажите публичный HTTPS-адрес этой панели с путём /api/bot/webhook.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="webhook-secret" className="inline-flex items-center gap-2"><ShieldCheck className="h-4 w-4" />Секрет проверки запросов</Label>
          <Input id="webhook-secret" type="password" autoComplete="new-password" value={secret} onChange={event => setSecret(event.target.value)} disabled={saving || droppingQueue} placeholder={status?.hasSecret ? "Сохранён. Введите новый для смены" : "Будет создан автоматически"} />
          <p className="text-xs text-muted-foreground">Пустое поле сохраняет текущий секрет. При первом включении панель создаст его сама.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {activeWebhook ? (
            isDirty ? (
              <>
                <Button
                  type="button"
                  disabled={saving || !url.trim() || droppingQueue}
                  onClick={() => void changeMode(true)}
                  className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  Сохранить изменения
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={saving || droppingQueue}
                  onClick={handleResetForm}
                  className="gap-1 text-muted-foreground hover:text-foreground"
                >
                  <Undo2 className="h-3.5 w-3.5" />
                  Сбросить
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="outline"
                disabled
                className="gap-1.5 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5 cursor-default opacity-90"
              >
                <Check className="h-4 w-4 text-emerald-500" />
                Webhook активен
              </Button>
            )
          ) : (
            <Button
              type="button"
              disabled={saving || !url.trim() || droppingQueue}
              onClick={() => void changeMode(true)}
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Включить Webhook
            </Button>
          )}

          <Button
            type="button"
            variant="outline"
            disabled={saving || !activeWebhook || droppingQueue}
            onClick={() => setConfirmPolling(true)}
          >
            Перейти на Long Polling
          </Button>

          <Button
            type="button"
            variant="outline"
            disabled={saving || droppingQueue}
            onClick={() => setConfirmDropQueue(true)}
            className="gap-1.5 text-muted-foreground hover:text-destructive hover:border-destructive/30"
          >
            {droppingQueue ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Сбросить очередь
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">При переключении очередь сообщений сохраняется. Если переключение не подтвердилось, проверьте статус и повторите.</p>
      </CardContent>
    </Card>
    <Dialog open={confirmPolling} onOpenChange={setConfirmPolling}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Перейти на Long Polling?</DialogTitle>
          <DialogDescription>Бот отключит webhook в Telegram и запустит опрос.</DialogDescription>
        </DialogHeader>
        <label className="flex items-center gap-2 pt-2 text-xs text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={dropPendingOnPolling}
            onChange={e => setDropPendingOnPolling(e.target.checked)}
            className="rounded border-border text-primary focus:ring-primary h-4 w-4"
          />
          <span>Сбросить накопившуюся очередь сообщений при переключении</span>
        </label>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setConfirmPolling(false)}>Отмена</Button>
          <Button type="button" onClick={() => void changeMode(false, dropPendingOnPolling)}>Переключить</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={confirmDropQueue} onOpenChange={setConfirmDropQueue}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Сбросить очередь сообщений Telegram?</DialogTitle>
          <DialogDescription>
            Все накопившиеся сообщения в очереди Telegram ({status?.webhookInfo?.pending_update_count ?? 0} шт.) будут немедленно удалены серверами Telegram без обработки ботом.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setConfirmDropQueue(false)}>Отмена</Button>
          <Button type="button" variant="destructive" disabled={droppingQueue} onClick={handleDropQueue}>
            {droppingQueue && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
            Сбросить очередь
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
