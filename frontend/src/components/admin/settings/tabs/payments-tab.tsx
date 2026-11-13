import type { Dispatch, FormEvent, SetStateAction } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BarChart3, Check, ChevronDown, ChevronUp, Copy, CreditCard, GripVertical, RotateCw, Sparkles, Wallet } from "lucide-react";
import { CispaySettings } from "@/components/admin/cispay-settings";
import { CloudPaymentsSettings } from "@/components/admin/cloudpayments-settings";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TabsContent } from "@/components/ui/tabs";
import type { AdminSettings, AutoRenewStats } from "@/lib/api";

export const DEFAULT_PLATEGA_METHODS: { id: number; enabled: boolean; label: string }[] = [
  { id: 2, enabled: true, label: "СБП" },
  { id: 11, enabled: false, label: "Карты" },
  { id: 12, enabled: false, label: "Международный" },
  { id: 13, enabled: false, label: "Криптовалюта" },
];

/**
 * Кнопка-загрузчик офферов из Lava.top.
 * Дёргает /api/admin/lavatop/products, показывает список с offer ID и ценами.
 * Каждый offer ID можно скопировать в один клик.
 */
function LavatopOffersBrowser() {
  type Offer = {
    offerId: string;
    offerName: string;
    offerDescription?: string;
    productId: string;
    productTitle: string;
    productType: string;
    prices: { currency: string; amount: number; periodicity: string }[];
  };
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/admin/lavatop/products", {
        credentials: "include",
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.message || `HTTP ${r.status}`);
      setOffers(data.offers as Offer[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить");
    } finally {
      setLoading(false);
    }
  }

  async function copyId(id: string) {
    try { await navigator.clipboard.writeText(id); } catch { /* ignore */ }
    setCopiedId(id);
    setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
  }

  return (
    <div className="mt-4 pt-4 border-t border-dashed">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h5 className="text-sm font-semibold">Офферы в твоём Lava.top кабинете</h5>
          <p className="text-xs text-muted-foreground">Скопируй offer ID и вставь в поле «Lava.top Offer ID» нужного тарифа.</p>
        </div>
        <Button type="button" size="sm" onClick={load} disabled={loading}>
          {loading ? "Загружаю…" : (offers ? "Обновить" : "Показать офферы")}
        </Button>
      </div>
      {error && (
        <div className="text-xs rounded-md border border-red-300/50 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 p-2 mb-2">
           {error}
        </div>
      )}
      {offers && offers.length === 0 && (
        <p className="text-xs text-muted-foreground">У тебя нет ни одного оффера в кабинете Lava.top. Создай продукт + оффер на developers.lava.top.</p>
      )}
      {offers && offers.length > 0 && (
        <div className="grid gap-2">
          {offers.map((o) => {
            const isCopied = copiedId === o.offerId;
            return (
              <div key={o.offerId} className="rounded-lg border border-border bg-card p-3 text-xs space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate">{o.offerName || "(без названия)"}</div>
                    <div className="text-muted-foreground text-[10px] truncate">{o.productTitle} · {o.productType}</div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant={isCopied ? "default" : "outline"}
                    onClick={() => copyId(o.offerId)}
                    className="shrink-0"
                  >
                    {isCopied ? " Copied" : "Copy ID"}
                  </Button>
                </div>
                <div className="font-mono text-[11px] break-all text-primary">{o.offerId}</div>
                {o.prices.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {o.prices.map((p, i) => (
                      <span key={i} className="rounded-md bg-primary/10 border border-border px-2 py-0.5">
                        {p.amount} {p.currency} · {p.periodicity}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function isPaymentProviderActive(id: string, s: AdminSettings | null): boolean {
  if (!s) return false;
  if (id.startsWith("platega_")) {
    const methodId = Number(id.replace("platega_", ""));
    const hasCreds = Boolean(s.plategaMerchantId?.trim() && s.plategaSecret?.trim());
    const method = (s.plategaMethods ?? DEFAULT_PLATEGA_METHODS).find((m) => m.id === methodId);
    return Boolean(hasCreds && method?.enabled);
  }
  switch (id) {
    case "telegram_stars":
      return Boolean(s.telegramStarsEnabled && (s.telegramStarsRubPerStar ?? 0) > 0);
    case "cryptopay":
      return Boolean(s.cryptopayApiToken?.trim());
    case "heleket":
      return Boolean(s.heleketMerchantId?.trim() && s.heleketApiKey?.trim());
    case "cloudpayments":
      return Boolean(s.cloudpaymentsEnabled && s.cloudpaymentsPublicId && s.cloudpaymentsApiSecret);
    case "paritypay":
      return Boolean(
        s.paritypayEnabled &&
        s.paritypayShopId?.trim() &&
        s.paritypayApiKey?.trim() &&
        s.paritypaySigningSecret?.trim()
      );
    case "cispay":
      return Boolean(s.cispayEnabled && s.cispayShopId?.trim() && s.cispayApiKey?.trim());
    case "rollypay":
      return Boolean(
        s.rollypayEnabled !== false &&
        s.rollypayApiKey?.trim() &&
        s.rollypaySigningSecret?.trim()
      );
    case "yookassa":
      return Boolean(s.yookassaShopId?.trim() && s.yookassaSecretKey?.trim());
    case "yoomoney":
      return Boolean(s.yoomoneyReceiverWallet?.trim() && s.yoomoneyNotificationSecret?.trim());
    case "lava":
      return Boolean(s.lavaShopId?.trim() && s.lavaSecretKey?.trim());
    case "lavatop":
      return Boolean(s.lavatopApiKey?.trim());
    case "overpay":
      return Boolean(
        s.overpayApiUrl?.trim() &&
        s.overpayProjectId?.trim() &&
        s.overpayLogin?.trim() &&
        s.overpayPassword?.trim()
      );
    case "platega":
      return Boolean(s.plategaMerchantId?.trim() && s.plategaSecret?.trim());
    default:
      return false;
  }
}

export function PaymentsTab({
  settings,
  setSettings,
  saving,
  token,
  message,
  autoRenewStats,
  handleSubmit,
}: {
  settings: AdminSettings;
  setSettings: Dispatch<SetStateAction<AdminSettings | null>>;
  saving: boolean;
  token: string;
  message: string;
  autoRenewStats: AutoRenewStats | null;
  handleSubmit: (e: FormEvent) => void;
}) {
  const { t } = useTranslation();
  const [plategaCallbackCopied, setPlategaCallbackCopied] = useState(false);
  const [yoomoneyWebhookCopied, setYoomoneyWebhookCopied] = useState(false);
  const [yookassaWebhookCopied, setYookassaWebhookCopied] = useState(false);
  const [cryptopayWebhookCopied, setCryptopayWebhookCopied] = useState(false);
  const [heleketWebhookCopied, setHeleketWebhookCopied] = useState(false);
  const [lavaWebhookCopied, setLavaWebhookCopied] = useState(false);
  const [overpayWebhookCopied, setOverpayWebhookCopied] = useState(false);

  return (
          <TabsContent value="payments" className="space-y-4">
            <Card><CardContent className="space-y-2 pt-6">
              <Label htmlFor="payment-description">Описание платежа</Label>
              <Input id="payment-description" maxLength={128} value={settings.paymentDescription ?? ""} onChange={e => setSettings(s => s ? { ...s, paymentDescription: e.target.value } : s)} placeholder="По умолчанию — название тарифа или пополнение баланса" />
              <p className="text-xs text-muted-foreground">Для новых платежей через ЮKassa, ЮMoney, Platega, Crypto Pay, Overpay и ParityPay. Пустое поле возвращает стандартные описания. Название позиции в чеке ЮKassa сохраняется. Lava.top использует название своего оффера.</p>
            </CardContent></Card>
            <Card className="overflow-hidden border-border">
              <div className="relative bg-muted p-4 border-b border-border">
                <div className="absolute inset-0 bg-transparent pointer-events-none" />
                <div className="relative flex items-start gap-5">
                  <div className="flex-1 min-w-0">
                    <h2 className="text-xl font-bold tracking-tight text-foreground">
                      {t("admin.settings.payments_general")}
                    </h2>
                    <p className="text-[12.5px] text-muted-foreground mt-1">Платёжные провайдеры, авто-продление подписки, общие настройки оплат.</p>
                  </div>
                </div>
              </div>
              <CardContent className="space-y-4 p-4 sm:p-4">
                <div className="flex items-center justify-between gap-4 p-4 rounded-xl border bg-card/50">
                  <div className="space-y-1">
                    <Label className="text-base font-semibold">{t("admin.settings.auto_renew")}</Label>
                    <p className="text-sm text-muted-foreground">{t("admin.settings.auto_renew_hint")}</p>
                  </div>
                  <Switch
                    checked={settings.defaultAutoRenewEnabled ?? false}
                    onCheckedChange={(checked) => setSettings(s => s ? { ...s, defaultAutoRenewEnabled: checked } : s)}
                  />
                </div>

                <div className={`flex items-center justify-between gap-4 p-4 rounded-xl border bg-card/50${!settings.yookassaShopId || !settings.yookassaSecretKey || settings.yookassaSecretKey === "********" && !settings.yookassaShopId ? " opacity-50" : ""}`}>
                  <div className="space-y-1">
                    <Label className="text-base font-semibold">{t("admin.settings.yookassa_recurring")}</Label>
                    <p className="text-sm text-muted-foreground">
                      {!settings.yookassaShopId || !settings.yookassaSecretKey
                        ? t("admin.settings.yookassa_recurring_disabled")
                        : t("admin.settings.yookassa_recurring_hint")
                      }
                    </p>
                  </div>
                  <Switch
                    checked={settings.yookassaRecurringEnabled ?? false}
                    disabled={!settings.yookassaShopId || !settings.yookassaSecretKey}
                    onCheckedChange={(checked) => setSettings(s => s ? { ...s, yookassaRecurringEnabled: checked } : s)}
                  />
                </div>

                {/* Настройки автопродления */}
                <div className="space-y-4 p-4 rounded-xl border bg-card/50">
                  <Label className="text-base font-semibold">{t("admin.settings.auto_renew_settings")}</Label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>{t("admin.settings.renew_days_before")}</Label>
                      <Input
                        type="number"
                        min={1}
                        max={30}
                        value={settings.autoRenewDaysBeforeExpiry ?? 1}
                        onChange={(e) => setSettings(s => s ? { ...s, autoRenewDaysBeforeExpiry: parseInt(e.target.value) || 1 } : s)}
                      />
                      <p className="text-xs text-muted-foreground">{t("admin.settings.renew_days_hint")}</p>
                    </div>
                    <div className="space-y-2">
                      <Label>{t("admin.settings.notify_days_before")}</Label>
                      <Input
                        type="number"
                        min={1}
                        max={30}
                        value={settings.autoRenewNotifyDaysBefore ?? 3}
                        onChange={(e) => setSettings(s => s ? { ...s, autoRenewNotifyDaysBefore: parseInt(e.target.value) || 3 } : s)}
                      />
                      <p className="text-xs text-muted-foreground">{t("admin.settings.notify_days_hint")}</p>
                    </div>
                    <div className="space-y-2">
                      <Label>{t("admin.settings.grace_period")}</Label>
                      <Input
                        type="number"
                        min={0}
                        max={14}
                        value={settings.autoRenewGracePeriodDays ?? 2}
                        onChange={(e) => setSettings(s => s ? { ...s, autoRenewGracePeriodDays: parseInt(e.target.value) || 2 } : s)}
                      />
                      <p className="text-xs text-muted-foreground">{t("admin.settings.grace_period_hint")}</p>
                    </div>
                    <div className="space-y-2">
                      <Label>{t("admin.settings.max_retries")}</Label>
                      <Input
                        type="number"
                        min={1}
                        max={10}
                        value={settings.autoRenewMaxRetries ?? 3}
                        onChange={(e) => setSettings(s => s ? { ...s, autoRenewMaxRetries: parseInt(e.target.value) || 3 } : s)}
                      />
                      <p className="text-xs text-muted-foreground">{t("admin.settings.max_retries_hint")}</p>
                    </div>
                  </div>
                </div>
                {message && <p className="text-sm text-muted-foreground">{message}</p>}
                <Button onClick={handleSubmit} disabled={saving}>
                  {saving ? t("admin.settings.saving") : t("admin.settings.save")}
                </Button>
              </CardContent>
            </Card>

            {/* Auto-renewal statistics card */}
            {autoRenewStats && (
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5 text-primary" />
                    <CardTitle>{t("admin.settings.auto_renew_stats")}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    <div className="rounded-lg border bg-card p-4 text-center">
                      <p className="text-[13.5px] font-bold text-green-500">{autoRenewStats.enabled}</p>
                      <p className="text-xs text-muted-foreground mt-1">{t("admin.settings.auto_renew_on")}</p>
                    </div>
                    <div className="rounded-lg border bg-card p-4 text-center">
                      <p className="text-[13.5px] font-bold text-muted-foreground">{autoRenewStats.disabled}</p>
                      <p className="text-xs text-muted-foreground mt-1">{t("admin.settings.auto_renew_off")}</p>
                    </div>
                    <div className="rounded-lg border bg-card p-4 text-center">
                      <p className="text-[13.5px] font-bold text-yellow-500">{autoRenewStats.retriesInProgress}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        <RotateCw className="inline h-3 w-3 mr-1" />
                        {t("admin.settings.retry_attempts")}
                      </p>
                    </div>
                    <div className="rounded-lg border bg-card p-4 text-center">
                      <p className="text-[13.5px] font-bold">{autoRenewStats.renewalsLast7Days}</p>
                      <p className="text-xs text-muted-foreground mt-1">{t("admin.settings.renewals_7d")}</p>
                    </div>
                    <div className="rounded-lg border bg-card p-4 text-center">
                      <p className="text-[13.5px] font-bold">{autoRenewStats.renewalsLast30Days}</p>
                      <p className="text-xs text-muted-foreground mt-1">{t("admin.settings.renewals_30d")}</p>
                    </div>
                    <div className="rounded-lg border bg-card p-4 text-center">
                      <p className="text-[13.5px] font-bold text-primary">{autoRenewStats.amountLast30Days.toLocaleString("ru-RU")} {settings?.defaultCurrency === "rub" ? "₽" : "$"}</p>
                      <p className="text-xs text-muted-foreground mt-1">{t("admin.settings.amount_30d")}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/*  Порядок и названия платёжных провайдеров  */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <GripVertical className="h-5 w-5 text-primary" />
                  <CardTitle>{t("admin.settings.payment_providers_order")}</CardTitle>
                </div>
                <p className="text-sm text-muted-foreground">{t("admin.settings.payment_providers_order_hint")}</p>
              </CardHeader>
              <CardContent className="space-y-2">
                {(settings.paymentProviders ?? []).map((prov, idx, arr) => (
                  <div key={prov.id} className="flex flex-wrap items-center gap-3 p-3 rounded-xl border bg-card/50">
                    <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                    <Input
                      value={prov.label}
                      onChange={(e) => {
                        const updated = [...arr];
                        updated[idx] = { ...prov, label: e.target.value };
                        setSettings((s) => s ? { ...s, paymentProviders: updated } : s);
                      }}
                      className="flex-1 h-9"
                    />
                    <span className="text-xs text-muted-foreground font-mono shrink-0">{prov.id}</span>
                    {isPaymentProviderActive(prov.id, settings) ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shrink-0">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        Активен
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-muted text-muted-foreground border border-border shrink-0">
                        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
                        Не настроен
                      </span>
                    )}
                    <div className="flex flex-col gap-0.5">
                      <button
                        type="button"
                        disabled={idx === 0}
                        className="p-1 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        onClick={() => {
                          if (idx === 0) return;
                          const updated = [...arr];
                          [updated[idx - 1], updated[idx]] = [updated[idx], updated[idx - 1]];
                          updated.forEach((p, i) => { p.sortOrder = i; });
                          setSettings((s) => s ? { ...s, paymentProviders: updated } : s);
                        }}
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === arr.length - 1}
                        className="p-1 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        onClick={() => {
                          if (idx === arr.length - 1) return;
                          const updated = [...arr];
                          [updated[idx], updated[idx + 1]] = [updated[idx + 1], updated[idx]];
                          updated.forEach((p, i) => { p.sortOrder = i; });
                          setSettings((s) => s ? { ...s, paymentProviders: updated } : s);
                        }}
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
                {message && <p className="text-sm text-muted-foreground">{message}</p>}
                <Button onClick={handleSubmit} disabled={saving}>
                  {saving ? t("admin.settings.saving") : t("admin.settings.save")}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <Collapsible defaultOpen={false} className="group">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="w-full cursor-pointer rounded-t-lg text-left transition-colors hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  >
                    <CardHeader className="pointer-events-none [&_.chevron]:transition-transform [&_.chevron]:duration-200 group-data-[state=open]:[&_.chevron]:rotate-180">
                      <div className="flex items-center justify-between pr-2">
                        <div className="flex items-center gap-2">
                          <CreditCard className="h-5 w-5 text-primary" />
                          <CardTitle>Platega</CardTitle>
                          <span className="text-xs font-normal text-muted-foreground">{t("admin.settings.platega_expand")}</span>
                        </div>
                        <ChevronDown className="chevron h-5 w-5 shrink-0 text-muted-foreground" />
                      </div>
                      <p className="text-[12.5px] text-muted-foreground mt-[3px]">
                        {t("admin.settings.platega_callback_note")}
                      </p>
                    </CardHeader>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="space-y-4 border-t pt-4">
                    <div className="space-y-2">
                      <Label>{t("admin.settings.platega_callback")}</Label>
                      <div className="flex gap-2">
                        <Input
                          readOnly
                          value={(settings.publicAppUrl ?? "").replace(/\/$/, "") ? `${(settings.publicAppUrl ?? "").replace(/\/$/, "")}/api/webhooks/platega` : t("admin.settings.specify_url_hint")}
                          className="font-mono text-sm bg-muted/50"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="shrink-0"
                          onClick={async () => {
                            const url = (settings.publicAppUrl ?? "").replace(/\/$/, "") ? `${(settings.publicAppUrl ?? "").replace(/\/$/, "")}/api/webhooks/platega` : "";
                            if (url && navigator.clipboard) {
                              await navigator.clipboard.writeText(url);
                              setPlategaCallbackCopied(true);
                              setTimeout(() => setPlategaCallbackCopied(false), 2000);
                            }
                          }}
                          disabled={!(settings.publicAppUrl ?? "").trim()}
                          title={t("admin.settings.copy")}
                        >
                          {plategaCallbackCopied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">{t("admin.settings.platega_callback_hint")}</p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>{t("admin.settings.platega_merchant")}</Label>
                        <Input
                          value={settings.plategaMerchantId ?? ""}
                          onChange={(e) => setSettings((s) => (s ? { ...s, plategaMerchantId: e.target.value || null } : s))}
                          placeholder="UUID из ЛК Platega"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>{t("admin.settings.platega_secret")}</Label>
                        <Input
                          type="password"
                          value={settings.plategaSecret ?? ""}
                          onChange={(e) => setSettings((s) => (s ? { ...s, plategaSecret: e.target.value || null } : s))}
                          placeholder={t("admin.settings.platega_key_placeholder")}
                        />
                      </div>
                    </div>
                    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 mt-4 space-y-2">
                      <Label className="text-emerald-700 dark:text-emerald-400"> Защита webhook'ов от форджинга</Label>
                      <p className="text-xs text-muted-foreground">
                        Включается автоматически когда заданы <code className="text-[11px]">Merchant ID</code> и <code className="text-[11px]">Secret key</code> выше. Каждый входящий webhook проверяется через Platega API: запрашиваем у них реальный статус транзакции и доверяем только их ответу. Атакер не может подделать ответ от <code className="text-[11px]">app.platega.io</code>, поэтому форджинг невозможен.
                      </p>
                      <details className="text-xs">
                        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Опционально: HMAC подпись (на будущее)</summary>
                        <div className="mt-2 space-y-1.5">
                          <p className="text-muted-foreground">
                            Если когда-нибудь Platega добавит подписание webhook'ов в кабинете — впишешь сюда секрет и все webhook'и без валидной HMAC-SHA256 в <code className="text-[11px]">X-Signature</code> будут отвергаться. <strong>Сейчас в их кабинете такой опции нет — оставь поле пустым.</strong>
                          </p>
                          <Input
                            type="password"
                            value={(settings as { plategaWebhookSecret?: string | null }).plategaWebhookSecret ?? ""}
                            onChange={(e) => setSettings((s) => (s ? { ...s, plategaWebhookSecret: e.target.value || null } as typeof s : s))}
                            placeholder="(оставь пустым — Platega не поддерживает HMAC)"
                          />
                        </div>
                      </details>
                    </div>
                    <div className="space-y-2">
                      <Label>{t("admin.settings.payment_methods")}</Label>
                      <p className="text-xs text-muted-foreground">{t("admin.settings.payment_methods_hint")}</p>
                      <div className="rounded-md border divide-y">
                        {(settings.plategaMethods ?? DEFAULT_PLATEGA_METHODS).map((m) => (
                          <div key={m.id} className="flex items-center gap-4 p-3">
                            <Switch
                              id={`platega-method-${m.id}`}
                              checked={m.enabled}
                              onCheckedChange={(checked: boolean) =>
                                setSettings((s) =>
                                  s
                                    ? {
                                        ...s,
                                        plategaMethods: (s.plategaMethods ?? DEFAULT_PLATEGA_METHODS).map((x) =>
                                          x.id === m.id ? { ...x, enabled: checked === true } : x
                                        ),
                                      }
                                    : s
                                )
                              }
                            />
                            <Label htmlFor={`platega-method-${m.id}`} className="shrink-0 w-8 cursor-pointer">
                              {m.id}
                            </Label>
                            <Input
                              className="flex-1"
                              value={m.label}
                              onChange={(e) =>
                                setSettings((s) =>
                                  s
                                    ? {
                                        ...s,
                                        plategaMethods: (s.plategaMethods ?? DEFAULT_PLATEGA_METHODS).map((x) =>
                                          x.id === m.id ? { ...x, label: e.target.value } : x
                                        ),
                                      }
                                    : s
                                )
                              }
                              placeholder={t("admin.settings.platega_btn_placeholder")}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                    {message && <p className="text-sm text-muted-foreground">{message}</p>}
                    <Button type="submit" disabled={saving}>
                      {saving ? t("admin.settings.saving") : t("admin.settings.save")}
                    </Button>
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>

              <Collapsible defaultOpen={false} className="group mt-4">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="w-full cursor-pointer rounded-t-lg text-left transition-colors hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  >
                    <CardHeader className="pointer-events-none [&_.chevron]:transition-transform [&_.chevron]:duration-200 group-data-[state=open]:[&_.chevron]:rotate-180">
                      <div className="flex items-center justify-between pr-2">
                        <div className="flex items-center gap-2">
                          <Wallet className="h-5 w-5 text-primary" />
                          <CardTitle>ЮMoney</CardTitle>
                          <span className="text-xs font-normal text-muted-foreground">{t("admin.settings.yoomoney_card")}</span>
                        </div>
                        <ChevronDown className="chevron h-5 w-5 shrink-0 text-muted-foreground" />
                      </div>
                      <p className="text-[12.5px] text-muted-foreground mt-[3px]">
                        {t("admin.settings.yoomoney_register")} <a href="https://yoomoney.ru/myservices/new" target="_blank" rel="noreferrer" className="text-primary underline">yoomoney.ru/myservices/new</a>
                      </p>
                    </CardHeader>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="space-y-4 border-t pt-4">
                    <div className="space-y-2">
                      <Label>{t("admin.settings.yoomoney_webhook")}</Label>
                      <div className="flex gap-2">
                        <Input
                          readOnly
                          value={(settings.publicAppUrl ?? "").replace(/\/$/, "") ? `${(settings.publicAppUrl ?? "").replace(/\/$/, "")}/api/webhooks/yoomoney` : t("admin.settings.specify_url_hint")}
                          className="font-mono text-sm bg-muted/50"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="shrink-0"
                          onClick={async () => {
                            const url = (settings.publicAppUrl ?? "").replace(/\/$/, "") ? `${(settings.publicAppUrl ?? "").replace(/\/$/, "")}/api/webhooks/yoomoney` : "";
                            if (url && navigator.clipboard) {
                              await navigator.clipboard.writeText(url);
                              setYoomoneyWebhookCopied(true);
                              setTimeout(() => setYoomoneyWebhookCopied(false), 2000);
                            }
                          }}
                          disabled={!(settings.publicAppUrl ?? "").trim()}
                          title={t("admin.settings.copy")}
                        >
                          {yoomoneyWebhookCopied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">{t("admin.settings.yoomoney_webhook_hint")}</p>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {t("admin.settings.yoomoney_desc")}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2 sm:col-span-2">
                        <Label>{t("admin.settings.yoomoney_wallet")}</Label>
                        <Input
                          value={settings.yoomoneyReceiverWallet ?? ""}
                          onChange={(e) => setSettings((s) => (s ? { ...s, yoomoneyReceiverWallet: e.target.value || null } : s))}
                          placeholder="41001123456789"
                        />
                        <p className="text-xs text-muted-foreground">{t("admin.settings.yoomoney_wallet_hint")}</p>
                      </div>
                      <div className="space-y-2 sm:col-span-2">
                        <Label>{t("admin.settings.yoomoney_secret")}</Label>
                        <Input
                          type="password"
                          value={settings.yoomoneyNotificationSecret ?? ""}
                          onChange={(e) => setSettings((s) => (s ? { ...s, yoomoneyNotificationSecret: e.target.value || null } : s))}
                          placeholder={t("admin.settings.yoomoney_secret_placeholder")}
                        />
                        <p className="text-xs text-muted-foreground">{t("admin.settings.yoomoney_secret_hint")}</p>
                      </div>
                    </div>
                    <div className="pt-2 border-t">
                      <Button type="submit" disabled={saving} className="min-w-[140px]">
                        {saving ? t("admin.settings.saving") : t("admin.settings.save")}
                      </Button>
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>

              <Collapsible defaultOpen={false} className="group mt-4">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="w-full cursor-pointer rounded-t-lg text-left transition-colors hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  >
                    <CardHeader className="pointer-events-none [&_.chevron]:transition-transform [&_.chevron]:duration-200 group-data-[state=open]:[&_.chevron]:rotate-180">
                      <div className="flex items-center justify-between pr-2">
                        <div className="flex items-center gap-2">
                          <Wallet className="h-5 w-5 text-primary" />
                          <CardTitle>ЮKassa</CardTitle>
                          <span className="text-xs font-normal text-muted-foreground">{t("admin.settings.yookassa_api")}</span>
                        </div>
                        <ChevronDown className="chevron h-5 w-5 shrink-0 text-muted-foreground" />
                      </div>
                      <p className="text-[12.5px] text-muted-foreground mt-[3px]">
                        {t("admin.settings.yookassa_register")} <a href="https://yookassa.ru/joinups" target="_blank" rel="noreferrer" className="text-primary underline">yookassa.ru</a>
                      </p>
                    </CardHeader>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="space-y-4 border-t pt-4">
                    <div className="space-y-2">
                      <Label>{t("admin.settings.yookassa_webhook")}</Label>
                      <div className="flex gap-2">
                        <Input
                          readOnly
                          value={(settings.publicAppUrl ?? "").replace(/\/$/, "") ? `${(settings.publicAppUrl ?? "").replace(/\/$/, "")}/api/webhooks/yookassa` : t("admin.settings.specify_url_hint")}
                          className="font-mono text-sm bg-muted/50"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="shrink-0"
                          onClick={async () => {
                            const url = (settings.publicAppUrl ?? "").replace(/\/$/, "") ? `${(settings.publicAppUrl ?? "").replace(/\/$/, "")}/api/webhooks/yookassa` : "";
                            if (url && navigator.clipboard) {
                              await navigator.clipboard.writeText(url);
                              setYookassaWebhookCopied(true);
                              setTimeout(() => setYookassaWebhookCopied(false), 2000);
                            }
                          }}
                          disabled={!(settings.publicAppUrl ?? "").trim()}
                          title={t("admin.settings.copy")}
                        >
                          {yookassaWebhookCopied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">{t("admin.settings.yookassa_webhook_hint")}</p>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {t("admin.settings.yookassa_desc")}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>{t("admin.settings.yookassa_shop_id")}</Label>
                        <Input
                          value={settings.yookassaShopId ?? ""}
                          onChange={(e) => setSettings((s) => (s ? { ...s, yookassaShopId: e.target.value || null } : s))}
                          placeholder="123456"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>{t("admin.settings.yookassa_secret")}</Label>
                        <Input
                          type="password"
                          value={settings.yookassaSecretKey ?? ""}
                          onChange={(e) => setSettings((s) => (s ? { ...s, yookassaSecretKey: e.target.value || null } : s))}
                          placeholder="live_..."
                        />
                        <p className="text-xs text-muted-foreground">{t("admin.settings.yookassa_key_hint")}</p>
                      </div>
                    </div>
                    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 mt-4 space-y-3">
                      <div>
                        <Label className="text-amber-700 dark:text-amber-400">Webhook Basic Auth</Label>
                        <p className="text-xs text-muted-foreground mt-1">
                          Защита от форджинга webhook'ов. В кабинете ЮKassa настроить webhook URL вида{" "}
                          <code className="text-[11px]">https://USER:PASS@panel.example.com/api/webhooks/yookassa</code>{" "}
                          и сюда вписать те же USER и PASS. Если не задано — webhook принимается без проверки (с warning'ом в логах).
                        </p>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <Label className="text-xs">Basic-auth username</Label>
                          <Input
                            value={(settings as { yookassaWebhookBasicUser?: string | null }).yookassaWebhookBasicUser ?? ""}
                            onChange={(e) => setSettings((s) => (s ? { ...s, yookassaWebhookBasicUser: e.target.value || null } as typeof s : s))}
                            placeholder="webhook_user"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs">Basic-auth password</Label>
                          <Input
                            type="password"
                            value={(settings as { yookassaWebhookBasicPassword?: string | null }).yookassaWebhookBasicPassword ?? ""}
                            onChange={(e) => setSettings((s) => (s ? { ...s, yookassaWebhookBasicPassword: e.target.value || null } as typeof s : s))}
                            placeholder="случайный длинный пароль"
                          />
                        </div>
                      </div>
                    </div>
                    <div className="pt-2 border-t">
                      <Button type="submit" disabled={saving} className="min-w-[140px]">
                        {saving ? t("admin.settings.saving") : t("admin.settings.save")}
                      </Button>
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>

              <CloudPaymentsSettings settings={settings} token={token!} saving={saving} onChange={patch => setSettings(s => s ? { ...s, ...patch } : s)}/>

              <Collapsible defaultOpen={false} className="group mt-4">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="w-full cursor-pointer rounded-t-lg text-left transition-colors hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  >
                    <CardHeader className="pointer-events-none [&_.chevron]:transition-transform [&_.chevron]:duration-200 group-data-[state=open]:[&_.chevron]:rotate-180">
                      <div className="flex items-center justify-between pr-2">
                        <div className="flex items-center gap-2">
                          <Sparkles className="h-5 w-5 text-amber-500" />
                          <CardTitle>Telegram Stars</CardTitle>
                          <span className="text-xs font-normal text-muted-foreground">— приём оплаты звёздами в Telegram</span>
                        </div>
                        <ChevronDown className="chevron h-5 w-5 shrink-0 text-muted-foreground" />
                      </div>
                      <p className="text-[12.5px] text-muted-foreground mt-[3px]">
                        Оплата цифровыми звёздами через бота для пользователей с привязанным Telegram
                      </p>
                    </CardHeader>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="space-y-4 border-t pt-4">
                    <div className="flex items-center gap-2">
                      <input id="telegramStarsEnabled" type="checkbox" checked={settings.telegramStarsEnabled ?? false} onChange={(e) => setSettings(s => s ? { ...s, telegramStarsEnabled: e.target.checked } : s)} />
                      <Label htmlFor="telegramStarsEnabled">Принимать оплату звёздами</Label>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="telegramStarsRubPerStar">Стоимость одной звезды в рублях</Label>
                      <Input id="telegramStarsRubPerStar" type="number" min="0" step="0.01" value={settings.telegramStarsRubPerStar ?? 0} onChange={(e) => setSettings(s => s ? { ...s, telegramStarsRubPerStar: Number(e.target.value) } : s)} />
                      <p className="text-sm text-muted-foreground">Вы задаёте стоимость звезды для своего сервиса. Цена тарифа в рублях делится на это значение и округляется вверх до целого количества Stars. При нуле оплата недоступна.</p>
                      {(settings.telegramStarsRubPerStar ?? 0) > 0 && <p className="text-sm">Например, 300 ₽ = {Math.ceil(300 / settings.telegramStarsRubPerStar!)} ⭐</p>}
                      <p className="text-sm text-muted-foreground">Используется основной Telegram-бот. Оплата доступна для цен в рублях и аккаунтов с привязанным Telegram.</p>
                    </div>
                    <Button type="submit" disabled={saving}>{saving ? t("admin.settings.saving") : t("admin.settings.save")}</Button>
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>
              <Collapsible defaultOpen={false} className="group mt-4">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="w-full cursor-pointer rounded-t-lg text-left transition-colors hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  >
                    <CardHeader className="pointer-events-none [&_.chevron]:transition-transform [&_.chevron]:duration-200 group-data-[state=open]:[&_.chevron]:rotate-180">
                      <div className="flex items-center justify-between pr-2">
                        <div className="flex items-center gap-2">
                          <Wallet className="h-5 w-5 text-primary" />
                          <CardTitle>Crypto Pay (Crypto Bot)</CardTitle>
                          <span className="text-xs font-normal text-muted-foreground">{t("admin.settings.cryptopay_telegram")}</span>
                        </div>
                        <ChevronDown className="chevron h-5 w-5 shrink-0 text-muted-foreground" />
                      </div>
                      <p className="text-[12.5px] text-muted-foreground mt-[3px]">
                        {t("admin.settings.cryptopay_register")}
                      </p>
                    </CardHeader>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="space-y-4 border-t pt-4">
                    <div className="space-y-2">
                      <Label>{t("admin.settings.cryptopay_webhook")}</Label>
                      <div className="flex gap-2">
                        <Input
                          readOnly
                          value={(settings.publicAppUrl ?? "").replace(/\/$/, "") ? `${(settings.publicAppUrl ?? "").replace(/\/$/, "")}/api/webhooks/cryptopay` : t("admin.settings.specify_url_hint")}
                          className="font-mono text-sm bg-muted/50"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="shrink-0"
                          onClick={async () => {
                            const url = (settings.publicAppUrl ?? "").replace(/\/$/, "") ? `${(settings.publicAppUrl ?? "").replace(/\/$/, "")}/api/webhooks/cryptopay` : "";
                            if (url && navigator.clipboard) {
                              await navigator.clipboard.writeText(url);
                              setCryptopayWebhookCopied(true);
                              setTimeout(() => setCryptopayWebhookCopied(false), 2000);
                            }
                          }}
                          disabled={!(settings.publicAppUrl ?? "").trim()}
                          title={t("admin.settings.copy")}
                        >
                          {cryptopayWebhookCopied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">{t("admin.settings.cryptopay_webhook_hint")}</p>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {t("admin.settings.cryptopay_desc")}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>{t("admin.settings.cryptopay_token")}</Label>
                        <Input
                          type="password"
                          value={settings.cryptopayApiToken ?? ""}
                          onChange={(e) => setSettings((s) => (s ? { ...s, cryptopayApiToken: e.target.value || null } : s))}
                          placeholder="123456789:AAzQc..."
                        />
                        <p className="text-xs text-muted-foreground">{t("admin.settings.cryptopay_token_hint")}</p>
                      </div>
                      <div className="space-y-2 flex flex-col justify-end">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id="cryptopayTestnet"
                            checked={settings.cryptopayTestnet ?? false}
                            onChange={(e) => setSettings((s) => (s ? { ...s, cryptopayTestnet: e.target.checked } : s))}
                            className="rounded border"
                          />
                          <Label htmlFor="cryptopayTestnet">{t("admin.settings.cryptopay_testnet")}</Label>
                        </div>
                        <p className="text-xs text-muted-foreground">{t("admin.settings.cryptopay_testnet_hint")}</p>
                      </div>
                    </div>
                    <div className="pt-2 border-t">
                      <Button type="submit" disabled={saving} className="min-w-[140px]">
                        {saving ? t("admin.settings.saving") : t("admin.settings.save")}
                      </Button>
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>

              <Collapsible defaultOpen={false} className="group mt-4">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="w-full cursor-pointer rounded-t-lg text-left transition-colors hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  >
                    <CardHeader className="pointer-events-none [&_.chevron]:transition-transform [&_.chevron]:duration-200 group-data-[state=open]:[&_.chevron]:rotate-180">
                      <div className="flex items-center justify-between pr-2">
                        <div className="flex items-center gap-2">
                          <Wallet className="h-5 w-5 text-primary" />
                          <CardTitle>Heleket</CardTitle>
                          <span className="text-xs font-normal text-muted-foreground">{t("admin.settings.heleket_crypto")}</span>
                        </div>
                        <ChevronDown className="chevron h-5 w-5 shrink-0 text-muted-foreground" />
                      </div>
                      <p className="text-[12.5px] text-muted-foreground mt-[3px]">
                        {t("admin.settings.heleket_register")}
                      </p>
                    </CardHeader>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="space-y-4 border-t pt-4">
                    <div className="space-y-2">
                      <Label>{t("admin.settings.heleket_webhook")}</Label>
                      <div className="flex gap-2">
                        <Input
                          readOnly
                          value={(settings.publicAppUrl ?? "").replace(/\/$/, "") ? `${(settings.publicAppUrl ?? "").replace(/\/$/, "")}/api/webhooks/heleket` : t("admin.settings.specify_url_hint")}
                          className="font-mono text-sm bg-muted/50"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="shrink-0"
                          onClick={async () => {
                            const url = (settings.publicAppUrl ?? "").replace(/\/$/, "") ? `${(settings.publicAppUrl ?? "").replace(/\/$/, "")}/api/webhooks/heleket` : "";
                            if (url && navigator.clipboard) {
                              await navigator.clipboard.writeText(url);
                              setHeleketWebhookCopied(true);
                              setTimeout(() => setHeleketWebhookCopied(false), 2000);
                            }
                          }}
                          disabled={!(settings.publicAppUrl ?? "").trim()}
                          title={t("admin.settings.copy")}
                        >
                          {heleketWebhookCopied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">{t("admin.settings.heleket_webhook_hint")}</p>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {t("admin.settings.heleket_desc")}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>{t("admin.settings.heleket_merchant")}</Label>
                        <Input
                          value={settings.heleketMerchantId ?? ""}
                          onChange={(e) => setSettings((s) => (s ? { ...s, heleketMerchantId: e.target.value || null } : s))}
                          placeholder="8b03432e-385b-4670-8d06-064591096795"
                        />
                        <p className="text-xs text-muted-foreground">{t("admin.settings.heleket_merchant_hint")}</p>
                      </div>
                      <div className="space-y-2">
                        <Label>{t("admin.settings.heleket_api_key")}</Label>
                        <Input
                          type="password"
                          value={settings.heleketApiKey ?? ""}
                          onChange={(e) => setSettings((s) => (s ? { ...s, heleketApiKey: e.target.value || null } : s))}
                          placeholder={t("admin.settings.heleket_key_placeholder")}
                        />
                        <p className="text-xs text-muted-foreground">{t("admin.settings.heleket_key_hint")}</p>
                      </div>
                    </div>
                    <div className="pt-2 border-t">
                      <Button type="submit" disabled={saving} className="min-w-[140px]">
                        {saving ? t("admin.settings.saving") : t("admin.settings.save")}
                      </Button>
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>
              <Collapsible defaultOpen={false} className="group mt-4">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="w-full cursor-pointer rounded-t-lg text-left transition-colors hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  >
                    <CardHeader className="pointer-events-none [&_.chevron]:transition-transform [&_.chevron]:duration-200 group-data-[state=open]:[&_.chevron]:rotate-180">
                      <div className="flex items-center justify-between pr-2">
                        <div className="flex items-center gap-2">
                          <Wallet className="h-5 w-5 text-primary" />
                          <CardTitle>ParityPay</CardTitle>
                          <span className="text-xs font-normal text-muted-foreground">— СБП / Карты (RUB)</span>
                        </div>
                        <ChevronDown className="chevron h-5 w-5 shrink-0 text-muted-foreground" />
                      </div>
                    </CardHeader>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      Создайте кассу в ParityPay и укажите её ID и два секретных ключа. Платёжка появится у клиентов после включения и заполнения всех полей.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2 sm:col-span-2">
                        <Label htmlFor="parity-shop">ID кассы (X-ShopId)</Label>
                        <Input
                          id="parity-shop"
                          value={settings.paritypayShopId ?? ""}
                          onChange={(e) => setSettings((s) => (s ? { ...s, paritypayShopId: e.target.value || null } : s))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="parity-key">Секретный ключ №1 — API</Label>
                        <Input
                          id="parity-key"
                          type="password"
                          autoComplete="new-password"
                          value={settings.paritypayApiKey ?? ""}
                          onChange={(e) => setSettings((s) => (s ? { ...s, paritypayApiKey: e.target.value || null } : s))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="parity-sign">Секретный ключ №2 — подпись уведомлений</Label>
                        <Input
                          id="parity-sign"
                          type="password"
                          autoComplete="new-password"
                          value={settings.paritypaySigningSecret ?? ""}
                          onChange={(e) => setSettings((s) => (s ? { ...s, paritypaySigningSecret: e.target.value || null } : s))}
                        />
                      </div>
                    </div>
                    <label className="flex items-center gap-3 p-3.5 rounded-xl bg-card/40 border border-border cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settings.paritypayEnabled === true}
                        onChange={(e) => setSettings((s) => (s ? { ...s, paritypayEnabled: e.target.checked } : s))}
                        className="rounded border w-4 h-4"
                      />
                      <span className="text-sm font-medium">Включить ParityPay</span>
                    </label>
                    <div className="rounded-xl bg-muted/40 border border-border p-3.5">
                      <p className="text-xs text-muted-foreground">Адрес уведомлений об оплате</p>
                      <code className="text-xs break-all">{`${window.location.origin}/api/webhooks/paritypay`}</code>
                    </div>
                    <div className="pt-2 border-t">
                      <Button type="submit" disabled={saving} className="min-w-[140px]">
                        {saving ? t("admin.settings.saving") : t("admin.settings.save")}
                      </Button>
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>
            </Card>
            <CispaySettings settings={settings} onChange={patch => setSettings(s => s ? { ...s, ...patch } : s)} saving={saving} />
            <Card>
              <Collapsible defaultOpen={false} className="group">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="w-full cursor-pointer rounded-t-lg text-left transition-colors hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  >
                    <CardHeader className="pointer-events-none [&_.chevron]:transition-transform [&_.chevron]:duration-200 group-data-[state=open]:[&_.chevron]:rotate-180">
                      <div className="flex items-center justify-between pr-2">
                        <div className="flex items-center gap-2">
                          <Wallet className="h-5 w-5 text-primary" />
                          <CardTitle>RollyPay</CardTitle>
                          <span className="text-xs font-normal text-muted-foreground">СБП, карты, криптовалюта</span>
                        </div>
                        <ChevronDown className="chevron h-5 w-5 shrink-0 text-muted-foreground" />
                      </div>
                    </CardHeader>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      Приём рублёвых платежей с автоматической конвертацией в USDT. Ключи выдаются при
                      создании кассы в личном кабинете RollyPay. Способ оплаты (СБП, карта, криптовалюта)
                      клиент выбирает уже на странице RollyPay — у нас одна кнопка.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>API-ключ кассы</Label>
                        <Input
                          type="password"
                          value={settings.rollypayApiKey ?? ""}
                          onChange={(e) => setSettings((s) => (s ? { ...s, rollypayApiKey: e.target.value || null } : s))}
                          placeholder="rpk_live_…"
                        />
                        <p className="text-xs text-muted-foreground">Уходит в заголовке X-API-Key.</p>
                      </div>
                      <div className="space-y-2">
                        <Label>Секрет подписи</Label>
                        <Input
                          type="password"
                          value={settings.rollypaySigningSecret ?? ""}
                          onChange={(e) => setSettings((s) => (s ? { ...s, rollypaySigningSecret: e.target.value || null } : s))}
                          placeholder="whsec_…"
                        />
                        <p className="text-xs text-muted-foreground">
                          Проверка подписи вебхуков. Без него уведомления об оплате отвергаются — платежи не зачтутся.
                        </p>
                      </div>
                    </div>
                    <label className="flex items-center gap-3 p-3.5 rounded-xl bg-card/40 border border-border cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settings.rollypayEnabled !== false}
                        onChange={(e) => setSettings((s) => (s ? { ...s, rollypayEnabled: e.target.checked } : s))}
                        className="rounded border w-4 h-4"
                      />
                      <div className="flex-1">
                        <span className="text-sm font-medium">Включить RollyPay</span>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          Показывать RollyPay клиентам при наличии ключей кассы.
                        </p>
                      </div>
                    </label>
                    <label className="flex items-center gap-3 p-3.5 rounded-xl bg-card/40 border border-border cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settings.rollypayTestMode === true}
                        onChange={(e) => setSettings((s) => (s ? { ...s, rollypayTestMode: e.target.checked } : s))}
                        className="rounded border w-4 h-4"
                      />
                      <div className="flex-1">
                        <span className="text-sm font-medium">Тестовый режим (sandbox)</span>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          Платежи создаются с флагом test — реальные деньги не списываются.
                        </p>
                      </div>
                    </label>
                    <div className="rounded-xl bg-muted/40 border border-border p-3.5">
                      <p className="text-xs text-muted-foreground">
                        Адрес для вебхука задаётся в личном кабинете RollyPay — в запросе его передать нельзя:
                      </p>
                      <code className="text-xs break-all">{`${window.location.origin}/api/webhooks/rollypay`}</code>
                    </div>
                    <div className="pt-2 border-t">
                      <Button type="submit" disabled={saving} className="min-w-[140px]">
                        {saving ? t("admin.settings.saving") : t("admin.settings.save")}
                      </Button>
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>

              <Collapsible defaultOpen={false} className="group mt-4">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="w-full cursor-pointer rounded-t-lg text-left transition-colors hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  >
                    <CardHeader className="pointer-events-none [&_.chevron]:transition-transform [&_.chevron]:duration-200 group-data-[state=open]:[&_.chevron]:rotate-180">
                      <div className="flex items-center justify-between pr-2">
                        <div className="flex items-center gap-2">
                          <Wallet className="h-5 w-5 text-primary" />
                          <CardTitle>LAVA</CardTitle>
                          <span className="text-xs font-normal text-muted-foreground">{t("admin.settings.lava_desc_short")}</span>
                        </div>
                        <ChevronDown className="chevron h-5 w-5 shrink-0 text-muted-foreground" />
                      </div>
                      <p className="text-[12.5px] text-muted-foreground mt-[3px]">
                        {t("admin.settings.lava_register")}
                      </p>
                    </CardHeader>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="space-y-4 border-t pt-4">
                    <div className="space-y-2">
                      <Label>{t("admin.settings.lava_webhook")}</Label>
                      <div className="flex gap-2">
                        <Input
                          readOnly
                          value={(settings.publicAppUrl ?? "").replace(/\/$/, "") ? `${(settings.publicAppUrl ?? "").replace(/\/$/, "")}/api/webhooks/lava` : t("admin.settings.specify_url_hint")}
                          className="font-mono text-sm bg-muted/50"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="shrink-0"
                          onClick={async () => {
                            const url = (settings.publicAppUrl ?? "").replace(/\/$/, "") ? `${(settings.publicAppUrl ?? "").replace(/\/$/, "")}/api/webhooks/lava` : "";
                            if (url && navigator.clipboard) {
                              await navigator.clipboard.writeText(url);
                              setLavaWebhookCopied(true);
                              setTimeout(() => setLavaWebhookCopied(false), 2000);
                            }
                          }}
                          disabled={!(settings.publicAppUrl ?? "").trim()}
                          title={t("admin.settings.copy")}
                        >
                          {lavaWebhookCopied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">{t("admin.settings.lava_webhook_hint")}</p>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {t("admin.settings.lava_desc")}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>{t("admin.settings.lava_shop_id")}</Label>
                        <Input
                          value={settings.lavaShopId ?? ""}
                          onChange={(e) => setSettings((s) => (s ? { ...s, lavaShopId: e.target.value || null } : s))}
                          placeholder="00000000-0000-0000-0000-000000000000"
                        />
                        <p className="text-xs text-muted-foreground">{t("admin.settings.lava_shop_id_hint")}</p>
                      </div>
                      <div className="space-y-2">
                        <Label>{t("admin.settings.lava_secret_key")}</Label>
                        <Input
                          type="password"
                          value={settings.lavaSecretKey ?? ""}
                          onChange={(e) => setSettings((s) => (s ? { ...s, lavaSecretKey: e.target.value || null } : s))}
                          placeholder={t("admin.settings.lava_secret_key_placeholder")}
                        />
                        <p className="text-xs text-muted-foreground">{t("admin.settings.lava_secret_key_hint")}</p>
                      </div>
                      <div className="space-y-2 sm:col-span-2">
                        <Label>{t("admin.settings.lava_additional_key")}</Label>
                        <Input
                          type="password"
                          value={settings.lavaAdditionalKey ?? ""}
                          onChange={(e) => setSettings((s) => (s ? { ...s, lavaAdditionalKey: e.target.value || null } : s))}
                          placeholder={t("admin.settings.lava_additional_key_placeholder")}
                        />
                        <p className="text-xs text-muted-foreground">{t("admin.settings.lava_additional_key_hint")}</p>
                      </div>
                    </div>

                    {/*  Lava.top — отдельный провайдер, product/offer модель  */}
                    <div className="pt-4 mt-4 border-t border-dashed">
                      <h4 className="text-sm font-semibold mb-2">Lava.top (gate.lava.top)</h4>
                      <p className="text-xs text-muted-foreground mb-3">
                        Новый Lava (lava.top) — отличается от Lava Business (lava.ru). Использует продукты/офферы:
                        в ЛК Lava.top создайте продукт с одним или несколькими offer'ами, скопируйте API-ключ
                        и UUID дефолтного оффера. <a className="text-primary underline" href="https://developers.lava.top/ru" target="_blank" rel="noopener noreferrer">developers.lava.top</a> · <a className="text-primary underline" href="https://gate.lava.top/docs" target="_blank" rel="noopener noreferrer">Swagger</a>
                      </p>
                      <p className="text-xs text-muted-foreground mb-3">
                        Webhook URL: <code className="font-mono">{(settings.publicAppUrl ?? "").replace(/\/$/, "")}/api/webhooks/lavatop</code>
                        <br/>IP whitelist Lava.top для webhook'ов: <code className="font-mono">158.160.60.174</code>
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>API-ключ Lava.top</Label>
                          <Input
                            type="password"
                            value={settings.lavatopApiKey ?? ""}
                            onChange={(e) => setSettings((s) => (s ? { ...s, lavatopApiKey: e.target.value || null } : s))}
                            placeholder="********"
                          />
                          <p className="text-xs text-muted-foreground">ЛК Lava.top  Integrations  Public API</p>
                        </div>
                        <div className="space-y-2">
                          <Label>Default Offer ID (UUID)</Label>
                          <Input
                            value={settings.lavatopDefaultOfferId ?? ""}
                            onChange={(e) => setSettings((s) => (s ? { ...s, lavatopDefaultOfferId: e.target.value || null } : s))}
                            placeholder="00000000-0000-0000-0000-000000000000"
                          />
                          <p className="text-xs text-muted-foreground">UUID оффера. Используется как фолбэк если у тарифа нет своего offerId.</p>
                        </div>
                      </div>

                      {/*  Список офферов из Lava.top API  */}
                      <LavatopOffersBrowser />
                    </div>

                    <div className="pt-2 border-t">
                      <Button type="submit" disabled={saving} className="min-w-[140px]">
                        {saving ? t("admin.settings.saving") : t("admin.settings.save")}
                      </Button>
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>

              <Collapsible defaultOpen={false} className="group mt-4">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="w-full cursor-pointer rounded-t-lg text-left transition-colors hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  >
                    <CardHeader className="pointer-events-none [&_.chevron]:transition-transform [&_.chevron]:duration-200 group-data-[state=open]:[&_.chevron]:rotate-180">
                      <div className="flex items-center justify-between pr-2">
                        <div className="flex items-center gap-2">
                          <Wallet className="h-5 w-5 text-primary" />
                          <CardTitle>Overpay</CardTitle>
                          <span className="text-xs font-normal text-muted-foreground">{t("admin.settings.overpay_desc_short")}</span>
                        </div>
                        <ChevronDown className="chevron h-5 w-5 shrink-0 text-muted-foreground" />
                      </div>
                      <p className="text-[12.5px] text-muted-foreground mt-[3px]">
                        {t("admin.settings.overpay_register")}
                      </p>
                    </CardHeader>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="space-y-4 border-t pt-4">
                    <div className="space-y-2">
                      <Label>{t("admin.settings.overpay_webhook")}</Label>
                      <div className="flex gap-2">
                        <Input
                          readOnly
                          value={(settings.publicAppUrl ?? "").replace(/\/$/, "") ? `${(settings.publicAppUrl ?? "").replace(/\/$/, "")}/api/webhooks/overpay` : t("admin.settings.specify_url_hint")}
                          className="font-mono text-sm bg-muted/50"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="shrink-0"
                          onClick={async () => {
                            const url = (settings.publicAppUrl ?? "").replace(/\/$/, "") ? `${(settings.publicAppUrl ?? "").replace(/\/$/, "")}/api/webhooks/overpay` : "";
                            if (url && navigator.clipboard) {
                              await navigator.clipboard.writeText(url);
                              setOverpayWebhookCopied(true);
                              setTimeout(() => setOverpayWebhookCopied(false), 2000);
                            }
                          }}
                          disabled={!(settings.publicAppUrl ?? "").trim()}
                          title={t("admin.settings.copy")}
                        >
                          {overpayWebhookCopied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">{t("admin.settings.overpay_webhook_hint")}</p>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {t("admin.settings.overpay_desc")}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2 sm:col-span-2">
                        <Label>{t("admin.settings.overpay_api_url")}</Label>
                        <Input
                          value={settings.overpayApiUrl ?? ""}
                          onChange={(e) => setSettings((s) => (s ? { ...s, overpayApiUrl: e.target.value || null } : s))}
                          placeholder="https://api.overpay.io"
                        />
                        <p className="text-xs text-muted-foreground">{t("admin.settings.overpay_api_url_hint")}</p>
                      </div>
                      <div className="space-y-2">
                        <Label>{t("admin.settings.overpay_project_id")}</Label>
                        <Input
                          value={settings.overpayProjectId ?? ""}
                          onChange={(e) => setSettings((s) => (s ? { ...s, overpayProjectId: e.target.value || null } : s))}
                          placeholder="1234"
                        />
                        <p className="text-xs text-muted-foreground">{t("admin.settings.overpay_project_id_hint")}</p>
                      </div>
                      <div className="space-y-2">
                        <Label>{t("admin.settings.overpay_login")}</Label>
                        <Input
                          value={settings.overpayLogin ?? ""}
                          onChange={(e) => setSettings((s) => (s ? { ...s, overpayLogin: e.target.value || null } : s))}
                          placeholder="api-login"
                        />
                        <p className="text-xs text-muted-foreground">{t("admin.settings.overpay_login_hint")}</p>
                      </div>
                      <div className="space-y-2 sm:col-span-2">
                        <Label>{t("admin.settings.overpay_password")}</Label>
                        <Input
                          type="password"
                          value={settings.overpayPassword ?? ""}
                          onChange={(e) => setSettings((s) => (s ? { ...s, overpayPassword: e.target.value || null } : s))}
                          placeholder={t("admin.settings.overpay_password_placeholder")}
                        />
                        <p className="text-xs text-muted-foreground">{t("admin.settings.overpay_password_hint")}</p>
                      </div>
                    </div>
                    <div className="pt-2 border-t">
                      <Button type="submit" disabled={saving} className="min-w-[140px]">
                        {saving ? t("admin.settings.saving") : t("admin.settings.save")}
                      </Button>
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          </TabsContent>
  );
}
