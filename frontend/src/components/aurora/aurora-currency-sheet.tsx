import { useEffect, useState } from "react";
import { Check, Coins, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useClientAuth } from "@/contexts/client-auth";
import { getPublicConfigCached } from "@/lib/public-config";
import { api } from "@/lib/api";
import { AuroraSheet } from "@/components/aurora/aurora-sheet";
import { AuNotice } from "@/components/aurora/aurora-ui";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function AuroraCurrencySheet({ open, onClose }: Props) {
  const { t } = useTranslation();
  const { state, refreshProfile } = useClientAuth();
  const [codes, setCodes] = useState<string[]>(["rub", "usd"]);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = (state.client?.preferredCurrency ?? "rub").toLowerCase();

  useEffect(() => {
    getPublicConfigCached()
      .then((config) => {
        const list = (config as { activeCurrencies?: string[] })?.activeCurrencies;
        if (Array.isArray(list) && list.length > 0) setCodes(list);
      })
      .catch(() => {});
  }, []);

  async function choose(code: string) {
    if (!state.token || saving) return;
    setError(null);
    setSaving(code);
    try {
      await api.clientUpdateProfile(state.token, { preferredCurrency: code });
      await refreshProfile().catch(() => {});
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("aurora.currency_error"));
    } finally {
      setSaving(null);
    }
  }

  return (
    <AuroraSheet
      open={open}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--au-surface)] text-[var(--au-from)]">
            <Coins className="h-4 w-4" />
          </span>
          <span>{t("aurora.currency")}</span>
        </div>
      }
    >
      <div className="space-y-3 pb-3">
        <p className="px-1 text-[13px] text-[var(--au-muted)]">{t("aurora.choose_currency")}</p>
        {error && <AuNotice tone="error">{error}</AuNotice>}
        <div className="au-card overflow-hidden p-0">
          {codes.map((code) => {
            const selected = code.toLowerCase() === current;
            return (
              <button
                key={code}
                type="button"
                onClick={() => void choose(code)}
                disabled={saving !== null}
                className="flex w-full items-center gap-3 border-b border-[color-mix(in_srgb,var(--au-muted)_16%,transparent)] px-4 py-3.5 text-left last:border-b-0 disabled:opacity-60"
              >
                <span className="flex-1 text-[15px] font-semibold text-[var(--au-ink)]">{code.toUpperCase()}</span>
                {saving === code ? (
                  <Loader2 className="h-5 w-5 animate-spin text-[var(--au-from)]" />
                ) : (
                  <span className={cn("flex h-6 w-6 items-center justify-center rounded-full border-2", selected ? "border-[var(--au-from)] bg-[var(--au-from)] text-white" : "border-[var(--au-muted)]/40")}>
                    {selected && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </AuroraSheet>
  );
}
