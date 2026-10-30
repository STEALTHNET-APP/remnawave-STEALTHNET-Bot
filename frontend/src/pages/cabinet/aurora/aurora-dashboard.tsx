import { CopyLinkButton, SubscriptionQrButton } from "@/components/subscription-link-actions";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ChevronDown, ChevronRight, Gift, HelpCircle, Loader2, Pencil, Plus, RefreshCw, RotateCcw,
  Smartphone, Ticket, Trash2, Users, Wallet, Wifi, Zap,
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
import { AuButton, AuEmpty, AuInput, AuLoading, AuNotice, AuPage, AuRow, AuSection } from "@/components/aurora/aurora-ui";
import { toast } from "@/components/ui/toast";

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
  const [expanded, setExpanded] = useState<string | null>(null);

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
    const providerReturn = ["yookassa", "heleket", "rollypay", "paritypay", "lava", "lavatop", "yoomoney_form"].some(
      (key) => searchParams.get(key) === "success",
    ) || searchParams.get("overpay") === "return";
    if (payment === "success" || providerReturn) {
      toast.success(t("aurora.payment_success"));
      refreshProfile().catch(() => {});
      setSearchParams({}, { replace: true });
      void load();
      return;
    }
    if (payment === "failed") {
      toast.error(t("aurora.payment_failed"));
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams, refreshProfile, load, t]);

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
  const trialAvailable = Boolean(config?.trialEnabled) && !client?.trialUsed;
  const canBuyAdditional = config?.multiSubscriptionsEnabled !== false;

  const daysText = useCallback(
    (days: number | null) => (days == null ? "—" : t("aurora.days_short", { count: days })),
    [t],
  );

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

  if (loading) return <AuLoading rows={4} />;

  return (
    <AuPage>
      <header className="flex items-center justify-between gap-3 px-1 pb-1">
        <div className="min-w-0">
          <h1 className="truncate text-[26px] font-extrabold leading-tight tracking-tight text-[var(--au-ink)]">
            {t("aurora.hello")}
          </h1>
          <p className="mt-0.5 truncate text-[14px] text-[var(--au-muted)]">
            {client?.email || (client?.telegramUsername ? `@${client.telegramUsername}` : config?.serviceName || "")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/cabinet/profile")}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--au-surface)] text-[var(--au-from)]"
          aria-label={t("aurora.profile")}
        >
          <Wifi className="h-5 w-5" />
        </button>
      </header>

      {error && <AuNotice tone="error">{error}</AuNotice>}

      {items.some((item) => item.isBanned) && (
        <AuNotice tone="error">
          {items.find((item) => item.isBanned)?.banReason || t("aurora.banned_hint")}
        </AuNotice>
      )}

      <section className="relative overflow-hidden rounded-[26px] bg-[linear-gradient(135deg,var(--au-from),var(--au-to))] p-5 text-white">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[13px] text-white/75">{t("aurora.balance")}</div>
            <div className="mt-1 text-[36px] font-extrabold leading-none tracking-tight tabular-nums">{balanceText}</div>
          </div>
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/20">
            <Wallet className="h-5 w-5" />
          </span>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => navigate("/cabinet/profile?tab=topup")}
            className="flex items-center justify-center gap-2 rounded-[16px] bg-white px-4 py-3 text-[14px] font-bold text-[#352b89]"
          >
            <Plus className="h-4 w-4" />
            {t("aurora.topup")}
          </button>
          <button
            type="button"
            onClick={() => navigate("/cabinet/history")}
            className="flex items-center justify-center gap-2 rounded-[16px] bg-white/20 px-4 py-3 text-[14px] font-bold text-white"
          >
            <Ticket className="h-4 w-4" />
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
        const active = remnaIsActive(info, days);
        const isMain = main?.id === item.id;
        const deviceCount = deviceCounts[item.id] ?? 0;
        const limit = info.deviceLimit;
        const used = info.trafficUsed ?? 0;
        const trafficLimit = info.trafficLimitBytes;
        const unlimited = trafficLimit == null || trafficLimit === 0;
        const rest = unlimited ? null : Math.max(0, trafficLimit - used);
        const usedPercent = unlimited ? 0 : Math.min(100, Math.round((used / Math.max(1, trafficLimit)) * 100));
        const isOpen = expanded === item.id;
        const title = item.customName?.trim() || item.tariffDisplayName?.trim() || info.productName || t("aurora.subscription");
        const canReissue = active;
        const extras = item.extraDevices ?? 0;

        return (
          <section
            key={item.id}
            className={cn(
              "overflow-hidden rounded-[26px] p-5",
              isMain
                ? "bg-[linear-gradient(135deg,var(--au-from),var(--au-to))] text-white"
                : "bg-[var(--au-surface)] text-[var(--au-ink)]",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn("truncate text-[17px] font-bold", isMain ? "text-white" : "text-[var(--au-ink)]")}>{title}</span>
                  {item.trialId && (
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", isMain ? "bg-white/25" : "bg-[var(--au-bg)] text-[var(--au-from)]")}>
                      {t("aurora.trial_badge")}
                    </span>
                  )}
                  {item.subscriptionIndex != null && <span className={cn("text-[12px]", isMain ? "text-white/70" : "text-[var(--au-muted)]")}>#{item.subscriptionIndex}</span>}
                </div>
                <div className={cn("mt-1 flex flex-wrap items-center gap-2 text-[13px]", isMain ? "text-white/80" : "text-[var(--au-muted)]")}>
                  <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-semibold", active ? (isMain ? "bg-white/20" : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400") : (isMain ? "bg-white/20" : "bg-red-500/15 text-red-600 dark:text-red-400"))}>
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                    {active ? t("aurora.active") : t("aurora.inactive")}
                  </span>
                  <span>{daysText(days)}</span>
                  {item.autoRenewEnabled && <span>{t("aurora.autorenew_on")}</span>}
                </div>
              </div>
              {isMain && (
                <div className="shrink-0 text-right">
                  <div className="text-[38px] font-extrabold leading-none tabular-nums">{days ?? "—"}</div>
                  <div className="mt-1 text-[12px] text-white/75">{t("aurora.days_left")}</div>
                </div>
              )}
            </div>

            <div className={cn("mt-4 grid gap-2 text-[13px]", isMain ? "text-white/85" : "text-[var(--au-muted)]")}>
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1.5">
                  <Smartphone className="h-4 w-4" />
                  {t("aurora.devices")}
                </span>
                <span className={cn("font-semibold tabular-nums", isMain ? "text-white" : "text-[var(--au-ink)]")}>
                  {limit != null ? `${deviceCount}/${limit}` : deviceCount}
                </span>
              </div>
              <div>
                <div className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-1.5">
                    <Wifi className="h-4 w-4" />
                    {t("aurora.traffic")}
                  </span>
                  <span className={cn("font-semibold tabular-nums", isMain ? "text-white" : "text-[var(--au-ink)]")}>
                    {unlimited ? t("aurora.unlimited") : `${formatTraffic(rest)} / ${formatTraffic(trafficLimit)}`}
                  </span>
                </div>
                {!unlimited && (
                  <div className={cn("mt-2 h-1.5 overflow-hidden rounded-full", isMain ? "bg-white/25" : "bg-[var(--au-bg)]")}>
                    <div
                      className={cn("h-full rounded-full", isMain ? "bg-white" : "bg-[var(--au-from)]")}
                      style={{ width: `${Math.max(4, 100 - usedPercent)}%` }}
                    />
                  </div>
                )}
              </div>
              {info.expireAt && (
                <div className="flex items-center justify-between gap-3">
                  <span>{t("aurora.expires")}</span>
                  <span className={cn("font-semibold", isMain ? "text-white" : "text-[var(--au-ink)]")}>
                    {new Date(info.expireAt).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" })}
                  </span>
                </div>
              )}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => openConnect(item)}
                className={cn(
                  "flex items-center justify-center gap-2 whitespace-nowrap rounded-[16px] px-2.5 py-3 text-[13.5px] font-bold",
                  isMain ? "bg-white text-[#352b89]" : "bg-[linear-gradient(135deg,var(--au-from),var(--au-to))] text-white",
                )}
              >
                <Wifi className="h-4 w-4 shrink-0" />
                {t("aurora.connect")}
              </button>
              <button
                type="button"
                onClick={() => openRenew(item)}
                className={cn(
                  "flex items-center justify-center gap-2 whitespace-nowrap rounded-[16px] px-2.5 py-3 text-[13.5px] font-bold",
                  isMain ? "bg-white/20 text-white" : "bg-[var(--au-bg)] text-[var(--au-ink)]",
                )}
              >
                <RefreshCw className="h-4 w-4" />
                {t("aurora.renew")}
              </button>
              <button
                type="button"
                onClick={() => setDevicesOpen(true)}
                className={cn(
                  "flex items-center justify-center gap-2 whitespace-nowrap rounded-[16px] px-2.5 py-3 text-[13.5px] font-bold",
                  isMain ? "bg-white/20 text-white" : "bg-[var(--au-bg)] text-[var(--au-ink)]",
                )}
              >
                <Smartphone className="h-4 w-4 shrink-0" />
                {t("aurora.devices_short")}
              </button>
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : item.id)}
                aria-expanded={isOpen}
                className={cn(
                  "flex items-center justify-center gap-2 whitespace-nowrap rounded-[16px] px-2.5 py-3 text-[13.5px] font-bold",
                  isMain ? "bg-white/20 text-white" : "bg-[var(--au-bg)] text-[var(--au-ink)]",
                )}
              >
                {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                {t("aurora.more")}
              </button>
            </div>

            {info.subscriptionUrl && (
              <div className="mt-2 flex gap-2">
                <CopyLinkButton
                  url={info.subscriptionUrl}
                  showLabel
                  className={cn(
                    "h-auto min-h-11 flex-1 gap-2 rounded-[16px]",
                    isMain ? "border-0 bg-white/20 text-white hover:bg-white/25" : "border-0 bg-[var(--au-bg)] text-[var(--au-ink)]",
                  )}
                />
                <SubscriptionQrButton
                  url={info.subscriptionUrl}
                  name={title}
                  className={cn(
                    "h-11 w-11 shrink-0 rounded-[16px]",
                    isMain ? "border-0 bg-white/20 text-white hover:bg-white/25" : "border-0 bg-[var(--au-bg)] text-[var(--au-ink)]",
                  )}
                />
              </div>
            )}

            {isOpen && (
              <div className={cn("mt-3 space-y-1.5 rounded-[18px] p-2", isMain ? "bg-white/15" : "bg-[var(--au-bg)]")}>
                <button
                  type="button"
                  onClick={() => beginAction(item.autoRenewEnabled ? "autorenew-off" : "autorenew-on", item)}
                  className="flex w-full items-center gap-3 rounded-[14px] px-3 py-2.5 text-left text-[13.5px] font-semibold"
                >
                  <RotateCcw className="h-4 w-4 shrink-0" />
                  <span className="flex-1">{item.autoRenewEnabled ? t("aurora.autorenew_disable") : t("aurora.autorenew_enable")}</span>
                  <span className="text-[12px] opacity-70">{item.autoRenewEnabled ? t("aurora.on") : t("aurora.off")}</span>
                </button>
                <button
                  type="button"
                  onClick={() => beginAction("rename", item)}
                  className="flex w-full items-center gap-3 rounded-[14px] px-3 py-2.5 text-left text-[13.5px] font-semibold"
                >
                  <Pencil className="h-4 w-4 shrink-0" />
                  <span className="flex-1">{t("aurora.rename")}</span>
                </button>
                {canReissue && (
                  <button
                    type="button"
                    onClick={() => beginAction("reissue", item)}
                    className="flex w-full items-center gap-3 rounded-[14px] px-3 py-2.5 text-left text-[13.5px] font-semibold"
                  >
                    <RefreshCw className="h-4 w-4 shrink-0" />
                    <span className="flex-1">{t("aurora.reissue")}</span>
                  </button>
                )}
                {extras > 0 && (
                  <button
                    type="button"
                    onClick={() => beginAction("remove-extras", item)}
                    className="flex w-full items-center gap-3 rounded-[14px] px-3 py-2.5 text-left text-[13.5px] font-semibold text-red-600 dark:text-red-400"
                  >
                    <Trash2 className="h-4 w-4 shrink-0" />
                    <span className="flex-1">{t("aurora.remove_extras", { count: extras })}</span>
                  </button>
                )}
              </div>
            )}
          </section>
        );
      })}

      {hasAnySubscription && (
        <div className="grid grid-cols-2 gap-2">
          {canBuyAdditional && (
            <button
              type="button"
              onClick={() => navigate("/cabinet/tariffs")}
              className="flex items-center justify-center gap-2 rounded-[18px] bg-[var(--au-surface)] px-4 py-3.5 text-[13.5px] font-bold text-[var(--au-ink)] active:scale-[0.99]"
            >
              <Plus className="h-4 w-4" />
              {t("aurora.add_subscription")}
            </button>
          )}
          {trialAvailable && (
            <button
              type="button"
              onClick={() => setTrialsOpen(true)}
              className="flex items-center justify-center gap-2 rounded-[18px] bg-[var(--au-surface)] px-4 py-3.5 text-[13.5px] font-bold text-[var(--au-ink)] active:scale-[0.99]"
            >
              <Gift className="h-4 w-4" />
              {t("aurora.try_trial")}
            </button>
          )}
        </div>
      )}

      <AuSection title={t("aurora.quick_actions")}>
        <div className="space-y-1">
          <AuRow icon={<Wallet className="h-4 w-4" />} title={t("aurora.topup")} onClick={() => navigate("/cabinet/profile?tab=topup")} right={<ChevronRight className="h-4 w-4 text-[var(--au-muted)]" />} />
          <AuRow icon={<Ticket className="h-4 w-4" />} title={t("aurora.promo")} onClick={() => setPromoOpen(true)} right={<ChevronRight className="h-4 w-4 text-[var(--au-muted)]" />} />
          <AuRow icon={<Users className="h-4 w-4" />} title={t("aurora.referral")} onClick={() => navigate("/cabinet/referral")} right={<ChevronRight className="h-4 w-4 text-[var(--au-muted)]" />} />
          {config?.rouletteEnabled !== false && (
            <AuRow icon={<Gift className="h-4 w-4" />} title={t("aurora.roulette")} subtitle={t("aurora.roulette_hint")} onClick={() => navigate("/cabinet/roulette")} right={<ChevronRight className="h-4 w-4 text-[var(--au-muted)]" />} />
          )}
          <AuRow icon={<HelpCircle className="h-4 w-4" />} title={t("aurora.help")} onClick={() => navigate("/cabinet/help")} right={<ChevronRight className="h-4 w-4 text-[var(--au-muted)]" />} />
        </div>
      </AuSection>

      {config?.botInfoBlock?.trim() && (
        <section className="whitespace-pre-line rounded-[22px] bg-[var(--au-surface)] p-4 text-[13.5px] leading-relaxed text-[var(--au-ink)]">
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
