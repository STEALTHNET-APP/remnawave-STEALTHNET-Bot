/**
 * Модалка выбора пробного периода для клиента.
 *
 * Показывает список доступных триалов (api.getClientAvailableTrials) в виде красивых
 * карточек с градиентами. Клиент выбирает один → активация → onActivated() → close.
 */

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Gift, Sparkles, Clock, Wifi, Smartphone, Loader2, Check, Infinity as InfinityIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { api, type ClientTrialOption } from "@/lib/api";
import { formatRuDays } from "@/lib/i18n";

interface TrialsPickerDialogProps {
  open: boolean;
  token: string | null;
  onOpenChange: (open: boolean) => void;
  /** Вызывается после успешной активации триала. Получатель обновляет dashboard. */
  onActivated: (response: { message: string; subscriptionId: string; subscriptionUrl: string | null }) => void;
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

// Градиенты по индексу — циклически проходим, чтобы карточки выглядели разнообразно.
const CARD_GRADIENTS = [
  "bg-transparent border-emerald-500/30",
  "bg-transparent border-violet-500/30",
  "bg-transparent border-sky-500/30",
  "bg-transparent border-amber-500/30",
  "bg-transparent border-pink-500/30",
];

const ICON_BG = [
  "bg-emerald-500/15 text-emerald-500",
  "bg-violet-500/15 text-violet-500",
  "bg-sky-500/15 text-sky-500",
  "bg-amber-500/15 text-amber-500",
  "bg-pink-500/15 text-pink-500",
];

export function TrialsPickerDialog({ open, token, onOpenChange, onActivated }: TrialsPickerDialogProps) {
  const [items, setItems] = useState<ClientTrialOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activatingId, setActivatingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !token) return;
    setLoading(true);
    setError(null);
    api.getClientAvailableTrials(token)
      .then((res) => setItems(res.items))
      .catch((e) => setError(e instanceof Error ? e.message : "Не удалось загрузить пробники"))
      .finally(() => setLoading(false));
  }, [open, token]);

  async function handleActivate(trial: ClientTrialOption) {
    if (!token || activatingId) return;
    setActivatingId(trial.id);
    setError(null);
    try {
      const res = await api.clientActivateTrialById(token, trial.id);
      onActivated({ message: res.message, subscriptionId: res.subscriptionId, subscriptionUrl: res.subscriptionUrl });
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось активировать пробник");
    } finally {
      setActivatingId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden border-border/50 bg-card/95 backdrop-blur-xl">
        {/* Декоративные blur-блобы — pointer-events-none чтобы не перекрывали крестик закрытия. */}
        <div className="absolute top-0 right-0 -mr-16 -mt-16 w-48 h-48 rounded-full bg-emerald-500/15 blur-[80px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 -ml-16 -mb-16 w-40 h-40 rounded-full bg-violet-500/15 blur-[80px] pointer-events-none" />

        <DialogHeader className="relative z-10 p-6 pb-2 text-left">
            <div className="flex items-center gap-3 mb-1">
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-primary shadow-lg shadow-emerald-500/30">
                <Gift className="h-5 w-5 text-white" />
              </div>
              <div>
                <DialogTitle className="text-2xl font-bold tracking-tight">Выбери пробник</DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground mt-0.5">
                  Каждый можно взять только один раз
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="px-6 pb-6 pt-4 max-h-[60vh] overflow-y-auto">
            {loading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}

            {!loading && error && (
              <div className="p-4 rounded-2xl bg-destructive/10 border border-destructive/30 text-destructive text-sm">
                {error}
              </div>
            )}

            {!loading && !error && items.length === 0 && (
              <div className="py-10 text-center">
                <Sparkles className="h-8 w-8 mx-auto text-muted-foreground/40 mb-3" />
                <p className="text-sm text-muted-foreground">
                  Ты уже воспользовался всеми пробниками. Хочешь больше — оформи тариф.
                </p>
              </div>
            )}

            {!loading && !error && items.length > 0 && (
              <div className="grid gap-3">
                <AnimatePresence>
                  {items.map((trial, idx) => {
                    const isActivating = activatingId === trial.id;
                    const isDisabled = activatingId !== null && !isActivating;
                    const gradient = CARD_GRADIENTS[idx % CARD_GRADIENTS.length];
                    const iconBg = ICON_BG[idx % ICON_BG.length];
                    const traffic = formatTrafficLabel(trial.trafficLimitBytes);
                    const devices = trial.deviceLimit ?? trial.includedDevices ?? null;
                    return (
                      <motion.div
                        key={trial.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ duration: 0.22, delay: idx * 0.04 }}
                        className={`relative overflow-hidden rounded-2xl border  ${gradient} p-5 transition-all duration-300 ${isDisabled ? "opacity-50" : "hover:scale-[1.015] hover:shadow-xl"}`}
                      >
                        <div className="flex items-start gap-4">
                          <div className={`shrink-0 inline-flex h-12 w-12 items-center justify-center rounded-2xl ${iconBg}`}>
                            <Gift className="h-6 w-6" />
                          </div>

                          <div className="flex-1 min-w-0">
                            <h3 className="text-lg font-bold tracking-tight text-foreground leading-tight">
                              {trial.name}
                            </h3>
                            {trial.tariffName && (
                              <p className="text-[12px] text-muted-foreground mt-0.5">
                                На базе тарифа «{trial.tariffName}»
                              </p>
                            )}
                            {trial.description && (
                              <p className="text-sm text-muted-foreground/90 mt-2 leading-relaxed">
                                {trial.description}
                              </p>
                            )}

                            <div className="flex flex-wrap gap-2 mt-3">
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-background/60 px-3 py-1 text-xs font-medium text-foreground/90">
                                <Clock className="h-3.5 w-3.5" />
                                {formatRuDays(trial.durationDays)}
                              </span>
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-background/60 px-3 py-1 text-xs font-medium text-foreground/90">
                                {trial.trafficLimitBytes === null ? <InfinityIcon className="h-3.5 w-3.5" /> : <Wifi className="h-3.5 w-3.5" />}
                                {traffic}
                              </span>
                              {devices !== null && (
                                <span className="inline-flex items-center gap-1.5 rounded-full bg-background/60 px-3 py-1 text-xs font-medium text-foreground/90">
                                  <Smartphone className="h-3.5 w-3.5" />
                                  {devices === 1 ? "1 устройство" : `${devices} устройств${devices >= 5 ? "" : "а"}`}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <Button
                          className="w-full mt-4 gap-2 h-11 rounded-xl bg-foreground text-background hover:bg-foreground/90 font-semibold shadow-md [&_svg]:self-center [&_span]:leading-none"
                          onClick={() => handleActivate(trial)}
                          disabled={isDisabled || isActivating}
                        >
                          {isActivating ? (
                            <>
                              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                              <span>Активирую...</span>
                            </>
                          ) : (
                            <>
                              <Check className="h-4 w-4 shrink-0" />
                              <span>Активировать</span>
                            </>
                          )}
                        </Button>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            )}
          </div>
      </DialogContent>
    </Dialog>
  );
}
