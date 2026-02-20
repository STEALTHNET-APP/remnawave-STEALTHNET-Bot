import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Globe, Calendar, CreditCard, Loader2, Copy, Check, ChevronDown } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCabinetMiniapp } from "@/pages/cabinet/cabinet-layout";
import { openPaymentInBrowser } from "@/lib/open-payment-url";

type ProxyTariff = { id: string; name: string; proxyCount: number; durationDays: number; price: number; currency: string };
type ProxyCategory = { id: string; name: string; sortOrder: number; tariffs: ProxyTariff[] };
type ProxySlot = {
  id: string;
  login: string;
  password: string;
  host: string;
  socksPort: number;
  httpPort: number;
  expiresAt: string;
  trafficLimitBytes: string | null;
  trafficUsedBytes: string;
  connectionLimit: number | null;
};

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: currency.toUpperCase() === "USD" ? "USD" : currency.toUpperCase() === "RUB" ? "RUB" : "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatBytes(bytes: string | null): string {
  if (!bytes) return "—";
  const n = Number(bytes);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function ClientProxyPage() {
  const { state, refreshProfile } = useClientAuth();
  const token = state.token;
  const client = state.client;
  const [categories, setCategories] = useState<ProxyCategory[]>([]);
  const [slots, setSlots] = useState<ProxySlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [slotsLoading, setSlotsLoading] = useState(true);
  const [plategaMethods, setPlategaMethods] = useState<{ id: number; label: string }[]>([]);
  const [yoomoneyEnabled, setYoomoneyEnabled] = useState(false);
  const [yookassaEnabled, setYookassaEnabled] = useState(false);
  const [payModal, setPayModal] = useState<ProxyTariff | null>(null);
  const [payLoading, setPayLoading] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("tariffs");

  const isMobileOrMiniapp = useCabinetMiniapp();
  const [expandedCategoryId, setExpandedCategoryId] = useState<string | null>(null);

  useEffect(() => {
    api.getPublicProxyTariffs().then((r) => {
      setCategories(r.items ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    api.getPublicConfig().then((c) => {
      setPlategaMethods(c.plategaMethods ?? []);
      setYoomoneyEnabled(Boolean(c.yoomoneyEnabled));
      setYookassaEnabled(Boolean(c.yookassaEnabled));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!token) {
      setSlotsLoading(false);
      return;
    }
    setSlotsLoading(true);
    api.getProxySlots(token).then((r) => {
      setSlots(r.slots ?? []);
    }).catch(() => setSlots([])).finally(() => setSlotsLoading(false));
  }, [token]);

  useEffect(() => {
    if (isMobileOrMiniapp && categories.length > 0) {
      setExpandedCategoryId((prev) => (prev === null ? categories[0]!.id : prev));
    }
  }, [isMobileOrMiniapp, categories]);

  function copyToClipboard(text: string, id: string) {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  async function payByBalance(tariff: ProxyTariff) {
    if (!token) return;
    setPayError(null);
    setPayLoading(true);
    try {
      const res = await api.clientPayByBalance(token, { proxyTariffId: tariff.id });
      setPayModal(null);
      alert(res.message);
      await refreshProfile();
      const r = await api.getProxySlots(token);
      setSlots(r.slots ?? []);
    } catch (e) {
      setPayError(e instanceof Error ? e.message : "Ошибка оплаты");
    } finally {
      setPayLoading(false);
    }
  }

  async function startYoomoneyPayment(tariff: ProxyTariff) {
    if (!token || tariff.currency.toUpperCase() !== "RUB") return;
    setPayError(null);
    setPayLoading(true);
    try {
      const res = await api.yoomoneyCreateFormPayment(token, {
        amount: tariff.price,
        paymentType: "AC",
        proxyTariffId: tariff.id,
      });
      setPayModal(null);
      if (res.paymentUrl) openPaymentInBrowser(res.paymentUrl);
    } catch (e) {
      setPayError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setPayLoading(false);
    }
  }

  async function startYookassaPayment(tariff: ProxyTariff) {
    if (!token || tariff.currency.toUpperCase() !== "RUB") return;
    setPayError(null);
    setPayLoading(true);
    try {
      const res = await api.yookassaCreatePayment(token, {
        amount: tariff.price,
        currency: "RUB",
        proxyTariffId: tariff.id,
      });
      setPayModal(null);
      if (res.confirmationUrl) openPaymentInBrowser(res.confirmationUrl);
    } catch (e) {
      setPayError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setPayLoading(false);
    }
  }

  async function startPlategaPayment(tariff: ProxyTariff, methodId: number) {
    if (!token) return;
    setPayError(null);
    setPayLoading(true);
    try {
      const res = await api.clientCreatePlategaPayment(token, {
        amount: tariff.price,
        currency: tariff.currency,
        paymentMethod: methodId,
        description: tariff.name,
        proxyTariffId: tariff.id,
      });
      setPayModal(null);
      openPaymentInBrowser(res.paymentUrl);
    } catch (e) {
      setPayError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setPayLoading(false);
    }
  }

  const flatTariffs = categories.flatMap((c) => c.tariffs.map((t) => ({ ...t, categoryName: c.name })));

  return (
    <div className="space-y-6 w-full min-w-0 overflow-hidden">
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight truncate">Прокси</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Покупка прокси и управление активными слотами.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="tariffs" className="gap-2">
            <Globe className="h-4 w-4" /> Купить
          </TabsTrigger>
          <TabsTrigger value="my" className="gap-2">
            Мои прокси
            {slots.length > 0 && (
              <span className="rounded-full bg-primary/20 px-1.5 py-0.5 text-xs font-medium">
                {slots.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tariffs" className="mt-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : flatTariffs.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                Тарифы прокси пока не настроены. Обратитесь в поддержку.
              </CardContent>
            </Card>
          ) : isMobileOrMiniapp ? (
            <div className="space-y-1">
              {categories.filter((c) => c.tariffs.length > 0).map((cat, catIndex) => (
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
                          <Globe className="h-4 w-4 text-primary shrink-0" />
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
                                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0 text-xs text-muted-foreground">
                                  <span className="flex items-center gap-1">
                                    <Globe className="h-3 w-3 shrink-0 opacity-70" />
                                    {t.proxyCount} прокси
                                  </span>
                                  <span className="flex items-center gap-1">
                                    <Calendar className="h-3 w-3 shrink-0 opacity-70" />
                                    {t.durationDays} дн.
                                  </span>
                                </div>
                              </div>
                              <div className="flex flex-col items-center gap-1 shrink-0">
                                <span className="text-sm font-semibold tabular-nums whitespace-nowrap">
                                  {formatMoney(t.price, t.currency)}
                                </span>
                                {token ? (
                                  <Button
                                    size="sm"
                                    className="h-7 px-2.5 text-xs gap-1 w-full"
                                    onClick={() => setPayModal(t)}
                                  >
                                    <CreditCard className="h-3 w-3 shrink-0" />
                                    Оплатить
                                  </Button>
                                ) : null}
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
              {categories.filter((c) => c.tariffs.length > 0).map((cat, catIndex) => (
                <motion.section
                  key={cat.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: catIndex * 0.05 }}
                >
                  <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
                    <Globe className="h-4 w-4 text-primary shrink-0" />
                    {cat.name}
                  </h2>
                  <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-4">
                    {cat.tariffs.map((t) => (
                      <Card key={t.id} className="flex flex-col overflow-hidden">
                        <CardContent className="flex-1 flex flex-col p-4 min-h-0 min-w-0 overflow-hidden">
                          <p className="text-sm font-semibold leading-tight line-clamp-2">{t.name}</p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                            <span>{t.proxyCount} прокси</span>
                            <span>{t.durationDays} дн.</span>
                          </div>
                          <div className="mt-auto pt-3 border-t flex items-center justify-between gap-2">
                            <span className="text-sm sm:text-base font-semibold tabular-nums truncate">
                              {formatMoney(t.price, t.currency)}
                            </span>
                            {token ? (
                              <Button size="sm" className="h-6 px-2.5 text-xs shrink-0" onClick={() => setPayModal(t)}>
                                Оплатить
                              </Button>
                            ) : null}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </motion.section>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="my" className="mt-4">
          {slotsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : slots.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                У вас пока нет активных прокси. Купите тариф во вкладке «Купить».
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {slots.map((slot) => {
                const socks5 = `socks5://${slot.login}:${slot.password}@${slot.host}:${slot.socksPort}`;
                const http = `http://${slot.login}:${slot.password}@${slot.host}:${slot.httpPort}`;
                const socks5Id = `socks5-${slot.id}`;
                const httpId = `http-${slot.id}`;
                return (
                  <Card key={slot.id} className="overflow-hidden">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="font-medium">Прокси {slot.id.slice(0, 8)}…</span>
                        <span className="text-muted-foreground">до {formatDate(slot.expiresAt)}</span>
                      </div>
                      {slot.trafficLimitBytes && Number(slot.trafficLimitBytes) > 0 && (
                        <p className="text-xs text-muted-foreground">
                          Трафик: {formatBytes(slot.trafficUsedBytes)} / {formatBytes(slot.trafficLimitBytes)}
                        </p>
                      )}
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <code className="flex-1 truncate text-xs bg-muted px-2 py-1 rounded font-mono">
                            {socks5}
                          </code>
                          <Button
                            variant="outline"
                            size="sm"
                            className="shrink-0 h-7 px-2"
                            onClick={() => copyToClipboard(socks5, socks5Id)}
                          >
                            {copied === socks5Id ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
                          </Button>
                        </div>
                        <div className="flex items-center gap-2 min-w-0">
                          <code className="flex-1 truncate text-xs bg-muted px-2 py-1 rounded font-mono">
                            {http}
                          </code>
                          <Button
                            variant="outline"
                            size="sm"
                            className="shrink-0 h-7 px-2"
                            onClick={() => copyToClipboard(http, httpId)}
                          >
                            {copied === httpId ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={!!payModal} onOpenChange={(open) => { if (!open && !payLoading) { setPayModal(null); setPayError(null); } }}>
        <DialogContent className="max-w-sm" showCloseButton={!payLoading}>
          <DialogHeader>
            <DialogTitle>Способ оплаты</DialogTitle>
            <DialogDescription>
              {payModal ? `${payModal.name} — ${formatMoney(payModal.price, payModal.currency)}` : ""}
            </DialogDescription>
          </DialogHeader>
          {payModal && (
            <div className="flex flex-col gap-2 py-2">
              {client && client.balance >= payModal.price && (
                <Button
                  variant="default"
                  className="justify-start gap-2"
                  disabled={payLoading}
                  onClick={() => payByBalance(payModal)}
                >
                  {payLoading ? <Loader2 className="h-4 w-4 animate-spin shrink-0" /> : null}
                  Оплатить балансом ({formatMoney(client.balance, payModal.currency)})
                </Button>
              )}
              {yoomoneyEnabled && payModal.currency.toUpperCase() === "RUB" && (
                <Button variant="outline" className="justify-start gap-2" disabled={payLoading} onClick={() => startYoomoneyPayment(payModal)}>
                  ЮMoney — карта
                </Button>
              )}
              {yookassaEnabled && payModal.currency.toUpperCase() === "RUB" && (
                <Button variant="outline" className="justify-start gap-2" disabled={payLoading} onClick={() => startYookassaPayment(payModal)}>
                  ЮKassa — карта / СБП
                </Button>
              )}
              {plategaMethods.map((m) => (
                <Button key={m.id} variant="outline" disabled={payLoading} onClick={() => startPlategaPayment(payModal, m.id)}>
                  {m.label}
                </Button>
              ))}
            </div>
          )}
          {payError && <p className="text-sm text-destructive">{payError}</p>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setPayModal(null); setPayError(null); }} disabled={payLoading}>
              Отмена
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
