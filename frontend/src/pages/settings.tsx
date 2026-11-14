import { NalogTab } from "@/components/admin/settings/tabs/nalog-tab";
import { isBotButtonUrl } from "@/lib/bot-button-url";
import { SettingsNavigation, SETTINGS_TABS } from "@/components/admin/settings-navigation";
import { BotButtonItem, BotTab, DEFAULT_BOT_BUTTONS, DEFAULT_BOT_INNER_STYLES, DEFAULT_BOT_MENU_LINE_VISIBILITY, DEFAULT_BOT_MENU_TEXTS, DEFAULT_BOT_PAYMENT_TEXT, DEFAULT_BOT_TARIFF_FIELDS, DEFAULT_BOT_TARIFFS_TEXT } from "@/components/admin/settings/tabs/bot-tab";
import { DEFAULT_PLATEGA_METHODS, PaymentsTab } from "@/components/admin/settings/tabs/payments-tab";
import { useSearchParams } from "react-router-dom";
import { PanelUpdates } from "@/components/admin/panel-updates";
import { useEffect, useState } from "react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { qk } from "@/lib/query-client";
import { useAdminSettings, useSshConfig, useAutoRenewStats, useLanguages, useRemnaSquadsInternal, useAdminSubscriptionPageConfig, useRemnaStatus } from "@/lib/admin-queries";
import { useAdminUi } from "@/lib/admin-stores";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/auth";
import { api, type AdminSettings, type SshConfig, type UpdateSettingsPayload } from "@/lib/api";
import { SubscriptionPageEditor } from "@/components/subscription-page-editor";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Download, Upload, Link2, ChevronDown, Check, Plus, Trash2, KeyRound, Loader2, Sparkles, Globe, Plug, RefreshCw } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ACCENT_PALETTES } from "@/contexts/theme";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ConsoleAccessCard } from "@/components/console-access-card";
import { RouletteAdminTab } from "@/components/roulette/roulette-admin-tab";
import { ALLOWED_CURRENCIES, FALLBACK_LANGS, GeneralTab } from "@/components/admin/settings/tabs/general-tab";
import { MailTelegramTab } from "@/components/admin/settings/tabs/mail-telegram-tab";
import { ApiTab } from "@/components/admin/settings/tabs/api-tab";
import { ReferralsTab } from "@/components/admin/settings/tabs/referrals-tab";
import { GiftsTab } from "@/components/admin/settings/tabs/gifts-tab";

const DEFAULT_GROQ_MODELS = [
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "qwen/qwen3.8-27b",
];
const ENTERPRISE_GROQ_MODELS = [
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
];

export function SettingsPage() {
  const { t } = useTranslation();
  const { state, updateAdmin } = useAuth();
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [remnaTesting, setRemnaTesting] = useState(false);
  const [remnaTestResult, setRemnaTestResult] = useState<{ ok: boolean; status?: number; latencyMs?: number; message?: string; error?: string } | null>(null);
  const [botTesting, setBotTesting] = useState(false);
  const [botTestResult, setBotTestResult] = useState<{ ok: boolean; latencyMs?: number; bot?: { id?: number; firstName?: string; username?: string }; message?: string; error?: string } | null>(null);

  async function handleTestRemna() {
    setRemnaTesting(true);
    setRemnaTestResult(null);
    try {
      const res = await api.testRemnaConnection(token, {
        apiUrl: settings?.remnaApiUrl ?? undefined,
        adminToken: settings?.remnaAdminToken ?? undefined,
        secretKey: settings?.remnaSecretKey ?? undefined,
      });
      setRemnaTestResult(res);
    } catch (e) {
      setRemnaTestResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setRemnaTesting(false);
    }
  }

  async function handleResetRemna() {
    try {
      const res = await api.resetRemnaConfig(token);
      if (res.ok) {
        const fresh = await api.getSettings(token);
        setSettings((s) => s ? { ...s, ...fresh } : s);
        setRemnaTestResult({ ok: true, message: "Настройки Remnawave сброшены к значениям .env" });
      }
    } catch (e) {
      setRemnaTestResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  async function handleTestBot() {
    setBotTesting(true);
    setBotTestResult(null);
    try {
      const res = await api.testTelegramBot(token, {
        token: settings?.telegramBotToken ?? undefined,
      });
      setBotTestResult(res);
    } catch (e) {
      setBotTestResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBotTesting(false);
    }
  }

  async function handleResetBotToken() {
    try {
      const res = await api.resetBotToken(token);
      if (res.ok) {
        const fresh = await api.getSettings(token);
        setSettings((s) => s ? { ...s, ...fresh } : s);
        setBotTestResult({ ok: true, message: "Токен бота сброшен к значению .env (BOT_TOKEN)" });
      }
    } catch (e) {
      setBotTestResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  const [twoFaEnableOpen, setTwoFaEnableOpen] = useState(false);
  const [twoFaDisableOpen, setTwoFaDisableOpen] = useState(false);
  const [twoFaSetupData, setTwoFaSetupData] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [twoFaStep, setTwoFaStep] = useState<1 | 2>(1);
  const [twoFaCode, setTwoFaCode] = useState("");
  const [twoFaLoading, setTwoFaLoading] = useState(false);
  const [twoFaError, setTwoFaError] = useState<string | null>(null);
  const [botSubTab, setBotSubTab] = useState<"menu" | "texts" | "emoji" | "behavior" | "links">("menu");

  const [message, setMessage] = useState("");
  const [sshMessage, setSshMessage] = useState("");
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab") ?? "general";
  const activeTab = SETTINGS_TABS.has(requestedTab) && (requestedTab !== "updates" || state.admin?.role === "ADMIN") ? requestedTab : "general";
  const setActiveTab = (tab: string) => {
    if (!SETTINGS_TABS.has(tab)) return;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("tab", tab);
      return next;
    });
  };
  const defaultJourneySteps = [
    { title: "Выбираешь сценарий", desc: "Доступны гибкие тарифы: выбери то, что подходит именно тебе, без переплат." },
    { title: "Оплачиваешь как удобно", desc: "Карта, СБП, крипта — выбирай любой удобный и безопасный метод оплаты." },
    { title: "Подключаешься без боли", desc: "После оплаты бот или личный кабинет сразу выдадут все инструкции. Настройка за 1 минуту." },
  ];
  const defaultSignalCards = [
    { eyebrow: "privacy core", title: "Zero-log и аккуратная защита", desc: "Не ощущается как странный хак: нормальный продуктовый слой, чистый доступ и понятный контроль." },
    { eyebrow: "global access", title: "Нужные сервисы открываются без драмы", desc: "Маршруты и сценарии уже собраны под реальные поездки, работу и привычные повседневные задачи." },
    { eyebrow: "payments sync", title: "Оплата встроена в общий сценарий", desc: "Не отдельная форма из девяностых, а часть единого опыта: выбрал, оплатил, сразу подключился." },
  ];
  const defaultTrustPoints = ["Современные протоколы шифрования", "Строгая политика Zero-Log: мы не храним данные", "Высокая пропускная способность без ограничений"];
  const defaultExperiencePanels = [
    { title: "Никаких зависаний", desc: "Смотри видео в 4K, играй в игры и работай без задержек." },
    { title: "Мгновенное подключение", desc: "Достаточно нажать одну кнопку, чтобы оказаться в защищенной сети." },
    { title: "Удобный кабинет", desc: "Управляй подпиской, устройствами и получай поддержку в пару кликов." },
  ];
  const defaultDevicesList = ["Windows", "macOS", "iPhone / iPad", "Android", "Linux"];
  const defaultQuickStartList = ["Мгновенный доступ после оплаты", "Подробные инструкции и техподдержка", "Удобный личный кабинет в Telegram"];
  const [landingJourneySteps, setLandingJourneySteps] = useState<{ title: string; desc: string }[]>(defaultJourneySteps);
  const [landingSignalCards, setLandingSignalCards] = useState<{ eyebrow: string; title: string; desc: string }[]>(defaultSignalCards);
  const [landingTrustPoints, setLandingTrustPoints] = useState<string[]>(defaultTrustPoints);
  const [landingExperiencePanels, setLandingExperiencePanels] = useState<{ title: string; desc: string }[]>(defaultExperiencePanels);
  const [landingDevicesList, setLandingDevicesList] = useState<string[]>(defaultDevicesList);
  const [landingQuickStartList, setLandingQuickStartList] = useState<string[]>(defaultQuickStartList);
  const token = state.accessToken!;

  const [groqModels, setGroqModels] = useState<string[]>([]);
  const [loadingGroqModels, setLoadingGroqModels] = useState(false);
  const [groqModelsMessage, setGroqModelsMessage] = useState<string | null>(null);

  const handleLoadGroqModels = async () => {
    setLoadingGroqModels(true);
    setGroqModelsMessage(null);
    try {
      const res = await api.getGroqModels(token, settings?.groqApiKey || undefined);
      setGroqModels(res.models);
      setGroqModelsMessage(res.models.length ? t("admin.settings.ai_models_loaded", { count: res.models.length }) : t("admin.settings.ai_models_empty"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setGroqModelsMessage(`Ошибка: ${msg}`);
    } finally {
      setLoadingGroqModels(false);
    }
  };

  const availableModels = Array.from(new Set([
    ...groqModels,
    ...DEFAULT_GROQ_MODELS,
    ...ENTERPRISE_GROQ_MODELS,
    ...(settings?.groqModel ? [settings.groqModel] : []),
    ...(settings?.groqFallback1 ? [settings.groqFallback1] : []),
    ...(settings?.groqFallback2 ? [settings.groqFallback2] : []),
    ...(settings?.groqFallback3 ? [settings.groqFallback3] : []),
  ])).filter(Boolean);

  /* Данные — через TanStack Query (admin-queries). Формы остаются локальным useState. */
  const qc = useQueryClient();
  const { bumpRefresh } = useAdminUi();
  const settingsQ = useAdminSettings(token);
  const languagesQ = useLanguages(token);
  const autoRenewStatsQ = useAutoRenewStats(token);
  const sshQ = useSshConfig(token);
  const squadsQ = useRemnaSquadsInternal(token);
  // Признак подключённой Remna (кэш прогревается здесь; используется в логике
  // сохранения ниже и доступен дочерним компонентам по ключу).
  const remnaConfigured = useRemnaStatus(token).data?.configured ?? false;
  const subpageQ = useAdminSubscriptionPageConfig(token, activeTab === "subpage");
  const [sshDraft, setSshDraft] = useState<SshConfig | null>(null);
  useEffect(() => { setSshDraft(sshQ.data ?? null); }, [sshQ.data]);
  const installedLangCodes = (() => {
    const res = languagesQ.data;
    if (!res?.ok) return FALLBACK_LANGS;
    const codes = res.languages.map((l) => l.code);
    return Array.from(new Set<string>(["ru", ...codes]));
  })();
  const squads = (() => {
    const res = squadsQ.data as { response?: { internalSquads?: { uuid: string; name?: string }[] } } | null | undefined;
    const items = res?.response?.internalSquads ?? (res && Array.isArray(res) ? res : []);
    return Array.isArray(items) ? items : [];
  })();
  const autoRenewStats = autoRenewStatsQ.data ?? null;
  const defaultSubpageConfig = subpageQ.data ?? null;

  useEffect(() => {
    const data = settingsQ.data;
    if (!data) return;
    const allowed = installedLangCodes;
    setSettings({
      ...data,
      activeLanguages: (data.activeLanguages || []).filter((l: string) => allowed.includes(l)),
      activeCurrencies: (data.activeCurrencies || []).filter((c: string) => ALLOWED_CURRENCIES.includes(c)),
      referralRewardMode: data.referralRewardMode ?? "percent",
      referralRewardAmount: data.referralRewardAmount ?? 50,
      referralRewardDays: data.referralRewardDays ?? 3,
      defaultReferralPercent: data.defaultReferralPercent ?? 30,
      referralPercentLevel2: (data as AdminSettings).referralPercentLevel2 ?? 10,
      referralPercentLevel3: (data as AdminSettings).referralPercentLevel3 ?? 10,
      withdrawalsEnabled: (data as AdminSettings).withdrawalsEnabled ?? true,
      withdrawalMinAmount: (data as AdminSettings).withdrawalMinAmount ?? 3000,
      withdrawalMethodsSbp: (data as AdminSettings).withdrawalMethodsSbp ?? true,
      withdrawalMethodsCard: (data as AdminSettings).withdrawalMethodsCard ?? true,
      withdrawalMethodsUsdt: (data as AdminSettings).withdrawalMethodsUsdt ?? true,
      plategaMethods: (data as AdminSettings).plategaMethods ?? DEFAULT_PLATEGA_METHODS,
      botButtons: (() => {
        const raw = (data as AdminSettings).botButtons;
        const loaded = Array.isArray(raw) ? raw : [];
        return [...DEFAULT_BOT_BUTTONS.map((def) => {
          const fromApi = loaded.find((b: { id: string }) => b.id === def.id);
          return fromApi ? { ...def, ...fromApi } : def;
        }), ...loaded.filter((b) => b.id.startsWith("custom_"))] as BotButtonItem[];
      })(),
      botMenuMode: data.botMenuMode ?? "classic",
      botGroupCabinet: data.botGroupCabinet ?? false,
      botButtonsPerRow: (data as AdminSettings).botButtonsPerRow ?? 1,
      botEmojis: (data as AdminSettings).botEmojis ?? {},
      botBackLabel: (data as AdminSettings).botBackLabel ?? " В меню",
      botDevicesText: (data as AdminSettings).botDevicesText ?? "",
      botMenuTexts: { ...DEFAULT_BOT_MENU_TEXTS, ...((data as AdminSettings).botMenuTexts ?? {}) },
      botMenuLineVisibility: { ...DEFAULT_BOT_MENU_LINE_VISIBILITY, ...((data as AdminSettings).botMenuLineVisibility ?? {}) },
      botTariffsText: (data as AdminSettings).botTariffsText ?? DEFAULT_BOT_TARIFFS_TEXT,
      botTariffsFields: { ...DEFAULT_BOT_TARIFF_FIELDS, ...((data as AdminSettings).botTariffsFields ?? {}) },
      botPaymentText: (data as AdminSettings).botPaymentText ?? DEFAULT_BOT_PAYMENT_TEXT,
      botInnerButtonStyles: (() => {
        const raw = (data as AdminSettings).botInnerButtonStyles;
        const loaded =
          raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, string>) : {};
        return { ...DEFAULT_BOT_INNER_STYLES, ...loaded };
      })(),
      subscriptionPageConfig: (data as AdminSettings).subscriptionPageConfig ?? null,
      supportLink: (data as AdminSettings).supportLink ?? "",
      agreementLink: (data as AdminSettings).agreementLink ?? "",
      referralInstructionsUrl: (data as AdminSettings).referralInstructionsUrl ?? "",
      offerLink: (data as AdminSettings).offerLink ?? "",
      instructionsLink: (data as AdminSettings).instructionsLink ?? "",
      // T11 (11.05.2026): — Политика возврата.
      refundLink: (data as AdminSettings & { refundLink?: string | null }).refundLink ?? "",
      // Текст экрана «Помощь» (большой rich-text «цели/приоритеты»).
      helpIntroText: (data as AdminSettings & { helpIntroText?: string | null }).helpIntroText ?? "",
      // настройки экрана «Бесплатный Прокси для Telegram».
      tgProxyText: (data as AdminSettings).tgProxyText ?? "",
      tgProxyUrlPrimary: (data as AdminSettings).tgProxyUrlPrimary ?? "",
      tgProxyUrlBackup: (data as AdminSettings).tgProxyUrlBackup ?? "",
      // динамический список TG-прокси. Бэк уже отдаёт
      // распарсенный массив (см. client.service.ts  tgProxyServers).
      // Если массив пуст И есть legacy primary/backup — мигрируем их в массив
      // (one-time, при следующем сохранении уйдут только в новый формат).
      tgProxyServers: (() => {
        const fromApi = (data as AdminSettings).tgProxyServers;
        if (Array.isArray(fromApi) && fromApi.length > 0) return fromApi;
        // Migrate legacy primary/backup  массив, чтобы UI сразу показал данные.
        const out: { flag: string; name: string; url: string }[] = [];
        const p = (data as AdminSettings).tgProxyUrlPrimary?.trim();
        const b = (data as AdminSettings).tgProxyUrlBackup?.trim();
        if (p) out.push({ flag: "", name: "Нидерланды", url: p });
        if (b) out.push({ flag: "", name: "Германия", url: b });
        return out;
      })(),
      ticketsEnabled: (data as AdminSettings).ticketsEnabled ?? false,
      aiChatEnabled: (data as AdminSettings).aiChatEnabled !== false,
      sellOptionsEnabled: (data as AdminSettings).sellOptionsEnabled ?? false,
      sellOptionsTrafficEnabled: (data as AdminSettings).sellOptionsTrafficEnabled ?? false,
      sellOptionsTrafficProducts: (data as AdminSettings).sellOptionsTrafficProducts ?? [],
      sellOptionsDevicesEnabled: (data as AdminSettings).sellOptionsDevicesEnabled ?? false,
      sellOptionsDevicesProducts: (data as AdminSettings).sellOptionsDevicesProducts ?? [],
      sellOptionsServersEnabled: (data as AdminSettings).sellOptionsServersEnabled ?? false,
      sellOptionsServersProducts: (data as AdminSettings).sellOptionsServersProducts ?? [],
      liteMode: (data as AdminSettings).liteMode ?? false,
      giftSubscriptionsEnabled: (data as AdminSettings).giftSubscriptionsEnabled ?? false,
      giftCodeExpiryHours: (data as AdminSettings).giftCodeExpiryHours ?? 72,
      maxAdditionalSubscriptions: (data as AdminSettings).maxAdditionalSubscriptions ?? 5,
      giftCodeFormatLength: (data as AdminSettings).giftCodeFormatLength ?? 12,
      giftRateLimitPerMinute: (data as AdminSettings).giftRateLimitPerMinute ?? 5,
      giftExpiryNotificationDays: (data as AdminSettings).giftExpiryNotificationDays ?? 3,
      giftReferralEnabled: (data as AdminSettings).giftReferralEnabled ?? true,
      giftMessageMaxLength: (data as AdminSettings).giftMessageMaxLength ?? 200,
    });
    // Реинициализация формы только при смене данных запроса (рефетч/инвалидация),
    // не при каждом редактировании локального стейта.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsQ.data]);

  useEffect(() => {
    if (!settings) return;
    try {
      const raw = (settings as { landingJourneyStepsJson?: string | null }).landingJourneyStepsJson;
      if (raw?.trim()) {
        const a = JSON.parse(raw) as unknown;
        if (Array.isArray(a) && a.length >= 1) {
          setLandingJourneySteps(a.slice(0, 3).map((x: unknown) => ({
            title: typeof (x as { title?: string }).title === "string" ? (x as { title: string }).title : "",
            desc: typeof (x as { desc?: string }).desc === "string" ? (x as { desc: string }).desc : "",
          })));
        }
      }
    } catch { /* keep default */ }
    try {
      const raw = (settings as { landingSignalCardsJson?: string | null }).landingSignalCardsJson;
      if (raw?.trim()) {
        const a = JSON.parse(raw) as unknown;
        if (Array.isArray(a) && a.length >= 1) {
          setLandingSignalCards(a.slice(0, 3).map((x: unknown) => ({
            eyebrow: typeof (x as { eyebrow?: string }).eyebrow === "string" ? (x as { eyebrow: string }).eyebrow : "",
            title: typeof (x as { title?: string }).title === "string" ? (x as { title: string }).title : "",
            desc: typeof (x as { desc?: string }).desc === "string" ? (x as { desc: string }).desc : "",
          })));
        }
      }
    } catch { /* keep default */ }
    try {
      const raw = (settings as { landingTrustPointsJson?: string | null }).landingTrustPointsJson;
      if (raw?.trim()) {
        const a = JSON.parse(raw) as unknown;
        if (Array.isArray(a)) setLandingTrustPoints(a.slice(0, 5).map((x) => String(x)));
      }
    } catch { /* keep default */ }
    try {
      const raw = (settings as { landingExperiencePanelsJson?: string | null }).landingExperiencePanelsJson;
      if (raw?.trim()) {
        const a = JSON.parse(raw) as unknown;
        if (Array.isArray(a) && a.length >= 1) {
          setLandingExperiencePanels(a.slice(0, 3).map((x: unknown) => ({
            title: typeof (x as { title?: string }).title === "string" ? (x as { title: string }).title : "",
            desc: typeof (x as { desc?: string }).desc === "string" ? (x as { desc: string }).desc : "",
          })));
        }
      }
    } catch { /* keep default */ }
    try {
      const raw = (settings as { landingDevicesListJson?: string | null }).landingDevicesListJson;
      if (raw?.trim()) {
        const a = JSON.parse(raw) as unknown;
        if (Array.isArray(a)) setLandingDevicesList(a.slice(0, 8).map((x: unknown) => (typeof (x as { name?: string }).name === "string" ? (x as { name: string }).name : String(x))));
      }
    } catch { /* keep default */ }
    try {
      const raw = (settings as { landingQuickStartJson?: string | null }).landingQuickStartJson;
      if (raw?.trim()) {
        const a = JSON.parse(raw) as unknown;
        if (Array.isArray(a)) setLandingQuickStartList(a.slice(0, 5).map((x) => String(x)));
      }
    } catch { /* keep default */ }
  }, [settings?.landingJourneyStepsJson, settings?.landingSignalCardsJson, settings?.landingTrustPointsJson, settings?.landingExperiencePanelsJson, settings?.landingDevicesListJson, settings?.landingQuickStartJson]);

  const invalidateAdmin = () => { void qc.invalidateQueries({ queryKey: ["admin"], exact: false }); };

  const syncFromRemnaMut = useMutation({
    mutationFn: () => api.syncFromRemna(token),
    onSuccess: (r) => {
      setSyncMessage(
        r.ok
          ? t("admin.settings.sync_from_result", { created: r.created, updated: r.updated, skipped: r.skipped })
          : t("admin.settings.sync_errors", { errors: r.errors.join("; ") })
      );
      bumpRefresh();
      invalidateAdmin();
    },
    onError: (e) => setSyncMessage(e instanceof Error ? e.message : t("admin.settings.sync_error")),
  });

  const syncToRemnaMut = useMutation({
    mutationFn: () => api.syncToRemna(token),
    onSuccess: (r) => {
      const parts: string[] = [];
      if (r.updated > 0) parts.push(`${t("admin.settings.sync_updated")}: ${r.updated}`);
      if (r.unlinked > 0) parts.push(`${t("admin.settings.sync_unlinked")}: ${r.unlinked}`);
      const successMsg = parts.length > 0 ? parts.join(". ") : t("admin.settings.sync_no_changes");
      const msg = r.ok ? successMsg : (r.errors.length > 0 ? `${t("admin.settings.error")}: ${r.errors.join("; ")}` : "") + (r.unlinked > 0 ? (r.errors.length ? ". " : "") + `${t("admin.settings.sync_unlinked")}: ${r.unlinked}` : "");
      setSyncMessage(msg || successMsg);
      bumpRefresh();
      invalidateAdmin();
    },
    onError: (e) => setSyncMessage(e instanceof Error ? e.message : t("admin.settings.sync_error")),
  });

  const syncCreateRemnaForMissingMut = useMutation({
    mutationFn: () => api.syncCreateRemnaForMissing(token),
    onSuccess: (r) => {
      setSyncMessage(
        r.ok
          ? `${t("admin.settings.sync_created")}: ${r.created}, ${t("admin.settings.sync_linked")}: ${r.linked}`
          : `${t("admin.settings.error")}: ${r.errors.join("; ")}`
      );
      bumpRefresh();
      invalidateAdmin();
    },
    onError: (e) => setSyncMessage(e instanceof Error ? e.message : t("admin.settings.error")),
  });

  function handleSyncFromRemna() { setSyncMessage(null); syncFromRemnaMut.mutate(); }
  function handleSyncToRemna() { setSyncMessage(null); syncToRemnaMut.mutate(); }
  function handleSyncCreateRemnaForMissing() { setSyncMessage(null); syncCreateRemnaForMissingMut.mutate(); }

  const twoFaSetupMut = useMutation({
    mutationFn: () => api.admin2FASetup(token),
    onSuccess: (data) => setTwoFaSetupData(data),
    onError: (e) => setTwoFaError(e instanceof Error ? e.message : t("admin.settings.error")),
    onSettled: () => setTwoFaLoading(false),
  });
  function openTwoFaEnable() {
    setTwoFaError(null);
    setTwoFaSetupData(null);
    setTwoFaStep(1);
    setTwoFaCode("");
    setTwoFaEnableOpen(true);
    setTwoFaLoading(true);
    twoFaSetupMut.mutate();
  }
  function closeTwoFaEnable() {
    setTwoFaEnableOpen(false);
    setTwoFaSetupData(null);
    setTwoFaStep(1);
    setTwoFaCode("");
    setTwoFaError(null);
  }
  const twoFaConfirmMut = useMutation({
    mutationFn: (code: string) => api.admin2FAConfirm(token, code),
    onSuccess: async () => {
      const admin = await api.getMe(token);
      updateAdmin(admin);
      closeTwoFaEnable();
      void qc.invalidateQueries({ queryKey: qk.admin.settings() });
    },
    onError: (e) => setTwoFaError(e instanceof Error ? e.message : t("admin.settings.2fa_invalid_code")),
    onSettled: () => setTwoFaLoading(false),
  });
  function confirmTwoFaEnable() {
    if (!twoFaCode.trim() || twoFaCode.length !== 6) {
      setTwoFaError(t("admin.settings.2fa_enter_code_error"));
      return;
    }
    setTwoFaError(null);
    setTwoFaLoading(true);
    twoFaConfirmMut.mutate(twoFaCode.trim());
  }
  function openTwoFaDisable() {
    setTwoFaDisableOpen(true);
    setTwoFaCode("");
    setTwoFaError(null);
  }
  const twoFaDisableMut = useMutation({
    mutationFn: (code: string) => api.admin2FADisable(token, code),
    onSuccess: async () => {
      const admin = await api.getMe(token);
      updateAdmin(admin);
      setTwoFaDisableOpen(false);
      setTwoFaCode("");
      void qc.invalidateQueries({ queryKey: qk.admin.settings() });
    },
    onError: (e) => setTwoFaError(e instanceof Error ? e.message : t("admin.settings.2fa_invalid_code")),
    onSettled: () => setTwoFaLoading(false),
  });
  const saveSshMut = useMutation({
    mutationFn: (data: SshConfig) => api.updateSshConfig(token, data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.admin.sshConfig() });
      setSshMessage(t("admin.settings.saved"));
    },
    onError: (e) => setSshMessage(e instanceof Error ? e.message : t("admin.settings.error")),
  });
  function confirmTwoFaDisable() {
    if (!twoFaCode.trim() || twoFaCode.length !== 6) {
      setTwoFaError(t("admin.settings.2fa_enter_code_error"));
      return;
    }
    setTwoFaError(null);
    setTwoFaLoading(true);
    twoFaDisableMut.mutate(twoFaCode.trim());
  }

  const saveSettingsMut = useMutation({
    mutationFn: (payload: UpdateSettingsPayload) => api.updateSettings(token, payload),
    onSuccess: (updated) => {
      const u = updated as AdminSettings;
      setSettings((prev) => (prev ? { ...prev, ...u, botInnerButtonStyles: { ...DEFAULT_BOT_INNER_STYLES, ...(prev.botInnerButtonStyles ?? {}) } } : prev));
      setMessage(t("admin.settings.saved"));
      void qc.invalidateQueries({ queryKey: qk.admin.settings() });
    },
    onError: () => setMessage(t("admin.settings.save_error")),
  });
  const saving = saveSettingsMut.isPending;

  function saveOptionsOnly() {
    if (!settings) return;
    setMessage("");
    const payload = {
      sellOptionsEnabled: settings.sellOptionsEnabled ?? false,
      sellOptionsTrafficEnabled: settings.sellOptionsTrafficEnabled ?? false,
      sellOptionsTrafficProducts: (settings.sellOptionsTrafficProducts?.length ? JSON.stringify(settings.sellOptionsTrafficProducts) : "") as string | null,
      sellOptionsDevicesEnabled: settings.sellOptionsDevicesEnabled ?? false,
      sellOptionsDevicesProducts: (settings.sellOptionsDevicesProducts?.length ? JSON.stringify(settings.sellOptionsDevicesProducts) : "") as string | null,
      sellOptionsServersEnabled: settings.sellOptionsServersEnabled ?? false,
      sellOptionsServersProducts: (settings.sellOptionsServersProducts?.length ? JSON.stringify(settings.sellOptionsServersProducts) : "") as string | null,
    };
    saveSettingsMut.mutate(payload);
  }

  function validateBotMenu(): boolean {
    if (!settings) return false;
    const invalidButton = settings.botButtons?.find((button) => button.id.startsWith("custom_") && (!button.label.trim() || button.label.trim().length > 64 || !isBotButtonUrl(button.url?.trim() ?? "")));
    if (invalidButton) {
      setMessage(`Проверьте кнопку «${invalidButton.label || "Без названия"}»: нужно название до 64 символов и ссылка https://, http:// или tg://.`);
      const input = document.getElementById(`bot-button-url-${invalidButton.id}`);
      const details = input?.closest("details");
      if (details) details.open = true;
      input?.focus();
      return false;
    }
    return true;
  }

  function saveBotMenu() {
    if (!settings || !validateBotMenu()) return;
    setMessage("");
    saveSettingsMut.mutate({
      botButtons: JSON.stringify(settings.botButtons ?? DEFAULT_BOT_BUTTONS),
      botCommands: settings.botCommands,
      botMenuMode: settings.botMenuMode ?? "classic",
      botGroupCabinet: settings.botGroupCabinet ?? false,
      botButtonsPerRow: settings.botButtonsPerRow ?? 1,
      botBackLabel: settings.botBackLabel ?? " В меню",
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!settings) return;
    setMessage("");
    if (!validateBotMenu()) return;
    const allowedLangs = installedLangCodes.length ? installedLangCodes : FALLBACK_LANGS;
    const langs = Array.isArray(settings.activeLanguages) ? settings.activeLanguages.filter((l) => allowedLangs.includes(l)) : allowedLangs;
    const currs = Array.isArray(settings.activeCurrencies) ? settings.activeCurrencies.filter((c) => ALLOWED_CURRENCIES.includes(c)) : ALLOWED_CURRENCIES;
    const defaultLang = (settings.defaultLanguage && allowedLangs.includes(settings.defaultLanguage) ? settings.defaultLanguage : langs[0]) ?? "ru";
    const defaultCurr = (settings.defaultCurrency && ALLOWED_CURRENCIES.includes(settings.defaultCurrency) ? settings.defaultCurrency : currs[0]) ?? "usd";
    const payloadBase: UpdateSettingsPayload = {
        activeLanguages: langs.length ? langs.join(",") : allowedLangs.join(","),
        activeCurrencies: currs.length ? currs.join(",") : ALLOWED_CURRENCIES.join(","),
        defaultLanguage: defaultLang,
        defaultCurrency: defaultCurr,
        remnaApiUrl: settings.remnaApiUrl ?? null,
        remnaAdminToken: settings.remnaAdminToken ?? null,
        remnaSecretKey: settings.remnaSecretKey ?? null,
        remnaAutoSyncEnabled: settings.remnaAutoSyncEnabled ?? false,
        remnaAutoSyncIntervalMinutes: settings.remnaAutoSyncIntervalMinutes ?? 60,
        maintenanceEnabled: settings.maintenanceEnabled ?? false,
        maintenanceMessage: settings.maintenanceMessage ?? "",
        referralRewardMode: settings.referralRewardMode ?? "percent",
        referralRewardAmount: settings.referralRewardAmount ?? 50,
        referralRewardDays: settings.referralRewardDays ?? 3,
        defaultReferralPercent: settings.defaultReferralPercent,
        referralPercentLevel2: settings.referralPercentLevel2 ?? 10,
        referralPercentLevel3: settings.referralPercentLevel3 ?? 10,
        withdrawalsEnabled: settings.withdrawalsEnabled ?? true,
        withdrawalMinAmount: settings.withdrawalMinAmount ?? 3000,
        withdrawalMethodsSbp: settings.withdrawalMethodsSbp ?? true,
        withdrawalMethodsCard: settings.withdrawalMethodsCard ?? true,
        withdrawalMethodsUsdt: settings.withdrawalMethodsUsdt ?? true,
        trialDays: settings.trialDays,
        trialSquadUuid: settings.trialSquadUuid ?? null,
        trialDeviceLimit: settings.trialDeviceLimit ?? null,
        trialTrafficLimitBytes: settings.trialTrafficLimitBytes ?? null,
        serviceName: settings.serviceName,
        serviceDescription: settings.serviceDescription ?? null,
        logo: settings.logo ?? null,
        logoBot: settings.logoBot ?? null,
        favicon: settings.favicon ?? null,
        ogImage: settings.ogImage ?? null,
        cabinetDesign: settings.cabinetDesign ?? undefined,
        remnaClientUrl: settings.remnaClientUrl ?? null,
        smtpHost: settings.smtpHost ?? null,
        smtpPort: settings.smtpPort ?? undefined,
        smtpSecure: settings.smtpSecure ?? undefined,
        smtpUser: settings.smtpUser ?? null,
        smtpPassword: settings.smtpPassword === "********" ? undefined : (settings.smtpPassword || null),
        smtpFromEmail: settings.smtpFromEmail ?? null,
        smtpFromName: settings.smtpFromName ?? null,
        mailProvider: settings.mailProvider ?? undefined,
        resendApiKey: settings.resendApiKey ?? undefined,
        resendFromEmail: settings.resendFromEmail || null,
        passwordResetEnabled: settings.passwordResetEnabled ?? false,
        skipEmailVerification: settings.skipEmailVerification ?? false,
        onboardingEmailRequired: settings.onboardingEmailRequired ?? false,
        stealthAccent: settings.stealthAccent ?? null,
        stealthHeroImage: settings.stealthHeroImage ?? null,
        // Антибот-защита регистраций
        signupProtectionEnabled: settings.signupProtectionEnabled !== false,
        emailDomainBlocklist: settings.emailDomainBlocklist ?? "",
        emailPatternBlocklist: settings.emailPatternBlocklist ?? "",
        signupMaxPerIpPerHour: settings.signupMaxPerIpPerHour ?? 3,
        // Happ Crypto Link (шифрование подписочных URL в happ://crypt4/...)
        happCryptEnabled: settings.happCryptEnabled === true,
        defaultAutoRenewEnabled: settings.defaultAutoRenewEnabled ?? false,
        autoRenewDaysBeforeExpiry: settings.autoRenewDaysBeforeExpiry ?? 1,
        autoRenewNotifyDaysBefore: settings.autoRenewNotifyDaysBefore ?? 3,
        autoRenewGracePeriodDays: settings.autoRenewGracePeriodDays ?? 2,
        autoRenewMaxRetries: settings.autoRenewMaxRetries ?? 3,
        paymentDescription: settings.paymentDescription ?? "",
        yookassaRecurringEnabled: settings.yookassaRecurringEnabled ?? false,
        useRemnaSubscriptionPage: settings.useRemnaSubscriptionPage ?? false,
        publicAppUrl: settings.publicAppUrl ?? null,
        telegramBotToken: settings.telegramBotToken ?? null,
        telegramBotUsername: settings.telegramBotUsername ?? null,
        botAdminTelegramIds: settings.botAdminTelegramIds ?? null,
        notificationTelegramGroupId: settings.notificationTelegramGroupId ?? null,
        notificationManagersGroupId: settings.notificationManagersGroupId ?? null,
        notificationManagersTopicTickets: settings.notificationManagersTopicTickets ?? null,
        notificationTopicNewClients: settings.notificationTopicNewClients ?? null,
        notificationTopicPayments: settings.notificationTopicPayments ?? null,
        notificationTopicTickets: settings.notificationTopicTickets ?? null,
        notificationTopicBackups: settings.notificationTopicBackups ?? null,
        notificationTopicTrials: settings.notificationTopicTrials ?? null,
        notificationTopicConversions: settings.notificationTopicConversions ?? null,
        notificationTopicWithdrawals: settings.notificationTopicWithdrawals ?? null,
        notificationTopicPromo: settings.notificationTopicPromo ?? null,
        notificationTopicGifts: settings.notificationTopicGifts ?? null,
        notificationTopicAutoRenew: settings.notificationTopicAutoRenew ?? null,
        plategaMerchantId: settings.plategaMerchantId ?? null,
        plategaSecret: settings.plategaSecret === "********" ? undefined : (settings.plategaSecret || null),
        plategaMethods: settings.plategaMethods != null ? JSON.stringify(settings.plategaMethods) : undefined,
        plategaWebhookSecret: (settings as { plategaWebhookSecret?: string | null }).plategaWebhookSecret === "********" ? undefined : ((settings as { plategaWebhookSecret?: string | null }).plategaWebhookSecret || null),
        paymentProvidersConfig: settings.paymentProviders != null ? JSON.stringify(settings.paymentProviders) : undefined,
        yoomoneyClientId: settings.yoomoneyClientId ?? null,
        yoomoneyClientSecret: settings.yoomoneyClientSecret === "********" ? undefined : (settings.yoomoneyClientSecret || null),
        yoomoneyReceiverWallet: settings.yoomoneyReceiverWallet ?? null,
        yoomoneyNotificationSecret: settings.yoomoneyNotificationSecret === "********" ? undefined : (settings.yoomoneyNotificationSecret || null),
        yookassaShopId: settings.yookassaShopId ?? null,
        yookassaSecretKey: settings.yookassaSecretKey === "********" ? undefined : (settings.yookassaSecretKey || null),
        yookassaWebhookBasicUser: (settings as { yookassaWebhookBasicUser?: string | null }).yookassaWebhookBasicUser ?? null,
        yookassaWebhookBasicPassword: (settings as { yookassaWebhookBasicPassword?: string | null }).yookassaWebhookBasicPassword === "********" ? undefined : ((settings as { yookassaWebhookBasicPassword?: string | null }).yookassaWebhookBasicPassword || null),
        telegramStarsEnabled: settings.telegramStarsEnabled ?? false,
        telegramStarsRubPerStar: settings.telegramStarsRubPerStar ?? 0,
        cryptopayApiToken: settings.cryptopayApiToken ?? null,
        cryptopayTestnet: settings.cryptopayTestnet ?? false,
        heleketMerchantId: settings.heleketMerchantId ?? null,
        heleketApiKey: settings.heleketApiKey === "********" ? undefined : (settings.heleketApiKey || null),
        cloudpaymentsPublicId: settings.cloudpaymentsPublicId ?? "",
        cloudpaymentsApiSecret: settings.cloudpaymentsApiSecret === "********" ? undefined : settings.cloudpaymentsApiSecret,
        cloudpaymentsEnabled: settings.cloudpaymentsEnabled === true,
        cloudpaymentsTestMode: settings.cloudpaymentsTestMode !== false,
        cloudpaymentsTrialDays: settings.cloudpaymentsTrialDays ?? 0,
        cloudpaymentsTrialAmount: settings.cloudpaymentsTrialAmount ?? 1,
        cloudpaymentsTrialTariffId: settings.cloudpaymentsTrialTariffId ?? null,
        cloudpaymentsReceipt: settings.cloudpaymentsReceipt,
        cloudpaymentsBotDirect: settings.cloudpaymentsBotDirect,
        cloudpaymentsGraceDays: settings.cloudpaymentsGraceDays ?? 0,
        paritypayShopId: settings.paritypayShopId ?? null,
        paritypayApiKey: settings.paritypayApiKey === "********" ? undefined : (settings.paritypayApiKey || null),
        paritypaySigningSecret: settings.paritypaySigningSecret === "********" ? undefined : (settings.paritypaySigningSecret || null),
        paritypayEnabled: settings.paritypayEnabled === true,
        cispayEnabled: settings.cispayEnabled === true,
        cispayShopId: settings.cispayShopId ?? "",
        cispayApiKey: settings.cispayApiKey === "********" ? undefined : (settings.cispayApiKey ?? ""),
        cispaySandbox: settings.cispaySandbox === true,
        rollypayApiKey: settings.rollypayApiKey === "********" ? undefined : (settings.rollypayApiKey || null),
        rollypaySigningSecret: settings.rollypaySigningSecret === "********" ? undefined : (settings.rollypaySigningSecret || null),
        rollypayEnabled: settings.rollypayEnabled !== false,
        rollypayTestMode: settings.rollypayTestMode === true,
        lavaShopId: settings.lavaShopId ?? null,
        lavaSecretKey: settings.lavaSecretKey === "********" ? undefined : (settings.lavaSecretKey || null),
        lavaAdditionalKey: settings.lavaAdditionalKey === "********" ? undefined : (settings.lavaAdditionalKey || null),
        lavatopApiKey: settings.lavatopApiKey === "********" ? undefined : (settings.lavatopApiKey || null),
        lavatopDefaultOfferId: settings.lavatopDefaultOfferId ?? null,
        botWelcomeEnabled: settings.botWelcomeEnabled ?? false,
        botWelcomeText: settings.botWelcomeText ?? null,
        botWelcomeImage: settings.botWelcomeImage ?? null,
        botWelcomeShowOnce: settings.botWelcomeShowOnce ?? true,
        cabinetDesignApplyInBrowser: settings.cabinetDesignApplyInBrowser ?? false,
        overpayApiUrl: settings.overpayApiUrl ?? null,
        overpayProjectId: settings.overpayProjectId ?? null,
        overpayLogin: settings.overpayLogin ?? null,
        overpayPassword: settings.overpayPassword === "********" ? undefined : (settings.overpayPassword || null),
        groqApiKey: settings.groqApiKey === "********" ? undefined : (settings.groqApiKey || null),
        groqModel: settings.groqModel ?? undefined,
        groqFallback1: settings.groqFallback1 ?? undefined,
        groqFallback2: settings.groqFallback2 ?? undefined,
        groqFallback3: settings.groqFallback3 ?? undefined,
        aiSystemPrompt: settings.aiSystemPrompt ?? undefined,
        botButtons: settings.botButtons != null ? JSON.stringify(settings.botButtons) : undefined,
        botCommands: settings.botCommands,
      botMenuMode: settings.botMenuMode ?? "classic",
      botGroupCabinet: settings.botGroupCabinet ?? false,
        botButtonsPerRow: settings.botButtonsPerRow ?? 1,
        botEmojis: settings.botEmojis != null ? settings.botEmojis : undefined,
        botBackLabel: settings.botBackLabel ?? null,
        botDevicesText: settings.botDevicesText ?? null,
        botMenuTexts: settings.botMenuTexts != null ? JSON.stringify(settings.botMenuTexts) : undefined,
        botMenuLineVisibility: settings.botMenuLineVisibility != null ? JSON.stringify(settings.botMenuLineVisibility) : undefined,
        botTariffsText: settings.botTariffsText ?? undefined,
        botTariffsFields: settings.botTariffsFields != null ? JSON.stringify(settings.botTariffsFields) : undefined,
        botPaymentText: settings.botPaymentText ?? undefined,
        botInnerButtonStyles: JSON.stringify({
          ...DEFAULT_BOT_INNER_STYLES,
          ...(settings.botInnerButtonStyles ?? {}),
        }),
        subscriptionPageConfig: settings.subscriptionPageConfig ?? undefined,
        supportLink: settings.supportLink ?? undefined,
        agreementLink: settings.agreementLink ?? undefined,
        referralInstructionsUrl: settings.referralInstructionsUrl ?? undefined,
        offerLink: settings.offerLink ?? undefined,
        instructionsLink: settings.instructionsLink ?? undefined,
        // T11 (11.05.2026): — Политика возврата.
        refundLink: (settings as { refundLink?: string | null }).refundLink ?? undefined,
        // Текст экрана «Помощь».
        helpIntroText: (settings as { helpIntroText?: string | null }).helpIntroText ?? undefined,
        // экран бесплатного TG-прокси.
        tgProxyText: settings.tgProxyText ?? undefined,
        tgProxyUrlPrimary: settings.tgProxyUrlPrimary ?? undefined,
        tgProxyUrlBackup: settings.tgProxyUrlBackup ?? undefined,
        // сериализуем массив прокси в JSON для PATCH.
        // Бэкенд ожидает string в zod-схеме (см. tgProxyServers в admin.routes.ts).
        tgProxyServers: settings.tgProxyServers != null ? JSON.stringify(settings.tgProxyServers) : undefined,
        ticketsEnabled: settings.ticketsEnabled ?? false,
        adminFrontNotificationsEnabled: settings.adminFrontNotificationsEnabled ?? true,
        aiChatEnabled: settings.aiChatEnabled !== false,
        themeAccent: settings.themeAccent ?? "default",
        themeMode: settings.themeMode ?? "dark",
        forceSubscribeEnabled: settings.forceSubscribeEnabled ?? false,
        forceSubscribeChannelId: settings.forceSubscribeChannelId ?? null,
        forceSubscribeMessage: settings.forceSubscribeMessage ?? null,
        blacklistEnabled: settings.blacklistEnabled ?? false,
        botAutoDeleteUnknownMessages: settings.botAutoDeleteUnknownMessages ?? false,
        botInfoBlock: settings.botInfoBlock ?? null,
        // тогглы кнопок экрана «Тарифы» бота (default true)
        botTariffsShowExtraDevicesButton: settings.botTariffsShowExtraDevicesButton !== false,
        botTariffsShowBalanceButton: settings.botTariffsShowBalanceButton !== false,
        botHtmlBubblesTest: settings.botHtmlBubblesTest === true,
        botShowTariffCategories: settings.botShowTariffCategories !== false,
        allowUserThemeChange: false,
        sellOptionsEnabled: settings.sellOptionsEnabled ?? false,
        sellOptionsTrafficEnabled: settings.sellOptionsTrafficEnabled ?? false,
        sellOptionsTrafficProducts: settings.sellOptionsTrafficProducts?.length ? JSON.stringify(settings.sellOptionsTrafficProducts) : null,
        sellOptionsDevicesEnabled: settings.sellOptionsDevicesEnabled ?? false,
        sellOptionsDevicesProducts: settings.sellOptionsDevicesProducts?.length ? JSON.stringify(settings.sellOptionsDevicesProducts) : null,
        sellOptionsServersEnabled: settings.sellOptionsServersEnabled ?? false,
        sellOptionsServersProducts: settings.sellOptionsServersProducts?.length ? JSON.stringify(settings.sellOptionsServersProducts) : null,
        liteMode: settings.liteMode ?? false,
        giftSubscriptionsEnabled: settings.giftSubscriptionsEnabled ?? false,
        giftCodeExpiryHours: settings.giftCodeExpiryHours ?? 72,
        maxAdditionalSubscriptions: settings.maxAdditionalSubscriptions ?? 5,
        multiSubscriptionsEnabled: settings.multiSubscriptionsEnabled ?? false,
        giftCodeFormatLength: settings.giftCodeFormatLength ?? 12,
        giftRateLimitPerMinute: settings.giftRateLimitPerMinute ?? 5,
        giftExpiryNotificationDays: settings.giftExpiryNotificationDays ?? 3,
        giftReferralEnabled: settings.giftReferralEnabled ?? true,
        giftMessageMaxLength: settings.giftMessageMaxLength ?? 200,
        customBuildEnabled: settings.customBuildEnabled ?? false,
        customBuildPricePerDay: settings.customBuildPricePerDay ?? 0,
        customBuildPricePerDevice: settings.customBuildPricePerDevice ?? 0,
        customBuildTrafficMode: settings.customBuildTrafficMode ?? "unlimited",
        customBuildPricePerGb: settings.customBuildPricePerGb ?? 0,
        customBuildSquadUuid: settings.customBuildSquadUuid ?? null,
        customBuildCurrency: settings.customBuildCurrency ?? "rub",
        customBuildMaxDays: settings.customBuildMaxDays ?? 360,
        customBuildMaxDevices: settings.customBuildMaxDevices ?? 10,
        googleLoginEnabled: settings.googleLoginEnabled ?? false,
        googleClientId: settings.googleClientId ?? null,
        googleClientSecret: settings.googleClientSecret === "********" ? undefined : (settings.googleClientSecret || null),
        appleLoginEnabled: settings.appleLoginEnabled ?? false,
        appleClientId: settings.appleClientId ?? null,
        appleTeamId: settings.appleTeamId ?? null,
        appleKeyId: settings.appleKeyId ?? null,
        applePrivateKey: settings.applePrivateKey === "********" ? undefined : (settings.applePrivateKey || null),
        landingEnabled: settings.landingEnabled ?? false,
        landingHeroTitle: settings.landingHeroTitle ?? null,
        landingHeroSubtitle: settings.landingHeroSubtitle ?? null,
        landingHeroCtaText: settings.landingHeroCtaText ?? null,
        landingShowTariffs: settings.landingShowTariffs !== false,
        landingContacts: settings.landingContacts ?? null,
        landingOfferLink: settings.landingOfferLink ?? null,
        landingPrivacyLink: settings.landingPrivacyLink ?? null,
        landingFooterText: settings.landingFooterText ?? null,
        landingHeroBadge: settings.landingHeroBadge ?? null,
        landingHeroHint: settings.landingHeroHint ?? null,
        landingFeature1Label: settings.landingFeature1Label ?? null,
        landingFeature1Sub: settings.landingFeature1Sub ?? null,
        landingFeature2Label: settings.landingFeature2Label ?? null,
        landingFeature2Sub: settings.landingFeature2Sub ?? null,
        landingFeature3Label: settings.landingFeature3Label ?? null,
        landingFeature3Sub: settings.landingFeature3Sub ?? null,
        landingFeature4Label: settings.landingFeature4Label ?? null,
        landingFeature4Sub: settings.landingFeature4Sub ?? null,
        landingFeature5Label: settings.landingFeature5Label ?? null,
        landingFeature5Sub: settings.landingFeature5Sub ?? null,
        landingBenefitsTitle: settings.landingBenefitsTitle ?? null,
        landingBenefitsSubtitle: settings.landingBenefitsSubtitle ?? null,
        landingBenefit1Title: settings.landingBenefit1Title ?? null,
        landingBenefit1Desc: settings.landingBenefit1Desc ?? null,
        landingBenefit2Title: settings.landingBenefit2Title ?? null,
        landingBenefit2Desc: settings.landingBenefit2Desc ?? null,
        landingBenefit3Title: settings.landingBenefit3Title ?? null,
        landingBenefit3Desc: settings.landingBenefit3Desc ?? null,
        landingBenefit4Title: settings.landingBenefit4Title ?? null,
        landingBenefit4Desc: settings.landingBenefit4Desc ?? null,
        landingBenefit5Title: settings.landingBenefit5Title ?? null,
        landingBenefit5Desc: settings.landingBenefit5Desc ?? null,
        landingBenefit6Title: settings.landingBenefit6Title ?? null,
        landingBenefit6Desc: settings.landingBenefit6Desc ?? null,
        landingTariffsTitle: settings.landingTariffsTitle ?? null,
        landingTariffsSubtitle: settings.landingTariffsSubtitle ?? null,
        landingDevicesTitle: settings.landingDevicesTitle ?? null,
        landingDevicesSubtitle: settings.landingDevicesSubtitle ?? null,
        landingFaqTitle: settings.landingFaqTitle ?? null,
        landingFaqJson: settings.landingFaqJson ?? null,
        landingHeroHeadline1: settings.landingHeroHeadline1 ?? null,
        landingHeroHeadline2: settings.landingHeroHeadline2 ?? null,
        landingHeaderBadge: settings.landingHeaderBadge ?? null,
        landingButtonLogin: settings.landingButtonLogin ?? null,
        landingButtonLoginCabinet: settings.landingButtonLoginCabinet ?? null,
        landingNavBenefits: settings.landingNavBenefits ?? null,
        landingNavTariffs: settings.landingNavTariffs ?? null,
        landingNavDevices: settings.landingNavDevices ?? null,
        landingNavFaq: settings.landingNavFaq ?? null,
        landingBenefitsBadge: settings.landingBenefitsBadge ?? null,
        landingDefaultPaymentText: settings.landingDefaultPaymentText ?? null,
        landingButtonChooseTariff: settings.landingButtonChooseTariff ?? null,
        landingNoTariffsMessage: settings.landingNoTariffsMessage ?? null,
        landingButtonWatchTariffs: settings.landingButtonWatchTariffs ?? null,
        landingButtonStart: settings.landingButtonStart ?? null,
        landingButtonOpenCabinet: settings.landingButtonOpenCabinet ?? null,
        landingJourneyStepsJson: landingJourneySteps.length ? JSON.stringify(landingJourneySteps) : null,
        landingSignalCardsJson: landingSignalCards.length ? JSON.stringify(landingSignalCards) : null,
        landingTrustPointsJson: landingTrustPoints.some(Boolean) ? JSON.stringify(landingTrustPoints) : null,
        landingExperiencePanelsJson: landingExperiencePanels.length ? JSON.stringify(landingExperiencePanels) : null,
        landingDevicesListJson: landingDevicesList.filter(Boolean).length ? JSON.stringify(landingDevicesList.filter(Boolean).map((name) => ({ name }))) : null,
        landingQuickStartJson: landingQuickStartList.some(Boolean) ? JSON.stringify(landingQuickStartList) : null,
        landingInfraTitle: settings.landingInfraTitle ?? null,
        landingNetworkCockpitText: settings.landingNetworkCockpitText ?? null,
        landingPulseTitle: settings.landingPulseTitle ?? null,
        landingComfortTitle: settings.landingComfortTitle ?? null,
        landingComfortBadge: settings.landingComfortBadge ?? null,
        landingPrinciplesTitle: settings.landingPrinciplesTitle ?? null,
        landingTechTitle: settings.landingTechTitle ?? null,
        landingTechDesc: settings.landingTechDesc ?? null,
        landingCategorySubtitle: settings.landingCategorySubtitle ?? null,
        landingTariffDefaultDesc: settings.landingTariffDefaultDesc ?? null,
        landingTariffBullet1: settings.landingTariffBullet1 ?? null,
        landingTariffBullet2: settings.landingTariffBullet2 ?? null,
        landingTariffBullet3: settings.landingTariffBullet3 ?? null,
        landingLowestTariffDesc: settings.landingLowestTariffDesc ?? null,
        landingDevicesCockpitText: settings.landingDevicesCockpitText ?? null,
        landingUniversalityTitle: settings.landingUniversalityTitle ?? null,
        landingUniversalityDesc: settings.landingUniversalityDesc ?? null,
        landingQuickSetupTitle: settings.landingQuickSetupTitle ?? null,
        landingQuickSetupDesc: settings.landingQuickSetupDesc ?? null,
        landingPremiumServiceTitle: settings.landingPremiumServiceTitle ?? null,
        landingPremiumServicePara1: settings.landingPremiumServicePara1 ?? null,
        landingPremiumServicePara2: settings.landingPremiumServicePara2 ?? null,
        landingHowItWorksTitle: settings.landingHowItWorksTitle ?? null,
        landingHowItWorksDesc: settings.landingHowItWorksDesc ?? null,
        landingStatsPlatforms: settings.landingStatsPlatforms ?? null,
        landingStatsTariffsLabel: settings.landingStatsTariffsLabel ?? null,
        landingStatsAccessLabel: settings.landingStatsAccessLabel ?? null,
        landingStatsPaymentMethods: settings.landingStatsPaymentMethods ?? null,
        landingReadyToConnectEyebrow: settings.landingReadyToConnectEyebrow ?? null,
        landingReadyToConnectTitle: settings.landingReadyToConnectTitle ?? null,
        landingReadyToConnectDesc: settings.landingReadyToConnectDesc ?? null,
        landingShowFeatures: settings.landingShowFeatures !== false,
        landingShowBenefits: settings.landingShowBenefits !== false,
        landingShowDevices: settings.landingShowDevices !== false,
        landingShowFaq: settings.landingShowFaq !== false,
        landingShowHowItWorks: settings.landingShowHowItWorks !== false,
        landingShowCta: settings.landingShowCta !== false,
        proxyEnabled: settings.proxyEnabled ?? false,
        proxyUrl: settings.proxyUrl ?? null,
        proxyTelegram: settings.proxyTelegram ?? false,
        proxyPayments: settings.proxyPayments ?? false,
        proxyAi: settings.proxyAi ?? false,
        nalogEnabled: settings.nalogEnabled ?? false,
        nalogInn: settings.nalogInn ?? null,
        nalogPassword: settings.nalogPassword ?? null,
        nalogDeviceId: settings.nalogDeviceId ?? null,
        nalogServiceName: settings.nalogServiceName ?? null,
    };
    saveSettingsMut.mutate(payloadBase);
  }

  if (settingsQ.isLoading) return <div className="text-muted-foreground">{t("admin.common.loading")}</div>;
  if (!settings) return <div className="text-destructive">{t("admin.common.loading_error")}</div>;

  return (
    <div className="admin-settings space-y-6">
      {/*  HERO  */}
      <div className="relative overflow-hidden rounded-2xl border border-border bg-muted">
        <div className="absolute inset-0 bg-transparent pointer-events-none" />
        <div className="absolute -top-20 -right-20 w-64 h-64 rounded-full bg-muted blur-3xl pointer-events-none" />
        <div className="relative px-6 py-7 sm:px-8 sm:py-8 flex items-start gap-5">
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-extrabold tracking-[-0.3px] text-foreground">
              {t("admin.settings.title")}
            </h1>
            <p className="text-[12.5px] text-muted-foreground mt-[3px] leading-relaxed max-w-2xl">
              {t("admin.settings.subtitle")}
            </p>
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="grid items-start gap-5 xl:grid-cols-[240px_minmax(0,1fr)]">
        <SettingsNavigation activeTab={activeTab} onChange={setActiveTab} isAdmin={state.admin?.role === "ADMIN"} />

        <div className="min-w-0 [&_[role=tabpanel]]:mt-0">
        {state.admin?.role === "ADMIN" && <TabsContent value="updates"><PanelUpdates token={token} /></TabsContent>}
        {activeTab === "server-ssh" && <div className="mt-4"><ConsoleAccessCard token={token} /></div>}
        <form onSubmit={handleSubmit}>
          <GeneralTab
            settings={settings}
            setSettings={setSettings}
            saving={saving}
            message={message}
            installedLangCodes={installedLangCodes}
            totpEnabled={state.admin?.totpEnabled === true}
            openTwoFaEnable={openTwoFaEnable}
            openTwoFaDisable={openTwoFaDisable}
          />
          <BotTab
            settings={settings}
            setSettings={setSettings}
            saving={saving}
            message={message}
            saveBotMenu={saveBotMenu}
            botSubTab={botSubTab}
            setBotSubTab={setBotSubTab}
          />

          {/* TabsContent value="trial" удалён.
              Старый single-trial flow заменён на multi-trials (T15) — управление в /admin/trials.
              Поля settings.trialDays / trialSquadUuid / trialDeviceLimit / trialTrafficLimitBytes
              остаются в БД как back-compat (если ни одного активного триала в Trial[] нет —
              backend fallback'ит на legacy single-trial). Но из UI настроек убраны. */}

          <TabsContent value="subpage">
            <Card className="overflow-hidden border-border">
              <div className="relative bg-muted p-4 border-b border-border">
                <div className="absolute inset-0 bg-transparent pointer-events-none" />
                <div className="relative flex items-start gap-5">
                  <div className="flex-1 min-w-0">
                    <h2 className="text-xl font-bold tracking-tight text-foreground">
                      {t("admin.settings.subpage_title")}
                    </h2>
                    <p className="text-[12.5px] text-muted-foreground mt-1">{t("admin.settings.subpage_editor_hint")}</p>
                  </div>
                </div>
              </div>
              <CardContent className="p-4 sm:p-4">
                <div className="p-4 rounded-lg border bg-muted/40 mb-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="useRemnaSubscriptionPage"
                      checked={settings.useRemnaSubscriptionPage ?? false}
                      onChange={(e) => setSettings((s) => (s ? { ...s, useRemnaSubscriptionPage: e.target.checked } : s))}
                      className="rounded border"
                    />
                    <Label htmlFor="useRemnaSubscriptionPage" className="cursor-pointer">
                      {t("admin.settings.use_remna_subpage")}
                    </Label>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("admin.settings.subpage_remna_hint")}
                  </p>
                  <div className="flex items-center gap-2 pt-1">
                    <Button
                      type="button"
                      disabled={saving}
                      onClick={() => {
                        setMessage("");
                        saveSettingsMut.mutate({ useRemnaSubscriptionPage: settings.useRemnaSubscriptionPage ?? false });
                      }}
                    >
                      {saving ? t("admin.settings.saving") : t("admin.settings.save")}
                    </Button>
                    {message && <span className="text-sm text-muted-foreground">{message}</span>}
                  </div>
                </div>
                <SubscriptionPageEditor
                  currentConfigJson={settings?.subscriptionPageConfig ?? null}
                  defaultConfig={defaultSubpageConfig}
                  onFetchDefault={async () => {
                    // fresh=true чтобы перечитать файл с диска (а не отдать кэш)
                    const c = await api.getDefaultSubscriptionPageConfig(token, true);
                    void qc.invalidateQueries({ queryKey: qk.admin.subscriptionPageConfig() });
                    return c ?? null;
                  }}
                  saving={saving}
                  onSave={async (configJson) => {
                    setSettings((s) => (s ? { ...s, subscriptionPageConfig: configJson } : s));
                    setMessage("");
                    saveSettingsMut.mutate({ subscriptionPageConfig: configJson });
                  }}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <ReferralsTab
            settings={settings}
            setSettings={setSettings}
            saving={saving}
            message={message}
          />

          <PaymentsTab
            settings={settings}
            setSettings={setSettings}
            saving={saving}
            token={token}
            message={message}
            autoRenewStats={autoRenewStats}
            handleSubmit={handleSubmit}
          />

          <TabsContent value="ai">
            <Card className="overflow-hidden border-border">
              <div className="relative bg-muted p-4 border-b border-border">
                <div className="absolute inset-0 bg-transparent pointer-events-none" />
                <div className="relative flex items-start gap-5">
                  <div className="flex-1 min-w-0">
                    <h2 className="text-xl font-bold tracking-tight text-foreground">
                      {t("admin.settings.ai_title")}
                    </h2>
                    <p className="text-[12.5px] text-muted-foreground mt-1">{t("admin.settings.ai_subtitle")} {t("admin.settings.ai_integration_hint")}</p>
                  </div>
                </div>
              </div>
              <CardContent className="space-y-4 p-4 sm:p-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{t("admin.settings.ai_groq_key")}</Label>
                    <Input
                      type="password"
                      value={settings.groqApiKey ?? ""}
                      onChange={(e) => setSettings((s) => (s ? { ...s, groqApiKey: e.target.value || null } : s))}
                      placeholder="gsk_..."
                    />
                    <p className="text-xs text-muted-foreground">{t("admin.settings.ai_key_hint")}</p>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>{t("admin.settings.ai_model")}</Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={loadingGroqModels}
                        onClick={handleLoadGroqModels}
                      >
                        {loadingGroqModels ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                        {t("admin.settings.ai_load_models")}
                      </Button>
                    </div>
                    <select
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      value={settings.groqModel ?? "openai/gpt-oss-120b"}
                      onChange={(e) => setSettings((s) => (s ? { ...s, groqModel: e.target.value } : s))}
                    >
                      {availableModels.map((model) => (
                        <option key={model} value={model}>{model}</option>
                      ))}
                    </select>
                    <p className="text-xs text-muted-foreground">{t("admin.settings.ai_model_hint")}</p>
                    {groqModelsMessage && <p className="text-xs text-muted-foreground">{groqModelsMessage}</p>}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.settings.ai_fallback")}</Label>
                  <p className="text-xs text-muted-foreground mb-2">
                    {t("admin.settings.ai_fallback_hint")}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <select
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background disabled:opacity-50"
                      value={settings.groqFallback1 ?? ""}
                      onChange={(e) => setSettings((s) => (s ? { ...s, groqFallback1: e.target.value || null } : s))}
                    >
                      <option value="">{t("admin.settings.ai_no_fallback")} 1</option>
                      {availableModels.map((model) => (
                        <option key={model} value={model}>{model}</option>
                      ))}
                    </select>
                    <select
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background disabled:opacity-50"
                      value={settings.groqFallback2 ?? ""}
                      onChange={(e) => setSettings((s) => (s ? { ...s, groqFallback2: e.target.value || null } : s))}
                    >
                      <option value="">{t("admin.settings.ai_no_fallback")} 2</option>
                      {availableModels.map((model) => (
                        <option key={model} value={model}>{model}</option>
                      ))}
                    </select>
                    <select
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background disabled:opacity-50"
                      value={settings.groqFallback3 ?? ""}
                      onChange={(e) => setSettings((s) => (s ? { ...s, groqFallback3: e.target.value || null } : s))}
                    >
                      <option value="">{t("admin.settings.ai_no_fallback")} 3</option>
                      {availableModels.map((model) => (
                        <option key={model} value={model}>{model}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.settings.ai_system_prompt")}</Label>
                  <textarea
                    className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    value={settings.aiSystemPrompt ?? ""}
                    onChange={(e) => setSettings((s) => (s ? { ...s, aiSystemPrompt: e.target.value } : s))}
                    placeholder="Ты — лучший менеджер техподдержки VPN-сервиса..."
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("admin.settings.ai_prompt_hint")}
                  </p>
                </div>
                <div className="pt-2 border-t">
                  <Button type="submit" disabled={saving} className="min-w-[140px]">
                    {saving ? t("admin.settings.saving") : t("admin.settings.save")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <MailTelegramTab
            settings={settings}
            setSettings={setSettings}
            saving={saving}
            message={message}
            token={token}
            admin={state.admin}
          />
        </form>

        <TabsContent value="theme">
          <Card className="mb-5 p-5"><h2 className="mb-2">Редактор дизайна кабинета</h2><p className="text-sm text-muted-foreground mb-4">Пресеты, цвета, шрифты и элементы интерфейса. Предпросмотр и черновик перед публикацией.</p><Link className="underline" to="/admin/cabinet-design">Открыть редактор →</Link></Card>
          <Card className="overflow-hidden border-border">
            <div className="relative bg-muted p-4 border-b border-border">
              <div className="absolute inset-0 bg-transparent pointer-events-none" />
              <div className="relative flex items-start gap-5">
                <div className="flex-1 min-w-0">
                  <h2 className="text-xl font-bold tracking-tight text-foreground">
                    {t("admin.settings.theme_title")}
                  </h2>
                  <p className="text-[12.5px] text-muted-foreground mt-1">{t("admin.settings.theme_global_hint")}</p>
                </div>
              </div>
            </div>
            <CardContent className="space-y-6 p-4 sm:p-4">
              <div className="space-y-3">
                <Label className="text-sm font-medium">{t("admin.settings.theme_mode")}</Label>
                <div className="grid grid-cols-3 gap-2">
                  {(["system", "dark", "light"] as const).map(mode => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={(settings.themeMode ?? "dark") === mode}
                      onClick={() => setSettings({ ...settings, themeMode: mode })}
                      className={`rounded-lg border px-3 py-3 text-sm transition-colors ${(settings.themeMode ?? "dark") === mode ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-muted"}`}
                    >
                      {t(`cabinet.layout.theme_${mode}`)}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">{t("admin.settings.theme_mode_hint")}</p>
              </div>
              <div>
                <Label className="text-sm font-medium mb-3 block">{t("admin.settings.theme_accent")}</Label>
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
                    setMessage("");
                    saveSettingsMut.mutate(
                      { themeAccent: settings.themeAccent ?? "default", themeMode: settings.themeMode ?? "dark", allowUserThemeChange: false },
                      { onSuccess: () => setMessage(t("admin.settings.theme_saved")) }
                    );
                  }}
                  disabled={saving}
                >
                  {saving ? t("admin.settings.saving") : t("admin.settings.save_theme")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="options">
          <Card className="overflow-hidden border-border">
            <div className="relative bg-muted p-4 border-b border-border">
              <div className="absolute inset-0 bg-transparent pointer-events-none" />
              <div className="relative flex items-start gap-5">
                <div className="flex-1 min-w-0">
                  <h2 className="text-xl font-bold tracking-tight text-foreground">
                    {t("admin.settings.options_title")}
                  </h2>
                  <p className="text-[12.5px] text-muted-foreground mt-1">{t("admin.settings.options_subtitle")}</p>
                </div>
              </div>
            </div>
            <CardContent className="space-y-6 p-4 sm:p-4">
              <div className="flex items-center gap-2">
                <Switch
                  id="sell-options-enabled"
                  checked={settings.sellOptionsEnabled ?? false}
                  onCheckedChange={(c: boolean) => setSettings((s) => (s ? { ...s, sellOptionsEnabled: !!c } : s))}
                />
                <Label htmlFor="sell-options-enabled" className="cursor-pointer">{t("admin.settings.options_enable")}</Label>
              </div>

              <Collapsible defaultOpen>
                <CollapsibleTrigger className="flex items-center gap-2 font-medium">
                  <ChevronDown className="h-4 w-4" />
                  {t("admin.settings.options_traffic")}
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-3 space-y-3">
                  <div className="flex items-center gap-2 mb-3">
                    <Switch
                      id="sell-traffic-enabled"
                      checked={settings.sellOptionsTrafficEnabled ?? false}
                      onCheckedChange={(c: boolean) => setSettings((s) => (s ? { ...s, sellOptionsTrafficEnabled: !!c } : s))}
                    />
                    <Label htmlFor="sell-traffic-enabled" className="cursor-pointer">{t("admin.settings.options_enable_short")}</Label>
                  </div>
                  <div className="rounded-md border overflow-x-auto overflow-hidden">
                    <table className="w-full text-sm min-w-[400px] [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="text-left p-2 font-medium">{t("admin.settings.options_col_name")}</th>
                          <th className="text-left p-2 font-medium w-24">{t("admin.settings.options_col_gb")}</th>
                          <th className="text-left p-2 font-medium w-28">{t("admin.settings.options_col_price")}</th>
                          <th className="text-left p-2 font-medium w-24">{t("admin.settings.options_col_currency")}</th>
                          <th className="w-10" />
                        </tr>
                      </thead>
                      <tbody>
                        {(settings.sellOptionsTrafficProducts ?? []).map((p, i) => (
                          <tr key={p.id} className="border-b last:border-0">
                            <td className="p-2"><Input className="h-9 w-full max-w-[180px]" placeholder={t("admin.settings.options_name_placeholder")} value={p.name} onChange={(e) => setSettings((s) => { if (!s?.sellOptionsTrafficProducts) return s; const arr = [...s.sellOptionsTrafficProducts]; arr[i] = { ...arr[i], name: e.target.value }; return { ...s, sellOptionsTrafficProducts: arr }; })} /></td>
                            <td className="p-2"><Input type="number" min={0.1} step={0.5} className="h-9 w-full" value={p.trafficGb || ""} onChange={(e) => setSettings((s) => { if (!s?.sellOptionsTrafficProducts) return s; const arr = [...s.sellOptionsTrafficProducts]; arr[i] = { ...arr[i], trafficGb: parseFloat(e.target.value) || 0 }; return { ...s, sellOptionsTrafficProducts: arr }; })} /></td>
                            <td className="p-2"><Input type="number" min={0} step={1} className="h-9 w-full" value={p.price || ""} onChange={(e) => setSettings((s) => { if (!s?.sellOptionsTrafficProducts) return s; const arr = [...s.sellOptionsTrafficProducts]; arr[i] = { ...arr[i], price: parseFloat(e.target.value) || 0 }; return { ...s, sellOptionsTrafficProducts: arr }; })} /></td>
                            <td className="p-2">
                              <select className="h-9 rounded-md border px-2 w-full bg-background" value={p.currency} onChange={(e) => setSettings((s) => { if (!s?.sellOptionsTrafficProducts) return s; const arr = [...s.sellOptionsTrafficProducts]; arr[i] = { ...arr[i], currency: e.target.value }; return { ...s, sellOptionsTrafficProducts: arr }; })}>
                                {ALLOWED_CURRENCIES.map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}
                              </select>
                            </td>
                            <td className="p-1"><Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSettings((s) => (s ? { ...s, sellOptionsTrafficProducts: (s.sellOptionsTrafficProducts ?? []).filter((_, j) => j !== i) } : s))}><Trash2 className="h-4 w-4" /></Button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-3">
                    <Button type="button" variant="outline" size="sm" onClick={() => setSettings((s) => (s ? { ...s, sellOptionsTrafficProducts: [...(s.sellOptionsTrafficProducts ?? []), { id: `traffic_${Date.now()}`, name: "", trafficGb: 5, price: 0, currency: "rub" }] } : s))}>
                      <Plus className="h-4 w-4 mr-1" /> {t("admin.settings.options_add")}
                    </Button>
                  </div>
                </CollapsibleContent>
              </Collapsible>

              <Collapsible defaultOpen>
                <CollapsibleTrigger className="flex items-center gap-2 font-medium">
                  <ChevronDown className="h-4 w-4" />
                  {t("admin.settings.options_devices")}
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-3 space-y-3">
                  <div className="flex items-center gap-2 mb-3">
                    <Switch
                      id="sell-devices-enabled"
                      checked={settings.sellOptionsDevicesEnabled ?? false}
                      onCheckedChange={(c: boolean) => setSettings((s) => (s ? { ...s, sellOptionsDevicesEnabled: !!c } : s))}
                    />
                    <Label htmlFor="sell-devices-enabled" className="cursor-pointer">{t("admin.settings.options_enable_short")}</Label>
                  </div>
                  <div className="rounded-md border overflow-x-auto overflow-hidden">
                    <table className="w-full text-sm min-w-[400px] [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="text-left p-2 font-medium">{t("admin.settings.options_col_name")}</th>
                          <th className="text-left p-2 font-medium w-20">{t("admin.settings.options_col_qty")}</th>
                          <th className="text-left p-2 font-medium w-28">{t("admin.settings.options_col_price")}</th>
                          <th className="text-left p-2 font-medium w-24">{t("admin.settings.options_col_currency")}</th>
                          <th className="w-10" />
                        </tr>
                      </thead>
                      <tbody>
                        {(settings.sellOptionsDevicesProducts ?? []).map((p, i) => (
                          <tr key={p.id} className="border-b last:border-0">
                            <td className="p-2"><Input className="h-9 w-full max-w-[180px]" placeholder={t("admin.settings.options_name_placeholder")} value={p.name} onChange={(e) => setSettings((s) => { if (!s?.sellOptionsDevicesProducts) return s; const arr = [...s.sellOptionsDevicesProducts]; arr[i] = { ...arr[i], name: e.target.value }; return { ...s, sellOptionsDevicesProducts: arr }; })} /></td>
                            <td className="p-2"><Input type="number" min={1} className="h-9 w-full" value={p.deviceCount || ""} onChange={(e) => setSettings((s) => { if (!s?.sellOptionsDevicesProducts) return s; const arr = [...s.sellOptionsDevicesProducts]; arr[i] = { ...arr[i], deviceCount: parseInt(e.target.value, 10) || 0 }; return { ...s, sellOptionsDevicesProducts: arr }; })} /></td>
                            <td className="p-2"><Input type="number" min={0} step={1} className="h-9 w-full" value={p.price || ""} onChange={(e) => setSettings((s) => { if (!s?.sellOptionsDevicesProducts) return s; const arr = [...s.sellOptionsDevicesProducts]; arr[i] = { ...arr[i], price: parseFloat(e.target.value) || 0 }; return { ...s, sellOptionsDevicesProducts: arr }; })} /></td>
                            <td className="p-2">
                              <select className="h-9 rounded-md border px-2 w-full bg-background" value={p.currency} onChange={(e) => setSettings((s) => { if (!s?.sellOptionsDevicesProducts) return s; const arr = [...s.sellOptionsDevicesProducts]; arr[i] = { ...arr[i], currency: e.target.value }; return { ...s, sellOptionsDevicesProducts: arr }; })}>
                                {ALLOWED_CURRENCIES.map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}
                              </select>
                            </td>
                            <td className="p-1"><Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSettings((s) => (s ? { ...s, sellOptionsDevicesProducts: (s.sellOptionsDevicesProducts ?? []).filter((_, j) => j !== i) } : s))}><Trash2 className="h-4 w-4" /></Button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-3">
                    <Button type="button" variant="outline" size="sm" onClick={() => setSettings((s) => (s ? { ...s, sellOptionsDevicesProducts: [...(s.sellOptionsDevicesProducts ?? []), { id: `devices_${Date.now()}`, name: "", deviceCount: 1, price: 0, currency: "rub" }] } : s))}>
                      <Plus className="h-4 w-4 mr-1" /> {t("admin.settings.options_add")}
                    </Button>
                  </div>
                </CollapsibleContent>
              </Collapsible>

              <Collapsible defaultOpen>
                <CollapsibleTrigger className="flex items-center gap-2 font-medium">
                  <ChevronDown className="h-4 w-4" />
                  {t("admin.settings.options_servers")}
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-3 space-y-3">
                  <div className="flex items-center gap-2 mb-3">
                    <Switch
                      id="sell-servers-enabled"
                      checked={settings.sellOptionsServersEnabled ?? false}
                      onCheckedChange={(c: boolean) => setSettings((s) => (s ? { ...s, sellOptionsServersEnabled: !!c } : s))}
                    />
                    <Label htmlFor="sell-servers-enabled" className="cursor-pointer">{t("admin.settings.options_enable_short")}</Label>
                  </div>
                  <p className="text-xs text-muted-foreground">{t("admin.settings.options_squads_hint")}</p>
                  <div className="rounded-md border overflow-x-auto overflow-hidden">
                    <table className="w-full text-sm min-w-[520px] [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="text-left p-2 font-medium">{t("admin.settings.options_col_name")}</th>
                          <th className="text-left p-2 font-medium">{t("admin.settings.options_col_squad")}</th>
                          <th className="text-left p-2 font-medium w-20">{t("admin.settings.options_col_gb")}</th>
                          <th className="text-left p-2 font-medium w-28">{t("admin.settings.options_col_price")}</th>
                          <th className="text-left p-2 font-medium w-24">{t("admin.settings.options_col_currency")}</th>
                          <th className="w-10" />
                        </tr>
                      </thead>
                      <tbody>
                        {(settings.sellOptionsServersProducts ?? []).map((p, i) => (
                          <tr key={p.id} className="border-b last:border-0">
                            <td className="p-2"><Input className="h-9 w-full max-w-[160px]" placeholder={t("admin.settings.options_name_placeholder")} value={p.name} onChange={(e) => setSettings((s) => { if (!s?.sellOptionsServersProducts) return s; const arr = [...s.sellOptionsServersProducts]; arr[i] = { ...arr[i], name: e.target.value }; return { ...s, sellOptionsServersProducts: arr }; })} /></td>
                            <td className="p-2">
                              <select className="h-9 rounded-md border px-2 w-full min-w-[180px] bg-background" value={p.squadUuid} onChange={(e) => setSettings((s) => { if (!s?.sellOptionsServersProducts) return s; const arr = [...s.sellOptionsServersProducts]; arr[i] = { ...arr[i], squadUuid: e.target.value }; return { ...s, sellOptionsServersProducts: arr }; })}>
                                <option value="">{t("admin.settings.options_squad_none")}</option>
                                {remnaConfigured && squads.map((sq) => <option key={sq.uuid} value={sq.uuid}>{sq.name || sq.uuid}</option>)}
                              </select>
                            </td>
                            <td className="p-2"><Input type="number" min={0} step={0.5} className="h-9 w-full" placeholder="0" value={p.trafficGb ?? ""} onChange={(e) => setSettings((s) => { if (!s?.sellOptionsServersProducts) return s; const arr = [...s.sellOptionsServersProducts]; arr[i] = { ...arr[i], trafficGb: parseFloat(e.target.value) || 0 }; return { ...s, sellOptionsServersProducts: arr }; })} /></td>
                            <td className="p-2"><Input type="number" min={0} step={1} className="h-9 w-full" value={p.price || ""} onChange={(e) => setSettings((s) => { if (!s?.sellOptionsServersProducts) return s; const arr = [...s.sellOptionsServersProducts]; arr[i] = { ...arr[i], price: parseFloat(e.target.value) || 0 }; return { ...s, sellOptionsServersProducts: arr }; })} /></td>
                            <td className="p-2">
                              <select className="h-9 rounded-md border px-2 w-full bg-background" value={p.currency} onChange={(e) => setSettings((s) => { if (!s?.sellOptionsServersProducts) return s; const arr = [...s.sellOptionsServersProducts]; arr[i] = { ...arr[i], currency: e.target.value }; return { ...s, sellOptionsServersProducts: arr }; })}>
                                {ALLOWED_CURRENCIES.map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}
                              </select>
                            </td>
                            <td className="p-1"><Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSettings((s) => (s ? { ...s, sellOptionsServersProducts: (s.sellOptionsServersProducts ?? []).filter((_, j) => j !== i) } : s))}><Trash2 className="h-4 w-4" /></Button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-3">
                    <Button type="button" variant="outline" size="sm" onClick={() => setSettings((s) => (s ? { ...s, sellOptionsServersProducts: [...(s.sellOptionsServersProducts ?? []), { id: `server_${Date.now()}`, name: "", squadUuid: squads[0]?.uuid ?? "", trafficGb: 0, price: 0, currency: "rub" }] } : s))}>
                      <Plus className="h-4 w-4 mr-1" /> {t("admin.settings.options_add")}
                    </Button>
                  </div>
                </CollapsibleContent>
              </Collapsible>

              <div className="pt-4 border-t">
                {message && <p className="text-sm text-muted-foreground mb-2">{message}</p>}
                <Button type="button" onClick={saveOptionsOnly} disabled={saving}>{saving ? t("admin.settings.saving") : t("admin.settings.options_save")}</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="custom-build">
          <Card className="overflow-hidden border-border">
            <div className="relative bg-muted p-4 border-b border-border">
              <div className="absolute inset-0 bg-transparent pointer-events-none" />
              <div className="relative flex items-start gap-5">
                <div className="flex-1 min-w-0">
                  <h2 className="text-xl font-bold tracking-tight text-foreground">
                    {t("admin.settings.custom_build_title")}
                  </h2>
                  <p className="text-[12.5px] text-muted-foreground mt-1">{t("admin.settings.custom_build_subtitle")}</p>
                </div>
              </div>
            </div>
            <CardContent className="space-y-4 p-4 sm:p-4">
              <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
                <Switch
                  id="custom-build-enabled"
                  checked={!!settings.customBuildEnabled}
                  onCheckedChange={(c: boolean) => setSettings((s) => (s ? { ...s, customBuildEnabled: !!c } : s))}
                />
                <Label htmlFor="custom-build-enabled" className="cursor-pointer font-medium">{t("admin.settings.custom_build_enable")}</Label>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t("admin.settings.custom_build_price_day")}</Label>
                  <Input
                    type="number"
                    min={0}
                    step={0.01}
                    value={settings.customBuildPricePerDay ?? 0}
                    onChange={(e) => setSettings((s) => (s ? { ...s, customBuildPricePerDay: parseFloat(e.target.value) || 0 } : s))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.settings.custom_build_price_device")}</Label>
                  <Input
                    type="number"
                    min={0}
                    step={0.01}
                    value={settings.customBuildPricePerDevice ?? 0}
                    onChange={(e) => setSettings((s) => (s ? { ...s, customBuildPricePerDevice: parseFloat(e.target.value) || 0 } : s))}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t("admin.settings.custom_build_traffic")}</Label>
                <div className="flex gap-4 items-center">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="customBuildTrafficMode"
                      checked={(settings.customBuildTrafficMode ?? "unlimited") === "unlimited"}
                      onChange={() => setSettings((s) => (s ? { ...s, customBuildTrafficMode: "unlimited" as const } : s))}
                      className="rounded-full"
                    />
                    {t("admin.settings.custom_build_unlimited")}
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="customBuildTrafficMode"
                      checked={(settings.customBuildTrafficMode ?? "unlimited") === "per_gb"}
                      onChange={() => setSettings((s) => (s ? { ...s, customBuildTrafficMode: "per_gb" as const } : s))}
                      className="rounded-full"
                    />
                    {t("admin.settings.custom_build_per_gb")}
                  </label>
                  {(settings.customBuildTrafficMode ?? "unlimited") === "per_gb" && (
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={0}
                        step={0.01}
                        className="w-24"
                        value={settings.customBuildPricePerGb ?? 0}
                        onChange={(e) => setSettings((s) => (s ? { ...s, customBuildPricePerGb: parseFloat(e.target.value) || 0 } : s))}
                      />
                      <span className="text-sm text-muted-foreground">за 1 ГБ</span>
                    </div>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t("admin.settings.custom_build_squad")}</Label>
                <select
                  className="flex h-10 w-full max-w-md rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={settings.customBuildSquadUuid ?? ""}
                  onChange={(e) => setSettings((s) => (s ? { ...s, customBuildSquadUuid: e.target.value || null } : s))}
                >
                  <option value="">{t("admin.settings.custom_build_squad_none")}</option>
                  {squads.map((s) => (
                    <option key={s.uuid} value={s.uuid}>{s.name || s.uuid}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t("admin.settings.custom_build_currency")}</Label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={settings.customBuildCurrency ?? "rub"}
                    onChange={(e) => setSettings((s) => (s ? { ...s, customBuildCurrency: e.target.value } : s))}
                  >
                    {ALLOWED_CURRENCIES.map((c) => (
                      <option key={c} value={c}>{c.toUpperCase()}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.settings.custom_build_max_days")}</Label>
                  <Input
                    type="number"
                    min={1}
                    max={360}
                    value={settings.customBuildMaxDays ?? 360}
                    onChange={(e) => setSettings((s) => (s ? { ...s, customBuildMaxDays: Math.min(360, Math.max(1, parseInt(e.target.value, 10) || 360)) } : s))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.settings.custom_build_max_devices")}</Label>
                  <Input
                    type="number"
                    min={1}
                    max={20}
                    value={settings.customBuildMaxDevices ?? 10}
                    onChange={(e) => setSettings((s) => (s ? { ...s, customBuildMaxDevices: Math.min(20, Math.max(1, parseInt(e.target.value, 10) || 10)) } : s))}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("admin.settings.custom_build_hint")}
              </p>
              <div className="pt-2 flex items-center gap-2">
                <Button
                  type="button"
                  disabled={saving}
                  onClick={(e) => {
                    e.preventDefault();
                    handleSubmit(e as unknown as React.FormEvent);
                  }}
                >
                  {saving ? t("admin.settings.saving") : t("admin.settings.save")}
                </Button>
                {message && <span className="text-sm text-muted-foreground">{message}</span>}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="oauth">
          <Card className="overflow-hidden border-border">
            <div className="relative bg-muted p-4 border-b border-border">
              <div className="absolute inset-0 bg-transparent pointer-events-none" />
              <div className="relative flex items-start gap-5">
                <div className="flex-1 min-w-0">
                  <h2 className="text-xl font-bold tracking-tight text-foreground">
                    {t("admin.settings.oauth_title")}
                  </h2>
                  <p className="text-[12.5px] text-muted-foreground mt-1">{t("admin.settings.oauth_subtitle")}</p>
                </div>
              </div>
            </div>
            <CardContent className="space-y-6 p-4 sm:p-4">
              <div className="space-y-4 rounded-lg border p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium">Google Sign In</h3>
                    <p className="text-xs text-muted-foreground">{t("admin.settings.oauth_google_hint")}</p>
                  </div>
                  <Switch
                    checked={settings?.googleLoginEnabled ?? false}
                    onCheckedChange={(v) => setSettings((s) => (s ? { ...s, googleLoginEnabled: v } : s))}
                  />
                </div>
                {settings?.googleLoginEnabled && (
                  <div className="space-y-3">
                    <div>
                      <Label>Client ID</Label>
                      <Input
                        placeholder="xxxx.apps.googleusercontent.com"
                        value={settings.googleClientId ?? ""}
                        onChange={(e) => setSettings((s) => (s ? { ...s, googleClientId: e.target.value || null } : s))}
                      />
                    </div>
                    <div>
                      <Label>{t("admin.settings.oauth_google_secret")}</Label>
                      <Input
                        type="password"
                        placeholder="GOCSPX-..."
                        value={settings.googleClientSecret ?? ""}
                        onChange={(e) => setSettings((s) => (s ? { ...s, googleClientSecret: e.target.value || null } : s))}
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        {t("admin.settings.oauth_google_secret_hint")}
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t("admin.settings.oauth_google_origins_hint")}
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-4 rounded-lg border p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium">Apple Sign In</h3>
                    <p className="text-xs text-muted-foreground">{t("admin.settings.oauth_apple_hint")}</p>
                  </div>
                  <Switch
                    checked={settings?.appleLoginEnabled ?? false}
                    onCheckedChange={(v) => setSettings((s) => (s ? { ...s, appleLoginEnabled: v } : s))}
                  />
                </div>
                {settings?.appleLoginEnabled && (
                  <div className="space-y-3">
                    <div>
                      <Label>Services ID (Client ID)</Label>
                      <Input
                        placeholder="com.example.service"
                        value={settings.appleClientId ?? ""}
                        onChange={(e) => setSettings((s) => (s ? { ...s, appleClientId: e.target.value || null } : s))}
                      />
                    </div>
                    <div>
                      <Label>Team ID</Label>
                      <Input
                        placeholder="XXXXXXXXXX"
                        value={settings.appleTeamId ?? ""}
                        onChange={(e) => setSettings((s) => (s ? { ...s, appleTeamId: e.target.value || null } : s))}
                      />
                    </div>
                    <div>
                      <Label>Key ID</Label>
                      <Input
                        placeholder="YYYYYYYYYY"
                        value={settings.appleKeyId ?? ""}
                        onChange={(e) => setSettings((s) => (s ? { ...s, appleKeyId: e.target.value || null } : s))}
                      />
                    </div>
                    <div>
                      <Label>Private Key (.p8)</Label>
                      <Textarea
                        rows={4}
                        placeholder="-----BEGIN PRIVATE KEY-----&#10;..."
                        value={settings.applePrivateKey ?? ""}
                        onChange={(e) => setSettings((s) => (s ? { ...s, applePrivateKey: e.target.value || null } : s))}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t("admin.settings.oauth_apple_desc")} Return URL: <code>{`${window.location.origin}/cabinet/login`}</code>
                    </p>
                  </div>
                )}
              </div>

              <div className="pt-2 flex items-center gap-2">
                <Button
                  type="button"
                  disabled={saving}
                  onClick={(e) => {
                    e.preventDefault();
                    handleSubmit(e as unknown as React.FormEvent);
                  }}
                >
                  {saving ? t("admin.settings.saving") : t("admin.settings.save")}
                </Button>
                {message && <span className="text-sm text-muted-foreground">{message}</span>}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="landing">
          <Card className="overflow-hidden border-border">
            <div className="relative bg-muted p-4 border-b border-border">
              <div className="absolute inset-0 bg-transparent pointer-events-none" />
              <div className="relative flex items-start gap-5">
                <div className="flex-1 min-w-0">
                  <h2 className="text-[13.5px] font-bold tracking-tight">{t("admin.settings.tab_landing")}</h2>
                  <p className="text-[12.5px] text-muted-foreground mt-1">
                    Лендинг переехал в отдельный блочный редактор: drag-drop секций, превью без сохранения, шрифты и снапшоты.
                  </p>
                </div>
              </div>
            </div>

            <CardContent className="p-4">
              <div className="rounded-xl border border-border bg-card dark:bg-card p-8 text-center">
                <Globe className="mx-auto h-10 w-10 text-emerald-500" />
                <h3 className="mt-4 text-[13.5px] font-bold">Откройте редактор лендинга</h3>
                <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                  Здесь больше нет полей: тексты, картинки, шрифты, цвета и порядок секций редактируются в визуальном редакторе.
                </p>
                <Button asChild size="lg" className="mt-6 gap-2">
                  <Link to="/admin/landing-editor">
                    <Globe className="h-4 w-4" />
                    Перейти в редактор
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="server-ssh">
          <Card className="overflow-hidden border-border">
            <div className="relative bg-muted p-4 border-b border-border">
              <div className="absolute inset-0 bg-transparent pointer-events-none" />
              <div className="relative flex items-start gap-5">
                <div className="flex-1 min-w-0">
                  <h2 className="text-xl font-bold tracking-tight text-foreground">
                    {t("admin.settings.ssh_title")}
                  </h2>
                  <p className="text-[12.5px] text-muted-foreground mt-1">{t("admin.settings.ssh_subtitle")}</p>
                </div>
              </div>
            </div>
            <CardContent className="space-y-6 p-4 sm:p-4">
              {!sshDraft ? (
                <p className="text-sm text-muted-foreground py-4">
                  {t("admin.settings.ssh_not_found")}
                </p>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label>{t("admin.settings.ssh_port")}</Label>
                    <Input
                      type="number"
                      min={1}
                      max={65535}
                      value={sshDraft.port}
                      onChange={(e) => setSshDraft({ ...sshDraft, port: parseInt(e.target.value, 10) || 22 })}
                    />
                    <p className="text-xs text-muted-foreground">Стандартный порт — 22. Смена порта снижает количество ботов.</p>
                  </div>

                  <div className="space-y-2">
                    <Label>{t("admin.settings.ssh_root_login")}</Label>
                    <select
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={sshDraft.permitRootLogin}
                      onChange={(e) => setSshDraft({ ...sshDraft, permitRootLogin: e.target.value })}
                    >
                      <option value="yes">yes — разрешён вход по паролю и ключу</option>
                      <option value="prohibit-password">prohibit-password — только по ключу</option>
                      <option value="no">no — полностью запрещён</option>
                    </select>
                  </div>

                  <div className="flex items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <Label className="text-base font-medium">{t("admin.settings.ssh_password_auth")}</Label>
                      <p className="text-sm text-muted-foreground">PasswordAuthentication — отключите, если используете только ключи</p>
                    </div>
                    <Switch
                      checked={sshDraft.passwordAuthentication}
                      onCheckedChange={(v) => setSshDraft({ ...sshDraft, passwordAuthentication: v })}
                    />
                  </div>

                  <div className="flex items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <Label className="text-base font-medium">{t("admin.settings.ssh_pubkey_auth")}</Label>
                      <p className="text-sm text-muted-foreground">PubkeyAuthentication — всегда должен быть включён, если заходите по ключу</p>
                    </div>
                    <Switch
                      checked={sshDraft.pubkeyAuthentication}
                      onCheckedChange={(v) => setSshDraft({ ...sshDraft, pubkeyAuthentication: v })}
                    />
                  </div>

                  <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-300">
                    {t("admin.settings.ssh_warning")}
                    Перед изменением убедитесь, что у вас есть альтернативный способ доступа (например, консоль провайдера).
                  </div>

                  {sshMessage && (
                    <p className={`text-sm ${sshMessage === t("admin.settings.saved") ? "text-emerald-500" : "text-destructive"}`}>
                      {sshMessage}
                    </p>
                  )}

                  <Button
                    disabled={saveSshMut.isPending}
                    onClick={() => {
                      sshDraft && saveSshMut.mutate(sshDraft);
                    }}
                  >
                    {saveSshMut.isPending ? t("admin.settings.saving") : t("admin.settings.ssh_apply")}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="proxy-settings">
          <Card className="overflow-hidden border-border">
            <div className="relative bg-muted p-4 border-b border-border">
              <div className="absolute inset-0 bg-transparent pointer-events-none" />
              <div className="relative flex items-start gap-5">
                <div className="flex-1 min-w-0">
                  <h2 className="text-xl font-bold tracking-tight text-foreground">
                    {t("admin.settings.proxy_title")}
                  </h2>
                  <p className="text-[12.5px] text-muted-foreground mt-1">{t("admin.settings.proxy_subtitle")}</p>
                </div>
              </div>
            </div>
            <CardContent className="space-y-5 p-4 sm:p-4">
              <div className="rounded-xl border border-orange-500/20 bg-muted p-4 space-y-4">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-semibold mb-1">{t("admin.settings.proxy_enabled")}</h3>
                    <p className="text-xs text-muted-foreground">Глобальный переключатель — выключает ВСЕ прокси-маршруты сразу. Если выключен, бот/платежи/AI ходят напрямую.</p>
                  </div>
                  <Switch
                    checked={settings.proxyEnabled ?? false}
                    onCheckedChange={(v) => setSettings({ ...settings, proxyEnabled: v })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Proxy URL</Label>
                  <Input
                    placeholder="http://user:pass@host:port или socks5://user:pass@host:port"
                    value={settings.proxyUrl ?? ""}
                    onChange={(e) => setSettings({ ...settings, proxyUrl: e.target.value || null })}
                    disabled={!settings.proxyEnabled}
                    className="font-mono text-xs"
                  />
                  <p className="text-[11px] text-muted-foreground">Протоколы: <code className="bg-muted/40 px-1 py-0.5 rounded">http://</code> · <code className="bg-muted/40 px-1 py-0.5 rounded">https://</code> · <code className="bg-muted/40 px-1 py-0.5 rounded">socks5://</code></p>
                </div>
              </div>

              <div className="rounded-xl border border-red-500/20 bg-muted p-4 space-y-4">
                <div className="flex items-center gap-2.5">
                  <h3 className="text-base font-semibold">{t("admin.settings.proxy_routing")}</h3>
                </div>
                <p className="text-xs text-muted-foreground">Какие сервисы пускать через прокси. Можно гибко включать/выключать по одному.</p>

                <label className="flex items-start gap-3 p-3.5 rounded-xl bg-card/40 border border-border cursor-pointer">
                  <div className="flex-1 min-w-0">
                    <Label className="text-sm font-medium cursor-pointer">{t("admin.settings.proxy_telegram")}</Label>
                    <p className="text-[11px] text-muted-foreground mt-0.5">Бот, уведомления, отправка сообщений в Telegram</p>
                  </div>
                  <Switch
                    checked={settings.proxyTelegram ?? false}
                    onCheckedChange={(v) => setSettings({ ...settings, proxyTelegram: v })}
                    disabled={!settings.proxyEnabled}
                  />
                </label>

                <label className="flex items-start gap-3 p-3.5 rounded-xl bg-card/40 border border-border cursor-pointer">
                  <div className="flex-1 min-w-0">
                    <Label className="text-sm font-medium cursor-pointer">{t("admin.settings.proxy_payments")}</Label>
                    <p className="text-[11px] text-muted-foreground mt-0.5">Platega, YooKassa, YooMoney, CryptoPay, Heleket</p>
                  </div>
                  <Switch
                    checked={settings.proxyPayments ?? false}
                    onCheckedChange={(v) => setSettings({ ...settings, proxyPayments: v })}
                    disabled={!settings.proxyEnabled}
                  /></label>
                <label className="flex items-start gap-3 p-3.5 rounded-xl bg-card/40 border border-border cursor-pointer">
                  <div className="flex-1 min-w-0">
                    <Label className="text-sm font-medium cursor-pointer">AI чат</Label>
                    <p className="text-[11px] text-muted-foreground mt-0.5">Запросы к Groq API (api.groq.com) — нужен прокси если хостинг блочит их IP</p>
                  </div>
                  <Switch
                    checked={settings.proxyAi ?? false}
                    onCheckedChange={(v) => setSettings({ ...settings, proxyAi: v })}
                    disabled={!settings.proxyEnabled}
                  />
                </label>
              </div>

              <div className="rounded-xl border border-amber-500/30 bg-muted p-4 flex items-start gap-3">
                <Sparkles className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  <strong>Важно:</strong> после изменения настроек прокси для Telegram бота необходимо перезапустить контейнер бота,
                  чтобы он подключился через новый прокси.
                </p>
              </div>

              <Button
                onClick={(e) => {
                  handleSubmit(e as unknown as React.FormEvent);
                }}
                disabled={saving}
                className="w-full sm:w-auto h-9 px-6 rounded-xl bg-primary hover:opacity-90 text-white font-semibold shadow-orange-500/20"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
                {saving ? t("admin.settings.saving") : t("admin.settings.save")}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <NalogTab settings={settings} setSettings={setSettings} saving={saving} token={token} setMessage={setMessage} handleSubmit={handleSubmit} />
        <GiftsTab
          settings={settings}
          setSettings={setSettings}
          saving={saving}
          message={message}
          handleSubmit={handleSubmit}
        />

        <TabsContent value="roulette">
          <RouletteAdminTab />
        </TabsContent>

        <ApiTab
          settings={settings}
          setSettings={setSettings}
          saving={saving}
          token={token}
          remnaTesting={remnaTesting}
          remnaTestResult={remnaTestResult}
          botTesting={botTesting}
          botTestResult={botTestResult}
          handleSubmit={handleSubmit}
          handleTestRemna={handleTestRemna}
          handleResetRemna={handleResetRemna}
          handleTestBot={handleTestBot}
          handleResetBotToken={handleResetBotToken}
        />

        <TabsContent value="sync">
          <Card className="overflow-hidden border-border">
            <div className="relative bg-muted p-4 border-b border-border">
              <div className="absolute inset-0 bg-transparent pointer-events-none" />
              <div className="relative flex items-start gap-5">
                <div className="flex-1 min-w-0">
                  <h2 className="text-xl font-bold tracking-tight text-foreground">
                    {t("admin.settings.sync_title")}
                  </h2>
                  <p className="text-[12.5px] text-muted-foreground mt-1">{t("admin.settings.sync_subtitle")}</p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => setActiveTab("api")} className="shrink-0 gap-1.5 text-xs">
                  <Plug className="h-3.5 w-3.5" /> Настройки API (.env)
                </Button>
              </div>
            </div>
            <CardContent className="space-y-4 p-4 sm:p-4">
              <div className="rounded-xl border border-border p-4 space-y-3">
                <Label className="flex items-center justify-between gap-3">Автосинхронизация из Remnawave<Switch checked={settings.remnaAutoSyncEnabled ?? false} onCheckedChange={value => setSettings(s => s ? { ...s, remnaAutoSyncEnabled: value } : s)} /></Label>
                <p className="text-xs text-muted-foreground">По расписанию импортирует клиентов и обновляет данные подписок в панели. Изменения в Remnawave не отправляются.</p>
                <Label htmlFor="remna-sync-interval">Интервал, минут</Label>
                <Input id="remna-sync-interval" type="number" min={5} max={1440} value={settings.remnaAutoSyncIntervalMinutes ?? 60} onChange={e => setSettings(s => s ? { ...s, remnaAutoSyncIntervalMinutes: Number(e.target.value) } : s)} />
                <Button onClick={handleSubmit} disabled={saving}>Сохранить</Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <button type="button" onClick={handleSyncFromRemna} disabled={syncFromRemnaMut.isPending} className="group relative overflow-hidden rounded-xl border border-violet-500/30 bg-transparent p-4 text-left transition-all hover:border-violet-500/50 hover:shadow-violet-500/10 disabled:opacity-50 disabled:cursor-not-allowed">
                  <div className="absolute -top-4 -right-4 w-20 h-20 rounded-full bg-violet-500/10 blur-2xl group-hover:bg-violet-500/20 transition-colors" />
                  <div className="relative flex items-center gap-3 mb-2">
                    <div className="h-10 w-10 rounded-xl bg-violet-500/20 flex items-center justify-center">
                      {syncFromRemnaMut.isPending ? <Loader2 className="h-5 w-5 text-violet-500 animate-spin" /> : <Download className="h-5 w-5 text-violet-500" />}
                    </div>
                    <span className="text-sm font-bold uppercase tracking-wider text-violet-500/80">From Remna </span>
                  </div>
                  <div className="relative text-base font-semibold mb-1">{syncFromRemnaMut.isPending ? t("admin.settings.sync_in_progress") : t("admin.settings.sync_from_remna")}</div>
                  <p className="relative text-xs text-muted-foreground">Подтянуть всех клиентов и подписки из Remna в локальную БД</p>
                </button>

                <button type="button" onClick={handleSyncToRemna} disabled={syncToRemnaMut.isPending} className="group relative overflow-hidden rounded-xl border border-indigo-500/30 bg-transparent p-4 text-left transition-all hover:border-indigo-500/50 hover:shadow-indigo-500/10 disabled:opacity-50 disabled:cursor-not-allowed">
                  <div className="absolute -top-4 -right-4 w-20 h-20 rounded-full bg-indigo-500/10 blur-2xl group-hover:bg-indigo-500/20 transition-colors" />
                  <div className="relative flex items-center gap-3 mb-2">
                    <div className="h-10 w-10 rounded-xl bg-indigo-500/20 flex items-center justify-center">
                      {syncToRemnaMut.isPending ? <Loader2 className="h-5 w-5 text-indigo-500 animate-spin" /> : <Upload className="h-5 w-5 text-indigo-500" />}
                    </div>
                    <span className="text-sm font-bold uppercase tracking-wider text-indigo-500/80"> To Remna</span>
                  </div>
                  <div className="relative text-base font-semibold mb-1">{syncToRemnaMut.isPending ? t("admin.settings.sync_in_progress") : t("admin.settings.sync_to_remna")}</div>
                  <p className="relative text-xs text-muted-foreground">Записать локальные изменения обратно в Remna-панель</p>
                </button>

                <button type="button" onClick={handleSyncCreateRemnaForMissing} disabled={syncCreateRemnaForMissingMut.isPending} className="group relative overflow-hidden rounded-xl border border-blue-500/30 bg-transparent p-4 text-left transition-all hover:border-blue-500/50 hover:shadow-blue-500/10 disabled:opacity-50 disabled:cursor-not-allowed">
                  <div className="absolute -top-4 -right-4 w-20 h-20 rounded-full bg-blue-500/10 blur-2xl group-hover:bg-blue-500/20 transition-colors" />
                  <div className="relative flex items-center gap-3 mb-2">
                    <div className="h-10 w-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
                      {syncCreateRemnaForMissingMut.isPending ? <Loader2 className="h-5 w-5 text-blue-500 animate-spin" /> : <Link2 className="h-5 w-5 text-blue-500" />}
                    </div>
                    <span className="text-sm font-bold uppercase tracking-wider text-blue-500/80">+ Создать</span>
                  </div>
                  <div className="relative text-base font-semibold mb-1">{syncCreateRemnaForMissingMut.isPending ? t("admin.settings.sync_running") : t("admin.settings.sync_create_missing")}</div>
                  <p className="relative text-xs text-muted-foreground">Создать в Remna записи для клиентов, которых там нет</p>
                </button>
              </div>
              {syncMessage && (
                <div className="rounded-xl border border-border bg-card/40 p-4 text-sm">{syncMessage}</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        </div>
      </Tabs>

      <Dialog open={twoFaEnableOpen} onOpenChange={(open) => !open && closeTwoFaEnable()}>
        <DialogContent className="max-w-sm" onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[15px] font-bold">
              <KeyRound className="h-5 w-5" />
              {t("admin.settings.2fa_enable_title")}
            </DialogTitle>
            <DialogDescription>
              {twoFaStep === 1
                ? t("admin.settings.2fa_scan_hint")
                : t("admin.settings.2fa_enter_code")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            {twoFaLoading && !twoFaSetupData ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : twoFaStep === 1 && twoFaSetupData ? (
              <>
                <div className="flex justify-center rounded-xl bg-white p-4 dark:bg-card">
                  <QRCodeSVG value={twoFaSetupData.otpauthUrl} size={200} level="M" />
                </div>
                <p className="text-xs text-muted-foreground break-all font-mono bg-muted/50 rounded-lg p-2">{twoFaSetupData.secret}</p>
                <Button onClick={() => setTwoFaStep(2)}>{t("admin.settings.2fa_next")}</Button>
              </>
            ) : twoFaStep === 2 ? (
              <>
                <Input
                  placeholder="000000"
                  maxLength={6}
                  value={twoFaCode}
                  onChange={(e) => setTwoFaCode(e.target.value.replace(/\D/g, ""))}
                  className="text-center text-lg tracking-[0.4em] font-mono"
                />
                <Button onClick={confirmTwoFaEnable} disabled={twoFaLoading || twoFaCode.length !== 6}>
                  {twoFaLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {t("admin.settings.2fa_confirm")}
                </Button>
              </>
            ) : null}
            {twoFaError && <p className="text-sm text-destructive">{twoFaError}</p>}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={twoFaDisableOpen} onOpenChange={(open) => !open && setTwoFaDisableOpen(false)}>
        <DialogContent className="max-w-sm" onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{t("admin.settings.2fa_disable_title")}</DialogTitle>
            <DialogDescription>
              {t("admin.settings.2fa_disable_hint")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <Input
              placeholder="000000"
              maxLength={6}
              value={twoFaCode}
              onChange={(e) => setTwoFaCode(e.target.value.replace(/\D/g, ""))}
              className="text-center text-lg tracking-[0.4em] font-mono"
            />
            <Button onClick={confirmTwoFaDisable} disabled={twoFaLoading || twoFaCode.length !== 6}>
              {twoFaLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t("admin.settings.2fa_disable_btn")}
            </Button>
            {twoFaError && <p className="text-sm text-destructive">{twoFaError}</p>}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
