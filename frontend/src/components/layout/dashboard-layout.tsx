import { useEffect, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield, LayoutDashboard, Users, CreditCard, Settings, LogOut, KeyRound,
  Megaphone, Tag, BarChart3, FileText, ExternalLink, Sun, Moon, Monitor,
  Palette, Menu, X, Database,
} from "lucide-react";
import { useAuth } from "@/contexts/auth";
import { useTheme, ACCENT_PALETTES, type ThemeMode, type ThemeAccent } from "@/contexts/theme";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";

const PANEL_VERSION = "3.1.1";
const GITHUB_URL = "https://github.com/STEALTHNET-APP/remnawave-STEALTHNET-Bot";

const nav = [
  { to: "/admin", label: "Дашборд", icon: LayoutDashboard },
  { to: "/admin/clients", label: "Клиенты", icon: Users },
  { to: "/admin/tariffs", label: "Тарифы", icon: CreditCard },
  { to: "/admin/promo", label: "Промо-ссылки", icon: Megaphone },
  { to: "/admin/promo-codes", label: "Промокоды", icon: Tag },
  { to: "/admin/analytics", label: "Аналитика", icon: BarChart3 },
  { to: "/admin/sales-report", label: "Отчёты продаж", icon: FileText },
  { to: "/admin/backup", label: "Бэкапы", icon: Database },
  { to: "/admin/settings", label: "Настройки", icon: Settings },
];

const MODE_OPTIONS: { value: ThemeMode; icon: typeof Sun; label: string }[] = [
  { value: "light", icon: Sun, label: "Светлая" },
  { value: "dark", icon: Moon, label: "Тёмная" },
  { value: "system", icon: Monitor, label: "Система" },
];

/** Проверка активности пункта навигации — exact match или startsWith, но без пересечения /admin/promo и /admin/promo-codes */
function isNavActive(pathname: string, to: string): boolean {
  if (to === "/admin") return pathname === "/admin";
  // exact match
  if (pathname === to) return true;
  // startsWith, но только если следующий символ — / или конец
  if (pathname.startsWith(to)) {
    const next = pathname[to.length];
    return next === "/" || next === undefined;
  }
  return false;
}

function NavItems({ onClick }: { onClick?: () => void }) {
  const location = useLocation();
  return (
    <>
      {nav.map((item) => {
        const isActive = isNavActive(location.pathname, item.to);
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={onClick}
            className={cn(
              "flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-200",
              "hover:bg-accent/80 hover:text-accent-foreground",
              isActive
                ? "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"
                : "text-muted-foreground"
            )}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </>
  );
}

export function DashboardLayout() {
  const { state, logout } = useAuth();
  const { config: themeConfig, setMode, setAccent } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [brand, setBrand] = useState<{ serviceName: string; logo: string | null }>({ serviceName: "", logo: null });
  const [showThemePanel, setShowThemePanel] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const token = state.accessToken;
    if (token) {
      api.getSettings(token).then((s) => setBrand({ serviceName: s.serviceName, logo: s.logo ?? null })).catch(() => {});
    }
  }, [state.accessToken]);

  async function handleLogout() {
    await logout();
    navigate("/admin/login", { replace: true });
  }

  return (
    <div className="flex min-h-svh">
      {/* ═══ Desktop sidebar ═══ */}
      <aside className="hidden border-r bg-card md:flex md:w-56 md:flex-col shrink-0">
        <div className="flex h-14 items-center gap-2 border-b px-4">
          {brand.logo ? (
            <img src={brand.logo} alt="" className="h-8 w-auto object-contain" />
          ) : (
            <Shield className="h-6 w-6 text-primary shrink-0" />
          )}
          {brand.serviceName ? <span className="font-semibold truncate">{brand.serviceName}</span> : null}
        </div>
        <nav className="flex-1 space-y-1.5 p-4 overflow-y-auto">
          <NavItems />
        </nav>
        <div className="border-t p-4 space-y-1.5">
          <div className="text-xs text-muted-foreground truncate px-3 py-1">{state.admin?.email}</div>
          <Link to="/admin/change-password" className="block">
            <Button variant="ghost" size="sm" className="w-full justify-start gap-2 rounded-xl">
              <KeyRound className="h-4 w-4" />
              Сменить пароль
            </Button>
          </Link>
          <Button variant="ghost" size="sm" className="w-full justify-start gap-2 rounded-xl" onClick={handleLogout}>
            <LogOut className="h-4 w-4" />
            Выйти
          </Button>
        </div>
      </aside>

      {/* ═══ Mobile sidebar overlay ═══ */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/50 md:hidden"
              onClick={() => setMobileMenuOpen(false)}
            />
            <motion.aside
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="fixed left-0 top-0 bottom-0 z-50 w-[280px] border-r bg-card flex flex-col md:hidden"
            >
              <div className="flex h-14 items-center justify-between gap-2 border-b px-4">
                <div className="flex items-center gap-2 min-w-0">
                  {brand.logo ? (
                    <img src={brand.logo} alt="" className="h-8 w-auto object-contain" />
                  ) : (
                    <Shield className="h-6 w-6 text-primary shrink-0" />
                  )}
                  {brand.serviceName ? <span className="font-semibold truncate">{brand.serviceName}</span> : null}
                </div>
                <Button variant="ghost" size="icon" className="shrink-0" onClick={() => setMobileMenuOpen(false)}>
                  <X className="h-5 w-5" />
                </Button>
              </div>
              <nav className="flex-1 space-y-1.5 p-4 overflow-y-auto">
                <NavItems onClick={() => setMobileMenuOpen(false)} />
              </nav>
              <div className="border-t p-4 space-y-1.5">
                <div className="text-xs text-muted-foreground truncate px-3 py-1">{state.admin?.email}</div>
                <Link to="/admin/change-password" className="block" onClick={() => setMobileMenuOpen(false)}>
                  <Button variant="ghost" size="sm" className="w-full justify-start gap-2 rounded-xl">
                    <KeyRound className="h-4 w-4" />
                    Сменить пароль
                  </Button>
                </Link>
                <Button variant="ghost" size="sm" className="w-full justify-start gap-2 rounded-xl" onClick={handleLogout}>
                  <LogOut className="h-4 w-4" />
                  Выйти
                </Button>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* ═══ Main content ═══ */}
      <main className="flex-1 overflow-auto min-w-0">
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-2 border-b bg-background/95 px-4 md:px-6 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="flex items-center gap-2 min-w-0">
            {/* Mobile hamburger */}
            <Button variant="ghost" size="icon" className="md:hidden shrink-0" onClick={() => setMobileMenuOpen(true)}>
              <Menu className="h-5 w-5" />
            </Button>
            {brand.serviceName ? <span className="text-sm text-muted-foreground md:hidden truncate">{brand.serviceName}</span> : null}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Theme toggle */}
            <div className="relative">
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-xs h-8 px-2"
                onClick={() => setShowThemePanel(!showThemePanel)}
              >
                <Palette className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Тема</span>
              </Button>
              {showThemePanel && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowThemePanel(false)} />
                  <div className="absolute right-0 top-full z-50 mt-1 w-72 rounded-xl border bg-card p-4 shadow-xl">
                    <p className="text-xs font-medium text-muted-foreground mb-2">Режим</p>
                    <div className="flex gap-1 mb-4">
                      {MODE_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => setMode(opt.value)}
                          className={cn(
                            "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors",
                            themeConfig.mode === opt.value
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted/50 text-muted-foreground hover:bg-muted"
                          )}
                        >
                          <opt.icon className="h-3.5 w-3.5" />
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">Акцент</p>
                    <div className="grid grid-cols-4 gap-2">
                      {(Object.entries(ACCENT_PALETTES) as [ThemeAccent, typeof ACCENT_PALETTES["default"]][]).map(([key, palette]) => (
                        <button
                          key={key}
                          onClick={() => setAccent(key)}
                          className={cn(
                            "flex flex-col items-center gap-1 rounded-lg p-2 text-[10px] transition-all",
                            themeConfig.accent === key
                              ? "ring-2 ring-primary bg-muted"
                              : "hover:bg-muted/50"
                          )}
                        >
                          <div
                            className="h-6 w-6 rounded-full border-2"
                            style={{
                              backgroundColor: palette.swatch,
                              borderColor: themeConfig.accent === key ? "hsl(var(--primary))" : "transparent",
                            }}
                          />
                          <span className="text-muted-foreground truncate w-full text-center">{palette.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Version badge */}
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <Shield className="h-3 w-3" />
              Версия {PANEL_VERSION}
              <ExternalLink className="h-3 w-3 opacity-50" />
            </a>
          </div>
        </header>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
          className="p-4 md:p-6"
        >
          <Outlet />
        </motion.div>
      </main>
    </div>
  );
}
