import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { parseDesign, type CabinetDesign } from "@/lib/cabinet-design";
import { designCss } from "@/lib/cabinet-design-style";
export function CabinetDesignRuntime() {
 const {pathname}=useLocation(); const active=pathname==="/cabinet"||pathname.startsWith("/cabinet/")||pathname.startsWith("/gift/");
 const [design,setDesign]=useState<CabinetDesign|null>(null),[dark,setDark]=useState(()=>matchMedia("(prefers-color-scheme: dark)").matches);
 useEffect(()=>{const mq=matchMedia("(prefers-color-scheme: dark)");const change=()=>setDark(mq.matches);mq.addEventListener("change",change);return()=>mq.removeEventListener("change",change);},[]);
 useEffect(()=>{if(!active)return;let live=true;const controller=new AbortController();let pending=false;
 const load=async()=>{if(pending)return;pending=true;try{const res=await fetch("/api/public/cabinet-design",{signal:controller.signal,cache:"no-store"});if(!res.ok)return;const data=await res.json();if(live)setDesign(parseDesign(data.design));}catch{}finally{pending=false;}};
 void load();const timer=setInterval(()=>{if(!document.hidden)void load();},60000);const focus=()=>void load();window.addEventListener("focus",focus);
 return()=>{live=false;controller.abort();clearInterval(timer);window.removeEventListener("focus",focus);};},[active]);
 useEffect(()=>{if(!active||!design?.enabled)return;document.body.dataset.cabinetDesign="custom";return()=>{delete document.body.dataset.cabinetDesign;};},[active,design]);
 if(!active||!design?.enabled)return null;
 const mode=design.mode==="system"?(dark?"dark":"light"):design.mode;
 return <style data-cabinet-design-style>{designCss(design,mode,'body[data-cabinet-design="custom"]')}</style>;
}
