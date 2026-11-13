import { useCabinetDesign } from "@/lib/use-cabinet-design";
import { useCabinetConfig } from "@/contexts/cabinet-config";
import { useTheme } from "@/contexts/theme";
import { AuroraRoulette } from "./aurora/aurora-roulette";
import { StealthRoulette } from "./stealth/stealth-roulette";

export function ClientRoulettePage() {
  const design = useCabinetDesign();
  const config = useCabinetConfig();
  const { resolvedMode } = useTheme();

  if (design === "stealth") {
    return <StealthRoulette />;
  }

  // Для classic (браузерный веб-кабинет) оборачиваем в стили Aurora с адаптивным центрированием
  const dark = resolvedMode === "dark";
  const accent = dark ? "#21854f" : config?.stealthAccent || "#5b4be8";
  const gradientEnd = dark ? "#17683e" : `color-mix(in srgb, ${accent} 55%, #38aae1)`;

  return (
    <div
      className="max-w-2xl mx-auto au-client py-2 px-1"
      data-au-theme={resolvedMode}
      style={{
        "--au-link": dark ? "#79e3a4" : accent,
        "--au-from": accent,
        "--au-to": gradientEnd,
        "--au-bg": dark ? "#10131d" : "#ffffff",
        "--au-surface": dark ? "#1b2030" : "#f2f3f7",
        "--au-nav": dark ? "#202637" : "#f2f3f7",
        "--au-ink": dark ? "#f1f3fa" : "#0f1222",
        "--au-muted": dark ? "#adb6ce" : "#606a80",
      } as React.CSSProperties}
    >
      <AuroraRoulette />
    </div>
  );
}
