import type { TariffRecord } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export type PromoFreeDaysValues = {
  tariffId?: string | null;
  tariffPriceOptionId?: string | null;
  durationDays?: number | null;
};

export function PromoFreeDaysFields({ tariffs, value, onChange }: {
  tariffs: TariffRecord[];
  value: PromoFreeDaysValues;
  onChange: (update: PromoFreeDaysValues) => void;
}) {
  const tariff = tariffs.find((t) => t.id === value.tariffId);
  const selectClass = 'flex h-10 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm';
  return <div className="grid gap-4">
    <div className="grid gap-1.5">
      <Label htmlFor="promo-tariff">Тариф</Label>
      <select id="promo-tariff" className={selectClass} value={value.tariffId ?? ''}
        onChange={(e) => onChange({ tariffId: e.target.value || null, tariffPriceOptionId: null })}>
        <option value="">Выберите тариф</option>
        {tariffs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
    </div>
    <div className="grid gap-1.5">
      <Label htmlFor="promo-duration-option">Длительность</Label>
      <select id="promo-duration-option" className={selectClass} disabled={!tariff} value={value.tariffPriceOptionId ?? ''}
        onChange={(e) => {
          const option = tariff?.priceOptions.find((p) => p.id === e.target.value);
          onChange({ tariffPriceOptionId: option?.id ?? null, ...(option ? { durationDays: option.durationDays } : {}) });
        }}>
        <option value="">Свой срок в днях</option>
        {tariff?.priceOptions.map((p) => <option key={p.id} value={p.id}>{p.durationDays} дн.</option>)}
      </select>
    </div>
    <div className="grid gap-1.5">
      <Label htmlFor="promo-duration-days">Дней подписки</Label>
      <Input id="promo-duration-days" type="number" min={1} max={3650} disabled={!!value.tariffPriceOptionId}
        value={value.durationDays ?? ''}
        onChange={(e) => onChange({ durationDays: e.target.value === '' ? null : Number(e.target.value) })} />
    </div>
    {tariff && <p className="text-xs text-muted-foreground">
      Новая подписка получит сквады и лимиты тарифа «{tariff.name}»: {tariff.includedDevices} устр., {Number(tariff.trafficLimitBytes) > 0 ? `${Number(tariff.trafficLimitBytes) / 1024 ** 3} ГБ` : 'трафик без лимита'}.
      Если подписка уже есть, добавятся только дни — её тариф и лимиты сохранятся.
    </p>}
  </div>;
}
