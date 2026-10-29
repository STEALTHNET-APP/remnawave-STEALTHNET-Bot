export type Palette = { background: string; surface: string; text: string; muted: string; border: string; accent: string; onAccent: string };
export type CabinetDesign = {
  version: 1; enabled: boolean; name: string; mode: "dark" | "light" | "system";
  light: Palette; dark: Palette; font: "onest" | "system" | "serif";
  fontSize: number; radius: number; buttonRadius: number; inputRadius: number;
  density: "comfortable" | "compact"; width: number; buttons: "solid" | "outline";
  cards: "bordered" | "soft"; motion: "normal" | "reduced";
};
export type DesignSnapshot = { id: string; at: string; name: string; design: CabinetDesign | null };
export type DesignDocument = { revision: number; published: CabinetDesign | null; draft: CabinetDesign | null; publishedAt: string | null; history: DesignSnapshot[] };
export const DEFAULT_DESIGN: CabinetDesign = {
  version: 1, enabled: true, name: "Графит", mode: "dark",
  light: { background: "#f8f7f5", surface: "#ffffff", text: "#212327", muted: "#696c72", border: "#d9d7d4", accent: "#25272b", onAccent: "#ffffff" },
  dark: { background: "#161819", surface: "#1e2021", text: "#eeece8", muted: "#a4a8ab", border: "#393d40", accent: "#ece9e3", onAccent: "#202224" },
  font: "onest", fontSize: 14, radius: 10, buttonRadius: 7, inputRadius: 7,
  density: "comfortable", width: 1440, buttons: "solid", cards: "bordered", motion: "normal",
};
const object = (x: unknown): Record<string, unknown> | null => x !== null && typeof x === "object" && !Array.isArray(x) ? x as Record<string, unknown> : null;
export function parseDesign(value: unknown): CabinetDesign | null {
  const d = object(value); if (!d || d.version !== 1 || typeof d.enabled !== "boolean" || typeof d.name !== "string" || !d.name.trim() || d.name.length > 60) return null;
  const allowed: Record<string, string[]> = { mode: ["dark", "light", "system"], font: ["onest", "system", "serif"], density: ["comfortable", "compact"], buttons: ["solid", "outline"], cards: ["bordered", "soft"], motion: ["normal", "reduced"] };
  for (const [key, choices] of Object.entries(allowed)) if (typeof d[key] !== "string" || !choices.includes(d[key] as string)) return null;
  for (const [key, min, max] of [["fontSize", 13, 18], ["radius", 0, 24], ["buttonRadius", 0, 28], ["inputRadius", 0, 20], ["width", 1120, 1680]] as const) if (typeof d[key] !== "number" || !Number.isInteger(d[key]) || d[key] < min || d[key] > max) return null;
  const palettes: Record<string, Palette> = {};
  for (const mode of ["light", "dark"] as const) {
    const p = object(d[mode]); if (!p) return null;
    const clean: Record<string, string> = {};
    for (const key of Object.keys(DEFAULT_DESIGN.light)) { if (typeof p[key] !== "string" || !/^#[0-9a-f]{6}$/i.test(p[key] as string)) return null; clean[key] = (p[key] as string).toLowerCase(); }
    palettes[mode] = clean as Palette;
  }
  return { version: 1, enabled: d.enabled, name: d.name.trim(), mode: d.mode as CabinetDesign["mode"], light: palettes.light, dark: palettes.dark, font: d.font as CabinetDesign["font"], fontSize: d.fontSize as number, radius: d.radius as number, buttonRadius: d.buttonRadius as number, inputRadius: d.inputRadius as number, density: d.density as CabinetDesign["density"], width: d.width as number, buttons: d.buttons as CabinetDesign["buttons"], cards: d.cards as CabinetDesign["cards"], motion: d.motion as CabinetDesign["motion"] };
}
export const emptyDocument = (): DesignDocument => ({ revision: 0, published: null, draft: null, publishedAt: null, history: [] });
