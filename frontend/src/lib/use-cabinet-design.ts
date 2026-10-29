import { useEffect, useState } from "react";
import { getPublicConfigCached } from "./public-config";

import { normalizeCabinetAppearance, resolveCabinetRenderer, type CabinetAppearance, type CabinetRenderer } from "./cabinet-design-policy";
export type CabinetDesign = CabinetRenderer;

const CACHE_KEY = "cabinet_design_cache";

/** True если страница открыта внутри Telegram Mini App (а не в обычном браузере) */
function isInsideTelegramMiniApp(): boolean {
  try {
    const tg = (window as { Telegram?: { WebApp?: { initData?: string; platform?: string } } }).Telegram?.WebApp;
    if (!tg) return false;
    if (typeof tg.initData === "string" && tg.initData.length > 0) return true;
    if (tg.platform && tg.platform !== "unknown") return true;
    return false;
  } catch {
    return false;
  }
}

type DesignCache = { design: CabinetAppearance; applyInBrowser: boolean };

function readCache(): DesignCache {
  try {
    const v = localStorage.getItem(CACHE_KEY);
    if (!v) return { design: "classic", applyInBrowser: false };
    // Поддерживаем legacy-формат: значение строкой "stealth"|"classic"
    if (v === "stealth" || v === "classic" || v === "aurora" || v === "modern") return { design: v, applyInBrowser: false };
    const parsed = JSON.parse(v) as Partial<DesignCache>;
    const design = normalizeCabinetAppearance(parsed.design);
    const applyInBrowser = parsed.applyInBrowser === true;
    return { design, applyInBrowser };
  } catch {
    return { design: "classic", applyInBrowser: false };
  }
}

function writeCache(c: DesignCache): void {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch { /* ignore */ }
}

export function useCabinetDesign(): CabinetDesign {
  const inMiniapp = isInsideTelegramMiniApp();
  const cache = readCache();
  const initial: CabinetDesign = resolveCabinetRenderer(cache.design, inMiniapp, cache.applyInBrowser);
  const [design, setDesign] = useState<CabinetDesign>(initial);

  useEffect(() => {
    let alive = true;
    getPublicConfigCached()
      .then((cfg) => {
        if (!alive) return;
        if (cfg.liteMode) { setDesign("classic"); return; }
        const rawDesign = (cfg as { cabinetDesign?: CabinetAppearance }).cabinetDesign;
        const adminDesign = normalizeCabinetAppearance(rawDesign);
        const applyInBrowser = Boolean((cfg as { cabinetDesignApplyInBrowser?: boolean }).cabinetDesignApplyInBrowser);
        writeCache({ design: adminDesign, applyInBrowser });
        const next: CabinetDesign = resolveCabinetRenderer(adminDesign, inMiniapp, applyInBrowser);
        setDesign(next);
      })
      .catch(() => { /* ignore — keep cached */ });
    return () => { alive = false; };
  }, [inMiniapp]);

  return design;
}
