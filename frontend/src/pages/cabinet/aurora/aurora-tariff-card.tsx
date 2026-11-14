import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { ArrowRight, Check, Smartphone, Wifi } from "lucide-react";
import type { PublicTariff } from "@/lib/api";
import "./aurora-tariff-card.css";

export function auroraPrice(amount: number, currency: string) {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: currency.toUpperCase(), maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(amount);
}

export function auroraPeriodLabel(days: number, t: TFunction) {
  if (days === 365) return t("aurora.period_year");
  if (days === 30) return t("aurora.period_month");
  if (days > 30 && days % 30 === 0) return t("aurora.period_months", { count: days / 30 });
  return t("aurora.days_short", { count: days });
}

export function auroraTraffic(tariff: PublicTariff, t: TFunction) {
  const bytes = Number(tariff.trafficLimitBytes);
  if (!bytes || bytes <= 0) return { value: t("aurora.unlimited"), detail: t("aurora.traffic_unlimited_detail") };
  const value = `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(bytes / 1024 ** 3)} ${t("aurora.gb")}`;
  const detail = tariff.trafficResetMode === "monthly" ? t("aurora.traffic_monthly")
    : tariff.trafficResetMode === "monthly_rolling" ? t("aurora.traffic_rolling")
    : tariff.trafficResetMode === "on_purchase" ? t("aurora.traffic_on_purchase")
    : tariff.trafficResetMode === "carry_over" ? t("aurora.traffic_carry_over")
    : tariff.trafficResetMode === "no_reset" ? t("aurora.traffic_no_reset")
    : t("aurora.traffic_default");
  return { value, detail };
}

export function auroraDevices(tariff: PublicTariff, t: TFunction) {
  const count = tariff.includedDevices > 0 ? tariff.includedDevices : tariff.deviceLimit;
  if (count == null || count <= 0) return t("aurora.unlimited");
  return t("aurora.option_devices", { count });
}

export function AuroraTariffCard({ tariff, owned, canBuy, extraMonthlyPrice = 0, onChoose, onPeriodChange }: {
  tariff: PublicTariff;
  owned: boolean;
  canBuy: boolean;
  extraMonthlyPrice?: number;
  onChoose: (tariff: PublicTariff, optionId?: string) => void;
  onPeriodChange?: (optionId: string) => void;
}) {
  const { t } = useTranslation();
  const options = [...(tariff.priceOptions ?? [])].sort((a, b) => a.durationDays - b.durationDays || a.sortOrder - b.sortOrder);
  const [optionId, setOptionId] = useState<string | null>(null);
  const selected = options.find((option) => option.id === optionId) ?? options.find((option) => option.durationDays === 30) ?? options[0];
  const days = selected?.durationDays ?? tariff.durationDays;
  const base = selected?.price ?? tariff.price;
  const extra = Math.round(extraMonthlyPrice * (Math.max(1, days) / 30));
  const total = base + extra;
  const traffic = auroraTraffic(tariff, t);
  const pricePerDay = new Intl.NumberFormat("ru-RU", { style: "currency", currency: tariff.currency.toUpperCase(), minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(total / Math.max(1, days));
  const monthlyReference = (() => {
    const monthly = options.find((option) => option.durationDays === 30);
    if (!monthly) return tariff.durationDays > 0 ? (tariff.price / tariff.durationDays) * 30 : 0;
    return monthly.price;
  })();
  const discount = (option: (typeof options)[number]) => {
    if (!monthlyReference || option.durationDays <= 30) return 0;
    const monthly = (option.price / option.durationDays) * 30;
    return Math.max(0, Math.round((1 - monthly / monthlyReference) * 100));
  };

  return <article className="au-tariff-card" aria-labelledby={`au-tariff-${tariff.id}`}>
    <div className="au-tariff-card-heading">
      {owned && <span className="au-tariff-owned"><Check size={13} aria-hidden="true" />{t("aurora.tariff_owned")}</span>}
      <h3 id={`au-tariff-${tariff.id}`}>{tariff.name}</h3>
      {tariff.description?.trim() && <p className="au-tariff-description">{tariff.description}</p>}
    </div>

    <div className="au-tariff-includes">
      <div><Smartphone size={19} aria-hidden="true" /><strong>{auroraDevices(tariff, t)}</strong><span>{t("aurora.tariff_included")}</span></div>
      <div><Wifi size={19} aria-hidden="true" /><strong>{traffic.value}</strong><span>{traffic.detail}</span></div>
    </div>

    {options.length > 1 && <fieldset className="au-tariff-periods">
      <legend>{t("aurora.tariff_period_label")}</legend>
      <div>{options.map((option) => {
        const percent = discount(option);
        return <label key={option.id}>
          <input type="radio" name={`au-duration-${tariff.id}`} value={option.id} checked={option.id === selected?.id} onChange={() => { setOptionId(option.id); onPeriodChange?.(option.id); }} />
          <span>
            <span className="au-tariff-period-value">{auroraPeriodLabel(option.durationDays, t)}</span>
            {percent > 0 && <span className="au-tariff-period-discount">−{percent}%</span>}
          </span>
        </label>;
      })}</div>
    </fieldset>}

    <div className="au-tariff-card-price">
      <div><span>{t("aurora.tariff_for", { period: auroraPeriodLabel(days, t) })}</span><strong>{auroraPrice(total, tariff.currency)}</strong></div>
      <p><b>{pricePerDay}</b><span>{t("aurora.tariff_per_day")}</span></p>
    </div>
    {extra > 0 && <p className="au-tariff-breakdown">{t("aurora.tariff_breakdown", { plan: auroraPrice(base, tariff.currency), devices: auroraPrice(extra, tariff.currency) })}</p>}
    <button type="button" className="au-tariff-choose" disabled={!canBuy || total <= 0} onClick={() => onChoose(tariff, selected?.id)} aria-label={t("aurora.tariff_choose_named", { name: tariff.name })}>
      <span>{canBuy ? t("aurora.tariff_choose") : t("aurora.tariff_login_to_buy")}</span><ArrowRight size={18} aria-hidden="true" />
    </button>
  </article>;
}
