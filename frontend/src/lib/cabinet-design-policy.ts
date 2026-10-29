export type CabinetAppearance = "classic" | "modern" | "stealth" | "aurora";
export type CabinetRenderer = Exclude<CabinetAppearance, "modern">;
export function normalizeCabinetAppearance(value: unknown): CabinetAppearance {
  return value === "modern" || value === "stealth" || value === "aurora" ? value : "classic";
}
export function resolveCabinetRenderer(design: CabinetAppearance, inMiniapp: boolean, applyInBrowser: boolean, liteMode = false): CabinetRenderer {
  if (liteMode || (!inMiniapp && !applyInBrowser) || design === "modern") return "classic";
  return design;
}
