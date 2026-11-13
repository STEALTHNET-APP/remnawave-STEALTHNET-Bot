import { useEffect, useState } from "react";
import { ArrowUpRight, Sparkles, X } from "lucide-react";
import appVersion from "../../../../version.json";
import { BIG_UPDATE_URL, BIG_UPDATE_VERSION } from "@/lib/project-links";

const STORAGE_KEY = `stealthnet_release_${BIG_UPDATE_VERSION}_seen`;
let shownThisSession = false;

export function ReleaseToast() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (appVersion.version !== BIG_UPDATE_VERSION || shownThisSession) return;
    try {
      if (localStorage.getItem(STORAGE_KEY)) return;
    } catch {}
    const timer = window.setTimeout(() => {
      shownThisSession = true;
      setVisible(true);
      try {
        localStorage.setItem(STORAGE_KEY, "1");
      } catch {}
    }, 1000);
    return () => window.clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <section aria-label="Что нового в панели" className="fixed left-3 right-3 top-16 z-40 rounded-2xl border border-primary/25 bg-card p-4 shadow-xl sm:left-auto sm:right-5 sm:w-96">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary" aria-hidden="true">
          <Sparkles className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1" role="status">
          <p className="text-xs font-medium text-primary">STEALTHNET {BIG_UPDATE_VERSION}</p>
          <h2 className="mt-0.5 text-base font-semibold">Big Update уже здесь</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Автообновления, Telegram Stars и новые возможности бота — теперь в вашей панели.</p>
        </div>
        <button type="button" onClick={() => setVisible(false)} aria-label="Закрыть уведомление об обновлении" className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
          <X className="h-4 w-4" />
        </button>
      </div>
      <a href={BIG_UPDATE_URL} target="_blank" rel="noopener noreferrer" onClick={() => setVisible(false)} className="ml-[52px] mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-lg text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
        Что изменилось <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
      </a>
    </section>
  );
}
