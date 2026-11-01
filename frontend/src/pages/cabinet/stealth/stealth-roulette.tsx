import { useEffect, useState, useCallback, useRef } from "react";
import { Sparkles, Clock, Gift, History, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useClientAuth } from "@/contexts/client-auth";
import { useInvalidateClientData } from "@/lib/queries";
import { api } from "@/lib/api";
import { toast } from "@/components/ui/toast";
import { RouletteWheel, type WheelSector } from "@/components/roulette/roulette-wheel";
import { StadiumButton } from "@/components/stealth/stadium-button";
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

export function StealthRoulette() {
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
      toast.error("Ошибка", e?.message || "Не удалось загрузить данные рулетки");
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
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 px-4">
        <Sparkles className="w-8 h-8 text-saccent-500 animate-spin" />
        <p className="text-sm text-zinc-400 font-medium">Инициализация рулетки…</p>
      </div>
    );
  }

  if (data && !data.enabled) {
    return (
      <div className="px-4 pt-4">
        <div className="rounded-3xl bg-white/[0.04] border border-white/[0.08] p-6 text-center space-y-4 backdrop-blur-2xl">
          <Sparkles className="w-10 h-10 text-zinc-500 mx-auto opacity-50" />
          <h2 className="text-lg font-bold text-white tracking-wide">РУЛЕТКА ОТКЛЮЧЕНА</h2>
          <p className="text-xs text-zinc-400 leading-relaxed">
            В данный момент рулетка отключена администратором.
          </p>
          <StadiumButton
            variant="ghost"
            size="md"
            iconLeft={<ArrowLeft className="h-4 w-4" />}
            onClick={() => navigate("/cabinet/dashboard")}
          >
            На главную
          </StadiumButton>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 pt-2 space-y-4">
      {/* ── Заголовок и карточка статуса ── */}
      <div className="relative rounded-3xl bg-white/[0.04] border border-white/[0.08] p-5 backdrop-blur-2xl shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_24px_48px_-24px_rgba(0,0,0,0.8)] space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">🎰</span>
              <h2 className="text-xl font-bold tracking-tight text-white">РУЛЕТКА УДАЧИ</h2>
            </div>
            <p className="mt-1 text-xs text-zinc-400 leading-relaxed">
              Ежедневные бонусы: дни подписки, рубли на баланс и скидки.
            </p>
          </div>
          <span
            className={cn(
              "shrink-0 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider",
              canSpin
                ? "bg-saccent-500/20 text-saccent-400 border border-saccent-500/40 shadow-[0_0_12px_rgb(var(--stealth-accent)_/_0.3)]"
                : "bg-zinc-800/80 text-zinc-400 border border-white/5"
            )}
          >
            <span
              className={cn(
                "w-1.5 h-1.5 rounded-full",
                canSpin ? "bg-saccent-400 animate-pulse" : "bg-zinc-500"
              )}
            />
            {canSpin ? "ГОТОВО" : "ОЖИДАНИЕ"}
          </span>
        </div>

        {/* Кулдаун таймер */}
        {!canSpin && secondsLeft > 0 && (
          <div className="pt-3 border-t border-white/[0.06] flex items-center justify-between text-xs text-zinc-300">
            <span className="flex items-center gap-1.5 text-zinc-400">
              <Clock className="w-3.5 h-3.5 text-saccent-400" />
              До следующей попытки:
            </span>
            <span className="font-mono font-bold text-sm text-saccent-400 bg-black/40 border border-saccent-500/20 px-2.5 py-0.5 rounded-lg">
              {formatCountdown(secondsLeft)}
            </span>
          </div>
        )}
      </div>

      {/* ── Колесо фортуны ── */}
      <div className="relative rounded-3xl bg-white/[0.04] border border-white/[0.08] p-5 backdrop-blur-2xl shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_24px_48px_-24px_rgba(0,0,0,0.8)] flex flex-col items-center">
        <RouletteWheel
          sectors={data?.sectors || []}
          canSpin={canSpin}
          pendingReward={data?.pendingReward}
          spinning={spinning}
          onSpin={handleSpin}
          onFinished={handleFinished}
          variant="stealth"
        />

        <p className="mt-4 text-center text-xs text-zinc-400 max-w-xs leading-relaxed">
          {canSpin
            ? "Жмите кнопку в центре колеса, чтобы запустить вращение!"
            : data?.resetMode === "daily" ? `Новая попытка каждый день в 00:00 (${data.timeZone || "Europe/Moscow"})` : `Крутить можно один раз в ${data?.cooldownHours || 24} ч. Таймер обратного отсчета выше.`}
        </p>
      </div>

      {/* ── Выбор целевой подписки (если 2 и более) ── */}
      {data?.subscriptions && data.subscriptions.length > 1 && (
        <div className="rounded-3xl bg-white/[0.04] border border-white/[0.08] p-5 backdrop-blur-2xl space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-saccent-400" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-200">
                ЦЕЛЕВАЯ ПОДПИСКА
              </h3>
            </div>
            <span className="text-[10px] font-bold uppercase text-zinc-400 bg-white/[0.04] px-2 py-0.5 rounded-md border border-white/5">
              {data.subscriptions.length} ПОДПИСКИ
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
                      ? "bg-saccent-500/15 border-saccent-500/50 text-white shadow-[0_0_20px_rgb(var(--stealth-accent)_/_0.2)]"
                      : "bg-zinc-900/60 border-white/[0.06] hover:border-saccent-500/30 text-zinc-300"
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold truncate text-white">{sub.name}</span>
                      {sub.isExpired && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md font-bold uppercase bg-red-500/15 text-red-400 border border-red-500/30">
                          ИСТЕКЛА
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-zinc-400 mt-0.5">
                      {sub.expireAt ? `До ${formatDate(sub.expireAt)}` : "Без срока"}
                    </p>
                  </div>

                  <div
                    className={cn(
                      "w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors",
                      selected
                        ? "border-saccent-400 bg-saccent-500/20"
                        : "border-zinc-600 bg-transparent"
                    )}
                  >
                    {selected && <div className="w-2.5 h-2.5 rounded-full bg-saccent-400 shadow-[0_0_8px_rgb(var(--stealth-accent))]" />}
                  </div>
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-zinc-400 text-center leading-relaxed">
            При выигрыше дней или трафика награда будет применена к выбранной подписке
          </p>
        </div>
      )}

      {/* ── Секторы колеса (награды) ── */}
      <div className="rounded-3xl bg-white/[0.04] border border-white/[0.08] p-5 backdrop-blur-2xl space-y-3">
        <div className="flex items-center gap-2">
          <Gift className="w-4 h-4 text-saccent-400" />
          <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-200">
            ПРИЗЫ НА СЕКТОРАХ
          </h3>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {(data?.sectors || []).map((sec) => (
            <div
              key={sec.id}
              className="flex items-center gap-2.5 p-2.5 rounded-2xl bg-zinc-900/60 border border-white/[0.06]"
            >
              <div
                className="w-3 h-3 rounded-full shrink-0 shadow-sm"
                style={{ backgroundColor: sec.color }}
              />
              <span className="text-xs font-bold truncate text-zinc-300">
                {sec.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Недавние вращения ── */}
      {data?.recentSpins && data.recentSpins.length > 0 && (
        <div className="rounded-3xl bg-white/[0.04] border border-white/[0.08] p-5 backdrop-blur-2xl space-y-3">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-saccent-400" />
            <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-200">
              ИСТОРИЯ ВРАЩЕНИЙ
            </h3>
          </div>
          <div className="space-y-2">
            {data.recentSpins.slice(0, 5).map((spin) => (
              <div
                key={spin.id}
                className="flex items-center justify-between p-3 rounded-2xl bg-zinc-900/60 border border-white/[0.06]"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="text-base shrink-0">
                    {spin.rewardType === "empty" ? "💨" : "🎉"}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-bold truncate text-zinc-200">
                      {spin.rewardLabel}
                    </p>
                    <p className="text-[11px] text-zinc-500">
                      {formatDate(spin.createdAt)}
                    </p>
                  </div>
                </div>
                <span
                  className={cn(
                    "text-[11px] font-extrabold uppercase px-2 py-0.5 rounded-md shrink-0",
                    spin.rewardType === "empty"
                      ? "bg-zinc-800 text-zinc-500"
                      : "bg-saccent-500/15 text-saccent-400 border border-saccent-500/25"
                  )}
                >
                  {spin.rewardType === "empty" ? "ПРОПУСК" : "ВЫИГРЫШ"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Модалка результата ── */}
      {winSector && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-200">
          <div className="w-full max-w-sm rounded-3xl bg-zinc-900/95 border border-white/10 p-6 text-center shadow-[0_24px_60px_-12px_rgba(0,0,0,0.8),0_0_40px_-10px_rgb(var(--stealth-accent)_/_0.3)] space-y-4">
            <div className="w-16 h-16 mx-auto rounded-full bg-gradient-to-br from-zinc-800 to-black border border-saccent-500/40 flex items-center justify-center text-3xl shadow-[0_0_25px_rgb(var(--stealth-accent)_/_0.5)]">
              {winSector.type === "empty" ? "🥲" : "🎁"}
            </div>

            <div>
              <h3 className="text-xl font-black tracking-tight text-white uppercase">
                {winSector.type === "empty" ? "НЕ ПОВЕЗЛО" : "ПОЗДРАВЛЯЕМ!"}
              </h3>
              <p className="mt-1.5 text-xs text-zinc-400 leading-relaxed">
                {winSector.type === "empty"
                  ? "Сектор пустой. Не унывайте, завтра вам обязательно повезет!"
                  : `Ваш приз: ${winSector.label}`}
              </p>
            </div>

            {winSector.type !== "empty" && (
              <div className="p-3 rounded-2xl bg-saccent-500/10 border border-saccent-500/20 text-saccent-300 text-xs font-semibold">
                ✨ Приз успешно зачислен на ваш профиль!
              </div>
            )}

            <StadiumButton
              variant="primary"
              size="lg"
              onClick={() => setWinSector(null)}
            >
              {winSector.type === "empty" ? "Понятно" : "Забрать награду"}
            </StadiumButton>
          </div>
        </div>
      )}
    </div>
  );
}
