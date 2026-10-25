import { useEffect, useState, useCallback, useRef } from "react";
import { Sparkles, Clock, Gift, History, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useClientAuth } from "@/contexts/client-auth";
import { useInvalidateClientData } from "@/lib/queries";
import { api } from "@/lib/api";
import { toast } from "@/components/ui/toast";
import { RouletteWheel, type WheelSector } from "@/components/roulette/roulette-wheel";
import { cn } from "@/lib/utils";

interface RouletteStatusData {
  enabled: boolean;
  cooldownHours: number;
  resetMode?: "hours" | "daily";
  timeZone?: string;
  canSpin: boolean;
  pendingReward?: boolean;
  nextSpinAt: string | null;
  secondsLeft: number;
  sectors: WheelSector[];
  recentSpins: {
    id: string;
    rewardType: string;
    rewardValue: number;
    rewardLabel: string;
    sectorId: string;
    createdAt: string;
  }[];
  subscriptions?: {
    id: string;
    index: number;
    name: string;
    expireAt: string | null;
    isExpired: boolean;
    remnaStatus: string | null;
  }[];
}

function formatCountdown(sec: number): string {
  if (sec <= 0) return "00:00:00";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function AuroraRoulette() {
  const navigate = useNavigate();
  const { state, refreshProfile } = useClientAuth();
  const invalidateClientData = useInvalidateClientData();
  const [data, setData] = useState<RouletteStatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [secondsLeft, setSecondsLeft] = useState<number>(0);
  const [spinning, setSpinning] = useState(false);
  const awardedRef = useRef<WheelSector | null>(null);
  const [winSector, setWinSector] = useState<WheelSector | null>(null);
  const [selectedSubId, setSelectedSubId] = useState<string | null>(null);

  // Для защиты от манипуляций системным временем на клиенте
  // храним начальное серверное значение и точку отсчета через монотонный performance.now()
  const serverSecondsRef = useRef<number>(0);
  const startPerfRef = useRef<number>(0);

  const loadStatus = useCallback(async () => {
    if (!state.token) return;
    try {
      const res = await api.clientGetRoulette(state.token);
      setData(res as RouletteStatusData);
      if (res.subscriptions && res.subscriptions.length > 0) {
        setSelectedSubId((prev) => {
          if (prev && res.subscriptions!.some((s) => s.id === prev)) return prev;
          const active = res.subscriptions!.find((s) => !s.isExpired);
          return active ? active.id : res.subscriptions![0].id;
        });
      }
      const sec = res.secondsLeft || 0;
      serverSecondsRef.current = sec;
      startPerfRef.current = performance.now();
      setSecondsLeft(sec);
    } catch (e: any) {
      toast.error("Ошибка загрузки", e?.message || "Не удалось загрузить данные рулетки");
    } finally {
      setLoading(false);
    }
  }, [state.token]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // При возвращении в приложение / вкладку (после минимизации или перевода часов на телефоне)
  // немедленно перезапрашиваем авторитарный статус с сервера
  useEffect(() => {
    const handleSync = () => {
      if (document.visibilityState === "visible") {
        loadStatus();
      }
    };
    document.addEventListener("visibilitychange", handleSync);
    window.addEventListener("focus", handleSync);
    return () => {
      document.removeEventListener("visibilitychange", handleSync);
      window.removeEventListener("focus", handleSync);
    };
  }, [loadStatus]);

  // Таймер обратного отсчета на основе монотонного времени performance.now().
  // Перевод часов на телефоне вперед или назад никак не влияет на performance.now()
  useEffect(() => {
    if (secondsLeft <= 0) return;
    const interval = setInterval(() => {
      const elapsed = Math.floor((performance.now() - startPerfRef.current) / 1000);
      const remaining = Math.max(0, serverSecondsRef.current - elapsed);
      setSecondsLeft(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
        loadStatus();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [secondsLeft, loadStatus]);

  const handleSpin = async (): Promise<string | null> => {
    if (!state.token || !data?.canSpin || spinning) return null;
    setSpinning(true);
    try {
      const res = await api.clientSpinRoulette(state.token, selectedSubId || undefined);
      invalidateClientData();
      refreshProfile().catch(() => {});
      awardedRef.current = res.reward;
      return res.sectorId;
    } catch (e: any) {
      setSpinning(false);
      toast.error("Ошибка", e?.message || "Не удалось совершить вращение");
      // Перепроверяем статус с сервера на случай рассинхронизации или кулдауна
      loadStatus();
      return null;
    }
  };

  const handleFinished = (sector: WheelSector) => {
    setSpinning(false);
    setWinSector(awardedRef.current ?? sector);
    awardedRef.current = null;
    invalidateClientData();
    refreshProfile().catch(() => {});
    loadStatus();
  };

  const canSpin = Boolean(data?.canSpin && secondsLeft <= 0 && !spinning);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <Sparkles className="w-8 h-8 text-[var(--au-from)] animate-spin" />
        <p className="text-sm text-[var(--au-muted)] font-medium">Загружаем рулетку…</p>
      </div>
    );
  }

  if (data && !data.enabled) {
    return (
      <div className="rounded-[26px] bg-[var(--au-surface)] p-6 text-center space-y-3">
        <Sparkles className="w-10 h-10 text-[var(--au-muted)] mx-auto opacity-50" />
        <h2 className="text-lg font-bold">Рулетка временно отключена</h2>
        <p className="text-sm text-[var(--au-muted)]">
          Администратор приостановил работу рулетки. Загляните позже!
        </p>
        <button
          type="button"
          onClick={() => navigate("/cabinet/dashboard")}
          className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--au-from)]"
        >
          <ArrowLeft className="w-4 h-4" /> На главную
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-8">
      {/* ── Заголовок и карточка статуса ── */}
      <section className="relative overflow-hidden rounded-[26px] bg-[linear-gradient(135deg,var(--au-from),var(--au-to))] p-5 text-white shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">🎰</span>
              <h1 className="text-xl font-extrabold tracking-tight">Рулетка удачи</h1>
            </div>
            <p className="mt-1 text-xs text-white/85 leading-relaxed">
              Испытайте удачу раз в сутки и получайте призы: дни подписки, рубли и скидки!
            </p>
          </div>
          <span
            className={cn(
              "shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-bold",
              canSpin ? "bg-emerald-500/80 text-white" : "bg-black/30 text-white/90"
            )}
          >
            <span
              className={cn(
                "w-2 h-2 rounded-full",
                canSpin ? "bg-white animate-pulse" : "bg-amber-300"
              )}
            />
            {canSpin ? "Доступно" : "Ожидание"}
          </span>
        </div>

        {/* Таймер кулдауна */}
        {!canSpin && secondsLeft > 0 && (
          <div className="mt-4 pt-3 border-t border-white/20 flex items-center justify-between text-xs text-white/90">
            <span className="flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-white/80" />
              Следующая попытка через:
            </span>
            <span className="font-mono font-bold text-sm bg-black/25 px-2.5 py-1 rounded-lg">
              {formatCountdown(secondsLeft)}
            </span>
          </div>
        )}
      </section>

      {/* ── Колесо фортуны ── */}
      <section className="rounded-[26px] bg-[var(--au-surface)] p-4 shadow-sm flex flex-col items-center">
        <RouletteWheel
          sectors={data?.sectors || []}
          canSpin={canSpin}
          pendingReward={data?.pendingReward}
          spinning={spinning}
          onSpin={handleSpin}
          onFinished={handleFinished}
          variant="aurora"
        />

        {/* Подсказка под колесом */}
        <p className="mt-3 text-center text-xs text-[var(--au-muted)] max-w-xs">
          {canSpin
            ? "Нажмите на кнопку в центре или на колесо, чтобы крутить!"
            : data?.resetMode === "daily" ? `Новая попытка каждый день в 00:00 (${data.timeZone || "UTC"})` : `Крутить можно раз в ${data?.cooldownHours || 24} ч. Таймер обратного отсчета выше.`}
        </p>
      </section>

      {/* ── Выбор целевой подписки (если 2 и более) ── */}
      {data?.subscriptions && data.subscriptions.length > 1 && (
        <section className="rounded-[26px] bg-[var(--au-surface)] p-5 space-y-3 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[var(--au-from)]" />
              <h2 className="text-sm font-bold text-[var(--au-ink)]">
                Куда применить бонус:
              </h2>
            </div>
            <span className="text-[11px] font-semibold text-[var(--au-muted)] bg-black/5 dark:bg-white/5 px-2.5 py-0.5 rounded-full">
              {data.subscriptions.length} подписки
            </span>
          </div>

          <div className="space-y-2">
            {data.subscriptions.map((sub) => {
              const selected = selectedSubId === sub.id;
              return (
                <button
                  key={sub.id}
                  type="button"
                  onClick={() => setSelectedSubId(sub.id)}
                  disabled={spinning}
                  className={cn(
                    "w-full text-left p-3.5 rounded-2xl border transition-all flex items-center justify-between gap-3 active:scale-[0.99]",
                    selected
                      ? "bg-[linear-gradient(135deg,var(--au-from),var(--au-to))] text-white border-transparent shadow-md shadow-[var(--au-from)]/20"
                      : "bg-white/50 dark:bg-black/20 border-white/40 dark:border-white/5 hover:border-[var(--au-from)]/40 text-[var(--au-ink)]"
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold truncate">{sub.name}</span>
                      {sub.isExpired && (
                        <span
                          className={cn(
                            "text-[10px] px-1.5 py-0.5 rounded-md font-semibold shrink-0",
                            selected
                              ? "bg-white/20 text-white"
                              : "bg-red-500/10 text-red-500 dark:text-red-400"
                          )}
                        >
                          Истекла
                        </span>
                      )}
                    </div>
                    <p
                      className={cn(
                        "text-[11px] mt-0.5",
                        selected ? "text-white/85" : "text-[var(--au-muted)]"
                      )}
                    >
                      {sub.expireAt ? `Действует до ${formatDate(sub.expireAt)}` : "Без ограничений"}
                    </p>
                  </div>

                  <div
                    className={cn(
                      "w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors",
                      selected
                        ? "border-white bg-white"
                        : "border-zinc-400 dark:border-zinc-600 bg-transparent"
                    )}
                  >
                    {selected && <div className="w-2.5 h-2.5 rounded-full bg-[var(--au-from)]" />}
                  </div>
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-[var(--au-muted)] text-center">
            При выигрыше дней или трафика приз будет зачислен на выбранную подписку
          </p>
        </section>
      )}

      {/* ── Возможные секторы и призы ── */}
      <section className="rounded-[26px] bg-[var(--au-surface)] p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Gift className="w-5 h-5 text-[var(--au-from)]" />
          <h2 className="text-base font-bold">Призы на колесе</h2>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {(data?.sectors || []).map((sec) => (
            <div
              key={sec.id}
              className="flex items-center gap-2.5 p-2.5 rounded-2xl bg-white/50 dark:bg-black/20 border border-white/30 dark:border-white/5"
            >
              <div
                className="w-3.5 h-3.5 rounded-full shrink-0 shadow-sm"
                style={{ backgroundColor: sec.color }}
              />
              <span className="text-xs font-semibold truncate text-[var(--au-ink)]">
                {sec.label}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* ── История выигрышей пользователя ── */}
      {data?.recentSpins && data.recentSpins.length > 0 && (
        <section className="rounded-[26px] bg-[var(--au-surface)] p-5 space-y-3">
          <div className="flex items-center gap-2">
            <History className="w-5 h-5 text-[var(--au-from)]" />
            <h2 className="text-base font-bold">Ваши недавние выигрыши</h2>
          </div>
          <div className="space-y-2">
            {data.recentSpins.slice(0, 5).map((spin) => (
              <div
                key={spin.id}
                className="flex items-center justify-between p-3 rounded-2xl bg-white/50 dark:bg-black/20 border border-white/30 dark:border-white/5"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="text-base shrink-0">
                    {spin.rewardType === "empty" ? "💨" : "🎉"}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-bold truncate text-[var(--au-ink)]">
                      {spin.rewardLabel}
                    </p>
                    <p className="text-[11px] text-[var(--au-muted)]">
                      {formatDate(spin.createdAt)}
                    </p>
                  </div>
                </div>
                <span
                  className={cn(
                    "text-xs font-extrabold px-2 py-0.5 rounded-lg shrink-0",
                    spin.rewardType === "empty"
                      ? "bg-zinc-200 dark:bg-zinc-800 text-zinc-500"
                      : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  )}
                >
                  {spin.rewardType === "empty" ? "Увы" : "Получено"}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Модалка победы ── */}
      {winSector && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-sm rounded-[28px] bg-[var(--au-surface)] border-2 border-white/80 dark:border-white/10 p-6 text-center shadow-2xl space-y-4">
            <div className="w-16 h-16 mx-auto rounded-full bg-[linear-gradient(135deg,var(--au-from),var(--au-to))] flex items-center justify-center text-3xl shadow-lg shadow-[var(--au-from)]/30">
              {winSector.type === "empty" ? "🥲" : "🎁"}
            </div>

            <div>
              <h3 className="text-xl font-extrabold text-[var(--au-ink)]">
                {winSector.type === "empty" ? "Почти повезло!" : "Поздравляем!"}
              </h3>
              <p className="mt-1 text-sm text-[var(--au-muted)]">
                {winSector.type === "empty"
                  ? "Сектор пустой. Не расстраивайтесь, завтра обязательно повезет!"
                  : `Вы выиграли: ${winSector.label}`}
              </p>
            </div>

            {winSector.type !== "empty" && (
              <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-semibold">
                ✨ Бонус уже начислен на ваш аккаунт!
              </div>
            )}

            <button
              type="button"
              onClick={() => setWinSector(null)}
              className="w-full py-3.5 px-4 rounded-2xl bg-[linear-gradient(135deg,var(--au-from),var(--au-to))] text-white font-bold text-sm shadow-md active:scale-95 transition-transform"
            >
              {winSector.type === "empty" ? "Понятно" : "Отлично, забрать!"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
