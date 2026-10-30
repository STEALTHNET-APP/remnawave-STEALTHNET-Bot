import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Clock, Download, KeyRound, Loader2, RefreshCw, Server } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { useCabinetConfig } from "@/contexts/cabinet-config";
import { api } from "@/lib/api";
import { formatAuroraBalance } from "@/lib/aurora-profile";
import { checkoutMethods } from "@/lib/cabinet-checkout";
import { formatTraffic } from "@/lib/subscription-remna";
import { AuroraPaymentSheet } from "@/components/aurora/aurora-payment-sheet";
import { AuroraConfirmSheet } from "@/components/aurora/aurora-confirm-sheet";
import { AuBadge, AuButton, AuEmpty, AuLoading, AuNotice, AuPage, AuSection, CopyButton } from "@/components/aurora/aurora-ui";
import { toast } from "@/components/ui/toast";

type SingboxCategory = Awaited<ReturnType<typeof api.getPublicSingboxTariffs>>["items"][number];
type SingboxTariff = SingboxCategory["tariffs"][number];
type SingboxSlot = Awaited<ReturnType<typeof api.getSingboxSlots>>["slots"][number];
type Renewal = Awaited<ReturnType<typeof api.quoteWebRenewal>> & { requestId: string };

const CONF_PROTOCOLS = ["AMNEZIAWG", "AWP_AWG", "AWP_WIREGUARD"];

function protocolLabel(protocol: string | undefined): string {
  if (!protocol) return "Sing-box";
  if (protocol === "AWP_WIREGUARD") return "WireGuard";
  if (protocol === "AMNEZIAWG" || protocol === "AWP_AWG") return "AmneziaWG";
  if (protocol === "AWP_XRAY") return "Xray";
  return protocol;
}

export function AuroraSingbox() {
  const { t, i18n } = useTranslation();
  const { state, refreshProfile } = useClientAuth();
  const config = useCabinetConfig();
  const token = state.token ?? null;
  const client = state.client;
  const locale = i18n.language || "ru";

  const [categories, setCategories] = useState<SingboxCategory[]>([]);
  const [slots, setSlots] = useState<SingboxSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tariff, setTariff] = useState<SingboxTariff | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [renewal, setRenewal] = useState<Renewal | null>(null);
  const [renewalBusy, setRenewalBusy] = useState(false);
  const [renewalError, setRenewalError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const [catalog, mine] = await Promise.all([
        api.getPublicSingboxTariffs().catch(() => ({ items: [] })),
        api.getSingboxSlots(token, true).catch(() => ({ slots: [] })),
      ]);
      setCategories(catalog.items ?? []);
      setSlots(mine.slots ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("aurora.singbox_load_error"));
    } finally {
      setLoading(false);
    }
  }, [token, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const pending = slots.some((slot) => slot.status === "PENDING");
  useEffect(() => {
    if (!token || !pending) return;
    const timer = window.setInterval(() => {
      api.getSingboxSlots(token, true).then((res) => setSlots(res.slots ?? [])).catch(() => {});
    }, 5000);
    return () => window.clearInterval(timer);
  }, [token, pending]);

  const methods = useMemo(
    () =>
      checkoutMethods(config, tariff?.currency ?? "RUB", {
        balanceAvailable: true,
        balanceLabel: t("aurora.pay_balance"),
        hasTelegram: Boolean(client?.telegramId),
      }),
    [config, tariff?.currency, client?.telegramId, t],
  );

  async function copy(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      /* буфер недоступен */
    }
  }

  function downloadConf(slot: SingboxSlot) {
    const url = URL.createObjectURL(new Blob([slot.subscriptionLink], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `amnezia-${slot.id.slice(-8)}.conf`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function openRenewal(slot: SingboxSlot) {
    if (!token) return;
    setRenewalBusy(true);
    setRenewalError(null);
    try {
      const quote = await api.quoteWebRenewal(token, slot.id);
      setRenewal({ ...quote, requestId: crypto.randomUUID() });
    } catch (e) {
      setRenewalError(e instanceof Error ? e.message : t("aurora.renewal_error"));
    } finally {
      setRenewalBusy(false);
    }
  }

  async function confirmRenewal() {
    if (!token || !renewal || renewalBusy) return;
    setRenewalBusy(true);
    setRenewalError(null);
    try {
      const res = await api.buyWebRenewal(token, renewal.slotId, { requestId: renewal.requestId, quoteHash: renewal.quoteHash });
      toast.success(res.message);
      setRenewal(null);
      await Promise.all([load(), refreshProfile().catch(() => {})]);
    } catch (e) {
      setRenewalError(e instanceof Error ? e.message : t("aurora.renewal_error"));
    } finally {
      setRenewalBusy(false);
    }
  }

  if (loading) return <AuLoading rows={4} />;

  return (
    <AuPage>
      <header className="px-1 pb-1">
        <h1 className="text-[26px] font-extrabold leading-tight tracking-tight text-[var(--au-ink)]">Sing-box / AmneziaWG</h1>
        <p className="mt-0.5 text-[14px] text-[var(--au-muted)]">{t("aurora.singbox_subtitle")}</p>
      </header>

      {error && <AuNotice tone="error">{error}</AuNotice>}

      <AuSection title={t("aurora.singbox_my")}>
        {slots.length === 0 ? (
          <AuEmpty icon={<KeyRound className="h-6 w-6" />} title={t("aurora.singbox_empty")} hint={t("aurora.singbox_empty_hint")} />
        ) : (
          <div className="space-y-2">
            {slots.map((slot) => {
              const active = slot.status === "ACTIVE" || slot.status == null;
              const isConf = CONF_PROTOCOLS.includes(slot.protocol);
              return (
                <article key={slot.id} className="rounded-[18px] bg-[var(--au-bg)] p-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[14px] font-bold text-[var(--au-ink)]">{protocolLabel(slot.protocol)}</div>
                      <div className="text-[11.5px] text-[var(--au-muted)]">#{slot.id.slice(-8)}</div>
                    </div>
                    <AuBadge tone={active ? "success" : slot.status === "PENDING" ? "accent" : "danger"}>
                      {active ? t("aurora.proxy_active") : slot.status === "PENDING" ? t("aurora.singbox_pending") : t("aurora.inactive")}
                    </AuBadge>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[11.5px] text-[var(--au-muted)]">
                    <AuBadge>
                      <Clock className="h-3 w-3" />
                      {new Date(slot.expiresAt).toLocaleDateString(locale, { day: "numeric", month: "short", year: "2-digit" })}
                    </AuBadge>
                    <AuBadge>
                      {slot.trafficLimitBytes ? `${formatTraffic(Number(slot.trafficUsedBytes))} / ${formatTraffic(Number(slot.trafficLimitBytes))}` : t("aurora.unlimited")}
                    </AuBadge>
                    {slot.nodeOnline === false && <AuBadge tone="danger">{t("aurora.node_offline")}</AuBadge>}
                  </div>
                  <div className="mt-2.5 grid gap-2">
                    {isConf ? (
                      <AuButton onClick={() => downloadConf(slot)}>
                        <Download className="h-4 w-4" />
                        {t("aurora.singbox_download_conf")}
                      </AuButton>
                    ) : (
                      <CopyButton
                        value={slot.subscriptionLink}
                        label={t("aurora.singbox_copy_link")}
                        copiedLabel={t("aurora.copied")}
                        copied={copied === slot.id}
                        onCopied={() => void copy(slot.subscriptionLink, slot.id)}
                      />
                    )}
                    {slot.canRenew && (
                      <AuButton variant="surface" onClick={() => void openRenewal(slot)} disabled={renewalBusy}>
                        {renewalBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        {t("aurora.singbox_renew")}
                      </AuButton>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </AuSection>

      {categories.length === 0 ? (
        <AuEmpty icon={<Server className="h-6 w-6" />} title={t("aurora.singbox_no_tariffs")} />
      ) : (
        categories.map((category) => (
          <AuSection key={category.id} title={category.name}>
            <div className="space-y-2">
              {category.tariffs.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTariff(item)}
                  className="flex w-full items-center gap-3 rounded-[16px] bg-[var(--au-bg)] p-3 text-left active:scale-[0.99]"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--au-surface)] text-[var(--au-from)]">
                    <KeyRound className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-bold text-[var(--au-ink)]">{item.name}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-[var(--au-muted)]">
                      <span>{protocolLabel(item.protocol)}</span>
                      <span>· {t("aurora.days_short", { count: item.durationDays })}</span>
                      <span>· {t("aurora.singbox_slots", { count: item.slotCount })}</span>
                      {item.trafficLimitBytes && <span>· {formatTraffic(Number(item.trafficLimitBytes))}</span>}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-[15px] font-extrabold tabular-nums text-[var(--au-ink)]">
                    {formatAuroraBalance(item.price, item.currency.toUpperCase(), locale)}
                  </span>
                </button>
              ))}
            </div>
          </AuSection>
        ))
      )}

      <AuroraPaymentSheet
        open={tariff !== null}
        onClose={() => setTariff(null)}
        title={tariff?.name ?? "Sing-box"}
        waitKind="singbox"
        amountText={tariff ? formatAuroraBalance(tariff.price, tariff.currency.toUpperCase(), locale) : undefined}
        methods={methods}
        product={tariff ? { kind: "singbox", amount: tariff.price, currency: tariff.currency, singboxTariffId: tariff.id } : { kind: "singbox", amount: 0, currency: "RUB", singboxTariffId: "" }}
        onSuccess={() => {
          void Promise.all([load(), refreshProfile().catch(() => {})]);
        }}
      >
        {tariff && (
          <div className="space-y-2 rounded-[18px] bg-[var(--au-surface)] p-3.5 text-[13px]">
            <div className="flex items-center justify-between">
              <span className="text-[var(--au-muted)]">{t("aurora.period")}</span>
              <span className="font-semibold text-[var(--au-ink)]">{t("aurora.days_short", { count: tariff.durationDays })}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--au-muted)]">{protocolLabel(tariff.protocol)}</span>
              <span className="font-semibold text-[var(--au-ink)]">{t("aurora.singbox_slots", { count: tariff.slotCount })}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--au-muted)]">{t("aurora.total")}</span>
              <span className="font-extrabold tabular-nums text-[var(--au-ink)]">
                {formatAuroraBalance(tariff.price, tariff.currency.toUpperCase(), locale)}
              </span>
            </div>
          </div>
        )}
      </AuroraPaymentSheet>

      <AuroraConfirmSheet
        open={renewal !== null}
        onClose={() => {
          if (renewalBusy) return;
          setRenewal(null);
          setRenewalError(null);
        }}
        title={t("aurora.singbox_renew")}
        description={
          renewal
            ? t("aurora.renewal_text", {
                amount: formatAuroraBalance(renewal.amount, renewal.currency.toUpperCase(), locale),
                days: renewal.durationDays,
              })
            : undefined
        }
        confirmLabel={t("aurora.renewal_confirm")}
        loading={renewalBusy}
        error={renewalError}
        onConfirm={() => void confirmRenewal()}
      />
    </AuPage>
  );
}
