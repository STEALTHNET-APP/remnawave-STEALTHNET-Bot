import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
export function MaintenanceGate({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const inCabinet = pathname.startsWith("/cabinet");
  const [status, setStatus] = useState<{ enabled: boolean; message: string } | null>(null);
  useEffect(() => {
    if (!inCabinet) return;
    let alive = true;
    const refresh = () => fetch("/api/public/availability", { cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error("Availability check failed");
      const value = await response.json();
      if (alive) setStatus(value);
    }).catch(() => { if (alive) setStatus(previous => previous ?? { enabled: false, message: "" }); });
    void refresh();
    const timer = window.setInterval(refresh, 30000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [inCabinet]);
  if (inCabinet && status?.enabled) return <main className="min-h-svh flex items-center justify-center bg-background text-foreground p-6">
    <section role="status" className="max-w-md text-center space-y-4"><h1 className="text-2xl font-bold">Технические работы</h1><p className="whitespace-pre-wrap text-muted-foreground">{status.message}</p><button type="button" className="rounded-xl bg-primary text-primary-foreground px-5 py-3" onClick={() => window.location.reload()}>Проверить снова</button></section>
  </main>;
  return children;
}
