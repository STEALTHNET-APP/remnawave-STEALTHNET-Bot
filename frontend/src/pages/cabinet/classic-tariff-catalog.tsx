import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Check, Layers, Package, Plus, Smartphone, Wifi } from "lucide-react";
import type { PublicTariff, PublicTariffCategory } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import "./classic-tariff-catalog.css";

type CatalogProps = {
  categories: PublicTariffCategory[];
  canBuy: boolean;
  onChoose: (tariff: PublicTariff, priceOptionId?: string) => void;
  getExtraCost: (tariff: PublicTariff, durationDays: number) => number;
};

export function ClassicTariffCatalog({ categories, ...props }: CatalogProps) {
  const { t } = useTranslation();
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const available = categories.filter((category) => category.tariffs.length > 0);
  // A renewal can narrow the catalogue after subscriptions finish loading.
  const selected = available.find((category) => category.id === categoryId) ?? available[0];
  if (!selected) return null;

  return (
    <div className="classic-tariff-catalog">
      <aside className="tariff-category-rail">
        <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <Layers className="h-4 w-4" aria-hidden="true" />
          {t("cabinet.tariffs.catalog.categories")}
        </p>
        <nav aria-label={t("cabinet.tariffs.catalog.categories")} className="tariff-category-list">
          {available.map((category) => (
            <button
              key={category.id}
              type="button"
              aria-pressed={selected.id === category.id}
              aria-controls="selected-tariff-category"
              className={cn("tariff-category-button rounded-xl border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                selected.id === category.id ? "border-primary/30 bg-primary/10 text-foreground" : "border-transparent text-muted-foreground hover:bg-muted/60")}
              onClick={() => setCategoryId(category.id)}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-background text-foreground" aria-hidden="true">
                {category.emoji || <Package className="h-5 w-5" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block break-words text-sm font-bold">{category.name}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{t("cabinet.tariffs.catalog.plan_count", { count: category.tariffs.length })}</span>
              </span>
              {selected.id === category.id && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
            </button>
          ))}
        </nav>
      </aside>

      <section id="selected-tariff-category" aria-labelledby="tariff-category-title" className="min-w-0">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <h2 id="tariff-category-title" className="min-w-0 break-words text-2xl font-bold tracking-tight">{selected.name}</h2>
          <span className="text-sm text-muted-foreground">{t("cabinet.tariffs.catalog.plan_count", { count: selected.tariffs.length })}</span>
        </div>
        <div className="tariff-plan-grid" data-count={Math.min(selected.tariffs.length, 3)}>
          {selected.tariffs.map((tariff) => <TariffPlan key={tariff.id} tariff={tariff} {...props} />)}
        </div>
      </section>
    </div>
  );
}

function TariffPlan({ tariff, canBuy, onChoose, getExtraCost }: Omit<CatalogProps, "categories"> & { tariff: PublicTariff }) {
  const { t, i18n } = useTranslation();
  const [optionId, setOptionId] = useState<string | null>(null);
  const options = [...(tariff.priceOptions ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.durationDays - b.durationDays);
  const selected = options.find((option) => option.id === optionId) ?? options[0];
  const days = selected?.durationDays ?? tariff.durationDays;
  const extraCost = getExtraCost(tariff, days);
  const price = (selected?.price ?? tariff.price) + extraCost;
  const money = (value: number, perDay = false) => new Intl.NumberFormat(i18n.language, {
    style: "currency", currency: tariff.currency.toUpperCase(), minimumFractionDigits: perDay ? 2 : 0, maximumFractionDigits: 2,
  }).format(value);
  const duration = (value: number) => t("cabinet.tariffs.catalog.day_count", { count: value });
  const traffic = tariff.trafficLimitBytes && tariff.trafficLimitBytes > 0
    ? `${new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(tariff.trafficLimitBytes / 1024 ** 3)} ${t("cabinet.tariffs.gb_unit")}${["monthly", "monthly_rolling"].includes(tariff.trafficResetMode ?? "") ? t("cabinet.tariffs.per_month") : ""}`
    : t("cabinet.tariffs.unlimited_traffic");
  const devices = tariff.deviceLimit && tariff.deviceLimit > 0
    ? t("cabinet.tariffs.catalog.device_count", { count: tariff.deviceLimit })
    : t("cabinet.tariffs.catalog.unlimited_devices");
  const canAddDevices = tariff.pricePerExtraDevice > 0 && tariff.maxExtraDevices > 0;

  return (
    <Card className="tariff-plan-card rounded-3xl shadow-lg" role="article" aria-labelledby={`tariff-name-${tariff.id}`}>
      <div className="tariff-plan-heading">
        <h3 id={`tariff-name-${tariff.id}`} className="break-words text-xl font-bold leading-snug">{tariff.name}</h3>
        {tariff.description?.trim() && <p className="mt-2 break-words text-sm leading-relaxed text-muted-foreground">{tariff.description}</p>}
      </div>

      <div className="tariff-plan-price">
        <p className="tariff-price-amount font-bold tracking-tight tabular-nums">{money(price)}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("cabinet.tariffs.catalog.for_duration", { duration: duration(days) })}
          {days > 0 && <span className="block mt-1">{t("cabinet.tariffs.catalog.per_day", { price: money(price / days, true) })}</span>}
        </p>
        {extraCost > 0 && <p className="mt-2 text-xs text-muted-foreground">{t("cabinet.tariffs.catalog.extras_included", { price: money(extraCost) })}</p>}
      </div>

      <div className="tariff-duration-row">
      {options.length > 1 ? (
        <fieldset className="tariff-duration-picker">
          <legend className="mb-2 text-xs font-semibold text-muted-foreground">{t("cabinet.tariffs.duration_label")}</legend>
          <div className="flex flex-wrap gap-1.5">
            {options.map((option) => (
              <label key={option.id} className="relative flex-1 basis-20 cursor-pointer">
                <input className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0" type="radio" name={`duration-${tariff.id}`} value={option.id} checked={selected?.id === option.id} onChange={() => setOptionId(option.id)} />
                <span className="flex min-h-11 items-center justify-center rounded-lg border border-border bg-background px-2 py-2 text-center text-sm font-semibold text-muted-foreground transition-colors peer-checked:border-primary/50 peer-checked:bg-primary/10 peer-checked:text-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2">{duration(option.durationDays)}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      </div>

      <div className="tariff-plan-features border-t border-border">
        <div className="flex items-start gap-3">
          <Wifi className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div><p className="text-sm font-semibold">{traffic}</p><p className="mt-1 text-xs text-muted-foreground">{t("cabinet.tariffs.traffic_label")}</p></div>
        </div>
        <div className="flex items-start gap-3">
          <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div><p className="text-sm font-semibold">{devices}</p><p className="mt-1 text-xs text-muted-foreground">{t("cabinet.tariffs.catalog.devices_included")}</p></div>
        </div>
      </div>

      <div className="tariff-plan-action">
        {canAddDevices && <p className="mb-4 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"><Plus className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{t("cabinet.tariffs.catalog.extra_devices", { count: tariff.maxExtraDevices })}</p>}
        {canBuy ? <Button className="min-h-12 w-full justify-between rounded-xl px-5 text-sm font-semibold shadow-md" aria-label={t("cabinet.tariffs.catalog.choose_named", { name: tariff.name })} onClick={() => onChoose(tariff, selected?.id)}>
          {t("cabinet.tariffs.catalog.choose")}<ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button> : <p className="rounded-xl bg-muted p-4 text-center text-sm text-muted-foreground">{t("cabinet.tariffs.in_bot")}</p>}
      </div>
    </Card>
  );
}
