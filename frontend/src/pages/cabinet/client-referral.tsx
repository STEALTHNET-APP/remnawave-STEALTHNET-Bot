import { referralRewardLabel, referralRewardDescription } from "@/components/referral-reward-summary";
import { ReferralQrButton } from "@/components/referral-qr";
import { AuroraReferral } from "./aurora/aurora-referral";
import { useEffect, useState } from "react";
import { Copy, Check, Loader2, Send, Banknote } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { useCabinetConfig } from "@/contexts/cabinet-config";
import { api } from "@/lib/api";
import { toast } from "@/components/ui/toast";
import { formatCabinetMoney } from "@/lib/cabinet-format";
import type { ClientReferralStats } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useCabinetDesign } from "@/lib/use-cabinet-design";
import { StealthReferral } from "@/pages/cabinet/stealth/stealth-referral";
const formatMoney = formatCabinetMoney;

export function ClientReferralPage() {
  const design = useCabinetDesign();
  if (design === "stealth") return <StealthReferral />;
  return <ClassicReferralPage aurora={design === "aurora"} />;
}

function ClassicReferralPage({ aurora = false }: { aurora?: boolean }) {
  const { state, refreshProfile } = useClientAuth();
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

  const copyLink = async (which: "site" | "bot") => {
    const url = which === "site" ? referralLinkSite : referralLinkBot;
    if (url) {
      try {
        await navigator.clipboard.writeText(url);
        setCopiedRef(which);
        toast.success("Ссылка скопирована");
        setTimeout(() => setCopiedRef(null), 2000);
      } catch {
        toast.error("Не удалось скопировать ссылку");
      }
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
      toast.success("Заявка отправлена", r.message || "Ожидайте подтверждения администратора.");
      setWOpen(false);
      refreshProfile().catch(() => {});
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
      {aurora ? <AuroraReferral/> : <>
      <header className="cabinet-page-heading"><h1>Рефералы</h1><p>{referralRewardDescription(s)}</p></header>
      <dl className="cabinet-referral-stats" data-tour="referral-stats">
        <div><dt>Награда</dt><dd>{referralRewardLabel(s)}</dd></div>
        <div><dt>Приглашено</dt><dd>{s.referralCount}</dd></div>
        <div><dt>Зачислено на баланс</dt><dd>{formatMoney(s.totalEarnings, currency)}</dd></div>
      </dl>
      <div className="cabinet-referral-layout">
        <section className="cabinet-referral-links" data-tour="referral-link"><h2>Ваши ссылки</h2><p>Отправьте ссылку другу. Бонус начислится после выполнения условий программы.</p>
          {hasReferralLinks ? <>{([{kind:"site",url:referralLinkSite,label:"Сайт"},{kind:"bot",url:referralLinkBot,label:"Telegram-бот"}] as const).filter(item=>item.url).map(item=><div className="cabinet-share-link" key={item.kind}><label htmlFor={`referral-${item.kind}`}>{item.label}</label><div><Input id={`referral-${item.kind}`} readOnly value={item.url!} /><Button variant="outline" size="icon" aria-label={`Скопировать ссылку: ${item.label}`} onClick={()=>copyLink(item.kind)}>{copiedRef === item.kind ? <Check size={17}/> : <Copy size={17}/>}</Button><ReferralQrButton iconOnly code={s.referralCode!} links={[{kind:item.kind,url:item.url!}]} /></div></div>)}</> : <p>Реферальные ссылки пока недоступны.</p>}
        </section>
        <section className="cabinet-referral-rules"><h2>Как начисляются бонусы</h2>
          <dl><div><dt>Уровень 1 · {referralRewardLabel(s)}</dt><dd>{referralRewardDescription(s)}</dd></div>
          {(s.referralPercentLevel2 ?? 0) > 0 && <div><dt>Уровень 2 · {s.referralPercentLevel2}%</dt><dd>Процент от пополнений друзей, которых пригласили ваши рефералы.</dd></div>}
          {(s.referralPercentLevel3 ?? 0) > 0 && <div><dt>Уровень 3 · {s.referralPercentLevel3}%</dt><dd>Процент от пополнений рефералов второго уровня.</dd></div>}</dl>
          <p>{s.referralRewardMode === "days" ? "Бонусные дни продлевают основную подписку. Если её пока нет, дни сохранятся до её появления." : "Бонусы зачисляются на баланс и доступны для оплаты тарифов."}</p>
        </section>
      </div>
      </>}
      {/* Маленькая неприметная кнопка вывода реф.средств — в самом низу.
          скрывается тогглом «Заявки на вывод» из админки. */}
      {withdrawalsEnabled && (
      <div className="flex justify-center pt-2">
        <Dialog open={wOpen} onOpenChange={(o) => { setWOpen(o); if (!o) setWMsg(null); }}>
          <DialogTrigger asChild>
            <button className={aurora ? "au-profile-action" : "inline-flex items-center gap-1.5 text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors underline underline-offset-4 decoration-dotted"}>
              <Banknote className="h-3.5 w-3.5" />
              Заявка на вывод средств
            </button>
          </DialogTrigger>
          <DialogContent className="cabinet-withdraw-dialog sm:max-w-md">
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
                <label htmlFor="withdraw-wallet" className="text-sm font-medium">TRC20-кошелёк (USDT)</label>
                <Input id="withdraw-wallet" autoComplete="off" value={wWallet} onChange={(e) => { setWWallet(e.target.value); setWMsg(null); }} placeholder="T..." className="font-mono" disabled={wSubmitting} />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="withdraw-amount" className="text-sm font-medium">Сумма, ₽ (минимум {withdrawMin})</label>
                <Input id="withdraw-amount" value={wAmount} onChange={(e) => { setWAmount(e.target.value.replace(/[^\d.,]/g, "")); setWMsg(null); }} inputMode="decimal" placeholder={String(withdrawMin)} disabled={wSubmitting} />
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
