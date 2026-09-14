import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth";
import { api, type PublicConfig } from "@/lib/api";
import { fetchLandingPreview } from "@/lib/landing-api";
import type { LandingApiResponse } from "@/components/landing-blocks/types";
import { LandingSurface } from "@/components/landing-studio/landing-surface";
export function LandingPreviewPage() {
  const {state} = useAuth();
  const [config,setConfig] = useState<PublicConfig | null>(null);
  const [data,setData] = useState<LandingApiResponse | null>(null);
  const [error,setError] = useState(false);
  useEffect(() => { if (!state.accessToken) return; let active = true;
    Promise.all([api.getPublicConfig(), fetchLandingPreview(state.accessToken, "ru")]).then(([c,d]) => { if(active) {setConfig(c);setData(d); window.parent.postMessage({type:"stealthnet-landing:ready"},window.location.origin);} }).catch(() => { if(active) setError(true); });
    return () => {active=false;};
  },[state.accessToken]);
  useEffect(() => { const receive = (e:MessageEvent) => { if(e.origin !== location.origin || e.source !== window.parent) return; if(e.data?.type === "stealthnet-landing:preview" && Array.isArray(e.data.data?.blocks) && e.data.data?.theme) setData(e.data.data); };
    window.addEventListener("message",receive); return () => window.removeEventListener("message",receive);
  },[]);
  if(error) return <p role="alert">Не удалось открыть превью. <button onClick={() => location.reload()}>Повторить</button></p>;
  if(!data || !config) return <div className="p-12 text-center" role="status">Загружаем предпросмотр…</div>;
  return <LandingSurface data={data} config={config} editing onPick={id => window.parent.postMessage({type:"stealthnet-landing:edit-block",id},location.origin)}/>;
}
