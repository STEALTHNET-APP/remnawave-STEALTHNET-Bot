import { useEffect, useState, useRef } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { motion, AnimatePresence } from "framer-motion";
import { X, CheckCircle2, RefreshCw } from "lucide-react";

const AUTO_RELOAD_KEY = "pwa_last_auto_reload";

export function PwaUpdatePrompt() {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration>();
  const [autoUpdating, setAutoUpdating] = useState(false);
  const [updateError, setUpdateError] = useState(false);
  const updateTriggeredRef = useRef(false);
  const lastActivity = useRef(Date.now());
  const edited = useRef(false);
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, value) { setRegistration(value); },
    onRegisterError(err) { console.warn("[PWA] SW registration failed:", err); },
  });

  useEffect(() => {
    if (!registration) return;
    const check = () => {
      if (!registration.installing && navigator.onLine && document.visibilityState === "visible") {
        registration.update().catch(() => {});
      }
    };
    const interval = setInterval(check, 5 * 60 * 1000);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, [registration]);

  useEffect(() => {
    const activity = () => { lastActivity.current = Date.now(); };
    const edit = () => { edited.current = true; activity(); };
    for (const event of ["pointerdown", "keydown", "scroll"]) window.addEventListener(event, activity, true);
    document.addEventListener("input", edit, true);
    document.addEventListener("change", edit, true);
    return () => {
      for (const event of ["pointerdown", "keydown", "scroll"]) window.removeEventListener(event, activity, true);
      document.removeEventListener("input", edit, true);
      document.removeEventListener("change", edit, true);
    };
  }, []);

  const [offlineVisible, setOfflineVisible] = useState(false);
  useEffect(() => {
    if (!offlineReady) return;
    setOfflineVisible(true);
    const timer = setTimeout(() => { setOfflineVisible(false); setOfflineReady(false); }, 4500);
    return () => clearTimeout(timer);
  }, [offlineReady, setOfflineReady]);

  const applyUpdate = async () => {
    if (updateTriggeredRef.current) return;
    updateTriggeredRef.current = true;
    setAutoUpdating(true);
    setUpdateError(false);
    try {
      try { sessionStorage.setItem(AUTO_RELOAD_KEY, String(Date.now())); } catch {}
      await updateServiceWorker(true);
    } catch {
      updateTriggeredRef.current = false;
      setAutoUpdating(false);
      setUpdateError(true);
    }
  };

  useEffect(() => {
    if (!needRefresh) return;
    const timer = setInterval(() => {
      if (window.location.pathname !== "/admin" || window.location.search || edited.current) return;
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      if (document.querySelector('[role="dialog"], dialog[open], [aria-modal="true"]')) return;
      if (Date.now() - lastActivity.current < 60000 || updateTriggeredRef.current) return;
      try {
        const previous = Number(sessionStorage.getItem(AUTO_RELOAD_KEY) || 0);
        if (Date.now() - previous < 300000) return;
      } catch { return; }
      void applyUpdate();
    }, 1000);
    return () => clearInterval(timer);
  }, [needRefresh, updateServiceWorker]);

  return (
    <AnimatePresence>
      {needRefresh && (
        <motion.div
          key="update"
          initial={{ opacity: 0, y: 24, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.95 }}
          transition={{ type: "spring", stiffness: 280, damping: 26 }}
          className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 sm:max-w-sm z-[9999]"
        >
          <div className="rounded-xl border border-border bg-card p-4 flex items-start gap-3 shadow-lg shadow-black/20">
            <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5">
              <RefreshCw className="h-4 w-4 animate-spin" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">Доступно обновление</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {autoUpdating
                  ? "Применяем обновление…"
                  : updateError ? "Не удалось обновить. Попробуйте ещё раз." : "Появилась новая версия приложения. Сохраните изменения и обновите страницу."}
              </p>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => void applyUpdate()}
                  disabled={autoUpdating}
                  className="h-8 px-3 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity flex items-center gap-1.5"
                >
                  <RefreshCw className="h-3 w-3" />
                  Обновить сейчас
                </button>
              </div>
            </div>
            <button
              onClick={() => setNeedRefresh(false)}
              className="shrink-0 h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
              aria-label="Закрыть"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </motion.div>
      )}

      {offlineVisible && (
        <motion.div
          key="offline"
          initial={{ opacity: 0, y: 24, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.95 }}
          transition={{ type: "spring", stiffness: 280, damping: 26 }}
          className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 sm:max-w-xs z-[9999]"
        >
          <div className="rounded-xl border border-emerald-500/20 bg-card p-3.5 flex items-center gap-3 shadow-lg">
            <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
            <p className="text-sm">Приложение готово к работе офлайн</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
