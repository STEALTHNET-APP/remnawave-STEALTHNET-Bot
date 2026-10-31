import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Clock, Globe, KeyRound, Network, Server } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { useCabinetConfig } from "@/contexts/cabinet-config";
import { api } from "@/lib/api";
import { formatAuroraBalance } from "@/lib/aurora-profile";
import { checkoutMethods } from "@/lib/cabinet-checkout";
import { formatTraffic } from "@/lib/subscription-remna";
import { cn } from "@/lib/utils";
import { AuroraPaymentSheet } from "@/components/aurora/aurora-payment-sheet";
import { AuBadge, AuEmpty, AuLoading, AuNotice, AuPage, AuSection, CopyButton } from "@/components/aurora/aurora-ui";

type ProxyCategory = Awaited<ReturnType<typeof api.getPublicProxyTariffs>>["items"][number];
type ProxyTariff = ProxyCategory["tariffs"][number];
type ProxySlot = Awaited<ReturnType<typeof api.getProxySlots>>["slots"][number];

export function AuroraProxy() {
  const { t, i18n } = useTranslation();
  const { state, refreshProfile } = useClientAuth();
  const config = useCabinetConfig();
  const token = state.token ?? null;
  const client = state.client;
  const locale = i18n.language || "ru";

  const [categories, setCategories] = useState<ProxyCategory[]>([]);
  const [slots, setSlots] = useState<ProxySlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tariff, setTariff] = useState<ProxyTariff | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const [catalog, mine] = await Promise.all([
        api.getPublicProxyTariffs().catch(() => ({ items: [] })),
        api.getProxySlots(token).catch(() => ({ slots: [] })),
      ]);
      setCategories(catalog.items ?? []);
      setSlots(mine.slots ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("aurora.proxy_load_error"));
    } finally {
      setLoading(false);
    }
  }, [token, t]);

  useEffect(() => {
    void load();
  }, [load]);

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

  if (loading) return <AuLoading rows={4} />;

  return (
    <AuPage>
      <header className="px-1 pb-1">
        <h1 className="text-[26px] font-extrabold leading-tight tracking-tight text-[var(--au-ink)]">{t("aurora.proxy")}</h1>
        <p className="mt-0.5 text-[14px] text-[var(--au-muted)]">{t("aurora.proxy_subtitle")}</p>
      </header>

      {error && <AuNotice tone="error">{error}</AuNotice>}

      <AuSection title={t("aurora.proxy_my")}>
        {slots.length === 0 ? (
          <AuEmpty icon={<Network className="h-6 w-6" />} title={t("aurora.proxy_empty")} hint={t("aurora.proxy_empty_hint")} />
        ) : (
          <div className="space-y-2">
            {slots.map((slot) => {
              const address = `${slot.host}:${slot.socksPort}`;
              return (
                <article key={slot.id} className="rounded-[18px] bg-[var(--au-bg)] p-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <Globe className="h-4 w-4 shrink-0 text-[var(--au-from)]" />
                      <span className="truncate font-mono text-[13.5px] font-bold text-[var(--au-ink)]">{slot.host}</span>
                    </div>
                    <AuBadge tone="success">{t("aurora.proxy_active")}</AuBadge>
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12.5px]">
                    <div className="flex justify-between gap-2">
                      <dt className="text-[var(--au-muted)]">SOCKS5</dt>
                      <dd className="font-mono font-semibold">{slot.socksPort}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-[var(--au-muted)]">HTTP</dt>
                      <dd className="font-mono font-semibold">{slot.httpPort}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-[var(--au-muted)]">{t("aurora.proxy_login")}</dt>
                      <dd className="truncate font-mono font-semibold">{slot.login}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-[var(--au-muted)]">{t("aurora.proxy_password")}</dt>
                      <dd className="truncate font-mono font-semibold">{slot.password}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-[var(--au-muted)]">{t("aurora.expires")}</dt>
                      <dd className="whitespace-nowrap font-semibold">
                        {new Date(slot.expiresAt).toLocaleDateString(locale, { day: "numeric", month: "short", year: "2-digit" })}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-[var(--au-muted)]">{t("aurora.traffic")}</dt>
                      <dd className="font-semibold">
                        {slot.trafficLimitBytes ? `${formatTraffic(Number(slot.trafficUsedBytes))} / ${formatTraffic(Number(slot.trafficLimitBytes))}` : t("aurora.unlimited")}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <CopyButton
                      value={`socks5://${slot.login}:${slot.password}@${address}`}
                      label="SOCKS5"
                      copiedLabel={t("aurora.copied")}
                      copied={copied === `socks-${slot.id}`}
                      onCopied={() => void copy(`socks5://${slot.login}:${slot.password}@${address}`, `socks-${slot.id}`)}
                    />
                    <CopyButton
                      value={`${slot.login}:${slot.password}@${slot.host}:${slot.httpPort}`}
                      label="HTTP"
                      copiedLabel={t("aurora.copied")}
                      copied={copied === `http-${slot.id}`}
                      onCopied={() => void copy(`${slot.login}:${slot.password}@${slot.host}:${slot.httpPort}`, `http-${slot.id}`)}
                    />
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </AuSection>

      {categories.length === 0 ? (
        <AuEmpty icon={<KeyRound className="h-6 w-6" />} title={t("aurora.proxy_no_tariffs")} />
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
                    <Server className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-bold text-[var(--au-ink)]">{item.name}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-[var(--au-muted)]">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {t("aurora.days_short", { count: item.durationDays })}
                      </span>
                      <span>· {t("aurora.proxy_count", { count: item.proxyCount })}</span>
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
        title={tariff?.name ?? t("aurora.proxy")}
        waitKind="proxy"
        amountText={tariff ? formatAuroraBalance(tariff.price, tariff.currency.toUpperCase(), locale) : undefined}
        methods={methods}
        product={tariff ? { kind: "proxy", amount: tariff.price, currency: tariff.currency, proxyTariffId: tariff.id } : { kind: "proxy", amount: 0, currency: "RUB", proxyTariffId: "" }}
        onSuccess={() => {
          void Promise.all([load(), refreshProfile().catch(() => {})]);
        }}
      >
        {tariff && (
          <div className={cn("space-y-2 rounded-[18px] bg-[var(--au-surface)] p-3.5 text-[13px]")}>
            <div className="flex items-center justify-between">
              <span className="text-[var(--au-muted)]">{t("aurora.period")}</span>
              <span className="font-semibold text-[var(--au-ink)]">{t("aurora.days_short", { count: tariff.durationDays })}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--au-muted)]">{t("aurora.proxy_count", { count: tariff.proxyCount })}</span>
              <span className="font-semibold text-[var(--au-ink)]">{formatTraffic(Number(tariff.trafficLimitBytes ?? 0)) || t("aurora.unlimited")}</span>
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
    </AuPage>
  );
}
