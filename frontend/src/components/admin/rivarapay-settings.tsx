import { useState } from "react";
import type { AdminSettings } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";

export function RivarapaySettings({ settings, onChange, saving }: { settings: AdminSettings; onChange: (patch: Partial<AdminSettings>) => void; saving: boolean }) {
  const [copyStatus, setCopyStatus] = useState("");
  return <Card>
    <CardHeader><div className="flex items-center justify-between gap-4"><div><CardTitle>RivaraPay</CardTitle><p className="mt-1 text-sm text-muted-foreground">СБП, карты и криптовалюта · счета в RUB</p></div><Switch aria-label="Включить RivaraPay" checked={settings.rivarapayEnabled === true} onCheckedChange={rivarapayEnabled => onChange({ rivarapayEnabled })} /></div></CardHeader>
    <CardContent className="space-y-4">
      {!settings.rivarapayApiKey && <section className="rounded-lg border border-primary/20 bg-primary/5 p-4" aria-label="Партнёрское предложение RivaraPay">
        <p className="text-xs font-medium text-muted-foreground">RivaraPay × STEALTHNET</p>
        <h4 className="mt-2 font-semibold">Ищете платёжную систему?</h4>
        <p className="mt-2 text-sm">Подключите RivaraPay с промокодом <strong>STEALTHNET</strong>: комиссия за СБП — 3,5% для клиентов проекта.</p>
        <p className="mt-2 text-xs text-muted-foreground">Передайте код менеджеру при подключении. STEALTHNET получает 15% от маржи RivaraPay по партнёрской программе. Комиссии других способов и условия магазина уточняйте у провайдера.</p>
        <div className="mt-3 flex flex-wrap gap-2"><Button asChild type="button" size="sm"><a href="https://rivarapay.io" target="_blank" rel="noopener noreferrer">Хочу подключиться!</a></Button><Button type="button" variant="outline" size="sm" onClick={async () => { try { await navigator.clipboard.writeText("STEALTHNET"); setCopyStatus("Код скопирован"); } catch { setCopyStatus("Не удалось скопировать. Код: STEALTHNET"); } }}>Скопировать код</Button></div><p role="status" className="mt-2 text-xs">{copyStatus}</p>
      </section>}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2"><Label htmlFor="rivarapay-key">API-ключ магазина</Label><Input id="rivarapay-key" type="password" autoComplete="new-password" value={settings.rivarapayApiKey ?? ""} onChange={e => onChange({ rivarapayApiKey: e.target.value.trim() })} placeholder="live_… или test_…" /></div>
        <div className="space-y-2"><Label htmlFor="rivarapay-secret">Секрет уведомлений</Label><Input id="rivarapay-secret" type="password" autoComplete="new-password" value={settings.rivarapayWebhookSecret ?? ""} onChange={e => onChange({ rivarapayWebhookSecret: e.target.value.trim() })} /></div>
      </div>
      <div className="rounded-lg border p-3"><p className="text-sm font-medium">Адрес уведомлений</p><code className="break-all text-xs">{`${(settings.publicAppUrl || window.location.origin).replace(/\/$/, "")}/api/webhooks/rivarapay`}</code><p className="mt-2 text-xs text-muted-foreground">Добавьте адрес в кабинете RivaraPay и включите события оплаты и возврата. Ключу нужны права payments:read и payments:write.</p></div>
      <label className="flex items-start gap-3 rounded-lg border p-3"><Switch aria-label="Тестовый режим RivaraPay" checked={settings.rivarapaySandbox === true} onCheckedChange={rivarapaySandbox => onChange({ rivarapaySandbox })} /><span><span className="text-sm font-medium">Тестовый режим</span><span className="mt-1 block text-xs text-muted-foreground">Нужен ключ test_. Проверяет создание счёта и уведомления, но не начисляет реальный баланс и не выдаёт подписку. Для приёма денег выключите и установите live_-ключ.</span></span></label>
      <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">Данные франшизного магазина</summary><p className="my-3 text-xs text-muted-foreground">Заполните, если RivaraPay подключил магазин как франшизу. Это данные владельца филиала, а не покупателя.</p><div className="grid gap-3 sm:grid-cols-2">
        {([
          ["rivarapayFranchiseType", "Тип филиала"], ["rivarapayFranchiseAddress", "Адрес филиала"], ["rivarapayFranchiseOwnerId", "Telegram ID владельца"], ["rivarapayFranchiseOwnerUsername", "Telegram username владельца (необязательно)"],
        ] as const).map(([key, label]) => <div key={key} className="space-y-2"><Label htmlFor={key}>{label}</Label><Input id={key} value={settings[key] ?? ""} onChange={e => onChange({ [key]: e.target.value.trim() })} /></div>)}
      </div></details>
      <p className="text-xs text-muted-foreground">Разовые покупки и пополнение баланса. Способы оплаты и лимиты задаются в RivaraPay. Возвраты оформляются в кабинете провайдера; панель получает их статус по уведомлению. После возврата проверьте выданный доступ в карточке платежа.</p>
      <Button type="submit" disabled={saving}>{saving ? "Сохранение…" : "Сохранить"}</Button>
    </CardContent>
  </Card>;
}
