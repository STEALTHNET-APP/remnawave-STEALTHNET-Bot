import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Users, Percent, Wallet, Link2, Copy, Check, Loader2, Globe, Send, Info, Banknote } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { useCabinetConfig } from "@/contexts/cabinet-config";
import { api } from "@/lib/api";
import type { ClientReferralStats } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useCabinetDesign } from "@/lib/use-cabinet-design";
import { StealthReferral } from "@/pages/cabinet/stealth/stealth-referral";
import { AuroraReferral } from "@/pages/cabinet/aurora/aurora-referral";
function formatMoney(amount: number, currency: string = "usd") {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: currency.toUpperCase() === "USD" ? "USD" : currency.toUpperCase() === "RUB" ? "RUB" : "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function ClientReferralPage() {
  const design = useCabinetDesign();
  if (design === "stealth") return <StealthReferral />;
  if (design === "aurora") return <AuroraReferral />;
  return <ClassicReferralPage />;
}

function ClassicReferralPage() {
  const { state } = useClientAuth();
  const config = useCabinetConfig();
  const token = state.token ?? null;
  const client = state.client;
  const currency = (client?.preferredCurrency ?? "usd").toLowerCase();

  const [stats, setStats] = useState<ClientReferralStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedRef, setCopiedRef] = useState<"site" | "bot" | null>(null);
  // Заявка на вывод реф.средств (бэк: POST /client/withdrawals, мин 3000₽, TRC20)
  const [wOpen, setWOpen] = useState(false);
  const [wWallet, setWWallet] = useState("");
  const [wAmount, setWAmount] = useState("");
  const [wSubmitting, setWSubmitting] = useState(false);
  const [wMsg, setWMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const clientBalance = typeof client?.balance === "number" ? client.balance : null;
  // настройки заявок на вывод из админки (вкл/выкл + мин. сумма).
  const withdrawalsEnabled = config?.withdrawalsEnabled !== false;
  const withdrawMin = config?.withdrawalMinAmount ?? 3000;

  const siteOrigin = config?.publicAppUrl?.replace(/\/$/, "") || (typeof window !== "undefined" ? window.location.origin : "");
  const referralLinkSite =
    stats?.referralCode && siteOrigin
      ? `${siteOrigin}/cabinet/register?ref=${encodeURIComponent(stats.referralCode)}`
      : null;
  const referralLinkBot =
    stats?.referralCode && config?.telegramBotUsername
      ? `https://t.me/${config.telegramBotUsername.replace(/^@/, "")}?start=ref_${stats.referralCode}`
      : null;
  const hasReferralLinks = Boolean(referralLinkSite || referralLinkBot);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    api
      .getClientReferralStats(token)
      .then(setStats)
      .catch((e) => setError(e instanceof Error ? e.message : "Ошибка загрузки"))
      .finally(() => setLoading(false));
  }, [token]);

  const copyLink = (which: "site" | "bot") => {
    const url = which === "site" ? referralLinkSite : referralLinkBot;
    if (url) {
      navigator.clipboard.writeText(url);
      setCopiedRef(which);
      setTimeout(() => setCopiedRef(null), 2000);
    }
  };

  const submitWithdraw = async () => {
    if (!token) return;
    const amt = Math.floor(parseFloat(wAmount.replace(",", ".")));
    if (!Number.isFinite(amt) || amt < withdrawMin) {
      setWMsg({ type: "err", text: `Минимальная сумма вывода — ${withdrawMin} ₽` });
      return;
    }
    const w = wWallet.trim();
    if (!/^T[A-Za-z0-9]{33}$/.test(w)) {
      setWMsg({ type: "err", text: "Некорректный TRC20-адрес (начинается с T, 34 символа)" });
      return;
    }
    setWSubmitting(true);
    setWMsg(null);
    try {
      const r = await api.createWithdrawal(token, { amount: amt, walletTrc20: w });
      setWMsg({ type: "ok", text: r.message || "Заявка отправлена. Ожидайте подтверждения администратора." });
      setWWallet("");
      setWAmount("");
    } catch (e) {
      setWMsg({ type: "err", text: e instanceof Error ? e.message : "Ошибка отправки заявки" });
    } finally {
      setWSubmitting(false);
    }
  };

  if (loading && !stats) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[200px] gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Загрузка…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-destructive/15 border border-destructive/30 px-4 py-3 text-sm text-destructive">
        {error}
      </div>
    );
  }

  const s = stats!;

  return (
    <div className="space-y-6 w-full min-w-0 pb-10">
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="relative overflow-hidden rounded-3xl bg-card/40 backdrop-blur-2xl border border-border/50 p-8 sm:p-10 shadow-xl"
      >
        <div className="absolute top-0 right-0 w-64 h-64 rounded-full bg-primary/20 blur-[80px] pointer-events-none -mr-20 -mt-20" />
        <div className="absolute bottom-0 left-0 w-64 h-64 rounded-full bg-blue-500/10 blur-[80px] pointer-events-none -ml-20 -mb-20" />
        
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-8">
          <div className="flex-1">
            <div className="flex items-center gap-4 mb-3">
              <div className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-inner border border-primary/20">
                <Users className="h-7 w-7" />
              </div>
              <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground">Рефералы</h1>
            </div>
            <p className="text-[16px] text-muted-foreground max-w-xl leading-relaxed">
              Приглашайте друзей — получайте процент от их пополнений прямо на свой баланс
            </p>
          </div>
        </div>
      </motion.section>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6" data-tour="referral-stats">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.05 }}
          className="relative p-4 sm:p-6 rounded-[1.5rem] sm:rounded-[2rem] bg-muted/40 border border-border/50 dark:bg-white/5 dark:border-white/5 transition-colors hover:bg-muted/60 dark:hover:bg-white/10 overflow-hidden group"
        >
          <div className="absolute -top-12 -right-12 h-32 w-32 rounded-full bg-blue-500/10 blur-[40px] pointer-events-none group-hover:bg-blue-500/20 transition-colors duration-500" />
          <div className="relative flex items-center sm:block gap-4 sm:gap-0">
            <div className="flex items-center justify-center shrink-0 w-12 h-12 rounded-xl bg-blue-500/10 text-blue-500 sm:mb-4 shadow-inner border border-blue-500/10">
              <Percent className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-2xl sm:text-3xl font-bold tracking-tight mb-0 sm:mb-1"><span className="text-foreground">{s.referralPercent}</span><span className="text-muted-foreground/50 ml-1 text-xl sm:text-2xl">%</span></p>
              <div className="flex flex-col sm:block">
                <p className="text-xs sm:text-sm text-muted-foreground font-medium leading-tight">Процент</p>
                <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 opacity-70 leading-tight">от пополнений (1 уровень)</p>
              </div>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
          className="relative p-4 sm:p-6 rounded-[1.5rem] sm:rounded-[2rem] bg-muted/40 border border-border/50 dark:bg-white/5 dark:border-white/5 transition-colors hover:bg-muted/60 dark:hover:bg-white/10 overflow-hidden group"
        >
          <div className="absolute -top-12 -right-12 h-32 w-32 rounded-full bg-indigo-500/10 blur-[40px] pointer-events-none group-hover:bg-indigo-500/20 transition-colors duration-500" />
          <div className="relative flex items-center sm:block gap-4 sm:gap-0">
            <div className="flex items-center justify-center shrink-0 w-12 h-12 rounded-xl bg-indigo-500/10 text-indigo-500 sm:mb-4 shadow-inner border border-indigo-500/10">
              <Users className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-2xl sm:text-3xl font-bold tracking-tight mb-0 sm:mb-1 text-foreground">{s.referralCount}</p>
              <div className="flex flex-col sm:block">
                <p className="text-xs sm:text-sm text-muted-foreground font-medium leading-tight">Приглашено</p>
                <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 opacity-70 leading-tight">активных рефералов</p>
              </div>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.15 }}
          className="relative p-4 sm:p-6 rounded-[1.5rem] sm:rounded-[2rem] bg-muted/40 border border-border/50 dark:bg-white/5 dark:border-white/5 transition-colors hover:bg-muted/60 dark:hover:bg-white/10 overflow-hidden group"
        >
          <div className="absolute -top-12 -right-12 h-32 w-32 rounded-full bg-green-500/10 blur-[40px] pointer-events-none group-hover:bg-green-500/20 transition-colors duration-500" />
          <div className="relative flex items-center sm:block gap-4 sm:gap-0">
            <div className="flex items-center justify-center shrink-0 w-12 h-12 rounded-xl bg-green-500/10 text-green-500 sm:mb-4 shadow-inner border border-green-500/10">
              <Wallet className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-2xl sm:text-3xl font-bold tracking-tight mb-0 sm:mb-1 truncate text-foreground">{formatMoney(s.totalEarnings, currency)}</p>
              <div className="flex flex-col sm:block">
                <p className="text-xs sm:text-sm text-muted-foreground font-medium leading-tight">Заработок</p>
                <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 opacity-70 leading-tight">зачислено на баланс</p>
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {hasReferralLinks ? (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.2 }}
            className="relative flex flex-col rounded-[2rem] shadow-[0_8px_40px_rgba(0,0,0,0.08)] dark:shadow-[0_8px_40px_rgba(0,0,0,0.3)] min-w-0"
            data-tour="referral-link"
          >
            <div className="absolute inset-0 overflow-hidden rounded-[2rem] border border-white/10 dark:border-white/5 bg-background/40 backdrop-blur-2xl">
              <div className="absolute -bottom-32 -left-32 h-64 w-64 rounded-full bg-primary/10 blur-[80px] pointer-events-none" />
            </div>

            <div className="relative p-5 sm:p-8 flex flex-col h-full min-w-0">
              <div className="flex items-center gap-3 mb-5 sm:mb-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0 shadow-inner border border-white/10">
                  <Link2 className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-lg font-bold tracking-tight text-foreground truncate">Ваши ссылки</h3>
                  <p className="text-xs text-muted-foreground mt-[1px] truncate">Копируйте и делитесь с друзьями</p>
                </div>
              </div>

              <div className="space-y-3">
                {referralLinkSite && (
                  <div className="flex flex-col gap-2 p-3 sm:p-4 rounded-2xl bg-muted/40 border border-border/50 dark:bg-white/5 dark:border-white/5 transition-colors hover:bg-muted/60 dark:hover:bg-white/10">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-black/5 dark:bg-white/10 shrink-0 text-muted-foreground">
                        <Globe className="w-4 h-4" />
                      </div>
                      <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Сайт</div>
                    </div>
                    <div className="flex items-center gap-2 min-w-0">
                      <code className="flex-1 min-w-0 truncate text-xs font-mono text-primary/80 select-all bg-background/50 px-3 py-2 rounded-xl border border-border/50">{referralLinkSite}</code>
                      <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 hover:bg-black/5 dark:hover:bg-white/10 rounded-xl" onClick={() => copyLink("site")}>
                        {copiedRef === "site" ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                )}
                {referralLinkBot && (
                  <div className="flex flex-col gap-2 p-3 sm:p-4 rounded-2xl bg-muted/40 border border-border/50 dark:bg-white/5 dark:border-white/5 transition-colors hover:bg-muted/60 dark:hover:bg-white/10">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#0088cc]/10 text-[#0088cc] shrink-0">
                        <Send className="w-4 h-4 ml-[-2px] mt-[1px]" />
                      </div>
                      <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Бот</div>
                    </div>
                    <div className="flex items-center gap-2 min-w-0">
                      <code className="flex-1 min-w-0 truncate text-xs font-mono text-primary/80 select-all bg-background/50 px-3 py-2 rounded-xl border border-border/50">{referralLinkBot}</code>
                      <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 hover:bg-black/5 dark:hover:bg-white/10 rounded-xl" onClick={() => copyLink("bot")}>
                        {copiedRef === "bot" ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        ) : (
          <div className="p-6 rounded-[2rem] border border-dashed border-border/50 flex flex-col items-center justify-center text-center gap-3 bg-muted/20">
            <Link2 className="w-8 h-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">Реферальные ссылки пока недоступны.</p>
          </div>
        )}

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.25 }}
          className="flex flex-col gap-4 p-5 sm:p-8 rounded-[1.5rem] sm:rounded-[2rem] bg-orange-500/5 border border-orange-500/10 min-w-0"
        >
          <div className="flex items-center gap-3 mb-1 sm:mb-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500/10 text-orange-500 shrink-0 shadow-inner">
              <Info className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-lg font-bold tracking-tight text-foreground truncate">Как это работает</h3>
              <p className="text-xs text-muted-foreground mt-[1px] truncate">Правила начисления бонусов</p>
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-3 sm:gap-4 p-3 sm:p-4 rounded-2xl bg-background/60 border border-border/50 shadow-sm">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0 font-bold">1</div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground mb-0.5">Уровень 1 <span className="text-primary font-bold ml-1">({s.referralPercent}%)</span></p>
                <p className="text-xs text-muted-foreground leading-relaxed">Процент от пополнений тех, кто напрямую перешёл по вашей ссылке.</p>
              </div>
            </div>
            {(s.referralPercentLevel2 ?? 0) > 0 && (
              <div className="flex items-start gap-3 sm:gap-4 p-3 sm:p-4 rounded-2xl bg-background/60 border border-border/50 shadow-sm">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0 font-bold">2</div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground mb-0.5">Уровень 2 <span className="text-primary font-bold ml-1">({s.referralPercentLevel2}%)</span></p>
                  <p className="text-xs text-muted-foreground leading-relaxed">Процент от пополнений рефералов ваших рефералов.</p>
                </div>
              </div>
            )}
            {(s.referralPercentLevel3 ?? 0) > 0 && (
              <div className="flex items-start gap-3 sm:gap-4 p-3 sm:p-4 rounded-2xl bg-background/60 border border-border/50 shadow-sm">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0 font-bold">3</div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground mb-0.5">Уровень 3 <span className="text-primary font-bold ml-1">({s.referralPercentLevel3}%)</span></p>
                  <p className="text-xs text-muted-foreground leading-relaxed">Процент от пополнений рефералов второго уровня.</p>
                </div>
              </div>
            )}
            <div className="flex items-start gap-3 sm:gap-4 p-3 sm:p-4 rounded-2xl bg-background/60 border border-border/50 shadow-sm w-full">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-500/10 text-green-500 shrink-0">
                <Wallet className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground mb-0.5">Начисление на баланс</p>
                <p className="text-xs text-muted-foreground leading-relaxed">Все средства автоматически зачисляются на ваш баланс и могут быть использованы для оплаты тарифов.</p>
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Маленькая неприметная кнопка вывода реф.средств — в самом низу.
          скрывается тогглом «Заявки на вывод» из админки. */}
      {withdrawalsEnabled && (
      <div className="flex justify-center pt-2">
        <Dialog open={wOpen} onOpenChange={(o) => { setWOpen(o); if (!o) setWMsg(null); }}>
          <DialogTrigger asChild>
            <button className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors underline underline-offset-4 decoration-dotted">
              <Banknote className="h-3.5 w-3.5" />
              Заявка на вывод средств
            </button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><Banknote className="h-5 w-5 text-green-500" /> Вывод средств</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-1">
              {clientBalance != null && (
                <div className="flex items-center justify-between rounded-xl bg-muted/40 border border-border/50 px-4 py-3 text-sm">
                  <span className="text-muted-foreground">Доступно на балансе</span>
                  <span className="font-bold text-foreground">{formatMoney(clientBalance, currency)}</span>
                </div>
              )}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">TRC20-кошелёк (USDT)</label>
                <Input value={wWallet} onChange={(e) => { setWWallet(e.target.value); setWMsg(null); }} placeholder="T..." className="font-mono" disabled={wSubmitting} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Сумма, ₽ (минимум {withdrawMin})</label>
                <Input value={wAmount} onChange={(e) => { setWAmount(e.target.value.replace(/[^\d.,]/g, "")); setWMsg(null); }} inputMode="decimal" placeholder={String(withdrawMin)} disabled={wSubmitting} />
              </div>
              {wMsg && (
                <p className={`text-sm font-medium ${wMsg.type === "ok" ? "text-green-600 dark:text-green-400" : "text-destructive"}`}>{wMsg.text}</p>
              )}
              <Button className="w-full gap-2 h-11 rounded-xl" onClick={submitWithdraw} disabled={wSubmitting || !wWallet.trim() || !wAmount.trim()}>
                {wSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Отправить заявку
              </Button>
              <p className="text-[11px] text-muted-foreground/70 leading-relaxed text-center">
                Сумма спишется с баланса и зарезервируется. Заявку обработает администратор.
              </p>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      )}
    </div>
  );
}
