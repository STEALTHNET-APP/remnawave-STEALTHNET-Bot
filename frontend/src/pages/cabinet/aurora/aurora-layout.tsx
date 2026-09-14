<<<<<<< HEAD
import { Link, Outlet, useLocation } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { Sun, Moon, Monitor, Settings2, User, Gift, SlidersHorizontal, Shield, Network, LogOut, X, ChevronRight } from "lucide-react";
import { AuroraTabs } from "@/components/aurora/aurora-tabs";
import { api } from "@/lib/api";
import { useCabinetConfig } from "@/contexts/cabinet-config";
import { useClientAuth } from "@/contexts/client-auth";
import { useTheme } from "@/contexts/theme";
import { enterAuroraFullscreen } from "@/lib/telegram-viewport";
import "./aurora.css";
=======
/**
 * AuroraLayout — обёртка третьего дизайна кабинета (мини-апп «Aurora»).
 *
 * Отличается от Classic и Stealth: светлый фон, крупная градиентная карточка
 * подписки, плитки-метрики и плавающее нижнее меню из четырёх вкладок.
 *
 * Структура:
 *   ┌──────────────────────────────┐
 *   │  <Outlet/> — контент страницы │
 *   │──────────────────────────────│
 *   │  AuroraTabs (плавающее меню)  │
 *   └──────────────────────────────┘
 *
 * Акцент берётся из настройки панели (тот же `stealthAccent`, что и у Stealth —
 * чтобы владелец задавал фирменный цвет один раз для всех мини-аппов).
 * Из него считается градиент: основной цвет → более светлый/голубой оттенок.
 */

import { Outlet } from "react-router-dom";
import { useEffect, useState } from "react";
import type { PublicConfig } from "@/lib/api";
import { AuroraTabs } from "@/components/aurora/aurora-tabs";
import { getPublicConfigCached } from "@/lib/public-config";

/** hex → [r,g,b]; при мусоре — индиго по умолчанию (#5B4BE8). */
function hexToRgb(hex: string | null | undefined): [number, number, number] {
  const m = /^#?([0-9a-fA-F]{6})$/.exec((hex ?? "").trim());
  if (!m) return [91, 75, 232];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Осветляет цвет и уводит в голубой — вторая точка градиента, как в макете. */
function toGradientEnd([r, g, b]: [number, number, number]): string {
  const mix = (c: number, target: number) => Math.round(c + (target - c) * 0.45);
  return `rgb(${mix(r, 56)} ${mix(g, 170)} ${mix(b, 225)})`;
}
>>>>>>> 3d6b243 (feat(frontend): TanStack Query + Zustand everywhere, GSAP animations, UI redesign)

export function AuroraLayout() {
  const config = useCabinetConfig();
  const { logout, state, refreshProfile } = useClientAuth();
  const [language,setLanguage]=useState(state.client?.preferredLang || "ru");
  const [currency,setCurrency]=useState(state.client?.preferredCurrency || "rub");
  const [saving,setSaving]=useState(false);
  const [saveMessage,setSaveMessage]=useState("");
  const savePreferences=async()=>{if(!state.token)return;setSaving(true);setSaveMessage("");try{await api.clientUpdateProfile(state.token,{preferredLang:language,preferredCurrency:currency});await refreshProfile();setSaveMessage("Настройки сохранены");}catch(e){setSaveMessage(e instanceof Error?e.message:"Не удалось сохранить настройки");}finally{setSaving(false);}};
  const { config: theme, setMode, resolvedMode } = useTheme();
  const [menu, setMenu] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const location = useLocation();
  const dark = resolvedMode === "dark";
  const accent = dark ? "#21854f" : config?.stealthAccent || "#5b4be8";
  const gradientEnd = dark ? "#17683e" : `color-mix(in srgb, ${accent} 55%, #38aae1)`;
  useEffect(enterAuroraFullscreen, []);
  useEffect(() => {
<<<<<<< HEAD
    document.documentElement.dataset.auActive = "1";
    document.documentElement.style.setProperty("--au-accent", accent);
    return () => { delete document.documentElement.dataset.auActive; document.documentElement.style.removeProperty("--au-accent"); };
  }, [accent]);
  useEffect(() => { setMenu(false); }, [location.pathname]);
  useEffect(() => { if(menu) dialog.current?.showModal(); else dialog.current?.close(); }, [menu]);
=======
    getPublicConfigCached().then(setConfig).catch(() => {});
  }, []);

  // Aurora светлый, а в полноэкранном режиме иконки статус-бара Telegram
  // рисует по цвету шапки. Не сказать ему про белый фон — белые часы и
  // батарея сольются с белой полосой отступа.
>>>>>>> 3d6b243 (feat(frontend): TanStack Query + Zustand everywhere, GSAP animations, UI redesign)
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg?.initData?.trim()) return;
    try { tg.setHeaderColor?.(dark ? "#10131d" : "#ffffff"); tg.setBackgroundColor?.(dark ? "#10131d" : "#ffffff"); } catch { /* old Telegram */ }
  }, [dark]);
  const links = [
    {to:"/cabinet/profile",label:"Мой профиль",icon:User,show:true},
    {to:"/cabinet/subscribe",label:"Подключение VPN",icon:Shield,show:true},
    {to:"/cabinet/gifts",label:"Подарки",icon:Gift,show:!!config?.giftSubscriptionsEnabled},
    {to:"/cabinet/custom-build",label:"Собрать свой тариф",icon:SlidersHorizontal,show:!!config?.customBuildConfig},
    {to:"/cabinet/extra-options",label:"Дополнительные услуги",icon:Settings2,show:!!config?.sellOptionsEnabled},
    {to:"/cabinet/proxy",label:"Прокси",icon:Network,show:!!config?.showProxyEnabled},
    {to:"/cabinet/singbox",label:"Sing-box",icon:Network,show:!!config?.showSingboxEnabled},
  ].filter(x=>x.show);
  return <div className="au-client tg-fs-pad min-h-screen" data-au-theme={resolvedMode} style={{"--au-link":dark?"#79e3a4":accent,"--au-from":accent,"--au-to":gradientEnd,"--au-bg":dark?"#10131d":"#ffffff","--au-surface":dark?"#1b2030":"#f2f3f7","--au-nav":dark?"#202637":"#f2f3f7","--au-ink":dark?"#f1f3fa":"#0f1222","--au-muted":dark?"#adb6ce":"#606a80"} as React.CSSProperties}>
    <header className="au-header"><Link to="/cabinet/dashboard" className="au-wordmark">{config?.serviceName || "Aurora"}</Link><button type="button" onClick={()=>setMenu(true)} aria-label="Профиль и оформление"><Settings2 size={20}/><span>Настройки</span></button></header>
    <main className="au-content"><Outlet/></main>
    <AuroraTabs/>
    <dialog ref={dialog} className="au-settings" onCancel={()=>setMenu(false)} onClose={()=>setMenu(false)} aria-labelledby="au-settings-title">
      <div className="au-settings-heading"><h2 id="au-settings-title">Ваш кабинет</h2><button onClick={()=>setMenu(false)} aria-label="Закрыть настройки"><X size={22}/></button></div>
      <h3>Оформление</h3><div className="au-theme-modes">{([{value:"light",label:"Светлое",icon:Sun},{value:"dark",label:"Тёмное",icon:Moon},{value:"system",label:"Системное",icon:Monitor}] as const).map(({value,label,icon:Icon})=><button key={value} onClick={()=>setMode(value)} aria-pressed={theme.mode===value}><Icon size={20}/>{label}</button>)}</div>
      <h3>Язык и валюта</h3><div className="au-preferences"><label>Язык<select value={language} onChange={e=>setLanguage(e.target.value)} disabled={saving}>{(config?.activeLanguages?.length?config.activeLanguages:["ru","en"]).map(v=><option key={v} value={v}>{v==="ru"?"Русский":v==="en"?"English":v.toUpperCase()}</option>)}</select></label><label>Валюта<select value={currency} onChange={e=>setCurrency(e.target.value)} disabled={saving}>{(config?.activeCurrencies?.length?config.activeCurrencies:["rub","usd"]).map(v=><option key={v} value={v}>{v.toUpperCase()}</option>)}</select></label></div><button className="au-save-preferences" onClick={()=>void savePreferences()} disabled={saving}>{saving?"Сохраняем…":"Сохранить язык и валюту"}</button>{saveMessage&&<p role="status">{saveMessage}</p>}
      <Link className="au-menu-balance" to="/cabinet/profile" onClick={()=>setMenu(false)}><span>Мой баланс</span><strong>{new Intl.NumberFormat("ru-RU",{style:"currency",currency:state.client?.preferredCurrency || "RUB",maximumFractionDigits:0}).format(state.client?.balance || 0)}</strong><span>Пополнить и посмотреть операции <ChevronRight size={16}/></span></Link><h3>Разделы</h3><nav aria-label="Все разделы кабинета" className="au-menu-links">{links.map(({to,label,icon:Icon})=><Link key={to} to={to} onClick={()=>setMenu(false)}><Icon size={20}/><span>{label}</span><ChevronRight size={17}/></Link>)}</nav>
      <Link className="au-logout" to="/cabinet/login" onClick={()=>{setMenu(false);logout();}}><LogOut size={18}/>Выйти из аккаунта</Link>
    </dialog>
  </div>;
}
