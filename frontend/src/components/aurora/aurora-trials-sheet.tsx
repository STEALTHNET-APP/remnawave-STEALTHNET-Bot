import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Clock, Gift, Infinity as InfinityIcon, Loader2, Smartphone, Wifi } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { api, type ClientTrialOption } from "@/lib/api";
import { AuroraSheet } from "@/components/aurora/aurora-sheet";
import { AuBadge, AuButton, AuEmpty, AuNotice } from "@/components/aurora/aurora-ui";
import { formatCheckoutAmount } from "@/lib/cabinet-checkout";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
  onActivated?: () => void;
}

function trafficLabel(bytes: string | null, t: (key: string) => string): string {
  if (bytes == null) return t("aurora.unlimited");
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return t("aurora.unlimited");
  if (value >= 1024 ** 3) {
    const gb = value / 1024 ** 3;
    return `${gb % 1 === 0 ? gb.toFixed(0) : gb.toFixed(1)} ${t("aurora.gb")}`;
  }
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(0)} ${t("aurora.mb")}`;
  return `${(value / 1024).toFixed(0)} ${t("aurora.kb")}`;
}

export function AuroraTrialsSheet({ open, onClose, onActivated }: Props) {
  const { t, i18n } = useTranslation();
  const { state, refreshProfile } = useClientAuth();
  const token = state.token;
  const [items, setItems] = useState<ClientTrialOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [activating, setActivating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!open || !token) return;
    let alive = true;
    setLoading(true);
    setError(null);
    api.getClientAvailableTrials(token)
      .then((res) => {
        if (alive) setItems(res.items ?? []);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : t("aurora.trial_load_error"));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, token, t, reloadKey]);

  async function activate(trial: ClientTrialOption) {
    if (!token || activating) return;
    const price = trial.price ?? 0;
    const amount = formatCheckoutAmount(price, "RUB", i18n.language);
    if (price > 0 && !window.confirm(t("aurora.trial_confirm_paid", { name: trial.name, amount }))) return;
    setActivating(trial.id);
    setError(null);
    try {
      await api.clientActivateTrialById(token, trial.id, price);
      await refreshProfile().catch(() => {});
      onActivated?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("aurora.trial_error"));
    } finally {
      setActivating(null);
    }
  }

  return (
    <AuroraSheet open={open} onClose={activating ? () => {} : onClose} title={t("aurora.trials")}>
      <div className="space-y-3 pb-2">
        <p className="text-[13px] leading-snug text-[var(--au-muted)]">{t("aurora.trials_hint")}</p>
        {loading && (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-[var(--au-muted)]" />
          </div>
        )}
        {!loading && error && (
          <div className="space-y-2">
            <AuNotice tone="error">{error}</AuNotice>
            <AuButton variant="surface" onClick={() => setReloadKey((value) => value + 1)}>
              {t("aurora.retry")}
            </AuButton>
          </div>
        )}
        {!loading && !error && items.length === 0 && (
          <AuEmpty
            icon={<Gift className="h-6 w-6" />}
            title={t("aurora.trials_empty_title")}
            hint={t("aurora.trials_empty_hint")}
          />
        )}
        {!loading &&
          items.map((trial) => {
            const devices = trial.deviceLimit ?? trial.includedDevices;
            const price = trial.price ?? 0;
            const busy = activating === trial.id;
            return (
              <button
                key={trial.id}
                type="button"
                onClick={() => void activate(trial)}
                disabled={activating !== null}
                aria-busy={busy}
                className={cn(
                  "w-full cursor-pointer rounded-[20px] border border-transparent bg-[var(--au-surface)] p-4 text-left transition-all active:scale-[0.98] hover:border-[var(--au-from)]/30 disabled:cursor-default disabled:opacity-60 disabled:active:scale-100",
                  busy && "border-[var(--au-from)]/40",
                )}
              >
                <div className="flex items-start gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--au-bg)] text-[var(--au-from)]">
                    {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Gift className="h-5 w-5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[16px] font-bold text-[var(--au-ink)]">{trial.name}</h3>
                      {price > 0 && <AuBadge tone="accent">{formatCheckoutAmount(price, "RUB", i18n.language)}</AuBadge>}
                    </div>
                    {trial.tariffName && (
                      <p className="mt-0.5 text-[12.5px] text-[var(--au-muted)]">{t("aurora.trial_based_on", { name: trial.tariffName })}</p>
                    )}
                    {trial.description && <p className="mt-2 text-[13px] leading-snug text-[var(--au-muted)]">{trial.description}</p>}
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      <AuBadge>
                        <Clock className="h-3 w-3" />
                        {t("aurora.trial_days", { count: trial.durationDays })}
                      </AuBadge>
                      <AuBadge>
                        {trial.trafficLimitBytes === null ? <InfinityIcon className="h-3 w-3" /> : <Wifi className="h-3 w-3" />}
                        {trafficLabel(trial.trafficLimitBytes, t)}
                      </AuBadge>
                      {devices != null && (
                        <AuBadge>
                          <Smartphone className="h-3 w-3" />
                          {t("aurora.trial_devices", { count: devices })}
                        </AuBadge>
                      )}
                    </div>
                  </div>
                </div>
                <span
                  className={cn(
                    "mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-[16px] px-4 text-[14px] font-bold",
                    price > 0 ? "bg-[var(--au-from)] text-white" : "bg-[var(--au-bg)] text-[var(--au-ink)]",
                  )}
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  {price > 0
                    ? t("aurora.trial_buy_for", { amount: formatCheckoutAmount(price, "RUB", i18n.language) })
                    : t("aurora.trial_activate")}
                </span>
              </button>
            );
          })}
      </div>
    </AuroraSheet>
  );
}
