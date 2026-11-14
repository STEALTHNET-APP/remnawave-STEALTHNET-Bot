import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { Eye } from "lucide-react";
import { MarketplaceSettingsCard } from "@/pages/marketplace/marketplace-settings-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { AdminSettings } from "@/lib/api";

export const FALLBACK_LANGS = ["ru", "en"];
export const LANG_NAMES: Record<string, string> = {
  ru: "Русский",
  en: "English",
  uk: "Українська",
  be: "Беларуская",
  kz: "Қазақша",
  kk: "Қазақша",
  uz: "Oʻzbekcha",
  de: "Deutsch",
  fr: "Français",
  es: "Español",
  pt: "Português",
  it: "Italiano",
  pl: "Polski",
  tr: "Türkçe",
  zh: "中文",
  ja: "日本語",
  ko: "한국어",
  ar: "العربية",
  hi: "हिन्दी",
  fa: "فارسی",
};
export const ALLOWED_CURRENCIES = ["usd", "rub"];

export function GeneralTab({
  settings,
  setSettings,
  saving,
  message,
  installedLangCodes,
  totpEnabled,
  openTwoFaEnable,
  openTwoFaDisable,
}: {
  settings: AdminSettings;
  setSettings: Dispatch<SetStateAction<AdminSettings | null>>;
  saving: boolean;
  message: string;
  installedLangCodes: string[];
  totpEnabled: boolean;
  openTwoFaEnable: () => void;
  openTwoFaDisable: () => void;
}) {
  const { t } = useTranslation();

  return (
          <TabsContent value="general">
            <Card className="overflow-hidden border-border">
              <div className="relative bg-muted p-4 border-b border-border">
                <div className="absolute inset-0 bg-transparent pointer-events-none" />
                <div className="relative flex items-start gap-5">
                  <div className="flex-1 min-w-0">
                    <h2 className="text-xl font-bold tracking-tight text-foreground">
                      {t("admin.settings.general_title")}
                    </h2>
                    <p className="text-[12.5px] text-muted-foreground mt-1">{t("admin.settings.general_subtitle")}</p>
                  </div>
                </div>
              </div>
              <CardContent className="space-y-5 p-4 sm:p-4">
                <div className="rounded-xl border border-border p-4 space-y-3">
                  <Label className="flex items-center justify-between gap-3">Режим технических работ<Switch checked={settings.maintenanceEnabled ?? false} onCheckedChange={value => setSettings(s => s ? { ...s, maintenanceEnabled: value } : s)} /></Label>
                  <p className="text-xs text-muted-foreground">Кабинет и бот временно недоступны клиентам. Админка, уже оплаченные заказы и действующие VPN-подключения продолжают работать.</p>
                  <Label htmlFor="maintenance-message">Сообщение клиентам</Label>
                  <Textarea id="maintenance-message" maxLength={1000} value={settings.maintenanceMessage ?? ""} placeholder="Обновляем сервис. Пожалуйста, зайдите немного позже." onChange={e => setSettings(s => s ? { ...s, maintenanceMessage: e.target.value } : s)} />
                </div>
                {/* === Функции сервиса === */}
                <div className="rounded-xl border border-sky-500/20 bg-muted p-4 space-y-3">
                  <div className="flex items-center gap-2.5">
                    <h3 className="text-base font-semibold">Функции сервиса</h3>
                  </div>
                  <p className="text-xs text-muted-foreground">Включай/выключай ключевые модули клиентского кабинета и админки.</p>
                  <div className="space-y-2">
                    <label className="flex items-start gap-3 p-3.5 rounded-xl bg-card/40 border border-border hover:border-border transition-colors cursor-pointer">
                      <div className="flex-1 min-w-0">
                        <Label htmlFor="tickets-enabled-general" className="text-sm font-medium cursor-pointer">{t("admin.settings.ticket_system")}</Label>
                        <p className="text-xs text-muted-foreground mt-0.5">{t("admin.settings.ticket_hint")}</p>
                      </div>
                      <Switch
                        id="tickets-enabled-general"
                        checked={!!settings.ticketsEnabled}
                        onCheckedChange={(checked: boolean) => setSettings((s) => (s ? { ...s, ticketsEnabled: checked === true } : s))}
                      />
                    </label>
                    <label className="flex items-start gap-3 p-3.5 rounded-xl bg-card/40 border border-border hover:border-border transition-colors cursor-pointer">
                      <div className="flex-1 min-w-0">
                        <Label htmlFor="admin-front-notifications" className="text-sm font-medium cursor-pointer">{t("admin.settings.popup_notifications")}</Label>
                        <p className="text-xs text-muted-foreground mt-0.5">{t("admin.settings.popup_hint")}</p>
                      </div>
                      <Switch
                        id="admin-front-notifications"
                        checked={settings.adminFrontNotificationsEnabled ?? true}
                        onCheckedChange={(checked: boolean) => setSettings((s) => s ? { ...s, adminFrontNotificationsEnabled: checked === true } : s)}
                      />
                    </label>
                    <label className="flex items-start gap-3 p-3.5 rounded-xl bg-card/40 border border-border hover:border-border transition-colors cursor-pointer">
                      <div className="flex-1 min-w-0">
                        <Label htmlFor="ai-chat-enabled" className="text-sm font-medium cursor-pointer">{t("admin.settings.ai_chat_label")}</Label>
                        <p className="text-xs text-muted-foreground mt-0.5">{t("admin.settings.ai_chat_hint")}</p>
                      </div>
                      <Switch
                        id="ai-chat-enabled"
                        checked={settings.aiChatEnabled !== false}
                        onCheckedChange={(checked: boolean) => setSettings((s) => (s ? { ...s, aiChatEnabled: checked === true } : s))}
                      />
                    </label>
                  </div>
                </div>

                {/* === Уведомления в Telegram === */}
                <div className="rounded-xl border border-cyan-500/20 bg-muted p-4 space-y-3">
                  <div className="flex items-center gap-2.5">
                    <h3 className="text-base font-semibold">Уведомления в Telegram-группу</h3>
                  </div>
                  <p className="text-xs text-muted-foreground">Бот шлёт системные уведомления (новые клиенты, оплаты, тикеты, бэкапы) в указанную группу. Если группа без тем — всё в общий чат, иначе можно разрулить по топикам ниже.</p>
                  <div className="space-y-1.5">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">ID группы</Label>
                    <Input
                      value={settings.notificationTelegramGroupId ?? ""}
                      onChange={(e) => setSettings((s) => (s ? { ...s, notificationTelegramGroupId: e.target.value.trim() || null } : s))}
                      placeholder="-1001234567890"
                    />
                    <p className="text-[11px] text-muted-foreground">{t("admin.settings.notification_group_hint")}</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Группа менеджеров (тикеты)</Label>
                    <Input
                      value={settings.notificationManagersGroupId ?? ""}
                      onChange={(e) => setSettings((s) => (s ? { ...s, notificationManagersGroupId: e.target.value.trim() || null } : s))}
                      placeholder="-1001234567890"
                    />
                    <p className="text-[11px] text-muted-foreground">Отдельная группа: сюда дублируются ТОЛЬКО уведомления о новых тикетах (для менеджеров).</p>
                    {settings.notificationManagersGroupId?.trim() && (
                      <div className="pt-1 space-y-1">
                        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Топик тикетов (message_thread_id, необязательно)</Label>
                        <Input
                          value={settings.notificationManagersTopicTickets ?? ""}
                          onChange={(e) => setSettings((s) => (s ? { ...s, notificationManagersTopicTickets: e.target.value.trim() || null } : s))}
                          placeholder="ID топика"
                          className="h-9 text-sm"
                        />
                      </div>
                    )}
                  </div>
                  {settings.notificationTelegramGroupId?.trim() && (
                    <div className="rounded-xl border border-border bg-card/40 p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1 w-6 rounded-full bg-primary" />
                        <p className="text-sm font-medium">{t("admin.settings.topics")}</p>
                      </div>
                      <p className="text-[11px] text-muted-foreground">{t("admin.settings.topics_hint")}</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                        <div className="space-y-1">
                          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("admin.settings.topic_new_clients")}</Label>
                          <Input
                            value={settings.notificationTopicNewClients ?? ""}
                            onChange={(e) => setSettings((s) => (s ? { ...s, notificationTopicNewClients: e.target.value.trim() || null } : s))}
                            placeholder={t("admin.settings.topic_id_placeholder")}
                            className="h-9 text-sm"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("admin.settings.topic_payments")}</Label>
                          <Input
                            value={settings.notificationTopicPayments ?? ""}
                            onChange={(e) => setSettings((s) => (s ? { ...s, notificationTopicPayments: e.target.value.trim() || null } : s))}
                            placeholder={t("admin.settings.topic_id_placeholder")}
                            className="h-9 text-sm"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("admin.settings.topic_tickets")}</Label>
                          <Input
                            value={settings.notificationTopicTickets ?? ""}
                            onChange={(e) => setSettings((s) => (s ? { ...s, notificationTopicTickets: e.target.value.trim() || null } : s))}
                            placeholder={t("admin.settings.topic_id_placeholder")}
                            className="h-9 text-sm"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("admin.settings.topic_backups")}</Label>
                          <Input
                            value={settings.notificationTopicBackups ?? ""}
                            onChange={(e) => setSettings((s) => (s ? { ...s, notificationTopicBackups: e.target.value.trim() || null } : s))}
                            placeholder={t("admin.settings.topic_id_placeholder")}
                            className="h-9 text-sm"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("admin.settings.topic_trials")}</Label>
                          <Input
                            value={settings.notificationTopicTrials ?? ""}
                            onChange={(e) => setSettings((s) => (s ? { ...s, notificationTopicTrials: e.target.value.trim() || null } : s))}
                            placeholder={t("admin.settings.topic_id_placeholder")}
                            className="h-9 text-sm"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("admin.settings.topic_conversions")}</Label>
                          <Input
                            value={settings.notificationTopicConversions ?? ""}
                            onChange={(e) => setSettings((s) => (s ? { ...s, notificationTopicConversions: e.target.value.trim() || null } : s))}
                            placeholder={t("admin.settings.topic_id_placeholder")}
                            className="h-9 text-sm"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("admin.settings.topic_withdrawals")}</Label>
                          <Input
                            value={settings.notificationTopicWithdrawals ?? ""}
                            onChange={(e) => setSettings((s) => (s ? { ...s, notificationTopicWithdrawals: e.target.value.trim() || null } : s))}
                            placeholder={t("admin.settings.topic_id_placeholder")}
                            className="h-9 text-sm"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("admin.settings.topic_promo")}</Label>
                          <Input
                            value={settings.notificationTopicPromo ?? ""}
                            onChange={(e) => setSettings((s) => (s ? { ...s, notificationTopicPromo: e.target.value.trim() || null } : s))}
                            placeholder={t("admin.settings.topic_id_placeholder")}
                            className="h-9 text-sm"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("admin.settings.topic_gifts")}</Label>
                          <Input
                            value={settings.notificationTopicGifts ?? ""}
                            onChange={(e) => setSettings((s) => (s ? { ...s, notificationTopicGifts: e.target.value.trim() || null } : s))}
                            placeholder={t("admin.settings.topic_id_placeholder")}
                            className="h-9 text-sm"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("admin.settings.topic_auto_renew")}</Label>
                          <Input
                            value={settings.notificationTopicAutoRenew ?? ""}
                            onChange={(e) => setSettings((s) => (s ? { ...s, notificationTopicAutoRenew: e.target.value.trim() || null } : s))}
                            placeholder={t("admin.settings.topic_id_placeholder")}
                            className="h-9 text-sm"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                <div className="rounded-xl border border-border bg-muted p-4 space-y-2">
                  <Label className="flex items-center gap-3"><Switch checked={settings.liteMode ?? false} onCheckedChange={checked => setSettings(s => s ? { ...s, liteMode: checked === true } : s)} />Lite-режим кабинета и бота</Label>
                  <p className="text-xs text-muted-foreground">Простой интерфейс: подписки, покупка, продление и подключение. Админка и данные сохраняются. Выключите, чтобы вернуть все разделы.</p>
                </div>
                {/* === Брендинг === */}
                <div className="rounded-xl border border-purple-500/20 bg-muted p-4 space-y-4">
                  <div className="flex items-center gap-2.5">
                    <h3 className="text-base font-semibold">Брендинг</h3>
                  </div>
                  <p className="text-xs text-muted-foreground">Имя сервиса, логотипы, фавикон, публичный URL — всё что видит клиент в кабинете и боте.</p>
                  <div className="space-y-2">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">{t("admin.settings.service_name")}</Label>
                    <Input
                      value={settings.serviceName}
                      onChange={(e) => setSettings((s) => (s ? { ...s, serviceName: e.target.value } : s))}
                    />
                    <p className="text-[11px] text-muted-foreground">{t("admin.settings.service_name_hint")}</p>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">{t("admin.settings.service_description")}</Label>
                    <Textarea
                      value={settings.serviceDescription ?? ""}
                      onChange={(e) => setSettings((s) => (s ? { ...s, serviceDescription: e.target.value || null } : s))}
                      rows={2}
                    />
                    <p className="text-[11px] text-muted-foreground">{t("admin.settings.service_description_hint")}</p>
                  </div>
                <div className="space-y-2">
                  <Label>{t("admin.settings.logo")}</Label>
                  {settings.logo ? (
                    <div className="flex items-center gap-3">
                      <img src={settings.logo} alt={t("admin.settings.logo_alt")} className="h-12 object-contain rounded border" />
                      <div className="flex gap-2">
                        <Label className="cursor-pointer">
                          <span className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground h-9 px-4">{t("admin.settings.upload_another")}</span>
                          <input
                            type="file"
                            accept="image/*"
                            className="sr-only"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (!f) return;
                              const r = new FileReader();
                              r.onload = () => setSettings((s) => (s ? { ...s, logo: r.result as string } : s));
                              r.readAsDataURL(f);
                            }}
                          />
                        </Label>
                        <Button type="button" variant="outline" size="sm" onClick={() => setSettings((s) => (s ? { ...s, logo: null } : s))}>
                          {t("admin.settings.delete")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <Label className="cursor-pointer">
                        <span className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background h-9 px-4 hover:bg-accent">{t("admin.settings.upload_logo")}</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="sr-only"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (!f) return;
                            const r = new FileReader();
                            r.onload = () => setSettings((s) => (s ? { ...s, logo: r.result as string } : s));
                            r.readAsDataURL(f);
                          }}
                        />
                      </Label>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">{t("admin.settings.logo_hint")}</p>
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.settings.bot_logo")}</Label>
                  {settings.logoBot ? (
                    <div className="flex items-center gap-3">
                      <img src={settings.logoBot} alt={t("admin.settings.bot_logo_alt")} className="h-12 object-contain rounded border" />
                      <div className="flex gap-2">
                        <Label className="cursor-pointer">
                          <span className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground h-9 px-4">{t("admin.settings.upload_another")}</span>
                          <input
                            type="file"
                            accept="image/*"
                            className="sr-only"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (!f) return;
                              const r = new FileReader();
                              r.onload = () => setSettings((s) => (s ? { ...s, logoBot: r.result as string } : s));
                              r.readAsDataURL(f);
                            }}
                          />
                        </Label>
                        <Button type="button" variant="outline" size="sm" onClick={() => setSettings((s) => (s ? { ...s, logoBot: null } : s))}>
                          {t("admin.settings.delete")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <Label className="cursor-pointer">
                        <span className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background h-9 px-4 hover:bg-accent">{t("admin.settings.upload_bot_logo")}</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="sr-only"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (!f) return;
                            const r = new FileReader();
                            r.onload = () => setSettings((s) => (s ? { ...s, logoBot: r.result as string } : s));
                            r.readAsDataURL(f);
                          }}
                        />
                      </Label>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">{t("admin.settings.bot_logo_hint")}</p>
                </div>
                <div className="space-y-2">
                  <Label>Мини-апп (Stealth): акцентный цвет</Label>
                  <div className="flex items-center gap-3 flex-wrap">
                    <input
                      type="color"
                      value={settings.stealthAccent || "#ff2357"}
                      onChange={(e) => setSettings((s) => (s ? { ...s, stealthAccent: e.target.value } : s))}
                      className="h-10 w-14 rounded border border-input bg-background cursor-pointer p-1"
                    />
                    <Input
                      value={settings.stealthAccent ?? ""}
                      onChange={(e) => setSettings((s) => (s ? { ...s, stealthAccent: e.target.value || null } : s))}
                      placeholder="#ff2357"
                      className="font-mono w-40"
                    />
                    {settings.stealthAccent && (
                      <Button type="button" variant="outline" size="sm" onClick={() => setSettings((s) => (s ? { ...s, stealthAccent: null } : s))}>Сброс</Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">Перекрашивает весь новый мини-апп (щит, кнопки, активные вкладки, акценты). Пусто = стандартный красный.</p>
                </div>
                <div className="space-y-2">
                  <Label>Мини-апп (Stealth): картинка вместо щита</Label>
                  {settings.stealthHeroImage ? (
                    <div className="flex items-center gap-3">
                      <img src={settings.stealthHeroImage} alt="hero" className="h-9 w-9 object-contain rounded border bg-black/40 p-1" />
                      <div className="flex gap-2">
                        <Label className="cursor-pointer">
                          <span className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground h-9 px-4">{t("admin.settings.upload_another")}</span>
                          <input type="file" accept="image/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => setSettings((s) => (s ? { ...s, stealthHeroImage: r.result as string } : s)); r.readAsDataURL(f); }} />
                        </Label>
                        <Button type="button" variant="outline" size="sm" onClick={() => setSettings((s) => (s ? { ...s, stealthHeroImage: null } : s))}>{t("admin.settings.delete")}</Button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <Label className="cursor-pointer">
                        <span className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background h-9 px-4 hover:bg-accent">Загрузить картинку</span>
                        <input type="file" accept="image/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => setSettings((s) => (s ? { ...s, stealthHeroImage: r.result as string } : s)); r.readAsDataURL(f); }} />
                      </Label>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">PNG/SVG с прозрачным фоном. Заменяет иконку-щит в шапке мини-аппа. Пусто = стандартный щит.</p>
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.settings.favicon")}</Label>
                  {settings.favicon ? (
                    <div className="flex items-center gap-3">
                      <img src={settings.favicon} alt="Favicon" className="h-8 w-8 object-contain rounded border" />
                      <div className="flex gap-2">
                        <Label className="cursor-pointer">
                          <span className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground h-9 px-4">{t("admin.settings.upload_another")}</span>
                          <input
                            type="file"
                            accept="image/*"
                            className="sr-only"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (!f) return;
                              const r = new FileReader();
                              r.onload = () => setSettings((s) => (s ? { ...s, favicon: r.result as string } : s));
                              r.readAsDataURL(f);
                            }}
                          />
                        </Label>
                        <Button type="button" variant="outline" size="sm" onClick={() => setSettings((s) => (s ? { ...s, favicon: null } : s))}>
                          {t("admin.settings.delete")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <Label className="cursor-pointer">
                        <span className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background h-9 px-4 hover:bg-accent">{t("admin.settings.upload_favicon")}</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="sr-only"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (!f) return;
                            const r = new FileReader();
                            r.onload = () => setSettings((s) => (s ? { ...s, favicon: r.result as string } : s));
                            r.readAsDataURL(f);
                          }}
                        />
                      </Label>
                      <p className="text-xs text-muted-foreground mt-1">{t("admin.settings.favicon_hint")}</p>
                    </div>
                  )}
                </div>

                {/* Баннер для превью ссылки (OG Image) */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>{t("admin.settings.og_image")}</Label>
                    {!settings.ogImage && (settings.favicon || settings.logo) && (
                      <span className="text-[11px] text-muted-foreground bg-muted/60 px-2 py-0.5 rounded-full border border-border/50">
                        {settings.favicon ? "Используется фавикон" : "Используется логотип"}
                      </span>
                    )}
                  </div>
                  {settings.ogImage ? (
                    <div className="flex items-center gap-3">
                      <img
                        src={settings.ogImage}
                        alt={t("admin.settings.og_image_alt")}
                        className="h-16 w-28 object-cover rounded-lg border bg-black/20"
                      />
                      <div className="flex gap-2 flex-wrap">
                        <Label className="cursor-pointer">
                          <span className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground h-9 px-4 hover:bg-primary/90 transition-colors">
                            {t("admin.settings.upload_another")}
                          </span>
                          <input
                            type="file"
                            accept="image/*"
                            className="sr-only"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (!f) return;
                              const r = new FileReader();
                              r.onload = () => setSettings((s) => (s ? { ...s, ogImage: r.result as string } : s));
                              r.readAsDataURL(f);
                            }}
                          />
                        </Label>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setSettings((s) => (s ? { ...s, ogImage: null } : s))}
                        >
                          {t("admin.settings.reset_to_favicon")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center gap-3">
                        {(settings.favicon || settings.logo) && (
                          <img
                            src={settings.favicon || settings.logo || ""}
                            alt="Current fallback"
                            className="h-10 w-10 object-contain rounded border bg-black/10 p-1 opacity-70"
                            title="Текущее изображение по умолчанию"
                          />
                        )}
                        <Label className="cursor-pointer">
                          <span className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background h-9 px-4 hover:bg-accent transition-colors">
                            {t("admin.settings.upload_og_image")}
                          </span>
                          <input
                            type="file"
                            accept="image/*"
                            className="sr-only"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (!f) return;
                              const r = new FileReader();
                              r.onload = () => setSettings((s) => (s ? { ...s, ogImage: r.result as string } : s));
                              r.readAsDataURL(f);
                            }}
                          />
                        </Label>
                      </div>
                      <p className="text-xs text-muted-foreground">{t("admin.settings.og_image_hint")}</p>
                    </div>
                  )}
                </div>

                {/* Интерактивное превью ссылки в Telegram */}
                <div className="space-y-2 rounded-xl border border-sky-500/20 bg-sky-500/5 p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Eye className="h-4 w-4 text-sky-400" />
                      <Label className="text-xs font-semibold uppercase tracking-wider text-sky-300">
                        {t("admin.settings.telegram_preview_title")}
                      </Label>
                    </div>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      Telegram Web / Desktop
                    </span>
                  </div>

                  {/* Карточка-сообщение Telegram */}
                  <div className="rounded-lg bg-card/80 border border-border/80 p-3 max-w-md shadow-sm">
                    <div className="flex gap-3 border-l-2 border-sky-500 pl-3">
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="text-[11px] font-medium text-sky-400 truncate">
                          {(() => {
                            try {
                              if (settings.publicAppUrl) {
                                return new URL(settings.publicAppUrl).host;
                              }
                            } catch {
                              /* ignore */
                            }
                            return typeof window !== "undefined" ? window.location.host : "example.com";
                          })()}
                        </div>
                        <div className="text-sm font-semibold text-foreground leading-tight line-clamp-1">
                          {settings.serviceName?.trim() || "STEALTHNET"}
                        </div>
                        <div className="text-xs text-muted-foreground leading-snug line-clamp-2">
                          {settings.serviceDescription?.trim() ||
                            (settings.serviceName?.trim()
                              ? `${settings.serviceName.trim()} — сервис для быстрого и безопасного доступа к интернету`
                              : "Личный кабинет и админка VPN на базе Remnawave")}
                        </div>
                      </div>
                      {/* Миниатюра превью */}
                      <div className="shrink-0">
                        {settings.ogImage || settings.favicon || settings.logo ? (
                          <img
                            src={settings.ogImage || settings.favicon || settings.logo || ""}
                            alt="Preview thumbnail"
                            className="h-14 w-14 rounded object-cover border bg-black/20"
                          />
                        ) : (
                          <div className="h-14 w-14 rounded border border-dashed border-muted-foreground/30 flex items-center justify-center bg-muted/40 text-[10px] text-muted-foreground text-center p-1">
                            PNG 512×512
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 pt-1">
                    <span>💡</span>
                    <span>
                      {t("admin.settings.telegram_cache_hint")}{" "}
                      <a
                        href="https://t.me/WebpageBot"
                        target="_blank"
                        rel="noreferrer"
                        className="text-sky-400 underline underline-offset-2 hover:text-sky-300"
                      >
                        @WebpageBot
                      </a>
                    </span>
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>{t("admin.settings.app_url")}</Label>
                  <Input
                    value={settings.publicAppUrl ?? ""}
                    onChange={(e) => setSettings((s) => (s ? { ...s, publicAppUrl: e.target.value || null } : s))}
                    placeholder="https://example.com"
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("admin.settings.app_url_hint")}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Дизайн клиентского Mini App</Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {([
                      { v: "modern", title: "Новый кабинет", desc: "Новый интерфейс: компактные подписки, тарифы, баланс и поддержка. Оформление настраивается в редакторе кабинета.", swatch: "bg-muted" },
                      { v: "classic", title: "Classic", desc: "Совместимый вариант стандартного кабинета", swatch: "bg-muted" },
                      { v: "stealth", title: "Stealth", desc: "Тёмный неон с red-акцентом, network-фоном и stadium-кнопками", swatch: "bg-muted" },
                      { v: "aurora", title: "Aurora", desc: "Мини-апп: градиентная карточка подписки, все разделы кабинета и плавающее меню из 5 вкладок", swatch: "bg-muted" },
                    ] as const).map((d) => {
                      const active = (settings.cabinetDesign ?? "classic") === d.v;
                      return (
                        <button
                          key={d.v}
                          type="button"
                          onClick={() => setSettings((s) => (s ? { ...s, cabinetDesign: d.v } : s))}
                          className={`relative overflow-hidden rounded-xl border p-4 text-left transition-all ${active ? "border-primary ring-2 ring-primary/30 bg-primary/5" : "border-border hover:border-border bg-card/40"}`}
                        >
                          <div className={`absolute inset-x-0 top-0 h-1  ${d.swatch}`} />
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-base font-semibold tracking-tight">{d.title}</span>
                            {active && <span className="text-[10px] font-bold uppercase tracking-widest bg-primary text-primary-foreground rounded-md px-1.5 py-0.5">Активно</span>}
                          </div>
                          <p className="text-xs text-muted-foreground leading-relaxed">{d.desc}</p>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Выбранный дизайн применится ко всем клиентам при следующем открытии кабинета. Админ-панель не затрагивается.
                  </p>
                  <label className="flex items-start gap-3 rounded-xl border border-border bg-card/30 p-3 mt-2 cursor-pointer hover:bg-card/50 transition-colors">
                    <Switch
                      checked={settings.cabinetDesignApplyInBrowser ?? false}
                      onCheckedChange={(checked: boolean) => setSettings((s) => (s ? { ...s, cabinetDesignApplyInBrowser: checked === true } : s))}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">Применять также в обычном браузере</div>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                        По умолчанию выбранный дизайн используется только в Telegram Mini App. В обычном браузере (web кабинет) клиенты видят новый стандартный кабинет.
                        Включите, чтобы выбранный вариант применялся и на сайте.
                      </p>
                    </div>
                  </label>
                </div>
                </div>
                {/* === Локализация === */}
                <div className="rounded-xl border border-amber-500/20 bg-muted p-4 space-y-4">
                  <div className="flex items-center gap-2.5">
                    <h3 className="text-base font-semibold">Локализация</h3>
                  </div>
                  <p className="text-xs text-muted-foreground">Языки и валюты, доступные клиенту. Звёздочка  — язык/валюта по умолчанию для новых пользователей.</p>
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">{t("admin.settings.languages")}</Label>
                  <div className="flex flex-wrap gap-2">
                    {(() => {
                      const preset = installedLangCodes.length ? installedLangCodes : FALLBACK_LANGS;
                      const defaultLang = (settings.defaultLanguage && preset.includes(settings.defaultLanguage) ? settings.defaultLanguage : preset[0]) ?? "";
                      return preset.map((lang) => {
                        const isActive = settings.activeLanguages.includes(lang);
                        const isDefault = lang === defaultLang;
                        const displayName = LANG_NAMES[lang] ?? lang.toUpperCase();
                        return (
                          <Button
                            key={lang}
                            type="button"
                            variant={isActive ? "default" : "outline"}
                            size="sm"
                            title={displayName}
                            onClick={() =>
                              setSettings((s) => {
                                if (!s) return s;
                                const next = isActive
                                  ? s.activeLanguages.filter((x) => x !== lang)
                                  : [...s.activeLanguages, lang].filter((x) => preset.includes(x)).sort();
                                const defaultLang = (s.defaultLanguage && next.includes(s.defaultLanguage) ? s.defaultLanguage : next[0]) ?? "";
                                return { ...s, activeLanguages: next, defaultLanguage: defaultLang };
                              })
                            }
                          >
                            {lang.toUpperCase()}
                            {isActive && isDefault && " "}
                          </Button>
                        );
                      });
                    })()}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("admin.settings.languages_hint", "Список языков формируется из раздела «Языки». Добавьте пакет там, чтобы включить новый язык здесь.")}
                  </p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Label className="text-xs text-muted-foreground">{t("admin.settings.default_language")}</Label>
                    <select
                      className="rounded-md border border-input bg-background px-2 py-1 text-sm"
                      value={(() => {
                        const active = settings.activeLanguages.length ? settings.activeLanguages : installedLangCodes;
                        return (settings.defaultLanguage && active.includes(settings.defaultLanguage) ? settings.defaultLanguage : active[0]) ?? "";
                      })()}
                      onChange={(e) => setSettings((s) => s ? { ...s, defaultLanguage: e.target.value } : s)}
                    >
                      {(settings.activeLanguages.length ? settings.activeLanguages : installedLangCodes).map((l) => (
                        <option key={l} value={l}>{(LANG_NAMES[l] ?? l.toUpperCase())} ({l})</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.settings.currencies")}</Label>
                  <div className="flex flex-wrap gap-2">
                    {(() => {
                      const preset = ["usd", "rub"];
                      const defaultCurr = (settings.defaultCurrency && preset.includes(settings.defaultCurrency) ? settings.defaultCurrency : preset[0]) ?? "";
                      return preset.map((curr) => {
                        const isActive = settings.activeCurrencies.includes(curr);
                        const isDefault = curr === defaultCurr;
                        return (
                          <Button
                            key={curr}
                            type="button"
                            variant={isActive ? "default" : "outline"}
                            size="sm"
                            onClick={() =>
                              setSettings((s) => {
                                if (!s) return s;
                                const next = isActive
                                  ? s.activeCurrencies.filter((x) => x !== curr)
                                  : [...s.activeCurrencies, curr].filter((x) => preset.includes(x)).sort();
                                const defaultCurr = (s.defaultCurrency && next.includes(s.defaultCurrency) ? s.defaultCurrency : next[0]) ?? "";
                                return { ...s, activeCurrencies: next, defaultCurrency: defaultCurr };
                              })
                            }
                          >
                            {curr.toUpperCase()}
                            {isActive && isDefault && " "}
                          </Button>
                        );
                      });
                    })()}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Label className="text-xs text-muted-foreground">{t("admin.settings.default_currency")}</Label>
                    <select
                      className="rounded-md border border-input bg-background px-2 py-1 text-sm"
                      value={(settings.defaultCurrency && ALLOWED_CURRENCIES.includes(settings.defaultCurrency) ? settings.defaultCurrency : ALLOWED_CURRENCIES[0]) ?? ""}
                      onChange={(e) => setSettings((s) => s ? { ...s, defaultCurrency: e.target.value } : s)}
                    >
                      {ALLOWED_CURRENCIES.map((c) => (
                        <option key={c} value={c}>{c.toUpperCase()}</option>
                      ))}
                    </select>
                  </div>
                </div>
                </div>
                {/* === Безопасность === */}
                <div className="rounded-xl border border-rose-500/20 bg-muted p-4 space-y-4">
                  <div className="flex items-center gap-2.5">
                    <h3 className="text-base font-semibold">{t("admin.settings.security")}</h3>
                  </div>
                  <p className="text-xs text-muted-foreground">{t("admin.settings.2fa_hint")}</p>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-muted/40 border">
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground mb-0.5">2FA</p>
                        <p className="font-medium text-sm truncate">{t("admin.settings.2fa_multi_level")}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {totpEnabled ? (
                        <>
                          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-green-500/20 text-green-700 dark:text-green-400">{t("admin.settings.2fa_enabled")}</span>
                          <Button type="button" variant="outline" size="sm" className="border-red-500/50 text-red-600 hover:bg-red-500/15 dark:text-red-400 dark:hover:bg-red-500/20" onClick={openTwoFaDisable}>{t("admin.settings.2fa_disable")}</Button>
                        </>
                      ) : (
                        <Button type="button" variant="outline" size="sm" onClick={openTwoFaEnable}>{t("admin.settings.2fa_enable")}</Button>
                      )}
                    </div>
                  </div>
                </div>

                {message && <p className="text-sm text-muted-foreground">{message}</p>}
                <Button type="submit" disabled={saving}>
                  {saving ? t("admin.settings.saving") : t("admin.settings.save")}
                </Button>
              </CardContent>
            </Card>
            <MarketplaceSettingsCard />
          </TabsContent>
  );
}
