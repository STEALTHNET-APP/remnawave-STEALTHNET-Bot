import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Banknote, Loader2 } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { useCabinetConfig } from "@/contexts/cabinet-config";
import { api } from "@/lib/api";
import { formatAuroraBalance } from "@/lib/aurora-profile";
import { AuroraSheet } from "@/components/aurora/aurora-sheet";
import { AuButton, AuInput, AuNotice } from "@/components/aurora/aurora-ui";
import { toast } from "@/components/ui/toast";

type WithdrawalMethod = "sbp" | "card" | "usdt";

export function AuroraWithdrawSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { state, refreshProfile } = useClientAuth();
  const config = useCabinetConfig();
  const token = state.token ?? null;
  const balance = state.client?.balance ?? 0;
  const currency = (state.client?.preferredCurrency ?? "rub").toUpperCase();
  const locale = i18n.language || "ru";
  const min = config?.withdrawalMinAmount ?? 3000;
  const methods: WithdrawalMethod[] = (config?.withdrawalMethods as WithdrawalMethod[] | undefined) ?? ["sbp", "card", "usdt"];

  const [method, setMethod] = useState<WithdrawalMethod>("usdt");
  const [details, setDetails] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeMethod = methods.includes(method) ? method : (methods[0] ?? "usdt");
  const detailsLabel = t(`aurora.withdraw_details_${activeMethod}`);
  const detailsPlaceholder = activeMethod === "sbp"
    ? "+79991234567, Сбербанк"
    : activeMethod === "card" ? "0000 0000 0000 0000" : "T...";

  function reset() {
    setDetails("");
    setAmount("");
    setError(null);
  }

  async function submit() {
    if (!token || busy) return;
    const value = Math.floor(Number(amount.replace(",", ".")));
    if (!Number.isFinite(value) || value < min) {
      setError(t("aurora.withdraw_min", { amount: min }));
      return;
    }
    if (value > balance) {
      setError(t("aurora.withdraw_no_money"));
      return;
    }
    const valueDetails = details.trim();
    if (activeMethod === "usdt" && !/^T[A-Za-z0-9]{33}$/.test(valueDetails)) {
      setError(t("aurora.withdraw_wallet_error"));
      return;
    }
    if (activeMethod === "card" && !/^\d{16,19}$/.test(valueDetails.replace(/[\s-]/g, ""))) {
      setError(t("aurora.withdraw_card_error"));
      return;
    }
    if (activeMethod === "sbp" && (!valueDetails.includes(",") || valueDetails.split(",").slice(1).join(",").trim().length < 2)) {
      setError(t("aurora.withdraw_sbp_error"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.createWithdrawal(token, { amount: value, method: activeMethod, details: valueDetails });
      toast.success(t("aurora.withdraw_done"), res.message);
      reset();
      onClose();
      refreshProfile().catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : t("aurora.withdraw_error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuroraSheet
      open={open}
      onClose={busy ? () => {} : onClose}
      title={
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--au-surface)] text-[var(--au-from)]">
            <Banknote className="h-4 w-4" />
          </span>
          <span>{t("aurora.withdraw_title")}</span>
        </div>
      }
      footer={
        <AuButton onClick={submit} disabled={busy || !details.trim() || !amount.trim()}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {t("aurora.withdraw_submit")}
        </AuButton>
      }
    >
      <div className="space-y-3 pb-2">
        <div className="flex items-center justify-between rounded-[16px] bg-[var(--au-surface)] px-4 py-3 text-[13.5px]">
          <span className="text-[var(--au-muted)]">{t("aurora.balance")}</span>
          <span className="font-bold tabular-nums text-[var(--au-ink)]">{formatAuroraBalance(balance, currency, locale)}</span>
        </div>
        {methods.length > 1 && (
          <div className="space-y-1.5">
            <label className="px-1 text-[13px] font-semibold text-[var(--au-muted)]">{t("aurora.withdraw_method")}</label>
            <div className="grid grid-cols-3 gap-1 rounded-[16px] bg-[var(--au-surface)] p-1">
              {methods.map((item) => (
                <button
                  key={item}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setMethod(item);
                    setDetails("");
                    setError(null);
                  }}
                  className={`rounded-[12px] px-2 py-2 text-[12.5px] font-semibold transition-colors ${activeMethod === item ? "bg-[var(--au-from)] text-white" : "text-[var(--au-muted)]"}`}
                >
                  {t(`aurora.withdraw_method_${item}`)}
                </button>
              ))}
            </div>
          </div>
        )}
        {methods.length === 1 && (
          <p className="px-1 text-[12.5px] text-[var(--au-muted)]">
            {t("aurora.withdraw_method")}: <span className="font-semibold text-[var(--au-ink)]">{t(`aurora.withdraw_method_${activeMethod}`)}</span>
          </p>
        )}
        <div className="space-y-1.5">
          <label className="px-1 text-[13px] font-semibold text-[var(--au-muted)]" htmlFor="au-withdraw-details">
            {detailsLabel}
          </label>
          <AuInput
            id="au-withdraw-details"
            value={details}
            onChange={(e) => {
              const value = activeMethod === "card"
                ? e.target.value.replace(/\D/g, "").slice(0, 19).replace(/(\d{4})(?=\d)/g, "$1 ")
                : e.target.value;
              setDetails(value);
              setError(null);
            }}
            placeholder={detailsPlaceholder}
            autoComplete="off"
            className={activeMethod === "usdt" ? "font-mono" : undefined}
            disabled={busy}
          />
          <p className="px-1 text-[11.5px] text-[var(--au-muted)]">{t(`aurora.withdraw_details_${activeMethod}_hint`)}</p>
        </div>
        <div className="space-y-1.5">
          <label className="px-1 text-[13px] font-semibold text-[var(--au-muted)]" htmlFor="au-withdraw-amount">
            {t("aurora.withdraw_amount", { min })}
          </label>
          <AuInput
            id="au-withdraw-amount"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value.replace(/[^\d.,]/g, ""));
              setError(null);
            }}
            inputMode="decimal"
            placeholder={String(min)}
            disabled={busy}
          />
        </div>
        {error && <AuNotice tone="error">{error}</AuNotice>}
        <AuNotice>{t("aurora.withdraw_hint")}</AuNotice>
      </div>
    </AuroraSheet>
  );
}
