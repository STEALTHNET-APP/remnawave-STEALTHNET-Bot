import { useEffect, useState, useRef } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { motion, AnimatePresence } from "framer-motion";
import { X, CheckCircle2, RefreshCw } from "lucide-react";

const AUTO_RELOAD_KEY = "pwa_last_auto_reload";
const AUTO_RELOAD_DELAY_MS = 2000;

/**
 * Тост «доступно обновление» с форсированным автообновлением Service Worker.
 * При выходе новой версии приложения плашка уведомляет пользователя и
 * автоматически перезагружает страницу через 2 секунды, исключая зависание на старом кэше.
 */
export function PwaUpdatePrompt() {
  const [countdown, setCountdown] = useState(2);
  const [autoUpdating, setAutoUpdating] = useState(false);
  const updateTriggeredRef = useRef(false);

  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      const check = () => {
        if (!(registration.installing || !navigator)) {
          if ("connection" in navigator && !(navigator as unknown as { onLine?: boolean }).onLine) return;
          registration.update().catch(() => {});
        }
      };

      // Проверяем обновления каждые 5 минут
      const interval = setInterval(check, 5 * 60 * 1000);

      // Проверяем обновления при возврате на вкладку или разворачивании Mini App
      const onVisibilityChange = () => {
        if (document.visibilityState === "visible") {
          check();
        }
      };
      document.addEventListener("visibilitychange", onVisibilityChange);
      window.addEventListener("focus", check);

      return () => {
        clearInterval(interval);
        document.removeEventListener("visibilitychange", onVisibilityChange);
        window.removeEventListener("focus", check);
      };
    },
    onRegisterError(err) {
      console.warn("[PWA] SW registration failed:", err);
    },
  });

  const [offlineVisible, setOfflineVisible] = useState(false);

  useEffect(() => {
    if (!offlineReady) return;
    setOfflineVisible(true);
    const t = setTimeout(() => {
      setOfflineVisible(false);
      setOfflineReady(false);
    }, 4500);
    return () => clearTimeout(t);
  }, [offlineReady, setOfflineReady]);

  // Форсированное автообновление при обнаружении новой версии
  useEffect(() => {
    if (!needRefresh || updateTriggeredRef.current) return;

    // Защита от бесконечного цикла перезагрузки (не чаще 1 раза за 20 сек)
    const lastReload = Number(sessionStorage.getItem(AUTO_RELOAD_KEY) || 0);
    if (Date.now() - lastReload < 20000) {
      return;
    }

    updateTriggeredRef.current = true;
    setAutoUpdating(true);

    const intervalTimer = setInterval(() => {
      setCountdown((prev) => Math.max(0, prev - 1));
    }, 1000);

    const timeoutTimer = setTimeout(() => {
      sessionStorage.setItem(AUTO_RELOAD_KEY, String(Date.now()));
      updateServiceWorker(true);
    }, AUTO_RELOAD_DELAY_MS);

    return () => {
      clearInterval(intervalTimer);
      clearTimeout(timeoutTimer);
    };
  }, [needRefresh, updateServiceWorker]);

  const handleManualUpdate = () => {
    sessionStorage.setItem(AUTO_RELOAD_KEY, String(Date.now()));
    updateServiceWorker(true);
  };

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
                  ? `Появилась новая версия приложения. Применяем обновление (${countdown}с)...`
                  : "Появилась новая версия приложения. Перезагрузите, чтобы применить изменения."}
              </p>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={handleManualUpdate}
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
