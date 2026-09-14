import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowUpRight, ArrowRight, Menu, X, Shield, Lock, Globe2, Zap, Monitor, Smartphone, Check, Plus, ArrowDown, Command, CreditCard, Headphones, Wifi } from "lucide-react";
import { Link } from "react-router-dom";
import { api, type PublicConfig, type PublicTariffCategory } from "@/lib/api";
import type { LandingApiBlock, LandingApiResponse } from "../landing-blocks/types";
import { useUtmCaptureAndBuildLink } from "../landing-blocks/utils";
import "./landing.css";
import { SpatialStage } from "./spatial-stage";
const icons = { shield: Shield, lock: Lock, globe: Globe2, speed: Zap, monitor: Monitor, phone: Smartphone, check: Check, payment: CreditCard, support: Headphones, wifi: Wifi };
const S = (v: unknown, fallback = "") => typeof v === "string" ? v : fallback;
const list = (v: unknown): Record<string, unknown>[] => Array.isArray(v) ? v.filter(x => x && typeof x === "object") : [];
const strings = (v: unknown): string[] => Array.isArray(v) ? v.filter(x => typeof x === "string") : [];
export function safeUrl(v: unknown, fallback = "#") { const s = S(v).trim(); return /^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i.test(s) ? s : fallback; }
export function safeImageUrl(v: unknown) { const s = S(v).trim(); return /^data:image\/(?:png|jpe?g|gif|webp|avif|x-icon);base64,[a-z0-9+/=\s]+$/i.test(s) ? s : safeUrl(s, ""); }
function BrandLogo({src}:{src:string}) { const [failed,setFailed]=useState(false); const url=safeImageUrl(src);useEffect(()=>setFailed(false),[src]);return url&&!failed?<img src={url} alt="" onError={()=>setFailed(true)}/>:<span className="sn-brand-mark"><Shield size={21} strokeWidth={2.5}/></span>; }
export function inkOn(color: string) { const h = /^#([0-9a-f]{6})$/i.exec(color); if (!h) return "#ffffff"; const n = parseInt(h[1], 16); return ((n >> 16) * .299 + ((n >> 8) & 255) * .587 + (n & 255) * .114) > 155 ? "#15202b" : "#ffffff"; }
export function LandingSurface({ data, config, editing = false, onPick }: { data: LandingApiResponse; config: PublicConfig; editing?: boolean; onPick?: (id: string) => void }) {
  const [menu, setMenu] = useState(false);
  const surface = useRef<HTMLDivElement>(null);
  const hero = data.blocks.find(b => b.type === "hero");
  const hp = hero?.props ?? {}, ht = hero?.text ?? {};
  const name = S(hp.brandName, config.serviceName);
  const logo = S(hp.brandLogo, config.logo ?? "");
  const primary = data.theme.primaryColor || "#9c9cff";
  const background = data.theme.backgroundColor || "#080c16";
  const foreground = data.theme.textColor || (inkOn(background) === "#ffffff" ? "#f6f7f9" : "#1e2834");
  const style = { "--sn-bg": background, "--sn-ink": foreground, "--sn-accent": primary,
    "--sn-accent-ink": inkOn(primary), "--sn-secondary": data.theme.accentColor || "#63d9e7",
    "--sn-radius": data.theme.borderRadius || "16px", "--sn-width": data.theme.containerWidth || "1360px",
    "--sn-depth": Math.max(0,Math.min(2,Number(hp.spatialDepth ?? 1))), fontFamily: data.theme.fontFamily ? `"${data.theme.fontFamily}", sans-serif` : '"Manrope", sans-serif', colorScheme: inkOn(background) === "#ffffff" ? "dark" : "light",
  } as CSSProperties;
  const nav = Array.isArray(hp.navigation) ? list(hp.navigation) : [
    { label: "Возможности", href: "#benefits" }, { label: "Тарифы", href: "#tariffs" }, { label: "Устройства", href: "#devices" }, { label: "Вопросы", href: "#faq" },
  ].filter(n => data.blocks.some(b => (S(b.props.anchor, b.type)) === n.href.slice(1)));
  useEffect(() => {
    const family = data.theme.fontFamily || "Manrope";
    const preset = data.theme.fontPresets?.find(f => f.name === family);
    const link = document.createElement("link"); link.rel = "stylesheet";
    link.href = preset?.url || "https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap";
    document.head.appendChild(link);
    return () => link.remove();
  }, [data.theme.fontFamily, data.theme.fontPresets]);
  useEffect(() => {
    if (editing) return;
    const oldTitle = document.title; document.title = S(hp.seoTitle, `${name} — VPN`);
    let description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const existed = !!description, oldDescription = description?.content ?? "";
    if (!description) { description = document.createElement("meta"); description.name = "description"; document.head.appendChild(description); }
    description.content = S(hp.seoDescription, S(ht.subtitle));
    return () => { document.title = oldTitle; if (description) { if (existed) description.content = oldDescription; else description.remove(); } };
  }, [hp.seoTitle, hp.seoDescription, name, ht.subtitle, editing]);
  useEffect(() => {
    const el = surface.current; if (!el) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0, mx = 0, my = 0;
    const render = () => { frame = 0; if (reduce.matches || hp.sceneMotion === false) { el.style.setProperty("--mx","0"); el.style.setProperty("--my","0"); return; }
      el.style.setProperty("--mx", String(mx)); el.style.setProperty("--my", String(my));
      const y = el.getBoundingClientRect().top;
      el.style.setProperty("--scroll-shift", `${Math.max(-180, Math.min(180, -y * .08))}px`);
    };
    const queue = () => { if (!frame) frame = requestAnimationFrame(render); };
    const move = (e:PointerEvent) => { if(e.pointerType !== "mouse")return; mx=(e.clientX/innerWidth-.5)*2;my=(e.clientY/innerHeight-.5)*2;queue(); };
    const leave = () => {mx=0;my=0;queue();};
    el.addEventListener("pointermove", move); el.addEventListener("pointerleave", leave);window.addEventListener("scroll",queue,{passive:true});reduce.addEventListener("change",queue);
    return () => {cancelAnimationFrame(frame);el.removeEventListener("pointermove",move);el.removeEventListener("pointerleave",leave);window.removeEventListener("scroll",queue);reduce.removeEventListener("change",queue);};
  }, [hp.sceneMotion]);
  const blocks = data.blocks;
  return <div ref={surface} className="sn-landing" style={style} data-motion={hp.sceneMotion === false ? "off" : "on"}>
    <div className="sn-world" aria-hidden="true"><div className="sn-world-horizon"/><div className="sn-world-light sn-world-light-one"/><div className="sn-world-light sn-world-light-two"/><div className="sn-world-vignette"/></div>
    {data.theme.customCss && <style>{data.theme.customCss}</style>}
    {hp.showHeader !== false && <header className={`sn-header ${hp.stickyHeader === false ? "sn-header-static" : ""}`}>
      <a className="sn-brand" href="#home">{<BrandLogo src={logo}/>}<span>{name}</span>{S(ht.headerBadge) && <small>{S(ht.headerBadge)}</small>}</a>
      <nav className={menu ? "sn-nav sn-nav-open" : "sn-nav"} aria-label="Навигация по странице">{nav.map((n,i) => <a key={i} href={safeUrl(n.href)} onClick={() => setMenu(false)}>{S(n.label)}</a>)}</nav>
      <div className="sn-header-actions"><LandingLink href={S(hp.secondaryCtaUrl, "/cabinet/login")} className="sn-login">{S(ht.secondaryCtaText, "Войти")}</LandingLink><LandingLink href={S(hp.ctaUrl, "/cabinet/register")} className="sn-button sn-small">{S(ht.ctaText, "Подключиться")}<ArrowUpRight size={17}/></LandingLink><button className="sn-menu" onClick={() => setMenu(!menu)} aria-expanded={menu} aria-label={menu ? "Закрыть меню" : "Открыть меню"}>{menu ? <X/> : <Menu/>}</button></div>
    </header>}
    <main>{blocks.map((block,i) => {
      const previous = blocks.slice(0,i).some(b => b.type === block.type);
      return <div key={block.id} className={editing ? "sn-editable" : undefined} data-block-id={block.id}>
        {editing && <button className="sn-pick" onClick={() => onPick?.(block.id)}>Редактировать секцию</button>}
        <Section block={block} name={name} duplicate={previous} editing={editing}/>
      </div>;
    })}</main>
  </div>;
}
export function LandingLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  const buildLink = useUtmCaptureAndBuildLink(); const url = safeUrl(href);
  return url.startsWith("/") ? <Link className={className} to={buildLink(url)}>{children}</Link> : <a className={className} href={url}>{children}</a>;
}
function Icon({ name, index = 0 }: { name: unknown; index?: number }) {
  const keys = Object.keys(icons) as (keyof typeof icons)[];
  const Component = icons[S(name) as keyof typeof icons] || icons[keys[index % keys.length]];
  return <Component size={24} strokeWidth={1.5}/>;
}
function Section({ block, name, duplicate, editing }: { block: LandingApiBlock; name: string; duplicate: boolean; editing: boolean }) {
  const { props: p, text: t, type, variant } = block;
  const image = S(p.imageUrl);
  const title = S(t.title), subtitle = S(t.subtitle, S(t.desc));
  const sectionStyle = { "--sn-bg": S(p.backgroundColor) || undefined, "--sn-ink": S(p.textColor) || undefined, "--sn-accent-ink": S(p.accentColor) ? inkOn(S(p.accentColor)) : undefined, backgroundColor: S(p.backgroundColor) || undefined, color: S(p.textColor) || undefined,
    "--sn-section-accent": S(p.accentColor) || "var(--sn-accent)", "--sn-space": `${Math.max(0, Math.min(240, Number(p.spacing ?? 100)))}px`,
    "--sn-columns": Math.max(1,Math.min(6,Number(p.columns ?? 3))), textAlign: S(p.align, "left"),
    backgroundImage: p.backgroundImage ? `url("${safeUrl(p.backgroundImage).replace(/"/g,'%22')}")` : undefined,
  } as CSSProperties;
  const anchor = S(p.anchor, type === "hero" ? "home" : type === "custom" ? variant : type);
  const id = duplicate && !p.anchor ? `${anchor}-${block.id}` : anchor;
  const items = list(t.items ?? p.items);
  const heading = <div className="sn-section-heading">{title && <h2>{title}</h2>}{subtitle && <p>{subtitle}</p>}</div>;
  let content: ReactNode;
  if (type === "hero") {
    const scene = S(p.sceneType, "portal");
    content = <div className={`sn-hero sn-hero-${S(p.layout, variant === "centered" ? "centered" : "split")}`}>
      <div className="sn-hero-copy"><h1>{S(t.headline1, "Интернет.")}<span>{S(t.headline2, "На вашей стороне.")}</span></h1>
      <p className="sn-hero-description">{S(t.subtitle, "Любимые сервисы, работа и общение. Подключите VPN и оставайтесь на связи на всех своих устройствах.")}</p>
      <div className="sn-hero-buttons"><LandingLink className="sn-button" href={S(p.ctaUrl, "/cabinet/register")}>{S(t.ctaText, "Подключиться")}<ArrowUpRight size={21}/></LandingLink>{p.showSecondary !== false && <LandingLink className="sn-text-link" href={S(p.secondaryCtaUrl, "/cabinet/login")}>{S(t.secondaryCtaText, "Войти в кабинет")}<ArrowRight size={18}/></LandingLink>}</div>
      {S(t.hint) && <p className="sn-hint">{S(t.hint)}</p>}
      {strings(t.tags).length > 0 && <div className="sn-tags">{strings(t.tags).map((tag,i) => <span key={i}><Check size={14}/>{tag}</span>)}</div>}</div>
      {scene !== "none" && <div className="sn-hero-art"><SpatialStage name={name} color={S(p.sceneColor, "#a0a3ff")} caption={S(t.rightCardTitle)} image={scene === "image" && image ? safeUrl(image) : undefined} material={S(p.sceneMaterial, "glass")}/>
        {p.showRightCard !== false && <div className="sn-scene-caption"><span>{S(t.sceneLabel, "Иллюстрация подключения")}</span>{S(t.rightCardSubtitle) && <p>{S(t.rightCardSubtitle)}</p>}</div>}
      </div>}
      {S(t.badge) && <div className="sn-hero-baseline"><span>{S(t.badge)}</span><a href="#tariffs">{S(t.tariffLinkText, "Выбрать свой тариф")} <ArrowDown size={15}/></a></div>}
    </div>;
  } else if (type === "features") content = <div className="sn-features">{items.map((item,i) => <div key={i}><Icon name={item.icon} index={i}/><strong>{S(item.label, S(item.title))}</strong><p>{S(item.sub, S(item.desc))}</p></div>)}</div>;
  else if (type === "benefits") content = <>{heading}<div className={`sn-benefits sn-benefits-${S(p.layout, Number(p.columns) === 1 ? "grid" : "editorial")}`}>{items.map((item,i) => <article key={i}>{S(item.imageUrl) ? <img src={safeUrl(item.imageUrl)} alt={S(item.title)} loading="lazy"/> : <Icon name={item.icon} index={i}/>}<h3>{S(item.title)}</h3><p>{S(item.desc)}</p></article>)}</div></>;
  else if (type === "stats") content = <div className="sn-stats">{items.map((item,i) => <div key={i}><strong>{S(item.value)}</strong><span>{S(item.label)}</span></div>)}</div>;
  else if (type === "tariffs") content = <>{heading}<Tariffs block={block}/></>;
  else if (type === "faq") content = <div className="sn-faq-layout">{heading}<div className="sn-faq">{items.map((item,i) => <details key={i}><summary>{S(item.q)}<Plus size={20}/></summary><p>{S(item.a)}</p></details>)}</div></div>;
  else if (type === "devices") content = <div className="sn-devices-layout">{heading}<div className="sn-device-display"><div className="sn-device-laptop"><span/><div><Shield size={44}/><span>{name}</span><div className="sn-device-line"/></div></div><div className="sn-device-phone"><span/><Shield size={28}/><span>{name}</span><div className="sn-device-line"/></div></div><div className="sn-platforms">{list(p.items).map((item,i) => <div key={i}>{/iphone|android/i.test(S(item.name)) ? <Smartphone size={19}/> : /mac/i.test(S(item.name)) ? <Command size={19}/> : <Monitor size={19}/>}<span>{S(item.name)}</span>{S(item.href) && <a href={safeUrl(item.href)} aria-label={`Скачать для ${S(item.name)}`}><ArrowUpRight size={17}/></a>}</div>)}</div></div>;
  else if (type === "custom" && variant === "journey") content = <>{heading}<ol className="sn-steps">{list(p.steps).map((item,i) => <li key={i}><span>{i+1}</span><div><h3>{S(item.title)}</h3><p>{S(item.desc)}</p></div><ArrowRight/></li>)}</ol></>;
  else if (type === "custom" && variant === "footer") content = <footer className="sn-footer"><a className="sn-brand" href="#home"><Shield size={23}/>{name}</a><p>{S(t.footerText, `© ${new Date().getFullYear()} ${name}`)}</p><nav aria-label="Документы и контакты">{S(p.offerLink) && <a href={safeUrl(p.offerLink)}>{S(t.offerLabel, "Оферта")}</a>}{S(p.privacyLink) && <a href={safeUrl(p.privacyLink)}>{S(t.privacyLabel, "Конфиденциальность")}</a>}{S(t.contacts) && <span>{S(t.contacts)}</span>}{list(p.links).map((link,i) => <a key={i} href={safeUrl(link.href)}>{S(link.label)}</a>)}</nav></footer>;
  else if (type === "custom" && variant === "content") content = <div className={`sn-content sn-content-${S(p.layout,"split")}`}><div>{heading}{S(t.body) && <p className="sn-body">{S(t.body)}</p>}{S(t.ctaText) && <LandingLink href={S(p.ctaUrl)} className="sn-button">{S(t.ctaText)}<ArrowUpRight size={18}/></LandingLink>}</div>{image && <img src={safeUrl(image)} alt={S(p.imageAlt)} loading="lazy"/>}</div>;
  else if (type === "cta") content = <div className="sn-cta"><div><h2>{S(t.title)}</h2><p>{S(t.desc)}</p></div><LandingLink href={S(p.ctaUrl,"/cabinet/register")} className="sn-button">{S(t.ctaText,"Подключиться")}<ArrowUpRight size={22}/></LandingLink></div>;
  else if (type === "logos") content = <>{heading}<div className="sn-logos">{list(p.items).map((item,i) => <a key={i} href={safeUrl(item.href)}><img src={safeUrl(item.imageUrl)} alt={S(item.alt)} loading="lazy"/></a>)}</div></>;
  else if (type === "testimonials") content = <>{heading}<div className="sn-testimonials">{items.map((item,i) => <figure key={i}><blockquote>{S(item.text)}</blockquote><figcaption>{S(item.avatar) && <img src={safeUrl(item.avatar)} alt="" loading="lazy"/>}<div><strong>{S(item.author)}</strong><span>{S(item.role)}</span></div></figcaption></figure>)}</div></>;
  else if (type === "video") content = <>{heading}<Video url={S(p.url)} poster={S(p.poster)} title={title} editing={editing}/>{S(t.caption) && <p className="sn-hint">{S(t.caption)}</p>}</>;
  else if (type === "spacer") return <div id={id} style={{height: Number(p.height ?? ({xs:16,sm:32,md:64,lg:96,xl:128}[variant] ?? 48))}}/>;
  else return null;
  return <section id={id} className={`sn-section sn-section-${type} ${p.hideMobile ? "sn-hide-mobile" : ""} ${p.hideDesktop ? "sn-hide-desktop" : ""}`} style={sectionStyle}><div className="sn-container">{content}</div></section>;
}
function Video({url, poster, title, editing}: {url:string;poster:string;title:string;editing:boolean}) {
  if (!url) return editing ? <div className="sn-empty">Добавьте видео в настройках секции</div> : null;
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{11})/);
  const vm = url.match(/vimeo\.com\/(\d+)/);
  if (/\.(mp4|webm|ogg)(\?|$)/i.test(url)) return <video className="sn-video" controls playsInline preload="metadata" poster={safeUrl(poster, "")} src={safeUrl(url)}/>;
  const src = yt ? `https://www.youtube-nocookie.com/embed/${yt[1]}` : vm ? `https://player.vimeo.com/video/${vm[1]}` : "";
  return src ? <iframe className="sn-video" src={src} title={title || "Видео"} allowFullScreen loading="lazy"/> : <p className="sn-empty">Поддерживаются YouTube, Vimeo и MP4 / WebM.</p>;
}
function Tariffs({block}: {block:LandingApiBlock}) {
  const [categories,setCategories] = useState<PublicTariffCategory[]>([]), [status,setStatus] = useState("loading");
  const load = () => { setStatus("loading"); api.getPublicTariffs().then(r => {setCategories(r.items);setStatus("ready");}).catch(() => setStatus("error")); };
  useEffect(load,[]);
  if (status === "loading") return <div className="sn-empty" role="status">Загружаем тарифы…</div>;
  if (status === "error") return <div className="sn-empty">Не удалось загрузить тарифы. <button onClick={load}>Повторить</button></div>;
  if (!categories.some(c => c.tariffs.length)) return <div className="sn-empty">{S(block.text.noTariffsMessage,"Тарифы скоро появятся.")}</div>;
  const selected = strings(block.props.tariffIds);
  const visibleCategories = categories.map(cat => ({...cat,tariffs:cat.tariffs.filter(t=>!selected.length||selected.includes(t.id))})).filter(cat=>cat.tariffs.length);
  if(!visibleCategories.length)return <div className="sn-empty">{S(block.text.noTariffsMessage,"Тарифы скоро появятся.")}</div>;
  return <div className="sn-tariff-groups">{visibleCategories.map(cat => <div key={cat.id}>{cat.name && <h3 className="sn-category">{cat.name}</h3>}<div className="sn-tariffs">{cat.tariffs.map(t => <article className={block.props.featuredTariffId === t.id ? "sn-tariff sn-tariff-featured" : "sn-tariff"} key={t.id}>
    <h3>{t.name}</h3>{t.description && <p>{t.description}</p>}<div className="sn-price"><strong>{t.price}</strong><span>{t.currency.toUpperCase()}</span></div><ul>{t.durationDays ? <li><Check size={16}/>{S(block.text.durationLabel,"{days} дней доступа").replace("{days}",String(t.durationDays))}</li>:null}{t.deviceLimit ? <li><Check size={16}/>{S(block.text.devicesLabel,"До {count} устройств").replace("{count}",String(t.deviceLimit))}</li>:null}<li><Check size={16}/>{t.trafficLimitBytes ? `${Math.round(t.trafficLimitBytes/1024**3)} GB трафика` : S(block.text.unlimitedLabel,"Без лимита трафика")}</li></ul>
    <LandingLink href="/cabinet/register" className="sn-button">{S(block.text.buttonChooseTariff,"Выбрать тариф")}<ArrowUpRight size={18}/></LandingLink>
  </article>)}</div></div>)}</div>;
}
