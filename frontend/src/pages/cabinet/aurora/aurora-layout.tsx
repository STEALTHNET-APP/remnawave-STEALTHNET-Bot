import { useTranslation } from "react-i18next";
import { formatAuroraBalance } from "@/lib/aurora-profile";
import { Link, Outlet, useLocation } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { Sun, Moon, Monitor, Settings2, User, Gift, SlidersHorizontal, Shield, Network, LogOut, X, ChevronRight, Sparkles } from "lucide-react";
import { AuroraTabs } from "@/components/aurora/aurora-tabs";
import { api } from "@/lib/api";
import { useCabinetConfig } from "@/contexts/cabinet-config";
import { useClientAuth } from "@/contexts/client-auth";
import { useTheme } from "@/contexts/theme";
import { enterAuroraFullscreen } from "@/lib/telegram-viewport";
import "./aurora.css";

export function AuroraLayout() {
  const { t, i18n } = useTranslation();
  const config = useCabinetConfig();
  const { logout, state, refreshProfile } = useClientAuth();
  const [language,setLanguage]=useState(state.client?.preferredLang || "ru");
  const [currency,setCurrency]=useState(state.client?.preferredCurrency || "rub");
  const [saving,setSaving]=useState(false);
  const [saveMessage,setSaveMessage]=useState("");
  const savePreferences=async()=>{if(!state.token)return;setSaving(true);setSaveMessage("");try{await api.clientUpdateProfile(state.token,{preferredLang:language,preferredCurrency:currency});await refreshProfile();await i18n.changeLanguage(language);setSaveMessage(i18n.t("aurora.settings_saved"));}catch(e){setSaveMessage(e instanceof Error?e.message:t("aurora.settings_error"));}finally{setSaving(false);}};
  const { config: theme, setMode, resolvedMode } = useTheme();
  const [menu, setMenu] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const location = useLocation();
  useEffect(() => {
    setLanguage(state.client?.preferredLang || "ru");
    setCurrency(state.client?.preferredCurrency || "rub");
  }, [state.client?.preferredLang, state.client?.preferredCurrency]);
  const dark = resolvedMode === "dark";
  const accent = dark ? "#21854f" : config?.stealthAccent || "#5b4be8";
  const gradientEnd = dark ? "#17683e" : `color-mix(in srgb, ${accent} 55%, #38aae1)`;
  useEffect(enterAuroraFullscreen, []);
  useEffect(() => {
    document.documentElement.dataset.auActive = "1";
    document.documentElement.style.setProperty("--au-accent", accent);
    return () => { delete document.documentElement.dataset.auActive; document.documentElement.style.removeProperty("--au-accent"); };
  }, [accent]);
  useEffect(() => { setMenu(false); }, [location.pathname]);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (menu) element.showModal();
    if (!element.open) return;
    if (reduced) {
      if (!menu) element.close();
      return;
    }
    const animation = element.animate(
      menu
        ? [{ opacity: 0, transform: "translateY(14px) scale(.98)" }, { opacity: 1, transform: "none" }]
        : [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(10px) scale(.98)" }],
      { duration: menu ? 220 : 160, easing: "cubic-bezier(.2,.8,.2,1)" },
    );
    let cancelled = false;
    animation.finished.then(() => {
      if (!menu && !cancelled) element.close();
    }).catch(() => {});
    return () => { cancelled = true; animation.cancel(); };
  }, [menu]);
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg?.initData?.trim()) return;
    try { tg.setHeaderColor?.(dark ? "#10131d" : "#ffffff"); tg.setBackgroundColor?.(dark ? "#10131d" : "#ffffff"); } catch { /* old Telegram */ }
  }, [dark]);
  const links = [
    {to:"/cabinet/profile",label:t("aurora.my_profile"),icon:User,show:true},
    {to:"/cabinet/subscribe",label:t("aurora.connection"),icon:Shield,show:true},
    {to:"/cabinet/gifts",label:t("aurora.gifts"),icon:Gift,show:!!config?.giftSubscriptionsEnabled},
    {to:"/cabinet/roulette",label:t("aurora.roulette"),icon:Sparkles,show:config?.rouletteEnabled !== false},
    {to:"/cabinet/custom-build",label:t("aurora.custom_tariff"),icon:SlidersHorizontal,show:!!config?.customBuildConfig},
    {to:"/cabinet/extra-options",label:t("aurora.extra_options"),icon:Settings2,show:!!config?.sellOptionsEnabled},
    {to:"/cabinet/proxy",label:t("aurora.proxy"),icon:Network,show:!!config?.showProxyEnabled},
    {to:"/cabinet/singbox",label:"Sing-box / AmneziaWG",icon:Network,show:!!config?.showSingboxEnabled},
  ].filter(x=>x.show);
  return <div className="au-client min-h-screen" data-au-theme={resolvedMode} style={{"--au-link":dark?"#79e3a4":accent,"--au-from":accent,"--au-to":gradientEnd,"--au-bg":dark?"#10131d":"#ffffff","--au-surface":dark?"#1b2030":"#f2f3f7","--au-nav":dark?"#202637":"#f2f3f7","--au-ink":dark?"#f1f3fa":"#0f1222","--au-muted":dark?"#adb6ce":"#606a80"} as React.CSSProperties}>
    <header className="au-header"><Link to="/cabinet/dashboard" className="au-wordmark">{config?.serviceName || "Aurora"}</Link><button type="button" onClick={()=>setMenu(true)} aria-label={t("aurora.profile_appearance")}><Settings2 size={20}/><span>{t("aurora.settings")}</span></button></header>
    <main className="au-content"><div key={location.pathname} className="au-page"><Outlet/></div></main>
    <AuroraTabs/>
    <dialog ref={dialog} className="au-settings" onCancel={e=>{e.preventDefault();setMenu(false);}} onClose={()=>setMenu(false)} aria-labelledby="au-settings-title">
      <div className="au-settings-heading"><h2 id="au-settings-title">{t("aurora.your_cabinet")}</h2><button onClick={()=>setMenu(false)} aria-label={t("aurora.close_settings")}><X size={22}/></button></div>
      <h3>{t("aurora.appearance")}</h3><div className="au-theme-modes">{([{value:"light",label:t("aurora.light"),icon:Sun},{value:"dark",label:t("aurora.dark"),icon:Moon},{value:"system",label:t("aurora.system"),icon:Monitor}] as const).map(({value,label,icon:Icon})=><button key={value} onClick={()=>setMode(value)} aria-pressed={theme.mode===value}><Icon size={20}/>{label}</button>)}</div>
      <h3>{t("aurora.language_currency")}</h3><div className="au-preferences"><label>{t("aurora.language")}<select value={language} onChange={e=>setLanguage(e.target.value)} disabled={saving}>{(config?.activeLanguages?.length?config.activeLanguages:["ru","en"]).map(v=><option key={v} value={v}>{v==="ru"?"Русский":v==="en"?"English":v.toUpperCase()}</option>)}</select></label><label>{t("aurora.currency")}<select value={currency} onChange={e=>setCurrency(e.target.value)} disabled={saving}>{(config?.activeCurrencies?.length?config.activeCurrencies:["rub","usd"]).map(v=><option key={v} value={v}>{v.toUpperCase()}</option>)}</select></label></div><button className="au-save-preferences" onClick={()=>void savePreferences()} disabled={saving}>{saving?t("aurora.saving"):t("aurora.save_preferences")}</button>{saveMessage&&<p role="status">{saveMessage}</p>}
      <Link className="au-menu-balance" to="/cabinet/profile" onClick={()=>setMenu(false)}><span>{t("aurora.my_balance")}</span><strong>{formatAuroraBalance(state.client?.balance || 0, state.client?.preferredCurrency || "RUB", i18n.language)}</strong><span>{t("aurora.topup_history")}<ChevronRight size={16}/></span></Link><h3>{t("aurora.sections")}</h3><nav aria-label={t("aurora.all_sections")} className="au-menu-links">{links.map(({to,label,icon:Icon})=><Link key={to} to={to} onClick={()=>setMenu(false)}><Icon size={20}/><span>{label}</span><ChevronRight size={17}/></Link>)}</nav>
      <Link className="au-logout" to="/cabinet/login" onClick={()=>{setMenu(false);logout();}}><LogOut size={18}/>{t("aurora.logout")}</Link>
    </dialog>
  </div>;
}
