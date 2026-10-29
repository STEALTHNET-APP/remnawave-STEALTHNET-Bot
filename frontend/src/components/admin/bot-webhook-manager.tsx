import { useState, useEffect, useCallback } from "react";
import { Check, RefreshCw, Loader2, Radio, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
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
  const [url, setUrl] = useState(() => window.location.origin + "/api/bot/webhook");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmPolling, setConfirmPolling] = useState(false);

  const refresh = useCallback(async (initialize = false) => {
    setLoading(true);
    try {
      const next = await api.getBotWebhookStatus(token);
      setStatus(next);
      if (initialize && next.configuredUrl) setUrl(next.configuredUrl);
      return next;
    } catch (error) {
      setStatus(null);
      setError(error instanceof Error ? error.message : "Не удалось проверить статус");
      return null;
    } finally { setLoading(false); }
  }, [token]);

  useEffect(() => { void refresh(true); }, [refresh]);

  const changeMode = async (webhook: boolean) => {
    setConfirmPolling(false);
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const result = webhook
        ? await api.setBotWebhook(token, { url: url.trim(), ...(secret.trim() ? { secretToken: secret.trim() } : {}) })
        : await api.deleteBotWebhook(token);
      setMessage(result.message || "Режим изменён");
      setSecret("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Не удалось переключить режим");
    } finally {
      await refresh();
      setSaving(false);
    }
  };

  const activeWebhook = status?.enabled && status.runtimeMode === "webhook" && status.webhookInfo?.url === status.configuredUrl;
  const activePolling = status && !status.enabled && status.runtimeMode === "polling" && !status.webhookInfo?.url;
  const mode = activeWebhook ? "Webhook" : activePolling ? "Long Polling" : "Режим не подтверждён";

  return <>
    <Card className="mt-6">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="inline-flex items-center gap-2"><Radio className="h-4 w-4 shrink-0" />Получение сообщений бота</CardTitle>
          <Button type="button" variant="outline" size="sm" disabled={loading || saving} onClick={() => { setError(""); void refresh(); }}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Проверить статус
          </Button>
        </div>
        <CardDescription>Webhook принимает события Telegram по HTTPS. Long Polling получает их через постоянное соединение бота с Telegram.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {message && <p role="status" className="inline-flex items-center gap-2 text-sm"><Check className="h-4 w-4" />{message}</p>}
        <dl className="grid gap-4 sm:grid-cols-3">
          <div><dt className="text-xs text-muted-foreground">Текущий режим</dt><dd className="mt-1 text-sm font-medium">{loading && !status ? "Проверяем…" : mode}</dd></div>
          <div><dt className="text-xs text-muted-foreground">В очереди Telegram</dt><dd className="mt-1 text-sm">{status?.webhookInfo?.pending_update_count ?? "—"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Процесс бота</dt><dd className="mt-1 text-sm">{status?.runtimeMode === "unavailable" ? "Недоступен" : status?.runtimeMode ?? "—"}</dd></div>
        </dl>
        {status?.webhookInfo?.last_error_message && <p className="text-sm text-destructive break-words">Последняя ошибка Telegram: {status.webhookInfo.last_error_message}</p>}
        <div className="space-y-2">
          <Label htmlFor="webhook-url">Адрес webhook</Label>
          <Input id="webhook-url" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://example.com/api/bot/webhook" disabled={saving} />
          <p className="text-xs text-muted-foreground">Укажите публичный HTTPS-адрес этой панели с путём /api/bot/webhook.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="webhook-secret" className="inline-flex items-center gap-2"><ShieldCheck className="h-4 w-4" />Секрет проверки запросов</Label>
          <Input id="webhook-secret" type="password" autoComplete="new-password" value={secret} onChange={event => setSecret(event.target.value)} disabled={saving} placeholder={status?.hasSecret ? "Сохранён. Введите новый для смены" : "Будет создан автоматически"} />
          <p className="text-xs text-muted-foreground">Пустое поле сохраняет текущий секрет. При первом включении панель создаст его сама.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={saving || !url.trim()} onClick={() => void changeMode(true)}>{saving && <Loader2 className="h-4 w-4 animate-spin" />}Включить Webhook</Button>
          <Button type="button" variant="outline" disabled={saving || !!activePolling} onClick={() => setConfirmPolling(true)}>Перейти на Long Polling</Button>
        </div>
        <p className="text-xs text-muted-foreground">При переключении очередь сообщений сохраняется. Если переключение не подтвердилось, проверьте статус и повторите.</p>
      </CardContent>
    </Card>
    <Dialog open={confirmPolling} onOpenChange={setConfirmPolling}>
      <DialogContent><DialogHeader><DialogTitle>Перейти на Long Polling?</DialogTitle><DialogDescription>Бот отключит webhook в Telegram и запустит опрос. Накопленные сообщения останутся в очереди.</DialogDescription></DialogHeader>
        <DialogFooter><Button type="button" variant="outline" onClick={() => setConfirmPolling(false)}>Отмена</Button><Button type="button" onClick={() => void changeMode(false)}>Переключить</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
