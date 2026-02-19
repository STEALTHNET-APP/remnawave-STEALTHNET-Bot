import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Package, Calendar, Wifi, Smartphone, CreditCard, Loader2, Gift, Tag, Check, Wallet, ChevronDown } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { api } from "@/lib/api";
import type { PublicTariffCategory } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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

type TariffForPay = { id: string; name: string; price: number; currency: string };

export function ClientTariffsPage() {
  const { state, refreshProfile } = useClientAuth();
  const token = state.token;
  const client = state.client;
  const [tariffs, setTariffs] = useState<PublicTariffCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [plategaMethods, setPlategaMethods] = useState<{ id: number; label: string }[]>([]);
  const [yoomoneyEnabled, setYoomoneyEnabled] = useState(false);
  const [yookassaEnabled, setYookassaEnabled] = useState(false);
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

  const isMobileOrMiniapp = useCabinetMiniapp();
  // В мини-аппе/мобиле один и тот же вид: карточка категории + список тарифов (и для 1, и для нескольких категорий)
  const useCategoryCardLayout = isMobileOrMiniapp;
  const [expandedCategoryId, setExpandedCategoryId] = useState<string | null>(null);

  // По умолчанию открыта первая категория (мобильная/мини-апп)
  useEffect(() => {
    if (useCategoryCardLayout && tariffs.length > 0) {
      setExpandedCategoryId((prev) => (prev === null ? tariffs[0].id : prev));
    }
  }, [useCategoryCardLayout, tariffs]);

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
      setYookassaEnabled(Boolean(c.yookassaEnabled));
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
      openPaymentInBrowser(res.paymentUrl);
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
      if (res.paymentUrl) openPaymentInBrowser(res.paymentUrl);
    } catch (e) {
      setPayError(e instanceof Error ? e.message : "Ошибка создания платежа");
    } finally {
      setPayLoading(false);
    }
  }

  /** Оплата тарифа ЮKassa API (карта, СБП и др.). Только RUB. */
  async function startYookassaPayment(tariff: TariffForPay) {
    if (!token) return;
    if (tariff.currency.toUpperCase() !== "RUB") {
      setPayError("ЮKassa принимает только рубли (RUB).");
      return;
    }
    setPayError(null);
    setPayLoading(true);
    try {
      const amount = promoResult ? getDiscountedPrice(tariff.price) : tariff.price;
      const res = await api.yookassaCreatePayment(token, {
        amount,
        currency: "RUB",
        tariffId: tariff.id,
        promoCode: promoResult ? promoInput.trim() : undefined,
      });
      setPayModal(null);
      setPromoInput("");
      setPromoResult(null);
      if (res.confirmationUrl) openPaymentInBrowser(res.confirmationUrl);
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
      ) : useCategoryCardLayout ? (
        <div className="space-y-1">
          {tariffs.map((cat, catIndex) => (
            <Collapsible
              key={cat.id}
              open={expandedCategoryId === cat.id}
              onOpenChange={(open) => setExpandedCategoryId(open ? cat.id : null)}
            >
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: catIndex * 0.03 }}
                className="rounded-xl border bg-card overflow-hidden"
              >
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left hover:bg-muted/50 active:bg-muted transition-colors"
                  >
                    <span className="flex items-center gap-2 font-semibold">
                      <Package className="h-4 w-4 text-primary shrink-0" />
                      {cat.name}
                    </span>
                    <ChevronDown
                      className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200 ${expandedCategoryId === cat.id ? "rotate-180" : ""}`}
                    />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-2 pb-3 pt-1 flex flex-col gap-2">
                    {cat.tariffs.map((t) => (
                      <Card key={t.id} className="overflow-hidden">
                        <CardContent className="flex flex-row items-center gap-3 py-2.5 px-3 min-h-0 min-w-0">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold leading-tight truncate">{t.name}</p>
                            {t.description?.trim() ? (
                              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{t.description}</p>
                            ) : null}
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Calendar className="h-3 w-3 shrink-0 opacity-70" />
                                {t.durationDays} дн.
                              </span>
                              <span className="flex items-center gap-1">
                                <Wifi className="h-3 w-3 shrink-0 opacity-70" />
                                {t.trafficLimitBytes != null && t.trafficLimitBytes > 0 ? `${(t.trafficLimitBytes / 1024 / 1024 / 1024).toFixed(1)} ГБ` : "∞"}
                              </span>
                              <span className="flex items-center gap-1">
                                <Smartphone className="h-3 w-3 shrink-0 opacity-70" />
                                {t.deviceLimit != null && t.deviceLimit > 0 ? `${t.deviceLimit}` : "∞"} устр.
                              </span>
                            </div>
                          </div>
                          <div className="flex flex-col items-center gap-1 shrink-0">
                            <span className="text-sm font-semibold tabular-nums whitespace-nowrap" title={formatMoney(t.price, t.currency)}>
                              {formatMoney(t.price, t.currency)}
                            </span>
                            {token ? (
                              <Button
                                size="sm"
                                className="h-7 px-2.5 text-xs gap-1 w-full"
                                onClick={() => setPayModal({ tariff: { id: t.id, name: t.name, price: t.price, currency: t.currency } })}
                              >
                                <CreditCard className="h-3 w-3 shrink-0" />
                                Оплатить
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">В боте</span>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </CollapsibleContent>
              </motion.div>
            </Collapsible>
          ))}
        </div>
      ) : (
        <div className="space-y-8">
          {tariffs.map((cat, catIndex) => (
            <motion.section
              key={cat.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: catIndex * 0.05 }}
            >
              <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
                <Package className="h-4 w-4 text-primary shrink-0" />
                {cat.name}
              </h2>
              <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-4">
                {cat.tariffs.map((t) => (
                  <Card key={t.id} className="flex flex-col overflow-hidden">
                    <CardContent className="flex-1 flex flex-col p-4 min-h-0 min-w-0 overflow-hidden">
                      <p className="text-sm font-semibold leading-tight line-clamp-2">{t.name}</p>
                      {t.description?.trim() ? (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{t.description}</p>
                      ) : null}
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3 shrink-0 opacity-70" />
                          {t.durationDays} дн.
                        </span>
                        <span className="flex items-center gap-1">
                          <Wifi className="h-3 w-3 shrink-0 opacity-70" />
                          {t.trafficLimitBytes != null && t.trafficLimitBytes > 0
                            ? `${(t.trafficLimitBytes / 1024 / 1024 / 1024).toFixed(1)} ГБ`
                            : "∞ трафик"}
                        </span>
                        <span className="flex items-center gap-1">
                          <Smartphone className="h-3 w-3 shrink-0 opacity-70" />
                          {t.deviceLimit != null && t.deviceLimit > 0 ? `${t.deviceLimit}` : "∞"} устр.
                        </span>
                      </div>
                      <div className="mt-auto pt-3 border-t flex items-center justify-between gap-2 min-h-[2.25rem] min-w-0">
                        <span className="text-sm sm:text-base font-semibold tabular-nums truncate min-w-0" title={formatMoney(t.price, t.currency)}>
                          {formatMoney(t.price, t.currency)}
                        </span>
                        {token ? (
                          <Button
                            size="sm"
                            className="h-6 px-2.5 text-xs shrink-0 gap-1"
                            onClick={() => setPayModal({ tariff: { id: t.id, name: t.name, price: t.price, currency: t.currency } })}
                          >
                            <CreditCard className="h-3 w-3 shrink-0" />
                            Оплатить
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground shrink-0">В боте</span>
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

            {/* ЮKassa API — карта, СБП и др., только RUB */}
            {payModal && yookassaEnabled && payModal.tariff.currency.toUpperCase() === "RUB" && (
              <Button
                variant="outline"
                className="justify-start gap-2"
                disabled={payLoading}
                onClick={() => startYookassaPayment(payModal.tariff)}
              >
                {payLoading ? <Loader2 className="h-4 w-4 animate-spin shrink-0" /> : <CreditCard className="h-4 w-4 shrink-0" />}
                ЮKassa — карта / СБП
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
