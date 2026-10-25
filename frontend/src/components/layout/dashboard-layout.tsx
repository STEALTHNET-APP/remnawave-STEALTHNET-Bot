import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import gsap from "gsap";
import { reducedMotion } from "@/lib/gsap-utils";
import {
  Shield, LayoutDashboard, Users, CreditCard, Settings, LogOut, KeyRound,
  Search, Megaphone, Tag, BarChart3, FileText, ExternalLink, Sun, Moon, Monitor,
  Palette, Menu, X, Database, Target, UserCog, Send, CalendarClock, Globe, Server, MessageSquare, Trophy,
  Network, ShieldAlert, ShieldBan, Key, Video, Languages, Gift, Sparkles, Rocket, Bot,
  ChevronRight, ChevronDown, Check, ShoppingBag,
  Activity, Inbox, ClipboardList, TrendingUp, Mail,
  RefreshCw, Layers, FileCode2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAdminLanguageSync } from "@/i18n/use-language-sync";
import { ReleaseToast } from "@/components/admin/release-toast";
import { ProjectLinks } from "@/components/admin/project-links";
import { PROJECT_GITHUB_URL } from "@/lib/project-links";
import { useAuth } from "@/contexts/auth";
import { useTheme, ACCENT_PALETTES, type ThemeMode, type ThemeAccent } from "@/contexts/theme";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { canAccessSection, isNavActive, getManagerRedirect } from "@/lib/admin-navigation";
import { api, type AdminNotificationCounters } from "@/lib/api";
import { UpdateNotice } from "@/components/admin/update-notice";
import { InboxBell } from "@/components/inbox-bell";
import appVersion from "../../../../version.json";

const PANEL_VERSION = appVersion.version;
const PANEL_BUILD = appVersion as { commit?: string; builtAt?: string };
const PANEL_COMMIT = PANEL_BUILD.commit && PANEL_BUILD.commit !== "unknown" ? PANEL_BUILD.commit.slice(0, 7) : null;
const GITHUB_URL = PROJECT_GITHUB_URL;

// пункт меню может быть защищён action'ом
// вместо обычной секции — для гранулярных прав менеджеров (например, «Продажи через баланс»).
type NavItem = { to: string; label: string; icon: typeof LayoutDashboard; section: string; category: string; requiredAction?: string };

const CATEGORY_ORDER = ["management", "subscription", "overview", "marketing", "infrastructure", "security", "tools", "settings"];

const CATEGORY_I18N: Record<string, string> = Object.fromEntries(
  CATEGORY_ORDER.map((category) => [category, `admin.navigation.groups.${category}`])
);

function useNavSections(): NavItem[] {
  const { t } = useTranslation();
  return [
    { to: "/admin", label: t("admin.nav.dashboard"), icon: LayoutDashboard, section: "dashboard", category: "overview" },
    { to: "/admin/analytics", label: t("admin.nav.analytics"), icon: BarChart3, section: "analytics", category: "overview" },
    { to: "/admin/business-analytics", label: "Бизнес-аналитика", icon: TrendingUp, section: "analytics", category: "overview" },
    { to: "/admin/anti-fraud", label: "Anti-fraud", icon: ShieldAlert, section: "analytics", category: "security" },
    { to: "/admin/bot-conversations", label: "Активность клиентов", icon: MessageSquare, section: "clients", category: "management" },
    { to: "/admin/sales-report", label: t("admin.nav.sales_report"), icon: FileText, section: "sales-report", category: "overview" },
    // отчёт продаж только через баланс — для менеджеров с action'ом.
    { to: "/admin/balance-sales", label: "Продажи через баланс", icon: FileText, section: "balance-sales-virtual", category: "overview", requiredAction: "view_balance_sales" },
    { to: "/admin/traffic-abuse", label: t("admin.nav.traffic_abuse"), icon: ShieldAlert, section: "traffic-abuse", category: "security" },
    { to: "/admin/anti-abuse", label: "Анти-абьюз трафика", icon: ShieldBan, section: "anti-abuse", category: "security" },
    { to: "/admin/clients", label: t("admin.nav.clients"), icon: Users, section: "clients", category: "management" },
    { to: "/admin/proxy", label: t("admin.nav.proxy"), icon: Globe, section: "proxy", category: "subscription" },
    { to: "/admin/singbox", label: t("admin.nav.singbox"), icon: Server, section: "singbox", category: "subscription" },
    { to: "/admin/backup", label: t("admin.nav.backups"), icon: Database, section: "backup", category: "infrastructure" },
    { to: "/admin/tickets", label: t("admin.nav.tickets"), icon: MessageSquare, section: "tickets", category: "management" },
    { to: "/admin/tariffs", label: t("admin.nav.tariffs"), icon: CreditCard, section: "tariffs", category: "subscription" },
    // T15 (11.05.2026) — управление пробными подписками (Trial-пресеты).
    { to: "/admin/trials", label: t("admin.navigation.trials"), icon: Gift, section: "trials", category: "subscription" },
    // T6 (11.05.2026) — заявки на вывод реф. баланса (USDT TRC20).
    { to: "/admin/withdrawals", label: "Заявки на вывод", icon: CreditCard, section: "withdrawals", category: "subscription" },
    // T-autorenew (12.05.2026) — автосписание + конструктор уведомлений.
    { to: "/admin/auto-renew", label: "Автосписание", icon: RefreshCw, section: "auto-renew", category: "subscription" },
    { to: "/admin/promo", label: t("admin.nav.promo_links"), icon: Megaphone, section: "promo", category: "marketing" },
    { to: "/admin/promo-codes", label: t("admin.nav.promo_codes"), icon: Tag, section: "promo-codes", category: "marketing" },
    // Remnawave инфра-управление (ADMIN-only): ноды / сквады / хосты / config-профили.
    { to: "/admin/remna-nodes", label: "Ноды", icon: Server, section: "infra-nodes", category: "infrastructure" },
    { to: "/admin/remna-squads", label: "Сквады", icon: Layers, section: "infra-squads", category: "infrastructure" },
    { to: "/admin/remna-hosts", label: "Хосты", icon: Network, section: "infra-hosts", category: "infrastructure" },
    { to: "/admin/remna-profiles", label: "Config-профили", icon: FileCode2, section: "infra-profiles", category: "infrastructure" },
    { to: "/admin/remna-sub-templates", label: "Шаблоны подписки", icon: FileText, section: "infra-templates", category: "infrastructure" },
    { to: "/admin/marketing", label: t("admin.nav.marketing"), icon: Target, section: "marketing", category: "marketing" },
    { to: "/admin/referral-network", label: t("admin.nav.referral_network"), icon: Network, section: "referral-network", category: "marketing" },
    // детальная страница рефералки по клиенту (поиск, реферер, заработок, кредиты).
    { to: "/admin/referrals", label: t("admin.navigation.referrals"), icon: Users, section: "referrals", category: "marketing" },
    { to: "/admin/secondary-subscriptions", label: "Подписки", icon: Gift, section: "secondary-subscriptions", category: "management" },
    { to: "/admin/video-instructions", label: t("admin.nav.video_instructions"), icon: Video, section: "video-instructions", category: "tools" },
    { to: "/admin/broadcast", label: t("admin.nav.broadcast"), icon: Send, section: "broadcast", category: "marketing" },
    { to: "/admin/auto-broadcast", label: t("admin.nav.auto_broadcast"), icon: CalendarClock, section: "auto-broadcast", category: "marketing" },
    { to: "/admin/contests", label: t("admin.nav.contests"), icon: Trophy, section: "contests", category: "marketing" },
    { to: "/admin/tour-constructor", label: "Конструктор тура", icon: Sparkles, section: "tour-constructor", category: "tools" },
    { to: "/admin/promo-vpn", label: t("admin.nav.promo_vpn"), icon: Rocket, section: "promo-vpn", category: "marketing" },
    { to: "/admin/marketplace", label: t("admin.nav.marketplace"), icon: ShoppingBag, section: "marketplace", category: "tools" },
    { to: "/admin/settings", label: t("admin.nav.settings"), icon: Settings, section: "settings", category: "settings" },
    { to: "/admin/languages", label: t("admin.nav.languages"), icon: Languages, section: "languages", category: "settings" },
    { to: "/admin/admins", label: t("admin.nav.managers"), icon: UserCog, section: "admins", category: "settings" },
    { to: "/admin/api-keys", label: t("admin.nav.api_keys"), icon: Key, section: "api-keys", category: "settings" },
    { to: "/admin/antibot", label: "Антибот", icon: Shield, section: "antibot", category: "security" },
    { to: "/admin/diagnostics", label: "Диагностика", icon: Activity, section: "diagnostics", category: "infrastructure" },
    { to: "/admin/email-templates", label: "Email-шаблоны", icon: Mail, section: "settings", category: "tools" },
    { to: "/admin/bot-messages", label: "Тексты бота", icon: Bot, section: "settings", category: "tools" },
    { to: "/admin/webhook-inbox", label: "Webhook inbox", icon: Inbox, section: "webhook-inbox", category: "security" },
    { to: "/admin/audit", label: "Аудит-лог", icon: ClipboardList, section: "audit", category: "security" },
  ];
}

function NavItems({ onClick }: { onClick?: () => void }) {
  const { t } = useTranslation();
  const location = useLocation();
  const admin = useAuth().state.admin;
  const allNav = useNavSections();
  const navBySection = admin
    ? allNav.filter((item) => canAccessSection(admin.role, admin.allowedSections, item.section, item.requiredAction))
    : allNav;
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("admin-nav-collapsed") ?? "null");
      if (stored && typeof stored === "object" && !Array.isArray(stored)) return stored;
    } catch {}
    return {};
  });
  const activeCategory = navBySection.find((item) => isNavActive(location.pathname, item.to))?.category;
  useEffect(() => {
    if (activeCategory) setCollapsed((previous) => {
      const next = { ...previous };
      delete next[activeCategory];
      return next;
    });
    setQuery("");
  }, [location.pathname, activeCategory]);
  const toggleCategory = (category: string) => {
    setCollapsed((previous) => {
      const next = { ...previous, [category]: !(previous[category] ?? category !== activeCategory) };
      try { localStorage.setItem("admin-nav-collapsed", JSON.stringify(next)); } catch {}
      return next;
    });
  };
  const search = query.trim().toLocaleLowerCase();
  const nav = navBySection.filter((item) => !search || `${item.label} ${t(CATEGORY_I18N[item.category])} ${item.to}`.toLocaleLowerCase().includes(search));
  const groupedNav = CATEGORY_ORDER.map((category) => ({
    category,
    items: nav.filter((item) => item.category === category && item.to !== "/admin").sort((a, b) => {
      if (category !== "management" && category !== "subscription") return 0;
      const order = category === "management"
        ? ["/admin/clients", "/admin/secondary-subscriptions", "/admin/tickets", "/admin/bot-conversations"]
        : ["/admin/tariffs", "/admin/trials", "/admin/auto-renew", "/admin/withdrawals", "/admin/proxy", "/admin/singbox"];
      return order.indexOf(a.to) - order.indexOf(b.to);
    }),
  })).filter(({ items }) => items.length > 0);

  return (
    <>
      <div className="sticky top-0 z-20 bg-background pb-2">
        <div className="relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <input type="search" aria-label={t("admin.navigation.search")} placeholder={t("admin.navigation.search")}
            value={query} onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Escape") setQuery(""); }}
            className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary" />
        </div>
      </div>
      {nav.filter((item) => item.to === "/admin").map((item) => <Link key={item.to} to={item.to} onClick={onClick}
        aria-current={location.pathname === item.to ? "page" : undefined}
        className={cn("mb-2 flex min-h-10 items-center gap-2.5 rounded-lg px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary", location.pathname === item.to ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted")}>
        <item.icon className="h-4 w-4" aria-hidden="true" />{item.label}
      </Link>)}
      {nav.length === 0 && <p role="status" className="px-3 py-4 text-sm text-muted-foreground">{t("admin.navigation.no_results")}</p>}
      {groupedNav.map(({ category, items }) => {
        const expanded = !!search || !(collapsed[category] ?? category !== activeCategory);
        return (
          <div key={category} className="mb-1 last:mb-0">
            <button type="button" aria-expanded={expanded} onClick={() => toggleCategory(category)} disabled={!!search}
              className="flex min-h-10 w-full items-center justify-between gap-2 rounded-lg px-3 text-left text-[11px] font-semibold text-muted-foreground hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-80">
              <span>{t(CATEGORY_I18N[category])}</span>
              <ChevronDown aria-hidden="true" className={cn("h-3.5 w-3.5 shrink-0 transition-transform", !expanded && "-rotate-90")} />
            </button>
            {expanded && <div className="space-y-0.5 px-1.5">
              {items.map((item) => {
                const isActive = isNavActive(location.pathname, item.to);
                return (
                  <Link key={item.to} to={item.to} onClick={onClick} aria-current={isActive ? "page" : undefined}
                    className={cn("group relative flex min-h-10 items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary",
                      isActive ? "bg-primary/[0.14] text-primary font-semibold" : "text-muted-foreground hover:text-foreground hover:bg-muted")}>
                    <item.icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                    <span className="text-[12.8px] leading-snug">{item.label}</span>
                    {isActive && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-full bg-primary" />}
                  </Link>
                );
              })}
            </div>}
          </div>
        );
      })}
    </>
  );
}

export function DashboardLayout() {
  const { t } = useTranslation();
  useAdminLanguageSync();
  const { state, logout } = useAuth();
  const { config: themeConfig, setMode, setAccent } = useTheme();

  const MODE_OPTIONS: { value: ThemeMode; icon: typeof Sun; label: string }[] = [
    { value: "light", icon: Sun, label: t("admin.header.theme_light") },
    { value: "dark", icon: Moon, label: t("admin.header.theme_dark") },
    { value: "system", icon: Monitor, label: t("admin.header.theme_system") },
  ];
  const navigate = useNavigate();
  const location = useLocation();
  const [brand, setBrand] = useState<{ serviceName: string; logo: string | null }>({ serviceName: "", logo: null });
  const [showThemePanel, setShowThemePanel] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notificationToasts, setNotificationToasts] = useState<{ id: number; text: string; icon: string }[]>([]);
  const lastCountersRef = useRef<AdminNotificationCounters | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(true);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileMenuOpen]);

  const [mobileSidebarVisible, setMobileSidebarVisible] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const sidebarOverlayRef = useRef<HTMLDivElement>(null);
  const sidebarCloseTimer = useRef<number | null>(null);
  // gsap-шторка: open → slide-in; close → slide-out, потом unmount (двухфазный mount-паттерн).
  useEffect(() => {
    if (sidebarCloseTimer.current !== null) {
      window.clearTimeout(sidebarCloseTimer.current);
      sidebarCloseTimer.current = null;
    }
    if (mobileMenuOpen) {
      setMobileSidebarVisible(true);
    } else if (mobileSidebarVisible) {
      if (reducedMotion()) {
        setMobileSidebarVisible(false);
        return;
      }
      const panel = sidebarRef.current;
      const overlay = sidebarOverlayRef.current;
      if (!panel) {
        setMobileSidebarVisible(false);
        return;
      }
      const ctx = gsap.context(() => {
        gsap.to(panel, { x: -290, duration: 0.25, ease: "power2.in", overwrite: "auto" });
        if (overlay) gsap.to(overlay, { opacity: 0, duration: 0.2, ease: "power2.in" });
      }, panel);
      sidebarCloseTimer.current = window.setTimeout(() => {
        sidebarCloseTimer.current = null;
        ctx.revert();
        gsap.set(panel, { clearProps: "all" });
        setMobileSidebarVisible(false);
      }, 260);
      return () => {
        window.clearTimeout(sidebarCloseTimer.current ?? 0);
        ctx.revert();
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobileMenuOpen]);

  // Вход шторки после монтирования.
  useLayoutEffect(() => {
    const panel = sidebarRef.current;
    const overlay = sidebarOverlayRef.current;
    if (!panel || !mobileSidebarVisible || !mobileMenuOpen) return;
    if (reducedMotion()) {
      gsap.set(panel, { clearProps: "all" });
      return;
    }
    const ctx = gsap.context(() => {
      gsap.fromTo(panel, { x: -290 }, { x: 0, duration: 0.3, ease: "power2.out", overwrite: "auto" });
      if (overlay) gsap.fromTo(overlay, { opacity: 0 }, { opacity: 1, duration: 0.2, ease: "power2.out" });
    }, panel);
    return () => ctx.revert();
  }, [mobileSidebarVisible, mobileMenuOpen]);

  const allNav = useNavSections();
  const managerRedirect = getManagerRedirect(state.admin, location.pathname, allNav);
  useEffect(() => {
    if (managerRedirect && managerRedirect !== location.pathname) navigate(managerRedirect, { replace: true });
  }, [managerRedirect, location.pathname, navigate]);

  useEffect(() => {
    const token = state.accessToken;
    if (token) {
      api.getSettings(token).then((s) => {
        setBrand({ serviceName: s.serviceName, logo: s.logo ?? null });
        setNotificationsEnabled(s.adminFrontNotificationsEnabled ?? true);
      }).catch(() => {});
    }
  }, [state.accessToken]);

  useEffect(() => {
    const token = state.accessToken;
    if (!token || !notificationsEnabled) return;
    let cancelled = false;
    const pushToast = (text: string, icon = "") => {
      const id = Date.now() + Math.random();
      setNotificationToasts((prev) => [...prev, { id, text, icon }]);
      window.setTimeout(() => { setNotificationToasts((prev) => prev.filter((t) => t.id !== id)); }, 5000);
    };
    const fetchCounters = async () => {
      try {
        const data = await api.getAdminNotificationCounters(token);
        if (cancelled) return;
        const last = lastCountersRef.current;
        if (last) {
          const newClients = data.totalClients - last.totalClients;
          const newPayments = data.totalTariffPayments - last.totalTariffPayments;
          const newTopups = data.totalBalanceTopups - last.totalBalanceTopups;
          const newTickets = data.totalTickets - last.totalTickets;
          if (newClients > 0) pushToast(newClients === 1 ? t("admin.header.notification_new_client") : t("admin.header.notification_new_clients", { newClients }), "\u{1F464}");
          if (newPayments > 0) pushToast(newPayments === 1 ? t("admin.header.notification_new_payment") : t("admin.header.notification_new_payments", { newPayments }), "\u{1F4E6}");
          if (newTopups > 0) pushToast(newTopups === 1 ? t("admin.header.notification_new_topup") : t("admin.header.notification_new_topups", { newTopups }), "\u{1F4B0}");
          if (newTickets > 0) pushToast(newTickets === 1 ? t("admin.header.notification_new_ticket") : t("admin.header.notification_new_tickets", { newTickets }), "\u{1F4AC}");
        }
        lastCountersRef.current = data;
      } catch { /* ignore */ }
    };
    fetchCounters();
    const id = window.setInterval(fetchCounters, 15000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [state.accessToken, notificationsEnabled]);

  async function handleLogout() {
    await logout();
    navigate("/admin/login", { replace: true });
  }

  return (
    <div className="flex min-h-svh bg-background relative">
      <ReleaseToast />

      {/*  Global Ambient Lights  */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10" aria-hidden>
        <div className="absolute inset-0" style={{ backgroundColor: 'hsl(var(--background))' }} />
        <div className="absolute inset-0 bg-transparent" />
        
        
        
      </div>

      {/*  Desktop sidebar  */}
      <aside className="glass-surface hidden md:flex flex-col shrink-0 fixed left-0 top-0 bottom-0 w-[240px] z-30 border-r border-border/70 overflow-hidden">
        <div className="flex h-[52px] items-center gap-2.5 px-4 border-b border-border relative z-10">
          <div className="absolute bottom-0 left-6 right-6 h-[1px] bg-transparent"></div>
          {brand.logo ? (
            <img src={brand.logo} alt="" className="h-8 w-auto object-contain" />
          ) : (
            <Shield className="h-6 w-6 text-primary shrink-0" />
          )}
          {brand.serviceName ? <span className="font-bold text-[14.5px] tracking-wide truncate">{brand.serviceName}</span> : null}
        </div>
        <nav className="flex-1 space-y-0.5 p-2.5 overflow-y-auto relative z-10 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-card [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent hover:[&::-webkit-scrollbar-thumb]:bg-card">
          <NavItems />
        </nav>
        <div className="border-t border-border p-3 space-y-1 relative z-10">
          <div className="text-[11px] font-semibold text-emerald-500 px-2.5 py-0.5 mb-0.5 flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            {t("admin.header.online")}
          </div>
          <div className="text-[11.5px] text-muted-foreground truncate px-2.5 pb-2">{state.admin?.email}</div>
          <Link to="/admin/change-password" className="block">
            <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors text-[12.8px]">
              <KeyRound className="h-4 w-4" />
              {t("admin.header.change_password")}
            </Button>
          </Link>
          <Button 
            variant="ghost" 
            size="sm" 
            className="w-full justify-start gap-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors text-[12.8px] mt-0.5" 
            onClick={handleLogout}
          >
            <LogOut className="h-4 w-4" />
            {t("admin.header.logout")}
          </Button>
          <ProjectLinks />
        </div>
      </aside>

      {/*  Mobile sidebar overlay — gsap-шторка (замена AnimatePresence): mount-двухфазный паттерн как в floating-chat  */}
      {mobileSidebarVisible && (
        <>
          <div ref={sidebarOverlayRef} data-sidebar="overlay"
            className="fixed inset-0 z-[69] bg-card md:hidden" onClick={() => setMobileMenuOpen(false)} />
          <aside ref={sidebarRef} data-sidebar="panel"
            className="fixed left-0 top-0 bottom-0 z-[70] w-[290px] flex flex-col md:hidden bg-background border-r border-border overflow-hidden"
          >
            <div className="flex h-16 items-center justify-center px-4 relative z-10">
              <div className="absolute bottom-0 left-6 right-6 h-[1px] bg-transparent"></div>
              <div className="flex items-center gap-3 min-w-0">
                {brand.logo ? <img src={brand.logo} alt="" className="h-8 w-auto object-contain" /> : <Shield className="h-6 w-6 text-primary shrink-0" />}
                {brand.serviceName ? <span className="font-bold text-[14.5px] tracking-wide truncate">{brand.serviceName}</span> : null}
              </div>
              <Button aria-label={t("admin.navigation.close_menu")} variant="ghost" size="icon" className="absolute right-4 shrink-0" onClick={() => setMobileMenuOpen(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>
            <nav className="flex-1 space-y-0.5 p-2.5 overflow-y-auto relative z-10 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-card [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent hover:[&::-webkit-scrollbar-thumb]:bg-card">
              <NavItems onClick={() => setMobileMenuOpen(false)} />
            </nav>
            <div className="border-t border-border p-3 space-y-1 relative z-10">
              <div className="text-[11px] font-semibold text-emerald-500 px-2.5 py-0.5 mb-0.5 flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                {t("admin.header.online")}
              </div>
              <div className="text-[11.5px] text-muted-foreground truncate px-2.5 pb-2">{state.admin?.email}</div>
              <Link to="/admin/change-password" className="block" onClick={() => setMobileMenuOpen(false)}>
                <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors text-[12.8px]">
                  <KeyRound className="h-4 w-4" />
                  {t("admin.header.change_password")}
                </Button>
              </Link>
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start gap-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors text-[12.8px] mt-0.5"
                onClick={handleLogout}
              >
                <LogOut className="h-4 w-4" />
                {t("admin.header.logout")}
              </Button>
              <ProjectLinks />
            </div>
          </aside>
        </>
      )}

      {/*  Main content  */}
      <main className="flex-1 min-w-0 flex flex-col md:pl-[240px] w-full relative z-10">
        <header className="sticky top-0 z-20 flex h-[52px] shrink-0 items-center justify-between gap-3 px-5 border-b border-border bg-card">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <Button aria-label={t("admin.navigation.open_menu")} aria-expanded={mobileMenuOpen} variant="ghost" size="icon" className="md:hidden shrink-0 rounded-xl" onClick={() => setMobileMenuOpen(true)}>
              <Menu className="h-5 w-5" />
            </Button>
            {/* Breadcrumb / Page title */}
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className="hidden md:flex h-7 w-7 rounded-lg bg-muted border border-border items-center justify-center shrink-0">
                <Sparkles className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0">
                <div className="hidden md:flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                  <span>Admin</span>
                  <ChevronRight className="h-3 w-3 opacity-50" />
                  <span className="text-primary truncate">{(() => {
                    const seg = location.pathname.replace(/^\/admin\/?/, "").split("/")[0] || "dashboard";
                    const map: Record<string, string> = {
                      dashboard: "Главная", analytics: "Аналитика", "sales-report": "Отчёт продаж",
                      "business-analytics": "Бизнес-аналитика", "anti-fraud": "Антифрод",
                      "balance-sales": "Продажи через баланс", "bot-conversations": "Активность клиентов",
                      "remna-nodes": "Ноды", "remna-squads": "Сквады", "remna-hosts": "Хосты", "remna-profiles": "Config-профили",
                      "remna-sub-templates": "Шаблоны подписки",
                      "traffic-abuse": "Аномалии трафика", clients: "Клиенты",
                      proxy: "Прокси", singbox: "Sing-box / AmneziaWG", backup: "Бэкапы", tickets: "Тикеты",
                      withdrawals: "Заявки на вывод", trials: "Триалы", "auto-renew": "Автосписание",
                      tariffs: "Тарифы", promo: "Промо-ссылки", "promo-codes": "Промокоды",
                      marketing: "Маркетинг", "referral-network": "Реф. сеть", referrals: "Рефералка",
                      "secondary-subscriptions": "Подписки", "video-instructions": "Видео",
                      broadcast: "Рассылки", "auto-broadcast": "Авто-рассылки", contests: "Конкурсы",
                      "tour-constructor": "Тур", "promo-vpn": "Продвижение VPN", marketplace: "Маркетплейс",
                      settings: "Настройки",
                      languages: "Языки", admins: "Менеджеры", "api-keys": "API ключи",
                      antibot: "Антибот", diagnostics: "Диагностика", "email-templates": "Email-шаблоны",
                      "bot-messages": "Тексты бота", "webhook-inbox": "Webhook inbox", audit: "Аудит-лог",
                      "change-password": "Смена пароля",
                    };
                    return map[seg] ?? seg;
                  })()}</span>
                </div>
                {brand.serviceName ? <span className="text-sm font-medium text-muted-foreground md:hidden truncate">{brand.serviceName}</span> : null}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, ctrlKey: true, bubbles: true }))}
            className="hidden md:flex items-center gap-[7px] basis-[300px] shrink text-[12.5px] text-muted-foreground bg-background border border-border rounded-lg px-[11px] py-[6px] hover:border-foreground/20 transition-colors"
          >
            <Search className="h-[13px] w-[13px] shrink-0" />
            <span className="truncate">Поиск: клиент, платёж, нода…</span>
            <span className="ml-auto text-[10.5px] bg-muted border border-border rounded px-1.5 py-[1px] shrink-0">⌘K</span>
          </button>
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Real-time toast indicator (legacy, низ-приоритет) */}
            {notificationToasts.length > 0 && (
              <span title={notificationsEnabled ? "Уведомления включены" : "Уведомления выключены"} className="flex items-center justify-center h-9 w-2">
                <span className="h-2 w-2 rounded-full bg-rose-500 animate-pulse" />
              </span>
            )}
            {/* Inbox Bell (counters  tickets/webhooks/payments/cron failures/etc.) */}
            <InboxBell />
            {/* Theme picker — стиль из кабинета */}
            <div className="relative">
              <Button variant="ghost" size="sm" className="gap-1.5 text-xs h-9 px-2.5 rounded-xl border border-transparent hover:border-border bg-card hover:bg-card" onClick={() => setShowThemePanel(!showThemePanel)}>
                <Palette className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t("admin.header.theme")}</span>
              </Button>
              {showThemePanel && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowThemePanel(false)} />
                  <div className={cn(
                    "absolute right-0 top-full z-50 mt-2 w-[calc(100vw-2rem)] sm:w-[320px] max-w-[320px] rounded-xl border border-border bg-card p-4 origin-top-right",
                    "opacity-100 scale-100 pointer-events-auto translate-y-0"
                  )}>
                    <div className="mb-5">
                      <h4 className="mb-3 text-sm font-semibold tracking-tight text-foreground">{t("admin.header.mode")}</h4>
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
                                  : "text-muted-foreground hover:bg-card hover:text-foreground"
                              )}
                            >
                              <opt.icon className="h-3.5 w-3.5" />
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <h4 className="mb-3 text-sm font-semibold tracking-tight text-foreground">{t("admin.header.accent")}</h4>
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
                  </div>
                </>
              )}
            </div>
            {/* Version badge */}
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer"
              className="hidden sm:flex items-center gap-1.5 rounded-xl border border-border bg-muted px-3 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 transition-all hover:shadow-md">
              <span className="relative flex h-1.5 w-1.5">
                
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
              </span>
              <span title={PANEL_BUILD.builtAt}>v{PANEL_VERSION}{PANEL_COMMIT ? ` · ${PANEL_COMMIT}` : ""}</span>
              <ExternalLink className="h-3 w-3 opacity-50" />
            </a>
          </div>
        </header>
        <div className="flex-1 px-5 pt-4 pb-10 animate-in fade-in duration-200 relative z-10">
          {state.admin?.role === "ADMIN" && state.accessToken && <UpdateNotice token={state.accessToken} />}
          <Outlet />
        </div>
      </main>

      {notificationToasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 space-y-2">
          {notificationToasts.map((t) => (
            <div key={t.id} className="max-w-xs rounded-lg border bg-card px-4 py-3 text-sm flex items-center gap-2 animate-in slide-in-from-right-5 fade-in duration-300">
              {t.icon && <span className="text-base shrink-0">{t.icon}</span>}
              <span>{t.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
