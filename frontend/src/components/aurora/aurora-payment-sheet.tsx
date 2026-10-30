import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, CreditCard, Loader2, Wallet } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useClientAuth } from "@/contexts/client-auth";
import { AuroraSheet } from "@/components/aurora/aurora-sheet";
import { PayNowPanel } from "@/components/payment/pay-now-panel";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { startCheckout, type CheckoutMethod, type CheckoutProduct } from "@/lib/cabinet-checkout";

interface Props {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  product: CheckoutProduct;
  methods: CheckoutMethod[];
  amountText?: string;
  payLabel?: string;
  /** Тип покупки для страницы ожидания платежа. */
  waitKind?: "topup" | "tariff" | "proxy" | "singbox" | "option" | "generic";
  onSuccess?: () => void;
  children?: ReactNode;
}

export function AuroraPaymentSheet({
  open,
  onClose,
  title,
  product,
  methods,
  amountText,
  payLabel,
  waitKind = "generic",
  onSuccess,
  children,
}: Props) {
  const { t } = useTranslation();
  const { state, refreshProfile } = useClientAuth();
  const navigate = useNavigate();
  const token = state.token;

  const [methodId, setMethodId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState<{ url: string; provider: string; paymentId?: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
  }, [open]);

  useEffect(() => {
    if (methods.length === 0) return;
    if (!methods.some((m) => m.id === methodId)) setMethodId(methods[0].id);
  }, [methods, methodId]);

  function handleClose() {
    if (loading) return;
    setReady(null);
    setError(null);
    onClose();
  }

  function finish() {
    setReady(null);
    handleClose();
    onSuccess?.();
    refreshProfile().catch(() => {});
  }

  async function pay() {
    if (!token || loading) return;
    const method = methods.find((m) => m.id === methodId);
    if (!method) {
      setError(t("aurora.pay_choose_method"));
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await startCheckout(token, method, product);
      if (res.balanceApplied) {
        toast.success(res.message || t("aurora.pay_balance_done"));
        finish();
        return;
      }
      if (!res.url) {
        setError(t("aurora.pay_no_url"));
        return;
      }
      setReady({ url: res.url, provider: res.provider ?? method.label, paymentId: res.paymentId });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("aurora.pay_error"));
    } finally {
      setLoading(false);
    }
  }

  function onPaid() {
    const payment = ready;
    if (payment?.paymentId) {
      const id = payment.paymentId;
      const url = payment.url;
      const provider = payment.provider;
      finish();
      navigate(`/cabinet/payment-wait?id=${encodeURIComponent(id)}&kind=${waitKind}`, { state: { url, provider } });
      return;
    }
    toast.success(t("aurora.pay_created"));
    finish();
  }

  return (
    <AuroraSheet
      open={open}
      onClose={handleClose}
      title={title}
      footer={
        !ready ? (
          <button
            type="button"
            onClick={pay}
            disabled={loading || methods.length === 0}
            className="flex w-full items-center justify-center gap-2 rounded-[20px] bg-[linear-gradient(135deg,var(--au-from),var(--au-to))] px-5 py-4 text-[16px] font-bold text-white shadow-md transition-transform enabled:active:scale-[0.99] disabled:opacity-45"
          >
            {loading && <Loader2 className="h-[18px] w-[18px] animate-spin" />}
            {loading ? t("aurora.pay_creating") : payLabel ?? (amountText ? t("aurora.pay_for", { amount: amountText }) : t("aurora.pay"))}
          </button>
        ) : undefined
      }
    >
      {ready ? (
        <div className="py-2">
          <PayNowPanel
            url={ready.url}
            provider={ready.provider}
            onBack={() => setReady(null)}
            onPaid={onPaid}
          />
        </div>
      ) : (
        <div className="space-y-4 pb-2">
          {children}
          {methods.length > 0 ? (
            <div className="space-y-2">
              <p className="px-1 text-[13px] font-semibold text-[var(--au-muted)]">{t("aurora.pay_method")}</p>
              {methods.map((m) => {
                const selected = m.id === methodId;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      setMethodId(m.id);
                      setError(null);
                    }}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-[18px] border-2 p-3 text-left transition-all active:scale-[0.99]",
                      selected
                        ? "border-[var(--au-from)] bg-[var(--au-surface)]"
                        : "border-transparent bg-[var(--au-surface)] hover:border-black/5 dark:hover:border-white/10",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors",
                        selected
                          ? "bg-[linear-gradient(135deg,var(--au-from),var(--au-to))] text-white"
                          : "bg-[var(--au-bg)] text-[var(--au-muted)]",
                      )}
                    >
                      {m.kind === "balance" ? <Wallet className="h-5 w-5" /> : <CreditCard className="h-5 w-5" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14.5px] font-bold text-[var(--au-ink)]">{m.label}</span>
                      {m.subLabel && <span className="block truncate text-[12px] text-[var(--au-muted)]">{m.subLabel}</span>}
                    </span>
                    <span
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                        selected ? "border-[var(--au-from)] bg-[var(--au-from)]" : "border-[var(--au-muted)]",
                      )}
                    >
                      {selected && <span className="h-2 w-2 rounded-full bg-white" />}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded-[18px] bg-[var(--au-surface)] p-4 text-center text-[13px] text-[var(--au-muted)]">
              {t("aurora.pay_unavailable")}
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-[16px] border border-red-500/25 bg-red-500/10 p-3.5 text-[13px] text-red-600 dark:text-red-400">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>
      )}
    </AuroraSheet>
  );
}
