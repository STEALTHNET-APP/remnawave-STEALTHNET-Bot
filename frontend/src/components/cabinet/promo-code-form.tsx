import { useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { useInvalidateClientData } from "@/lib/queries";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function PromoCodeForm({ onActivated }: { onActivated?: () => void }) {
  const { state, refreshProfile } = useClientAuth();
  const invalidate = useInvalidateClientData();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const id = useId();
  const lock = useRef(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ message: string; error?: boolean; discount?: boolean } | null>(null);

  async function activate(event: React.FormEvent) {
    event.preventDefault();
    if (!state.token || !code.trim() || lock.current) return;
    lock.current = true;
    setBusy(true);
    setResult(null);
    try {
      const checked = await api.clientCheckPromoCode(state.token, code.trim());
      if (checked.type === "DISCOUNT") {
        setResult({ message: t("homePromo.discount"), discount: true });
      } else {
        const activated = await api.clientActivatePromoCode(state.token, code.trim());
        setResult({ message: activated.message });
        setCode("");
        invalidate();
        await refreshProfile().catch(() => {});
        onActivated?.();
      }
    } catch (error) {
      setResult({ error: true, message: error instanceof Error ? error.message : t("homePromo.failed") });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <form onSubmit={activate} className="space-y-3">
      <Label htmlFor={id}>{t("homePromo.title")}</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input id={id} value={code} disabled={busy} autoComplete="off" maxLength={100}
          placeholder={t("homePromo.placeholder")}
          onChange={(event) => { setCode(event.target.value); setResult(null); }} />
        <Button type="submit" disabled={busy || !code.trim() || !state.token}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t("homePromo.activate")}
        </Button>
      </div>
      {result && <p role={result.error ? "alert" : "status"} className={result.error ? "text-sm text-destructive" : "text-sm"}>{result.message}</p>}
      {result?.discount && <Button type="button" variant="outline"
        onClick={() => navigate("/cabinet/tariffs", { state: { promoCode: code.trim() } })}>
        {t("homePromo.tariffs")}
      </Button>}
    </form>
  );
}
