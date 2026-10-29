import { openAdminSearch, searchShortcut } from "@/lib/search-shortcut";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { LayoutDashboard, Users, Gift, CreditCard, MessageSquare, Server, BarChart3, Settings, Shield, Search, Menu, LogOut, KeyRound, PanelLeftClose, PanelLeftOpen, ExternalLink } from "lucide-react";
import { MotionConfig } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/auth";
import { canAccessSection, isNavActive } from "@/lib/admin-navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { InboxBell } from "@/components/inbox-bell";
import { AdminAppearanceMenu } from "./admin-appearance";
import appVersion from "../../../../version.json";

interface Props {
  brand: { serviceName: string; logo: string | null };
  onLogout: () => void;
  navigation: (close?: () => void) => ReactNode;
  children: ReactNode;
}

export function ModernAdminShell({ brand, onLogout, navigation, children }: Props) {
  const { t } = useTranslation();
  const { state } = useAuth();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [pinned, setPinned] = useState(() => {
    try { return localStorage.getItem('stealthnet-admin-nav-pinned') === 'true'; } catch { return false; }
  });
  const [hovered, setHovered] = useState(false);
  const expanded = pinned || hovered;
  const [navReady, setNavReady] = useState(pinned);
  const closeHover = useCallback(() => setHovered(false), []);
  useEffect(() => { setMenuOpen(false); setHovered(false); }, [pathname]);
  const togglePin = () => {
    const next = !pinned;
    setNavReady(true);
    setPinned(next);
    setHovered(next);
    try { localStorage.setItem('stealthnet-admin-nav-pinned', String(next)); } catch {}
  };
  const quickItems = [
    { to: '/admin', label: t('admin.nav.dashboard'), icon: LayoutDashboard, section: 'dashboard' },
    { to: '/admin/clients', label: t('admin.nav.clients'), icon: Users, section: 'clients' },
    { to: '/admin/secondary-subscriptions', label: 'Подписки', icon: Gift, section: 'secondary-subscriptions' },
    { to: '/admin/tariffs', label: t('admin.nav.tariffs'), icon: CreditCard, section: 'tariffs' },
    { to: '/admin/tickets', label: t('admin.nav.tickets'), icon: MessageSquare, section: 'tickets' },
    { to: '/admin/remna-nodes', label: 'Ноды', icon: Server, section: 'infra-nodes' },
    { to: '/admin/analytics', label: t('admin.nav.analytics'), icon: BarChart3, section: 'analytics' },
    { to: '/admin/settings', label: t('admin.nav.settings'), icon: Settings, section: 'settings' },
  ].filter(item => state.admin && canAccessSection(state.admin.role, state.admin.allowedSections, item.section));
  const brandNode = <><span className="admin-brand-mark">{brand.logo ? <img src={brand.logo} alt="" /> : <Shield aria-hidden="true" />}</span><span className="admin-brand-name">{brand.serviceName || 'STEALTHNET'}</span></>;
  const account = <div className="admin-account">
    <p title={state.admin?.email}>{state.admin?.email}</p>
    <Link to="/admin/change-password" onClick={() => setMenuOpen(false)}><KeyRound aria-hidden="true" />{t('admin.header.change_password')}</Link>
    <button type="button" onClick={onLogout}><LogOut aria-hidden="true" />{t('admin.header.logout')}</button>
    <small>STEALTHNET {appVersion.version}</small>
  </div>;
  return <MotionConfig reducedMotion="user"><div className="admin-workspace" data-pinned={pinned}>
    <a className="admin-skip" href="#admin-content">К содержимому</a>
    <aside className="admin-sidebar" data-expanded={expanded} onMouseEnter={() => { setNavReady(true); setHovered(true); }} onMouseLeave={() => setHovered(false)}>
      <Link className="admin-brand" to="/admin" aria-label={`${brand.serviceName || 'STEALTHNET'}: главная`}>{brandNode}</Link>
      <div className="admin-nav-area"><nav className="admin-quick-nav" aria-label="Быстрый переход">{quickItems.map(item => <Link key={item.to} to={item.to} aria-label={item.label} title={item.label} aria-current={isNavActive(pathname, item.to) ? 'page' : undefined}><item.icon aria-hidden="true" /></Link>)}</nav>
      {navReady && <nav hidden={!expanded} className="admin-full-nav" aria-label="Разделы админки">{navigation(closeHover)}</nav>}</div>
      {expanded && account}
      <button type="button" className="admin-pin" onClick={togglePin} aria-expanded={expanded} aria-label={pinned ? 'Свернуть меню' : 'Закрепить меню'} title={pinned ? 'Свернуть меню' : 'Закрепить меню'}>
        {pinned ? <PanelLeftClose /> : <PanelLeftOpen />}{expanded && <span>{pinned ? 'Свернуть меню' : 'Закрепить меню'}</span>}
      </button>
    </aside>
    <div className="admin-main">
      <header className="admin-toolbar">
        <Button className="admin-mobile-trigger" variant="ghost" size="icon" aria-label="Открыть меню" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><Menu /></Button>
        <span className="admin-toolbar-title">Администрирование</span>
        <button type="button" className="admin-search-trigger" aria-label="Найти клиента, платёж, ноду" onClick={openAdminSearch} aria-keyshortcuts={searchShortcut().aria} title={`Поиск (${searchShortcut().label})`}>
          <Search aria-hidden="true" /><span>Найти клиента, платёж, ноду</span><kbd>{searchShortcut().label}</kbd>
        </button>
        <div className="admin-toolbar-actions"><Link to="/cabinet" title="Клиентский кабинет" aria-label="Открыть клиентский кабинет"><ExternalLink /></Link><InboxBell /><AdminAppearanceMenu /></div>
      </header>
      <main id="admin-content" tabIndex={-1} className="admin-content">{children}</main>
    </div>
    <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
      <DialogContent className="admin-mobile-menu">
        <DialogTitle className="admin-brand">{brandNode}</DialogTitle>
        <DialogDescription className="sr-only">Разделы администрирования</DialogDescription>
        <nav className="admin-full-nav" aria-label="Разделы админки">{navigation(() => setMenuOpen(false))}</nav>
        {account}
      </DialogContent>
    </Dialog>
  </div></MotionConfig>;
}
