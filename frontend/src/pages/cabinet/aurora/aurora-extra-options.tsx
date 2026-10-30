import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpDown, Gift, Plus, Server, Settings2 } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { useCabinetConfig } from "@/contexts/cabinet-config";
import { api, type PublicSellOption } from "@/lib/api";
import { formatAuroraBalance } from "@/lib/aurora-profile";
import { checkoutMethods, currencySymbol } from "@/lib/cabinet-checkout";
import { remnaDaysLeft, remnaInfo } from "@/lib/subscription-remna";
import { cn } from "@/lib/utils";
import { AuroraPaymentSheet } from "@/components/aurora/aurora-payment-sheet";
import { AuBadge, AuEmpty, AuLoading, AuNotice, AuPage, AuSection } from "@/components/aurora/aurora-ui";

type SubscriptionItem = Awaited<ReturnType<typeof api.clientAllSubscriptions>>["items"][number];

function optionIcon(kind: PublicSellOption["kind"]) {
  if (kind === "traffic") return <ArrowUpDown className="h-5 w-5" />;
  if (kind === "devices") return <Plus className="h-5 w-5" />;
  return <Server className="h-5 w-5" />;
}

export function AuroraExtraOptions() {
  const { t, i18n } = useTranslation();
  const { state, refreshProfile } = useClientAuth();
  const config = useCabinetConfig();
  const token = state.token ?? null;
  const client = state.client;
  const balance = client?.balance ?? 0;
  const locale = i18n.language || "ru";

  const [subscriptions, setSubscriptions] = useState<SubscriptionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSubId, setSelectedSubId] = useState<string | null>(null);
  const [paid, setPaid] = useState<PublicSellOption | null>(null);

  const options = useMemo(() => config?.sellOptions ?? [], [config?.sellOptions]);
  const enabled = Boolean(config?.sellOptionsEnabled) && options.length > 0;

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await api.clientAllSubscriptions(token);
      setSubscriptions(res.items ?? []);
    } catch {
      setSubscriptions([]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeSubscriptions = useMemo(
    () => subscriptions.filter((item) => {
      const info = remnaInfo(item.subscription);
      return (remnaDaysLeft(info.expireAt) ?? 0) > 0 && !item.isBanned;
    }),
    [subscriptions],
  );

  useEffect(() => {
    if (!activeSubscriptions.length) {
      setSelectedSubId(null);
      return;
    }
    setSelectedSubId((current) => (current && activeSubscriptions.some((item) => item.id === current) ? current : activeSubscriptions[0].id));
  }, [activeSubscriptions]);

  const selectedSub = activeSubscriptions.find((item) => item.id === selectedSubId) ?? null;

  function optionPrice(option: PublicSellOption): number {
    if (option.kind !== "devices" || !selectedSub) return option.price;
    const info = remnaInfo(selectedSub.subscription);
    const expireAt = info.expireAt;
    if (!expireAt) return option.price;
    const daysLeft = Math.max(0, (new Date(expireAt).getTime() - Date.now()) / 86_400_000);
    const coef = Math.max(1, daysLeft / 30);
    return Math.floor(option.price * coef);
  }

  const methods = useMemo(
    () =>
      checkoutMethods(config, "RUB", {
        balanceAvailable: true,
        balanceLabel: t("aurora.pay_balance"),
        hasTelegram: Boolean(client?.telegramId),
      }),
    [config, client?.telegramId, t],
  );

  if (loading) return <AuLoading rows={3} />;

  if (!enabled) {
    return (
      <AuPage>
        <AuEmpty icon={<Settings2 className="h-6 w-6" />} title={t("aurora.options_disabled_title")} hint={t("aurora.options_disabled_hint")} />
      </AuPage>
    );
  }

  return (
    <AuPage>
      <header className="px-1 pb-1">
        <h1 className="text-[26px] font-extrabold leading-tight tracking-tight text-[var(--au-ink)]">{t("aurora.extra_options")}</h1>
        <p className="mt-0.5 text-[14px] text-[var(--au-muted)]">{t("aurora.options_subtitle")}</p>
      </header>

      {activeSubscriptions.length === 0 ? (
        <AuEmpty icon={<Gift className="h-6 w-6" />} title={t("aurora.options_no_sub_title")} hint={t("aurora.options_no_sub_hint")} />
      ) : (
        <>
          <AuSection title={t("aurora.options_target")}>
            <div className="space-y-2">
              {activeSubscriptions.map((item) => {
                const info = remnaInfo(item.subscription);
                const days = remnaDaysLeft(info.expireAt);
                const active = item.id === selectedSubId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedSubId(item.id)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-[16px] border-2 p-3 text-left",
                      active ? "border-[var(--au-from)] bg-[var(--au-bg)]" : "border-transparent bg-[var(--au-bg)]",
                    )}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--au-surface)] text-[var(--au-from)]">
                      <Gift className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-semibold text-[var(--au-ink)]">
                        {item.customName?.trim() || item.tariffDisplayName || t("aurora.subscription")}
                      </span>
                      <span className="block text-[12px] text-[var(--au-muted)]">{t("aurora.days_short", { count: days ?? 0 })}</span>
                    </span>
                    {active && <AuBadge tone="accent">{t("aurora.selected")}</AuBadge>}
                  </button>
                );
              })}
            </div>
          </AuSection>

          <div className="space-y-2">
            {options.map((option) => {
              const price = optionPrice(option);
              const canPayBalance = balance >= price;
              return (
                <button
                  key={`${option.kind}-${option.id}`}
                  type="button"
                  onClick={() => setPaid(option)}
                  className="flex w-full items-center gap-3 rounded-[20px] bg-[var(--au-surface)] p-4 text-left active:scale-[0.99]"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--au-bg)] text-[var(--au-from)]">
                    {optionIcon(option.kind)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14.5px] font-bold text-[var(--au-ink)]">{option.name}</span>
                    <span className="mt-0.5 block text-[12.5px] text-[var(--au-muted)]">
                      {option.kind === "traffic"
                        ? t("aurora.option_traffic", { count: option.trafficGb })
                        : option.kind === "devices"
                          ? t("aurora.option_devices", { count: option.deviceCount })
                          : t("aurora.option_servers")}
                    </span>
                    {option.kind === "devices" && (
                      <span className="mt-1 block text-[11.5px] text-[var(--au-muted)]">{t("aurora.option_devices_prorated")}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-[15px] font-extrabold tabular-nums text-[var(--au-ink)]">
                      {formatAuroraBalance(price, option.currency.toUpperCase(), locale)}
                    </span>
                    <span className="block text-[11px] text-[var(--au-muted)]">
                      {canPayBalance ? t("aurora.balance_available") : currencySymbol(option.currency)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <AuNotice>{t("aurora.options_hint")}</AuNotice>
        </>
      )}

      <AuroraPaymentSheet
        open={paid !== null}
        onClose={() => setPaid(null)}
        title={paid?.name ?? t("aurora.extra_options")}
        waitKind="option"
        amountText={paid ? formatAuroraBalance(optionPrice(paid), paid.currency.toUpperCase(), locale) : undefined}
        methods={methods}
        product={
          paid
            ? {
                kind: "option",
                extraOption: { kind: paid.kind, productId: paid.id, targetSubscriptionId: selectedSubId ?? undefined },
              }
            : { kind: "option", extraOption: { kind: "traffic", productId: "" } }
        }
        onSuccess={() => {
          void Promise.all([load(), refreshProfile().catch(() => {})]);
        }}
      >
        {paid && (
          <div className="space-y-2 rounded-[18px] bg-[var(--au-surface)] p-3.5 text-[13px]">
            <div className="flex items-center justify-between">
              <span className="text-[var(--au-muted)]">{t("aurora.options_target")}</span>
              <span className="font-semibold text-[var(--au-ink)]">{selectedSub?.customName?.trim() || selectedSub?.tariffDisplayName || "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--au-muted)]">{t("aurora.total")}</span>
              <span className="font-extrabold tabular-nums text-[var(--au-ink)]">
                {formatAuroraBalance(optionPrice(paid), paid.currency.toUpperCase(), locale)}
              </span>
            </div>
          </div>
        )}
      </AuroraPaymentSheet>
    </AuPage>
  );
}
