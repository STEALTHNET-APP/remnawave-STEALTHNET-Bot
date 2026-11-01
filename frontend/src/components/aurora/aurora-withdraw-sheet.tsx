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

export function AuroraWithdrawSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { state, refreshProfile } = useClientAuth();
  const config = useCabinetConfig();
  const token = state.token ?? null;
  const balance = state.client?.balance ?? 0;
  const currency = (state.client?.preferredCurrency ?? "rub").toUpperCase();
  const locale = i18n.language || "ru";
  const min = config?.withdrawalMinAmount ?? 3000;

  const [wallet, setWallet] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setWallet("");
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
    const address = wallet.trim();
    if (!/^T[A-Za-z0-9]{33}$/.test(address)) {
      setError(t("aurora.withdraw_wallet_error"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.createWithdrawal(token, { amount: value, walletTrc20: address });
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
        <AuButton onClick={submit} disabled={busy || !wallet.trim() || !amount.trim()}>
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
        <div className="space-y-1.5">
          <label className="px-1 text-[13px] font-semibold text-[var(--au-muted)]" htmlFor="au-withdraw-wallet">
            {t("aurora.withdraw_wallet")}
          </label>
          <AuInput
            id="au-withdraw-wallet"
            value={wallet}
            onChange={(e) => {
              setWallet(e.target.value);
              setError(null);
            }}
            placeholder="T..."
            autoComplete="off"
            className="font-mono"
            disabled={busy}
          />
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
