import { useEffect, useState } from "react";
import { Wifi, Smartphone, Server, CreditCard, Loader2, Wallet } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { api } from "@/lib/api";
import type { PublicSellOption } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCabinetMiniapp } from "@/pages/cabinet/cabinet-layout";
import { openPaymentInBrowser } from "@/lib/open-payment-url";

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: currency.toUpperCase() === "USD" ? "USD" : currency.toUpperCase() === "RUB" ? "RUB" : "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function optionLabel(o: PublicSellOption): string {
  if (o.kind === "traffic") return `+${o.trafficGb} ГБ трафика`;
  if (o.kind === "devices") return `+${o.deviceCount} ${o.deviceCount === 1 ? "устройство" : "устройства"}`;
  if (o.kind === "servers") {
    const traffic = (o.trafficGb ?? 0) > 0 ? ` + ${o.trafficGb} ГБ` : "";
    return (o.name || "Доп. сервер") + traffic;
  }
  return "Доп. опция";
}

function optionIcon(o: PublicSellOption) {
  if (o.kind === "traffic") return <Wifi className="h-5 w-5" />;
  if (o.kind === "devices") return <Smartphone className="h-5 w-5" />;
  return <Server className="h-5 w-5" />;
}

export function ClientExtraOptionsPage() {
  const { state, refreshProfile } = useClientAuth();
  const token = state.token;
  const balance = state.client?.balance ?? 0;
  const [options, setOptions] = useState<PublicSellOption[]>([]);
  const [sellOptionsEnabled, setSellOptionsEnabled] = useState(false);
  const [plategaMethods, setPlategaMethods] = useState<{ id: number; label: string }[]>([]);
  const [yoomoneyEnabled, setYoomoneyEnabled] = useState(false);
  const [yookassaEnabled, setYookassaEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [payModal, setPayModal] = useState<PublicSellOption | null>(null);
  const [payLoading, setPayLoading] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  const isMobileOrMiniapp = useCabinetMiniapp();

  useEffect(() => {
    api.getPublicConfig().then((c) => {
      setSellOptionsEnabled(Boolean(c.sellOptionsEnabled));
      setOptions(c.sellOptions ?? []);
      setPlategaMethods(c.plategaMethods ?? []);
      setYoomoneyEnabled(Boolean(c.yoomoneyEnabled));
      setYookassaEnabled(Boolean(c.yookassaEnabled));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  async function startYookassaPayment(option: PublicSellOption) {
    if (!token) return;
    setPayError(null);
    setPayLoading(true);
    try {
      const res = await api.yookassaCreatePayment(token, {
        extraOption: { kind: option.kind, productId: option.id },
      });
      setPayModal(null);
      if (res.confirmationUrl) openPaymentInBrowser(res.confirmationUrl);
    } catch (e) {
      setPayError(e instanceof Error ? e.message : "Ошибка создания платежа");
    } finally {
      setPayLoading(false);
    }
  }

  async function startPlategaPayment(option: PublicSellOption, methodId: number) {
    if (!token) return;
    setPayError(null);
    setPayLoading(true);
    try {
      const res = await api.clientCreatePlategaPayment(token, {
        paymentMethod: methodId,
        extraOption: { kind: option.kind, productId: option.id },
      });
      setPayModal(null);
      openPaymentInBrowser(res.paymentUrl);
    } catch (e) {
      setPayError(e instanceof Error ? e.message : "Ошибка создания платежа");
    } finally {
      setPayLoading(false);
    }
  }

  async function startYoomoneyPayment(option: PublicSellOption) {
    if (!token) return;
    setPayError(null);
    setPayLoading(true);
    try {
      const res = await api.yoomoneyCreateFormPayment(token, {
        paymentType: "AC",
        extraOption: { kind: option.kind, productId: option.id },
      });
      setPayModal(null);
      if (res.paymentUrl) openPaymentInBrowser(res.paymentUrl);
    } catch (e) {
      setPayError(e instanceof Error ? e.message : "Ошибка создания платежа");
    } finally {
      setPayLoading(false);
    }
  }

  async function startBalancePayment(option: PublicSellOption) {
    if (!token) return;
    if (balance < option.price) {
      setPayError("Недостаточно средств на балансе");
      return;
    }
    setPayError(null);
    setPayLoading(true);
    try {
      await api.clientPayOptionByBalance(token, { extraOption: { kind: option.kind, productId: option.id } });
      setPayModal(null);
      await refreshProfile();
      setPayError(null);
    } catch (e) {
      setPayError(e instanceof Error ? e.message : "Ошибка оплаты с баланса");
    } finally {
      setPayLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!sellOptionsEnabled || options.length === 0) {
    return (
      <div className="space-y-6 w-full min-w-0">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Доп. опции</h1>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {!sellOptionsEnabled
              ? "Продажа доп. опций отключена."
              : "Дополнительные опции пока не настроены. Оформите подписку в разделе «Тарифы», затем здесь можно будет докупить трафик, устройства или серверы."}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 w-full min-w-0 overflow-hidden">
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight truncate">Доп. опции</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Доп. трафик, устройства или серверы — применяются к вашей подписке после оплаты.
        </p>
      </div>

      <div className={isMobileOrMiniapp ? "space-y-3" : "grid gap-4 sm:grid-cols-2"}>
        {options.map((opt) => (
          <Card key={`${opt.kind}-${opt.id}`} className="overflow-hidden">
            <CardContent className="p-3 sm:p-4 flex flex-row items-center justify-between gap-2 sm:gap-4 min-w-0">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                <span className="flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  {optionIcon(opt)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate text-sm sm:text-base">{opt.name || optionLabel(opt)}</p>
                  {!isMobileOrMiniapp && <p className="text-sm text-muted-foreground">{optionLabel(opt)}</p>}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="font-semibold text-sm sm:text-base tabular-nums whitespace-nowrap">{formatMoney(opt.price, opt.currency)}</span>
                <Button onClick={() => setPayModal(opt)} size="sm" className="gap-1.5 shrink-0">
                  <CreditCard className="h-4 w-4" />
                  Купить
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={!!payModal} onOpenChange={(open) => !open && setPayModal(null)}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto pb-[env(safe-area-inset-bottom)]">
          <DialogHeader>
            <DialogTitle>Способ оплаты</DialogTitle>
            <DialogDescription>
              {payModal && (
                <>
                  {payModal.name || optionLabel(payModal)} — {formatMoney(payModal.price, payModal.currency)}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-2">
            {payModal && balance >= payModal.price && (
              <Button onClick={() => startBalancePayment(payModal)} disabled={payLoading} variant="default" className="w-full gap-2" type="button">
                {payLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
                Оплатить с баланса ({formatMoney(balance, payModal.currency)})
              </Button>
            )}
            {yookassaEnabled && payModal && (
              <Button onClick={() => startYookassaPayment(payModal)} disabled={payLoading} className="w-full gap-2">
                {payLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Карта / СБП (ЮKassa)
              </Button>
            )}
            {yoomoneyEnabled && payModal && (
              <Button variant="outline" onClick={() => startYoomoneyPayment(payModal)} disabled={payLoading} className="w-full gap-2">
                {payLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                ЮMoney (карта)
              </Button>
            )}
            {plategaMethods.map((m) => payModal && (
              <Button key={m.id} variant="outline" onClick={() => startPlategaPayment(payModal, m.id)} disabled={payLoading} className="w-full">
                {m.label}
              </Button>
            ))}
          </div>
          {payError && <p className="text-sm text-destructive">{payError}</p>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPayModal(null)}>Отмена</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
