import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { getPublicConfigCached } from "@/lib/public-config";

import { useLocation } from "react-router-dom";
import { normalizeTheme, readStoredTheme, resolveThemePolicy, type ThemeConfig, type ThemeMode, type ThemeAccent } from "@/lib/theme-policy";
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

interface ThemeContextValue {
  config: ThemeConfig;
  resolvedMode: "light" | "dark";
  setMode: (mode: ThemeMode) => void;
  setAccent: (accent: ThemeAccent) => void;
  setConfig: (cfg: ThemeConfig) => void;
  allowUserThemeChange: boolean;
}

const ThemeContext = createContext<ThemeContextValue>({
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

const STORAGE_KEY = "stealthnet-admin-theme";

function getSystemDark() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
}

function loadTheme(): ThemeConfig | null {
  try {
    return readStoredTheme(localStorage.getItem(STORAGE_KEY)) ?? readStoredTheme(localStorage.getItem("stealthnet-theme"));
  } catch {
    return null;
  }
}

function saveTheme(cfg: ThemeConfig) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch {}
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const [personalConfig, setPersonalConfig] = useState<ThemeConfig | null>(loadTheme);
  const [systemDark, setSystemDark] = useState(getSystemDark);
  const [serverConfig, setServerConfig] = useState<ThemeConfig>(() => normalizeTheme(null));
  const { config, editable } = resolveThemePolicy(pathname, personalConfig, serverConfig);

  useEffect(() => {
    let active = true;
    getPublicConfigCached().then((cfg) => {
      if (active) setServerConfig(normalizeTheme({ mode: cfg.themeMode, accent: cfg.themeAccent }));
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
    saveTheme(next);
  }, [editable]);

  const setMode = useCallback((mode: ThemeMode) => {
    setConfig({ ...config, mode });
  }, [config, setConfig]);

  const setAccent = useCallback((accent: ThemeAccent) => {
    setConfig({ ...config, accent });
  }, [config, setConfig]);

  return (
    <ThemeContext.Provider value={{ config, resolvedMode, setMode, setAccent, setConfig, allowUserThemeChange: editable }}>
      {children}
    </ThemeContext.Provider>
  );
}
