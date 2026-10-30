import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Clock, Gift, Infinity as InfinityIcon, Loader2, Smartphone, Wifi } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { api, type ClientTrialOption } from "@/lib/api";
import { AuroraSheet } from "@/components/aurora/aurora-sheet";
import { AuBadge, AuButton, AuEmpty, AuNotice } from "@/components/aurora/aurora-ui";
import { formatCheckoutAmount } from "@/lib/cabinet-checkout";

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

export function AuroraTrialsSheet({
  open,
  onClose,
  onActivated,
}: {
  open: boolean;
  onClose: () => void;
  onActivated: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { state, refreshProfile } = useClientAuth();
  const token = state.token;
  const [items, setItems] = useState<ClientTrialOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [activating, setActivating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  }, [open, token, t]);

  async function activate(trial: ClientTrialOption) {
    if (!token || activating) return;
    setActivating(trial.id);
    setError(null);
    try {
      await api.clientActivateTrialById(token, trial.id, trial.price ?? 0);
      await refreshProfile().catch(() => {});
      onActivated();
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
        {error && <AuNotice tone="error">{error}</AuNotice>}
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
              <article key={trial.id} className="rounded-[22px] bg-[var(--au-bg)] p-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--au-surface)] text-[var(--au-from)]">
                    <Gift className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[15px] font-bold text-[var(--au-ink)]">{trial.name}</h3>
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
                <AuButton className="mt-3" onClick={() => activate(trial)} disabled={busy || activating !== null}>
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  {price > 0 ? t("aurora.trial_buy_for", { amount: formatCheckoutAmount(price, "RUB", i18n.language) }) : t("aurora.trial_activate")}
                </AuButton>
              </article>
            );
          })}
      </div>
    </AuroraSheet>
  );
}
