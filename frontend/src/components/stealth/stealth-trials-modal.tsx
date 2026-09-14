/**
 * StealthTrialsModal — выбор и активация пробного периода в Stealth-дизайне.
 *
 * Аналог TrialsPickerDialog из классик-кабинета, но в стилистике стелс:
 * zinc-900 карточки, rose-акценты, rounded-2xl. Активация — сразу по клику
 * на карточку триала (название, длительность, трафик, устройства, описание).
 */

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { reducedMotion } from "@/lib/gsap-utils";
import { Gift, Sparkles, Clock, Wifi, Smartphone, Loader2, AlertCircle, Infinity as InfinityIcon } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { api, type ClientTrialOption } from "@/lib/api";
import { formatRuDays } from "@/lib/i18n";
import { StealthModal } from "./stealth-modal";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Колбэк после успешной активации — родитель обновляет дашборд (reloadKey). */
  onActivated?: () => void;
}

function formatTrafficLabel(bytesStr: string | null): string {
  if (bytesStr === null) return "Безлимит";
  const bytes = Number(bytesStr);
  if (!Number.isFinite(bytes) || bytes <= 0) return "Безлимит";
  if (bytes >= 1024 ** 3) {
    const gb = bytes / 1024 ** 3;
    return `${gb % 1 === 0 ? gb.toFixed(0) : gb.toFixed(1)} ГБ`;
  }
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} МБ`;
  return `${(bytes / 1024).toFixed(0)} КБ`;
}

export function StealthTrialsModal({ open, onClose, onActivated }: Props) {
  const { state, refreshProfile } = useClientAuth();
  const [items, setItems] = useState<ClientTrialOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activatingId, setActivatingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !state.token) return;
    let alive = true;
    setLoading(true);
    setError(null);
    setActivatingId(null);
    api.getClientAvailableTrials(state.token)
      .then((res) => { if (alive) setItems(res.items); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : "Не удалось загрузить пробники"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, state.token]);

  // Появление карточек триалов — gsap stagger вместо framer-motion
  // AnimatePresence (re-run при каждом открытии модалки → без застревания).
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = listRef.current;
    if (!el || items.length === 0 || reducedMotion()) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        el.children,
        { y: 8, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.25, stagger: 0.04, ease: "power2.out", clearProps: "transform" },
      );
    }, el);
    return () => ctx.revert();
  }, [items]);

  async function activate(trial: ClientTrialOption) {
    if (!state.token || activatingId) return;
    setActivatingId(trial.id);
    setError(null);
    try {
      await api.clientActivateTrialById(state.token, trial.id);
      await refreshProfile().catch(() => {});
      onActivated?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось активировать пробник");
    } finally {
      setActivatingId(null);
    }
  }

  return (
    <StealthModal open={open} onClose={onClose} title="🎁 Пробный период">
      <div className="space-y-3">
        <p className="text-xs text-zinc-500 -mt-2">
          Каждый пробник можно взять только один раз. Нажми на карточку, чтобы активировать.
        </p>

        {loading && (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
          </div>
        )}

        {!loading && error && (
          <div className="rounded-xl border border-saccent-500/30 bg-saccent-500/10 p-3 flex items-start gap-2 text-xs">
            <AlertCircle className="h-4 w-4 text-saccent-400 shrink-0 mt-0.5" />
            <span className="text-saccent-200">{error}</span>
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <div className="py-8 text-center">
            <Sparkles className="h-8 w-8 mx-auto text-zinc-600 mb-3" />
            <p className="text-sm text-zinc-500">
              Ты уже воспользовался всеми пробниками. Хочешь больше — оформи тариф.
            </p>
          </div>
        )}

        {!loading && items.length > 0 && (
          <div ref={listRef} className="space-y-2.5">
              {items.map((trial) => {
                const isActivating = activatingId === trial.id;
                const isDisabled = activatingId !== null && !isActivating;
                const traffic = formatTrafficLabel(trial.trafficLimitBytes);
                const devices = trial.deviceLimit ?? trial.includedDevices ?? null;
                return (
                  <button
                    key={trial.id}
                    type="button"
                    onClick={() => activate(trial)}
                    disabled={isDisabled || isActivating}
                    className={cn(
                      "w-full text-left rounded-2xl border bg-white/[0.03] border-white/[0.07] p-4 transition",
                      "hover:border-saccent-500/40 hover:bg-saccent-500/[0.06] active:scale-[0.99]",
                      isDisabled && "opacity-50 pointer-events-none",
                      isActivating && "border-saccent-500/40 bg-saccent-500/[0.06]",
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <span className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-saccent-500/15 border border-saccent-500/30">
                        {isActivating
                          ? <Loader2 className="h-5 w-5 text-saccent-400 animate-spin" />
                          : <Gift className="h-5 w-5 text-saccent-400" />}
                      </span>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-bold tracking-tight leading-tight">
                          {trial.name}
                        </h4>
                        {trial.tariffName && (
                          <p className="text-[11px] text-zinc-500 mt-0.5">
                            На базе тарифа «{trial.tariffName}»
                          </p>
                        )}
                        {trial.description && (
                          <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">
                            {trial.description}
                          </p>
                        )}
                        <div className="flex flex-wrap gap-1.5 mt-2.5">
                          <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.04] border border-white/[0.06] px-2.5 py-1 text-[11px] text-zinc-200">
                            <Clock className="h-3 w-3 text-saccent-400/80" />
                            {formatRuDays(trial.durationDays)}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.04] border border-white/[0.06] px-2.5 py-1 text-[11px] text-zinc-200">
                            {trial.trafficLimitBytes === null
                              ? <InfinityIcon className="h-3 w-3 text-saccent-400/80" />
                              : <Wifi className="h-3 w-3 text-saccent-400/80" />}
                            {traffic}
                          </span>
                          {devices !== null && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.04] border border-white/[0.06] px-2.5 py-1 text-[11px] text-zinc-200">
                              <Smartphone className="h-3 w-3 text-saccent-400/80" />
                              {devices === 1 ? "1 устройство" : `${devices} устройств${devices >= 5 ? "" : "а"}`}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
          </div>
        )}
      </div>
    </StealthModal>
  );
}
