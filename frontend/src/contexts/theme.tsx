import { createContext, useContext, useEffect, useLayoutEffect, useState, useCallback, type ReactNode } from "react";
import { getPublicConfigCached } from "@/lib/public-config";

import { useLocation } from "react-router-dom";
import { normalizeTheme, readStoredTheme, resolveThemePolicy, isAdminThemePath, type ThemeConfig, type ThemeMode, type ThemeAccent } from "@/lib/theme-policy";
export type { ThemeConfig, ThemeMode, ThemeAccent } from "@/lib/theme-policy";

interface AccentPalette {
  label: string;
  swatch: string;
  light: Record<string, string>;
  dark: Record<string, string>;
}

export const ACCENT_PALETTES: Record<ThemeAccent, AccentPalette> = {
  default: { label: "Стандарт", swatch: "#1e293b", light: {}, dark: {} },
  blue: { label: "Синяя", swatch: "#3b82f6", light: { "--primary": "217.2 91.2% 59.8%", "--primary-foreground": "0 0% 100%", "--ring": "217.2 91.2% 59.8%" }, dark: { "--primary": "217.2 91.2% 59.8%", "--primary-foreground": "0 0% 100%", "--ring": "217.2 91.2% 59.8%" } },
  violet: { label: "Фиолетовая", swatch: "#8b5cf6", light: { "--primary": "262.1 83.3% 57.8%", "--primary-foreground": "0 0% 100%", "--ring": "262.1 83.3% 57.8%" }, dark: { "--primary": "263.4 70% 50.4%", "--primary-foreground": "0 0% 100%", "--ring": "263.4 70% 50.4%" } },
  rose: { label: "Розовая", swatch: "#f43f5e", light: { "--primary": "346.8 77.2% 49.8%", "--primary-foreground": "0 0% 100%", "--ring": "346.8 77.2% 49.8%" }, dark: { "--primary": "346.8 77.2% 49.8%", "--primary-foreground": "0 0% 100%", "--ring": "346.8 77.2% 49.8%" } },
  orange: { label: "Оранжевая", swatch: "#f97316", light: { "--primary": "24.6 95% 53.1%", "--primary-foreground": "0 0% 100%", "--ring": "24.6 95% 53.1%" }, dark: { "--primary": "20.5 90.2% 48.2%", "--primary-foreground": "0 0% 100%", "--ring": "20.5 90.2% 48.2%" } },
  green: { label: "Зелёная", swatch: "#22c55e", light: { "--primary": "142.1 76.2% 36.3%", "--primary-foreground": "0 0% 100%", "--ring": "142.1 76.2% 36.3%" }, dark: { "--primary": "142.1 70.6% 45.3%", "--primary-foreground": "0 0% 100%", "--ring": "142.1 70.6% 45.3%" } },
  emerald: { label: "Изумрудная", swatch: "#10b981", light: { "--primary": "160.1 84.1% 39.4%", "--primary-foreground": "0 0% 100%", "--ring": "160.1 84.1% 39.4%" }, dark: { "--primary": "160.1 84.1% 39.4%", "--primary-foreground": "0 0% 100%", "--ring": "160.1 84.1% 39.4%" } },
  cyan: { label: "Голубая", swatch: "#06b6d4", light: { "--primary": "187.7 85.7% 53.3%", "--primary-foreground": "0 0% 100%", "--ring": "187.7 85.7% 53.3%" }, dark: { "--primary": "187.7 85.7% 53.3%", "--primary-foreground": "0 0% 100%", "--ring": "187.7 85.7% 53.3%" } },
  amber: { label: "Янтарная", swatch: "#f59e0b", light: { "--primary": "37.7 92.1% 50.2%", "--primary-foreground": "0 0% 100%", "--ring": "37.7 92.1% 50.2%" }, dark: { "--primary": "37.7 92.1% 50.2%", "--primary-foreground": "0 0% 100%", "--ring": "37.7 92.1% 50.2%" } },
  red: { label: "Красная", swatch: "#ef4444", light: { "--primary": "0 84.2% 60.2%", "--primary-foreground": "0 0% 100%", "--ring": "0 84.2% 60.2%" }, dark: { "--primary": "0 72.2% 50.6%", "--primary-foreground": "0 0% 100%", "--ring": "0 72.2% 50.6%" } },
  pink: { label: "Розовая", swatch: "#ec4899", light: { "--primary": "330.4 81.2% 60.4%", "--primary-foreground": "0 0% 100%", "--ring": "330.4 81.2% 60.4%" }, dark: { "--primary": "330.4 81.2% 60.4%", "--primary-foreground": "0 0% 100%", "--ring": "330.4 81.2% 60.4%" } },
  indigo: { label: "Индиго", swatch: "#6366f1", light: { "--primary": "238.7 83.5% 66.7%", "--primary-foreground": "0 0% 100%", "--ring": "238.7 83.5% 66.7%" }, dark: { "--primary": "238.7 83.5% 66.7%", "--primary-foreground": "0 0% 100%", "--ring": "238.7 83.5% 66.7%" } },
};

export type AdminAppearance = "modern" | "legacy";

interface ThemeContextValue {
  adminAppearance: AdminAppearance;
  setAdminAppearance: (appearance: AdminAppearance) => void;
  config: ThemeConfig;
  resolvedMode: "light" | "dark";
  setMode: (mode: ThemeMode) => void;
  setAccent: (accent: ThemeAccent) => void;
  setConfig: (cfg: ThemeConfig) => void;
  allowUserThemeChange: boolean;
}

const ThemeContext = createContext<ThemeContextValue>({
  adminAppearance: "modern",
  setAdminAppearance: () => {},
  config: { mode: "dark", accent: "default" },
  resolvedMode: "dark",
  setMode: () => {},
  setAccent: () => {},
  setConfig: () => {},
  allowUserThemeChange: false,
});

export function useTheme() {
  return useContext(ThemeContext);
}

const ADMIN_STORAGE_KEY = "stealthnet-admin-theme";
const CLIENT_STORAGE_KEY = "stealthnet-client-theme";
const LEGACY_STORAGE_KEY = "stealthnet-theme";
const SERVER_STORAGE_KEY = "stealthnet-server-theme";
const PUBLIC_CONFIG_STORAGE_KEY = "stealthnet-public-config";

type ServerThemeConfig = ThemeConfig & { allowUserThemeChange?: boolean };

function getSystemDark() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
}

function loadTheme(isAdmin: boolean): ThemeConfig | null {
  try {
    return readStoredTheme(localStorage.getItem(isAdmin ? ADMIN_STORAGE_KEY : CLIENT_STORAGE_KEY)) ?? readStoredTheme(localStorage.getItem(LEGACY_STORAGE_KEY));
  } catch {
    return null;
  }
}

function saveTheme(cfg: ThemeConfig, isAdmin: boolean) {
  try {
    localStorage.setItem(isAdmin ? ADMIN_STORAGE_KEY : CLIENT_STORAGE_KEY, JSON.stringify(cfg));
    if (!isAdmin) localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(cfg));
  } catch {}
}

function readServerTheme(raw: string | null): ServerThemeConfig | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown> | null;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const mode = value.mode ?? value.themeMode;
    const accent = value.accent ?? value.themeAccent;
    if (mode === undefined && accent === undefined) return null;
    return {
      ...normalizeTheme({ mode, accent }),
      ...(typeof value.allowUserThemeChange === "boolean" ? { allowUserThemeChange: value.allowUserThemeChange } : {}),
    };
  } catch {
    return null;
  }
}

function loadInitialServerTheme(): ServerThemeConfig {
  try {
    const cached = readServerTheme(localStorage.getItem(SERVER_STORAGE_KEY)) ?? readServerTheme(localStorage.getItem(PUBLIC_CONFIG_STORAGE_KEY));
    if (cached) return cached;
  } catch {}
  return document.documentElement.classList.contains("light") ? { mode: "light", accent: "default" } : normalizeTheme(null);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const [adminAppearance, updateAdminAppearance] = useState<AdminAppearance>(() => {
    try { return localStorage.getItem("stealthnet-admin-appearance") === "legacy" ? "legacy" : "modern"; }
    catch { return "modern"; }
  });
  const setAdminAppearance = useCallback((appearance: AdminAppearance) => {
    updateAdminAppearance(appearance);
    try { localStorage.setItem("stealthnet-admin-appearance", appearance); } catch {}
  }, []);
  useLayoutEffect(() => {
    if (isAdminThemePath(pathname)) document.body.dataset.adminUi = adminAppearance;
    else delete document.body.dataset.adminUi;
    return () => { delete document.body.dataset.adminUi; };
  }, [pathname, adminAppearance]);
  const [personalConfig, setPersonalConfig] = useState<ThemeConfig | null>(() => loadTheme(isAdminThemePath(pathname)));
  const [systemDark, setSystemDark] = useState(getSystemDark);
  const [serverConfig, setServerConfig] = useState<ServerThemeConfig>(loadInitialServerTheme);
  const { config, editable } = resolveThemePolicy(pathname, personalConfig, serverConfig);

  useEffect(() => {
    let active = true;
    getPublicConfigCached().then((cfg) => {
      const theme: ServerThemeConfig = {
        ...normalizeTheme({ mode: "themeMode" in cfg ? cfg.themeMode : "dark", accent: cfg.themeAccent }),
        allowUserThemeChange: cfg.allowUserThemeChange !== false,
      };
      try { localStorage.setItem(SERVER_STORAGE_KEY, JSON.stringify(theme)); } catch {}
      if (active) setServerConfig(theme);
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const resolvedMode = config.mode === "system" ? (systemDark ? "dark" : "light") : config.mode;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(resolvedMode);
    root.style.colorScheme = resolvedMode;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", resolvedMode === "light" ? "#f6f7fb" : "#0f172a");
    const allVars = new Set<string>();
    for (const p of Object.values(ACCENT_PALETTES)) {
      for (const k of Object.keys(p.light)) allVars.add(k);
      for (const k of Object.keys(p.dark)) allVars.add(k);
    }
    for (const v of allVars) root.style.removeProperty(v);
    const palette = ACCENT_PALETTES[config.accent];
    const vars = resolvedMode === "dark" ? palette.dark : palette.light;
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  }, [resolvedMode, config.accent]);

  const setConfig = useCallback((cfg: ThemeConfig) => {
    if (!editable) return;
    const next = normalizeTheme(cfg);
    setPersonalConfig(next);
    saveTheme(next, isAdminThemePath(pathname));
  }, [editable, pathname]);

  const setMode = useCallback((mode: ThemeMode) => {
    setConfig({ ...config, mode });
  }, [config, setConfig]);

  const setAccent = useCallback((accent: ThemeAccent) => {
    setConfig({ ...config, accent });
  }, [config, setConfig]);

  return (
    <ThemeContext.Provider value={{ adminAppearance, setAdminAppearance, config, resolvedMode, setMode, setAccent, setConfig, allowUserThemeChange: editable }}>
      {children}
    </ThemeContext.Provider>
  );
}
