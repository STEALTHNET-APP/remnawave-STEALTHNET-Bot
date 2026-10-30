import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Loader2, Ticket } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { useInvalidateClientData } from "@/lib/queries";
import { api } from "@/lib/api";
import { AuroraSheet } from "@/components/aurora/aurora-sheet";
import { AuButton, AuInput, AuNotice } from "@/components/aurora/aurora-ui";
import { toast } from "@/components/ui/toast";

export function AuroraPromoSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { state, refreshProfile } = useClientAuth();
  const invalidate = useInvalidateClientData();
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ message: string; error?: boolean; discount?: boolean } | null>(null);

  async function submit() {
    const token = state.token;
    const trimmed = code.trim();
    if (!token || !trimmed || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const checked = await api.clientCheckPromoCode(token, trimmed);
      if (checked.type === "DISCOUNT") {
        const parts: string[] = [];
        if (checked.discountPercent) parts.push(`${checked.discountPercent}%`);
        if (checked.discountFixed) parts.push(`${checked.discountFixed}`);
        setResult({
          discount: true,
          message: t("aurora.promo_discount", { value: parts.join(" / ") || "—" }),
        });
        return;
      }
      const activated = await api.clientActivatePromoCode(token, trimmed);
      setResult({ message: activated.message });
      setCode("");
      invalidate();
      await refreshProfile().catch(() => {});
      toast.success(t("aurora.promo_activated"));
    } catch (e) {
      setResult({ error: true, message: e instanceof Error ? e.message : t("aurora.promo_error") });
    } finally {
      setBusy(false);
    }
  }

  function useDiscount() {
    const trimmed = code.trim();
    if (!trimmed) return;
    onClose();
    navigate("/cabinet/tariffs", { state: { promoCode: trimmed } });
  }

  return (
    <AuroraSheet
      open={open}
      onClose={busy ? () => {} : onClose}
      title={
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--au-surface)] text-[var(--au-from)]">
            <Ticket className="h-4 w-4" />
          </span>
          <span>{t("aurora.promo")}</span>
        </div>
      }
      footer={
        <AuButton onClick={submit} disabled={busy || !code.trim()}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {t("aurora.promo_check")}
        </AuButton>
      }
    >
      <div className="space-y-3 pb-2">
        <p className="text-[13px] leading-snug text-[var(--au-muted)]">{t("aurora.promo_hint")}</p>
        <AuInput
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setResult(null);
          }}
          placeholder={t("aurora.promo_placeholder")}
          autoComplete="off"
          maxLength={100}
        />
        {result && <AuNotice tone={result.error ? "error" : "success"}>{result.message}</AuNotice>}
        {result?.discount && <AuButton variant="surface" onClick={useDiscount}>{t("aurora.promo_to_tariffs")}</AuButton>}
      </div>
    </AuroraSheet>
  );
}
