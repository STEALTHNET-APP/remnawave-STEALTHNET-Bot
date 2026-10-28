import { cabinetSection } from "@/lib/cabinet-navigation";
import { LiteLayout } from "./lite-layout";
import { getPublicConfigCached } from "@/lib/public-config";
import "./classic-cabinet.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useClientAuth } from "@/contexts/client-auth";
import { CabinetConfigProvider, useCabinetConfig } from "@/contexts/cabinet-config";
import { createContext, useContext } from "react";
import { useIsMiniapp } from "@/hooks/use-is-miniapp";
import { useLanguageSync } from "@/i18n/use-language-sync";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { LayoutDashboard, Package, User, LogOut, Shield, Users, Sun, Moon, PlusCircle, Globe, KeyRound, MessageSquare, Palette, Monitor, Check, Loader2, Settings, Layers, MoreHorizontal, Wallet, Gift, Sparkles } from "lucide-react";
import { useTheme, ACCENT_PALETTES, type ThemeMode, type ThemeAccent } from "@/contexts/theme";
import { cn } from "@/lib/utils";
import { FloatingChat } from "@/components/floating-chat";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DashboardTour } from "@/components/tour/dashboard-tour";
import { useCabinetDesign } from "@/lib/use-cabinet-design";
import { StealthLayout } from "@/pages/cabinet/stealth/stealth-layout";
import { AuroraLayout } from "@/pages/cabinet/aurora/aurora-layout";

import { formatCabinetMoney as formatMoney } from "@/lib/cabinet-format";

function AnalyticsScripts() {
  useEffect(() => {
    api.getPublicConfig().then((c) => {
      if (c.googleAnalyticsId?.trim()) {
        const id = c.googleAnalyticsId.trim();
        if (document.getElementById("ga4-script")) return;
        const script = document.createElement("script");
        script.id = "ga4-script";
        script.async = true;
        script.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
        document.head.appendChild(script);
        const init = document.createElement("script");
        init.id = "ga4-init";
        init.textContent = `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${id}');`;
        document.head.appendChild(init);
      }
      if (c.yandexMetrikaId?.trim()) {
        const id = c.yandexMetrikaId.trim();
        const ymId = /^\d+$/.test(id) ? id : "0";
        if (document.getElementById("ym-script")) return;
        const script = document.createElement("script");
        script.id = "ym-script";
        script.async = true;
        script.textContent = `(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();for(var j=0;j<document.scripts.length;j++){if(document.scripts[j].src===r)return;}k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window, document, "script", "https://mc.yandex.ru/metrika/tag.js", "ym");ym(${ymId}, "init", {clickmap:true,trackLinks:true,accurateTrackBounce:true,webvisor:true});`;
        document.head.appendChild(script);
      }
    }).catch(() => { });
  }, []);
  return null;
}

const IsMiniappContext = createContext(false);
export function useCabinetMiniapp() {
  return useContext(IsMiniappContext);
}

/** Экран ввода кода 2FA после успешной проверки пароля или Telegram */
function Client2FAStepScreen() {
  const { state, submit2FACode, clearPending2FA } = useClientAuth();
  const { t } = useTranslation();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!state.pending2FAToken || code.trim().length !== 6) {
        setError(t("cabinet.layout.2fa_error_enter_code"));
        return;
      }
      setError(null);
      setLoading(true);
      try {
        await submit2FACode(code.trim());
      } catch (err) {
        setError(err instanceof Error ? err.message : t("cabinet.layout.2fa_error_invalid"));
      } finally {
        setLoading(false);
      }
    },
    [state.pending2FAToken, code, submit2FACode, t]
  );

  if (!state.pending2FAToken) return null;

  return (
    <div className="relative min-h-dvh flex items-center justify-center bg-background p-4 sm:p-8 overflow-hidden">
      <div className="absolute inset-0 z-0">
        <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] rounded-full bg-primary/20 blur-[120px]" />
        <div className="absolute top-[40%] -right-[10%] w-[40%] h-[40%] rounded-full bg-blue-500/20 blur-[120px]" />
        <div className="absolute -bottom-[20%] left-[20%] w-[50%] h-[50%] rounded-full bg-purple-500/20 blur-[120px]" />
      </div>

      <div className="w-full max-w-md relative z-10 flex flex-col rounded-[2rem] shadow-[0_8px_40px_rgba(0,0,0,0.08)] dark:shadow-[0_8px_40px_rgba(0,0,0,0.3)] min-w-0">
        <div className="absolute inset-0 overflow-hidden rounded-[2rem] border border-white/10 dark:border-white/5 bg-[hsl(var(--card)/0.85)] backdrop-blur-3xl pointer-events-none" />

        <div className="relative p-6 sm:p-8 flex flex-col items-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-primary/10 text-primary mb-6 shadow-inner border border-primary/20">
            <KeyRound className="h-8 w-8" />
          </div>
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("cabinet.layout.2fa_title")}</h1>
            <p className="text-sm text-muted-foreground mt-2 max-w-[280px]">{t("cabinet.layout.2fa_description")}</p>
          </div>
          <form onSubmit={handleSubmit} className="w-full flex flex-col gap-6">
            <div className="relative w-full">
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000 000"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className="w-full h-16 text-center text-3xl tracking-[0.3em] font-mono font-bold rounded-2xl border border-primary/20 bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 text-foreground transition-all"
                autoFocus
              />
            </div>

            <div className="flex flex-col gap-3">
              <Button type="submit" className="w-full h-12 rounded-2xl font-bold text-base shadow-lg shadow-primary/20" disabled={loading || code.trim().length !== 6}>
                {loading ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : null}
                {t("cabinet.layout.2fa_confirm")}
              </Button>
              <Button type="button" variant="ghost" className="w-full h-10 rounded-xl text-muted-foreground" disabled={loading} onClick={clearPending2FA}>
                {t("cabinet.layout.2fa_cancel")}
              </Button>
            </div>

            {error && (
              <p className="text-sm font-medium text-destructive text-center animate-in fade-in">{error}</p>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}

function useNavItems() {
  const { t } = useTranslation();
  return useMemo(() => [
    { to: "/cabinet/dashboard", label: t("cabinet.nav.home"), icon: LayoutDashboard },
    { to: "/cabinet/tariffs", label: t("cabinet.nav.tariffs"), icon: Package },
    { to: "/cabinet/wallet", label: t("cabinet.workspace.wallet"), icon: Wallet },
    { to: "/cabinet/help", label: t("cabinet.workspace.help"), icon: MessageSquare },
    { to: "/cabinet/custom-build", label: t("cabinet.nav.custom_build"), icon: Layers },
    { to: "/cabinet/extra-options", label: t("cabinet.nav.options"), icon: PlusCircle },
    { to: "/cabinet/proxy", label: t("cabinet.nav.proxy"), icon: Globe },
    { to: "/cabinet/singbox", label: t("cabinet.nav.access"), icon: KeyRound },
    { to: "/cabinet/referral", label: t("cabinet.nav.referrals"), icon: Users },
    { to: "/cabinet/tickets", label: t("cabinet.nav.tickets"), icon: MessageSquare },
    { to: "/cabinet/gifts", label: t("cabinet.workspace.gifts"), icon: Gift },
    { to: "/cabinet/roulette", label: t("cabinet.nav.roulette", "Рулетка"), icon: Sparkles },
    { to: "/cabinet/profile", label: t("cabinet.nav.profile"), icon: User },
  ], [t]);
}

function useThemeModeOptions() {
  const { t } = useTranslation();
  return useMemo(() => [
    { value: "light" as ThemeMode, icon: Sun, label: t("cabinet.layout.theme_light") },
    { value: "dark" as ThemeMode, icon: Moon, label: t("cabinet.layout.theme_dark") },
    { value: "system" as ThemeMode, icon: Monitor, label: t("cabinet.layout.theme_system") },
  ], [t]);
}

function ThemePopover() {
  const [show, setShow] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();
  const { config: themeConfig, setMode, setAccent, resolvedMode, allowUserThemeChange } = useTheme();
  const MODE_OPTIONS = useThemeModeOptions();

  useEffect(() => {
    if (!show) return;
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShow(false);
      }
    }
    // defer to next tick so the opening click doesn't immediately close
    const timer = setTimeout(() => document.addEventListener("mousedown", handleClick), 0);
    return () => { clearTimeout(timer); document.removeEventListener("mousedown", handleClick); };
  }, [show]);

  // Если смена темы запрещена — просто кнопка солнышко/луна без дропдауна
  if (!allowUserThemeChange) {
    return (
      <Button
        variant="ghost"
        size="sm"
        aria-label={resolvedMode === "dark" ? "Включить светлую тему" : "Включить тёмную тему"}
        className="h-10 w-10 p-0 bg-background/20 hover:bg-background/40 transition-all duration-300"
        onClick={() => setMode(resolvedMode === "dark" ? "light" : "dark")}
      >
        <span className="relative h-4 w-4">
          <Sun className={cn("absolute inset-0 h-4 w-4 transition-all duration-500", resolvedMode === "dark" ? "rotate-0 scale-100 opacity-100" : "-rotate-90 scale-0 opacity-0")} />
          <Moon className={cn("absolute inset-0 h-4 w-4 transition-all duration-500", resolvedMode === "light" ? "rotate-0 scale-100 opacity-100" : "rotate-90 scale-0 opacity-0")} />
        </span>
      </Button>
    );
  }

  return (
    <div className="relative" ref={popoverRef} onKeyDown={(e) => { if (e.key === "Escape") { setShow(false); popoverRef.current?.querySelector("button")?.focus(); } }}>
      <Button variant="ghost" size="sm" aria-label={t("cabinet.workspace.appearance_label")} aria-expanded={show} aria-controls="cabinet-theme-panel" className="h-10 w-10 p-0 bg-background/20 hover:bg-background/40" onClick={() => setShow(!show)}>
        <Palette className="h-3.5 w-3.5" />
      </Button>
      <div id="cabinet-theme-panel" hidden={!show}
        className={cn(
          "absolute -right-2 sm:right-0 top-full z-50 mt-3 w-[calc(100vw-2rem)] sm:w-[320px] max-w-[320px] rounded-[2rem] border border-white/40 dark:border-white/10 bg-slate-200/60 dark:bg-slate-900/60 backdrop-blur-[32px] p-5 shadow-[0_10px_60px_rgba(0,0,0,0.15)] dark:shadow-[0_10px_60px_rgba(0,0,0,0.5)] transition-all duration-300 origin-top-right",
          show
            ? "visible opacity-100 scale-100 pointer-events-auto translate-y-0"
            : "invisible opacity-0 scale-95 pointer-events-none -translate-y-2"
        )}
      >
        <div className="mb-5">
          <h4 className="mb-3 text-sm font-semibold tracking-tight text-foreground">{t("cabinet.layout.theme_heading")}</h4>
          <div className="flex rounded-xl bg-muted/60 p-1 border border-border/50">
            {MODE_OPTIONS.map((opt) => {
              const isActive = themeConfig.mode === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => setMode(opt.value)}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-xs font-medium transition-all duration-300",
                    isActive
                      ? "bg-background text-foreground shadow-sm ring-1 ring-border/50"
                      : "text-muted-foreground hover:bg-background/50 hover:text-foreground"
                  )}
                >
                  <opt.icon className="h-3.5 w-3.5" />
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {allowUserThemeChange && (
          <div>
            <h4 className="mb-3 text-sm font-semibold tracking-tight text-foreground">{t("cabinet.layout.color_accent")}</h4>
            <div className="grid grid-cols-4 gap-2">
              {(Object.entries(ACCENT_PALETTES) as [ThemeAccent, typeof ACCENT_PALETTES["default"]][]).map(([key, palette]) => {
                const isActive = themeConfig.accent === key;
                return (
                  <button
                    key={key}
                    onClick={() => setAccent(key)}
                    className={cn(
                      "group flex flex-col items-center gap-2 rounded-xl p-2 transition-all duration-300",
                      isActive ? "bg-primary/10" : "hover:bg-muted/60"
                    )}
                  >
                    <div
                      className={cn(
                        "relative flex h-8 w-8 items-center justify-center rounded-full shadow-sm transition-transform duration-300",
                        isActive ? "scale-110 ring-4 ring-primary/20" : "group-hover:scale-110"
                      )}
                      style={{ backgroundColor: palette.swatch }}
                    >
                      {isActive && <Check className="h-4 w-4 text-white drop-shadow-md" />}
                    </div>
                    <span className={cn(
                      "text-[10px] font-medium tracking-tight truncate w-full text-center transition-colors",
                      isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                    )}>
                      {palette.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SettingsPopover() {
  const [show, setShow] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();
  const { state, refreshProfile } = useClientAuth();

  const config = useCabinetConfig();
  const [preferredLang, setPreferredLang] = useState(state.client?.preferredLang ?? "ru");
  const [preferredCurrency, setPreferredCurrency] = useState(state.client?.preferredCurrency ?? "usd");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    if (!show) {
      if (state.client) {
        setPreferredLang(state.client.preferredLang);
        setPreferredCurrency(state.client.preferredCurrency);
      }
      return;
    }

    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShow(false);
      }
    }
    const timer = setTimeout(() => document.addEventListener("mousedown", handleClick), 0);
    return () => { clearTimeout(timer); document.removeEventListener("mousedown", handleClick); };
  }, [show, state.client]);

  async function handleSave() {
    if (!state.token) return;
    setSaving(true);
    setSaveError(false);
    try {
      await api.clientUpdateProfile(state.token, { preferredLang, preferredCurrency });
      await refreshProfile();
      setShow(false);
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  const langs = config?.activeLanguages?.length ? config.activeLanguages : [preferredLang];
  const currencies = config?.activeCurrencies?.length ? config.activeCurrencies : [preferredCurrency];

  return (
    <div className="relative" ref={popoverRef} data-tour="language-currency" onKeyDown={event => { if (event.key === "Escape") { setShow(false); popoverRef.current?.querySelector("button")?.focus(); } }}>
      <Button aria-label={t("cabinet.workspace.settings_label")} aria-expanded={show} aria-controls="cabinet-settings-panel" variant="ghost" size="sm" className="gap-1.5 text-xs h-8 px-2 bg-background/20 hover:bg-background/40" onClick={() => setShow(!show)}>
        <Settings className="h-3.5 w-3.5" />
      </Button>
      <div id="cabinet-settings-panel" hidden={!show}
        className={cn(
          "absolute -right-2 sm:right-0 top-full z-50 mt-3 w-[calc(100vw-2rem)] sm:w-[260px] max-w-[260px] rounded-[2rem] border border-border bg-card text-card-foreground p-5 shadow-[0_10px_60px_rgba(0,0,0,0.15)] dark:shadow-[0_10px_60px_rgba(0,0,0,0.5)] transition-all duration-300 origin-top-right",
          show ? "visible opacity-100 scale-100 pointer-events-auto translate-y-0" : "invisible opacity-0 scale-95 pointer-events-none -translate-y-2"
        )}
      >
        <div className="flex items-center gap-3 mb-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
            <Settings className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h4 className="text-base font-bold tracking-tight text-foreground truncate">{t("cabinet.layout.settings")}</h4>
            <p className="text-xs text-muted-foreground mt-[1px] uppercase tracking-wider font-semibold truncate">{t("cabinet.layout.settings_subtitle")}</p>
          </div>
        </div>

        <div className="space-y-4 mb-5">
          <div className="space-y-1.5">
            <label className="text-xs text-foreground font-medium pl-1 flex items-center gap-1.5"><Globe className="w-3.5 h-3.5" /> {t("cabinet.layout.language")}</label>
            <select aria-label={t("cabinet.layout.language")} value={preferredLang} onChange={event => setPreferredLang(event.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm">{langs.map(language => <option key={language} value={language}>{language === "ru" ? "Русский" : language === "en" ? "English" : language.toUpperCase()}</option>)}</select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-foreground font-medium pl-1 flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> {t("cabinet.layout.currency")}</label>
            <select aria-label={t("cabinet.layout.currency")} value={preferredCurrency} onChange={event => setPreferredCurrency(event.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm">{currencies.map(currency => <option key={currency} value={currency}>{currency.toUpperCase()}</option>)}</select>
          </div>
        </div>

        {saveError && <p role="alert" className="mb-3 text-sm text-destructive">{t("cabinet.workspace.save_error")}</p>}
        <Button onClick={handleSave} disabled={saving || !config} className="w-full h-10 rounded-xl shadow-md bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold transition-all hover:scale-[1.02] active:scale-95">
          {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />}
          {t("cabinet.layout.save")}
        </Button>
      </div>
    </div>
  );
}

function resolveNavItems(allNavItems: { to: string; label: string; icon: typeof LayoutDashboard }[], config: { sellOptionsEnabled?: boolean; showProxyEnabled?: boolean; showSingboxEnabled?: boolean; ticketsEnabled?: boolean; customBuildConfig?: { enabled: true } | null; giftSubscriptionsEnabled?: boolean; rouletteEnabled?: boolean } | null) {
  let items = allNavItems;
  // Убираем вкладку тикетов, так как теперь поддержка внутри виджета чата
  items = items.filter((i) => i.to !== "/cabinet/tickets");

  if (!config?.customBuildConfig) items = items.filter((i) => i.to !== "/cabinet/custom-build");
  if (!config?.sellOptionsEnabled) items = items.filter((i) => i.to !== "/cabinet/extra-options");
  if (!config?.showProxyEnabled) items = items.filter((i) => i.to !== "/cabinet/proxy");
  if (!config?.showSingboxEnabled) items = items.filter((i) => i.to !== "/cabinet/singbox");
  if (!config?.giftSubscriptionsEnabled) items = items.filter((i) => i.to !== "/cabinet/gifts");
  if (config?.rouletteEnabled === false) items = items.filter((i) => i.to !== "/cabinet/roulette");

  return items;
}


/** Маппинг route → data-tour атрибут для тура */
const ROUTE_TOUR_MAP: Record<string, string> = {
  "/cabinet/dashboard": "dashboard",
  "/cabinet/tariffs": "tariffs",
  "/cabinet/custom-build": "custom-build",
  "/cabinet/extra-options": "extra-options",
  "/cabinet/proxy": "proxy",
  "/cabinet/singbox": "singbox",
  "/cabinet/referral": "referrals",
  "/cabinet/tickets": "support",
  "/cabinet/gifts": "gifts",
  "/cabinet/roulette": "roulette",
  "/cabinet/profile": "profile",
  "/cabinet/wallet": "wallet",
  "/cabinet/help": "support",
};

function CabinetShell() {
  const location = useLocation();
  const { t } = useTranslation();
  const { state, logout, refreshProfile } = useClientAuth();
  const config = useCabinetConfig();
  const allItems = useNavItems();
  const items = useMemo(() => resolveNavItems(allItems, config), [allItems, config]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoError, setLogoError] = useState(false);
  const isMiniapp = useIsMiniapp();
  const primary = items.filter(item => ["/cabinet/dashboard", "/cabinet/tariffs", "/cabinet/wallet", "/cabinet/help"].includes(item.to));
  const groups = [
    { label: t("cabinet.workspace.connection"), paths: ["dashboard", "tariffs", "custom-build", "extra-options", "proxy", "singbox"] },
    { label: t("cabinet.workspace.account"), paths: ["wallet", "profile", "help"] },
    { label: t("cabinet.workspace.benefits"), paths: ["referral", "gifts", "roulette"] },
  ];
  const section = cabinetSection(location.pathname);
  const current = items.find(item => item.to === section);
  useEffect(() => { setLogoError(false); }, [config?.logo]);
  useEffect(() => {
    setMenuOpen(false);
    if (!location.hash) window.scrollTo({ top: 0, behavior: "instant" });
  }, [location.pathname]);
  useEffect(() => {
    const open = () => setMenuOpen(true);
    window.addEventListener("tour:open-more-menu", open);
    return () => window.removeEventListener("tour:open-more-menu", open);
  }, []);
  useEffect(() => { if (state.token) refreshProfile().catch(() => {}); }, [state.token, refreshProfile]);
  const identity = state.client?.email || (state.client?.telegramUsername ? `@${state.client.telegramUsername}` : t("cabinet.workspace.account"));
  const brand = <Link to="/cabinet/dashboard" className="cabinet-brand">{config?.logo && !logoError ? <img src={config.logo} alt="" onError={() => setLogoError(true)} /> : <Shield size={24} />}<span>{config?.serviceName || "STEALTHNET"}</span></Link>;
  const navigation = (mobile: boolean) => <nav aria-label={t("cabinet.workspace.navigation")} className="cabinet-navigation">{groups.map(group => {
    const links = items.filter(item => group.paths.includes(item.to.split("/").pop()!));
    return links.length > 0 && <div className="cabinet-nav-group" key={group.label}><p>{group.label}</p>{links.map(({ to, label, icon: Icon }) => <Link key={to} to={to} onClick={() => setMenuOpen(false)} aria-current={section === to ? "page" : undefined} data-tour={mobile ? undefined : ROUTE_TOUR_MAP[to]}><Icon size={18} /><span>{label}</span>{section === to && <span className="cabinet-nav-dot" aria-hidden="true" />}</Link>)}</div>;
  })}</nav>;
  return <div className="classic-cabinet cabinet-workspace">
    <a className="cabinet-skip" href="#cabinet-content">{t("cabinet.workspace.skip")}</a>
    <aside className="cabinet-sidebar">
      {brand}
      {navigation(false)}
      <Link to="/cabinet/profile" className="cabinet-identity"><span className="cabinet-avatar"><User size={19} /></span><span><strong>{identity}</strong><small>{t("cabinet.workspace.account_settings")}</small></span></Link>
    </aside>
    <div className="cabinet-workspace-body">
      <header className="cabinet-topbar">
        <div className="cabinet-mobile-brand">{brand}</div>
        <div className="cabinet-breadcrumb"><span>{t("cabinet.workspace.cabinet")}</span><span aria-hidden="true">/</span><strong>{current?.label || t("cabinet.workspace.connection")}</strong></div>
        <div className="cabinet-toolbar">
          <Link className="cabinet-header-balance" to="/cabinet/wallet" aria-label={t("cabinet.workspace.open_wallet")}><Wallet size={17} /><span>{state.client ? formatMoney(state.client.balance, state.client.preferredCurrency) : "—"}</span></Link>
          <ThemePopover /><SettingsPopover />
          {!isMiniapp && <Button variant="ghost" size="icon" asChild><Link to="/cabinet/login" onClick={logout} aria-label={t("cabinet.nav.logout")}><LogOut size={18} /></Link></Button>}
        </div>
      </header>
      <main id="cabinet-content" tabIndex={-1} className="cabinet-content"><Outlet /></main>
      <footer className="cabinet-footer"><span>{config?.serviceName || "STEALTHNET"}</span><Link to="/cabinet/help">{t("cabinet.workspace.help")}</Link><Link to="/cabinet/documents/offer">{t("cabinet.workspace.terms")}</Link><Link to="/cabinet/documents/privacy">{t("cabinet.workspace.privacy")}</Link></footer>
    </div>
    <nav className="cabinet-bottom-nav" aria-label={t("cabinet.workspace.quick_navigation")}>{primary.map(({ to, label, icon: Icon }) => <Link key={to} to={to} aria-current={section === to ? "page" : undefined}><Icon size={21} /><span>{label}</span></Link>)}<button aria-expanded={menuOpen} aria-label={t("cabinet.nav.menu")} onClick={() => setMenuOpen(true)}><MoreHorizontal size={21} /><span>{t("cabinet.nav.more")}</span></button></nav>
    <Dialog open={menuOpen} onOpenChange={setMenuOpen}><DialogContent className="cabinet-menu-dialog"><DialogHeader><DialogTitle>{t("cabinet.nav.menu")}</DialogTitle></DialogHeader>{navigation(true)}</DialogContent></Dialog>
    <FloatingChat />
  </div>;
}

export function CabinetLayout() {
  const [liteMode, setLiteMode] = useState(false);
  useEffect(() => { let active = true; getPublicConfigCached().then(config => { if (active) setLiteMode(config.liteMode === true); }).catch(() => {}); return () => { active = false; }; }, []);
  const location = useLocation();
  const { state } = useClientAuth();
  useLanguageSync(state.client?.preferredLang);
  const isAuthPage = location.pathname === "/cabinet/login" || location.pathname === "/cabinet/register";
  const isLoggedIn = Boolean(state.token);
  const needs2FA = !isLoggedIn && Boolean(state.pending2FAToken);

  // Чтение нового дизайна происходит асинхронно, чтобы не задерживать первый
  // рендер. Первое мгновение — classic (или то что в localStorage-кэше),
  // потом пере-рендер если в БД задано "stealth".
  const design = useCabinetDesign();

  // Если выбран Stealth — отдаём управление новому layout'у. Он сам рендерит
  // chrome (network фон + bottom-tabs + header) и Outlet.
  // ВАЖНО: для auth/2fa-страниц используем classic — их Stealth-дизайн пока
  // не оформлен (Phase 2/3).
  if (liteMode && isLoggedIn && !needs2FA && !isAuthPage) return <CabinetConfigProvider><LiteLayout /></CabinetConfigProvider>;

  if (design === "stealth" && isLoggedIn && !needs2FA && !isAuthPage) {
    return <StealthLayout />;
  }

  // Aurora — третий дизайн мини-аппа (светлый, градиентная карточка подписки).
  // Как и Stealth, применяется только к «внутренним» страницам: экраны входа
  // и 2FA остаются классическими.
  if (design === "aurora" && isLoggedIn && !needs2FA && !isAuthPage) {
    return <CabinetConfigProvider><AuroraLayout /></CabinetConfigProvider>;
  }

  return (
    <>
      <AnalyticsScripts />
      {needs2FA ? (
        <Client2FAStepScreen />
      ) : isAuthPage || !isLoggedIn ? (
        <div className="classic-auth"><Outlet /></div>
      ) : (
        <CabinetConfigProvider>
          <CabinetShellWithMiniapp />
        </CabinetConfigProvider>
      )}
    </>
  );
}

function CabinetShellWithMiniapp() {
  const isMiniapp = useIsMiniapp();
  const { state } = useClientAuth();
  const [runTour, setRunTour] = useState(false);

  useEffect(() => {
    if (!state.token) return;
    if (!localStorage.getItem("stealthnet_tour_completed")) {
      const timer = setTimeout(() => setRunTour(true), 500);
      return () => clearTimeout(timer);
    }
  }, [state.token]);

  return (
    <IsMiniappContext.Provider value={isMiniapp}>
      <DashboardTour
        run={runTour}
        onComplete={() => {
          setRunTour(false);
          localStorage.setItem("stealthnet_tour_completed", "true");
        }}
      />
      <CabinetShell />
    </IsMiniappContext.Provider>
  );
}
