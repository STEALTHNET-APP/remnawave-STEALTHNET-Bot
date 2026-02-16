import { useEffect, useMemo, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { useClientAuth } from "@/contexts/client-auth";
import { CabinetConfigProvider, useCabinetConfig } from "@/contexts/cabinet-config";
import { createContext, useContext } from "react";
import { useIsMiniapp } from "@/hooks/use-is-miniapp";
import { Button } from "@/components/ui/button";
import { LayoutDashboard, Package, User, LogOut, Shield, Users, Sun, Moon, PlusCircle } from "lucide-react";
import { useTheme } from "@/contexts/theme";

const IsMiniappContext = createContext(false);
export function useCabinetMiniapp() {
  return useContext(IsMiniappContext);
}

const ALL_NAV_ITEMS = [
  { to: "/cabinet/dashboard", label: "Главная", icon: LayoutDashboard },
  { to: "/cabinet/tariffs", label: "Тарифы", icon: Package },
  { to: "/cabinet/extra-options", label: "Опции", icon: PlusCircle },
  { to: "/cabinet/referral", label: "Рефералы", icon: Users },
  { to: "/cabinet/profile", label: "Профиль", icon: User },
];

/** Кнопка переключения тёмная/светлая тема */
function ThemeToggleButton({ className }: { className?: string }) {
  const { resolvedMode, setMode } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      className={className}
      onClick={() => setMode(resolvedMode === "dark" ? "light" : "dark")}
      title={resolvedMode === "dark" ? "Светлая тема" : "Тёмная тема"}
    >
      {resolvedMode === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </Button>
  );
}

/** Мобильная оболочка для Mini App: компактный хедер + нижняя навигация, тот же стиль. */
function MobileCabinetShell() {
  const location = useLocation();
  const { state, logout, refreshProfile } = useClientAuth();
  const config = useCabinetConfig();
  const navItems = useMemo(
    () => (config?.sellOptionsEnabled ? ALL_NAV_ITEMS : ALL_NAV_ITEMS.filter((item) => item.to !== "/cabinet/extra-options")),
    [config?.sellOptionsEnabled]
  );
  const [logoError, setLogoError] = useState(false);
  useEffect(() => { setLogoError(false); }, [config?.logo]);
  useEffect(() => {
    if (state.token) refreshProfile().catch(() => {});
  }, [state.token, refreshProfile]);
  const serviceName = config?.serviceName ?? "";
  const logo = config?.logo && !logoError ? config.logo : null;

  return (
    <div className="min-h-svh flex flex-col bg-gradient-to-b from-background to-muted/20 min-w-0 overflow-x-hidden">
      <header
        className="sticky top-0 z-50 isolate border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 shrink-0"
        style={{ background: "hsl(var(--background))", paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="flex h-14 items-center justify-between gap-3 px-4 min-w-0">
          <Link to="/cabinet/dashboard" className="flex items-center gap-2.5 font-semibold text-base tracking-tight shrink-0 min-w-0">
            {logo ? (
              <img src={logo} alt="" className="h-8 w-8 rounded-lg object-contain bg-card shrink-0" onError={() => setLogoError(true)} />
            ) : (
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Shield className="h-4 w-4" />
              </span>
            )}
            {serviceName ? <span className="truncate">{serviceName}</span> : null}
          </Link>
          <div className="flex items-center gap-1 shrink-0">
            <ThemeToggleButton />
            <Button variant="ghost" size="icon" className="shrink-0" asChild>
              <Link to="/cabinet/login" onClick={() => logout()} title="Выйти">
                <LogOut className="h-5 w-5" />
              </Link>
            </Button>
          </div>
        </div>
      </header>
      <main className="flex-1 w-full min-w-0 overflow-x-hidden px-4 py-4 pb-24 box-border max-w-[100%] mx-auto" style={{ paddingBottom: "calc(6rem + env(safe-area-inset-bottom))" }}>
        <Outlet />
      </main>
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex items-center justify-around h-16 max-w-lg mx-auto">
          {navItems.map(({ to, label, icon: Icon }) => {
            const active = location.pathname === to;
            return (
              <Link key={to} to={to} className="flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs min-w-0">
                <span className={active ? "text-primary" : "text-muted-foreground"}>
                  <Icon className={`h-6 w-6 ${active ? "text-primary" : ""}`} />
                </span>
                <span className={`truncate max-w-full ${active ? "font-medium text-foreground" : "text-muted-foreground"}`}>
                  {label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

/** Hook: true on mobile screen widths */
function useIsMobile(breakpoint = 768) {
  const [mobile, setMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < breakpoint);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const handler = (e: MediaQueryListEvent) => setMobile(e.matches);
    setMobile(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [breakpoint]);
  return mobile;
}

function CabinetShell() {
  const location = useLocation();
  const { state, logout, refreshProfile } = useClientAuth();
  const config = useCabinetConfig();
  const navItems = useMemo(
    () => (config?.sellOptionsEnabled ? ALL_NAV_ITEMS : ALL_NAV_ITEMS.filter((item) => item.to !== "/cabinet/extra-options")),
    [config?.sellOptionsEnabled]
  );
  const isMiniapp = useIsMiniapp();
  const isMobile = useIsMobile();
  const [logoError, setLogoError] = useState(false);
  useEffect(() => { setLogoError(false); }, [config?.logo]);
  useEffect(() => {
    if (state.token) refreshProfile().catch(() => {});
  }, [state.token, refreshProfile]);
  const serviceName = config?.serviceName ?? "";
  const logo = config?.logo && !logoError ? config.logo : null;

  // На мобилках и в мини-апп — единый компактный дизайн
  if (isMiniapp || isMobile) {
    return <MobileCabinetShell />;
  }

  return (
    <div className="min-h-svh flex flex-col bg-gradient-to-b from-background to-muted/20">
      <header className="sticky top-0 z-50 isolate border-b border-border bg-background shadow-sm" style={{ background: "hsl(var(--background))" }}>
        <div className="container mx-auto flex h-16 items-center justify-between gap-4 px-4">
          <Link to="/cabinet/dashboard" className="flex items-center gap-2.5 font-semibold text-lg tracking-tight shrink-0">
            {logo ? (
              <img src={logo} alt="" className="h-9 w-9 rounded-lg object-contain bg-card" onError={() => setLogoError(true)} />
            ) : (
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Shield className="h-5 w-5" />
              </span>
            )}
            {serviceName ? <span className="hidden sm:inline truncate">{serviceName}</span> : null}
          </Link>
          <nav className="flex items-center gap-1">
            {navItems.map(({ to, label, icon: Icon }) => (
              <Link key={to} to={to}>
                <Button
                  variant={location.pathname === to ? "secondary" : "ghost"}
                  size="sm"
                  className="inline-flex items-center gap-2 whitespace-nowrap"
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {label}
                </Button>
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2 shrink-0">
            <ThemeToggleButton className="shrink-0" />
            <span className="max-w-[160px] truncate text-sm text-muted-foreground" title={state.client?.email?.trim() || (state.client?.telegramUsername ? `@${state.client.telegramUsername}` : "")}>
              {state.client?.email?.trim() ? state.client.email : state.client?.telegramUsername ? `@${state.client.telegramUsername}` : "—"}
            </span>
            <Button variant="outline" size="sm" className="inline-flex items-center gap-2 whitespace-nowrap" asChild>
              <Link to="/cabinet/login" onClick={() => logout()}>
                <LogOut className="h-4 w-4 shrink-0" />
                Выйти
              </Link>
            </Button>
          </div>
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-6 max-w-4xl">
        <Outlet />
      </main>
    </div>
  );
}

export function CabinetLayout() {
  const location = useLocation();
  const { state } = useClientAuth();
  const isAuthPage = location.pathname === "/cabinet/login" || location.pathname === "/cabinet/register";
  const isLoggedIn = Boolean(state.token);

  if (isAuthPage || !isLoggedIn) {
    return <Outlet />;
  }

  return (
    <CabinetConfigProvider>
      <CabinetShellWithMiniapp />
    </CabinetConfigProvider>
  );
}

function CabinetShellWithMiniapp() {
  const isMiniapp = useIsMiniapp();
  const isMobile = useIsMobile();
  // На мобилках страницы тоже рендерятся в компактном режиме (как мини-апп)
  return (
    <IsMiniappContext.Provider value={isMiniapp || isMobile}>
      <CabinetShell />
    </IsMiniappContext.Provider>
  );
}
