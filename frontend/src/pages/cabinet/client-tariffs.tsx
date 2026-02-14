import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Package, Calendar, Wifi, Smartphone, CreditCard, Loader2, Gift, Tag, Check, Wallet } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { api } from "@/lib/api";
import type { PublicTariffCategory } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: currency.toUpperCase() === "USD" ? "USD" : currency.toUpperCase() === "RUB" ? "RUB" : "UAH",
  }).format(amount);
}

type TariffForPay = { id: string; name: string; price: number; currency: string };

export function ClientTariffsPage() {
  const { state, refreshProfile } = useClientAuth();
  const token = state.token;
  const client = state.client;
  const [tariffs, setTariffs] = useState<PublicTariffCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [plategaMethods, setPlategaMethods] = useState<{ id: number; label: string }[]>([]);
  const [yoomoneyEnabled, setYoomoneyEnabled] = useState(false);
  const [trialConfig, setTrialConfig] = useState<{ trialEnabled: boolean; trialDays: number }>({ trialEnabled: false, trialDays: 0 });
  const [payModal, setPayModal] = useState<{ tariff: TariffForPay } | null>(null);
  const [payLoading, setPayLoading] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [trialLoading, setTrialLoading] = useState(false);
  const [trialError, setTrialError] = useState<string | null>(null);

  // Промокод
  const [promoInput, setPromoInput] = useState("");
  const [promoChecking, setPromoChecking] = useState(false);
  const [promoResult, setPromoResult] = useState<{ type: string; discountPercent?: number | null; discountFixed?: number | null; name: string } | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);

  const showTrial = trialConfig.trialEnabled && !client?.trialUsed;

  useEffect(() => {
    api.getPublicTariffs().then((r) => {
      setTariffs(r.items ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    api.getPublicConfig().then((c) => {
      setPlategaMethods(c.plategaMethods ?? []);
      setYoomoneyEnabled(Boolean(c.yoomoneyEnabled));
      setTrialConfig({ trialEnabled: !!c.trialEnabled, trialDays: c.trialDays ?? 0 });
    }).catch(() => {});
  }, []);

  async function activateTrial() {
    if (!token) return;
    setTrialError(null);
    setTrialLoading(true);
    try {
      await api.clientActivateTrial(token);
      await refreshProfile();
    } catch (e) {
      setTrialError(e instanceof Error ? e.message : "Ошибка активации триала");
    } finally {
      setTrialLoading(false);
    }
  }

  async function checkPromo() {
    if (!token || !promoInput.trim()) return;
    setPromoChecking(true);
    setPromoError(null);
    setPromoResult(null);
    try {
      const res = await api.clientCheckPromoCode(token, promoInput.trim());
      if (res.type === "DISCOUNT") {
        setPromoResult(res);
      } else {
        // FREE_DAYS — активируем сразу
        const activateRes = await api.clientActivatePromoCode(token, promoInput.trim());
        setPromoError(null);
        setPromoResult(null);
        setPromoInput("");
        setPayModal(null);
        alert(activateRes.message);
        await refreshProfile();
        return;
      }
    } catch (e) {
      setPromoError(e instanceof Error ? e.message : "Ошибка");
      setPromoResult(null);
    } finally {
      setPromoChecking(false);
    }
  }

  function getDiscountedPrice(price: number): number {
    if (!promoResult) return price;
    let final = price;
    if (promoResult.discountPercent && promoResult.discountPercent > 0) {
      final -= final * promoResult.discountPercent / 100;
    }
    if (promoResult.discountFixed && promoResult.discountFixed > 0) {
      final -= promoResult.discountFixed;
    }
    return Math.max(0, Math.round(final * 100) / 100);
  }

  async function startPayment(tariff: TariffForPay, methodId: number) {
    if (!token) return;
    setPayError(null);
    setPayLoading(true);
    try {
      const finalPrice = promoResult ? getDiscountedPrice(tariff.price) : tariff.price;
      const res = await api.clientCreatePlategaPayment(token, {
        amount: finalPrice,
        currency: tariff.currency,
        paymentMethod: methodId,
        description: tariff.name,
        tariffId: tariff.id,
        promoCode: promoResult ? promoInput.trim() : undefined,
      });
      setPayModal(null);
      setPromoInput("");
      setPromoResult(null);
      window.location.href = res.paymentUrl;
    } catch (e) {
      setPayError(e instanceof Error ? e.message : "Ошибка создания платежа");
    } finally {
      setPayLoading(false);
    }
  }

  async function payByBalance(tariff: TariffForPay) {
    if (!token) return;
    setPayError(null);
    setPayLoading(true);
    try {
      const res = await api.clientPayByBalance(token, {
        tariffId: tariff.id,
        promoCode: promoResult ? promoInput.trim() : undefined,
      });
      setPayModal(null);
      setPromoInput("");
      setPromoResult(null);
      alert(res.message);
      await refreshProfile();
    } catch (e) {
      setPayError(e instanceof Error ? e.message : "Ошибка оплаты");
    } finally {
      setPayLoading(false);
    }
  }

  /** Оплата тарифа ЮMoney (картой). Только для тарифов в рублях. */
  async function startYoomoneyPayment(tariff: TariffForPay) {
    if (!token) return;
    if (tariff.currency.toUpperCase() !== "RUB") {
      setPayError("ЮMoney принимает только рубли. Выберите тариф в RUB или оплатите картой Platega.");
      return;
    }
    setPayError(null);
    setPayLoading(true);
    try {
      const amount = promoResult ? getDiscountedPrice(tariff.price) : tariff.price;
      const res = await api.yoomoneyCreateFormPayment(token, {
        amount,
        paymentType: "AC",
        tariffId: tariff.id,
      });
      setPayModal(null);
      setPromoInput("");
      setPromoResult(null);
      if (res.paymentUrl) window.location.href = res.paymentUrl;
    } catch (e) {
      setPayError(e instanceof Error ? e.message : "Ошибка создания платежа");
    } finally {
      setPayLoading(false);
    }
  }

  return (
    <div className={`space-y-6 w-full min-w-0 overflow-hidden`}>
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight truncate">Тарифы</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Выберите подходящий тариф и оплатите.
        </p>
      </div>

      {showTrial && (
        <Card className="border-green-500/30 bg-green-500/5">
          <CardContent className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pt-6">
            <div className="flex items-center gap-3">
              <Gift className="h-10 w-10 text-green-600 shrink-0" />
              <div>
                <p className="font-semibold">Попробовать бесплатно</p>
                <p className="text-sm text-muted-foreground">
                  {trialConfig.trialDays > 0 ? `${trialConfig.trialDays} дней триала без оплаты` : "Триал без оплаты"}
                </p>
              </div>
            </div>
            <Button
              className="bg-green-600 hover:bg-green-700 shrink-0"
              onClick={activateTrial}
              disabled={trialLoading}
            >
              {trialLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Активировать триал
            </Button>
          </CardContent>
          {trialError && <p className="text-sm text-destructive px-6 pb-4">{trialError}</p>}
        </Card>
      )}

      {loading ? (
        <p className="text-muted-foreground">Загрузка…</p>
      ) : tariffs.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Тарифы пока не опубликованы. Обратитесь в поддержку.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {tariffs.map((cat, catIndex) => (
            <motion.section
              key={cat.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: catIndex * 0.05 }}
            >
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Package className="h-5 w-5 text-primary" />
                {cat.name}
              </h2>
              <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                {cat.tariffs.map((t) => (
                  <Card key={t.id} className="flex flex-col">
                    <CardContent className="flex-1 space-y-2 pt-4 pb-4 px-4 sm:pt-6 sm:pb-6 sm:px-6">
                      <p className="text-base font-semibold">{t.name}</p>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs sm:text-sm text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          <Calendar className="h-3.5 w-3.5 shrink-0" />
                          {t.durationDays} дн.
                        </span>
                        <span className="flex items-center gap-1.5">
                          <Wifi className="h-3.5 w-3.5 shrink-0" />
                          {t.trafficLimitBytes != null && t.trafficLimitBytes > 0
                            ? `${(t.trafficLimitBytes / 1024 / 1024 / 1024).toFixed(1)} ГБ`
                            : "∞ трафик"}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <Smartphone className="h-3.5 w-3.5 shrink-0" />
                          {t.deviceLimit != null && t.deviceLimit > 0
                            ? `${t.deviceLimit} устр.`
                            : "∞ устр."}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3 pt-2 border-t">
                        <p className="text-lg sm:text-xl font-semibold">
                          {formatMoney(t.price, t.currency)}
                        </p>
                        {token ? (
                          <Button
                            size="sm"
                            className="gap-1.5 shrink-0"
                            onClick={() => setPayModal({ tariff: { id: t.id, name: t.name, price: t.price, currency: t.currency } })}
                          >
                            <CreditCard className="h-3.5 w-3.5" />
                            Оплатить
                          </Button>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            Оплатить в боте
                          </p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </motion.section>
          ))}
        </div>
      )}

      <Dialog open={!!payModal} onOpenChange={(open) => { if (!open && !payLoading) { setPayModal(null); setPromoInput(""); setPromoResult(null); setPromoError(null); } }}>
        <DialogContent className="max-w-sm" showCloseButton={!payLoading} onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Способ оплаты</DialogTitle>
            <DialogDescription>
              {payModal ? (
                promoResult ? (
                  <>
                    {payModal.tariff.name} — <span className="line-through text-muted-foreground">{formatMoney(payModal.tariff.price, payModal.tariff.currency)}</span>{" "}
                    <span className="text-green-600 font-semibold">{formatMoney(getDiscountedPrice(payModal.tariff.price), payModal.tariff.currency)}</span>
                  </>
                ) : (
                  `${payModal.tariff.name} — ${formatMoney(payModal.tariff.price, payModal.tariff.currency)}`
                )
              ) : ""}
            </DialogDescription>
          </DialogHeader>

          {/* Промокод */}
          <div className="border rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Tag className="h-4 w-4 text-muted-foreground" /> Промокод
            </div>
            <div className="flex gap-2">
              <Input
                value={promoInput}
                onChange={(e) => { setPromoInput(e.target.value); if (promoResult) { setPromoResult(null); setPromoError(null); } }}
                placeholder="Введите промокод"
                className="font-mono text-sm"
                disabled={payLoading || promoChecking}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={checkPromo}
                disabled={!promoInput.trim() || payLoading || promoChecking}
                className="shrink-0"
              >
                {promoChecking ? <Loader2 className="h-4 w-4 animate-spin" /> : "Применить"}
              </Button>
            </div>
            {promoResult && (
              <p className="text-xs text-green-600 flex items-center gap-1">
                <Check className="h-3 w-3" />
                {promoResult.name}: скидка {promoResult.discountPercent ? `${promoResult.discountPercent}%` : ""}{promoResult.discountFixed ? ` ${promoResult.discountFixed}` : ""}
              </p>
            )}
            {promoError && <p className="text-xs text-destructive">{promoError}</p>}
          </div>

          <div className="flex flex-col gap-2 py-2">
            {/* Оплата балансом */}
            {payModal && client && (() => {
              const price = promoResult ? getDiscountedPrice(payModal.tariff.price) : payModal.tariff.price;
              const hasBalance = client.balance >= price;
              return (
                <Button
                  variant={hasBalance ? "default" : "outline"}
                  className="justify-start gap-2"
                  disabled={payLoading || !hasBalance}
                  onClick={() => payByBalance(payModal.tariff)}
                >
                  {payLoading ? <Loader2 className="h-4 w-4 animate-spin shrink-0" /> : <Wallet className="h-4 w-4 shrink-0" />}
                  Оплатить балансом ({formatMoney(client.balance, payModal.tariff.currency)})
                </Button>
              );
            })()}

            {/* ЮMoney — только для тарифов в рублях */}
            {payModal && yoomoneyEnabled && payModal.tariff.currency.toUpperCase() === "RUB" && (
              <Button
                variant="outline"
                className="justify-start gap-2"
                disabled={payLoading}
                onClick={() => startYoomoneyPayment(payModal.tariff)}
              >
                {payLoading ? <Loader2 className="h-4 w-4 animate-spin shrink-0" /> : <CreditCard className="h-4 w-4 shrink-0" />}
                ЮMoney — оплата картой
              </Button>
            )}

            {/* Platega */}
            {payModal && plategaMethods.map((m) => (
              <Button
                key={m.id}
                variant="outline"
                className="justify-start"
                disabled={payLoading}
                onClick={() => startPayment(payModal.tariff, m.id)}
              >
                {payLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2 shrink-0" /> : null}
                {m.label}
              </Button>
            ))}
          </div>
          {payError && <p className="text-sm text-destructive">{payError}</p>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setPayModal(null); setPromoInput(""); setPromoResult(null); setPromoError(null); }} disabled={payLoading}>
              Отмена
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
