import { useEffect, useState, useRef } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { motion, AnimatePresence } from "framer-motion";
import { X, CheckCircle2, RefreshCw, Clock } from "lucide-react";

const AUTO_RELOAD_KEY = "pwa_last_auto_reload";
const SNOOZE_KEY = "pwa_snooze_until";
const TARGET_URL_KEY = "pwa_target_url";

export function isUserActivelyEditing(): boolean {
  if (typeof document === "undefined") return false;

  // 1. Открытое модальное окно / диалог
  if (document.querySelector('[role="dialog"], dialog[open], [aria-modal="true"]')) {
    return true;
  }

  // 2. Активный элемент с фокусом ввода
  const active = document.activeElement as HTMLElement | null;
  if (!active) return false;

  const tagName = active.tagName.toUpperCase();
  if (tagName === "TEXTAREA" || active.isContentEditable) {
    return true;
  }
  if (tagName === "INPUT") {
    const inputType = (active as HTMLInputElement).type?.toLowerCase();
    const nonTextTypes = ["button", "submit", "reset", "checkbox", "radio", "image", "file"];
    if (!nonTextTypes.includes(inputType)) {
      return true;
    }
  }

  return false;
}

export function PwaUpdatePrompt() {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration>();
  const [autoUpdating, setAutoUpdating] = useState(false);
  const [updateError, setUpdateError] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isSnoozed, setIsSnoozed] = useState(false);
  const updateTriggeredRef = useRef(false);

  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, value) { setRegistration(value); },
    onRegisterError(err) { console.warn("[PWA] SW registration failed:", err); },
  });

  // Восстановление URL при старте приложения, если был сохранен перед обновлением
  useEffect(() => {
    try {
      const targetUrl = sessionStorage.getItem(TARGET_URL_KEY);
      if (targetUrl) {
        sessionStorage.removeItem(TARGET_URL_KEY);
        const current = window.location.pathname + window.location.search + window.location.hash;
        if (targetUrl !== current) {
          window.history.replaceState(null, "", targetUrl);
        }
      }
    } catch {}
  }, []);

  // Периодическая проверка наличия новой версии Service Worker
  useEffect(() => {
    if (!registration) return;
    const check = () => {
      if (!registration.installing && navigator.onLine && document.visibilityState === "visible") {
        registration.update().catch(() => {});
      }
    };
    // Каждые 5 минут + при возврате на вкладку или разворачивании Mini App
    const interval = setInterval(check, 5 * 60 * 1000);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, [registration]);

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
      try {
        sessionStorage.setItem(AUTO_RELOAD_KEY, String(Date.now()));
        const fullUrl = window.location.pathname + window.location.search + window.location.hash;
        sessionStorage.setItem(TARGET_URL_KEY, fullUrl);
      } catch {}
      await updateServiceWorker(true);
    } catch {
      updateTriggeredRef.current = false;
      setAutoUpdating(false);
      setUpdateError(true);
    }
  };

  const snooze = (minutes = 10) => {
    try {
      sessionStorage.setItem(SNOOZE_KEY, String(Date.now() + minutes * 60 * 1000));
    } catch {}
    setIsSnoozed(true);
    setNeedRefresh(false);
  };

  // Таймер и логика автообновления
  useEffect(() => {
    if (!needRefresh) return;

    // Проверка отсрочки
    try {
      const snoozeUntil = Number(sessionStorage.getItem(SNOOZE_KEY) || 0);
      if (Date.now() < snoozeUntil) {
        setIsSnoozed(true);
        return;
      }
    } catch {}

    // Loop guard: если уже перезагружались менее 20 секунд назад — не перезагружать повторно
    try {
      const lastReload = Number(sessionStorage.getItem(AUTO_RELOAD_KEY) || 0);
      if (Date.now() - lastReload < 20_000) {
        return;
      }
    } catch {}

    const isAdmin = window.location.pathname.startsWith("/admin");
    let currentSeconds = isAdmin ? 5 : 3;
    setCountdown(currentSeconds);

    const interval = setInterval(() => {
      if (updateTriggeredRef.current) return;

      const editing = isUserActivelyEditing();
      setIsEditing(editing);

      // В админке ждём завершения редактирования формы
      if (isAdmin && editing) {
        currentSeconds = 5;
        setCountdown(5);
        return;
      }

      // Для клиентов ждем только закрытия модальных окон
      if (!isAdmin && editing) {
        currentSeconds = 3;
        setCountdown(3);
        return;
      }

      // Если вкладка не видна или офлайн — не обновляем
      if (document.visibilityState !== "visible" || !navigator.onLine) {
        return;
      }

      currentSeconds -= 1;
      setCountdown(Math.max(0, currentSeconds));

      if (currentSeconds <= 0) {
        clearInterval(interval);
        void applyUpdate();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [needRefresh, updateServiceWorker]);

  if (isSnoozed && !needRefresh) return null;

  const isAdmin = typeof window !== "undefined" && window.location.pathname.startsWith("/admin");

  return (
    <AnimatePresence>
      {needRefresh && !isSnoozed && (
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
                  : updateError
                    ? "Не удалось обновить. Попробуйте ещё раз."
                    : isEditing
                      ? "Сохраните изменения, обновление применится после завершения ввода."
                      : countdown !== null && countdown > 0
                        ? `Применяем обновление (${countdown}с)…`
                        : "Применяем обновление…"}
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                <button
                  onClick={() => void applyUpdate()}
                  disabled={autoUpdating}
                  className="h-8 px-3 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity flex items-center gap-1.5"
                >
                  <RefreshCw className="h-3 w-3" />
                  Обновить сейчас
                </button>
                {isAdmin && (
                  <button
                    onClick={() => snooze(10)}
                    disabled={autoUpdating}
                    className="h-8 px-2.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors flex items-center gap-1"
                  >
                    <Clock className="h-3 w-3" />
                    Отложить
                  </button>
                )}
              </div>
            </div>
            <button
              onClick={() => snooze(10)}
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
