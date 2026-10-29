export type ThemeMode = "light" | "dark" | "system";
export type ThemeAccent = "default" | "blue" | "violet" | "rose" | "orange" | "green" | "emerald" | "cyan" | "amber" | "red" | "pink" | "indigo";
export interface ThemeConfig { mode: ThemeMode; accent: ThemeAccent }

const accents: readonly string[] = ["default", "blue", "violet", "rose", "orange", "green", "emerald", "cyan", "amber", "red", "pink", "indigo"];

export function normalizeTheme(value: unknown): ThemeConfig {
  const candidate = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    mode: candidate.mode === "light" || candidate.mode === "system" ? candidate.mode : "dark",
    accent: typeof candidate.accent === "string" && accents.includes(candidate.accent) ? candidate.accent as ThemeAccent : "default",
  };
}

export function readStoredTheme(raw: string | null): ThemeConfig | null {
  try {
    const value = raw ? JSON.parse(raw) : null;
    return value && typeof value === "object" && !Array.isArray(value) ? normalizeTheme(value) : null;
  } catch {
    return null;
  }
}

export function isAdminThemePath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

export function resolveThemePolicy(pathname: string, personal: ThemeConfig | null, server: unknown) {
  const controlled = normalizeTheme(server);
  const editable = isAdminThemePath(pathname);
  return { editable, config: editable && personal ? normalizeTheme(personal) : controlled };
}
