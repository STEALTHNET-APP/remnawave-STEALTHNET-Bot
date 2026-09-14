import { useEffect, useState } from "react";
import type { PublicConfig } from "@/lib/api";
import { fetchLanding } from "@/lib/landing-api";
import type { LandingApiResponse } from "@/components/landing-blocks/types";
import { LandingSurface } from "@/components/landing-studio/landing-surface";
export function LandingPage({ config }: { config: PublicConfig }) {
  const [data,setData] = useState<LandingApiResponse | null>(null);
  const [error,setError] = useState(false);
  useEffect(() => { let active = true; fetchLanding(config.defaultLanguage ?? "ru").then(d => { if(active) setData(d); }).catch(() => { if(active) setError(true); }); return () => { active = false; }; }, [config.defaultLanguage]);
  if (error) return <div role="alert" className="p-12 text-center">Не удалось загрузить страницу. <button onClick={() => location.reload()}>Повторить</button></div>;
  if (!data) return <div role="status" className="flex min-h-screen items-center justify-center">Загружаем страницу…</div>;
  return <LandingSurface data={data} config={config}/>;
}
