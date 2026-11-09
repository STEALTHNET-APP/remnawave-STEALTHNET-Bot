import type { AdminSettings } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";

export function CispaySettings({ settings, onChange, saving }: { settings: AdminSettings; onChange: (patch: Partial<AdminSettings>) => void; saving: boolean }) {
  return <Card className="mt-4">
    <CardHeader><div className="flex items-center justify-between gap-4"><div><CardTitle>CisPay</CardTitle><p className="mt-1 text-sm text-muted-foreground">Карта, СБП и криптовалюта</p></div><Switch aria-label="Включить CisPay" checked={settings.cispayEnabled === true} onCheckedChange={cispayEnabled => onChange({ cispayEnabled })} /></div></CardHeader>
    <CardContent className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2"><Label htmlFor="cispay-shop">ID магазина</Label><Input id="cispay-shop" value={settings.cispayShopId ?? ""} onChange={e => onChange({ cispayShopId: e.target.value.trim() })} placeholder="UUID магазина" autoComplete="off" /></div>
        <div className="space-y-2"><Label htmlFor="cispay-key">Секретный API-ключ</Label><Input id="cispay-key" type="password" value={settings.cispayApiKey ?? ""} onChange={e => onChange({ cispayApiKey: e.target.value.trim() })} placeholder="cis_sec_…" autoComplete="new-password" /></div>
      </div>
      <div className="rounded-lg border p-3"><p className="mb-1 text-sm font-medium">Адрес уведомлений</p><code className="break-all text-xs">{`${settings.publicAppUrl || window.location.origin}/api/webhooks/cispay`}</code><p className="mt-2 text-xs text-muted-foreground">Укажите этот адрес в магазине CisPay. Платёж подтверждается по подписи уведомления и через API магазина.</p></div>
      <label className="flex items-start gap-3 rounded-lg border p-3"><Switch aria-label="Принимать тестовые платежи CisPay" checked={settings.cispaySandbox === true} onCheckedChange={cispaySandbox => onChange({ cispaySandbox })} /><span><span className="text-sm font-medium">Принимать тестовые платежи</span><span className="mt-1 block text-xs text-muted-foreground">Для отдельного тестового магазина. Режим sandbox включается в CisPay. Здесь выбирается, какие уведомления принимать: тестовые или реальные. Не включайте для работающего магазина.</span></span></label>
      <p className="text-xs text-muted-foreground">Разовые платежи в RUB и USD. Способ оплаты выбирает клиент на странице CisPay. Возврат карты и СБП запрашивается из карточки платежа; криптовалютные возвраты через API недоступны.</p>
      <Button type="submit" disabled={saving}>{saving ? "Сохранение…" : "Сохранить"}</Button>
    </CardContent>
  </Card>;
}
