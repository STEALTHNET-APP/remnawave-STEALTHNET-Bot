import { useState, useRef } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export interface WheelSector {
  id: string;
  type: string;
  value: number;
  label: string;
  color: string;
  icon?: string;
  weight?: number;
}

interface RouletteWheelProps {
  sectors: WheelSector[];
  canSpin?: boolean;
  pendingReward?: boolean;
  spinning?: boolean;
  onSpin?: () => Promise<string | null>;
  onFinished?: (sector: WheelSector) => void;
  variant?: "aurora" | "stealth" | "classic";
  size?: "sm" | "md";
}

export function RouletteWheel({
  sectors,
  canSpin = false,
  pendingReward = false,
  spinning: externalSpinning = false,
  onSpin,
  onFinished,
  variant = "aurora",
  size = "md",
}: RouletteWheelProps) {
  const [rotation, setRotation] = useState(0);
  const [internalSpinning, setInternalSpinning] = useState(false);
  const currentRotationRef = useRef(0);

  const numSectors = Math.max(sectors.length, 1);
  const sectorAngle = 360 / numSectors;

  const triggerHaptic = (type: "light" | "medium" | "heavy" | "success") => {
    try {
      const haptic = (window as any).Telegram?.WebApp?.HapticFeedback;
      if (!haptic) return;
      if (type === "success") {
        haptic.notificationOccurred("success");
      } else {
        haptic.impactOccurred(type);
      }
    } catch {}
  };

  const handleSpinClick = async () => {
    if (internalSpinning || externalSpinning) return;

    // Если onSpin не передан — демонстрационное вращение на случайный сектор
    if (!onSpin) {
      if (sectors.length === 0) return;
      setInternalSpinning(true);
      const randIdx = Math.floor(Math.random() * sectors.length);
      const extraSpins = 5 * 360;
      const currentNormalized = currentRotationRef.current % 360;
      const targetSectorCenter = randIdx * sectorAngle + sectorAngle / 2;
      const targetAngleWithinTurn = (360 - targetSectorCenter) % 360;
      const delta = (targetAngleWithinTurn - currentNormalized + 360) % 360;
      const totalTargetRotation = currentRotationRef.current + extraSpins + delta;

      currentRotationRef.current = totalTargetRotation;
      setRotation(totalTargetRotation);

      setTimeout(() => {
        setInternalSpinning(false);
        if (onFinished && sectors[randIdx]) {
          onFinished(sectors[randIdx]);
        }
      }, 5500);
      return;
    }

    if (!canSpin) return;

    setInternalSpinning(true);
    triggerHaptic("medium");

    try {
      const wonSectorId = await onSpin();
      if (!wonSectorId) {
        setInternalSpinning(false);
        return;
      }

      const targetIndex = sectors.findIndex((s) => s.id === wonSectorId);
      if (targetIndex === -1) {
        setInternalSpinning(false);
        return;
      }

      const extraSpins = 6 * 360;
      const currentNormalized = currentRotationRef.current % 360;
      const targetSectorCenter = targetIndex * sectorAngle + sectorAngle / 2;
      const targetAngleWithinTurn = (360 - targetSectorCenter) % 360;

      const delta = (targetAngleWithinTurn - currentNormalized + 360) % 360;
      const totalTargetRotation = currentRotationRef.current + extraSpins + delta;

      currentRotationRef.current = totalTargetRotation;
      setRotation(totalTargetRotation);

      const startTime = Date.now();
      const spinDuration = 5500;

      const tickInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        if (elapsed >= spinDuration) {
          clearInterval(tickInterval);
          return;
        }
        triggerHaptic("light");
      }, 180);

      setTimeout(() => {
        clearInterval(tickInterval);
        setInternalSpinning(false);
        const sector = sectors[targetIndex];
        triggerHaptic("success");
        if (onFinished && sector) {
          onFinished(sector);
        }
      }, spinDuration);
    } catch {
      setInternalSpinning(false);
    }
  };

  const defaultColors = [
    "#4f46e5", "#0ea5e9", "#10b981", "#f59e0b",
    "#ec4899", "#8b5cf6", "#06b6d4", "#e11d48",
    "#14b8a6", "#f97316", "#a855f7", "#3b82f6",
  ];

  const isStealth = variant === "stealth";
  const isAurora = variant === "aurora";
  const isSmall = size === "sm";

  return (
    <div className="relative flex flex-col items-center justify-center p-2 select-none">
      {/* ── Обод и колесо ── */}
      <div
        className={cn(
          "relative flex items-center justify-center",
          isSmall
            ? "w-[240px] h-[240px]"
            : "w-[310px] h-[310px] sm:w-[350px] sm:h-[350px]"
        )}
      >
        {/* Неоновое свечение позади колеса */}
        <div
          className={cn(
            "absolute inset-0 rounded-full blur-2xl pointer-events-none transition-opacity duration-700",
            isStealth
              ? "bg-saccent-500/20 opacity-70"
              : isAurora
              ? "bg-primary/25 opacity-60"
              : "bg-primary/20 opacity-40",
            (internalSpinning || externalSpinning) && "opacity-100 scale-105"
          )}
        />

        {/* Указатель сверху (стрелка) */}
        <div
          className={cn(
            "absolute left-1/2 -translate-x-1/2 z-30 pointer-events-none drop-shadow-md",
            isSmall ? "-top-2" : "-top-3"
          )}
        >
          <svg
            width={isSmall ? "24" : "32"}
            height={isSmall ? "28" : "36"}
            viewBox="0 0 32 36"
            fill="none"
          >
            <path
              d="M13.4 33.6C14.6 35.4 17.4 35.4 18.6 33.6L30.2 16.2C31.7 13.9 30.1 10.8 27.4 10.8H4.6C1.9 10.8 0.3 13.9 1.8 16.2L13.4 33.6Z"
              fill={isStealth ? "#ff2357" : "#ef4444"}
              stroke="#ffffff"
              strokeWidth="2.5"
            />
          </svg>
        </div>

        {/* Внешнее кольцо колеса */}
        <div
          className={cn(
            "relative w-full h-full rounded-full p-2 shadow-2xl transition-all duration-300",
            isStealth
              ? "bg-zinc-950 border-4 border-white/10 shadow-[0_0_35px_rgba(0,0,0,0.8),0_0_15px_rgb(var(--stealth-accent)_/_0.3)]"
              : isAurora
              ? "bg-white/40 dark:bg-zinc-900/40 backdrop-blur-xl border-4 border-white/60 dark:border-white/10 shadow-[0_12px_40px_-10px_rgba(79,70,229,0.3)]"
              : "bg-card border-4 border-border"
          )}
        >
          {/* Вращающийся диск колеса */}
          <div
            className="w-full h-full rounded-full overflow-hidden relative shadow-inner"
            style={{
              transform: `rotate(${rotation}deg)`,
              transition: internalSpinning
                ? "transform 5.5s cubic-bezier(0.12, 0.8, 0.2, 1)"
                : "none",
            }}
          >
            <svg viewBox="0 0 300 300" className="w-full h-full">
              <defs>
                <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="0" dy="1" stdDeviation="1" floodColor="#000" floodOpacity="0.5" />
                </filter>
              </defs>
              {sectors.map((sec, idx) => {
                const startAngle = (idx * sectorAngle * Math.PI) / 180;
                const endAngle = ((idx + 1) * sectorAngle * Math.PI) / 180;
                const cx = 150;
                const cy = 150;
                const r = 145;

                const x1 = cx + r * Math.sin(startAngle);
                const y1 = cy - r * Math.cos(startAngle);
                const x2 = cx + r * Math.sin(endAngle);
                const y2 = cy - r * Math.cos(endAngle);

                const largeArc = sectorAngle > 180 ? 1 : 0;
                const pathData = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;

                const sectorColor = sec.color || defaultColors[idx % defaultColors.length];
                const midAngle = (idx * sectorAngle + sectorAngle / 2);

                const fontSize = numSectors > 11 ? "8" : numSectors > 9 ? "9" : numSectors > 7 ? "10.5" : "12";

                return (
                  <g key={sec.id || idx}>
                    <path
                      d={pathData}
                      fill={sectorColor}
                      stroke="rgba(255,255,255,0.25)"
                      strokeWidth="1.5"
                    />
                    {/* Текст сектора */}
                    <g transform={`rotate(${midAngle}, 150, 150)`}>
                      <text
                        x="150"
                        y="38"
                        fill="#ffffff"
                        fontSize={fontSize}
                        fontWeight="800"
                        textAnchor="middle"
                        filter="url(#shadow)"
                        style={{ letterSpacing: "-0.01em" }}
                      >
                        {sec.label.length > 17 ? sec.label.slice(0, 16) + "…" : sec.label}
                      </text>
                    </g>
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Центральная кнопка «КРУТИТЬ» */}
          <button
            type="button"
            onClick={handleSpinClick}
            disabled={(!canSpin && !!onSpin) || internalSpinning || externalSpinning}
            className={cn(
              "absolute inset-0 m-auto rounded-full z-20",
              "flex flex-col items-center justify-center font-extrabold uppercase tracking-wider",
              "transition-all duration-200 active:scale-95 shadow-xl select-none",
              isSmall ? "w-16 h-16 text-xs" : "w-20 h-20 sm:w-22 sm:h-22 text-xs sm:text-sm",
              isStealth
                ? "bg-zinc-900 border-2 border-saccent-500 text-white shadow-[0_0_20px_rgb(var(--stealth-accent)_/_0.6)]"
                : isAurora
                ? "bg-gradient-to-br from-white to-zinc-100 dark:from-zinc-800 dark:to-zinc-900 text-foreground border-2 border-white/80 dark:border-white/20 shadow-[0_8px_20px_rgba(0,0,0,0.25)]"
                : "bg-primary text-primary-foreground",
              (!canSpin && !!onSpin) && "opacity-80 cursor-not-allowed"
            )}
          >
            {internalSpinning ? (
              <Sparkles className={cn("animate-spin text-primary", isSmall ? "w-5 h-5" : "w-6 h-6")} />
            ) : (
              <>
                <span className={cn(isSmall ? "text-sm" : "text-base sm:text-lg", "leading-none")}>🎰</span>
                <span className={cn(isSmall ? "text-[9px]" : "text-[10px] sm:text-[11px]", "font-black leading-none mt-0.5")}>
                  {pendingReward ? "ПОЛУЧИТЬ" : canSpin || !onSpin ? "КРУТИТЬ" : "ЖДЁМ"}
                </span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
