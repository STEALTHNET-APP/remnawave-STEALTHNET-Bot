import { useState } from "react";
import { ArrowRight, Check, Smartphone, Wifi } from "lucide-react";
import type { PublicTariff } from "@/lib/api";
import "./aurora-tariff-card.css";

export function auroraPrice(amount: number, currency: string) {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: currency.toUpperCase(), maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(amount);
}

export function auroraDays(days: number) {
  const mod10 = days % 10, mod100 = days % 100;
  return `${days} ${mod10 === 1 && mod100 !== 11 ? "день" : mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20) ? "дня" : "дней"}`;
}

export function auroraTraffic(tariff: PublicTariff) {
  const bytes = Number(tariff.trafficLimitBytes);
  if (!bytes || bytes <= 0) return { value: "Безлимит", detail: "Трафик без ограничения объёма" };
  const value = `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(bytes / 1024 ** 3)} ГБ`;
  const detail = tariff.trafficResetMode === "monthly" ? "Трафик обновляется каждый месяц"
    : tariff.trafficResetMode === "monthly_rolling" ? "Трафик обновляется каждые 30 дней"
    : tariff.trafficResetMode === "on_purchase" ? "Лимит обновляется при покупке"
    : tariff.trafficResetMode === "carry_over" ? "Перенос остатка при продлении активной подписки"
    : tariff.trafficResetMode === "no_reset" ? "Лимит накапливается при продлении"
    : "Трафик по тарифу";
  return { value, detail };
}

export function auroraDevices(tariff: PublicTariff) {
  const count = tariff.includedDevices > 0 ? tariff.includedDevices : tariff.deviceLimit;
  if (count == null || count <= 0) return "Без лимита";
  const mod10 = count % 10, mod100 = count % 100;
  return `${count} ${mod10 === 1 && mod100 !== 11 ? "устройство" : mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20) ? "устройства" : "устройств"}`;
}

export function AuroraTariffCard({ tariff, owned, canBuy, extraMonthlyPrice = 0, onChoose, onPeriodChange }: {
  tariff: PublicTariff;
  owned: boolean;
  canBuy: boolean;
  extraMonthlyPrice?: number;
  onChoose: (tariff: PublicTariff, optionId?: string) => void;
  onPeriodChange?: (optionId: string) => void;
}) {
  const options = [...(tariff.priceOptions ?? [])].sort((a, b) => a.durationDays - b.durationDays || a.sortOrder - b.sortOrder);
  const [optionId, setOptionId] = useState<string | null>(null);
  const selected = options.find((option) => option.id === optionId) ?? options.find((option) => option.durationDays === 30) ?? options[0];
  const days = selected?.durationDays ?? tariff.durationDays;
  const base = selected?.price ?? tariff.price;
  const extra = Math.round(extraMonthlyPrice * (Math.max(1, days) / 30));
  const total = base + extra;
  const traffic = auroraTraffic(tariff);
  const pricePerDay = new Intl.NumberFormat("ru-RU", { style: "currency", currency: tariff.currency.toUpperCase(), minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(total / Math.max(1, days));

  return <article className="au-tariff-card" aria-labelledby={`au-tariff-${tariff.id}`}>
    <div className="au-tariff-card-heading">
      {owned && <span className="au-tariff-owned"><Check size={13} aria-hidden="true" />Есть подписка</span>}
      <h3 id={`au-tariff-${tariff.id}`}>{tariff.name}</h3>
      {tariff.description?.trim() && <p className="au-tariff-description">{tariff.description}</p>}
    </div>

    <div className="au-tariff-includes">
      <div><Smartphone size={19} aria-hidden="true" /><strong>{auroraDevices(tariff)}</strong><span>Включено в стоимость</span></div>
      <div><Wifi size={19} aria-hidden="true" /><strong>{traffic.value}</strong><span>{traffic.detail}</span></div>
    </div>

    {options.length > 1 && <fieldset className="au-tariff-periods">
      <legend>Срок подписки</legend>
      <div>{options.map((option) => <label key={option.id}>
        <input type="radio" name={`au-duration-${tariff.id}`} value={option.id} checked={option.id === selected?.id} onChange={() => { setOptionId(option.id); onPeriodChange?.(option.id); }} />
        <span>{auroraDays(option.durationDays)}</span>
      </label>)}</div>
    </fieldset>}

    <div className="au-tariff-card-price">
      <div><span>За {auroraDays(days)}</span><strong>{auroraPrice(total, tariff.currency)}</strong></div>
      <p><b>{pricePerDay}</b><span>в день</span></p>
    </div>
    {extra > 0 && <p className="au-tariff-breakdown">Тариф {auroraPrice(base, tariff.currency)} + сохранённые устройства {auroraPrice(extra, tariff.currency)}</p>}
    <button type="button" className="au-tariff-choose" disabled={!canBuy || total <= 0} onClick={() => onChoose(tariff, selected?.id)} aria-label={`Выбрать тариф «${tariff.name}»`}>
      <span>{canBuy ? "Выбрать тариф" : "Войдите для покупки"}</span><ArrowRight size={18} aria-hidden="true" />
    </button>
  </article>;
}
