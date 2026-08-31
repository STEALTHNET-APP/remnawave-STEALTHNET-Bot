import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { useCabinetDesign } from "@/lib/use-cabinet-design";
import { StealthDashboard } from "@/pages/cabinet/stealth/stealth-dashboard";
import { AuroraDashboard } from "@/pages/cabinet/aurora/aurora-dashboard";
import {
  
  Package,
  Wallet,
  Wifi,
  Calendar,
  
  
  ArrowRight,
  PlusCircle,
  
  Copy,
  Check,
  Gift,
  Loader2,
  Users,
  
  AlertCircle,
  Zap,
  Smartphone,
  Tag,
  X,
  RotateCcw,
  RefreshCw,
  Globe,
  Send,
  UserPlus,
  Coins,
  Percent,
  Sparkles,
} from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { useCabinetConfig } from "@/contexts/cabinet-config";
import { useCabinetMiniapp } from "@/pages/cabinet/cabinet-layout";
import { api } from "@/lib/api";
import { formatRuDays } from "@/lib/i18n";
import type { ClientPayment, ClientReferralStats } from "@/lib/api";
import { TrialsPickerDialog } from "@/components/cabinet/trials-picker-dialog";
import { ExtendSubscriptionDialog } from "@/components/payment/extend-subscription-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";


function formatDate(s: string | null) {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return s;
  }
}

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: currency.toUpperCase() === "USD" ? "USD" : currency.toUpperCase() === "RUB" ? "RUB" : "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return (bytes / 1024 ** 3).toFixed(1) + " ГБ";
  if (bytes >= 1024 ** 2) return (bytes / 1024 ** 2).toFixed(1) + " МБ";
  return (bytes / 1024).toFixed(0) + " КБ";
}


function getSubscriptionPayload(sub: unknown): Record<string, unknown> | null {
  if (!sub || typeof sub !== "object") return null;
  const raw = sub as Record<string, unknown>;
  if (raw.response && typeof raw.response === "object") return raw.response as Record<string, unknown>;
  if (raw.data && typeof raw.data === "object") {
    const d = raw.data as Record<string, unknown>;
    if (d.response && typeof d.response === "object") return d.response as Record<string, unknown>;
  }
  return raw;
}

function parseSubscription(sub: unknown): {
  status?: string;
  expireAt?: string;
  trafficUsed?: number;
  trafficLimitBytes?: number;
  hwidDeviceLimit?: number;
  subscriptionUrl?: string;
  productName?: string;
} {
  const o = getSubscriptionPayload(sub);
  if (!o) return {};
  const userTraffic = o.userTraffic && typeof o.userTraffic === "object" ? (o.userTraffic as Record<string, unknown>) : null;
  const usedBytes = userTraffic != null && typeof userTraffic.usedTrafficBytes === "number"
    ? userTraffic.usedTrafficBytes
    : typeof o.trafficUsed === "number"
      ? o.trafficUsed
      : undefined;
  const subUrl = typeof o.subscriptionUrl === "string" ? o.subscriptionUrl : undefined;
  const productName = typeof o.productName === "string" ? o.productName.trim() : undefined;
  const subscriptionProductName = typeof (o as Record<string, unknown>).subscriptionProductName === "string" ? (o as Record<string, unknown>).subscriptionProductName as string : undefined;
  return {
    status: typeof o.status === "string" ? o.status : undefined,
    expireAt: typeof o.expireAt === "string" ? o.expireAt : undefined,
    trafficUsed: usedBytes,
    trafficLimitBytes: typeof o.trafficLimitBytes === "number" ? o.trafficLimitBytes : undefined,
    hwidDeviceLimit: typeof o.hwidDeviceLimit === "number" ? o.hwidDeviceLimit : (o.hwidDeviceLimit != null ? Number(o.hwidDeviceLimit) : undefined),
    subscriptionUrl: subUrl?.trim() || undefined,
    productName: productName || subscriptionProductName || undefined,
  };
}

/**
 * Wrapper: switcher между Classic-версией главной и новым Stealth-дизайном.
 * Делается тонким wrapper'ом, чтобы не нарушать правила хуков (хуки реальной
 * страницы вызываются только в той ветке которую рендерим).
 */
export function ClientDashboardPage() {
  const design = useCabinetDesign();
  return (
    <>
      <LinkTelegramPrompt />
      {design === "stealth" ? <StealthDashboard /> : design === "aurora" ? <AuroraDashboard /> : <ClassicDashboardPage />}
    </>
  );
}

const TG_LINK_PROMPT_KEY = "stn_tg_link_prompt_dismissed";

/**
 * Всплывающее предложение привязать Telegram сразу после регистрации на сайте
 * (схема Алекса). Показывается один раз (localStorage-флаг), когда:
 *   - Telegram ещё не привязан,
 *   - открыт веб-кабинет (не мини-апп — там TG привязывается мгновенно),
 *   - известен @username бота (иначе диплинк не построить).
 * «Привязать» → запрашивает код и открывает t.me/<bot>?start=link_<code>.
 * «Позже» → закрывает и больше не показывает.
 */
function LinkTelegramPrompt() {
  const { t } = useTranslation();
  const { state } = useClientAuth();
  const config = useCabinetConfig();
  const isMiniapp = useCabinetMiniapp();
  const token = state.token;
  const client = state.client;
  const botUsername = (config?.telegramBotUsername ?? "").replace(/^@/, "");

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isMiniapp) return;
    if (!client || client.telegramId) return;
    if (!botUsername) return;
    let dismissed = false;
    try { dismissed = localStorage.getItem(TG_LINK_PROMPT_KEY) === "1"; } catch { dismissed = false; }
    if (dismissed) return;
    setOpen(true);
  }, [client, isMiniapp, botUsername]);

  function dismiss() {
    try { localStorage.setItem(TG_LINK_PROMPT_KEY, "1"); } catch { /* ignore */ }
    setOpen(false);
  }

  async function linkNow() {
    if (!token) return;
    setLoading(true);
    try {
      const res = await api.clientLinkTelegramRequest(token);
      const uname = (res.botUsername ?? botUsername).replace(/^@/, "");
      const url = `https://t.me/${uname}?start=link_${res.code}`;
      try { localStorage.setItem(TG_LINK_PROMPT_KEY, "1"); } catch { /* ignore */ }
      setOpen(false);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      // если код не выдался — просто закрываем, юзер сделает привязку в профиле
      dismiss();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) dismiss(); }}>
      <DialogContent className="max-w-sm">
        <div className="flex flex-col items-center text-center gap-3 py-2">
          <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Send className="h-7 w-7 text-primary" />
          </div>
          <DialogTitle className="text-lg">{t("cabinet.link_prompt.title")}</DialogTitle>
          <DialogDescription className="text-sm">{t("cabinet.link_prompt.desc")}</DialogDescription>
          <div className="flex flex-col gap-2 w-full mt-2">
            <Button onClick={linkNow} disabled={loading} className="w-full gap-2">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {t("cabinet.link_prompt.link")}
            </Button>
            <Button variant="ghost" onClick={dismiss} className="w-full">
              {t("cabinet.link_prompt.later")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ClassicDashboardPage() {
  const { t } = useTranslation();
  const { state, refreshProfile } = useClientAuth();
  const config = useCabinetConfig();
  const [searchParams, setSearchParams] = useSearchParams();
  const [subscription, setSubscription] = useState<unknown>(null);
  const [secondarySubscriptions, setSecondarySubscriptions] = useState<Array<{ type: string; id: string; subscriptionIndex: number | null; subscription: unknown; tariffDisplayName: string; remnawaveUuid: string | null; trialId?: string | null; trialName?: string | null; trialConvertEnabled?: boolean }>>([]);
  // root-подписка — триал: лейбл TRIAL + «Конвертировать» (или ничего).
  const [rootTrial, setRootTrial] = useState<{ isTrial: boolean; convertEnabled: boolean }>({ isTrial: false, convertEnabled: true });
  // T-unify-cabinet (30.05.2026, WolfVPN): id главной подписки (#0) — для кнопки «Продлить» → /cabinet/tariffs?extend=
  const [rootSubId, setRootSubId] = useState<string | null>(null);
  const [tariffDisplayName, setTariffDisplayName] = useState<string | null>(null);
  const [autoRenewNext, setAutoRenewNext] = useState<{ amount: number | null; at: string | null; currency: string | null }>({ amount: null, at: null, currency: null });
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);
  const [_payments, setPayments] = useState<ClientPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [paymentMessage, setPaymentMessage] = useState<"success_topup" | "success_tariff" | "success" | "failed" | null>(null);
  // T-pay-success-modal (WolfVPN): модалка успеха при возврате с оплаты (ЮKassa/Platega/Lava/и др.)
  const [paySuccessModal, setPaySuccessModal] = useState<null | "topup" | "tariff" | "generic">(null);
  const [trialLoading, setTrialLoading] = useState(false);
  const [trialError, setTrialError] = useState<string | null>(null);
  // T15 (26.05.2026, WolfVPN): новая мульти-триал система.
  // hasMultiTrials=null → ещё не загружали; true → открываем модалку; false → legacy /trial.
  const [hasMultiTrials, setHasMultiTrials] = useState<boolean | null>(null);
  const [trialsPickerOpen, setTrialsPickerOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  // красивая модалка продления вместо редиректа в каталог
  // (?extend=...). Открывается для ЛЮБОЙ подписки — единый механизм.
  const [extendSubId, setExtendSubId] = useState<string | null>(null);
  const [referralStats, setReferralStats] = useState<ClientReferralStats | null>(null);
  const [deviceCount, setDeviceCount] = useState<number | null>(null);
  // T-sec-devices (WolfVPN): кол-во устройств по каждой подписке (subscriptionId → count) — для доп.подписок.
  const [devicesBySubId, setDevicesBySubId] = useState<Record<string, number>>({});
  // ♻️ Пер-подписочное автосписание (вместо одного глобального Switch в карточке «Баланс»).
  // Триальные подписки сюда не попадают — автосписание на них не имеет смысла.
  const [autoRenewSubs, setAutoRenewSubs] = useState<Array<{ type: "root" | "secondary"; id: string; name: string; enabled: boolean }>>([]);
  const [autoRenewTogglingId, setAutoRenewTogglingId] = useState<string | null>(null);

  const token = state.token;
  const isMiniapp = useCabinetMiniapp();
  const client = state.client;
  const trialDays = config?.trialDays ?? 0;

  useEffect(() => {
    const payment = searchParams.get("payment");
    const paymentKind = searchParams.get("payment_kind");
    // T-pay-success-modal (WolfVPN): ЕДИНЫЙ детект возврата с любой платёжки.
    // Бэкенд редиректит по-разному: ?payment=success, ?yoomoney_form=success, ?yookassa=success,
    // ?heleket=success, ?lava=success, ?lavatop=success, ?overpay=return.
    const providerSuccess =
      payment === "success" ||
      searchParams.get("yoomoney_form") === "success" ||
      searchParams.get("yookassa") === "success" ||
      searchParams.get("heleket") === "success" ||
      searchParams.get("rollypay") === "success" ||
      searchParams.get("lava") === "success" ||
      searchParams.get("lavatop") === "success" ||
      searchParams.get("overpay") === "return";
    if (providerSuccess) {
      const kind = paymentKind === "topup" ? "topup" : paymentKind === "tariff" ? "tariff" : "generic";
      setPaymentMessage(kind === "topup" ? "success_topup" : kind === "tariff" ? "success_tariff" : "success");
      setPaySuccessModal(kind);
      setSearchParams({}, { replace: true });
      if (token) refreshProfile().catch(() => {});
    } else if (payment === "failed") {
      setPaymentMessage("failed");
      setSearchParams({}, { replace: true });
      if (token) refreshProfile().catch(() => {});
    }
  }, [searchParams, setSearchParams, token, refreshProfile]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    setSubscriptionError(null);
    Promise.all([
      api.clientSubscription(token),
      api.clientPayments(token),
      api.getClientDevices(token).catch(() => ({ total: 0 })),
      api.clientAllSubscriptions(token).catch(() => ({ items: [] })),
      api.getMyAllDevices(token).catch(() => ({ total: 0, items: [] })),
    ])
      .then(([subRes, payRes, devRes, allSubRes, allDevRes]) => {
        if (cancelled) return;
        setSubscription(subRes.subscription ?? null);
        setTariffDisplayName(subRes.tariffDisplayName ?? null);
        setAutoRenewNext({
          amount: subRes.autoRenewNextChargeAmount ?? null,
          at: subRes.autoRenewNextChargeAt ?? null,
          currency: subRes.autoRenewCurrency ?? null,
        });
        if (subRes.message) setSubscriptionError(subRes.message);
        setPayments(payRes.items ?? []);
        setDeviceCount(devRes.total ?? null);
        setSecondarySubscriptions((allSubRes.items || []).filter(s => s.type === "secondary"));
        // ♻️ Список подписок для блока «Автосписание по подпискам» (без триальных).
        setAutoRenewSubs(
          (allSubRes.items || [])
            .filter((s) => !s.trialId)
            .map((s) => ({
              type: s.type,
              id: s.id,
              name: s.tariffDisplayName?.trim() || `Подписка #${(s.subscriptionIndex ?? 0) + 1}`,
              enabled: s.autoRenewEnabled ?? false,
            })),
        );
        const rootItem = (allSubRes.items || []).find(s => s.type === "root");
        setRootSubId(rootItem?.id ?? null);
        setRootTrial({
          isTrial: Boolean(rootItem?.trialId),
          convertEnabled: rootItem?.trialConvertEnabled ?? true,
        });
        // T-sec-devices (WolfVPN): счётчик устройств по subscriptionId — для отображения «использовано/лимит» на доп.подписках.
        const devCounts: Record<string, number> = {};
        for (const d of (allDevRes.items || [])) devCounts[d.subscriptionId] = (devCounts[d.subscriptionId] || 0) + 1;
        setDevicesBySubId(devCounts);
      })
      .catch((e) => {
        if (!cancelled) setSubscriptionError(e instanceof Error ? e.message : t("cabinet.dashboard.error_loading"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [token, refreshKey]);

  useEffect(() => {
    if (!token) return;
    api.getClientReferralStats(token).then(setReferralStats).catch(() => {});
  }, [token]);

  // Auto-redeem pending gift code (saved by /gift/:code page before redirect to login/register)
  const [giftRedeemMessage, setGiftRedeemMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!token || loading) return;
    const pendingCode = localStorage.getItem("stealthnet_pending_gift");
    if (!pendingCode) return;
    localStorage.removeItem("stealthnet_pending_gift");
    api.giftRedeemCode(token, pendingCode)
      .then((res) => {
        setGiftRedeemMessage({ type: "success", text: res.message || "Подарок активирован!" });
        setRefreshKey((k) => k + 1);
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : "Не удалось активировать подарок";
        setGiftRedeemMessage({ type: "error", text: msg });
      });
  }, [token, loading]);

  // ♻️ Тоггл автосписания у конкретной подписки: optimistic-обновление с откатом при ошибке.
  async function toggleSubAutoRenew(sub: { type: "root" | "secondary"; id: string }, enabled: boolean) {
    if (!token) return;
    setAutoRenewTogglingId(sub.id);
    setAutoRenewSubs((prev) => prev.map((s) => (s.id === sub.id ? { ...s, enabled } : s)));
    try {
      await api.clientSetSubscriptionAutoRenew(token, sub.type, sub.id, enabled);
      refreshProfile().catch(() => {});
    } catch (err) {
      console.error("Failed to toggle subscription auto-renew", err);
      setAutoRenewSubs((prev) => prev.map((s) => (s.id === sub.id ? { ...s, enabled: !enabled } : s)));
    } finally {
      setAutoRenewTogglingId(null);
    }
  }

  const [autoRenewPromoInput, setAutoRenewPromoInput] = useState("");
  const [autoRenewPromoLoading, setAutoRenewPromoLoading] = useState(false);
  const [autoRenewPromoError, setAutoRenewPromoError] = useState<string | null>(null);
  const [autoRenewPromoSaved, setAutoRenewPromoSaved] = useState(false);

  useEffect(() => {
    setAutoRenewPromoInput(client?.autoRenewPromoCode ?? "");
    setAutoRenewPromoError(null);
    setAutoRenewPromoSaved(false);
  }, [client?.autoRenewPromoCode]);

  async function saveAutoRenewPromo(code: string | null) {
    if (!token) return;
    setAutoRenewPromoError(null);
    setAutoRenewPromoSaved(false);
    setAutoRenewPromoLoading(true);
    try {
      await api.clientUpdateAutoRenew(token, { promoCode: code });
      await refreshProfile();
      setAutoRenewPromoSaved(true);
      setTimeout(() => setAutoRenewPromoSaved(false), 2000);
    } catch (e) {
      setAutoRenewPromoError(e instanceof Error ? e.message : t("cabinet.dashboard.auto_renew_promo_error"));
    } finally {
      setAutoRenewPromoLoading(false);
    }
  }

  // T15 (26.05.2026, WolfVPN): при заходе грузим список доступных триалов.
  // Если их > 0 → кнопка «Бесплатный Тест» откроет модалку выбора.
  // Если бэк вернул items=[] AND hasAnyEnabled=false → нет новых триалов вообще, fallback на legacy /trial.
  // Если items=[] AND hasAnyEnabled=true → юзер уже всё использовал, модалку показывать не надо.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api.getClientAvailableTrials(token)
      .then((res) => {
        if (cancelled) return;
        setHasMultiTrials(res.items.length > 0);
      })
      .catch(() => {
        if (cancelled) return;
        setHasMultiTrials(false); // не смогли загрузить → не блокируем legacy
      });
    return () => { cancelled = true; };
  }, [token, refreshKey]);

  async function activateTrial() {
    if (!token) return;
    // Новый флоу: открываем модалку выбора.
    if (hasMultiTrials === true) {
      setTrialError(null);
      setTrialsPickerOpen(true);
      return;
    }
    // Legacy фоллбэк (старая single-trial система).
    setTrialError(null);
    setTrialLoading(true);
    try {
      await api.clientActivateTrial(token);
      await refreshProfile();
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setTrialError(e instanceof Error ? e.message : t("cabinet.dashboard.trial_error"));
    } finally {
      setTrialLoading(false);
    }
  }

  async function handleTrialActivated() {
    // После активации триала через модалку — обновляем профиль и подписку.
    await refreshProfile();
    setRefreshKey((k) => k + 1);
  }

  if (!client) return null;

  const subParsed = parseSubscription(subscription);
  const hasActiveSubscription =
    subscription && typeof subscription === "object" && (subParsed.status === "ACTIVE" || subParsed.status === undefined);
  const vpnUrl = subParsed.subscriptionUrl || null;
  // T-remna-connect (27.05.2026, WolfVPN): если включена настройка «Страница подписки Remna» —
  // кнопки «Подключиться» ведут напрямую на remna subscriptionUrl, а не на /cabinet/subscribe.
  const useRemnaPage = config?.useRemnaSubscriptionPage === true;
  // T-trial-coexist (27.05.2026, WolfVPN): новые мульти-триалы могут показываться
  // ВМЕСТЕ с активной подпиской — юзер мог взять Trial #1, потом купить тариф и захотеть
  // ещё пробников. Legacy single-trial (`config.trialEnabled`) — старая система,
  // показываем только когда нет активной подписки.
  const showMultiTrials = hasMultiTrials === true;
  const showLegacyTrial = !hasActiveSubscription && Boolean(config?.trialEnabled) && !client?.trialUsed && !showMultiTrials;
  const showAnyTrial = showMultiTrials || showLegacyTrial;
  const [referralCopied, setReferralCopied] = useState<"site" | "bot" | null>(null);
  const siteOrigin = config?.publicAppUrl?.replace(/\/$/, "") || (typeof window !== "undefined" ? window.location.origin : "");
  const referralLinkSite =
    client.referralCode && siteOrigin
      ? `${siteOrigin}/cabinet/register?ref=${encodeURIComponent(client.referralCode)}`
      : "";
  const referralLinkBot =
    client.referralCode && config?.telegramBotUsername
      ? `https://t.me/${config.telegramBotUsername.replace(/^@/, "")}?start=ref_${client.referralCode}`
      : "";
  const hasReferralLinks = Boolean(referralLinkSite || referralLinkBot);
  const copyReferral = (which: "site" | "bot") => {
    const url = which === "site" ? referralLinkSite : referralLinkBot;
    if (url) {
      navigator.clipboard.writeText(url);
      setReferralCopied(which);
      setTimeout(() => setReferralCopied(null), 2000);
    }
  };
  // ♻️ Автосписание по подпискам — общий узел для mobile/desktop карточки «Баланс».
  const anyAutoRenewOn = autoRenewSubs.some((s) => s.enabled);
  const autoRenewListNode = autoRenewSubs.length > 0 ? (
    <div className="relative overflow-hidden rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/[0.07] via-background/40 to-violet-500/[0.06] backdrop-blur-xl p-4 text-left space-y-3 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]">
      {/* мягкое свечение в углу */}
      <div className="pointer-events-none absolute -top-10 -right-10 h-28 w-28 rounded-full bg-primary/15 blur-3xl" aria-hidden />
      <div className="relative flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <Label className="text-sm font-semibold inline-flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/15 ring-1 ring-primary/20">
              <RotateCcw className="h-3.5 w-3.5 text-primary shrink-0" />
            </span>
            Автосписание
          </Label>
          {anyAutoRenewOn && autoRenewNext.amount != null ? (
            <span className="text-[11px] leading-tight text-muted-foreground">
              Ближайшее списание:{" "}
              <span className="font-bold tabular-nums text-foreground">
                {autoRenewNext.amount.toLocaleString("ru-RU")} {autoRenewNext.currency === "RUB" ? "₽" : autoRenewNext.currency === "USD" ? "$" : autoRenewNext.currency}
              </span>
              {autoRenewNext.at && (
                <> · {new Date(autoRenewNext.at).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}</>
              )}
            </span>
          ) : (
            <span className="text-[11px] leading-tight text-muted-foreground">
              {config?.yookassaRecurringEnabled
                ? <>Сначала с баланса{client.yookassaPaymentMethodTitle ? <>, затем с карты <span className="font-medium">{client.yookassaPaymentMethodTitle}</span></> : ", затем с карты"}</>
                : "Списание с баланса"
              }
            </span>
          )}
        </div>
        <span className={`mt-0.5 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ring-1 transition-colors ${anyAutoRenewOn ? "bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 ring-emerald-500/25" : "bg-muted/40 text-muted-foreground ring-border/50"}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${anyAutoRenewOn ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground/50"}`} />
          {anyAutoRenewOn ? "Активно" : "Выкл"}
        </span>
      </div>
      <div className="relative space-y-1.5">
        {autoRenewSubs.map((sub) => (
          <div
            key={sub.id}
            className={`group flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 transition-all duration-300 ${sub.enabled ? "bg-primary/[0.07] border-primary/20 shadow-[0_0_18px_-8px] shadow-primary/30" : "bg-background/40 border-border/40 hover:border-border/70"}`}
          >
            <span className="flex items-center gap-2.5 min-w-0">
              <span className={`h-2 w-2 shrink-0 rounded-full transition-colors duration-300 ${sub.enabled ? "bg-emerald-500 shadow-[0_0_8px] shadow-emerald-500/60" : "bg-muted-foreground/30"}`} />
              <span className="text-[13px] font-medium text-foreground/90 truncate">{sub.name}</span>
            </span>
            <span className="flex items-center gap-2 shrink-0">
              {autoRenewTogglingId === sub.id && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
              <Switch
                checked={sub.enabled}
                disabled={autoRenewTogglingId === sub.id}
                onCheckedChange={(v) => toggleSubAutoRenew(sub, v)}
                className="data-[state=checked]:bg-emerald-500"
              />
            </span>
          </div>
        ))}
      </div>
    </div>
  ) : null;

  const trafficPercent = subParsed.trafficLimitBytes != null && subParsed.trafficLimitBytes > 0 && subParsed.trafficUsed != null
    ? Math.min(100, Math.round((subParsed.trafficUsed / subParsed.trafficLimitBytes) * 100))
    : null;

  const expireDate = subParsed.expireAt ? (() => { try { const d = new Date(subParsed.expireAt); return Number.isNaN(d.getTime()) ? null : d; } catch { return null; } })() : null;
  const daysLeft = expireDate && expireDate > new Date()
    ? Math.max(0, Math.ceil((expireDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
    : null;

  // Компонент-состояние отсутствия подписки
  const NoSubscriptionState = () => (
    <div className="flex flex-col items-center justify-center py-8 text-center space-y-4">
      <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
        <Package className="h-8 w-8 text-primary/70" />
      </div>
      <div>
        <h3 className="text-lg font-semibold text-foreground">{t("cabinet.dashboard.no_subscription_title")}</h3>
        <p className="text-[14px] text-muted-foreground max-w-xs mt-2 mx-auto leading-relaxed">
          {t("cabinet.dashboard.no_subscription_desc")}
        </p>
      </div>
      <Button className="mt-2 shadow-lg h-11 px-6 rounded-xl hover:scale-105 transition-transform duration-300 [&_svg]:self-center [&_span]:leading-none" asChild>
        <Link to="/cabinet/tariffs" className="inline-flex items-center justify-center gap-2">
          <span className="inline-flex items-center leading-none">{t("cabinet.dashboard.choose_tariff")}</span>
        </Link>
      </Button>
      {/* T-expired-extend (WolfVPN, 2026-06-03): если главная подписка #0 истекла — даём продлить ИМЕННО её,
          а не только «Выбрать тариф». rootSubId есть всегда пока подписка #0 существует в БД (даже EXPIRED). */}
      {rootActionNode(
        "gap-2 h-11 px-6 rounded-xl bg-gradient-to-r from-primary via-fuchsia-500 to-purple-500 text-white border-0 shadow-lg shadow-primary/30 hover:opacity-90 [&_svg]:self-center [&_span]:leading-none",
        "h-4 w-4 shrink-0",
        "inline-flex items-center leading-none",
        "Продлить подписку #0",
      )}
    </div>
  );

  // T15 (26.05.2026, WolfVPN): модалка выбора триала — общая для mobile и desktop.
  const trialsPickerNode = (
    <TrialsPickerDialog
      open={trialsPickerOpen}
      token={token}
      onOpenChange={setTrialsPickerOpen}
      onActivated={handleTrialActivated}
    />
  );

  // единая кнопка действия root-подписки (для всех 3 мест рендера):
  // обычная → «Продлить» (модалка); триал → «Конвертировать» (выбор тарифа в каталоге);
  // триал с запрещённой конвертацией → кнопки нет вовсе.
  const rootActionNode = (cls: string, iconCls: string, txtCls: string, label = "Продлить") => {
    if (!rootSubId) return null;
    if (rootTrial.isTrial) {
      if (!rootTrial.convertEnabled) return null;
      return (
        <Button className={cls} asChild>
          <Link to={`/cabinet/tariffs?extend=${rootSubId}`} className="inline-flex items-center justify-center gap-1.5 leading-none">
            <RefreshCw className={iconCls} />
            <span className={txtCls}>Конвертировать</span>
          </Link>
        </Button>
      );
    }
    return (
      <Button className={cls} onClick={() => setExtendSubId(rootSubId)}>
        <RefreshCw className={iconCls} />
        <span className={txtCls}>{label}</span>
      </Button>
    );
  };

  // то же для ЛЮБОЙ secondary-подписки (унифицировано с root).
  const secActionNode = (sec: { id: string; trialId?: string | null; trialConvertEnabled?: boolean }, cls: string, iconCls: string, txtCls: string) => {
    if (sec.trialId) {
      if (sec.trialConvertEnabled === false) return null;
      return (
        <Button size="sm" className={cls} asChild>
          <Link to={`/cabinet/tariffs?extend=${sec.id}`} className="inline-flex items-center justify-center gap-1.5 leading-none">
            <RefreshCw className={iconCls} />
            <span className={txtCls}>Конвертировать</span>
          </Link>
        </Button>
      );
    }
    return (
      <Button size="sm" className={cls} onClick={() => setExtendSubId(sec.id)}>
        <RefreshCw className={iconCls} />
        <span className={txtCls}>Продлить</span>
      </Button>
    );
  };

  // модалка продления подписки (любой — единый механизм) без
  // редиректа в каталог. После балансовой оплаты обновляем данные дашборда.
  const extendDialogNode = extendSubId ? (
    <ExtendSubscriptionDialog
      subId={extendSubId}
      open
      onClose={() => setExtendSubId(null)}
      onPaidByBalance={() => setRefreshKey((k) => k + 1)}
    />
  ) : null;

  // T-pay-success-modal (WolfVPN): модалка успешной оплаты при возврате с платёжки — общая для mobile/desktop.
  const paySuccessModalNode = (
    <Dialog open={paySuccessModal !== null} onOpenChange={(o) => !o && setPaySuccessModal(null)}>
      <DialogContent className="sm:max-w-sm rounded-3xl border-white/10 bg-background/90 backdrop-blur-3xl overflow-hidden">
        <div className="absolute -top-16 left-1/2 -translate-x-1/2 h-40 w-40 rounded-full bg-emerald-500/25 blur-3xl pointer-events-none" />
        <div className="relative flex flex-col items-center gap-4 py-3 text-center">
          <motion.div
            initial={{ scale: 0, rotate: -25 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 16 }}
            className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-green-600 shadow-xl shadow-emerald-500/40"
          >
            <Check className="h-10 w-10 text-white" strokeWidth={3} />
          </motion.div>
          <DialogTitle className="text-2xl font-black tracking-tight text-foreground">Оплата прошла! ✨</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-muted-foreground px-2">
            {paySuccessModal === "topup"
              ? "Баланс пополнен — средства уже на счету."
              : paySuccessModal === "tariff"
                ? "Спасибо за покупку! Подписка активируется автоматически в течение минуты."
                : "Спасибо за покупку! Если подписка не появилась сразу — обновите страницу через минуту."}
          </DialogDescription>
          <Button
            onClick={() => setPaySuccessModal(null)}
            className="mt-1 w-full h-12 rounded-xl text-base font-bold border-0 text-white bg-gradient-to-r from-emerald-500 to-green-600 hover:opacity-90 [&_svg]:self-center [&_span]:leading-none"
          >
            Отлично
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );

  if (isMiniapp) {
    return (
      <>
      <div className="w-full min-w-0 overflow-hidden flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
        {(paymentMessage === "success" || paymentMessage === "success_topup" || paymentMessage === "success_tariff") && (
          <div className="rounded-xl bg-green-500/15 backdrop-blur-md border border-green-500/30 px-4 py-3 text-sm font-medium text-green-700 dark:text-green-400 shadow-sm">
            {paymentMessage === "success_topup"
              ? "Оплата прошла успешно. Баланс пополнен."
              : paymentMessage === "success_tariff"
                ? "Оплата прошла успешно. Тариф активируется автоматически."
                : "Оплата прошла успешно. Статус обновляется автоматически."}
          </div>
        )}
        {paymentMessage === "failed" && (
          <div className="rounded-xl bg-destructive/15 backdrop-blur-md border border-destructive/30 px-4 py-3 text-sm font-medium text-destructive shadow-sm">
            Оплата не прошла. Попробуйте снова.
          </div>
        )}
        {giftRedeemMessage && (
          <div className={`rounded-xl backdrop-blur-md px-4 py-3 text-sm font-medium shadow-sm ${giftRedeemMessage.type === "success" ? "bg-green-500/15 border border-green-500/30 text-green-700 dark:text-green-400" : "bg-destructive/15 border border-destructive/30 text-destructive"}`}>
            {giftRedeemMessage.type === "success" ? "🎁 " : "❌ "}{giftRedeemMessage.text}
          </div>
        )}

        {config?.botInfoBlock?.trim() && (
          <div className="rounded-2xl border border-primary/30 bg-primary/5 backdrop-blur-md px-4 py-3 text-sm whitespace-pre-line shadow-sm">
            {config.botInfoBlock.trim()}
          </div>
        )}

        {/* 1. Статус, срок, тариф, трафик, устройства — с иконками */}
        <section data-tour="subscription" className="order-1 rounded-3xl border border-border/50 bg-card/40 backdrop-blur-xl p-5 shadow-sm overflow-hidden transition-all duration-300">
          <h2 className="flex items-center justify-between gap-2 text-[13px] font-semibold uppercase tracking-wider text-muted-foreground/80 mb-5">
            <span className="flex items-center gap-2 min-w-0">
              <span className="inline-flex p-1.5 bg-primary/20 rounded-lg shrink-0">
                <Zap className="h-4 w-4 shrink-0 text-primary" />
              </span>
              <span className="truncate">{t("cabinet.dashboard.subscription_status")}</span>
            </span>
            {rootActionNode(
              "shrink-0 gap-1.5 rounded-full h-8 px-3 bg-gradient-to-r from-primary via-fuchsia-500 to-purple-500 text-white border-0 shadow-md shadow-primary/30 hover:opacity-90 normal-case [&_svg]:self-center [&_span]:leading-none",
              "h-3.5 w-3.5 shrink-0",
              "inline-flex items-center text-xs font-medium leading-none",
            )}
          </h2>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary/50" />
            </div>
          ) : subscriptionError || !subscription || typeof subscription !== "object" ? (
            <NoSubscriptionState />
          ) : (
            <div className="space-y-4 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                {hasActiveSubscription ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold bg-green-500/20 text-green-700 dark:text-green-400 border border-green-500/20">
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                    {t("cabinet.dashboard.active")}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/20">
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                    Истекла
                  </span>
                )}
                {daysLeft != null && (
                  <span className="text-sm font-semibold text-foreground bg-foreground/5 px-3 py-1.5 rounded-full border border-border/50">
                    {t("cabinet.dashboard.days_left")} {daysLeft} {daysLeft === 1 ? t("cabinet.common.day_one") : daysLeft < 5 ? t("cabinet.common.day_few") : t("cabinet.common.day_many")}
                  </span>
                )}
                {subParsed.hwidDeviceLimit != null && subParsed.hwidDeviceLimit > 0 && deviceCount != null && (
                  <span className="text-sm font-semibold text-foreground bg-primary/10 text-primary px-3 py-1.5 rounded-full border border-primary/20 flex items-center gap-1.5">
                    <Smartphone className="h-4 w-4" /> {deviceCount} / {subParsed.hwidDeviceLimit}
                  </span>
                )}
              </div>

              <div className="space-y-3 border-t border-border/50 pt-4 mt-2">
                {((tariffDisplayName ?? subParsed.productName) || client?.trialUsed) && (
                  <div className="flex items-center gap-4 bg-background/40 p-3.5 rounded-2xl border border-border/50 transition-colors hover:bg-background/60 shadow-sm">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Package className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">{rootTrial.isTrial ? "TRIAL" : t("cabinet.dashboard.tariff_label")}</p>
                      <p className="text-[14px] font-semibold truncate text-foreground" title={((tariffDisplayName ?? subParsed.productName?.trim() ?? "").trim()) || t("cabinet.dashboard.test_label")}>
                        {((tariffDisplayName ?? subParsed.productName?.trim() ?? "").trim()) || t("cabinet.dashboard.test_label")}
                      </p>
                    </div>
                  </div>
                )}
                {subParsed.expireAt && (
                  <div className="flex items-center gap-4 bg-background/40 p-3.5 rounded-2xl border border-border/50 transition-colors hover:bg-background/60 shadow-sm">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Calendar className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">{t("cabinet.dashboard.valid_until")}</p>
                      <p className="text-[14px] font-semibold text-foreground">
                        {formatDate(subParsed.expireAt)}
                      </p>
                    </div>
                  </div>
                )}
                <div className="bg-background/40 p-3.5 rounded-2xl border border-border/50 space-y-3 transition-colors hover:bg-background/60 shadow-sm">
                  <div className="flex items-center gap-4">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Wifi className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">{t("cabinet.dashboard.traffic")}</p>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[14px] font-semibold text-foreground">
                          {subParsed.trafficLimitBytes != null && subParsed.trafficLimitBytes > 0
                            ? `${formatBytes(subParsed.trafficUsed ?? 0)} / ${formatBytes(subParsed.trafficLimitBytes)}`
                            : t("cabinet.dashboard.unlimited")}
                        </p>
                        {trafficPercent != null && <span className="text-[12px] font-bold text-muted-foreground">{trafficPercent}%</span>}
                      </div>
                    </div>
                  </div>
                  {trafficPercent != null && (
                    <div className="h-2 w-full rounded-full bg-muted/30 overflow-hidden">
                      <div className="h-full rounded-full bg-primary transition-all duration-500 ease-in-out" style={{ width: `${trafficPercent}%` }} />
                    </div>
                  )}
                </div>
              </div>
              {/* T-main-connect (WolfVPN): ссылка подписки + кнопка «Подключиться» прямо в карточке основной подписки (как у доп.подписок) */}
              {vpnUrl && (
                <>
                  <div className="flex gap-2 min-w-0 pt-1">
                    <code className="flex-1 min-w-0 truncate rounded-xl bg-background/50 border border-border/50 px-3 py-2.5 text-xs font-mono flex items-center text-foreground/80" title={vpnUrl}>
                      {vpnUrl}
                    </code>
                    <Button size="icon" variant="outline" className="shrink-0 h-auto w-11 rounded-xl bg-background/50 hover:bg-background/80 transition-transform hover:scale-105" onClick={() => { navigator.clipboard.writeText(vpnUrl || ""); window.Telegram?.WebApp?.showPopup?.({ title: t("cabinet.dashboard.copied_title"), message: t("cabinet.dashboard.copied_message") }); }}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="pt-1">
                    <Button className="w-full gap-2 shadow-lg h-12 rounded-xl text-md hover:scale-[1.02] transition-transform duration-300 [&_svg]:self-center [&_span]:leading-none bg-gradient-to-r from-primary via-fuchsia-500 to-purple-500 text-white border-0" asChild>
                      {useRemnaPage && vpnUrl ? (
                        <a href={vpnUrl} target="_blank" rel="noopener noreferrer" className="inline-flex w-full items-center justify-center gap-2">
                          <Wifi className="h-5 w-5 shrink-0" />
                          <span className="inline-flex items-center leading-none">Подключиться</span>
                        </a>
                      ) : (
                        <Link to="/cabinet/subscribe" className="inline-flex w-full items-center justify-center gap-2">
                          <Wifi className="h-5 w-5 shrink-0" />
                          <span className="inline-flex items-center leading-none">Подключиться</span>
                        </Link>
                      )}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </section>

        {secondarySubscriptions.length > 0 && secondarySubscriptions.map((sec) => {
          const secParsed = parseSubscription(sec.subscription);
          const secHasActive = sec.subscription && typeof sec.subscription === "object" && (secParsed.status === "ACTIVE" || secParsed.status === undefined);
          const secExpireDate = secParsed.expireAt ? new Date(secParsed.expireAt) : null;
          const secDaysLeft = secExpireDate && secExpireDate > new Date() ? Math.max(0, Math.ceil((secExpireDate.getTime() - Date.now()) / (24*60*60*1000))) : null;
          const secTrafficPercent = secParsed.trafficLimitBytes && secParsed.trafficLimitBytes > 0 && secParsed.trafficUsed != null ? Math.min(100, Math.round((secParsed.trafficUsed / secParsed.trafficLimitBytes) * 100)) : null;

          return (
            <section key={sec.id} className="order-3 rounded-3xl border border-indigo-500/30 bg-card/40 backdrop-blur-xl p-5 shadow-sm overflow-hidden transition-all duration-300">
              <h2 className="flex items-center justify-between gap-2 text-[13px] font-semibold uppercase tracking-wider text-muted-foreground/80 mb-4">
                <span className="flex items-center gap-2 min-w-0">
                  <span className="inline-flex p-1.5 bg-indigo-500/20 rounded-lg shrink-0">
                    <Package className="h-4 w-4 shrink-0 text-indigo-400" />
                  </span>
                  <span className="truncate">Подписка #{sec.subscriptionIndex ?? ""}</span>
                </span>
                {secActionNode(
                  sec,
                  "shrink-0 gap-1.5 rounded-full h-8 px-3 bg-gradient-to-r from-indigo-500 to-purple-500 text-white border-0 shadow-md shadow-indigo-500/30 hover:opacity-90 normal-case [&_svg]:self-center [&_span]:leading-none",
                  "h-3.5 w-3.5 shrink-0",
                  "inline-flex items-center text-xs font-medium leading-none",
                )}
              </h2>

              <div className="space-y-4 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {secHasActive ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold bg-indigo-500/20 text-indigo-400 border border-indigo-500/20">
                      <span className="h-1.5 w-1.5 rounded-full bg-current" />
                      Активна
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/20">
                      <span className="h-1.5 w-1.5 rounded-full bg-current" />
                      Истекла
                    </span>
                  )}
                  {secDaysLeft != null && (
                    <span className="text-sm font-semibold text-foreground bg-foreground/5 px-3 py-1.5 rounded-full border border-border/50">
                      {t("cabinet.dashboard.days_left")} {secDaysLeft} {secDaysLeft === 1 ? t("cabinet.common.day_one") : secDaysLeft < 5 ? t("cabinet.common.day_few") : t("cabinet.common.day_many")}
                    </span>
                  )}
                  {secParsed.hwidDeviceLimit != null && secParsed.hwidDeviceLimit > 0 && (
                    <span className="text-sm font-semibold text-foreground bg-indigo-500/10 text-indigo-400 px-3 py-1.5 rounded-full border border-indigo-500/20 flex items-center gap-1.5">
                      <Smartphone className="h-4 w-4" /> {devicesBySubId[sec.id] ?? 0} / {secParsed.hwidDeviceLimit}
                    </span>
                  )}
                </div>

                <div className="space-y-3 border-t border-border/50 pt-4 mt-2">
                  {sec.tariffDisplayName && (
                    <div className="flex items-center gap-4 bg-background/40 p-3.5 rounded-2xl border border-border/50 transition-colors hover:bg-background/60 shadow-sm">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400">
                        <Package className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">{sec.trialId ? "TRIAL" : t("cabinet.dashboard.tariff_label")}</p>
                        <p className="text-[14px] font-semibold truncate text-foreground" title={sec.tariffDisplayName}>
                          {sec.tariffDisplayName}
                        </p>
                      </div>
                    </div>
                  )}
                  {secParsed.expireAt && (
                    <div className="flex items-center gap-4 bg-background/40 p-3.5 rounded-2xl border border-border/50 transition-colors hover:bg-background/60 shadow-sm">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400">
                        <Calendar className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">{t("cabinet.dashboard.valid_until")}</p>
                        <p className="text-[14px] font-semibold text-foreground">
                          {formatDate(secParsed.expireAt)}
                        </p>
                      </div>
                    </div>
                  )}
                  <div className="bg-background/40 p-3.5 rounded-2xl border border-border/50 space-y-3 transition-colors hover:bg-background/60 shadow-sm">
                    <div className="flex items-center gap-4">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400">
                        <Wifi className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">{t("cabinet.dashboard.traffic")}</p>
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[14px] font-semibold text-foreground">
                            {secParsed.trafficLimitBytes != null && secParsed.trafficLimitBytes > 0
                              ? `${formatBytes(secParsed.trafficUsed ?? 0)} / ${formatBytes(secParsed.trafficLimitBytes)}`
                              : t("cabinet.dashboard.unlimited")}
                          </p>
                          {secTrafficPercent != null && <span className="text-[12px] font-bold text-muted-foreground">{secTrafficPercent}%</span>}
                        </div>
                      </div>
                    </div>
                    {secTrafficPercent != null && (
                      <div className="h-2 w-full rounded-full bg-muted/30 overflow-hidden">
                        <div className="h-full rounded-full bg-indigo-500 transition-all duration-500 ease-in-out" style={{ width: `${secTrafficPercent}%` }} />
                      </div>
                    )}
                  </div>
                </div>

                {/* T-sub-link (WolfVPN, 2026-06-03): ссылка подписки доп.подписки + копирование прямо на главной (без захода в «Подключиться»). */}
                {secParsed.subscriptionUrl && (
                  <div className="flex gap-2 min-w-0 pt-1">
                    <code className="flex-1 min-w-0 truncate rounded-xl bg-background/50 border border-border/50 px-3 py-2.5 text-xs font-mono flex items-center text-foreground/80" title={secParsed.subscriptionUrl}>
                      {secParsed.subscriptionUrl}
                    </code>
                    <Button size="icon" variant="outline" className="shrink-0 h-auto w-11 rounded-xl bg-background/50 hover:bg-background/80 transition-transform hover:scale-105" onClick={() => { navigator.clipboard.writeText(secParsed.subscriptionUrl || ""); window.Telegram?.WebApp?.showPopup?.({ title: t("cabinet.dashboard.copied_title"), message: t("cabinet.dashboard.copied_message") }); }}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                )}
                <div className="pt-2 flex flex-col sm:flex-row gap-2">
                  <Button className="flex-1 gap-2 shadow-lg h-12 rounded-xl text-md hover:scale-[1.02] transition-transform duration-300 [&_svg]:self-center [&_span]:leading-none bg-indigo-600 hover:bg-indigo-700 text-white" asChild>
                    {useRemnaPage && secParsed.subscriptionUrl ? (
                      <a href={secParsed.subscriptionUrl} target="_blank" rel="noopener noreferrer" className="inline-flex w-full items-center justify-center gap-2">
                        <Wifi className="h-5 w-5 shrink-0" />
                        <span className="inline-flex items-center leading-none">Подключиться</span>
                      </a>
                    ) : (
                      <Link to={`/cabinet/subscribe?uuid=${sec.remnawaveUuid}`} className="inline-flex w-full items-center justify-center gap-2">
                        <Wifi className="h-5 w-5 shrink-0" />
                        <span className="inline-flex items-center leading-none">Подключиться</span>
                      </Link>
                    )}
                  </Button>
                </div>
              </div>
            </section>
          );
        })}

        {/* 2. Как подключиться — показываем ТОЛЬКО когда нет активной ссылки (триал/выбор тарифа)
            или есть доп.пробники. При активной подписке блок скрыт — подключение уже в её карточке. */}
        {(!vpnUrl || showMultiTrials) && (
        <section className="order-first rounded-3xl border border-border/50 bg-card/40 backdrop-blur-xl p-5 shadow-sm overflow-hidden transition-all duration-300">
          <h2 className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-muted-foreground/80 mb-4">
             <div className="p-1.5 bg-primary/20 rounded-lg">
              <Wifi className="h-4 w-4 shrink-0 text-primary" />
            </div>
            {t("cabinet.dashboard.connection")}
          </h2>
          {vpnUrl ? (
            <div className="space-y-4">
              {showMultiTrials && (
                <Button className="w-full gap-2 bg-green-600 hover:bg-green-700 text-white shadow-lg h-12 rounded-xl hover:scale-[1.02] transition-transform duration-300 [&_svg]:self-center [&_span]:leading-none" onClick={activateTrial} disabled={trialLoading}>
                  {trialLoading ? <Loader2 className="h-5 w-5 shrink-0 animate-spin" /> : <Gift className="h-5 w-5 shrink-0" />}
                  <span className="inline-flex items-center leading-none font-medium text-base">{t("cabinet.dashboard.free_trial")}</span>
                </Button>
              )}
              {trialError && <p className="text-sm text-destructive break-words text-center">{trialError}</p>}
            </div>
          ) : showAnyTrial ? (
            <div className="space-y-4 text-center">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10 text-green-600 mb-2">
                 <Gift className="h-6 w-6" />
              </div>
              <p className="text-[14px] text-muted-foreground">
                {showMultiTrials
                  ? "Возьми бесплатный пробник — попробуй VPN без оплаты"
                  : `${t("cabinet.dashboard.free_trial_desc")} ${formatRuDays(trialDays)}.`}
              </p>
              <Button className="w-full gap-2 bg-green-600 hover:bg-green-700 text-white shadow-lg h-12 rounded-xl hover:scale-[1.02] transition-transform duration-300 [&_svg]:self-center [&_span]:leading-none" onClick={activateTrial} disabled={trialLoading}>
                {trialLoading ? <Loader2 className="h-5 w-5 shrink-0 animate-spin" /> : <Gift className="h-5 w-5 shrink-0" />}
                <span className="inline-flex items-center leading-none font-medium text-base">{t("cabinet.dashboard.free_trial")}</span>
              </Button>
              {trialError && <p className="text-sm text-destructive break-words text-center">{trialError}</p>}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="p-4 bg-primary/10 rounded-2xl border border-primary/20 text-[14px] text-primary flex gap-3 items-start">
                <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
                <p className="leading-relaxed">{t("cabinet.dashboard.link_after_payment")}</p>
              </div>
              <Button className="w-full shadow-md rounded-xl hover:scale-[1.02] transition-transform duration-300 h-12 [&_svg]:self-center [&_span]:leading-none" variant="default" asChild>
                <Link to="/cabinet/tariffs" className="inline-flex w-full items-center justify-center gap-2">
                  <span className="inline-flex items-center leading-none">{t("cabinet.dashboard.choose_tariff")}</span>
                </Link>
              </Button>
            </div>
          )}
        </section>
        )}

        {/* 3. Баланс — order-2: сразу под основной подпиской (mobile) */}
        <section data-tour="balance" className="order-2 rounded-3xl border border-border/50 bg-card/40 backdrop-blur-xl p-5 shadow-sm overflow-hidden transition-all duration-300 flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-primary/20 rounded-xl">
              <Wallet className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground/80">{t("cabinet.dashboard.my_balance")}</h2>
              <p className="text-2xl font-bold tracking-tight text-foreground leading-none mt-1">{formatMoney(client.balance, client.preferredCurrency)}</p>
            </div>
          </div>
          {autoRenewListNode}
          {anyAutoRenewOn && (
            <div className="flex items-center gap-2 p-2.5 pl-3 rounded-2xl bg-background/40 border border-border/50">
              <Tag className="h-4 w-4 text-primary shrink-0" />
              <Input
                value={autoRenewPromoInput}
                onChange={(e) => { setAutoRenewPromoInput(e.target.value.toUpperCase()); setAutoRenewPromoError(null); setAutoRenewPromoSaved(false); }}
                placeholder={t("cabinet.dashboard.auto_renew_promo_placeholder")}
                className="h-8 bg-transparent border-0 px-0 text-sm font-mono uppercase focus-visible:ring-0 placeholder:text-muted-foreground/60 shadow-none"
                disabled={autoRenewPromoLoading}
                title={t("cabinet.dashboard.auto_renew_promo_hint")}
              />
              {autoRenewPromoLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
              ) : autoRenewPromoSaved ? (
                <Check className="h-4 w-4 text-emerald-500 dark:text-emerald-400 shrink-0" />
              ) : client.autoRenewPromoCode && autoRenewPromoInput === client.autoRenewPromoCode ? (
                <button
                  type="button"
                  onClick={() => saveAutoRenewPromo(null)}
                  className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-red-500 dark:hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
                  title={t("cabinet.dashboard.auto_renew_promo_remove")}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!autoRenewPromoInput.trim()}
                  onClick={() => saveAutoRenewPromo(autoRenewPromoInput.trim())}
                  className="h-7 px-3 rounded-lg text-[11px] font-bold uppercase tracking-wider bg-primary/15 hover:bg-primary/25 text-primary disabled:opacity-40 disabled:hover:bg-primary/15 transition-colors shrink-0"
                >
                  {t("cabinet.dashboard.auto_renew_promo_save")}
                </button>
              )}
            </div>
          )}
          {anyAutoRenewOn && autoRenewPromoError && (
            <p className="text-[11px] font-medium text-red-500 dark:text-red-400 -mt-2">{autoRenewPromoError}</p>
          )}
          <Button className="w-full gap-2 shadow-md hover:scale-[1.02] transition-transform duration-300 rounded-xl h-12 [&_svg]:self-center [&_span]:leading-none" asChild>
            <Link to="/cabinet/profile#topup" className="inline-flex w-full items-center justify-center gap-2">
              <PlusCircle className="h-5 w-5 shrink-0" />
              <span className="inline-flex items-center leading-none">{t("cabinet.dashboard.top_up")}</span>
            </Link>
          </Button>
        </section>
      </div>
      {trialsPickerNode}
      {paySuccessModalNode}
      {extendDialogNode}
      </>
    );
  }

  // DESKTOP LAYOUT
  return (
    <>
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-6xl mx-auto">
      {/* Hero + CTA */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="relative overflow-hidden rounded-3xl bg-card/40 backdrop-blur-2xl border border-border/50 p-8 sm:p-10 shadow-xl"
      >
        {/* Декоративное свечение */}
        <div className="absolute top-0 right-0 -mr-20 -mt-20 w-64 h-64 rounded-full bg-primary/20 blur-[80px] pointer-events-none" />
        
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-8">
          <div className="flex-1">
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl text-foreground">
              {t("cabinet.dashboard.welcome")}{client.email ? `, ${client.email.split("@")[0]}` : client.telegramUsername ? `, @${client.telegramUsername}` : ""}
            </h1>
            <p className="mt-3 text-[16px] text-muted-foreground max-w-xl leading-relaxed">
              {hasActiveSubscription
                ? t("cabinet.dashboard.sub_active_desc")
                : t("cabinet.dashboard.sub_inactive_desc")}
            </p>
            
            {(paymentMessage === "success" || paymentMessage === "success_topup" || paymentMessage === "success_tariff") && (
              <div className="mt-4 inline-flex items-center gap-2 bg-green-500/15 border border-green-500/30 px-4 py-2 rounded-xl text-green-700 dark:text-green-400 font-medium text-sm">
                <Check className="h-4 w-4" />
                {t("cabinet.dashboard.payment_success")}
              </div>
            )}
            {paymentMessage === "failed" && (
              <div className="mt-4 inline-flex items-center gap-2 bg-destructive/15 border border-destructive/30 px-4 py-2 rounded-xl text-destructive font-medium text-sm">
                <AlertCircle className="h-4 w-4" />
                {t("cabinet.dashboard.payment_failed")}
              </div>
            )}
            {giftRedeemMessage && (
              <div className={`mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl font-medium text-sm ${giftRedeemMessage.type === "success" ? "bg-green-500/15 border border-green-500/30 text-green-700 dark:text-green-400" : "bg-destructive/15 border border-destructive/30 text-destructive"}`}>
                {giftRedeemMessage.type === "success" ? "🎁" : "❌"} {giftRedeemMessage.text}
              </div>
            )}
            {trialError && <p className="mt-3 text-sm text-destructive font-medium">{trialError}</p>}
          </div>

          <div className="flex flex-col sm:flex-row md:flex-col gap-3 shrink-0 min-w-[240px]">
            {/* T-trial-coexist (27.05.2026, WolfVPN): «Бесплатный Тест» (мульти-триал) и
                «Подключиться» могут показываться ВМЕСТЕ. Legacy single-trial — только когда нет подписки. */}
            {/* T-main-connect (WolfVPN): кнопка «Подключиться к VPN» убрана из hero — теперь она в карточке основной подписки (со ссылкой) */}
            {showAnyTrial && (
              <Button size="lg" className="w-full gap-2 shadow-xl bg-green-600 hover:bg-green-700 text-white rounded-xl h-14 hover:scale-105 transition-transform [&_svg]:self-center [&_span]:leading-none" onClick={activateTrial} disabled={trialLoading}>
                {trialLoading ? <Loader2 className="h-5 w-5 shrink-0 animate-spin" /> : <Gift className="h-5 w-5 shrink-0" />}
                <span className="inline-flex items-center text-base font-medium leading-none">{t("cabinet.dashboard.free_trial")}</span>
              </Button>
            )}
            {!vpnUrl && !showAnyTrial && (
              <Button size="lg" variant="default" className="w-full gap-2 shadow-xl rounded-xl h-14 hover:scale-105 transition-transform [&_svg]:self-center [&_span]:leading-none" asChild>
                <Link to="/cabinet/tariffs" className="inline-flex items-center justify-center gap-2 leading-none">
                  <Package className="h-5 w-5 shrink-0" />
                  <span className="inline-flex items-center text-base font-medium leading-none">{t("cabinet.dashboard.choose_tariff")}</span>
                </Link>
              </Button>
            )}
            <Button variant="secondary" size="lg" className="w-full gap-2 rounded-xl h-14 hover:scale-105 transition-transform bg-background/50 hover:bg-background/80 border border-border/50 [&_svg]:self-center [&_span]:leading-none" asChild>
              <Link to="/cabinet/profile#topup" className="inline-flex items-center justify-center gap-2 leading-none">
                <PlusCircle className="h-5 w-5 shrink-0 text-foreground/70" />
                <span className="inline-flex items-center text-base font-medium leading-none">{t("cabinet.dashboard.top_up")}</span>
              </Link>
            </Button>
          </div>
        </div>
      </motion.section>

      {config?.botInfoBlock?.trim() && (
        <div className="rounded-2xl border border-primary/30 bg-primary/5 backdrop-blur-md px-5 py-4 text-sm whitespace-pre-line shadow-sm">
          {config.botInfoBlock.trim()}
        </div>
      )}

      {/* Cards grid */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {/* Подписка / тариф */}
        <Card data-tour="subscription" className="rounded-3xl border border-border/50 bg-card/40 backdrop-blur-xl shadow-lg hover:shadow-xl transition-all duration-300 sm:col-span-2 lg:col-span-1 flex flex-col">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center justify-between gap-2 text-xl text-foreground">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2.5 bg-primary/20 rounded-xl shrink-0">
                  <Package className="h-6 w-6 text-primary" />
                </div>
                <span className="truncate">{t("cabinet.dashboard.my_subscription")}</span>
              </div>
              {rootActionNode(
                "shrink-0 gap-1.5 rounded-full h-9 px-4 bg-gradient-to-r from-primary via-fuchsia-500 to-purple-500 text-white border-0 shadow-md shadow-primary/30 hover:opacity-90 hover:scale-105 transition-transform [&_svg]:self-center [&_span]:leading-none",
                "h-4 w-4 shrink-0",
                "inline-flex items-center text-sm font-medium leading-none",
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col justify-center">
            {loading ? (
              <div className="flex justify-center py-6"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
            ) : subscriptionError || !subscription || typeof subscription !== "object" ? (
              <NoSubscriptionState />
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  {hasActiveSubscription ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-semibold bg-green-500/15 text-green-700 dark:text-green-400 border border-green-500/20">
                      <span className="h-1.5 w-1.5 rounded-full bg-current" />
                      {t("cabinet.dashboard.active")}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-semibold bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/20">
                      <span className="h-1.5 w-1.5 rounded-full bg-current" />
                      Истекла
                    </span>
                  )}
                  {daysLeft != null && (
                    <span className="text-sm font-semibold text-foreground bg-foreground/5 px-3 py-1.5 rounded-full border border-border/50 shadow-sm">
                      {daysLeft} {daysLeft === 1 ? t("cabinet.common.day_one") : daysLeft < 5 ? t("cabinet.common.day_few") : t("cabinet.common.day_many")}
                    </span>
                  )}
                  {subParsed.hwidDeviceLimit != null && subParsed.hwidDeviceLimit > 0 && deviceCount != null && (
                    <span className="text-sm font-semibold text-foreground bg-primary/10 text-primary px-3 py-1.5 rounded-full border border-primary/20 shadow-sm flex items-center gap-1.5">
                      <Smartphone className="h-4 w-4" /> {deviceCount} / {subParsed.hwidDeviceLimit}
                    </span>
                  )}
                </div>
                {((tariffDisplayName ?? subParsed.productName) || client?.trialUsed) && (
                  <div className="flex items-center gap-4 bg-background/40 p-4 rounded-2xl border border-border/50 transition-colors hover:bg-background/60 shadow-sm">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Package className="h-6 w-6" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">{rootTrial.isTrial ? "TRIAL" : t("cabinet.dashboard.tariff_label")}</p>
                      <p className="text-[15px] font-semibold truncate text-foreground">
                        {((tariffDisplayName ?? subParsed.productName?.trim() ?? "").trim()) || t("cabinet.dashboard.test_label")}
                      </p>
                    </div>
                  </div>
                )}
                {subParsed.expireAt && (
                  <div className="flex items-center gap-4 bg-background/40 p-4 rounded-2xl border border-border/50 transition-colors hover:bg-background/60 shadow-sm">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Calendar className="h-6 w-6" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">{t("cabinet.dashboard.valid_until")}</p>
                      <p className="text-[15px] font-semibold text-foreground">
                        {formatDate(subParsed.expireAt)}
                      </p>
                    </div>
                  </div>
                )}
                <div className="bg-background/40 p-4 rounded-2xl border border-border/50 space-y-3 transition-colors hover:bg-background/60 shadow-sm">
                  <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Wifi className="h-6 w-6" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">{t("cabinet.dashboard.traffic")}</p>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[15px] font-semibold text-foreground">
                          {subParsed.trafficLimitBytes != null && subParsed.trafficLimitBytes > 0
                            ? `${formatBytes(subParsed.trafficUsed ?? 0)} / ${formatBytes(subParsed.trafficLimitBytes)}`
                            : t("cabinet.dashboard.unlimited")}
                        </p>
                        {trafficPercent != null && <span className="text-[13px] font-bold text-muted-foreground">{trafficPercent}%</span>}
                      </div>
                    </div>
                  </div>
                  {trafficPercent != null && (
                    <div className="h-2 w-full rounded-full bg-muted/30 overflow-hidden">
                      <div className="h-full rounded-full bg-primary transition-all duration-500 ease-in-out" style={{ width: `${trafficPercent}%` }} />
                    </div>
                  )}
                </div>
                {/* T-main-connect (WolfVPN): ссылка подписки + кнопка «Подключиться» в карточке основной подписки (desktop) */}
                {vpnUrl && (
                  <>
                    <div className="flex gap-2 min-w-0">
                      <code className="flex-1 min-w-0 truncate rounded-xl bg-background/50 border border-border/50 px-3 py-2.5 text-xs font-mono flex items-center text-foreground/80" title={vpnUrl}>
                        {vpnUrl}
                      </code>
                      <Button size="icon" variant="outline" className="shrink-0 h-auto w-11 rounded-xl bg-background/50 hover:bg-background/80 transition-transform hover:scale-105" onClick={() => { navigator.clipboard.writeText(vpnUrl || ""); }}>
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                    <Button className="w-full gap-2 shadow-lg h-12 rounded-xl text-md hover:scale-[1.02] transition-transform [&_svg]:self-center [&_span]:leading-none bg-gradient-to-r from-primary via-fuchsia-500 to-purple-500 text-white border-0" asChild>
                      {useRemnaPage && vpnUrl ? (
                        <a href={vpnUrl} target="_blank" rel="noopener noreferrer" className="inline-flex w-full items-center justify-center gap-2">
                          <Wifi className="h-5 w-5 shrink-0" />
                          <span className="inline-flex items-center leading-none">Подключиться</span>
                        </a>
                      ) : (
                        <Link to="/cabinet/subscribe" className="inline-flex w-full items-center justify-center gap-2">
                          <Wifi className="h-5 w-5 shrink-0" />
                          <span className="inline-flex items-center leading-none">Подключиться</span>
                        </Link>
                      )}
                    </Button>
                  </>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Баланс + пополнение */}
        <Card data-tour="balance" className="group relative overflow-hidden rounded-3xl border border-primary/15 bg-card/40 backdrop-blur-xl shadow-lg hover:shadow-xl hover:border-primary/30 transition-all duration-500 flex flex-col justify-between">
          {/* декоративные блобы */}
          <div className="pointer-events-none absolute -top-20 -right-16 h-48 w-48 rounded-full bg-primary/15 blur-3xl transition-opacity duration-700 group-hover:opacity-100 opacity-60" aria-hidden />
          <div className="pointer-events-none absolute -bottom-24 -left-16 h-48 w-48 rounded-full bg-violet-500/10 blur-3xl" aria-hidden />
          {/* градиентный хайлайт по верхней кромке */}
          <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" aria-hidden />
          <CardHeader className="relative pb-4">
            <CardTitle className="flex items-center gap-3 text-xl text-foreground">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-primary/25 to-violet-500/20 ring-1 ring-primary/25 shadow-[0_0_20px_-6px] shadow-primary/40">
                <Wallet className="h-6 w-6 text-primary" />
              </div>
              {t("cabinet.dashboard.balance")}
            </CardTitle>
          </CardHeader>
          <CardContent className="relative space-y-6 flex-1 flex flex-col justify-center text-center">
            <div>
              <p className="bg-gradient-to-br from-foreground via-foreground to-primary bg-clip-text text-transparent text-5xl font-extrabold tracking-tight tabular-nums drop-shadow-sm">
                {formatMoney(client.balance, client.preferredCurrency)}
              </p>
              <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-background/40 border border-border/40 px-3 py-1 text-[12px] text-muted-foreground">
                <Sparkles className="h-3 w-3 text-primary/70" />
                На счету для продления тарифов
              </span>
            </div>

            {autoRenewListNode}

            {anyAutoRenewOn && (
              <div className="flex items-center gap-2 p-3 pl-4 rounded-2xl bg-background/40 border border-border/50">
                <Tag className="h-4 w-4 text-primary shrink-0" />
                <Input
                  value={autoRenewPromoInput}
                  onChange={(e) => { setAutoRenewPromoInput(e.target.value.toUpperCase()); setAutoRenewPromoError(null); setAutoRenewPromoSaved(false); }}
                  placeholder={t("cabinet.dashboard.auto_renew_promo_placeholder")}
                  className="h-9 bg-transparent border-0 px-0 text-sm font-mono uppercase focus-visible:ring-0 placeholder:text-muted-foreground/60 shadow-none"
                  disabled={autoRenewPromoLoading}
                  title={t("cabinet.dashboard.auto_renew_promo_hint")}
                />
                {autoRenewPromoLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                ) : autoRenewPromoSaved ? (
                  <Check className="h-4 w-4 text-emerald-500 dark:text-emerald-400 shrink-0" />
                ) : client.autoRenewPromoCode && autoRenewPromoInput === client.autoRenewPromoCode ? (
                  <button
                    type="button"
                    onClick={() => saveAutoRenewPromo(null)}
                    className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-red-500 dark:hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
                    title={t("cabinet.dashboard.auto_renew_promo_remove")}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={!autoRenewPromoInput.trim()}
                    onClick={() => saveAutoRenewPromo(autoRenewPromoInput.trim())}
                    className="h-7 px-3 rounded-lg text-[11px] font-bold uppercase tracking-wider bg-primary/15 hover:bg-primary/25 text-primary disabled:opacity-40 disabled:hover:bg-primary/15 transition-colors shrink-0"
                  >
                    {t("cabinet.dashboard.auto_renew_promo_save")}
                  </button>
                )}
              </div>
            )}
            {anyAutoRenewOn && autoRenewPromoError && (
              <p className="text-[11px] font-medium text-red-500 dark:text-red-400 -mt-2">{autoRenewPromoError}</p>
            )}

            <Button variant="default" size="lg" className="relative w-full gap-2 h-14 rounded-2xl text-[16px] font-semibold bg-gradient-to-r from-primary via-primary to-violet-500 text-primary-foreground border-0 shadow-[0_8px_30px_-8px] shadow-primary/50 hover:shadow-[0_10px_40px_-8px] hover:shadow-primary/60 hover:scale-[1.03] active:scale-[0.99] transition-all duration-300 [&_svg]:self-center [&_span]:leading-none" asChild>
              <Link to="/cabinet/profile#topup" className="inline-flex items-center justify-center gap-2 leading-none">
                <PlusCircle className="h-5 w-5 shrink-0" />
                <span className="inline-flex items-center leading-none">{t("cabinet.dashboard.top_up")}</span>
              </Link>
            </Button>
          </CardContent>
        </Card>

        {/* Справа от баланса: Рефералы или Подключение */}
        <Card className="group relative overflow-hidden rounded-3xl border border-border/50 bg-card/40 backdrop-blur-xl shadow-lg hover:shadow-xl hover:border-violet-500/25 transition-all duration-500 sm:col-span-2 lg:col-span-1">
          {/* декоративные блобы */}
          <div className="pointer-events-none absolute -top-20 -left-16 h-48 w-48 rounded-full bg-violet-500/10 blur-3xl" aria-hidden />
          <div className="pointer-events-none absolute -bottom-24 -right-16 h-48 w-48 rounded-full bg-primary/10 blur-3xl" aria-hidden />
          <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-violet-500/40 to-transparent" aria-hidden />
          <CardHeader className="relative pb-4">
            <CardTitle className="flex items-center gap-3 text-xl text-foreground">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500/25 to-primary/20 ring-1 ring-violet-500/25 shadow-[0_0_20px_-6px] shadow-violet-500/40">
                {hasReferralLinks ? <Users className="h-6 w-6 text-primary" /> : <Wifi className="h-6 w-6 text-primary" />}
              </div>
              {hasReferralLinks ? t("cabinet.dashboard.referrals") : t("cabinet.dashboard.connection")}
            </CardTitle>
          </CardHeader>
          <CardContent className="relative space-y-5 pt-2 flex flex-col justify-center h-[calc(100%-5rem)]">
            {hasReferralLinks ? (
              <>
                <p className="text-[14px] text-muted-foreground leading-relaxed">Делитесь ссылкой и получайте <strong className="bg-gradient-to-r from-primary to-violet-400 bg-clip-text text-transparent font-bold">бонус на баланс</strong> за каждого приглашённого друга!</p>
                {referralStats && (
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: "Приглашено", value: referralStats.referralCount.toLocaleString("ru-RU"), icon: UserPlus, tint: "text-primary", ring: "ring-primary/20", glow: "shadow-primary/25", bg: "from-primary/10" },
                      { label: "Заработано", value: `${referralStats.totalEarnings.toLocaleString("ru-RU")} ₽`, icon: Coins, tint: "text-emerald-500 dark:text-emerald-400", ring: "ring-emerald-500/20", glow: "shadow-emerald-500/25", bg: "from-emerald-500/10" },
                      { label: "Ваш %", value: `${referralStats.referralPercent}%`, icon: Percent, tint: "text-violet-500 dark:text-violet-400", ring: "ring-violet-500/20", glow: "shadow-violet-500/25", bg: "from-violet-500/10" },
                    ].map((tile) => (
                      <div key={tile.label} className={`rounded-2xl bg-gradient-to-b ${tile.bg} to-background/40 border border-border/40 ring-1 ${tile.ring} backdrop-blur-xl px-2 py-3.5 text-center shadow-[0_0_24px_-12px] ${tile.glow} hover:-translate-y-0.5 transition-transform duration-300`}>
                        <tile.icon className={`h-4 w-4 mx-auto mb-1.5 ${tile.tint}`} />
                        <p className="text-lg font-extrabold tracking-tight text-foreground leading-none tabular-nums">{tile.value}</p>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1.5">{tile.label}</p>
                      </div>
                    ))}
                  </div>
                )}
                <div className="rounded-2xl border border-border/40 bg-background/30 backdrop-blur-xl divide-y divide-border/40 overflow-hidden">
                  {referralLinkSite && (
                    <button
                      type="button"
                      onClick={() => copyReferral("site")}
                      title={referralLinkSite}
                      className="group/row w-full flex items-center gap-3 px-3.5 py-3 text-left hover:bg-primary/[0.06] transition-colors"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20">
                        <Globe className="h-4 w-4 text-primary" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Сайт</span>
                        <span className="block truncate font-mono text-[13px] text-foreground/85">{referralLinkSite}</span>
                      </span>
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/40 bg-background/40 text-foreground/60 group-hover/row:text-primary group-hover/row:border-primary/30 group-hover/row:scale-105 transition-all">
                        {referralCopied === "site" ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                      </span>
                    </button>
                  )}
                  {referralLinkBot && (
                    <button
                      type="button"
                      onClick={() => copyReferral("bot")}
                      title={referralLinkBot}
                      className="group/row w-full flex items-center gap-3 px-3.5 py-3 text-left hover:bg-violet-500/[0.06] transition-colors"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 ring-1 ring-violet-500/20">
                        <Send className="h-4 w-4 text-violet-500 dark:text-violet-400" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Бот</span>
                        <span className="block truncate font-mono text-[13px] text-foreground/85">{referralLinkBot}</span>
                      </span>
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/40 bg-background/40 text-foreground/60 group-hover/row:text-violet-400 group-hover/row:border-violet-500/30 group-hover/row:scale-105 transition-all">
                        {referralCopied === "bot" ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                      </span>
                    </button>
                  )}
                </div>
                <div className="pt-1">
                  <Button variant="outline" className="group/btn w-full rounded-2xl h-12 text-[15px] font-medium bg-background/30 hover:bg-gradient-to-r hover:from-primary/10 hover:to-violet-500/10 hover:border-primary/30 transition-all duration-300 border-border/50 [&_svg]:self-center [&_span]:leading-none" asChild>
                     <Link to="/cabinet/referral" className="inline-flex items-center justify-center gap-2 leading-none">
                       <span className="inline-flex items-center leading-none">Подробная статистика</span>
                       <ArrowRight className="h-4 w-4 shrink-0 group-hover/btn:translate-x-1 transition-transform duration-300" />
                     </Link>
                  </Button>
                </div>
              </>
            ) : vpnUrl ? (
              <div className="flex flex-col h-full justify-between space-y-6">
                <p className="text-[15px] text-muted-foreground leading-relaxed">Ваша подписка готова к использованию. Перейдите к настройке приложения.</p>
                <div className="p-6 bg-primary/10 rounded-2xl border border-primary/20 text-center">
                   <Wifi className="h-12 w-12 text-primary mx-auto mb-3 opacity-80" />
                   <p className="text-[15px] text-foreground font-medium">Всё готово к работе</p>
                </div>
                <Button variant="default" size="lg" className="w-full gap-2 rounded-xl shadow-lg h-14 text-[16px] hover:scale-105 transition-transform [&_svg]:self-center [&_span]:leading-none" asChild>
                  <Link to="/cabinet/subscribe" className="inline-flex items-center justify-center gap-2 leading-none">
                    <Wifi className="h-5 w-5 shrink-0" />
                    <span className="inline-flex items-center leading-none">Подключить VPN</span>
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="flex flex-col h-full justify-center space-y-6">
                <div className="p-6 bg-background/30 rounded-2xl border border-border/50 text-center">
                   <Package className="h-12 w-12 text-muted-foreground mx-auto mb-3 opacity-40" />
                   <p className="text-[15px] text-muted-foreground">Оплатите тариф, чтобы получить ссылку</p>
                </div>
                <Button variant="outline" size="lg" className="w-full rounded-xl h-14 text-[16px] bg-background/30 hover:bg-background/60 border-border/50 transition-colors [&_span]:leading-none" asChild>
                  <Link to="/cabinet/tariffs" className="inline-flex items-center justify-center leading-none">
                    <span className="inline-flex items-center leading-none">Выбрать тариф</span>
                  </Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {secondarySubscriptions.length > 0 && (
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="space-y-4 pt-4"
        >
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-foreground ml-1">
            <Package className="h-6 w-6 text-indigo-400" />
            Остальные подписки
          </h2>
          <div className="grid gap-6 sm:grid-cols-2">
            {secondarySubscriptions.map((sec) => {
              const secParsed = parseSubscription(sec.subscription);
              const secHasActive = sec.subscription && typeof sec.subscription === "object" && (secParsed.status === "ACTIVE" || secParsed.status === undefined);
              const secExpireDate = secParsed.expireAt ? new Date(secParsed.expireAt) : null;
              const secDaysLeft = secExpireDate && secExpireDate > new Date() ? Math.max(0, Math.ceil((secExpireDate.getTime() - Date.now()) / (24*60*60*1000))) : null;
              const secTrafficPercent = secParsed.trafficLimitBytes && secParsed.trafficLimitBytes > 0 && secParsed.trafficUsed != null ? Math.min(100, Math.round((secParsed.trafficUsed / secParsed.trafficLimitBytes) * 100)) : null;

              return (
                <Card key={sec.id} className="rounded-3xl border border-indigo-500/30 bg-card/40 backdrop-blur-xl shadow-lg hover:shadow-xl transition-all duration-300 flex flex-col">
                  <CardHeader className="pb-4">
                    <CardTitle className="flex items-center justify-between gap-2 text-lg text-foreground">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="p-2.5 bg-indigo-500/20 rounded-xl shrink-0">
                          <Package className="h-5 w-5 text-indigo-400" />
                        </div>
                        <span className="truncate">Подписка #{sec.subscriptionIndex ?? ""}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {secHasActive ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-semibold bg-indigo-500/15 text-indigo-400 border border-indigo-500/20">
                            <span className="h-1.5 w-1.5 rounded-full bg-current" />
                            Активна
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-semibold bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/20">
                            <span className="h-1.5 w-1.5 rounded-full bg-current" />
                            Истекла
                          </span>
                        )}
                        {secActionNode(
                          sec,
                          "shrink-0 gap-1.5 rounded-full h-9 px-4 bg-gradient-to-r from-indigo-500 to-purple-500 text-white border-0 shadow-md shadow-indigo-500/30 hover:opacity-90 hover:scale-105 transition-transform [&_svg]:self-center [&_span]:leading-none",
                          "h-4 w-4 shrink-0",
                          "inline-flex items-center text-sm font-medium leading-none",
                        )}
                      </div>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex-1 flex flex-col justify-center">
                    <div className="space-y-4">
                      <div className="flex items-center gap-2 flex-wrap mb-2">
                        {secDaysLeft != null && (
                          <span className="text-sm font-semibold text-foreground bg-foreground/5 px-3 py-1.5 rounded-full border border-border/50 shadow-sm">
                            {secDaysLeft} {secDaysLeft === 1 ? t("cabinet.common.day_one") : secDaysLeft < 5 ? t("cabinet.common.day_few") : t("cabinet.common.day_many")}
                          </span>
                        )}
                        {secParsed.hwidDeviceLimit != null && secParsed.hwidDeviceLimit > 0 && (
                          <span className="text-sm font-semibold text-foreground bg-indigo-500/10 text-indigo-400 px-3 py-1.5 rounded-full border border-indigo-500/20 shadow-sm flex items-center gap-1.5">
                            <Smartphone className="h-4 w-4" /> {devicesBySubId[sec.id] ?? 0} / {secParsed.hwidDeviceLimit}
                          </span>
                        )}
                      </div>
                      
                      {sec.tariffDisplayName && (
                        <div className="flex items-center gap-4 bg-background/40 p-4 rounded-2xl border border-border/50 transition-colors hover:bg-background/60 shadow-sm">
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400">
                            <Package className="h-6 w-6" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">{sec.trialId ? "TRIAL" : t("cabinet.dashboard.tariff_label")}</p>
                            <p className="text-[15px] font-semibold truncate text-foreground">
                              {sec.tariffDisplayName}
                            </p>
                          </div>
                        </div>
                      )}
                      
                      {secParsed.expireAt && (
                        <div className="flex items-center gap-4 bg-background/40 p-4 rounded-2xl border border-border/50 transition-colors hover:bg-background/60 shadow-sm">
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400">
                            <Calendar className="h-6 w-6" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">{t("cabinet.dashboard.valid_until")}</p>
                            <p className="text-[15px] font-semibold text-foreground">
                              {formatDate(secParsed.expireAt)}
                            </p>
                          </div>
                        </div>
                      )}
                      
                      <div className="bg-background/40 p-4 rounded-2xl border border-border/50 space-y-3 transition-colors hover:bg-background/60 shadow-sm">
                        <div className="flex items-center gap-4">
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400">
                            <Wifi className="h-6 w-6" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">{t("cabinet.dashboard.traffic")}</p>
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-[15px] font-semibold text-foreground">
                                {secParsed.trafficLimitBytes != null && secParsed.trafficLimitBytes > 0
                                  ? `${formatBytes(secParsed.trafficUsed ?? 0)} / ${formatBytes(secParsed.trafficLimitBytes)}`
                                  : t("cabinet.dashboard.unlimited")}
                              </p>
                              {secTrafficPercent != null && <span className="text-[13px] font-bold text-muted-foreground">{secTrafficPercent}%</span>}
                            </div>
                          </div>
                        </div>
                        {secTrafficPercent != null && (
                          <div className="h-2 w-full rounded-full bg-muted/30 overflow-hidden">
                            <div className="h-full rounded-full bg-indigo-500 transition-all duration-500 ease-in-out" style={{ width: `${secTrafficPercent}%` }} />
                          </div>
                        )}
                      </div>

                      {/* T-sub-link (WolfVPN, 2026-06-03): ссылка подписки доп.подписки + копирование прямо на главной (без захода в «Подключиться»). */}
                      {secParsed.subscriptionUrl && (
                        <div className="flex gap-2 min-w-0 pt-1 mb-2">
                          <code className="flex-1 min-w-0 truncate rounded-xl bg-background/50 border border-border/50 px-3 py-2.5 text-xs font-mono flex items-center text-foreground/80" title={secParsed.subscriptionUrl}>
                            {secParsed.subscriptionUrl}
                          </code>
                          <Button size="icon" variant="outline" className="shrink-0 h-auto w-11 rounded-xl bg-background/50 hover:bg-background/80 transition-transform hover:scale-105" onClick={() => { navigator.clipboard.writeText(secParsed.subscriptionUrl || ""); window.Telegram?.WebApp?.showPopup?.({ title: t("cabinet.dashboard.copied_title"), message: t("cabinet.dashboard.copied_message") }); }}>
                            <Copy className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                      <div className="pt-2 flex flex-col gap-2">
                        <Button variant="default" size="lg" className="w-full gap-2 rounded-xl shadow-lg h-14 text-[16px] hover:scale-105 transition-transform [&_svg]:self-center [&_span]:leading-none bg-indigo-600 hover:bg-indigo-700 text-white" asChild>
                          {useRemnaPage && secParsed.subscriptionUrl ? (
                            <a href={secParsed.subscriptionUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-2 leading-none">
                              <Wifi className="h-5 w-5 shrink-0" />
                              <span className="inline-flex items-center leading-none">Подключиться</span>
                            </a>
                          ) : (
                            <Link to={`/cabinet/subscribe?uuid=${sec.remnawaveUuid}`} className="inline-flex items-center justify-center gap-2 leading-none">
                              <Wifi className="h-5 w-5 shrink-0" />
                              <span className="inline-flex items-center leading-none">Подключиться</span>
                            </Link>
                          )}
                        </Button>
                      </div>

                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </motion.section>
      )}
    </div>
    {trialsPickerNode}
    {paySuccessModalNode}
    {extendDialogNode}
    </>
  );
}
