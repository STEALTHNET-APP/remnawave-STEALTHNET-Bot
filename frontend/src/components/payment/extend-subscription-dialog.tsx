/**
 * красивая модалка продления подписки прямо из дашборда.
 *
 * Раньше «Продлить» уводила юзера в каталог тарифов (?extend=...) — дёргано и
 * неочевидно. Теперь продление — это один диалог: срок  доп. устройства 
 * способ оплаты, без ухода со страницы.
 *
 * Компонент самодостаточен: по subId сам загружает подписку (clientAllSubscriptions),
 * её тариф (getPublicTariffs) и платёжный конфиг (getPublicConfig). Оплата уходит
 * с extendsSecondarySubId — единый механизм для ЛЮБОЙ подписки (включая index 0).
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Wallet, CreditCard, Loader2, Calendar, Smartphone } from "lucide-react";
import { api, type PublicConfig, type PublicTariffCategory } from "@/lib/api";
import { useClientAuth } from "@/contexts/client-auth";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PayNowPanel } from "@/components/payment/pay-now-panel";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { formatRuDays } from "@/lib/i18n";

const EXTRA_DEVICE_BASE_DAYS = 30;

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: currency.toUpperCase() === "RUB" ? "RUB" : "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

interface SubData {
  id: string;
  index: number;
  label: string;
  tariffId: string | null;
  extraDevices: number;
  extraDevicesMonthlyPrice: number;
  expireAt: string | null;
}

interface TariffData {
  id: string;
  name: string;
  price: number;
  currency: string;
  durationDays: number;
  priceOptions: { id: string; durationDays: number; price: number }[];
}

export function ExtendSubscriptionDialog({
  subId,
  open,
  onClose,
  onPaidByBalance,
}: {
  subId: string;
  open: boolean;
  onClose: () => void;
  /** Балансовая оплата мгновенна — родитель обновляет данные дашборда. */
  onPaidByBalance?: () => void;
}) {
  const { state, refreshProfile } = useClientAuth();
  const token = state.token;
  const client = state.client;
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [sub, setSub] = useState<SubData | null>(null);
  const [tariff, setTariff] = useState<TariffData | null>(null);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [keepExtras, setKeepExtras] = useState(true);
  const [payLoading, setPayLoading] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [readyUrl, setReadyUrl] = useState<{ url: string; provider: string; paymentId?: string } | null>(null);

  // Загрузка: подписка + её тариф + платёжный конфиг.
  useEffect(() => {
    if (!open || !token) return;
    let alive = true;
    setLoading(true);
    setPayError(null);
    setReadyUrl(null);
    Promise.all([
      api.clientAllSubscriptions(token).catch((): { items: [] } => ({ items: [] })),
      api.getPublicTariffs().catch((): { items: PublicTariffCategory[] } => ({ items: [] })),
      api.getPublicConfig().catch(() => null),
    ]).then(([all, tariffsRes, cfg]) => {
      if (!alive) return;
      const it = (all.items ?? []).find((s) => s.id === subId) ?? null;
      if (it) {
        const idx = it.subscriptionIndex ?? 0;
        setSub({
          id: it.id,
          index: idx,
          label: it.tariffDisplayName?.trim() || `Подписка #${idx}`,
          tariffId: it.tariffId ?? null,
          extraDevices: it.extraDevices ?? 0,
          extraDevicesMonthlyPrice: it.extraDevicesMonthlyPrice ?? 0,
          expireAt: (() => {
            const raw = it.subscription as Record<string, unknown> | null;
            const payload = (raw && typeof raw === "object" && raw.response && typeof raw.response === "object")
              ? (raw.response as Record<string, unknown>)
              : raw;
            return payload && typeof payload.expireAt === "string" ? payload.expireAt : null;
          })(),
        });
        const t = (tariffsRes.items ?? []).flatMap((c) => c.tariffs).find((tf) => tf.id === it.tariffId) ?? null;
        if (t) {
          setTariff({
            id: t.id,
            name: t.name,
            price: t.price,
            currency: t.currency,
            durationDays: t.durationDays,
            priceOptions: (t.priceOptions ?? []).map((o) => ({ id: o.id, durationDays: o.durationDays, price: o.price })),
          });
          const opts = t.priceOptions ?? [];
          const def = opts.find((o) => o.durationDays === 30) ?? opts[0];
          setSelectedOptionId(def?.id ?? null);
        } else {
          setTariff(null);
        }
      } else {
        setSub(null);
      }
      setConfig(cfg);
      setKeepExtras(true);
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, token, subId]);

  const option = tariff?.priceOptions.find((o) => o.id === selectedOptionId) ?? null;
  const days = option?.durationDays ?? tariff?.durationDays ?? 30;
  const unitPrice = option?.price ?? tariff?.price ?? 0;
  // Доплата за СОХРАНЯЕМЫЕ доп. устройства (цена хранится за 30 дней — масштабируем).
  const extrasCost = sub && keepExtras && sub.extraDevices > 0
    ? Math.round(sub.extraDevicesMonthlyPrice * (Math.max(1, days) / EXTRA_DEVICE_BASE_DAYS))
    : 0;
  const total = unitPrice + extrasCost;
  const currency = tariff?.currency ?? "RUB";
  const hasBalance = (client?.balance ?? 0) >= total && total > 0;

  // Общие поля платёжного запроса: продление ИМЕННО этой подписки.
  const payBase = useMemo(() => ({
    tariffId: tariff?.id,
    tariffPriceOptionId: option?.id,
    extendsSecondarySubId: subId,
    removeExtrasOnActivate: sub && sub.extraDevices > 0 ? !keepExtras : undefined,
  }), [tariff?.id, option?.id, subId, keepExtras, sub]);

  async function payWith(providerId: string) {
    if (!token || !tariff) return;
    setPayLoading(true);
    setPayError(null);
    try {
      if (providerId === "balance") {
        await api.clientPayByBalance(token, payBase);
        await refreshProfile();
        toast.success("Подписка продлена ", `${sub?.label ?? "Подписка"} продлена на ${formatRuDays(days)}.`);
        onPaidByBalance?.();
        onClose();
        return;
      }
      let url: string | null = null;
      let paymentId: string | undefined;
      let providerLabel = providerId;
      if (providerId.startsWith("platega:")) {
        const methodId = Number(providerId.slice("platega:".length));
        const r = await api.clientCreatePlategaPayment(token, { ...payBase, paymentMethod: methodId });
        url = r.paymentUrl; paymentId = r.paymentId; providerLabel = "Platega";
      } else if (providerId === "yookassa") {
        const r = await api.yookassaCreatePayment(token, payBase);
        url = r.confirmationUrl; paymentId = r.paymentId; providerLabel = "ЮKassa";
      } else if (providerId === "yoomoney") {
        const r = await api.yoomoneyCreateFormPayment(token, { ...payBase, paymentType: "AC" });
        url = r.paymentUrl; paymentId = r.paymentId; providerLabel = "ЮMoney";
      } else if (providerId === "cryptopay") {
        const r = await api.cryptopayCreatePayment(token, payBase);
        url = r.miniAppPayUrl ?? r.webAppPayUrl ?? r.payUrl; paymentId = r.paymentId; providerLabel = "Crypto Bot";
      } else if (providerId === "heleket") {
        const r = await api.heleketCreatePayment(token, payBase);
        url = r.payUrl;
      } else if (providerId === "rollypay") {
        const r = await api.rollypayCreatePayment(token, payBase);
        url = r.payUrl; paymentId = r.paymentId; providerLabel = "Heleket";
      } else if (providerId === "lava") {
        const r = await api.lavaCreatePayment(token, payBase);
        url = r.payUrl; paymentId = r.paymentId; providerLabel = "LAVA";
      } else if (providerId === "lavatop") {
        const r = await api.lavatopCreatePayment(token, payBase);
        url = r.payUrl; paymentId = r.paymentId; providerLabel = "Lava.top";
      } else if (providerId === "overpay") {
        const r = await api.overpayCreatePayment(token, payBase);
        url = r.payUrl; paymentId = r.paymentId; providerLabel = "Overpay";
      }
      if (url) setReadyUrl({ url, provider: providerLabel, paymentId });
    } catch (e) {
      setPayError(e instanceof Error ? e.message : "Ошибка создания платежа");
    } finally {
      setPayLoading(false);
    }
  }

  // Список включённых провайдеров в порядке из админки (paymentProviders).
  const providers = useMemo(() => {
    if (!config) return [] as { id: string; label: string }[];
    const isRub = currency.toUpperCase() === "RUB";
    const list: { id: string; label: string }[] = [];
    (config.plategaMethods ?? []).forEach((m) => list.push({ id: `platega:${m.id}`, label: m.label }));
    const label = (id: string, fb: string) => config.paymentProviders?.find((p) => p.id === id)?.label || fb;
    const flags: { id: string; enabled: boolean; fb: string }[] = [
      { id: "cryptopay", enabled: Boolean(config.cryptopayEnabled), fb: "Crypto Bot" },
      { id: "heleket", enabled: Boolean(config.heleketEnabled), fb: "Heleket" },
      { id: "rollypay", enabled: Boolean(config.rollypayEnabled), fb: "RollyPay" },
      { id: "yookassa", enabled: Boolean(config.yookassaEnabled) && isRub, fb: "СБП / Карты РФ" },
      { id: "yoomoney", enabled: Boolean(config.yoomoneyEnabled) && isRub, fb: "ЮMoney" },
      { id: "lava", enabled: Boolean(config.lavaEnabled) && isRub, fb: "LAVA" },
      { id: "lavatop", enabled: Boolean(config.lavatopEnabled), fb: "Lava.top" },
      { id: "overpay", enabled: Boolean(config.overpayEnabled), fb: "Overpay" },
    ];
    const enabled = flags.filter((f) => f.enabled).map((f) => ({ id: f.id, label: label(f.id, f.fb) }));
    // Сортировка по paymentProviders (как в каталоге), неизвестные — в конец.
    const order = (config.paymentProviders ?? []).map((p) => p.id);
    enabled.sort((a, b) => {
      const ia = order.indexOf(a.id); const ib = order.indexOf(b.id);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
    return [...list, ...enabled];
  }, [config, currency]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !payLoading) onClose(); }}>
      <DialogContent className="bg-card border-border rounded-2xl max-w-md max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[15px] font-bold">
            <div className="min-w-0">
              <span className="block">Продление подписки</span>
              {sub && <span className="block text-xs font-normal text-muted-foreground truncate">{sub.label}</span>}
            </div>
          </DialogTitle>
          <DialogDescription className="sr-only">Выбор срока и способа оплаты продления</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : !sub || !tariff ? (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.07] p-4 text-sm text-amber-500/90">
            Тариф этой подписки недоступен для продления из каталога. Откройте раздел «Тарифы» и выберите подходящий.
          </div>
        ) : readyUrl ? (
          <PayNowPanel
            url={readyUrl.url}
            provider={readyUrl.provider}
            onBack={() => setReadyUrl(null)}
            onPaid={() => {
              const pid = readyUrl.paymentId;
              const u = readyUrl.url, prov = readyUrl.provider;
              onClose();
              if (pid) navigate(`/cabinet/payment-wait?id=${encodeURIComponent(pid)}&kind=tariff`, { state: { url: u, provider: prov } });
            }}
            compact
          />
        ) : (
          <div className="space-y-5">
            {/* Срок продления */}
            {tariff.priceOptions.length > 1 && (
              <div className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 text-primary" /> Срок продления
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {[...tariff.priceOptions].sort((a, b) => a.durationDays - b.durationDays).map((o) => {
                    const active = o.id === selectedOptionId;
                    return (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => setSelectedOptionId(o.id)}
                        className={cn(
                          "rounded-xl border p-3 text-left transition-all duration-200",
                          active
                            ? "border-border bg-primary/10 shadow-primary/40"
                            : "border-border bg-white/[0.03] hover:border-border",
                        )}
                      >
                        <p className="text-sm font-bold">{formatRuDays(o.durationDays)}</p>
                        <p className={cn("text-xs", active ? "text-primary" : "text-muted-foreground")}>
                          {formatMoney(o.price, currency)}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Доп. устройства подписки */}
            {sub.extraDevices > 0 && (
              <button
                type="button"
                onClick={() => setKeepExtras((v) => !v)}
                className={cn(
                  "w-full text-left rounded-xl border p-4 transition-all duration-300",
                  keepExtras ? "bg-primary/[0.07] border-border" : "bg-white/[0.03] border-border hover:border-border",
                )}
              >
                <div className="flex items-start gap-3">
                  <div className={cn(
                    "mt-0.5 h-5 w-9 rounded-full p-0.5 transition-colors duration-300 shrink-0",
                    keepExtras ? "bg-primary" : "bg-card",
                  )}>
                    <div className={cn(
                      "h-4 w-4 rounded-full bg-white shadow transition-transform duration-300",
                      keepExtras ? "translate-x-4" : "translate-x-0",
                    )} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold flex items-center gap-1.5">
                      <Smartphone className="h-3.5 w-3.5 text-primary" />
                      Сохранить +{sub.extraDevices} доп. устройств
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {keepExtras
                        ? `Доплата ${formatMoney(extrasCost, currency)} за ${formatRuDays(days)}`
                        : "Устройства будут отключены — продление по базовой цене"}
                    </p>
                  </div>
                </div>
              </button>
            )}

            {/* Итого */}
            <div className="rounded-xl bg-white/[0.04] border border-border px-4 py-3 flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Итого за {formatRuDays(days)}:</span>
              <span className="text-xl font-black text-primary tabular-nums">{formatMoney(total, currency)}</span>
            </div>

            {payError && (
              <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-center text-sm font-bold text-destructive">
                {payError}
              </div>
            )}

            {/* Способы оплаты */}
            <div className="space-y-2.5">
              {client && (
                <Button
                  size="lg"
                  disabled={payLoading || !hasBalance}
                  onClick={() => payWith("balance")}
                  className="w-full h-14 justify-between rounded-xl bg-primary border-0 px-5"
                >
                  <span className="flex items-center gap-2.5 font-bold">
                    {payLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Wallet className="h-5 w-5" />}
                    С баланса
                  </span>
                  <span className="font-mono text-sm bg-black/20 px-2 py-0.5 rounded-lg">
                    {formatMoney(client.balance, currency)}
                  </span>
                </Button>
              )}
              {providers.map((p) => (
                <Button
                  key={p.id}
                  size="lg"
                  variant="outline"
                  disabled={payLoading}
                  onClick={() => payWith(p.id)}
                  className="w-full h-14 justify-start gap-3 rounded-xl border-border bg-white/[0.03] hover:bg-white/[0.07] px-5"
                >
                  <span className="p-1.5 rounded-xl bg-primary/10">
                    <CreditCard className="h-4 w-4 text-primary" />
                  </span>
                  <span className="font-bold text-sm">{p.label}</span>
                </Button>
              ))}
              {providers.length === 0 && !client && (
                <p className="text-center text-xs text-muted-foreground">Способы оплаты не настроены.</p>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
