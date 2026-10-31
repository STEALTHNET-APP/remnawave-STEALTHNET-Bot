import { SubscriptionQrButton } from "@/components/subscription-link-actions";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ChevronRight, Check, Copy, Gift, History, Loader2, MoreHorizontal, Pencil, Plus, RefreshCw, RotateCcw,
  Smartphone, Sparkles, Tag, Trash2, Wallet, Wifi, Zap,
} from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { useCabinetConfig } from "@/contexts/cabinet-config";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatAuroraBalance } from "@/lib/aurora-profile";
import { formatTraffic, remnaDaysLeft, remnaInfo, remnaIsActive } from "@/lib/subscription-remna";
import { AuroraDevicesSheet } from "@/components/aurora/aurora-devices-sheet";
import { AuroraTrialsSheet } from "@/components/aurora/aurora-trials-sheet";
import { AuroraPromoSheet } from "@/components/aurora/aurora-promo-sheet";
import { AuroraConfirmSheet } from "@/components/aurora/aurora-confirm-sheet";
import { AuroraSheet } from "@/components/aurora/aurora-sheet";
import { AuButton, AuEmpty, AuInput, AuLoading, AuNotice, AuPage } from "@/components/aurora/aurora-ui";
import { toast } from "@/components/ui/toast";
import { copyText } from "@/lib/clipboard";

type SubscriptionItem = Awaited<ReturnType<typeof api.clientAllSubscriptions>>["items"][number];
type ActionKind = "reissue" | "remove-extras" | "rename" | "autorenew-on" | "autorenew-off";

interface PendingAction {
  kind: ActionKind;
  item: SubscriptionItem;
}

export function AuroraDashboard() {
  const { t, i18n } = useTranslation();
  const { state, refreshProfile } = useClientAuth();
  const config = useCabinetConfig();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const token = state.token ?? null;
  const client = state.client;

  const [items, setItems] = useState<SubscriptionItem[]>([]);
  const [deviceCounts, setDeviceCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [menuItemId, setMenuItemId] = useState<string | null>(null);

  const [devicesOpen, setDevicesOpen] = useState(false);
  const [trialsOpen, setTrialsOpen] = useState(false);
  const [promoOpen, setPromoOpen] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const locale = i18n.language || "ru";

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const [subs, devices] = await Promise.all([
        api.clientAllSubscriptions(token),
        api.getMyAllDevices(token).catch(() => ({ total: 0, items: [] })),
      ]);
      setItems(subs.items ?? []);
      const counts: Record<string, number> = {};
      for (const device of devices.items ?? []) {
        counts[device.subscriptionId] = (counts[device.subscriptionId] ?? 0) + 1;
      }
      setDeviceCounts(counts);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("aurora.dashboard_load_error"));
    } finally {
      setLoading(false);
    }
  }, [token, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const payment = searchParams.get("payment");
    const paymentId = searchParams.get("paymentId") || searchParams.get("orderId") || searchParams.get("id");
    const providerReturn = ["yookassa", "heleket", "rollypay", "paritypay", "lava", "lavatop", "yoomoney_form"].some(
      (key) => searchParams.get(key) === "success",
    ) || searchParams.get("overpay") === "return";

    if (payment === "failed") {
      toast.error(t("aurora.payment_failed"));
      setSearchParams({}, { replace: true });
      return;
    }

    if (paymentId && (payment === "success" || providerReturn)) {
      navigate(`/cabinet/payment-wait?id=${encodeURIComponent(paymentId)}`, { replace: true });
      return;
    }

    if (payment === "success" || providerReturn) {
      setSearchParams({}, { replace: true });
      refreshProfile().catch(() => {});
      void load();
    }
  }, [searchParams, setSearchParams, refreshProfile, load, navigate, t]);

  useEffect(() => {
    if (!token || loading) return;
    const pendingCode = localStorage.getItem("stealthnet_pending_gift");
    if (!pendingCode) return;
    localStorage.removeItem("stealthnet_pending_gift");
    api.giftRedeemCode(token, pendingCode)
      .then((res) => {
        toast.success(res.message || t("aurora.gift_redeemed"));
        refreshProfile().catch(() => {});
        void load();
      })
      .catch((e) => {
        toast.error(e instanceof Error ? e.message : t("aurora.gift_redeem_error"));
      });
  }, [token, loading, refreshProfile, load, t]);

  const currency = (client?.preferredCurrency ?? "rub").toUpperCase();
  const balanceText = formatAuroraBalance(client?.balance ?? 0, currency, locale);

  const hasAnySubscription = items.length > 0;
  const hasOfflineSnapshot = items.some((item) => item.isOfflineSnapshot === true);
  const trialAvailable = Boolean(config?.trialEnabled) && !client?.trialUsed;
  const canBuyAdditional = config?.multiSubscriptionsEnabled !== false;
  const quickActions = [
    ...(config?.giftSubscriptionsEnabled
      ? [{ key: "gifts", label: t("aurora.gifts"), hint: t("aurora.quick_gifts_hint"), icon: Gift, to: "/cabinet/gifts" }]
      : []),
    ...(config?.rouletteEnabled !== false
      ? [{ key: "roulette", label: t("aurora.roulette"), hint: t("aurora.quick_roulette_hint"), icon: Sparkles, to: "/cabinet/roulette" }]
      : []),
    { key: "promo", label: t("aurora.promo"), hint: t("aurora.quick_promo_hint"), icon: Tag, to: null },
    ...(config?.sellOptionsEnabled
      ? [{ key: "options", label: t("aurora.extra_options"), hint: t("aurora.quick_options_hint"), icon: Zap, to: "/cabinet/extra-options" }]
      : []),
  ];

  function openConnect(item: SubscriptionItem) {
    const url = item.remnawaveUuid ? `/cabinet/subscribe?uuid=${encodeURIComponent(item.remnawaveUuid)}` : "/cabinet/subscribe";
    navigate(url);
  }

  function openRenew(item: SubscriptionItem) {
    navigate(`/cabinet/tariffs?extend=${encodeURIComponent(item.id)}`);
  }

  async function runAction(action: PendingAction) {
    if (!token) return;
    setActionBusy(true);
    setActionError(null);
    try {
      if (action.kind === "reissue") {
        await api.clientReissueSubscription(token, action.item.type, action.item.id);
        toast.success(t("aurora.reissue_done"));
      } else if (action.kind === "remove-extras") {
        const res = await api.clientRemoveExtraDevices(token, action.item.type, action.item.id);
        toast.success(t("aurora.extras_removed", { count: res.extraDevicesRemoved }));
      } else if (action.kind === "rename") {
        await api.clientRenameSubscription(token, action.item.id, renameValue.trim());
        toast.success(t("aurora.rename_done"));
      } else if (action.kind === "autorenew-on" || action.kind === "autorenew-off") {
        await api.clientSetSubscriptionAutoRenew(token, action.item.type, action.item.id, action.kind === "autorenew-on");
        toast.success(t("aurora.autorenew_done"));
      }
      setPending(null);
      await Promise.all([load(), refreshProfile().catch(() => {})]);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t("aurora.action_error"));
    } finally {
      setActionBusy(false);
    }
  }

  function beginAction(kind: ActionKind, item: SubscriptionItem) {
    setActionError(null);
    setRenameValue(item.customName ?? item.tariffDisplayName ?? "");
    setPending({ kind, item });
  }

  const main = useMemo(() => items.find((item) => item.type === "root") ?? items[0] ?? null, [items]);
  const menuItem = items.find((item) => item.id === menuItemId) ?? null;

  if (loading) return <AuLoading rows={4} />;

  return (
    <AuPage>
      <header className="px-1 pb-1">
        <h1 className="truncate text-[26px] font-extrabold leading-tight tracking-tight text-[var(--au-ink)]">
          {t("aurora.hello")}
        </h1>
        <p className="mt-0.5 truncate text-[14px] text-[var(--au-muted)]">
          {client?.email || (client?.telegramUsername ? `@${client.telegramUsername}` : config?.serviceName || "")}
        </p>
      </header>

      {error && <AuNotice tone="error">{error}</AuNotice>}

      {hasOfflineSnapshot && <AuNotice>{t("aurora.offline_snapshot")}</AuNotice>}

      {items.some((item) => item.isBanned) && (
        <AuNotice tone="error">
          {items.find((item) => item.isBanned)?.banReason || t("aurora.banned_hint")}
        </AuNotice>
      )}

      <section className="au-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--au-muted)]">
              <Wallet className="h-4 w-4" />
              {t("aurora.balance")}
            </div>
            <div className="mt-1.5 text-[34px] font-extrabold leading-none tracking-tight tabular-nums text-[var(--au-ink)]">
              {balanceText}
            </div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => navigate("/cabinet/profile?tab=topup")}
            className="flex min-h-11 items-center justify-center gap-2 rounded-[14px] bg-[var(--au-from)] px-4 py-2.5 text-[14px] font-bold text-white transition-transform active:scale-[0.98]"
          >
            <Plus className="h-4 w-4" />
            {t("aurora.topup")}
          </button>
          <button
            type="button"
            onClick={() => navigate("/cabinet/history")}
            className="flex min-h-11 items-center justify-center gap-2 rounded-[14px] bg-[var(--au-bg)] px-4 py-2.5 text-[14px] font-bold text-[var(--au-ink)] transition-transform active:scale-[0.98]"
          >
            <History className="h-4 w-4" />
            {t("aurora.history")}
          </button>
        </div>
      </section>

      {!hasAnySubscription && (
        <AuEmpty
          icon={<Zap className="h-6 w-6" />}
          title={t("aurora.no_subscription")}
          hint={t("aurora.no_subscription_hint")}
          action={
            <div className="mt-1 w-full space-y-2">
              <AuButton onClick={() => navigate("/cabinet/tariffs")}>{t("aurora.choose_tariff")}</AuButton>
              {trialAvailable && <AuButton variant="surface" onClick={() => setTrialsOpen(true)}>{t("aurora.try_trial")}</AuButton>}
            </div>
          }
        />
      )}

      {items.map((item) => {
        const info = remnaInfo(item.subscription);
        const days = remnaDaysLeft(info.expireAt);
        const offline = item.isOfflineSnapshot === true;
        const active = offline ? days == null || days > 0 : remnaIsActive(info, days);
        const isMain = main?.id === item.id;
        const deviceCount = deviceCounts[item.id] ?? 0;
        const limit = info.deviceLimit;
        const used = info.trafficUsed ?? 0;
        const trafficLimit = info.trafficLimitBytes;
        const unlimited = trafficLimit == null || trafficLimit === 0;
        const rest = unlimited ? null : Math.max(0, trafficLimit - used);
        const usedPercent = unlimited ? 0 : Math.min(100, Math.round((used / Math.max(1, trafficLimit)) * 100));
        const title = item.customName?.trim() || item.tariffDisplayName?.trim() || info.productName || t("aurora.subscription");
        const muted = isMain ? "text-white/75" : "text-[var(--au-muted)]";
        const strong = isMain ? "text-white" : "text-[var(--au-ink)]";
        const utility = isMain
          ? "border-0 bg-white/18 text-white hover:bg-white/25"
          : "border-0 bg-[var(--au-bg)] text-[var(--au-ink)]";

        return (
          <section
            key={item.id}
            className={cn(
              "overflow-hidden rounded-[26px] p-5",
              isMain
                ? "au-hero bg-[linear-gradient(150deg,var(--au-from),var(--au-to))] text-white shadow-[0_18px_40px_-24px_color-mix(in_srgb,var(--au-from)_70%,transparent)]"
                : "au-card text-[var(--au-ink)]",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn("truncate text-[17px] font-bold", strong)}>{title}</span>
                  {item.trialId && (
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", isMain ? "bg-white/25" : "bg-[var(--au-bg)] text-[var(--au-from)]")}>
                      {t("aurora.trial_badge")}
                    </span>
                  )}
                  {item.subscriptionIndex != null && <span className={cn("text-[12px]", muted)}>#{item.subscriptionIndex}</span>}
                </div>
                <div className={cn("mt-1.5 flex flex-wrap items-center gap-2 text-[13px]", muted)}>
                  <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-semibold", active ? (isMain ? "bg-white/20 text-white" : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400") : (isMain ? "bg-white/20 text-white" : "bg-red-500/15 text-red-600 dark:text-red-400"))}>
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                    {active ? t("aurora.active") : t("aurora.inactive")}
                  </span>
                  {item.autoRenewEnabled && <span>{t("aurora.autorenew_on")}</span>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMenuItemId(item.id)}
                aria-label={t("aurora.manage_subscription")}
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-transform active:scale-95",
                  isMain ? "bg-white/18 text-white" : "bg-[var(--au-bg)] text-[var(--au-muted)]",
                )}
              >
                <MoreHorizontal className="h-[18px] w-[18px]" />
              </button>
            </div>

            <div className="mt-4 flex items-end justify-between gap-3">
              <div>
                <div className={cn("text-[40px] font-extrabold leading-none tracking-tight tabular-nums", strong)}>
                  {days ?? "—"}
                </div>
                <div className={cn("mt-1 text-[12px]", muted)}>{t("aurora.days_left")}</div>
              </div>
              {info.expireAt && (
                <div className={cn("pb-0.5 text-right text-[12px]", muted)}>
                  <div>{t("aurora.expires")}</div>
                  <div className={cn("mt-0.5 text-[13px] font-semibold", strong)}>
                    {new Date(info.expireAt).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" })}
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className={cn("rounded-[18px] p-3", isMain ? "bg-white/14" : "bg-[var(--au-bg)]")}>
                <div className={cn("flex items-center gap-1.5 text-[12px]", muted)}>
                  <Smartphone className="h-3.5 w-3.5" />
                  {t("aurora.devices")}
                </div>
                <div className={cn("mt-1 text-[15px] font-bold tabular-nums", strong)}>
                  {limit != null ? `${deviceCount}/${limit}` : deviceCount}
                </div>
              </div>
              <div className={cn("rounded-[18px] p-3", isMain ? "bg-white/14" : "bg-[var(--au-bg)]")}>
                <div className={cn("flex items-center gap-1.5 text-[12px]", muted)}>
                  <Wifi className="h-3.5 w-3.5" />
                  {t("aurora.traffic")}
                </div>
                <div className={cn("mt-1 truncate text-[15px] font-bold tabular-nums", strong)}>
                  {unlimited ? t("aurora.unlimited") : `${formatTraffic(rest)} / ${formatTraffic(trafficLimit)}`}
                </div>
                {!unlimited && (
                  <div className={cn("mt-2 h-1.5 overflow-hidden rounded-full", isMain ? "bg-white/25" : "bg-[var(--au-surface)]")}>
                    <div
                      className={cn("h-full rounded-full", isMain ? "bg-white" : "bg-[var(--au-from)]")}
                      style={{ width: `${Math.max(4, 100 - usedPercent)}%` }}
                    />
                  </div>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() => openConnect(item)}
              className={cn(
                "mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-[16px] px-4 text-[15px] font-bold transition-transform active:scale-[0.99]",
                isMain
                  ? "bg-white text-[var(--au-from)]"
                  : "bg-[var(--au-from)] text-white",
              )}
            >
              <Wifi className="h-4 w-4" />
              {t("aurora.connect")}
            </button>

            <div className="mt-2 flex gap-2">
              {info.subscriptionUrl ? (
                <>
                  <CopySubscriptionLink url={info.subscriptionUrl} className={utility} />
                  <SubscriptionQrButton
                    url={info.subscriptionUrl}
                    name={title}
                    className={cn("h-11 w-11 shrink-0 rounded-[16px]", utility)}
                  />
                </>
              ) : (
                <span className="flex-1" />
              )}
              <button
                type="button"
                onClick={() => openRenew(item)}
                className={cn(
                  "flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-[16px] px-3.5 text-[13px] font-bold transition-transform active:scale-95",
                  utility,
                )}
              >
                <RefreshCw className="h-4 w-4" />
                {t("aurora.renew")}
              </button>
            </div>
          </section>
        );
      })}

      {hasAnySubscription && (
        <div className="grid grid-cols-2 gap-2">
          {canBuyAdditional && (
            <button
              type="button"
              onClick={() => navigate("/cabinet/tariffs")}
              className="flex min-h-12 items-center justify-center gap-2 rounded-[18px] bg-[var(--au-surface)] px-3 text-[13.5px] font-bold text-[var(--au-ink)] transition-transform active:scale-[0.99]"
            >
              <Plus className="h-4 w-4" />
              {t("aurora.add_subscription")}
            </button>
          )}
          {trialAvailable && (
            <button
              type="button"
              onClick={() => setTrialsOpen(true)}
              className="flex min-h-12 items-center justify-center gap-2 rounded-[18px] bg-[var(--au-surface)] px-3 text-[13.5px] font-bold text-[var(--au-ink)] transition-transform active:scale-[0.99]"
            >
              <Gift className="h-4 w-4" />
              {t("aurora.try_trial")}
            </button>
          )}
        </div>
      )}

      {quickActions.length > 0 && (
        <section className="space-y-2.5">
          <p className="px-1 text-[13px] font-semibold text-[var(--au-muted)]">{t("aurora.quick_actions")}</p>
          <div className="grid grid-cols-2 gap-2">
            {quickActions.map(({ key, label, hint, icon: Icon, to }) => (
              <button
                key={key}
                type="button"
                onClick={() => (to ? navigate(to) : setPromoOpen(true))}
                className="au-card flex min-h-[86px] flex-col items-start gap-2 p-3.5 text-left transition-transform active:scale-[0.98]"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-[13px] bg-[color-mix(in_srgb,var(--au-from)_12%,var(--au-bg))] text-[var(--au-from)]">
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-bold text-[var(--au-ink)]">{label}</span>
                  <span className="mt-0.5 block text-[11.5px] leading-snug text-[var(--au-muted)]">{hint}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {config?.botInfoBlock?.trim() && (
        <section className="au-card whitespace-pre-line p-4 text-[13.5px] leading-relaxed text-[var(--au-ink)]">
          {config.botInfoBlock.trim()}
        </section>
      )}

      <p className="px-1 pb-2 text-[12.5px] leading-relaxed text-[var(--au-muted)]">{t("aurora.connect_hint")}</p>

      <AuroraDevicesSheet
        open={devicesOpen}
        onClose={() => setDevicesOpen(false)}
        onChanged={() => {
          void load();
        }}
      />
      <AuroraTrialsSheet
        open={trialsOpen}
        onClose={() => setTrialsOpen(false)}
        onActivated={() => {
          void load();
        }}
      />
      <AuroraPromoSheet open={promoOpen} onClose={() => setPromoOpen(false)} />

      <AuroraSheet open={menuItem !== null} onClose={() => setMenuItemId(null)} title={t("aurora.manage_subscription")}>
        {menuItem && (() => {
          const info = remnaInfo(menuItem.subscription);
          const days = remnaDaysLeft(info.expireAt);
          const offline = menuItem.isOfflineSnapshot === true;
          const active = offline ? days == null || days > 0 : remnaIsActive(info, days);
          const deviceCount = deviceCounts[menuItem.id] ?? 0;
          const limit = info.deviceLimit;
          const extras = menuItem.extraDevices ?? 0;
          return (
            <div className="space-y-2 pb-3">
              <button
                type="button"
                onClick={() => { setMenuItemId(null); setDevicesOpen(true); }}
                className="au-menu-row"
              >
                <span className="au-menu-icon"><Smartphone className="h-[18px] w-[18px]" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14.5px] font-semibold text-[var(--au-ink)]">{t("aurora.devices_short")}</span>
                  <span className="mt-0.5 block text-[12.5px] text-[var(--au-muted)] tabular-nums">
                    {limit != null ? `${deviceCount}/${limit}` : deviceCount}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-[var(--au-muted)]" />
              </button>
              <button
                type="button"
                onClick={() => { setMenuItemId(null); beginAction("rename", menuItem); }}
                className="au-menu-row"
              >
                <span className="au-menu-icon"><Pencil className="h-[18px] w-[18px]" /></span>
                <span className="flex-1 text-[14.5px] font-semibold text-[var(--au-ink)]">{t("aurora.rename")}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-[var(--au-muted)]" />
              </button>
              <button
                type="button"
                onClick={() => { setMenuItemId(null); beginAction(menuItem.autoRenewEnabled ? "autorenew-off" : "autorenew-on", menuItem); }}
                className="au-menu-row"
              >
                <span className="au-menu-icon"><RotateCcw className="h-[18px] w-[18px]" /></span>
                <span className="flex-1 text-[14.5px] font-semibold text-[var(--au-ink)]">
                  {menuItem.autoRenewEnabled ? t("aurora.autorenew_disable") : t("aurora.autorenew_enable")}
                </span>
                <span className="text-[12px] text-[var(--au-muted)]">{menuItem.autoRenewEnabled ? t("aurora.on") : t("aurora.off")}</span>
              </button>
              {active && (
                <button
                  type="button"
                  onClick={() => { setMenuItemId(null); beginAction("reissue", menuItem); }}
                  className="au-menu-row"
                >
                  <span className="au-menu-icon"><RefreshCw className="h-[18px] w-[18px]" /></span>
                  <span className="flex-1 text-[14.5px] font-semibold text-[var(--au-ink)]">{t("aurora.reissue")}</span>
                </button>
              )}
              {extras > 0 && (
                <button
                  type="button"
                  onClick={() => { setMenuItemId(null); beginAction("remove-extras", menuItem); }}
                  className="au-menu-row text-red-600 dark:text-red-400"
                >
                  <span className="au-menu-icon text-red-500"><Trash2 className="h-[18px] w-[18px]" /></span>
                  <span className="flex-1 text-[14.5px] font-semibold">{t("aurora.remove_extras", { count: extras })}</span>
                </button>
              )}
            </div>
          );
        })()}
      </AuroraSheet>

      <AuroraConfirmSheet
        open={pending?.kind === "reissue"}
        onClose={() => setPending(null)}
        title={t("aurora.reissue")}
        description={t("aurora.reissue_warning")}
        confirmLabel={t("aurora.reissue_confirm")}
        danger
        loading={actionBusy}
        error={actionError}
        onConfirm={() => pending && void runAction(pending)}
      />
      <AuroraConfirmSheet
        open={pending?.kind === "remove-extras"}
        onClose={() => setPending(null)}
        title={t("aurora.remove_extras_title")}
        description={t("aurora.remove_extras_text", { count: pending?.item.extraDevices ?? 0 })}
        confirmLabel={t("aurora.remove_extras_confirm")}
        danger
        loading={actionBusy}
        error={actionError}
        onConfirm={() => pending && void runAction(pending)}
      />
      <AuroraConfirmSheet
        open={pending?.kind === "autorenew-on" || pending?.kind === "autorenew-off"}
        onClose={() => setPending(null)}
        title={pending?.kind === "autorenew-on" ? t("aurora.autorenew_enable") : t("aurora.autorenew_disable")}
        description={pending?.kind === "autorenew-on" ? t("aurora.autorenew_on_text") : t("aurora.autorenew_off_text")}
        confirmLabel={t("aurora.confirm")}
        loading={actionBusy}
        error={actionError}
        onConfirm={() => pending && void runAction(pending)}
      />

      <AuroraSheetRename
        open={pending?.kind === "rename"}
        value={renameValue}
        onChange={setRenameValue}
        onClose={() => setPending(null)}
        busy={actionBusy}
        error={actionError}
        onConfirm={() => pending && void runAction(pending)}
      />
    </AuPage>
  );
}

function CopySubscriptionLink({ url, className }: { url: string; className?: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => { setCopied(false); }, [url]);
  return (
    <button
      type="button"
      aria-label={t("aurora.copy_link")}
      onClick={async () => {
        try {
          await copyText(url);
          setCopied(true);
          toast.success(t("aurora.copied"));
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 2200);
        } catch {
          return;
        }
      }}
      className={cn(
        "flex h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[16px] px-3 text-[13px] font-bold transition-transform active:scale-95",
        className,
      )}
    >
      {copied ? <Check className="h-4 w-4 shrink-0" /> : <Copy className="h-4 w-4 shrink-0" />}
      <span className="truncate">{copied ? t("aurora.copied") : t("aurora.copy_link")}</span>
    </button>
  );
}

function AuroraSheetRename({
  open,
  value,
  onChange,
  onClose,
  busy,
  error,
  onConfirm,
}: {
  open: boolean;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  return (
    <AuroraSheet open={open} onClose={busy ? () => {} : onClose} title={t("aurora.rename")}>
      <div className="space-y-3 pb-2">
        <AuInput value={value} maxLength={60} onChange={(e) => onChange(e.target.value)} placeholder={t("aurora.rename_placeholder")} />
        {error && <AuNotice tone="error">{error}</AuNotice>}
        <AuButton onClick={onConfirm} disabled={busy || !value.trim()}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {t("aurora.save")}
        </AuButton>
      </div>
    </AuroraSheet>
  );
}
