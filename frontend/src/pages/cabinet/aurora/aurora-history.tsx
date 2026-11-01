import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Coins, Gift, Loader2, Receipt } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { api, type ClientPayment } from "@/lib/api";
import { formatAuroraBalance } from "@/lib/aurora-profile";
import { cn } from "@/lib/utils";
import { AuBadge, AuEmpty, AuLoading, AuNotice, AuPage } from "@/components/aurora/aurora-ui";

type Withdrawal = Awaited<ReturnType<typeof api.clientWithdrawals>>["items"][number];
type GiftEvent = Awaited<ReturnType<typeof api.giftGetHistory>>["items"][number];
type Tab = "payments" | "withdrawals" | "gifts";

export function AuroraHistory() {
  const { t, i18n } = useTranslation();
  const { state } = useClientAuth();
  const token = state.token ?? null;
  const locale = i18n.language || "ru";

  const [tab, setTab] = useState<Tab>("payments");
  const [payments, setPayments] = useState<ClientPayment[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [gifts, setGifts] = useState<GiftEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const [pay, wd, gift] = await Promise.all([
        api.clientPayments(token).catch(() => ({ items: [] })),
        api.clientWithdrawals(token).catch(() => ({ items: [] })),
        api.giftGetHistory(token, 1, 30).catch(() => ({ items: [] })),
      ]);
      setPayments(pay.items ?? []);
      setWithdrawals(wd.items ?? []);
      setGifts(gift.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("aurora.history_error"));
    } finally {
      setLoading(false);
    }
  }, [token, t]);

  useEffect(() => {
    void load();
  }, [load]);

  function paymentStatus(status: string): { label: string; tone: "success" | "accent" | "danger" | "neutral" } {
    const normalized = status.toUpperCase();
    if (normalized === "PAID" || normalized === "SUCCESS") return { label: t("aurora.status_paid"), tone: "success" };
    if (normalized === "PENDING") return { label: t("aurora.status_pending"), tone: "accent" };
    if (normalized === "FAILED" || normalized === "CANCELED" || normalized === "CANCELLED") return { label: t("aurora.status_failed"), tone: "danger" };
    return { label: status, tone: "neutral" };
  }

  function withdrawalStatus(status: string): { label: string; tone: "success" | "accent" | "danger" | "neutral" } {
    if (status === "APPROVED") return { label: t("aurora.withdraw_approved"), tone: "success" };
    if (status === "REJECTED") return { label: t("aurora.withdraw_rejected"), tone: "danger" };
    return { label: t("aurora.withdraw_pending"), tone: "accent" };
  }

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "payments", label: t("aurora.payments") },
    { id: "withdrawals", label: t("aurora.withdrawals") },
    { id: "gifts", label: t("aurora.gifts") },
  ];

  return (
    <AuPage>
      <header className="px-1 pb-1">
        <h1 className="text-[26px] font-extrabold leading-tight tracking-tight text-[var(--au-ink)]">{t("aurora.history")}</h1>
        <p className="mt-0.5 text-[14px] text-[var(--au-muted)]">{t("aurora.history_subtitle")}</p>
      </header>

      <div className="flex gap-1.5 rounded-[18px] bg-[var(--au-surface)] p-1.5">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={cn(
              "flex-1 rounded-[14px] px-3 py-2.5 text-[13px] font-bold transition-colors",
              tab === item.id ? "bg-[linear-gradient(135deg,var(--au-from),var(--au-to))] text-white" : "text-[var(--au-muted)]",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error && <AuNotice tone="error">{error}</AuNotice>}

      {loading ? (
        <AuLoading rows={4} />
      ) : tab === "payments" ? (
        payments.length === 0 ? (
          <AuEmpty icon={<Receipt className="h-6 w-6" />} title={t("aurora.history_empty")} />
        ) : (
          <div className="space-y-2">
            {payments.map((payment) => {
              const status = paymentStatus(payment.status);
              return (
                <article key={payment.id} className="flex items-center gap-3 rounded-[18px] bg-[var(--au-surface)] p-3.5">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--au-bg)] text-[var(--au-from)]">
                    <Receipt className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-bold tabular-nums text-[var(--au-ink)]">
                      {formatAuroraBalance(payment.amount, payment.currency?.toUpperCase() || "RUB", locale)}
                    </div>
                    <div className="text-[11.5px] text-[var(--au-muted)]">
                      {new Date(payment.createdAt).toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                  <AuBadge tone={status.tone}>{status.label}</AuBadge>
                </article>
              );
            })}
          </div>
        )
      ) : tab === "withdrawals" ? (
        withdrawals.length === 0 ? (
          <AuEmpty icon={<Coins className="h-6 w-6" />} title={t("aurora.withdrawals_empty")} />
        ) : (
          <div className="space-y-2">
            {withdrawals.map((item) => {
              const status = withdrawalStatus(item.status);
              return (
                <article key={item.id} className="rounded-[18px] bg-[var(--au-surface)] p-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[15px] font-extrabold tabular-nums text-[var(--au-ink)]">
                      {formatAuroraBalance(item.amount, "RUB", locale)}
                    </div>
                    <AuBadge tone={status.tone}>{status.label}</AuBadge>
                  </div>
                  <div className="mt-1 break-all font-mono text-[11.5px] text-[var(--au-muted)]">{item.walletTrc20}</div>
                  <div className="mt-1 text-[11.5px] text-[var(--au-muted)]">
                    {new Date(item.createdAt).toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </div>
                  {item.adminComment && <p className="mt-1.5 text-[12px] text-[var(--au-ink)]">{item.adminComment}</p>}
                </article>
              );
            })}
          </div>
        )
      ) : gifts.length === 0 ? (
        <AuEmpty icon={<Gift className="h-6 w-6" />} title={t("aurora.history_empty")} />
      ) : (
        <div className="space-y-2">
          {gifts.map((event) => (
            <article key={event.id} className="flex items-center gap-3 rounded-[18px] bg-[var(--au-surface)] p-3.5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--au-bg)] text-[var(--au-from)]">
                <Gift className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-semibold text-[var(--au-ink)]">{giftEventLabel(event.eventType, t)}</div>
                <div className="text-[11.5px] text-[var(--au-muted)]">
                  {new Date(event.createdAt).toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-[var(--au-muted)]" />
        </div>
      )}
    </AuPage>
  );
}

function giftEventLabel(eventType: string, t: (key: string) => string): string {
  switch (eventType) {
    case "PURCHASED":
      return t("aurora.gift_event_purchased");
    case "CODE_CREATED":
      return t("aurora.gift_event_code_created");
    case "CODE_REDEEMED":
    case "GIFT_SENT":
      return t("aurora.gift_event_code_redeemed");
    case "GIFT_RECEIVED":
      return t("aurora.gift_event_received");
    case "ACTIVATED_SELF":
      return t("aurora.gift_event_activated_self");
    case "CODE_CANCELLED":
      return t("aurora.gift_event_code_cancelled");
    case "CODE_EXPIRED":
      return t("aurora.gift_event_code_expired");
    case "DELETED":
      return t("aurora.gift_event_deleted");
    default:
      return eventType;
  }
}
