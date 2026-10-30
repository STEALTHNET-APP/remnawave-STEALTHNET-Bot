import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SlidersHorizontal } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { useCabinetConfig } from "@/contexts/cabinet-config";
import { formatAuroraBalance } from "@/lib/aurora-profile";
import { checkoutMethods } from "@/lib/cabinet-checkout";
import { AuroraPaymentSheet } from "@/components/aurora/aurora-payment-sheet";
import { AuButton, AuEmpty, AuInput, AuNotice, AuPage, AuSection } from "@/components/aurora/aurora-ui";
import { cn } from "@/lib/utils";

export function AuroraCustomBuild() {
  const { t, i18n } = useTranslation();
  const { state, refreshProfile } = useClientAuth();
  const config = useCabinetConfig();
  const client = state.client;
  const locale = i18n.language || "ru";
  const build = config?.customBuildConfig;

  const [days, setDays] = useState(30);
  const [devices, setDevices] = useState(1);
  const [trafficGb, setTrafficGb] = useState(10);
  const [promoCode, setPromoCode] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!build) return;
    setDays((value) => Math.min(Math.max(1, value), build.maxDays));
    setDevices((value) => Math.min(Math.max(1, value), build.maxDevices));
  }, [build]);

  const total = useMemo(() => {
    if (!build) return 0;
    let sum = days * build.pricePerDay + devices * build.pricePerDevice;
    if (build.trafficMode === "per_gb" && trafficGb > 0) sum += trafficGb * build.pricePerGb;
    return Math.round(sum * 100) / 100;
  }, [build, days, devices, trafficGb]);

  const methods = useMemo(
    () =>
      checkoutMethods(config, build?.currency ?? "RUB", {
        balanceAvailable: true,
        balanceLabel: t("aurora.pay_balance"),
        hasTelegram: Boolean(client?.telegramId),
      }),
    [config, build?.currency, client?.telegramId, t],
  );

  if (!build) {
    return (
      <AuPage>
        <AuEmpty icon={<SlidersHorizontal className="h-6 w-6" />} title={t("aurora.custom_disabled_title")} hint={t("aurora.custom_disabled_hint")} />
      </AuPage>
    );
  }

  const currency = build.currency.toUpperCase();

  return (
    <AuPage>
      <header className="px-1 pb-1">
        <h1 className="text-[26px] font-extrabold leading-tight tracking-tight text-[var(--au-ink)]">{t("aurora.custom_tariff")}</h1>
        <p className="mt-0.5 text-[14px] text-[var(--au-muted)]">{t("aurora.custom_subtitle")}</p>
      </header>

      <AuSection title={t("aurora.custom_days")}>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={1}
            max={build.maxDays}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="h-2 flex-1 accent-[var(--au-from)]"
            aria-label={t("aurora.custom_days")}
          />
          <span className="w-16 shrink-0 text-right text-[16px] font-extrabold tabular-nums text-[var(--au-ink)]">{days}</span>
        </div>
        <div className="mt-1 flex justify-between text-[11.5px] text-[var(--au-muted)]">
          <span>1</span>
          <span>{build.maxDays}</span>
        </div>
      </AuSection>

      <AuSection title={t("aurora.custom_devices")}>
        <div className="flex items-center gap-3">
          <span className="flex-1 text-[13px] text-[var(--au-muted)]">
            {formatAuroraBalance(build.pricePerDevice, currency, locale)} / {t("aurora.custom_per_device")}
          </span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setDevices((v) => Math.max(1, v - 1))} className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--au-bg)] text-[18px] font-bold">−</button>
            <span className="w-7 text-center text-[15px] font-extrabold tabular-nums">{devices}</span>
            <button type="button" onClick={() => setDevices((v) => Math.min(build.maxDevices, v + 1))} className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--au-bg)] text-[18px] font-bold">+</button>
          </div>
        </div>
      </AuSection>

      {build.trafficMode === "per_gb" && (
        <AuSection title={t("aurora.custom_traffic")}>
          <div className="flex items-center gap-3">
            <AuInput
              type="number"
              min={1}
              value={trafficGb}
              onChange={(e) => setTrafficGb(Math.max(0, Number(e.target.value)))}
              className="flex-1 tabular-nums"
            />
            <span className="shrink-0 text-[13px] text-[var(--au-muted)]">{t("aurora.gb")}</span>
          </div>
          <p className="mt-2 text-[12px] text-[var(--au-muted)]">
            {formatAuroraBalance(build.pricePerGb, currency, locale)} / {t("aurora.gb")}
          </p>
        </AuSection>
      )}

      <AuSection>
        <label className="block px-1 pb-1.5 text-[13px] font-semibold text-[var(--au-muted)]" htmlFor="custom-promo">
          {t("aurora.promo")}
        </label>
        <AuInput
          id="custom-promo"
          value={promoCode}
          onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
          placeholder={t("aurora.promo_placeholder")}
          autoComplete="off"
          maxLength={100}
        />
      </AuSection>

      <section className="flex items-center justify-between rounded-[22px] bg-[var(--au-surface)] px-4 py-4">
        <div>
          <div className="text-[12.5px] text-[var(--au-muted)]">{t("aurora.total")}</div>
          <div className="text-[26px] font-extrabold leading-tight tabular-nums text-[var(--au-ink)]">
            {formatAuroraBalance(total, currency, locale)}
          </div>
        </div>
        <AuButton className="w-auto px-6" onClick={() => setOpen(true)}>
          {t("aurora.custom_buy")}
        </AuButton>
      </section>

      <AuNotice>{t("aurora.custom_hint")}</AuNotice>

      <AuroraPaymentSheet
        open={open}
        onClose={() => setOpen(false)}
        title={t("aurora.custom_tariff")}
        waitKind="tariff"
        amountText={formatAuroraBalance(total, currency, locale)}
        methods={methods}
        product={{
          kind: "custom",
          customBuild: { days, devices, trafficGb: build.trafficMode === "per_gb" ? trafficGb : undefined },
          promoCode: promoCode.trim() || undefined,
          currency: build.currency,
        }}
        onSuccess={() => {
          refreshProfile().catch(() => {});
        }}
      >
        <div className={cn("space-y-2 rounded-[18px] bg-[var(--au-surface)] p-3.5 text-[13px]")}>
          <div className="flex items-center justify-between">
            <span className="text-[var(--au-muted)]">{t("aurora.custom_days")}</span>
            <span className="font-semibold text-[var(--au-ink)]">{days}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[var(--au-muted)]">{t("aurora.custom_devices")}</span>
            <span className="font-semibold text-[var(--au-ink)]">{devices}</span>
          </div>
          {build.trafficMode === "per_gb" && (
            <div className="flex items-center justify-between">
              <span className="text-[var(--au-muted)]">{t("aurora.custom_traffic")}</span>
              <span className="font-semibold text-[var(--au-ink)]">{trafficGb} {t("aurora.gb")}</span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-[var(--au-muted)]">{t("aurora.total")}</span>
            <span className="font-extrabold tabular-nums text-[var(--au-ink)]">{formatAuroraBalance(total, currency, locale)}</span>
          </div>
        </div>
      </AuroraPaymentSheet>
    </AuPage>
  );
}
