import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { User, Wallet, Copy, Check, CreditCard, Loader2 } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { useCabinetMiniapp } from "@/pages/cabinet/cabinet-layout";
import { api } from "@/lib/api";
import type { ClientPayment } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

function formatDate(s: string | null) {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString("ru-RU");
  } catch {
    return s;
  }
}

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: currency.toUpperCase() === "USD" ? "USD" : currency.toUpperCase() === "RUB" ? "RUB" : "UAH",
  }).format(amount);
}

function formatPaymentStatus(status: string): string {
  const s = (status || "").toLowerCase();
  if (s === "paid") return "Оплачен";
  if (s === "pending") return "Не оплачено";
  if (s === "failed") return "Не прошёл";
  if (s === "refunded") return "Возврат";
  return status || "—";
}

export function ClientProfilePage() {
  const navigate = useNavigate();
  const { state, refreshProfile } = useClientAuth();
  const [payments, setPayments] = useState<ClientPayment[]>([]);
  const [preferredLang, setPreferredLang] = useState(state.client?.preferredLang ?? "ru");
  const [preferredCurrency, setPreferredCurrency] = useState(state.client?.preferredCurrency ?? "usd");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [copiedRef, setCopiedRef] = useState<"site" | "bot" | null>(null);
  const [plategaMethods, setPlategaMethods] = useState<{ id: number; label: string }[]>([]);
  const [yoomoneyEnabled, setYoomoneyEnabled] = useState(false);
  const [activeLanguages, setActiveLanguages] = useState<string[]>([]);
  const [activeCurrencies, setActiveCurrencies] = useState<string[]>([]);
  const [publicAppUrl, setPublicAppUrl] = useState<string | null>(null);
  const [telegramBotUsername, setTelegramBotUsername] = useState<string | null>(null);
  const [topUpAmount, setTopUpAmount] = useState("");
  const [topUpModalOpen, setTopUpModalOpen] = useState(false);
  const [topUpLoading, setTopUpLoading] = useState(false);
  const [topUpError, setTopUpError] = useState<string | null>(null);

  const client = state.client;
  const token = state.token;
  const currency = (client?.preferredCurrency ?? "usd").toLowerCase();

  useEffect(() => {
    if (token) {
      refreshProfile().catch(() => {});
    }
  }, [token, refreshProfile]);

  useEffect(() => {
    if (token) {
      api.clientPayments(token).then((r) => setPayments(r.items ?? [])).catch(() => {});
    }
  }, [token]);

  useEffect(() => {
    api.getPublicConfig().then((c) => {
      setPlategaMethods(c.plategaMethods ?? []);
      setYoomoneyEnabled(Boolean(c.yoomoneyEnabled));
      setActiveLanguages(c.activeLanguages?.length ? c.activeLanguages : ["ru", "en", "ua"]);
      setActiveCurrencies(c.activeCurrencies?.length ? c.activeCurrencies : ["usd", "rub", "uah"]);
      setPublicAppUrl(c.publicAppUrl ?? null);
      setTelegramBotUsername(c.telegramBotUsername ?? null);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    if (params.get("yoomoney") === "connected" || params.get("yoomoney_form") === "success") {
      refreshProfile().catch(() => {});
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [refreshProfile]);

  async function startTopUp(methodId: number) {
    if (!token || !client) return;
    const amount = Number(topUpAmount?.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) {
      setTopUpError("Укажите сумму");
      return;
    }
    setTopUpError(null);
    setTopUpLoading(true);
    try {
      const res = await api.clientCreatePlategaPayment(token, {
        amount,
        currency,
        paymentMethod: methodId,
        description: "Пополнение баланса",
      });
      setTopUpModalOpen(false);
      window.location.href = res.paymentUrl;
    } catch (e) {
      setTopUpError(e instanceof Error ? e.message : "Ошибка создания платежа");
    } finally {
      setTopUpLoading(false);
    }
  }

  async function startTopUpYoomoneyForm(paymentType: "PC" | "AC") {
    if (!token || !client) return;
    const amount = Number(topUpAmount?.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) {
      setTopUpError("Укажите сумму (в рублях)");
      return;
    }
    setTopUpError(null);
    setTopUpLoading(true);
    try {
      const res = await api.yoomoneyCreateFormPayment(token, { amount, paymentType });
      setTopUpModalOpen(false);
      if (res.paymentUrl) {
        window.location.href = res.paymentUrl;
      } else {
        navigate("/cabinet/yoomoney-pay", { state: { form: res.form } });
      }
    } catch (e) {
      setTopUpError(e instanceof Error ? e.message : "Ошибка создания платежа");
    } finally {
      setTopUpLoading(false);
    }
  }

  useEffect(() => {
    if (state.client) {
      const lang = state.client.preferredLang;
      const curr = state.client.preferredCurrency;
      setPreferredLang(activeLanguages.includes(lang) ? lang : (activeLanguages[0] ?? lang));
      setPreferredCurrency(activeCurrencies.includes(curr) ? curr : (activeCurrencies[0] ?? curr));
    }
  }, [state.client?.preferredLang, state.client?.preferredCurrency, activeLanguages, activeCurrencies]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSaving(true);
    setMessage(null);
    try {
      await api.clientUpdateProfile(token, { preferredLang, preferredCurrency });
      await refreshProfile();
      setMessage("Настройки сохранены");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setSaving(false);
    }
  }

  const baseUrl = publicAppUrl ?? (typeof window !== "undefined" ? window.location.origin : "");
  const referralLinkSite =
    client?.referralCode && baseUrl
      ? `${String(baseUrl).replace(/\/$/, "")}/cabinet/register?ref=${encodeURIComponent(client.referralCode)}`
      : "";
  const referralLinkBot =
    client?.referralCode && telegramBotUsername
      ? `https://t.me/${telegramBotUsername.replace(/^@/, "")}?start=ref_${client.referralCode}`
      : "";
  const hasReferralLinks = Boolean(referralLinkSite || referralLinkBot);
  function copyReferral(which: "site" | "bot") {
    const url = which === "site" ? referralLinkSite : referralLinkBot;
    if (url) {
      navigator.clipboard.writeText(url);
      setCopiedRef(which);
      setTimeout(() => setCopiedRef(null), 2000);
    }
  }

  if (!client) return null;

  const langs = activeLanguages.length ? activeLanguages : ["ru", "en", "ua"];
  const currencies = activeCurrencies.length ? activeCurrencies : ["usd", "rub", "uah"];

  const isMiniapp = useCabinetMiniapp();
  const cardClass = isMiniapp ? "min-w-0 overflow-hidden" : "";

  return (
    <div className={`space-y-6 w-full min-w-0 overflow-hidden`}>
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight truncate">Профиль</h1>
        <p className="text-muted-foreground text-sm mt-1 truncate">Личные данные и настройки</p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className={`grid gap-6 ${isMiniapp ? "grid-cols-1" : "lg:grid-cols-2"} min-w-0`}
      >
        <Card className={cardClass}>
          <CardHeader className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base min-w-0 truncate">
              <User className="h-5 w-5 text-primary shrink-0" />
              Данные
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 min-w-0 overflow-hidden">
            {client.email != null && client.email !== "" && (
              <div className="min-w-0 overflow-hidden">
                <Label className="text-muted-foreground">Email</Label>
                <p className="font-medium truncate break-all" title={client.email}>{client.email}</p>
              </div>
            )}
            <div className="min-w-0 overflow-hidden">
              <Label className="text-muted-foreground">Telegram</Label>
              <p className="font-medium truncate">
                {client.telegramUsername ? `@${client.telegramUsername}` : "—"}
                {client.telegramId ? ` · ID ${client.telegramId}` : ""}
              </p>
            </div>
            <div className="min-w-0 overflow-hidden">
              <Label className="text-muted-foreground">Баланс</Label>
              <p className="font-medium truncate">{formatMoney(client.balance, client.preferredCurrency)}</p>
            </div>
            {hasReferralLinks && (
              <div className="min-w-0 overflow-hidden space-y-3">
                <Label className="text-muted-foreground">Реферальные ссылки</Label>
                <p className="text-xs text-muted-foreground mt-0.5">Поделитесь с друзьями — при регистрации по ссылке вы получите бонус</p>
                {referralLinkSite && (
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-medium text-muted-foreground shrink-0 w-12">Сайт</span>
                    <code className="rounded bg-muted px-2 py-1 text-sm font-mono flex-1 min-w-0 truncate block" title={referralLinkSite}>
                      {referralLinkSite}
                    </code>
                    <Button variant="ghost" size="sm" onClick={() => copyReferral("site")} className="shrink-0" title="Копировать">
                      {copiedRef === "site" ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                )}
                {referralLinkBot && (
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-medium text-muted-foreground shrink-0 w-12">Бот</span>
                    <code className="rounded bg-muted px-2 py-1 text-sm font-mono flex-1 min-w-0 truncate block" title={referralLinkBot}>
                      {referralLinkBot}
                    </code>
                    <Button variant="ghost" size="sm" onClick={() => copyReferral("bot")} className="shrink-0" title="Копировать">
                      {copiedRef === "bot" ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className={cardClass}>
          <CardHeader className="min-w-0">
            <CardTitle className="text-base truncate">Настройки</CardTitle>
          </CardHeader>
          <CardContent className="min-w-0 overflow-hidden">
            <form onSubmit={saveProfile} className="space-y-4 min-w-0">
              <div className="space-y-2 min-w-0">
                <Label>Язык</Label>
                <select
                  className="flex h-9 w-full min-w-0 max-w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                  value={preferredLang}
                  onChange={(e) => setPreferredLang(e.target.value)}
                >
                  {langs.map((l) => (
                    <option key={l} value={l}>{l === "ru" ? "Русский" : l === "en" ? "English" : "Українська"}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2 min-w-0">
                <Label>Валюта</Label>
                <select
                  className="flex h-9 w-full min-w-0 max-w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                  value={preferredCurrency}
                  onChange={(e) => setPreferredCurrency(e.target.value)}
                >
                  {currencies.map((c) => (
                    <option key={c} value={c}>{c.toUpperCase()}</option>
                  ))}
                </select>
              </div>
              {message && (
                <p className={`text-sm truncate ${message === "Настройки сохранены" ? "text-green-600" : "text-destructive"}`}>
                  {message}
                </p>
              )}
              <Button type="submit" disabled={saving} className="w-full sm:w-auto">
                {saving ? "Сохранение…" : "Сохранить"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </motion.div>

      {(plategaMethods.length > 0 || yoomoneyEnabled) && (
        <Card id="topup" className={cardClass}>
          <CardHeader className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base min-w-0 truncate">
              <CreditCard className="h-5 w-5 text-primary shrink-0" />
              Пополнить баланс
            </CardTitle>
            <p className="text-sm text-muted-foreground break-words">Оплата откроется в новой вкладке. Кабинет останется открыт.</p>
          </CardHeader>
          <CardContent className="space-y-4 min-w-0 overflow-hidden">
            <div className="space-y-2 min-w-0">
              <Label>Сумма</Label>
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <Input
                  type="number"
                  min={1}
                  step={0.01}
                  placeholder="0"
                  value={topUpAmount}
                  onChange={(e) => setTopUpAmount(e.target.value)}
                  className="w-28 min-w-0 font-mono max-w-full"
                />
                <span className="text-sm text-muted-foreground uppercase shrink-0">{currency}</span>
                {[100, 300, 500, 1000].map((n) => (
                  <Button
                    key={n}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() => setTopUpAmount(String(n))}
                  >
                    {n}
                  </Button>
                ))}
              </div>
            </div>
            <Button
              className="gap-2"
              onClick={() => {
                const amount = Number(topUpAmount?.replace(",", "."));
                if (!Number.isFinite(amount) || amount <= 0) {
                  setTopUpError("Укажите сумму");
                  return;
                }
                setTopUpError(null);
                setTopUpModalOpen(true);
              }}
            >
              <CreditCard className="h-4 w-4" />
              Пополнить
            </Button>
          </CardContent>
        </Card>
      )}

      <Dialog open={topUpModalOpen} onOpenChange={(open) => !topUpLoading && setTopUpModalOpen(open)}>
        <DialogContent className="max-w-sm" showCloseButton={!topUpLoading} onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Способ оплаты</DialogTitle>
            <DialogDescription>
              Пополнение на {topUpAmount ? `${Number(topUpAmount.replace(",", "."))} ${currency.toUpperCase()}` : "—"}
              {yoomoneyEnabled && " (для ЮMoney укажите сумму в рублях)"}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-2">
            {yoomoneyEnabled && (
              <Button
                variant="outline"
                className="justify-start"
                disabled={topUpLoading}
                onClick={() => startTopUpYoomoneyForm("AC")}
              >
                {topUpLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2 shrink-0" /> : null}
                ЮMoney — оплата картой
              </Button>
            )}
            {plategaMethods.map((m) => (
              <Button
                key={m.id}
                variant="outline"
                className="justify-start"
                disabled={topUpLoading}
                onClick={() => startTopUp(m.id)}
              >
                {topUpLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2 shrink-0" /> : null}
                {m.label}
              </Button>
            ))}
          </div>
          {topUpError && <p className="text-sm text-destructive">{topUpError}</p>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTopUpModalOpen(false)} disabled={topUpLoading}>
              Отмена
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card className={cardClass}>
        <CardHeader className="min-w-0">
          <CardTitle className="flex items-center gap-2 text-base min-w-0 truncate">
            <Wallet className="h-5 w-5 text-primary shrink-0" />
            История платежей
          </CardTitle>
          <p className="text-sm text-muted-foreground font-normal mt-1 break-words">Оплата открывается в новой вкладке — эта страница остаётся открытой.</p>
        </CardHeader>
        <CardContent className="min-w-0 overflow-hidden">
          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Платежей пока нет</p>
          ) : (
            <ul className="space-y-2 min-w-0">
              {payments.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm min-w-0"
                >
                  <span className="font-medium truncate min-w-0" title={p.orderId}>{p.orderId}</span>
                  <span className="shrink-0">{formatMoney(p.amount, p.currency)}</span>
                  <span className={`shrink-0 ${p.status?.toLowerCase() === "paid" ? "text-green-600" : "text-muted-foreground"}`}>
                    {formatPaymentStatus(p.status)}
                  </span>
                  <span className="text-muted-foreground text-xs shrink-0">{formatDate(p.paidAt ?? p.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
