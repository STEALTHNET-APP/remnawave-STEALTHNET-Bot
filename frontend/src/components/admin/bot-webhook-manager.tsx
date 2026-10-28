import { useState, useEffect, useCallback } from "react";
import { Zap, RotateCcw, Check, Copy, AlertCircle, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

export function BotWebhookManager({ token }: { token: string }) {
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.getBotWebhookStatus>> | null>(null);
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [dropPending, setDropPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const fetchStatus = useCallback(async (isManual = false) => {
    setLoading(true);
    try {
      const res = await api.getBotWebhookStatus(token);
      setStatus(res);
      setLastChecked(new Date().toLocaleTimeString("ru-RU"));
      if (res.configuredUrl) {
        setUrl(res.configuredUrl);
      } else if (typeof window !== "undefined") {
        setUrl(window.location.origin + "/api/bot/webhook");
      }
      if (isManual) {
        if (res.ok) {
          const pending = res.webhookInfo?.pending_update_count ?? 0;
          setActionMsg({
            text: `Статус Telegram API успешно обновлён (в очереди: ${pending} шт.)`,
          });
        } else {
          setActionMsg({ text: res.error || "Не удалось получить статус", error: true });
        }
      }
    } catch (e) {
      const errStr = e instanceof Error ? e.message : String(e);
      setStatus({ ok: false, error: errStr });
      if (isManual) {
        setActionMsg({ text: `Ошибка проверки статуса: ${errStr}`, error: true });
      }
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchStatus(false);
  }, [fetchStatus]);

  const handleSet = async () => {
    const finalUrl = url.trim() || (typeof window !== "undefined" ? window.location.origin + "/api/bot/webhook" : "");
    if (!finalUrl) return;
    setActionLoading(true);
    setActionMsg(null);
    try {
      const res = await api.setBotWebhook(token, {
        url: finalUrl,
        secretToken: secret.trim() || undefined,
        dropPendingUpdates: dropPending,
      });
      if (res.ok) {
        setActionMsg({ text: res.message || "Вебхук успешно установлен в Telegram!" });
        await fetchStatus(false);
      } else {
        setActionMsg({ text: res.error || "Ошибка установки вебхука", error: true });
      }
    } catch (e) {
      setActionMsg({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Вы уверены, что хотите переключить бота в режим Long Polling?")) return;
    setActionLoading(true);
    setActionMsg(null);
    try {
      const res = await api.deleteBotWebhook(token, dropPending);
      if (res.ok) {
        setActionMsg({ text: res.message || "Вебхук удалён, бот переключён на Long Polling" });
        await fetchStatus(false);
      } else {
        setActionMsg({ text: res.error || "Ошибка отключения вебхука", error: true });
      }
    } catch (e) {
      setActionMsg({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setActionLoading(false);
    }
  };

  const generateSecret = () => {
    const array = new Uint8Array(24);
    crypto.getRandomValues(array);
    const sec = Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join("");
    setSecret(sec);
  };

  const copyUrl = () => {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isEnabled = status?.enabled ?? false;
  const webhookInfo = status?.webhookInfo;
  const isPendingError = Boolean(webhookInfo?.last_error_message);

  return (
    <Card className="overflow-hidden border-border mt-6">
      <div className="relative bg-muted p-4 border-b border-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <Zap className="h-5 w-5 text-amber-500" />
              Режим работы бота и скорость ответов (Webhook)
            </h2>
            {isEnabled ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                <Check className="h-3 w-3" /> Webhook активен (&lt; 50мс)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2.5 py-0.5 text-xs font-semibold text-blue-600 dark:text-blue-400 border border-blue-500/20">
                <RotateCcw className="h-3 w-3" /> Long Polling (стандартный)
              </span>
            )}
          </div>
          <p className="text-[12.5px] text-muted-foreground mt-1">
            В режиме Webhook Telegram отправляет события напрямую через HTTPS POST, а бот возвращает ответ прямо в теле запроса (Webhook Reply) — кнопки нажимаются мгновенно без сетевых задержек.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {lastChecked && (
            <span className="text-xs text-muted-foreground hidden sm:inline">
              Проверено: {lastChecked}
            </span>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => fetchStatus(true)}
            className="gap-1.5"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
            Проверить статус
          </Button>
        </div>
      </div>

      <CardContent className="space-y-4 p-4 sm:p-6">
        {status?.error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-destructive dark:text-destructive-foreground text-xs flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>Ошибка статуса Telegram API: {status.error}</span>
          </div>
        )}

        {actionMsg && (
          <div
            className={`rounded-xl border p-3 text-xs flex items-center gap-2 ${
              actionMsg.error
                ? "border-destructive/30 bg-destructive/10 text-destructive dark:text-destructive-foreground"
                : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            }`}
          >
            {actionMsg.error ? <AlertCircle className="h-4 w-4 shrink-0" /> : <Check className="h-4 w-4 shrink-0" />}
            <span>{actionMsg.text}</span>
          </div>
        )}

        {/* Telegram status diagnostics */}
        {webhookInfo && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-xl border border-border bg-card p-3">
              <span className="text-xs text-muted-foreground">URL в Telegram API:</span>
              <p className="text-xs font-mono font-medium truncate mt-1 text-foreground" title={webhookInfo.url || "Не задан"}>
                {webhookInfo.url || "Не задан (Long Polling)"}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-3">
              <span className="text-xs text-muted-foreground">Очередь обновлений (pending):</span>
              <p
                className={`text-base font-bold mt-0.5 ${
                  webhookInfo.pending_update_count && webhookInfo.pending_update_count > 10
                    ? "text-amber-500"
                    : "text-emerald-500"
                }`}
              >
                {webhookInfo.pending_update_count ?? 0} шт.
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-3">
              <span className="text-xs text-muted-foreground">Макс. соединений:</span>
              <p className="text-base font-bold mt-0.5 text-foreground">{webhookInfo.max_connections ?? 40}</p>
            </div>
          </div>
        )}

        {isPendingError && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-destructive dark:text-destructive-foreground text-xs flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Последняя ошибка доставки Telegram:</p>
              <p className="mt-0.5">{webhookInfo?.last_error_message}</p>
              {webhookInfo?.last_error_date && (
                <p className="mt-0.5 opacity-80">
                  Дата ошибки: {new Date(webhookInfo.last_error_date * 1000).toLocaleString("ru-RU")}
                </p>
              )}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="webhook-url">Webhook URL</Label>
            <button
              type="button"
              className="text-xs text-primary hover:underline"
              onClick={() => {
                if (typeof window !== "undefined") {
                  setUrl(window.location.origin + "/api/bot/webhook");
                }
              }}
            >
              Подставить адрес текущей панели
            </button>
          </div>
          <div className="relative">
            <Input
              id="webhook-url"
              placeholder="https://example.com/api/bot/webhook"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="pr-24 font-mono text-xs"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={copyUrl}
              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-500 mr-1" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
              {copied ? "Скопировано" : "Копия"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Публичный HTTPS URL, на который Telegram направляет обновления. Путь <code>/api/bot/webhook</code> уже автоматически проксируется Nginx на Express и бот.
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="webhook-secret">Secret Token (X-Telegram-Bot-Api-Secret-Token, опционально)</Label>
            <button type="button" className="text-xs text-primary hover:underline" onClick={generateSecret}>
              Сгенерировать случайный
            </button>
          </div>
          <Input
            id="webhook-secret"
            placeholder="Секретный токен для проверки подлинности запросов от Telegram"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            className="font-mono text-xs"
          />
        </div>

        <div className="flex items-center gap-2 pt-1">
          <input
            type="checkbox"
            id="drop-pending-updates"
            checked={dropPending}
            onChange={(e) => setDropPending(e.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          <Label htmlFor="drop-pending-updates" className="text-xs font-normal cursor-pointer">
            Сбросить накопившуюся очередь обновлений при переключении (Drop pending updates)
          </Label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-border">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              disabled={actionLoading}
              onClick={handleSet}
              className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              Включить Webhook
            </Button>
            {isEnabled && (
              <Button
                type="button"
                variant="outline"
                disabled={actionLoading}
                onClick={handleDelete}
                className="gap-1.5 text-muted-foreground hover:text-foreground"
              >
                <RotateCcw className="h-4 w-4" />
                Переключить на Polling
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
