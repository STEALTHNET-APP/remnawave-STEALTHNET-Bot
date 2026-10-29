import { CloudPaymentsTrial } from "@/components/cabinet/cloudpayments-trial";
import { toast } from "@/components/ui/toast";
import "./cabinet-subscription.css";
import { useCabinetMiniapp } from "./cabinet-layout";
import { cabinetSubscriptionUnavailable } from "@/lib/cabinet-navigation";
import { CopyLinkButton, SubscriptionQrButton } from "@/components/subscription-link-actions";
import { PromoCodeForm } from "@/components/cabinet/promo-code-form";
import { useEffect, useId, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useCabinetDesign } from "@/lib/use-cabinet-design";
import { StealthDashboard } from "@/pages/cabinet/stealth/stealth-dashboard";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/query-client";
import { useClientSubscription, useClientAllSubscriptions, useClientPayments, useReferralStats, useAvailableTrials, useInvalidateClientData } from "@/lib/queries";
import {
  
  Pencil,
  ChevronDown,
  Package,
  Wallet,
  Wifi,
  Calendar,
  
  
  ArrowRight,
  PlusCircle,
  
  Check,
  Gift,
  Loader2,
  
  AlertCircle,
  Zap,
  Smartphone,
  Tag,
  X,
  RotateCcw,
  RefreshCw,
  Send,
} from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { useCabinetConfig } from "@/contexts/cabinet-config";
import { api } from "@/lib/api";
import { formatRuDays } from "@/lib/i18n";
import { TrialsPickerDialog } from "@/components/cabinet/trials-picker-dialog";
import { ExtendSubscriptionDialog } from "@/components/payment/extend-subscription-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
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

import { formatCabinetMoney as formatMoney } from "@/lib/cabinet-format";

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
  const { t } = useTranslation();
  return (
    <>
      <LinkTelegramPrompt />
      <CloudPaymentsTrial />
      {design === "stealth" ? <StealthDashboard /> : <ClassicDashboardPage compact={design === "aurora"} />}
      {design !== "stealth" && <details className="cabinet-promo-disclosure"><summary>{t("cabinet.journey.promo")}</summary><PromoCodeForm /></details>}
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
  const isMiniapp = useCabinetMiniapp();
  const { t } = useTranslation();
  const { state } = useClientAuth();
  const config = useCabinetConfig();
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

function ClassicDashboardPage({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const { state, refreshProfile } = useClientAuth();
  const config = useCabinetConfig();
  const token = state.token;
  const [searchParams, setSearchParams] = useSearchParams();

  const subQuery = useClientSubscription(token);
  const allSubQuery = useClientAllSubscriptions(token);
  const payQuery = useClientPayments(token);
  const devicesQuery = useQuery({
    queryKey: qk.client.devices(token),
    queryFn: () => api.getClientDevices(token!),
    enabled: !!token,
  });
  const allDevicesQuery = useQuery({
    queryKey: qk.client.myDevices(token),
    queryFn: () => api.getMyAllDevices(token!),
    enabled: !!token,
  });
  const referralQuery = useReferralStats(token);
  const trialsQuery = useAvailableTrials(token);
  const queryLoading =
    subQuery.isLoading || allSubQuery.isLoading || payQuery.isLoading;

  const deviceCount: number | null = devicesQuery.data?.total ?? null;
  const devicesBySubId = (allDevicesQuery.data?.items ?? []).reduce<Record<string, number>>((acc, d) => {
    acc[d.subscriptionId] = (acc[d.subscriptionId] || 0) + 1;
    return acc;
  }, {});
  const subscription = subQuery.data?.subscription ?? null;
  const subscriptionError = (subQuery.data?.message as string | undefined) ?? (subQuery.error instanceof Error ? subQuery.error.message : null);
  const subscriptionUnavailable = cabinetSubscriptionUnavailable({ requestFailed: subQuery.isError || allSubQuery.isError, subscription, message: subscriptionError, offlineSnapshot: allSubQuery.data?.items.find(item => item.type === "root")?.isOfflineSnapshot });
  const tariffDisplayName = subQuery.data?.tariffDisplayName ?? null;
  const mainBan = {
    isBanned: subQuery.data?.isBanned === true,
    banReason: subQuery.data?.banReason ?? null,
    bannedUntil: subQuery.data?.bannedUntil ?? null,
  };
  const autoRenewNext = {
    amount: subQuery.data?.autoRenewNextChargeAmount ?? null,
    at: subQuery.data?.autoRenewNextChargeAt ?? null,
    currency: subQuery.data?.autoRenewCurrency ?? null,
  };
  // issue #118: при multiSubscriptionsEnabled=false сервер всё равно может отдать подписки с index>0
  // (legacy/консолидация) — не показываем их как secondary в single-режиме.
  const secondarySubscriptions = config?.multiSubscriptionsEnabled === false
    ? []
    : (allSubQuery.data?.items ?? []).filter((s) => s.type === "secondary");
  const rootItem = (allSubQuery.data?.items ?? []).find((s) => s.type === "root");
  const rootSubId = rootItem?.id ?? null;
  const rootTrial = { isTrial: Boolean(rootItem?.trialId), convertEnabled: rootItem?.trialConvertEnabled ?? true };
  const autoRenewSubs = (allSubQuery.data?.items ?? [])
    .filter((s) => !s.trialId)
    .map((s) => ({
      type: s.type,
      id: s.id,
      name: s.customName?.trim() || s.tariffDisplayName?.trim() || `Подписка #${(s.subscriptionIndex ?? 0) + 1}`,
      enabled: s.autoRenewEnabled ?? false,
    }));
  const referralStats = referralQuery.data ?? null;
  const hasMultiTrials: boolean | null = trialsQuery.isLoading ? null : (trialsQuery.data?.items.length ?? 0) > 0;
  const loading = queryLoading;
  const invalidateData = useInvalidateClientData();
  const queryClient = useQueryClient();

  // root-подписка — триал: лейбл TRIAL + «Конвертировать» (или ничего).
  // T-unify-cabinet (30.05.2026, WolfVPN): id главной подписки (#0) — для кнопки «Продлить» → /cabinet/tariffs?extend=
  const [paymentMessage, setPaymentMessage] = useState<"success_topup" | "success_tariff" | "success" | "failed" | null>(null);
  // T-pay-success-modal (WolfVPN): модалка успеха при возврате с оплаты (ЮKassa/Platega/Lava/и др.)
  const [paySuccessModal, setPaySuccessModal] = useState<null | "topup" | "tariff" | "generic">(null);
  const [trialLoading, setTrialLoading] = useState(false);
  const [trialError, setTrialError] = useState<string | null>(null);
  // T15 (26.05.2026, WolfVPN): новая мульти-триал система.
  // hasMultiTrials=null → ещё не загружали; true → открываем модалку; false → legacy /trial.
  const [trialsPickerOpen, setTrialsPickerOpen] = useState(false);
  // красивая модалка продления вместо редиректа в каталог
  // (?extend=...). Открывается для ЛЮБОЙ подписки — единый механизм.
  const [extendSubId, setExtendSubId] = useState<string | null>(null);
  // ♻️ Пер-подписочное автосписание (вместо одного глобального Switch в карточке «Баланс»).
  // Триальные подписки сюда не попадают — автосписание на них не имеет смысла.
  const [autoRenewTogglingId, setAutoRenewTogglingId] = useState<string | null>(null);

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
      searchParams.get("rollypay") === "success" || searchParams.get("paritypay") === "success" ||
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
        invalidateData();
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
    // Optimistic: правим кеш TanStack напрямую (autoRenewSubs — derived от allSubscriptions).
    const allSubs = allSubQuery.data?.items ?? [];
    const patch = (on: boolean) =>
      allSubs.map((s) => (s.id === sub.id ? { ...s, autoRenewEnabled: on } : s));
    queryClient.setQueryData(qk.client.allSubscriptions(token), { items: patch(enabled) });
    try {
      await api.clientSetSubscriptionAutoRenew(token, sub.type, sub.id, enabled);
      toast.success(t(enabled ? "cabinet.redesign.renew_on" : "cabinet.redesign.renew_off"));
      refreshProfile().catch(() => {});
    } catch (err) {
      toast.error(t("cabinet.redesign.save_failed"), err instanceof Error ? err.message : undefined);
      queryClient.setQueryData(qk.client.allSubscriptions(token), { items: patch(!enabled) });
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
      toast.success(t("cabinet.redesign.saved"));
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
      invalidateData();
    } catch (e) {
      setTrialError(e instanceof Error ? e.message : t("cabinet.dashboard.trial_error"));
    } finally {
      setTrialLoading(false);
    }
  }

  async function handleTrialActivated() {
    // После активации триала через модалку — обновляем профиль и подписку.
    await refreshProfile();
    invalidateData();
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
  const showAnyTrial = !subscriptionUnavailable && (showMultiTrials || showLegacyTrial);
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
                aria-label={`Автосписание: ${sub.name}`}
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
    <section className="cabinet-empty">
      <h3>{t("cabinet.dashboard.no_subscription_title")}</h3>
      <p>{t("cabinet.dashboard.no_subscription_desc")}</p>
      <Button asChild><Link to="/cabinet/tariffs">{t("cabinet.dashboard.choose_tariff")}</Link></Button>
      {rootActionNode("cabinet-renew-button", "h-4 w-4", "", t("cabinet.redesign.renew"))}
    </section>
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

  const BanNotice = ({ until }: { until: string | null }) => {
    let untilStr = "";
    if (until) {
      const date = new Date(until);
      if (!isNaN(date.getTime())) {
        untilStr = date.toLocaleString("ru-RU", {
          day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
        });
      }
    }
    return (
      <div className="rounded-2xl bg-red-500/10 border border-red-500/30 px-4 py-3">
        <p className="text-sm font-semibold text-red-600 dark:text-red-400 leading-relaxed">
          🚫 Подписка заблокирована за превышение трафика{untilStr ? ` до ${untilStr}` : ""}.
          <br />Подключение отключено, действия недоступны до разблокировки.
        </p>
      </div>
    );
  };

  // единая кнопка действия root-подписки (для всех 3 мест рендера):
  // обычная → «Продлить» (модалка); триал → «Конвертировать» (выбор тарифа в каталоге);
  // триал с запрещённой конвертацией → кнопки нет вовсе.
  const rootActionNode = (cls: string, iconCls: string, txtCls: string, label = "Продлить") => {
    if (!rootSubId || mainBan.isBanned || subscriptionUnavailable) return null;
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
  const secActionNode = (sec: { id: string; trialId?: string | null; trialConvertEnabled?: boolean; isBanned?: boolean }, cls: string, iconCls: string, txtCls: string) => {
    if (sec.isBanned) return null;
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
      onPaidByBalance={() => invalidateData()}
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

  if (compact) {
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
        {mainBan.isBanned && <BanNotice until={mainBan.bannedUntil} />}

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
          ) : subscriptionUnavailable ? (
            <div role="alert" className="cabinet-empty"><AlertCircle size={26} /><h3>{t("cabinet.journey.error_title")}</h3><p>{t("cabinet.journey.error_hint")}</p><Button variant="outline" disabled={subQuery.isFetching || allSubQuery.isFetching} onClick={() => { subQuery.refetch(); allSubQuery.refetch(); }}>{t("cabinet.wallet.retry")}</Button></div>
          ) : !subscription || typeof subscription !== "object" ? (
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
              {vpnUrl && !mainBan.isBanned && (
                <>
                  <div className="flex gap-2 min-w-0 pt-1">
                    <code className="flex-1 min-w-0 truncate rounded-xl bg-background/50 border border-border/50 px-3 py-2.5 text-xs font-mono flex items-center text-foreground/80" title={vpnUrl}>
                      {vpnUrl}
                    </code>
                    <CopyLinkButton url={vpnUrl} className="shrink-0 h-11 w-11 rounded-xl" /><SubscriptionQrButton url={vpnUrl} name={tariffDisplayName || undefined} className="shrink-0 h-11 w-11 rounded-xl" />
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
          if (sec.isOfflineSnapshot) return <section key={sec.id} className="cabinet-surface"><h2>{sec.tariffDisplayName}</h2><div role="alert" className="cabinet-empty"><p>{t("cabinet.journey.error_hint")}</p><Button variant="outline" disabled={allSubQuery.isFetching} onClick={() => allSubQuery.refetch()}>{t("cabinet.wallet.retry")}</Button></div></section>;
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
                  <span className="truncate">{sec.tariffDisplayName?.trim() || `Подписка #${(sec.subscriptionIndex ?? 0) + 1}`}</span>
                </span>
                {secActionNode(
                  sec,
                  "shrink-0 gap-1.5 rounded-full h-8 px-3 bg-gradient-to-r from-indigo-500 to-purple-500 text-white border-0 shadow-md shadow-indigo-500/30 hover:opacity-90 normal-case [&_svg]:self-center [&_span]:leading-none",
                  "h-3.5 w-3.5 shrink-0",
                  "inline-flex items-center text-xs font-medium leading-none",
                )}
              </h2>

              <div className="space-y-4 min-w-0">
                {sec.isBanned && <BanNotice until={sec.bannedUntil ?? null} />}
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
                {secParsed.subscriptionUrl && !sec.isBanned && (
                  <div className="flex gap-2 min-w-0 pt-1">
                    <code className="flex-1 min-w-0 truncate rounded-xl bg-background/50 border border-border/50 px-3 py-2.5 text-xs font-mono flex items-center text-foreground/80" title={secParsed.subscriptionUrl}>
                      {secParsed.subscriptionUrl}
                    </code>
                    <CopyLinkButton url={secParsed.subscriptionUrl} className="shrink-0 h-11 w-11 rounded-xl" /><SubscriptionQrButton url={secParsed.subscriptionUrl} name={sec.tariffDisplayName || `Подписка #${(sec.subscriptionIndex ?? 0) + 1}`} className="shrink-0 h-11 w-11 rounded-xl" />
                  </div>
                )}
                {!sec.isBanned && <div className="pt-2 flex flex-col sm:flex-row gap-2">
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
                </div>}
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

      {config?.rouletteEnabled !== false && (
          <Link
            to="/cabinet/roulette"
            className="order-3 group relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-r from-primary/10 via-purple-500/10 to-pink-500/10 p-4 transition-all duration-300 hover:border-primary/50 flex items-center justify-between gap-3 shadow-sm"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-purple-600 text-xl text-white shadow-md shadow-primary/25">
                🎰
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-foreground">Рулетка удачи</h3>
                  <span className="inline-flex items-center rounded-full bg-primary/15 px-2 py-0.5 text-[9px] font-bold text-primary uppercase">
                    Бесплатно
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Крутите и получайте ежедневные призы
                </p>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-primary shrink-0 transition-transform group-hover:translate-x-1" />
          </Link>
        )}
      </div>
      {trialsPickerNode}
      {paySuccessModalNode}
      {extendDialogNode}
      </>
    );
  }

  return (
    <>
      <div className="cabinet-overview">
        <header className="cabinet-page-heading cabinet-overview-heading">
          <div><h1>{t("cabinet.redesign.subscriptions")}</h1><p>{t("cabinet.redesign.subscription_hint")}</p></div>
          <Link className="cabinet-secondary-link" to="/cabinet/tariffs">{t(config?.multiSubscriptionsEnabled === false ? "cabinet.dashboard.choose_tariff" : "cabinet.redesign.add_subscription")}</Link>
        </header>
        {mainBan.isBanned && <BanNotice until={mainBan.bannedUntil} />}
        {paymentMessage?.startsWith("success") && <p className="cabinet-notice" role="status">{t("cabinet.dashboard.payment_success")}</p>}
        {paymentMessage === "failed" && <p className="cabinet-notice cabinet-notice-error" role="alert">{t("cabinet.dashboard.payment_failed")}</p>}
        {giftRedeemMessage && <p className="cabinet-notice" role="status">{giftRedeemMessage.text}</p>}
        {trialError && <p className="cabinet-notice cabinet-notice-error" role="alert">{trialError}</p>}
        {config?.botInfoBlock?.trim() && <p className="cabinet-notice whitespace-pre-line">{config.botInfoBlock.trim()}</p>}
        <div className="cabinet-overview-columns">
          <div className="cabinet-subscriptions" data-tour="subscription">
            {loading ? <div className="cabinet-loading" role="status"><Loader2 className="animate-spin" size={20} />{t("cabinet.redesign.loading_subscription")}</div> : subscriptionUnavailable ? (
              <section className="cabinet-empty" role="alert"><h2>{t("cabinet.journey.error_title")}</h2><p>{t("cabinet.journey.error_hint")}</p><Button variant="outline" disabled={subQuery.isFetching || allSubQuery.isFetching} onClick={() => { subQuery.refetch(); allSubQuery.refetch(); }}>{t("cabinet.wallet.retry")}</Button></section>
            ) : !subscription || typeof subscription !== "object" ? <NoSubscriptionState /> : (
              <SubscriptionRecord
                subscriptionId={rootSubId}
                autoRenew={rootItem && !rootItem.trialId ? { enabled: rootItem.autoRenewEnabled ?? false, busy: autoRenewTogglingId === rootItem.id, toggle: (value: boolean) => toggleSubAutoRenew(rootItem, value) } : undefined}
                title={rootItem?.customName || tariffDisplayName || subParsed.productName || t("cabinet.dashboard.my_subscription")}
                active={!!hasActiveSubscription}
                expireAt={subParsed.expireAt}
                daysLeft={daysLeft}
                trafficUsed={subParsed.trafficUsed}
                trafficLimit={subParsed.trafficLimitBytes}
                devices={deviceCount}
                deviceLimit={subParsed.hwidDeviceLimit}
                url={mainBan.isBanned ? undefined : vpnUrl || undefined}
                connectTo="/cabinet/subscribe"
                external={useRemnaPage}
                action={rootActionNode("cabinet-renew-button", "h-4 w-4", "", t("cabinet.redesign.renew"))}
              />
            )}
            {secondarySubscriptions.map(sec => {
              const parsed = parseSubscription(sec.subscription);
              if (sec.isOfflineSnapshot) return <section key={sec.id} className="cabinet-empty" role="alert"><h2>{sec.tariffDisplayName}</h2><p>{t("cabinet.journey.error_hint")}</p><Button variant="outline" disabled={allSubQuery.isFetching} onClick={() => allSubQuery.refetch()}>{t("cabinet.wallet.retry")}</Button></section>;
              const active = Boolean(sec.subscription && (parsed.status === "ACTIVE" || parsed.status === undefined));
              const remaining = parsed.expireAt ? Math.max(0, Math.ceil((new Date(parsed.expireAt).getTime() - Date.now()) / 86400000)) : null;
              return <div key={sec.id}>{sec.isBanned && <BanNotice until={sec.bannedUntil ?? null} />}<SubscriptionRecord
                subscriptionId={sec.id}
                autoRenew={!sec.trialId ? { enabled: sec.autoRenewEnabled ?? false, busy: autoRenewTogglingId === sec.id, toggle: (value: boolean) => toggleSubAutoRenew(sec, value) } : undefined}
                title={sec.customName || sec.tariffDisplayName || t("cabinet.redesign.numbered_subscription", { number: (sec.subscriptionIndex ?? 0) + 1 })}
                active={active}
                expireAt={parsed.expireAt}
                daysLeft={remaining}
                trafficUsed={parsed.trafficUsed}
                trafficLimit={parsed.trafficLimitBytes}
                devices={devicesBySubId[sec.id] ?? 0}
                deviceLimit={parsed.hwidDeviceLimit}
                url={sec.isBanned ? undefined : parsed.subscriptionUrl}
                connectTo={`/cabinet/subscribe?uuid=${sec.remnawaveUuid}`}
                external={useRemnaPage}
                action={secActionNode(sec, "cabinet-renew-button", "h-4 w-4", "")}
              /></div>;
            })}
            {showAnyTrial && <section className="cabinet-trial-row"><div><h2>{t("cabinet.dashboard.free_trial")}</h2><p>{t("cabinet.redesign.trial_hint")}</p></div><Button variant="outline" onClick={activateTrial} disabled={trialLoading}>{trialLoading ? <Loader2 size={16} className="animate-spin" /> : t("cabinet.redesign.try")}</Button></section>}
          </div>
          <aside className="cabinet-account-summary">
            <section className="cabinet-account-balance" data-tour="balance"><h2>{t("cabinet.dashboard.balance")}</h2><p className="cabinet-money">{formatMoney(client.balance, client.preferredCurrency)}</p><p>{t("cabinet.redesign.balance_hint")}</p><Link to="/cabinet/wallet" className="cabinet-secondary-link">{t("cabinet.dashboard.top_up")}</Link></section>
            <section className="cabinet-renew-settings">
              {anyAutoRenewOn && <form className="cabinet-renew-promo" onSubmit={e => { e.preventDefault(); saveAutoRenewPromo(autoRenewPromoInput.trim() || null); }}><Label htmlFor="renew-promo">{t("cabinet.redesign.renew_promo")}</Label><div><Input id="renew-promo" value={autoRenewPromoInput} onChange={e => { setAutoRenewPromoInput(e.target.value.toUpperCase()); setAutoRenewPromoError(null); setAutoRenewPromoSaved(false); }} disabled={autoRenewPromoLoading} /><Button variant="outline" disabled={autoRenewPromoLoading} type="submit">{autoRenewPromoSaved ? <Check size={16} /> : t("cabinet.dashboard.auto_renew_promo_save")}</Button></div>{autoRenewPromoError && <p role="alert">{autoRenewPromoError}</p>}</form>}
            </section>
            {hasReferralLinks && <section className="cabinet-referral-note"><h2>{t("cabinet.dashboard.referrals")}</h2><p>{t("cabinet.redesign.referral_hint")}</p>{referralStats && <p className="cabinet-referral-numbers">{t("cabinet.journey.invited")}: {referralStats.referralCount}<br />{t("cabinet.journey.earned")}: {formatMoney(referralStats.totalEarnings, "RUB")}</p>}<Link to="/cabinet/referral" className="cabinet-text-link">{t("cabinet.journey.referral_details")}</Link></section>}
            {config?.rouletteEnabled === true && <Link className="cabinet-utility-link" to="/cabinet/roulette">{t("cabinet.nav.roulette")}</Link>}
            <Link className="cabinet-utility-link" to="/cabinet/help">{t("cabinet.redesign.need_help")}<ArrowRight size={16} /></Link>
          </aside>
        </div>
      </div>
      {trialsPickerNode}
      {paySuccessModalNode}
      {extendDialogNode}
    </>
  );
}

function SubscriptionRecord({ subscriptionId, autoRenew, title, active, expireAt, daysLeft, trafficUsed, trafficLimit, devices, deviceLimit, url, connectTo, external, action }: {
  subscriptionId?: string | null;
  autoRenew?: { enabled: boolean; busy: boolean; toggle: (value: boolean) => void };
  title: string;
  active: boolean;
  expireAt?: string;
  daysLeft: number | null;
  trafficUsed?: number;
  trafficLimit?: number;
  devices: number | null | undefined;
  deviceLimit?: number;
  url?: string;
  connectTo: string;
  external: boolean;
  action: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const { state } = useClientAuth();
  const invalidate = useInvalidateClientData();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(title);
  const [saving, setSaving] = useState(false);
  async function saveName(event: React.FormEvent) {
    event.preventDefault();
    if (!state.token || !subscriptionId || !name.trim() || saving) return;
    setSaving(true);
    try {
      await api.clientRenameSubscription(state.token, subscriptionId, name.trim());
      await invalidate();
      setEditing(false);
      toast.success(t("cabinet.redesign.renamed"));
    } catch (error) { toast.error(t("cabinet.redesign.save_failed"), error instanceof Error ? error.message : undefined); }
    finally { setSaving(false); }
  }
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsId = useId();
  const reducedMotion = useReducedMotion();
  const percent = trafficLimit && trafficLimit > 0 ? Math.max(0, Math.min(100, ((trafficUsed ?? 0) / trafficLimit) * 100)) : null;
  return <article className="cabinet-subscription-record cabinet-subscription-compact" data-active={active}>
    <header>
      <h2>{title}</h2>
      <p className="cabinet-subscription-state" data-active={active}>{active ? t("cabinet.dashboard.active") : t(expireAt && new Date(expireAt).getTime() < Date.now() ? "cabinet.redesign.expired" : "cabinet.redesign.inactive")}</p>
    </header>
    <Dialog open={editing} onOpenChange={setEditing}><DialogContent className="max-w-sm"><DialogHeader><DialogTitle>{t("cabinet.redesign.rename")}</DialogTitle></DialogHeader><form onSubmit={saveName} className="cabinet-form"><Label htmlFor={`subscription-name-${subscriptionId}`}>{t("cabinet.redesign.name")}</Label><Input id={`subscription-name-${subscriptionId}`} value={name} maxLength={60} onChange={event => setName(event.target.value)} autoFocus /><Button type="submit" disabled={saving || !name.trim()}>{t("cabinet.layout.save")}</Button></form></DialogContent></Dialog>
    <div className="cabinet-subscription-metrics">
      <dl className="cabinet-subscription-facts">
        <div><dt>{t("cabinet.dashboard.valid_until")}</dt><dd>{expireAt ? new Date(expireAt).toLocaleDateString(i18n.language, { day: "numeric", month: "short", year: "numeric" }) : t("cabinet.dashboard.unlimited")}</dd>{active && daysLeft != null && Number.isFinite(daysLeft) && <small>{t("cabinet.redesign.days_left", { count: daysLeft })}</small>}</div>
        <div><dt>{t("cabinet.workspace.vpn_devices")}</dt><dd>{deviceLimit && deviceLimit > 0 ? `${devices ?? 0} / ${deviceLimit}` : t("cabinet.dashboard.unlimited")}</dd></div>
      </dl>
      <div className="cabinet-traffic"><div><span>{t("cabinet.dashboard.traffic")}</span><strong>{formatBytes(trafficUsed ?? 0)} <span>/ {trafficLimit && trafficLimit > 0 ? formatBytes(trafficLimit) : t("cabinet.dashboard.unlimited")}</span></strong></div>{percent != null && <progress value={percent} max={100} aria-label={t("cabinet.dashboard.traffic")} />}</div>
    </div>
    <div className="cabinet-subscription-primary-actions">
      {url && <Button asChild className="cabinet-connect-button">{external ? <a href={url} target="_blank" rel="noopener noreferrer"><Wifi size={17} />{t("cabinet.redesign.connect")}</a> : <Link to={connectTo}><Wifi size={17} />{t("cabinet.redesign.connect")}</Link>}</Button>}
      {action}
    </div>
    <button className="cabinet-subscription-disclosure" aria-expanded={detailsOpen} aria-controls={detailsId} onClick={() => setDetailsOpen(!detailsOpen)}>
      <span>{t("cabinet.redesign.subscription_settings")}</span><ChevronDown size={16} />
    </button>
    <AnimatePresence initial={false}>
      {detailsOpen && <motion.div id={detailsId} key="settings" role="region" aria-label={`${t("cabinet.redesign.subscription_settings")}: ${title}`} className="cabinet-subscription-settings" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: reducedMotion ? 0 : .22, ease: [.22, 1, .36, 1] }}>
        <div className="cabinet-subscription-settings-inner">
          {autoRenew && <div className="cabinet-subscription-renew"><span>{t("cabinet.redesign.auto_renew")}<small>{t("cabinet.redesign.auto_renew_hint")}</small></span><Switch aria-label={`${t("cabinet.redesign.auto_renew")}: ${title}`} checked={autoRenew.enabled} disabled={autoRenew.busy} onCheckedChange={autoRenew.toggle} /></div>}
          <div className="cabinet-subscription-management">
            <Link to="/cabinet/profile#devices"><Smartphone size={16} />{t("cabinet.workspace.vpn_devices")}<ArrowRight size={15} /></Link>
            {subscriptionId && <button onClick={() => { setName(title); setEditing(true); }}><Pencil size={16} />{t("cabinet.redesign.rename")}</button>}
          </div>
          {url && <div className="cabinet-subscription-manual"><span>{t("cabinet.redesign.subscription_link")}</span><div><code>{url}</code><CopyLinkButton url={url} className="cabinet-icon-button" /><SubscriptionQrButton url={url} name={title} className="cabinet-icon-button" /></div></div>}
        </div>
      </motion.div>}
    </AnimatePresence>
  </article>;
}
