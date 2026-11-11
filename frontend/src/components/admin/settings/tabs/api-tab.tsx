import type { Dispatch, FormEvent, SetStateAction } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, Bot, Check, CheckCircle2, Eye, EyeOff, Loader2, Plug, RotateCcw } from "lucide-react";
import { BotWebhookManager } from "@/components/admin/bot-webhook-manager";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TabsContent } from "@/components/ui/tabs";
import type { AdminSettings } from "@/lib/api";


export function ApiTab({
  settings,
  setSettings,
  saving,
  token,
  remnaTesting,
  remnaTestResult,
  botTesting,
  botTestResult,
  handleSubmit,
  handleTestRemna,
  handleResetRemna,
  handleTestBot,
  handleResetBotToken,
}: {
  settings: AdminSettings;
  setSettings: Dispatch<SetStateAction<AdminSettings | null>>;
  saving: boolean;
  token: string;
  remnaTesting: boolean;
  remnaTestResult: { ok: boolean; status?: number; latencyMs?: number; message?: string; error?: string } | null;
  botTesting: boolean;
  botTestResult: { ok: boolean; latencyMs?: number; bot?: { id?: number; firstName?: string; username?: string }; message?: string; error?: string } | null;
  handleSubmit: (e: FormEvent) => void;
  handleTestRemna: () => void;
  handleResetRemna: () => void;
  handleTestBot: () => void;
  handleResetBotToken: () => void;
}) {
  const { t } = useTranslation();
  const [showRemnaToken, setShowRemnaToken] = useState(false);
  const [showRemnaSecret, setShowRemnaSecret] = useState(false);
  const [showBotToken, setShowBotToken] = useState(false);

  return (
        <TabsContent value="api">
          <div className="space-y-6">
            {/* Карточка 1: Remnawave API */}
            <Card className="overflow-hidden border-border">
              <div className="relative bg-muted p-4 border-b border-border flex items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-bold tracking-tight text-foreground">
                      Remnawave API (REMNA_*)
                    </h2>
                    {settings?.remnaConfigSource === "database" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                        <Check className="h-3 w-3" /> Из панели (БД)
                      </span>
                    ) : settings?.remnaConfigSource === "env" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2.5 py-0.5 text-xs font-semibold text-blue-600 dark:text-blue-400 border border-blue-500/20">
                        Унаследовано из .env
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400 border border-amber-500/20">
                        Не настроено
                      </span>
                    )}
                  </div>
                  <p className="text-[12.5px] text-muted-foreground mt-1">
                    Управление подключением к панели Remnawave, Bearer-токеном и секретным ключом без перезапуска сервера
                  </p>
                </div>
              </div>
              <CardContent className="space-y-4 p-4 sm:p-6">
                <div className="space-y-2">
                  <Label htmlFor="remna-api-url">URL API Remnawave (REMNA_API_URL)</Label>
                  <Input
                    id="remna-api-url"
                    type="url"
                    placeholder="https://panel.example.com"
                    value={settings?.remnaApiUrl ?? ""}
                    onChange={(e) => setSettings((s) => s ? { ...s, remnaApiUrl: e.target.value || null } : s)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Базовый адрес панели Remnawave (без завершающего слэша)
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="remna-admin-token">Токен администратора (REMNA_ADMIN_TOKEN)</Label>
                  <div className="relative">
                    <Input
                      id="remna-admin-token"
                      type={showRemnaToken ? "text" : "password"}
                      placeholder="eyJhbGciOi..."
                      value={settings?.remnaAdminToken ?? ""}
                      onChange={(e) => setSettings((s) => s ? { ...s, remnaAdminToken: e.target.value || null } : s)}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowRemnaToken(!showRemnaToken)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showRemnaToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Bearer токен администратора из раздела Settings → API Tokens панели Remnawave
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="remna-secret-key">Секретный ключ / Cookie (REMNA_SECRET_KEY)</Label>
                  <div className="relative">
                    <Input
                      id="remna-secret-key"
                      type={showRemnaSecret ? "text" : "password"}
                      placeholder="cookie_name:cookie_value"
                      value={settings?.remnaSecretKey ?? ""}
                      onChange={(e) => setSettings((s) => s ? { ...s, remnaSecretKey: e.target.value || null } : s)}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowRemnaSecret(!showRemnaSecret)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showRemnaSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    eGames reverse-proxy cookie (format: name:value или name=value). Оставьте пустым, если не используется eGames.
                  </p>
                </div>

                {remnaTestResult && (
                  <div className={`rounded-xl border p-3.5 text-sm flex items-start gap-3 ${
                    remnaTestResult.ok
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                      : "border-destructive/30 bg-destructive/10 text-destructive dark:text-destructive-foreground"
                  }`}>
                    {remnaTestResult.ok ? (
                      <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
                    ) : (
                      <AlertCircle className="h-5 w-5 shrink-0 text-destructive mt-0.5" />
                    )}
                    <div className="flex-1">
                      <p className="font-medium">{remnaTestResult.ok ? "Связь установлена" : "Ошибка подключения"}</p>
                      <p className="text-xs mt-0.5 opacity-90">{remnaTestResult.message || remnaTestResult.error}</p>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border">
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={remnaTesting}
                      onClick={handleTestRemna}
                      className="gap-1.5"
                    >
                      {remnaTesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
                      Проверить подключение
                    </Button>
                    {settings?.remnaConfigSource === "database" && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleResetRemna}
                        className="gap-1.5 text-muted-foreground hover:text-destructive"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Сбросить к .env
                      </Button>
                    )}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    disabled={saving}
                    onClick={(e) => {
                      e.preventDefault();
                      handleSubmit(e as unknown as React.FormEvent);
                    }}
                  >
                    {saving ? t("admin.settings.saving") : t("admin.settings.save")}
                  </Button>
                </div>

                <p className="text-xs text-muted-foreground">Смена API не переносит пользователей на другой сервер. Сначала перенесите данные Remnawave с сохранением UUID и сделайте резервную копию. Привязки подписок сохраняются.</p>

              </CardContent>
            </Card>

            {/* Карточка 2: Telegram Bot API */}
            <Card className="overflow-hidden border-border">
              <div className="relative bg-muted p-4 border-b border-border flex items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-bold tracking-tight text-foreground">
                      Telegram Bot API (BOT_TOKEN)
                    </h2>
                    {settings?.botTokenSource === "database" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                        <Check className="h-3 w-3" /> Из панели (БД)
                      </span>
                    ) : settings?.botTokenSource === "env" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2.5 py-0.5 text-xs font-semibold text-blue-600 dark:text-blue-400 border border-blue-500/20">
                        Унаследовано из .env (BOT_TOKEN)
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400 border border-amber-500/20">
                        Не задано
                      </span>
                    )}
                  </div>
                  <p className="text-[12.5px] text-muted-foreground mt-1">
                    Токен Telegram бота от @BotFather для авторизации, уведомлений и работы бота
                  </p>
                </div>
              </div>
              <CardContent className="space-y-4 p-4 sm:p-6">
                <div className="space-y-2">
                  <Label htmlFor="api-telegram-bot-token">Токен бота Telegram</Label>
                  <div className="relative">
                    <Input
                      id="api-telegram-bot-token"
                      type={showBotToken ? "text" : "password"}
                      placeholder="123456:ABC-DEF..."
                      value={settings?.telegramBotToken ?? ""}
                      onChange={(e) => setSettings((s) => s ? { ...s, telegramBotToken: e.target.value || null } : s)}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowBotToken(!showBotToken)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showBotToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    После сохранения замените BOT_TOKEN в .env и выполните docker compose up -d --force-recreate api bot broadcast-worker. До пересоздания контейнера бот использует старый токен.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="api-telegram-bot-username">Юзернейм бота (без @)</Label>
                  <Input
                    id="api-telegram-bot-username"
                    placeholder="MyStealthNetBot"
                    value={settings?.telegramBotUsername ?? ""}
                    onChange={(e) => setSettings((s) => s ? { ...s, telegramBotUsername: e.target.value || null } : s)}
                  />
                </div>

                {botTestResult && (
                  <div className={`rounded-xl border p-3.5 text-sm flex items-start gap-3 ${
                    botTestResult.ok
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                      : "border-destructive/30 bg-destructive/10 text-destructive dark:text-destructive-foreground"
                  }`}>
                    {botTestResult.ok ? (
                      <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
                    ) : (
                      <AlertCircle className="h-5 w-5 shrink-0 text-destructive mt-0.5" />
                    )}
                    <div className="flex-1">
                      <p className="font-medium">{botTestResult.ok ? "Бот проверен" : "Ошибка проверки"}</p>
                      <p className="text-xs mt-0.5 opacity-90">{botTestResult.message || botTestResult.error}</p>
                      {botTestResult.bot?.username && botTestResult.bot.username !== settings?.telegramBotUsername && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mt-2 text-xs h-7"
                          onClick={() => setSettings((s) => s ? { ...s, telegramBotUsername: botTestResult.bot!.username! } : s)}
                        >
                          Применить юзернейм: @{botTestResult.bot.username}
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border">
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={botTesting}
                      onClick={handleTestBot}
                      className="gap-1.5"
                    >
                      {botTesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
                      Проверить бота (getMe)
                    </Button>
                    {settings?.botTokenSource === "database" && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleResetBotToken}
                        className="gap-1.5 text-muted-foreground hover:text-destructive"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Сбросить к .env
                      </Button>
                    )}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    disabled={saving}
                    onClick={(e) => {
                      e.preventDefault();
                      handleSubmit(e as unknown as React.FormEvent);
                    }}
                  >
                    {saving ? t("admin.settings.saving") : t("admin.settings.save")}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <BotWebhookManager token={token} />

            {/* Карточка 3: Публичный адрес */}
            <Card className="overflow-hidden border-border">
              <div className="relative bg-muted p-4 border-b border-border flex items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-bold tracking-tight text-foreground">
                      Публичный адрес панели (PUBLIC_APP_URL / DOMAIN)
                    </h2>
                    {settings?.publicUrlSource === "database" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                        <Check className="h-3 w-3" /> Из панели (БД)
                      </span>
                    ) : settings?.publicUrlSource === "env" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2.5 py-0.5 text-xs font-semibold text-blue-600 dark:text-blue-400 border border-blue-500/20">
                        Унаследовано из .env (DOMAIN)
                      </span>
                    ) : null}
                  </div>
                  <p className="text-[12.5px] text-muted-foreground mt-1">
                    Публичный адрес панели для ссылок, Telegram Mini App, сброса паролей и вебхуков
                  </p>
                </div>
              </div>
              <CardContent className="space-y-4 p-4 sm:p-6">
                <div className="space-y-2">
                  <Label htmlFor="api-public-app-url">Публичный URL панели</Label>
                  <Input
                    id="api-public-app-url"
                    type="url"
                    placeholder="https://panel.example.com"
                    value={settings?.publicAppUrl ?? ""}
                    onChange={(e) => setSettings((s) => s ? { ...s, publicAppUrl: e.target.value || null } : s)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Полный URL панели с протоколом (https://...) без слэша в конце
                  </p>
                </div>
                <div className="flex items-center justify-end pt-2 border-t border-border">
                  <Button
                    type="button"
                    size="sm"
                    disabled={saving}
                    onClick={(e) => {
                      e.preventDefault();
                      handleSubmit(e as unknown as React.FormEvent);
                    }}
                  >
                    {saving ? t("admin.settings.saving") : t("admin.settings.save")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
  );
}
