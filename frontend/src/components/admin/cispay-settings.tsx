import type { AdminSettings } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { ArrowUpRight, Check, Copy, MessageCircle } from "lucide-react";

export function CispaySettings({ settings, onChange, saving }: { settings: AdminSettings; onChange: (patch: Partial<AdminSettings>) => void; saving: boolean }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const copyPromo = async () => {
    try { await navigator.clipboard.writeText("STEALTHNET_BOOSTED"); setCopyState("copied"); }
    catch { setCopyState("error"); }
  };
  return <Card>
    <CardHeader><div className="flex items-center justify-between gap-4"><div><CardTitle>CisPay</CardTitle><p className="mt-1 text-sm text-muted-foreground">Карта, СБП и криптовалюта</p></div><Switch aria-label="Включить CisPay" checked={settings.cispayEnabled === true} onCheckedChange={cispayEnabled => onChange({ cispayEnabled })} /></div></CardHeader>
    <CardContent className="space-y-4">
      {!settings.cispayShopId && <section className="rounded-lg border border-primary/20 bg-primary/5 p-4" aria-label="Партнёрское предложение CisPay">
        <p className="text-xs font-medium text-muted-foreground">CisPay × STEALTHNET</p>
        <h4 className="mt-2 text-base font-semibold">Ищете платёжную систему?</h4>
        <p className="mt-2 text-sm leading-relaxed">Подключите CisPay с кодом <strong className="break-all">STEALTHNET_BOOSTED</strong>: комиссия 3,7% при любом обороте, в том числе на старте.</p>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">По условиям партнёрской программы: конвертация по курсу Rapira без наценки и холд 1 день. Передайте код менеджеру CisPay при подключении и подтвердите условия для вашего магазина.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button asChild type="button" size="sm"><a href={`https://t.me/plin4ick?text=${encodeURIComponent("Привет! Я с проекта StealthNet. Мой промокод: STEALTHNET_BOOSTED")}`} target="_blank" rel="noopener noreferrer"><MessageCircle className="size-4" />Хочу подключиться!</a></Button>
          <Button type="button" variant="outline" size="sm" onClick={copyPromo}>{copyState === "copied" ? <Check className="size-4" /> : <Copy className="size-4" />}{copyState === "copied" ? "Код скопирован" : "Скопировать код"}</Button>
          <Button asChild type="button" variant="outline" size="sm"><a href="https://cispay.app" target="_blank" rel="noopener noreferrer">Открыть CisPay<ArrowUpRight className="size-4" /></a></Button>
        </div>
        <p role="status" className="mt-2 text-xs text-muted-foreground">{copyState === "error" ? "Не удалось скопировать. Выделите код в тексте выше." : "Партнёрское предложение: STEALTHNET получает вознаграждение от CisPay."}</p>
      </section>}
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
