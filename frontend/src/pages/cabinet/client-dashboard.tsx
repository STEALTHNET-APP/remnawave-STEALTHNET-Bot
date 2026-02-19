import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  CreditCard,
  Package,
  Wallet,
  Wifi,
  Calendar,
  Smartphone,
  ExternalLink,
  ArrowRight,
  PlusCircle,
  HelpCircle,
  Copy,
  Check,
  Gift,
  Loader2,
  Users,
  Percent,
  Tag,
} from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { useCabinetConfig } from "@/contexts/cabinet-config";
import { useCabinetMiniapp } from "@/pages/cabinet/cabinet-layout";
import { api } from "@/lib/api";
import type { ClientPayment, ClientReferralStats } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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

function formatPaymentStatus(status: string): string {
  const s = (status || "").toLowerCase();
  if (s === "paid") return "Оплачен";
  if (s === "pending") return "Не оплачено";
  if (s === "failed") return "Не прошёл";
  if (s === "refunded") return "Возврат";
  return status || "—";
}

/** Remna API может вернуть { response: { ... } } или { data: { response: { ... } } } или сам объект пользователя */
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

export function ClientDashboardPage() {
  const { state, refreshProfile } = useClientAuth();
  const config = useCabinetConfig();
  const [searchParams, setSearchParams] = useSearchParams();
  const [subscription, setSubscription] = useState<unknown>(null);
  const [tariffDisplayName, setTariffDisplayName] = useState<string | null>(null);
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);
  const [payments, setPayments] = useState<ClientPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [paymentMessage, setPaymentMessage] = useState<"success_topup" | "success_tariff" | "success" | "failed" | null>(null);
  const [trialLoading, setTrialLoading] = useState(false);
  const [trialError, setTrialError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [referralStats, setReferralStats] = useState<ClientReferralStats | null>(null);

  const token = state.token;
  const isMiniapp = useCabinetMiniapp();
  const client = state.client;
  const showTrial = config?.trialEnabled && !client?.trialUsed;
  const trialDays = config?.trialDays ?? 0;

  useEffect(() => {
    const payment = searchParams.get("payment");
    const yoomoneyForm = searchParams.get("yoomoney_form");
    const paymentKind = searchParams.get("payment_kind");
    if (payment === "success") {
      if (paymentKind === "topup") setPaymentMessage("success_topup");
      else if (paymentKind === "tariff") setPaymentMessage("success_tariff");
      else setPaymentMessage("success");
      setSearchParams({}, { replace: true });
      if (token) refreshProfile().catch(() => {});
    } else if (payment === "failed") {
      setPaymentMessage("failed");
      setSearchParams({}, { replace: true });
      if (token) refreshProfile().catch(() => {});
    } else if (yoomoneyForm === "success") {
      setSearchParams({}, { replace: true });
      if (token) refreshProfile().catch(() => {});
    } else if (searchParams.get("yookassa") === "success") {
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
    ])
      .then(([subRes, payRes]) => {
        if (cancelled) return;
        setSubscription(subRes.subscription ?? null);
        setTariffDisplayName(subRes.tariffDisplayName ?? null);
        if (subRes.message) setSubscriptionError(subRes.message);
        setPayments(payRes.items ?? []);
      })
      .catch((e) => {
        if (!cancelled) setSubscriptionError(e instanceof Error ? e.message : "Ошибка загрузки");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [token, refreshKey]);

  useEffect(() => {
    if (!token || !isMiniapp) return;
    api.getClientReferralStats(token).then(setReferralStats).catch(() => {});
  }, [token, isMiniapp]);

  async function activateTrial() {
    if (!token) return;
    setTrialError(null);
    setTrialLoading(true);
    try {
      await api.clientActivateTrial(token);
      await refreshProfile();
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setTrialError(e instanceof Error ? e.message : "Ошибка активации триала");
    } finally {
      setTrialLoading(false);
    }
  }

  if (!client) return null;

  const subParsed = parseSubscription(subscription);
  const hasActiveSubscription =
    subscription && typeof subscription === "object" && (subParsed.status === "ACTIVE" || subParsed.status === undefined);
  // Ссылка на VPN берётся только из Remna (subscriptionUrl), без резервной ссылки из настроек
  const vpnUrl = subParsed.subscriptionUrl || null;
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
  const trafficPercent = subParsed.trafficLimitBytes != null && subParsed.trafficLimitBytes > 0 && subParsed.trafficUsed != null
    ? Math.min(100, Math.round((subParsed.trafficUsed / subParsed.trafficLimitBytes) * 100))
    : null;

  const expireDate = subParsed.expireAt ? (() => { try { const d = new Date(subParsed.expireAt); return Number.isNaN(d.getTime()) ? null : d; } catch { return null; } })() : null;
  const daysLeft = expireDate && expireDate > new Date()
    ? Math.max(0, Math.ceil((expireDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
    : null;

  if (isMiniapp) {
    return (
      <div className="w-full min-w-0 overflow-hidden space-y-4">
        {(paymentMessage === "success" || paymentMessage === "success_topup" || paymentMessage === "success_tariff") && (
          <div className="rounded-lg bg-green-500/15 border border-green-500/30 px-3 py-2 text-sm font-medium text-green-700 dark:text-green-400">
            {paymentMessage === "success_topup"
              ? "Оплата прошла успешно. Баланс пополнен."
              : paymentMessage === "success_tariff"
                ? "Оплата прошла успешно. Тариф активируется автоматически."
                : "Оплата прошла успешно. Статус обновляется автоматически."}
          </div>
        )}
        {paymentMessage === "failed" && (
          <div className="rounded-lg bg-destructive/15 border border-destructive/30 px-3 py-2 text-sm font-medium text-destructive">
            Оплата не прошла. Попробуйте снова.
          </div>
        )}

        {/* 1. Статус, срок, тариф, трафик, устройства — с иконками */}
        <section className="rounded-xl border bg-card p-4 overflow-hidden">
          <h2 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground mb-4">
            <Package className="h-4 w-4 shrink-0" />
            Подписка
          </h2>
          {loading ? (
            <p className="text-sm text-muted-foreground">Загрузка…</p>
          ) : subscriptionError ? (
            <p className="text-sm text-destructive break-words">{subscriptionError}</p>
          ) : hasActiveSubscription ? (
            <div className="space-y-4 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold bg-green-500/20 text-green-700 dark:text-green-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  Активна
                </span>
                {daysLeft != null && (
                  <span className="text-sm font-semibold text-foreground">
                    Осталось {daysLeft} {daysLeft === 1 ? "день" : daysLeft < 5 ? "дня" : "дней"}
                  </span>
                )}
              </div>

              <div className="space-y-2.5 border-t border-border pt-3">
                {subParsed.expireAt && (
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <Calendar className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-muted-foreground">До окончания</p>
                      <p className="text-sm font-medium truncate">{formatDate(subParsed.expireAt)}</p>
                    </div>
                  </div>
                )}
                {(tariffDisplayName ?? subParsed.productName) && (
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Package className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-muted-foreground">Тариф</p>
                      <p className="text-sm font-medium truncate" title={tariffDisplayName ?? subParsed.productName ?? ""}>{tariffDisplayName ?? subParsed.productName ?? ""}</p>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-3 min-w-0">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <Wifi className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground">Трафик</p>
                    <p className="text-sm font-medium truncate">
                      {subParsed.trafficLimitBytes != null && subParsed.trafficLimitBytes > 0
                        ? subParsed.trafficUsed != null
                          ? `${formatBytes(subParsed.trafficUsed)} из ${formatBytes(subParsed.trafficLimitBytes)}`
                          : `Лимит ${formatBytes(subParsed.trafficLimitBytes)}`
                        : subParsed.trafficUsed != null
                          ? `Использовано ${formatBytes(subParsed.trafficUsed)}`
                          : "Без лимита"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 min-w-0">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <Smartphone className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground">Устройств</p>
                    <p className="text-sm font-medium">
                      {subParsed.hwidDeviceLimit != null && subParsed.hwidDeviceLimit > 0
                        ? `До ${subParsed.hwidDeviceLimit}`
                        : "Без лимита"}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium bg-muted text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
                {subParsed.status === "EXPIRED" ? "Истекла" : subParsed.status === "DISABLED" ? "Отключена" : "Нет подписки"}
              </span>
              <p className="text-sm text-muted-foreground">Выберите тариф и оплатите — вклад «Тарифы» внизу.</p>
            </div>
          )}
        </section>

        {/* 2. Как подключиться — ссылка и кнопка */}
        <section className="rounded-xl border bg-card p-4 overflow-hidden">
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">Как подключиться</h2>
          {vpnUrl ? (
            <div className="space-y-3">
              <p className="text-sm text-foreground">Нажмите кнопку ниже — откроется страница с приложениями и кнопкой «Добавить подписку» (как на сайте).</p>
              <div className="flex gap-2 min-w-0">
                <code className="flex-1 min-w-0 truncate rounded-lg bg-muted px-3 py-2 text-xs font-mono" title={vpnUrl}>
                  {vpnUrl}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => {
                    navigator.clipboard.writeText(vpnUrl);
                    window.Telegram?.WebApp?.showPopup?.({ title: "Скопировано", message: "Ссылка в буфере обмена" });
                  }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <Button className="w-full gap-2" size="lg" asChild>
                <Link to="/cabinet/subscribe">
                  <Wifi className="h-5 w-5 shrink-0" />
                  Подключиться к VPN
                </Link>
              </Button>
            </div>
          ) : showTrial ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Получите бесплатный доступ на {trialDays} {trialDays === 1 ? "день" : "дня"}.</p>
              <Button className="w-full gap-2 bg-green-600 hover:bg-green-700" size="lg" onClick={activateTrial} disabled={trialLoading}>
                {trialLoading ? <Loader2 className="h-5 w-5 shrink-0 animate-spin" /> : <Gift className="h-5 w-5 shrink-0" />}
                Попробовать бесплатно
              </Button>
              {trialError && <p className="text-sm text-destructive break-words">{trialError}</p>}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Ссылка появится после оплаты тарифа. Перейдите во вкладку «Тарифы» и оплатите.</p>
              <Button className="w-full" variant="outline" size="lg" asChild>
                <Link to="/cabinet/tariffs">Выбрать тариф</Link>
              </Button>
            </div>
          )}
        </section>

        {/* 3. Баланс */}
        <section className="rounded-xl border bg-card p-4 overflow-hidden">
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">Баланс</h2>
          <p className="text-2xl font-semibold truncate">{formatMoney(client.balance, client.preferredCurrency)}</p>
          <Button className="w-full mt-3 gap-2" size="sm" asChild>
            <Link to="/cabinet/profile#topup">
              <PlusCircle className="h-4 w-4 shrink-0" />
              Пополнить
            </Link>
          </Button>
        </section>

        {/* 3.5 Рефералы — процент, количество, заработок */}
        <section className="rounded-xl border bg-card p-4 overflow-hidden">
          <h2 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
            <Users className="h-4 w-4 shrink-0" />
            Рефералы
          </h2>
          {referralStats ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-3 text-sm">
                <span className="flex items-center gap-1.5">
                  <Percent className="h-4 w-4 text-muted-foreground" />
                  <strong>{referralStats.referralPercent}%</strong>
                  <span className="text-muted-foreground">ваш процент</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <strong>{referralStats.referralCount}</strong>
                  <span className="text-muted-foreground">приглашено</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <Wallet className="h-4 w-4 text-muted-foreground" />
                  <strong>{formatMoney(referralStats.totalEarnings, client.preferredCurrency)}</strong>
                  <span className="text-muted-foreground">заработок</span>
                </span>
              </div>
              {hasReferralLinks && (
                <div className="flex flex-wrap gap-2">
                  {referralLinkSite && (
                    <Button variant="outline" size="sm" className="gap-1" onClick={() => copyReferral("site")}>
                      {referralCopied === "site" ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                      Ссылка на сайт
                    </Button>
                  )}
                  {referralLinkBot && (
                    <Button variant="outline" size="sm" className="gap-1" onClick={() => copyReferral("bot")}>
                      {referralCopied === "bot" ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                      Ссылка на бот
                    </Button>
                  )}
                </div>
              )}
              <Button className="w-full gap-2" variant="outline" size="sm" asChild>
                <Link to="/cabinet/referral">
                  Подробнее
                  <ArrowRight className="h-4 w-4 shrink-0" />
                </Link>
              </Button>
            </div>
          ) : (
            <Button className="w-full gap-2" variant="outline" size="sm" asChild>
              <Link to="/cabinet/referral">
                <Users className="h-4 w-4 shrink-0" />
                Реферальная программа
              </Link>
            </Button>
          )}
        </section>

        {/* 4. Краткая инструкция */}
        <section className="rounded-xl border border-muted bg-muted/30 p-4 overflow-hidden">
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">Инструкция</h2>
          <ol className="list-decimal list-inside space-y-1.5 text-sm text-muted-foreground">
            <li>Нажмите «Подключиться к VPN» выше — откроется страница с приложениями и кнопкой «Добавить подписку» (как на сайте).</li>
            <li>Тарифы и пополнение — во вкладках «Тарифы» и «Профиль» внизу.</li>
          </ol>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Hero + CTA */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary/15 via-primary/5 to-transparent border p-6 sm:p-8"
      >
        <div className="relative z-10">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Добро пожаловать{client.email ? `, ${client.email.split("@")[0]}` : client.telegramUsername ? `, @${client.telegramUsername}` : ""}
          </h1>
          <p className="mt-1 text-muted-foreground">
            {hasActiveSubscription
              ? "Ваша подписка активна. Подключитесь к VPN и пользуйтесь интернетом без ограничений."
              : "Подключитесь к VPN — выберите тариф и оплатите картой на сайте или в боте."}
          </p>
          {(paymentMessage === "success" || paymentMessage === "success_topup" || paymentMessage === "success_tariff") && (
            <p className="text-sm text-green-600 font-medium">
              {paymentMessage === "success_topup"
                ? "Оплата прошла успешно. Баланс пополнен."
                : paymentMessage === "success_tariff"
                  ? "Оплата прошла успешно. Тариф активируется автоматически."
                  : "Оплата прошла успешно. Статус обновляется автоматически."}
            </p>
          )}
          {paymentMessage === "failed" && (
            <p className="text-sm text-destructive font-medium">Оплата не прошла. Попробуйте снова или выберите другой способ.</p>
          )}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {showTrial ? (
              <Button
                size="lg"
                variant="default"
                className="inline-flex items-center gap-2 whitespace-nowrap bg-green-600 hover:bg-green-700"
                onClick={activateTrial}
                disabled={trialLoading}
              >
                {trialLoading ? <Loader2 className="h-5 w-5 shrink-0 animate-spin" /> : <Gift className="h-5 w-5 shrink-0" />}
                Попробовать бесплатно{trialDays > 0 ? ` (${trialDays} дн.)` : ""}
              </Button>
            ) : vpnUrl ? (
              <Button size="lg" className="inline-flex items-center gap-2 whitespace-nowrap" asChild>
                <Link to="/cabinet/subscribe">
                  <Wifi className="h-5 w-5 shrink-0" />
                  Подключиться к VPN
                  <ExternalLink className="h-4 w-4 shrink-0" />
                </Link>
              </Button>
            ) : (
              <Button size="lg" className="inline-flex items-center gap-2 whitespace-nowrap" disabled title="Ссылка на VPN будет доступна после активации подписки">
                <Wifi className="h-5 w-5 shrink-0" />
                Подключиться к VPN
              </Button>
            )}
            <Button variant="outline" size="lg" className="inline-flex items-center gap-2 whitespace-nowrap" asChild>
              <Link to="/cabinet/tariffs">
                Выбрать тариф
                <ArrowRight className="h-4 w-4 shrink-0" />
              </Link>
            </Button>
            <Button variant="secondary" size="lg" className="inline-flex items-center gap-2 whitespace-nowrap" asChild>
              <Link to="/cabinet/profile#topup">
                <PlusCircle className="h-5 w-5 shrink-0" />
                Пополнить баланс
              </Link>
            </Button>
          </div>
          {trialError && <p className="mt-2 text-sm text-destructive">{trialError}</p>}
        </div>
      </motion.section>

      {/* Быстрые действия */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.05 }}
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        {showTrial ? (
          <Button
            variant="outline"
            className="h-auto flex-col gap-2 py-4 border-green-500/50 bg-green-500/5 hover:bg-green-500/10"
            onClick={activateTrial}
            disabled={trialLoading}
          >
            <Gift className="h-6 w-6 text-green-600" />
            <span>Попробовать бесплатно</span>
            <span className="text-xs font-normal text-muted-foreground">{trialDays > 0 ? `${trialDays} дней триала` : "Триал"}</span>
          </Button>
        ) : vpnUrl ? (
          <Button variant="outline" className="h-auto flex-col gap-2 py-4" asChild>
            <Link to="/cabinet/subscribe">
              <Wifi className="h-6 w-6 text-primary" />
              <span>Подключиться к VPN</span>
              <span className="text-xs font-normal text-muted-foreground">Добавление подписки</span>
            </Link>
          </Button>
        ) : (
          <Button variant="outline" className="h-auto flex-col gap-2 py-4" disabled>
            <Wifi className="h-6 w-6 text-muted-foreground" />
            <span>Подключиться к VPN</span>
            <span className="text-xs font-normal text-muted-foreground">После активации подписки</span>
          </Button>
        )}
        <Button variant="outline" className="h-auto flex-col gap-2 py-4" asChild>
          <Link to="/cabinet/profile#topup">
            <PlusCircle className="h-6 w-6 text-primary" />
            <span>Пополнить баланс</span>
            <span className="text-xs font-normal text-muted-foreground">Картой на сайте (Platega)</span>
          </Link>
        </Button>
        <Button variant="outline" className="h-auto flex-col gap-2 py-4" asChild>
          <Link to="/cabinet/tariffs">
            <Package className="h-6 w-6 text-primary" />
            <span>Тарифы</span>
            <span className="text-xs font-normal text-muted-foreground">Выбрать и оплатить картой</span>
          </Link>
        </Button>
        <Button variant="outline" className="h-auto flex-col gap-2 py-4" asChild>
          <Link to="/cabinet/profile">
            <Wallet className="h-6 w-6 text-primary" />
            <span>Профиль и платежи</span>
            <span className="text-xs font-normal text-muted-foreground">Настройки, история</span>
          </Link>
        </Button>
      </motion.section>

      {/* Cards grid */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {/* Подписка / тариф */}
        <Card className="rounded-xl border bg-card text-card-foreground shadow sm:col-span-2 lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Package className="h-5 w-5 text-primary" />
              Подписка
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? (
              <p className="text-sm text-muted-foreground">Загрузка…</p>
            ) : subscriptionError ? (
              <p className="text-sm text-destructive">{subscriptionError}</p>
            ) : subscription && typeof subscription === "object" ? (
              <>
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    hasActiveSubscription ? "bg-green-500/15 text-green-700 dark:text-green-400" : "bg-muted text-muted-foreground"
                  }`}>
                    {hasActiveSubscription ? "Активна" : subParsed.status === "EXPIRED" ? "Истекла" : subParsed.status === "DISABLED" ? "Отключена" : "Неактивна"}
                  </span>
                </div>
                {((tariffDisplayName ?? subParsed.productName) || (hasActiveSubscription && client?.trialUsed)) && (
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Tag className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span>Тариф: {((tariffDisplayName ?? subParsed.productName?.trim() ?? "").trim()) || "Триал"}</span>
                  </div>
                )}
                {subParsed.expireAt && (
                  <div className="flex items-center gap-2 text-sm">
                    <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span>До {formatDate(subParsed.expireAt)}</span>
                  </div>
                )}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <Wifi className="h-4 w-4 shrink-0 text-muted-foreground" />
                      {subParsed.trafficLimitBytes != null && subParsed.trafficLimitBytes > 0
                        ? subParsed.trafficUsed != null
                          ? `Использовано: ${formatBytes(subParsed.trafficUsed)} из ${formatBytes(subParsed.trafficLimitBytes)}`
                          : `Лимит: ${formatBytes(subParsed.trafficLimitBytes)}`
                        : subParsed.trafficUsed != null
                          ? `Использовано: ${formatBytes(subParsed.trafficUsed)}`
                          : "Трафик: без лимита"}
                    </span>
                    {trafficPercent != null && (
                      <span className="text-muted-foreground text-xs">{trafficPercent}%</span>
                    )}
                  </div>
                  {trafficPercent != null && (
                    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${trafficPercent}%` }}
                      />
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Smartphone className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span>
                    {subParsed.hwidDeviceLimit != null && subParsed.hwidDeviceLimit > 0
                      ? `Лимит устройств: ${subParsed.hwidDeviceLimit}`
                      : "Устройства: без лимита"}
                  </span>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Нет активной подписки. <Link to="/cabinet/tariffs" className="text-primary underline">Выбрать тариф</Link>
              </p>
            )}
          </CardContent>
        </Card>

        {/* Баланс + пополнение */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Wallet className="h-5 w-5 text-primary" />
              Баланс
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-2xl font-semibold">
              {formatMoney(client.balance, client.preferredCurrency)}
            </p>
            <p className="text-xs text-muted-foreground">Для оплаты тарифов и продления</p>
            <Button variant="default" size="sm" className="w-full gap-2" asChild>
              <Link to="/cabinet/profile#topup">
                <PlusCircle className="h-4 w-4" />
                Пополнить баланс
              </Link>
            </Button>
          </CardContent>
        </Card>

        {/* Справа от баланса: реферальные ссылки или ссылка VPN */}
        <Card className="sm:col-span-2 lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {hasReferralLinks ? "Реферальные ссылки" : "Подключение"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {hasReferralLinks ? (
              <>
                <p className="text-sm text-muted-foreground">Поделитесь с друзьями — при регистрации по ссылке вы получите бонус</p>
                {referralLinkSite && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">Сайт</p>
                    <div className="flex items-center gap-2">
                      <code className="rounded bg-muted px-2 py-1.5 text-sm font-mono flex-1 truncate block" title={referralLinkSite}>
                        {referralLinkSite}
                      </code>
                      <Button variant="outline" size="sm" onClick={() => copyReferral("site")} className="shrink-0 gap-1" title="Копировать">
                        {referralCopied === "site" ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  </div>
                )}
                {referralLinkBot && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">Бот Telegram</p>
                    <div className="flex items-center gap-2">
                      <code className="rounded bg-muted px-2 py-1.5 text-sm font-mono flex-1 truncate block" title={referralLinkBot}>
                        {referralLinkBot}
                      </code>
                      <Button variant="outline" size="sm" onClick={() => copyReferral("bot")} className="shrink-0 gap-1" title="Копировать">
                        {referralCopied === "bot" ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  </div>
                )}
              </>
            ) : vpnUrl ? (
              <>
                <p className="text-sm text-muted-foreground">Добавление подписки</p>
                <Button variant="outline" size="sm" className="w-full gap-2" asChild>
                  <Link to="/cabinet/subscribe">
                    <Wifi className="h-4 w-4" />
                    Подключиться к VPN
                  </Link>
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">После оплаты тарифа здесь появится ссылка на подключение</p>
                <Button variant="outline" size="sm" className="w-full" asChild>
                  <Link to="/cabinet/tariffs">Выбрать тариф</Link>
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        {/* Последние платежи */}
        <Card className="sm:col-span-2 lg:col-span-3">
          <CardHeader className="pb-2">
            <div className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <CreditCard className="h-5 w-5 text-primary" />
                Последние платежи
              </CardTitle>
              {payments.length > 0 && (
                <Link to="/cabinet/profile" className="text-sm text-primary hover:underline">
                  Все
                </Link>
              )}
            </div>
            <p className="text-xs text-muted-foreground font-normal mt-1">Оплата открывается в новой вкладке — кабинет остаётся открытым.</p>
          </CardHeader>
          <CardContent>
            {payments.length === 0 ? (
              <p className="text-sm text-muted-foreground">Платежей пока нет</p>
            ) : (
              <ul className="space-y-2">
                {payments.slice(0, 5).map((p) => (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm"
                  >
                    <span className="font-medium">{p.orderId}</span>
                    <span>{formatMoney(p.amount, p.currency)}</span>
                    <span
                      className={
                        p.status?.toLowerCase() === "paid" ? "text-green-600 dark:text-green-400" : "text-muted-foreground"
                      }
                    >
                      {formatPaymentStatus(p.status)}
                    </span>
                    <span className="text-muted-foreground text-xs">{formatDate(p.paidAt ?? p.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Как начать */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
      >
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <HelpCircle className="h-5 w-5 text-primary" />
              Как начать
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
              <li>Выберите тариф в разделе <Link to="/cabinet/tariffs" className="text-primary underline">Тарифы</Link> и оплатите в Telegram-боте или по инструкциям.</li>
              <li>После оплаты нажмите «Подключиться к VPN» и откройте ссылку подписки.</li>
              <li>Установите приложение или настройте клиент по инструкции Remna и пользуйтесь VPN.</li>
            </ol>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
