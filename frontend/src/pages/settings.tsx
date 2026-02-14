import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth";
import { api, type AdminSettings, type SyncResult, type SyncToRemnaResult, type SyncCreateRemnaForMissingResult, type SubscriptionPageConfig } from "@/lib/api";
import { SubscriptionPageEditor } from "@/components/subscription-page-editor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RefreshCw, Download, Upload, Link2, Settings2, Gift, Users, ArrowLeftRight, Mail, MessageCircle, CreditCard, ChevronDown, Copy, Check, Bot, FileJson, Palette, Wallet } from "lucide-react";
import { ACCENT_PALETTES } from "@/contexts/theme";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

const ALLOWED_LANGS = ["ru", "ua", "en"];
const ALLOWED_CURRENCIES = ["usd", "uah", "rub"];

const DEFAULT_PLATEGA_METHODS: { id: number; enabled: boolean; label: string }[] = [
  { id: 2, enabled: true, label: "СПБ" },
  { id: 11, enabled: false, label: "Карты" },
  { id: 12, enabled: false, label: "Международный" },
  { id: 13, enabled: false, label: "Криптовалюта" },
];

type BotButtonItem = { id: string; visible: boolean; label: string; order: number; style?: string; emojiKey?: string };
const DEFAULT_BOT_BUTTONS: BotButtonItem[] = [
  { id: "tariffs", visible: true, label: "📦 Тарифы", order: 0, style: "success", emojiKey: "PACKAGE" },
  { id: "profile", visible: true, label: "👤 Профиль", order: 1, style: "", emojiKey: "PUZZLE" },
  { id: "topup", visible: true, label: "💳 Пополнить баланс", order: 2, style: "success", emojiKey: "CARD" },
  { id: "referral", visible: true, label: "👥 Реферальная программа", order: 3, style: "primary", emojiKey: "LINK" },
  { id: "trial", visible: true, label: "🎁 Попробовать бесплатно", order: 4, style: "success", emojiKey: "TRIAL" },
  { id: "vpn", visible: true, label: "🌐 Подключиться к VPN", order: 5, style: "danger", emojiKey: "SERVERS" },
  { id: "cabinet", visible: true, label: "🌐 Web Кабинет", order: 6, style: "primary", emojiKey: "SERVERS" },
  { id: "support", visible: true, label: "🆘 Поддержка", order: 7, style: "primary", emojiKey: "NOTE" },
  { id: "promocode", visible: true, label: "🎟️ Промокод", order: 8, style: "primary", emojiKey: "STAR" },
];

const BOT_EMOJI_KEYS = ["HEADER", "MAIN_MENU", "STATUS", "BALANCE", "TARIFFS", "PACKAGE", "PROFILE", "CARD", "TRIAL", "LINK", "SERVERS", "BACK", "PUZZLE", "DATE", "TIME", "TRAFFIC", "ACTIVE_GREEN", "ACTIVE_YELLOW", "INACTIVE", "CONNECT", "NOTE", "STAR", "CROWN", "DURATION", "DEVICES", "LOCATION", "CUSTOM_1", "CUSTOM_2", "CUSTOM_3", "CUSTOM_4", "CUSTOM_5"] as const;

const DEFAULT_BOT_MENU_TEXTS: Record<string, string> = {
  welcomeTitlePrefix: "🛡 ",
  welcomeGreeting: "👋 Добро пожаловать в ",
  balancePrefix: "💰 Баланс: ",
  tariffPrefix: "💎 Ваш тариф : ",
  subscriptionPrefix: "📊 Статус подписки — ",
  statusInactive: "🔴 Истекла",
  statusActive: "🟡 Активна",
  statusExpired: "🔴 Истекла",
  statusLimited: "🟡 Ограничена",
  statusDisabled: "🔴 Отключена",
  expirePrefix: "📅 до ",
  daysLeftPrefix: "⏰ осталось ",
  devicesLabel: "📱 Устройств: ",
  devicesAvailable: " доступно",
  trafficPrefix: "📈 Трафик — ",
  linkLabel: "🔗 Ссылка подключения:",
  chooseAction: "Выберите действие:",
};

/** Все ключи стилей внутренних кнопок и их дефолты — при изменении одного не терять остальные */
const DEFAULT_BOT_INNER_STYLES: Record<string, string> = {
  tariffPay: "success",
  topup: "primary",
  back: "danger",
  profile: "primary",
  trialConfirm: "success",
  lang: "primary",
  currency: "primary",
};

const BOT_MENU_TEXT_LABELS: Record<string, string> = {
  welcomeTitlePrefix: "Заголовок (префикс перед названием)",
  welcomeGreeting: "Приветствие",
  balancePrefix: "Подпись баланса",
  tariffPrefix: "Подпись тарифа (Ваш тариф : …)",
  subscriptionPrefix: "Подпись статуса подписки",
  statusInactive: "Статус: не активна",
  statusActive: "Статус: активна",
  statusExpired: "Статус: истекла",
  statusLimited: "Статус: ограничена",
  statusDisabled: "Статус: отключена",
  expirePrefix: "Подпись даты окончания",
  daysLeftPrefix: "Подпись «осталось дней»",
  devicesLabel: "Подпись устройств",
  devicesAvailable: "Суффикс «доступно»",
  trafficPrefix: "Подпись трафика",
  linkLabel: "Подпись ссылки подключения",
  chooseAction: "Призыв к действию",
};

export function SettingsPage() {
  const { state } = useAuth();
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [syncLoading, setSyncLoading] = useState<"from" | "to" | "missing" | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [squads, setSquads] = useState<{ uuid: string; name?: string }[]>([]);
  const [activeTab, setActiveTab] = useState("general");
  const [plategaCallbackCopied, setPlategaCallbackCopied] = useState(false);
  const [defaultSubpageConfig, setDefaultSubpageConfig] = useState<SubscriptionPageConfig | null>(null);
  const token = state.accessToken!;

  useEffect(() => {
    api.getSettings(token).then((data) => {
      setSettings({
        ...data,
        activeLanguages: (data.activeLanguages || []).filter((l: string) => ALLOWED_LANGS.includes(l)),
        activeCurrencies: (data.activeCurrencies || []).filter((c: string) => ALLOWED_CURRENCIES.includes(c)),
        defaultReferralPercent: data.defaultReferralPercent ?? 30,
        referralPercentLevel2: (data as AdminSettings).referralPercentLevel2 ?? 10,
        referralPercentLevel3: (data as AdminSettings).referralPercentLevel3 ?? 10,
        plategaMethods: (data as AdminSettings).plategaMethods ?? DEFAULT_PLATEGA_METHODS,
        botButtons: (() => {
          const raw = (data as AdminSettings).botButtons;
          const loaded = Array.isArray(raw) ? raw : [];
          return DEFAULT_BOT_BUTTONS.map((def) => {
            const fromApi = loaded.find((b: { id: string }) => b.id === def.id);
            return fromApi ? { ...def, ...fromApi } : def;
          }) as BotButtonItem[];
        })(),
        botEmojis: (data as AdminSettings).botEmojis ?? {},
        botBackLabel: (data as AdminSettings).botBackLabel ?? "◀️ В меню",
        botMenuTexts: { ...DEFAULT_BOT_MENU_TEXTS, ...((data as AdminSettings).botMenuTexts ?? {}) },
        botInnerButtonStyles: (() => {
          const raw = (data as AdminSettings).botInnerButtonStyles;
          const loaded =
            raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, string>) : {};
          return { ...DEFAULT_BOT_INNER_STYLES, ...loaded };
        })(),
        subscriptionPageConfig: (data as AdminSettings).subscriptionPageConfig ?? null,
        supportLink: (data as AdminSettings).supportLink ?? "",
        agreementLink: (data as AdminSettings).agreementLink ?? "",
        offerLink: (data as AdminSettings).offerLink ?? "",
        instructionsLink: (data as AdminSettings).instructionsLink ?? "",
      });
    }).finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    if (activeTab === "subpage") {
      api.getDefaultSubscriptionPageConfig(token).then((c) => setDefaultSubpageConfig(c ?? null)).catch(() => setDefaultSubpageConfig(null));
    }
  }, [token, activeTab]);

  useEffect(() => {
    api.getRemnaSquadsInternal(token).then((raw: unknown) => {
      const res = raw as { response?: { internalSquads?: { uuid: string; name?: string }[] } };
      const items = res?.response?.internalSquads ?? (Array.isArray(res) ? res : []);
      setSquads(Array.isArray(items) ? items : []);
    }).catch(() => setSquads([]));
  }, [token]);

  async function handleSyncFromRemna() {
    setSyncLoading("from");
    setSyncMessage(null);
    try {
      const r: SyncResult = await api.syncFromRemna(token);
      setSyncMessage(
        r.ok
          ? `Из Remna: создано ${r.created}, обновлено ${r.updated}, пропущено ${r.skipped}`
          : `Ошибки: ${r.errors.join("; ")}`
      );
    } catch (e) {
      setSyncMessage(e instanceof Error ? e.message : "Ошибка синхронизации");
    } finally {
      setSyncLoading(null);
    }
  }

  async function handleSyncToRemna() {
    setSyncLoading("to");
    setSyncMessage(null);
    try {
      const r: SyncToRemnaResult = await api.syncToRemna(token);
      setSyncMessage(
        r.ok ? `В Remna обновлено: ${r.updated}` : `Ошибки: ${r.errors.join("; ")}`
      );
    } catch (e) {
      setSyncMessage(e instanceof Error ? e.message : "Ошибка синхронизации");
    } finally {
      setSyncLoading(null);
    }
  }

  async function handleSyncCreateRemnaForMissing() {
    setSyncLoading("missing");
    setSyncMessage(null);
    try {
      const r: SyncCreateRemnaForMissingResult = await api.syncCreateRemnaForMissing(token);
      setSyncMessage(
        r.ok
          ? `Привязано: создано в Remna ${r.created}, привязано существующих ${r.linked}`
          : `Ошибки: ${r.errors.join("; ")}`
      );
    } catch (e) {
      setSyncMessage(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setSyncLoading(null);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!settings) return;
    setSaving(true);
    setMessage("");
    const langs = Array.isArray(settings.activeLanguages) ? settings.activeLanguages.filter((l) => ALLOWED_LANGS.includes(l)) : ALLOWED_LANGS;
    const currs = Array.isArray(settings.activeCurrencies) ? settings.activeCurrencies.filter((c) => ALLOWED_CURRENCIES.includes(c)) : ALLOWED_CURRENCIES;
    const defaultLang = (settings.defaultLanguage && ALLOWED_LANGS.includes(settings.defaultLanguage) ? settings.defaultLanguage : langs[0]) ?? "ru";
    const defaultCurr = (settings.defaultCurrency && ALLOWED_CURRENCIES.includes(settings.defaultCurrency) ? settings.defaultCurrency : currs[0]) ?? "usd";
    api
      .updateSettings(token, {
        activeLanguages: langs.length ? langs.join(",") : ALLOWED_LANGS.join(","),
        activeCurrencies: currs.length ? currs.join(",") : ALLOWED_CURRENCIES.join(","),
        defaultLanguage: defaultLang,
        defaultCurrency: defaultCurr,
        defaultReferralPercent: settings.defaultReferralPercent,
        referralPercentLevel2: settings.referralPercentLevel2 ?? 10,
        referralPercentLevel3: settings.referralPercentLevel3 ?? 10,
        trialDays: settings.trialDays,
        trialSquadUuid: settings.trialSquadUuid ?? null,
        trialDeviceLimit: settings.trialDeviceLimit ?? null,
        trialTrafficLimitBytes: settings.trialTrafficLimitBytes ?? null,
        serviceName: settings.serviceName,
        logo: settings.logo ?? null,
        favicon: settings.favicon ?? null,
        remnaClientUrl: settings.remnaClientUrl ?? null,
        smtpHost: settings.smtpHost ?? null,
        smtpPort: settings.smtpPort ?? undefined,
        smtpSecure: settings.smtpSecure ?? undefined,
        smtpUser: settings.smtpUser ?? null,
        smtpPassword: settings.smtpPassword && settings.smtpPassword !== "********" ? settings.smtpPassword : undefined,
        smtpFromEmail: settings.smtpFromEmail ?? null,
        smtpFromName: settings.smtpFromName ?? null,
        publicAppUrl: settings.publicAppUrl ?? null,
        telegramBotToken: settings.telegramBotToken ?? null,
        telegramBotUsername: settings.telegramBotUsername ?? null,
        plategaMerchantId: settings.plategaMerchantId ?? null,
        plategaSecret: settings.plategaSecret && settings.plategaSecret !== "********" ? settings.plategaSecret : undefined,
        plategaMethods: settings.plategaMethods != null ? JSON.stringify(settings.plategaMethods) : undefined,
        yoomoneyClientId: settings.yoomoneyClientId ?? null,
        yoomoneyClientSecret: settings.yoomoneyClientSecret && settings.yoomoneyClientSecret !== "********" ? settings.yoomoneyClientSecret : undefined,
        yoomoneyReceiverWallet: settings.yoomoneyReceiverWallet ?? null,
        yoomoneyNotificationSecret: settings.yoomoneyNotificationSecret && settings.yoomoneyNotificationSecret !== "********" ? settings.yoomoneyNotificationSecret : undefined,
        botButtons: settings.botButtons != null ? JSON.stringify(settings.botButtons) : undefined,
        botEmojis: settings.botEmojis != null ? settings.botEmojis : undefined,
        botBackLabel: settings.botBackLabel ?? null,
        botMenuTexts: settings.botMenuTexts != null ? JSON.stringify(settings.botMenuTexts) : undefined,
        botInnerButtonStyles: JSON.stringify({
          ...DEFAULT_BOT_INNER_STYLES,
          ...(settings.botInnerButtonStyles ?? {}),
        }),
        subscriptionPageConfig: settings.subscriptionPageConfig ?? undefined,
        supportLink: settings.supportLink ?? undefined,
        agreementLink: settings.agreementLink ?? undefined,
        offerLink: settings.offerLink ?? undefined,
        instructionsLink: settings.instructionsLink ?? undefined,
        themeAccent: settings.themeAccent ?? "default",
        forceSubscribeEnabled: settings.forceSubscribeEnabled ?? false,
        forceSubscribeChannelId: settings.forceSubscribeChannelId ?? null,
        forceSubscribeMessage: settings.forceSubscribeMessage ?? null,
      })
      .then((updated) => {
        const u = updated as AdminSettings;
        setSettings({
          ...u,
          botInnerButtonStyles: {
            ...DEFAULT_BOT_INNER_STYLES,
            ...(settings.botInnerButtonStyles ?? {}),
          },
        });
        setMessage("Сохранено");
      })
      .catch(() => setMessage("Ошибка"))
      .finally(() => setSaving(false));
  }

  if (loading) return <div className="text-muted-foreground">Загрузка…</div>;
  if (!settings) return <div className="text-destructive">Ошибка загрузки</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Настройки</h1>
        <p className="text-muted-foreground">Языки, валюты, триал и параметры для бота, Mini App и сайта</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full grid grid-cols-2 sm:grid-cols-9 gap-2 p-2 h-auto bg-muted/50 rounded-2xl border shadow-sm">
          <TabsTrigger value="general" className="gap-2 py-3 px-4 rounded-xl">
            <Settings2 className="h-4 w-4 shrink-0" />
            Общие
          </TabsTrigger>
          <TabsTrigger value="trial" className="gap-2 py-3 px-4 rounded-xl">
            <Gift className="h-4 w-4 shrink-0" />
            Триал
          </TabsTrigger>
          <TabsTrigger value="referral" className="gap-2 py-3 px-4 rounded-xl">
            <Users className="h-4 w-4 shrink-0" />
            Рефералы
          </TabsTrigger>
          <TabsTrigger value="payments" className="gap-2 py-3 px-4 rounded-xl">
            <CreditCard className="h-4 w-4 shrink-0" />
            Платежи
          </TabsTrigger>
          <TabsTrigger value="bot" className="gap-2 py-3 px-4 rounded-xl">
            <Bot className="h-4 w-4 shrink-0" />
            Бот
          </TabsTrigger>
          <TabsTrigger value="mail-telegram" className="gap-2 py-3 px-4 rounded-xl">
            <Mail className="h-4 w-4 shrink-0" />
            Почта и Telegram
          </TabsTrigger>
          <TabsTrigger value="subpage" className="gap-2 py-3 px-4 rounded-xl">
            <FileJson className="h-4 w-4 shrink-0" />
            Страница подписки
          </TabsTrigger>
          <TabsTrigger value="theme" className="gap-2 py-3 px-4 rounded-xl">
            <Palette className="h-4 w-4 shrink-0" />
            Тема
          </TabsTrigger>
          <TabsTrigger value="sync" className="gap-2 py-3 px-4 rounded-xl">
            <ArrowLeftRight className="h-4 w-4 shrink-0" />
            Синхронизация
          </TabsTrigger>
        </TabsList>

        <form onSubmit={handleSubmit}>
          <TabsContent value="general">
            <Card>
              <CardHeader>
                <CardTitle>Общие</CardTitle>
                <p className="text-sm text-muted-foreground">Название, логотип, языки и валюты</p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Название сервиса</Label>
                  <Input
                    value={settings.serviceName}
                    onChange={(e) => setSettings((s) => (s ? { ...s, serviceName: e.target.value } : s))}
                  />
                  <p className="text-xs text-muted-foreground">Отображается в шапке админки и в кабинете клиента</p>
                </div>
                <div className="space-y-2">
                  <Label>Логотип</Label>
                  {settings.logo ? (
                    <div className="flex items-center gap-3">
                      <img src={settings.logo} alt="Логотип" className="h-12 object-contain rounded border" />
                      <div className="flex gap-2">
                        <Label className="cursor-pointer">
                          <span className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground h-9 px-4">Загрузить другой</span>
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
                          Удалить
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <Label className="cursor-pointer">
                        <span className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background h-9 px-4 hover:bg-accent">Загрузить логотип</span>
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
                </div>
                <div className="space-y-2">
                  <Label>Favicon</Label>
                  {settings.favicon ? (
                    <div className="flex items-center gap-3">
                      <img src={settings.favicon} alt="Favicon" className="h-8 w-8 object-contain rounded border" />
                      <div className="flex gap-2">
                        <Label className="cursor-pointer">
                          <span className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground h-9 px-4">Загрузить другой</span>
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
                          Удалить
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <Label className="cursor-pointer">
                        <span className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background h-9 px-4 hover:bg-accent">Загрузить favicon</span>
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
                      <p className="text-xs text-muted-foreground mt-1">Рекомендуется 32×32 или 64×64 (PNG/SVG)</p>
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>URL приложения (ссылка на сайт)</Label>
                  <Input
                    value={settings.publicAppUrl ?? ""}
                    onChange={(e) => setSettings((s) => (s ? { ...s, publicAppUrl: e.target.value || null } : s))}
                    placeholder="https://example.com"
                  />
                  <p className="text-xs text-muted-foreground">
                    Без слэша в конце. От него генерируются ссылка подтверждения в письме, редиректы после оплаты и callback Platega.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Языки</Label>
                  <div className="flex flex-wrap gap-2">
                    {(() => {
                      const preset = ["ru", "ua", "en"];
                      const defaultLang = (settings.defaultLanguage && preset.includes(settings.defaultLanguage) ? settings.defaultLanguage : preset[0]) ?? "";
                      return preset.map((lang) => {
                        const isActive = settings.activeLanguages.includes(lang);
                        const isDefault = lang === defaultLang;
                        return (
                          <Button
                            key={lang}
                            type="button"
                            variant={isActive ? "default" : "outline"}
                            size="sm"
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
                            {isActive && isDefault && " ★"}
                          </Button>
                        );
                      });
                    })()}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Label className="text-xs text-muted-foreground">Основной язык:</Label>
                    <select
                      className="rounded-md border border-input bg-background px-2 py-1 text-sm"
                      value={(settings.defaultLanguage && ALLOWED_LANGS.includes(settings.defaultLanguage) ? settings.defaultLanguage : ALLOWED_LANGS[0]) ?? ""}
                      onChange={(e) => setSettings((s) => s ? { ...s, defaultLanguage: e.target.value } : s)}
                    >
                      {ALLOWED_LANGS.map((l) => (
                        <option key={l} value={l}>{l.toUpperCase()}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Валюты</Label>
                  <div className="flex flex-wrap gap-2">
                    {(() => {
                      const preset = ["usd", "uah", "rub"];
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
                            {isActive && isDefault && " ★"}
                          </Button>
                        );
                      });
                    })()}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Label className="text-xs text-muted-foreground">Основная валюта:</Label>
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
                {message && <p className="text-sm text-muted-foreground">{message}</p>}
                <Button type="submit" disabled={saving}>
                  {saving ? "Сохранение…" : "Сохранить"}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="bot">
            <Card>
              <CardHeader>
                <CardTitle>Настройки бота</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Порядок, видимость и подписи кнопок главного меню Telegram-бота. Кнопка «В меню» показывается на экранах тарифов, профиля и пополнения.
                </p>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label>Кнопка «В меню»</Label>
                  <Input
                    value={settings.botBackLabel ?? "◀️ В меню"}
                    onChange={(e) => setSettings((s) => (s ? { ...s, botBackLabel: e.target.value || "◀️ В меню" } : s))}
                    placeholder="◀️ В меню"
                  />
                  <p className="text-xs text-muted-foreground">Текст кнопки возврата в главное меню</p>
                </div>
                <div className="space-y-3 rounded-lg border p-4 bg-muted/20">
                  <div className="flex items-center gap-2">
                    <MessageCircle className="h-4 w-4 text-primary" />
                    <Label className="text-base font-medium">Поддержка</Label>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Ссылки для кнопки «Поддержка» в боте. Внутри — 4 подпункта: Тех поддержка, Соглашения, Оферта, Инструкции. Если ссылка не задана — соответствующий пункт не показывается. Кнопка «Поддержка» в главном меню отображается только если заполнен хотя бы один пункт.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-1">
                    <div className="space-y-1">
                      <Label className="text-xs">Тех поддержка (бот или контакт)</Label>
                      <Input
                        value={settings.supportLink ?? ""}
                        onChange={(e) => setSettings((s) => (s ? { ...s, supportLink: e.target.value || undefined } : s))}
                        placeholder="https://t.me/support_bot или tg://user?id=..."
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Соглашения (Telegraph и т.д.)</Label>
                      <Input
                        value={settings.agreementLink ?? ""}
                        onChange={(e) => setSettings((s) => (s ? { ...s, agreementLink: e.target.value || undefined } : s))}
                        placeholder="https://telegra.ph/..."
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Оферта</Label>
                      <Input
                        value={settings.offerLink ?? ""}
                        onChange={(e) => setSettings((s) => (s ? { ...s, offerLink: e.target.value || undefined } : s))}
                        placeholder="https://telegra.ph/..."
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Инструкции</Label>
                      <Input
                        value={settings.instructionsLink ?? ""}
                        onChange={(e) => setSettings((s) => (s ? { ...s, instructionsLink: e.target.value || undefined } : s))}
                        placeholder="https://telegra.ph/..."
                      />
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Эмодзи (текст и кнопки)</Label>
                  <p className="text-xs text-muted-foreground mb-2">
                    Меняйте Unicode и TG ID (премиум) для каждого ключа — они подставятся в кнопки меню и в текст сообщений (если в «Тексты меню» используются плейсхолдеры вроде {'{{BALANCE}}'}). Аналог EMOJI_* / EMOJI_*_TG_ID из remnawave env.
                  </p>
                  <p className="text-xs text-amber-600 dark:text-amber-400 mb-2 rounded-md bg-amber-50 dark:bg-amber-950/40 p-2 border border-amber-200 dark:border-amber-800">
                    Премиум-эмодзи (TG ID) отображаются только если владелец бота имеет Telegram Premium (аккаунт, создавший бота в @BotFather). Иначе в кнопках и тексте будет виден только Unicode.
                  </p>
                  <div className="rounded-lg border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/50 border-b">
                          <th className="text-left py-2 px-3 font-medium">Ключ</th>
                          <th className="text-left py-2 px-3 font-medium w-24">Unicode</th>
                          <th className="text-left py-2 px-3 font-medium">TG ID (премиум)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {BOT_EMOJI_KEYS.map((key) => {
                          const raw = (settings.botEmojis ?? {})[key];
                          const entry = typeof raw === "object" && raw !== null ? raw : { unicode: typeof raw === "string" ? raw : undefined, tgEmojiId: undefined };
                          return (
                            <tr key={key} className="border-b border-border/50 hover:bg-muted/20">
                              <td className="py-1.5 px-3 font-medium">{key}</td>
                              <td className="py-1.5 px-2">
                                <Input
                                  className="h-8 w-20 p-1 text-center text-base"
                                  value={entry.unicode ?? ""}
                                  onChange={(e) =>
                                    setSettings((s) => {
                                      if (!s) return s;
                                      const prev = (s.botEmojis ?? {})[key];
                                      const prevObj = typeof prev === "object" && prev !== null ? prev : { unicode: typeof prev === "string" ? prev : undefined, tgEmojiId: undefined };
                                      return {
                                        ...s,
                                        botEmojis: {
                                          ...(s.botEmojis ?? {}),
                                          [key]: { ...prevObj, unicode: e.target.value || undefined },
                                        },
                                      };
                                    })
                                  }
                                  placeholder="📦"
                                />
                              </td>
                              <td className="py-1.5 px-2">
                                <Input
                                  className="h-8 min-w-0 text-xs"
                                  value={entry.tgEmojiId ?? ""}
                                  onChange={(e) =>
                                    setSettings((s) => {
                                      if (!s) return s;
                                      const prev = (s.botEmojis ?? {})[key];
                                      const prevObj = typeof prev === "object" && prev !== null ? prev : { unicode: typeof prev === "string" ? prev : undefined, tgEmojiId: undefined };
                                      return {
                                        ...s,
                                        botEmojis: {
                                          ...(s.botEmojis ?? {}),
                                          [key]: { ...prevObj, tgEmojiId: e.target.value || undefined },
                                        },
                                      };
                                    })
                                  }
                                  placeholder="5289722755871162900"
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Кнопки главного меню</Label>
                  <p className="text-xs text-muted-foreground mb-3">
                    Отметьте видимость, измените текст, выберите эмодзи по ключу (из блока выше), задайте порядок. Стиль: primary / success / danger или пусто.
                  </p>
                  <div className="space-y-3">
                    {[...(settings.botButtons ?? DEFAULT_BOT_BUTTONS)]
                      .sort((a, b) => a.order - b.order)
                      .map((btn, idx) => (
                        <div key={btn.id} className="flex flex-wrap items-center gap-3 p-3 rounded-lg border bg-muted/30">
                          <Checkbox
                            checked={btn.visible}
                            onCheckedChange={(checked) =>
                              setSettings((s) => {
                                if (!s?.botButtons) return s;
                                return {
                                  ...s,
                                  botButtons: s.botButtons.map((b) =>
                                    b.id === btn.id ? { ...b, visible: checked === true } : b
                                  ),
                                };
                              })
                            }
                          />
                          <Input
                            className="w-32 flex-shrink-0"
                            type="number"
                            min={0}
                            value={btn.order}
                            onChange={(e) =>
                              setSettings((s) => {
                                if (!s?.botButtons) return s;
                                const v = parseInt(e.target.value, 10);
                                if (!Number.isFinite(v)) return s;
                                return {
                                  ...s,
                                  botButtons: s.botButtons.map((b) =>
                                    b.id === btn.id ? { ...b, order: v } : b
                                  ),
                                };
                              })
                            }
                          />
                          <span className="text-xs text-muted-foreground w-8">{idx + 1}</span>
                          <Input
                            className="flex-1 min-w-[140px]"
                            value={btn.label}
                            onChange={(e) =>
                              setSettings((s) => {
                                if (!s?.botButtons) return s;
                                return {
                                  ...s,
                                  botButtons: s.botButtons.map((b) =>
                                    b.id === btn.id ? { ...b, label: e.target.value } : b
                                  ),
                                };
                              })
                            }
                            placeholder="Текст кнопки"
                          />
                          <select
                            className="flex h-9 w-28 rounded-md border border-input bg-background px-2 py-1 text-sm"
                            value={btn.emojiKey ?? ""}
                            onChange={(e) =>
                              setSettings((s) => {
                                if (!s?.botButtons) return s;
                                return {
                                  ...s,
                                  botButtons: s.botButtons.map((b) =>
                                    b.id === btn.id ? { ...b, emojiKey: e.target.value || undefined } : b
                                  ),
                                };
                              })
                            }
                          >
                            <option value="">— без эмодзи —</option>
                            {BOT_EMOJI_KEYS.map((k) => (
                              <option key={k} value={k}>{k}</option>
                            ))}
                          </select>
                          <select
                            className="flex h-9 w-24 rounded-md border border-input bg-background px-2 py-1 text-sm"
                            value={btn.style ?? ""}
                            onChange={(e) =>
                              setSettings((s) => {
                                if (!s?.botButtons) return s;
                                return {
                                  ...s,
                                  botButtons: s.botButtons.map((b) =>
                                    b.id === btn.id ? { ...b, style: e.target.value } : b
                                  ),
                                };
                              })
                            }
                          >
                            <option value="">—</option>
                            <option value="primary">primary</option>
                            <option value="success">success</option>
                            <option value="danger">danger</option>
                          </select>
                          <span className="text-xs text-muted-foreground capitalize">{btn.id}</span>
                        </div>
                      ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Стили внутренних кнопок бота</Label>
                  <p className="text-xs text-muted-foreground mb-2">
                    Цвет кнопок внутри разделов: тарифы, пополнение, «Назад», профиль, триал, язык, валюта. Значения: primary / success / danger или пусто.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {[
                      { key: "tariffPay", label: "Кнопки тарифов (оплата)" },
                      { key: "topup", label: "Кнопки сумм пополнения" },
                      { key: "back", label: "Кнопка «Назад» / «В меню»" },
                      { key: "profile", label: "Кнопки в профиле (язык, валюта)" },
                      { key: "trialConfirm", label: "Кнопка «Активировать триал»" },
                      { key: "lang", label: "Выбор языка" },
                      { key: "currency", label: "Выбор валюты" },
                    ].map(({ key, label }) => (
                      <div key={key} className="flex items-center gap-2">
                        <span className="text-sm w-48 shrink-0">{label}</span>
                        <select
                          className="flex h-9 flex-1 max-w-[120px] rounded-md border border-input bg-background px-2 py-1 text-sm"
                          value={(settings.botInnerButtonStyles ?? {})[key] ?? ""}
                          onChange={(e) =>
                            setSettings((s) => {
                              if (!s) return s;
                              const next = { ...DEFAULT_BOT_INNER_STYLES, ...(s.botInnerButtonStyles ?? {}), [key]: e.target.value };
                              return { ...s, botInnerButtonStyles: next };
                            })
                          }
                        >
                          <option value="">—</option>
                          <option value="primary">primary</option>
                          <option value="success">success</option>
                          <option value="danger">danger</option>
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
                <Collapsible>
                  <CollapsibleTrigger asChild>
                    <Button type="button" variant="outline" className="w-full justify-between">
                      Тексты приветствия и главного меню
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="pt-3 space-y-3 border-t mt-3">
                      <p className="text-xs text-muted-foreground">
                        Подписи и фразы главного меню бота. Чтобы подставлять эмодзи из блока «Эмодзи (текст и кнопки)», используйте плейсхолдеры: <code className="rounded bg-muted px-1">{'{{BALANCE}}'}</code>, <code className="rounded bg-muted px-1">{'{{STATUS}}'}</code>, <code className="rounded bg-muted px-1">{'{{TRIAL}}'}</code>, <code className="rounded bg-muted px-1">{'{{LINK}}'}</code>, <code className="rounded bg-muted px-1">{'{{DATE}}'}</code>, <code className="rounded bg-muted px-1">{'{{TRAFFIC}}'}</code> и др. (ключи как в списке эмодзи выше). Unicode подставится автоматически; TG ID используется для премиум-эмодзи в кнопках.
                      </p>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => setSettings((s) => (s ? { ...s, botMenuTexts: { ...DEFAULT_BOT_MENU_TEXTS } } : s))}
                      >
                        Сбросить тексты к стандарту
                      </Button>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {Object.keys(DEFAULT_BOT_MENU_TEXTS).map((key) => (
                          <div key={key} className="space-y-1">
                            <Label className="text-xs">{BOT_MENU_TEXT_LABELS[key] ?? key}</Label>
                            <Input
                              value={settings.botMenuTexts?.[key] ?? DEFAULT_BOT_MENU_TEXTS[key] ?? ""}
                              onChange={(e) =>
                                setSettings((s) =>
                                  s
                                    ? {
                                        ...s,
                                        botMenuTexts: {
                                          ...(s.botMenuTexts ?? DEFAULT_BOT_MENU_TEXTS),
                                          [key]: e.target.value,
                                        },
                                      }
                                    : s
                                )
                              }
                              placeholder={DEFAULT_BOT_MENU_TEXTS[key]}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
                <div className="space-y-3 rounded-lg border p-4 bg-muted/20">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-primary" />
                    <Label className="text-base font-medium">Принудительная подписка на канал</Label>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Если включено — пользователь не сможет пользоваться ботом, пока не подпишется на указанный канал/группу. Бот должен быть администратором канала/группы.
                  </p>
                  <div className="flex items-center gap-3">
                    <Checkbox
                      checked={!!settings.forceSubscribeEnabled}
                      onCheckedChange={(checked) =>
                        setSettings((s) => (s ? { ...s, forceSubscribeEnabled: checked === true } : s))
                      }
                    />
                    <Label className="text-sm">Включить проверку подписки</Label>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">ID или @username канала/группы</Label>
                    <Input
                      value={settings.forceSubscribeChannelId ?? ""}
                      onChange={(e) => setSettings((s) => (s ? { ...s, forceSubscribeChannelId: e.target.value || null } : s))}
                      placeholder="@channelname или -1001234567890"
                    />
                    <p className="text-xs text-muted-foreground">Укажите @username (например @my_channel) или числовой ID канала/группы.</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Сообщение для неподписанных</Label>
                    <Input
                      value={settings.forceSubscribeMessage ?? ""}
                      onChange={(e) => setSettings((s) => (s ? { ...s, forceSubscribeMessage: e.target.value || null } : s))}
                      placeholder="Для использования бота подпишитесь на наш канал"
                    />
                    <p className="text-xs text-muted-foreground">Текст, который увидит пользователь. Если пусто — будет использован текст по умолчанию.</p>
                  </div>
                </div>
                {message && <p className="text-sm text-muted-foreground">{message}</p>}
                <Button type="submit" disabled={saving}>
                  {saving ? "Сохранение…" : "Сохранить"}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="trial">
            <Card>
              <CardHeader>
                <CardTitle>Триал</CardTitle>
                <p className="text-sm text-muted-foreground">Параметры пробного периода для новых пользователей</p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Дней триала</Label>
                  <Input
                    type="number"
                    min={0}
                    value={settings.trialDays}
                    onChange={(e) =>
                      setSettings((s) => (s ? { ...s, trialDays: parseInt(e.target.value, 10) || 0 } : s))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Сквад для триала (Remna)</Label>
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                    value={settings.trialSquadUuid ?? ""}
                    onChange={(e) => setSettings((s) => s ? { ...s, trialSquadUuid: e.target.value || null } : s)}
                  >
                    <option value="">— не выбран</option>
                    {squads.map((s) => (
                      <option key={s.uuid} value={s.uuid}>{s.name || s.uuid}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>Лимит устройств триала (HWID)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={settings.trialDeviceLimit ?? ""}
                    onChange={(e) =>
                      setSettings((s) => (s ? { ...s, trialDeviceLimit: e.target.value === "" ? null : parseInt(e.target.value, 10) || 0 } : s))
                    }
                    placeholder="— без лимита"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Лимит трафика триала (ГБ)</Label>
                  <Input
                    type="number"
                    min={0}
                    step={0.1}
                    value={settings.trialTrafficLimitBytes != null ? (settings.trialTrafficLimitBytes / 1e9).toFixed(1) : ""}
                    onChange={(e) => {
                      const v = e.target.value.trim();
                      if (v === "") {
                        setSettings((s) => (s ? { ...s, trialTrafficLimitBytes: null } : s));
                        return;
                      }
                      const n = parseFloat(v);
                      if (Number.isNaN(n)) return;
                      setSettings((s) => (s ? { ...s, trialTrafficLimitBytes: Math.round(n * 1e9) } : s));
                    }}
                    placeholder="— без лимита"
                  />
                </div>
                {message && <p className="text-sm text-muted-foreground">{message}</p>}
                <Button type="submit" disabled={saving}>
                  {saving ? "Сохранение…" : "Сохранить"}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="subpage">
            <Card>
              <CardHeader>
                <CardTitle>Страница подписки (приложения по платформам)</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Визуальный редактор: включите или отключите приложения для iOS, Android, macOS, Windows, Linux и измените порядок перетаскиванием. За основу берётся базовый конфиг (subpage-00000000-0000-0000-0000-000000000000.json).
                </p>
              </CardHeader>
              <CardContent>
                <SubscriptionPageEditor
                  currentConfigJson={settings?.subscriptionPageConfig ?? null}
                  defaultConfig={defaultSubpageConfig}
                  onFetchDefault={async () => {
                    const c = await api.getDefaultSubscriptionPageConfig(token);
                    setDefaultSubpageConfig(c ?? null);
                    return c ?? null;
                  }}
                  saving={saving}
                  onSave={async (configJson) => {
                    setSettings((s) => (s ? { ...s, subscriptionPageConfig: configJson } : s));
                    setSaving(true);
                    setMessage("");
                    try {
                      await api.updateSettings(token, { subscriptionPageConfig: configJson });
                      setMessage("Сохранено");
                    } catch {
                      setMessage("Ошибка сохранения");
                    } finally {
                      setSaving(false);
                    }
                  }}
                />
                {message && <p className="text-sm text-muted-foreground mt-4">{message}</p>}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="referral">
            <Card>
              <CardHeader>
                <CardTitle>Рефералы</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Проценты от пополнений по уровням: 1 — приглашённые вами; 2 — приглашённые вашими рефералами; 3 — приглашённые рефералами 2 уровня.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>1 уровень (%) — от пополнений приглашённых вами</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={settings.defaultReferralPercent ?? 30}
                    onChange={(e) =>
                      setSettings((s) => (s ? { ...s, defaultReferralPercent: Number(e.target.value) || 0 } : s))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>2 уровень (%) — от пополнений рефералов 1 уровня</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={settings.referralPercentLevel2 ?? 10}
                    onChange={(e) =>
                      setSettings((s) => (s ? { ...s, referralPercentLevel2: Number(e.target.value) || 0 } : s))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>3 уровень (%) — от пополнений рефералов 2 уровня</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={settings.referralPercentLevel3 ?? 10}
                    onChange={(e) =>
                      setSettings((s) => (s ? { ...s, referralPercentLevel3: Number(e.target.value) || 0 } : s))
                    }
                  />
                </div>
                {message && <p className="text-sm text-muted-foreground">{message}</p>}
                <Button type="submit" disabled={saving}>
                  {saving ? "Сохранение…" : "Сохранить"}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="payments">
            <Card>
              <Collapsible defaultOpen={false} className="group">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="w-full cursor-pointer rounded-t-lg text-left transition-colors hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  >
                    <CardHeader className="pointer-events-none [&_.chevron]:transition-transform [&_.chevron]:duration-200 group-data-[state=open]:[&_.chevron]:rotate-180">
                      <div className="flex items-center justify-between pr-2">
                        <div className="flex items-center gap-2">
                          <CreditCard className="h-5 w-5 text-primary" />
                          <CardTitle>Platega</CardTitle>
                          <span className="text-xs font-normal text-muted-foreground">— нажмите, чтобы развернуть настройки</span>
                        </div>
                        <ChevronDown className="chevron h-5 w-5 shrink-0 text-muted-foreground" />
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        Callback URL настраивается ниже (с доменом из настроек)
                      </p>
                    </CardHeader>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="space-y-4 border-t pt-4">
                    <div className="space-y-2">
                      <Label>Callback URL для Platega</Label>
                      <div className="flex gap-2">
                        <Input
                          readOnly
                          value={(settings.publicAppUrl ?? "").replace(/\/$/, "") ? `${(settings.publicAppUrl ?? "").replace(/\/$/, "")}/api/webhooks/platega` : "Укажите «URL приложения» во вкладке «Общие»"}
                          className="font-mono text-sm bg-muted/50"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="shrink-0"
                          onClick={async () => {
                            const url = (settings.publicAppUrl ?? "").replace(/\/$/, "") ? `${(settings.publicAppUrl ?? "").replace(/\/$/, "")}/api/webhooks/platega` : "";
                            if (url && navigator.clipboard) {
                              await navigator.clipboard.writeText(url);
                              setPlategaCallbackCopied(true);
                              setTimeout(() => setPlategaCallbackCopied(false), 2000);
                            }
                          }}
                          disabled={!(settings.publicAppUrl ?? "").trim()}
                          title="Копировать"
                        >
                          {plategaCallbackCopied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">Используется «URL приложения» из вкладки «Общие». Укажите его там и вставьте этот callback в ЛК Platega.</p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Merchant ID (X-MerchantId)</Label>
                        <Input
                          value={settings.plategaMerchantId ?? ""}
                          onChange={(e) => setSettings((s) => (s ? { ...s, plategaMerchantId: e.target.value || null } : s))}
                          placeholder="UUID из ЛК Platega"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Секрет (X-Secret)</Label>
                        <Input
                          type="password"
                          value={settings.plategaSecret ?? ""}
                          onChange={(e) => setSettings((s) => (s ? { ...s, plategaSecret: e.target.value || null } : s))}
                          placeholder="API ключ из ЛК Platega"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Методы оплаты</Label>
                      <p className="text-xs text-muted-foreground">Включите нужные и задайте подпись на кнопке для клиентов</p>
                      <div className="rounded-md border divide-y">
                        {(settings.plategaMethods ?? DEFAULT_PLATEGA_METHODS).map((m) => (
                          <div key={m.id} className="flex items-center gap-4 p-3">
                            <Checkbox
                              id={`platega-method-${m.id}`}
                              checked={m.enabled}
                              onCheckedChange={(checked) =>
                                setSettings((s) =>
                                  s
                                    ? {
                                        ...s,
                                        plategaMethods: (s.plategaMethods ?? DEFAULT_PLATEGA_METHODS).map((x) =>
                                          x.id === m.id ? { ...x, enabled: checked === true } : x
                                        ),
                                      }
                                    : s
                                )
                              }
                            />
                            <Label htmlFor={`platega-method-${m.id}`} className="shrink-0 w-8 cursor-pointer">
                              {m.id}
                            </Label>
                            <Input
                              className="flex-1"
                              value={m.label}
                              onChange={(e) =>
                                setSettings((s) =>
                                  s
                                    ? {
                                        ...s,
                                        plategaMethods: (s.plategaMethods ?? DEFAULT_PLATEGA_METHODS).map((x) =>
                                          x.id === m.id ? { ...x, label: e.target.value } : x
                                        ),
                                      }
                                    : s
                                )
                              }
                              placeholder="Подпись на кнопке"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                    {message && <p className="text-sm text-muted-foreground">{message}</p>}
                    <Button type="submit" disabled={saving}>
                      {saving ? "Сохранение…" : "Сохранить"}
                    </Button>
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>

              <Collapsible defaultOpen={false} className="group mt-4">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="w-full cursor-pointer rounded-t-lg text-left transition-colors hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  >
                    <CardHeader className="pointer-events-none [&_.chevron]:transition-transform [&_.chevron]:duration-200 group-data-[state=open]:[&_.chevron]:rotate-180">
                      <div className="flex items-center justify-between pr-2">
                        <div className="flex items-center gap-2">
                          <Wallet className="h-5 w-5 text-primary" />
                          <CardTitle>ЮMoney</CardTitle>
                          <span className="text-xs font-normal text-muted-foreground">— оплата картой</span>
                        </div>
                        <ChevronDown className="chevron h-5 w-5 shrink-0 text-muted-foreground" />
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        Регистрация: <a href="https://yoomoney.ru/myservices/new" target="_blank" rel="noreferrer" className="text-primary underline">yoomoney.ru/myservices/new</a>. URL вебхука: <code className="text-xs bg-muted px-1 rounded">{settings.publicAppUrl ? `${String(settings.publicAppUrl).replace(/\/$/, "")}/api/webhooks/yoomoney` : "—"}</code>
                      </p>
                    </CardHeader>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="space-y-4 border-t pt-4">
                    <p className="text-sm text-muted-foreground">
                      Пополнение баланса только через оплату картой (форма ЮMoney). Укажите кошелёк для приёма и секрет вебхука.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2 sm:col-span-2">
                        <Label>Номер кошелька для приёма</Label>
                        <Input
                          value={settings.yoomoneyReceiverWallet ?? ""}
                          onChange={(e) => setSettings((s) => (s ? { ...s, yoomoneyReceiverWallet: e.target.value || null } : s))}
                          placeholder="41001123456789"
                        />
                        <p className="text-xs text-muted-foreground">Средства зачисляются на этот кошелёк при пополнении через ЮMoney.</p>
                      </div>
                      <div className="space-y-2 sm:col-span-2">
                        <Label>Секрет для вебхука (HTTP-уведомления)</Label>
                        <Input
                          type="password"
                          value={settings.yoomoneyNotificationSecret ?? ""}
                          onChange={(e) => setSettings((s) => (s ? { ...s, yoomoneyNotificationSecret: e.target.value || null } : s))}
                          placeholder="Из настроек кошелька ЮMoney → Уведомления"
                        />
                        <p className="text-xs text-muted-foreground">Задаётся в <a href="https://yoomoney.ru/transfer/myservices/http-notification" target="_blank" rel="noreferrer" className="text-primary underline">настройках HTTP-уведомлений</a> кошелька.</p>
                      </div>
                    </div>
                    <div className="pt-2 border-t">
                      <Button type="submit" disabled={saving} className="min-w-[140px]">
                        {saving ? "Сохранение…" : "Сохранить"}
                      </Button>
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          </TabsContent>

          <TabsContent value="mail-telegram">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Mail className="h-5 w-5" />
                  SMTP (письма подтверждения регистрации)
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Настройки почтового сервера для отправки ссылки подтверждения при регистрации по email.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Хост SMTP</Label>
                    <Input
                      value={settings.smtpHost ?? ""}
                      onChange={(e) => setSettings((s) => (s ? { ...s, smtpHost: e.target.value || null } : s))}
                      placeholder="smtp.example.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Порт</Label>
                    <Input
                      type="number"
                      min={1}
                      max={65535}
                      value={settings.smtpPort ?? 587}
                      onChange={(e) => setSettings((s) => (s ? { ...s, smtpPort: parseInt(e.target.value, 10) || 587 } : s))}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="smtpSecure"
                    checked={settings.smtpSecure ?? false}
                    onChange={(e) => setSettings((s) => (s ? { ...s, smtpSecure: e.target.checked } : s))}
                    className="rounded border"
                  />
                  <Label htmlFor="smtpSecure">SSL/TLS (secure)</Label>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Пользователь SMTP</Label>
                    <Input
                      value={settings.smtpUser ?? ""}
                      onChange={(e) => setSettings((s) => (s ? { ...s, smtpUser: e.target.value || null } : s))}
                      placeholder="user@example.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Пароль (оставьте пустым, чтобы не менять)</Label>
                    <Input
                      type="password"
                      value={settings.smtpPassword ?? ""}
                      onChange={(e) => setSettings((s) => (s ? { ...s, smtpPassword: e.target.value || null } : s))}
                      placeholder="********"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>От кого (email)</Label>
                    <Input
                      type="email"
                      value={settings.smtpFromEmail ?? ""}
                      onChange={(e) => setSettings((s) => (s ? { ...s, smtpFromEmail: e.target.value || null } : s))}
                      placeholder="noreply@example.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Имя отправителя</Label>
                    <Input
                      value={settings.smtpFromName ?? ""}
                      onChange={(e) => setSettings((s) => (s ? { ...s, smtpFromName: e.target.value || null } : s))}
                      placeholder="Название сервиса"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="mt-6">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MessageCircle className="h-5 w-5" />
                  Telegram
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Бот для входа и регистрации через Telegram. Укажите username бота (без @) — кнопка «Войти через Telegram» появится на страницах входа и регистрации.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Токен бота (BotFather)</Label>
                  <Input
                    type="password"
                    value={settings.telegramBotToken ?? ""}
                    onChange={(e) => setSettings((s) => (s ? { ...s, telegramBotToken: e.target.value || null } : s))}
                    placeholder="123456:ABC-DEF..."
                  />
                </div>
                <div className="space-y-2">
                  <Label>Username бота (без @)</Label>
                  <Input
                    value={settings.telegramBotUsername ?? ""}
                    onChange={(e) => setSettings((s) => (s ? { ...s, telegramBotUsername: e.target.value || null } : s))}
                    placeholder="MyStealthNetBot"
                  />
                </div>
                {message && <p className="text-sm text-muted-foreground">{message}</p>}
                <Button type="submit" disabled={saving}>
                  {saving ? "Сохранение…" : "Сохранить"}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </form>

        <TabsContent value="theme">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Palette className="h-5 w-5" />
                Глобальная тема
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Выберите цветовую тему, которая будет применена ко всему сайту: админке, кабинету клиента и мини-апп.
                Переключатель тёмная/светлая всегда доступен в шапке.
              </p>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <Label className="text-sm font-medium mb-3 block">Цветовой акцент</Label>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
                  {(Object.entries(ACCENT_PALETTES) as [string, { label: string; swatch: string }][]).map(([key, palette]) => {
                    const selected = (settings.themeAccent ?? "default") === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setSettings({ ...settings, themeAccent: key })}
                        className={`flex flex-col items-center gap-2 rounded-xl p-3 text-xs font-medium transition-all border-2 ${
                          selected
                            ? "border-primary bg-primary/10 shadow-sm"
                            : "border-transparent hover:bg-muted/50"
                        }`}
                      >
                        <div
                          className="h-10 w-10 rounded-full shadow-sm"
                          style={{ backgroundColor: palette.swatch }}
                        />
                        <span className={selected ? "text-primary" : "text-muted-foreground"}>
                          {palette.label}
                        </span>
                        {selected && (
                          <Check className="h-3 w-3 text-primary" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="pt-2">
                {message && <p className="text-sm text-muted-foreground mb-2">{message}</p>}
                <Button
                  onClick={() => {
                    setSaving(true);
                    setMessage("");
                    api.updateSettings(token, { themeAccent: settings.themeAccent ?? "default" })
                      .then(() => setMessage("Тема сохранена"))
                      .catch(() => setMessage("Ошибка сохранения"))
                      .finally(() => setSaving(false));
                  }}
                  disabled={saving}
                >
                  {saving ? "Сохранение…" : "Сохранить тему"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sync">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <RefreshCw className="h-5 w-5" />
                Синхронизация с Remna
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Загрузить пользователей из Remna в панель, отправить данные в Remna или привязать клиентов без Remna (создать им учётки в Remna).
              </p>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                onClick={handleSyncFromRemna}
                disabled={syncLoading !== null}
              >
                <Download className="h-4 w-4 mr-2" />
                {syncLoading === "from" ? "Синхронизация…" : "Из Remna → панель"}
              </Button>
              <Button
                variant="outline"
                onClick={handleSyncToRemna}
                disabled={syncLoading !== null}
              >
                <Upload className="h-4 w-4 mr-2" />
                {syncLoading === "to" ? "Синхронизация…" : "Панель → в Remna"}
              </Button>
              <Button
                variant="outline"
                onClick={handleSyncCreateRemnaForMissing}
                disabled={syncLoading !== null}
              >
                <Link2 className="h-4 w-4 mr-2" />
                {syncLoading === "missing" ? "Выполняется…" : "Привязать клиентов без Remna"}
              </Button>
              {syncMessage && (
                <span className="text-sm text-muted-foreground">{syncMessage}</span>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
