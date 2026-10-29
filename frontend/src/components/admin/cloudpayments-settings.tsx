import { useEffect, useState } from "react";
import { api, type AdminSettings } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export function CloudPaymentsSettings({ settings, onChange, token, saving }: { settings: AdminSettings; onChange: (patch: Partial<AdminSettings>) => void; token: string; saving: boolean }) {
  const [tariffs, setTariffs] = useState<{ id: string; name: string }[]>([]);
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.cloudpaymentsStatus>> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { api.getTariffs(token).then(r => setTariffs(r.items.filter(t => t.currency.toUpperCase() === "RUB"))).catch(() => setError("Не удалось загрузить тарифы")); }, [token]);
  return <Card><CardHeader><CardTitle>CloudPayments</CardTitle><p className="text-sm text-muted-foreground">Оплата картой, платный пробный период и регулярные списания.</p></CardHeader><CardContent className="space-y-5">
    <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="cp-public">Public ID</Label><Input id="cp-public" value={settings.cloudpaymentsPublicId || ""} onChange={e => onChange({ cloudpaymentsPublicId: e.target.value })}/></div><div className="space-y-2"><Label htmlFor="cp-secret">API Secret</Label><Input id="cp-secret" type="password" autoComplete="new-password" value={settings.cloudpaymentsApiSecret || ""} onChange={e => onChange({ cloudpaymentsApiSecret: e.target.value })}/></div></div>
    <label className="flex items-center gap-3"><input type="checkbox" checked={!!settings.cloudpaymentsEnabled} onChange={e => onChange({ cloudpaymentsEnabled: e.target.checked })}/>Принимать платежи через CloudPayments</label>
    <label className="flex items-center gap-3"><input type="checkbox" checked={settings.cloudpaymentsTestMode !== false} onChange={e => onChange({ cloudpaymentsTestMode: e.target.checked })}/>Тестовый терминал</label>
    <p className="text-sm text-muted-foreground">Режим должен совпадать с терминалом CloudPayments. Смена этой настройки не переводит сам терминал в тестовый режим.</p>
    <div className="space-y-2"><Label htmlFor="cp-tariff">Тариф после платного пробного периода</Label><select id="cp-tariff" className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={settings.cloudpaymentsTrialTariffId || ""} onChange={e => onChange({ cloudpaymentsTrialTariffId: e.target.value || null })}><option value="">Без платного пробного периода</option>{tariffs.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>{error && <p role="alert">{error}</p>}</div>
    <div className="grid gap-4 sm:grid-cols-3">{([{ key: "cloudpaymentsTrialDays", label: "Пробный период, дней", min: 0, max: 365, initial: 0 }, { key: "cloudpaymentsTrialAmount", label: "Первый платёж, ₽", min: 1, max: 1000000, initial: 1 }, { key: "cloudpaymentsGraceDays", label: "Доступ при отказе карты, дней", min: 0, max: 30, initial: 0 }] as const).map(f => <div className="space-y-2" key={f.key}><Label htmlFor={f.key}>{f.label}</Label><Input id={f.key} type="number" min={f.min} max={f.max} value={settings[f.key] ?? f.initial} onChange={e => onChange({ [f.key]: Number(e.target.value) })}/></div>)}</div>
    <p className="text-sm text-muted-foreground">В CloudPayments включите уведомления Check, Pay, Fail, Recurrent, Refund и Cancel. Метод POST, кодировка UTF8, формат CloudPayments. Для каждого события используйте адрес ниже с его названием в нижнем регистре.</p>
    <code className="block break-all text-xs">{window.location.origin}/api/webhooks/cloudpayments/check</code>
    <p className="text-sm text-muted-foreground">Клиент сам подтверждает автоплатёж перед вводом карты. Следующая сумма рассчитывается по текущей цене тарифа и дополнительных устройств. При отмене во время пробного периода доступ закрывается сразу. После обычной оплаты он действует до конца оплаченного срока.</p>
    <div className="space-y-3 border-t pt-4"><div className="flex items-center justify-between gap-3"><h3 className="font-medium">Обработка платежей</h3><Button type="button" variant="outline" onClick={() => api.cloudpaymentsStatus(token).then(setStatus).catch(() => setError("Не удалось загрузить состояние CloudPayments"))}>Обновить</Button></div>
      {status && <><p className="text-sm text-muted-foreground">Уведомлений в очереди: {status.pendingEvents}. Покупок ожидают выдачи или проверки: {status.jobs.length}.</p>{status.eventErrors.map(e => <p key={e.id} className="break-all text-sm text-destructive">{e.id} · {e.error}</p>)}{status.jobs.map(j => <p key={j.paymentId} className="break-all text-sm">{j.paymentId} · {j.state} · {j.error || "Ожидает обработки"}</p>)}{status.agreements.map(a => <div key={a.id} className="border-t pt-2 text-sm"><p className="break-all">{a.clientId} · {a.state} · {a.amount} ₽</p>{a.lastError && <p className="text-destructive">{a.lastError}</p>}</div>)}</>}
    </div>
    <Button type="submit" disabled={saving}>{saving ? "Сохранение…" : "Сохранить"}</Button>
  </CardContent></Card>;
}
