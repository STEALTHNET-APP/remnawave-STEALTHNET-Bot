import { useEffect, useState, useRef } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { motion, AnimatePresence } from "framer-motion";
import { X, CheckCircle2, RefreshCw, Clock } from "lucide-react";

const AUTO_RELOAD_KEY = "pwa_last_auto_reload";
const SNOOZE_KEY = "pwa_snooze_until";


export function isUserActivelyEditing(): boolean {
  const overlays = document.querySelectorAll('[role="dialog"], dialog[open], [aria-modal="true"], .au-sheet-overlay');
  if (Array.from(overlays).some(element => element.getClientRects().length > 0)) return true;
  const active = document.activeElement;
  return active instanceof HTMLElement && (active.matches("input, textarea, select") || active.isContentEditable);
}

export type SafeLocation = {
  pathname: string;
  search?: string;
  hash?: string;
};

export function isSafeUrlForAutoUpdate(location: SafeLocation): boolean {
  const pathname = location.pathname || "/";
  const search = location.search || "";

  // 1. Опасные параметры платежей и возвратов с шлюзов — перезагрузка строго запрещена
  if (search && (search.includes("payment=") || search.includes("invoice=") || search.includes("order="))) {
    return false;
  }
  const unsafePaths = [
    "/cabinet/payment-wait",
    "/cabinet/yoomoney-pay",
    "/cabinet/custom-build",
    "/cabinet/onboarding",
    "/admin/settings",
    "/admin/backup",
    "/admin/tickets",
    "/admin/landing-editor",
    "/admin/tour-constructor",
  ];
  if (unsafePaths.some((p) => pathname.startsWith(p))) {
    return false;
  }

  // 2. Безопасные страницы клиентов (лендинг, дашборд, профиль, подарки, меню и т.д.)
  const safeClientPaths = [
    "/",
    "/cabinet",
    "/cabinet/dashboard",
    "/cabinet/profile",
    "/cabinet/referral",
    "/cabinet/gifts",
    "/cabinet/roulette",
    "/cabinet/proxy",
    "/cabinet/singbox",
    "/cabinet/documents/privacy",
    "/cabinet/documents/offer",
    "/cabinet/documents/refund",
  ];
  if (safeClientPaths.includes(pathname) || pathname.startsWith("/cabinet/menu/")) {
    return true;
  }

  // 3. Безопасные страницы админки (просмотр аналитики / дашборда)
  const safeAdminPaths = [
    "/admin",
    "/admin/analytics",
    "/admin/sales-report",
    "/admin/business-analytics",
    "/admin/referral-network",
    "/admin/diagnostics",
  ];
  if (safeAdminPaths.includes(pathname)) {
    return true;
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
  const lastEditTime = useRef(0);
  const autoBlocked = useRef(false);
  const lastActivity = useRef(Date.now());
  const snoozeUntil = useRef(0);
  const applyUpdateRef = useRef<() => void>(() => {});

  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, value) { setRegistration(value); },
    onRegisterError(err) { console.warn("[PWA] SW registration failed:", err); },
  });

  useEffect(() => {
    try { snoozeUntil.current = Number(sessionStorage.getItem(SNOOZE_KEY)) || 0; } catch {}
    const activity = () => { lastActivity.current = Date.now(); };
    const edit = () => {
      lastEditTime.current = Date.now();
      activity();
    };
    for (const event of ["pointerdown", "touchstart", "keydown", "scroll"]) window.addEventListener(event, activity, true);
    for (const event of ["input", "change"]) document.addEventListener(event, edit, true);
    return () => {
      for (const event of ["pointerdown", "touchstart", "keydown", "scroll"]) window.removeEventListener(event, activity, true);
      for (const event of ["input", "change"]) document.removeEventListener(event, edit, true);
    };
  }, []);

  useEffect(() => {
    if (!registration && typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (reg) setRegistration(reg);
      }).catch(() => {});
    }
  }, [registration]);

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

  const [offlineVisible, setOfflineVisible] = useState(false);
  useEffect(() => {
    if (!offlineReady) return;
    setOfflineVisible(true);
    const timer = setTimeout(() => { setOfflineVisible(false); setOfflineReady(false); }, 4500);
    return () => clearTimeout(timer);
  }, [offlineReady, setOfflineReady]);

  const confirmUpdate = (onConfirmed: () => void) => {
    const isActivelyEditing = isUserActivelyEditing() || Date.now() - lastEditTime.current < 15000;
    if (!isActivelyEditing) {
      onConfirmed();
      return;
    }
    const tg = (window as unknown as { Telegram?: { WebApp?: { initData?: string; showConfirm?: (msg: string, cb: (ok: boolean) => void) => void } } })?.Telegram?.WebApp;
    const isTelegram = Boolean(tg?.initData || (typeof window !== "undefined" && (window as unknown as { TelegramWebviewProxy?: unknown }).TelegramWebviewProxy));
    if (typeof tg?.showConfirm === "function") {
      tg.showConfirm("Обновить страницу? Несохранённые изменения будут потеряны.", (ok) => {
        if (ok) onConfirmed();
      });
      return;
    }
    if (isTelegram) {
      // В Telegram WebApp без showConfirm метод window.confirm блокируется WebView,
      // поэтому применяем ручной запрос пользователя без зависания.
      onConfirmed();
      return;
    }
    try {
      if (typeof window !== "undefined" && typeof window.confirm === "function") {
        if (window.confirm("Обновить страницу? Несохранённые изменения будут потеряны.")) {
          onConfirmed();
        }
        return;
      }
    } catch {}
    onConfirmed();
  };

  const doApplyUpdate = async () => {
    if (updateTriggeredRef.current) return;
    autoBlocked.current = false;
    updateTriggeredRef.current = true;
    setAutoUpdating(true);
    setUpdateError(false);
    try {
      try {
        sessionStorage.setItem(AUTO_RELOAD_KEY, String(Date.now()));
      } catch {}

      const hasSwSupport = typeof navigator !== "undefined" && "serviceWorker" in navigator;

      if (hasSwSupport) {
        navigator.serviceWorker.addEventListener(
          "controllerchange",
          () => {
            window.location.reload();
          },
          { once: true }
        );
      }

      if (registration?.waiting) {
        registration.waiting.postMessage({ type: "SKIP_WAITING" });
      }

      await updateServiceWorker(true);

      // В реальных браузерах и WebView гарантируем перезагрузку через 1.5 сек,
      // даже если событие controllerchange не сработало во фрейме/WebView.
      setTimeout(() => {
        window.location.reload();
      }, 1500);

      // Страховочный сброс состояния на случай отмены перезагрузки браузером
      setTimeout(() => {
        updateTriggeredRef.current = false;
        setAutoUpdating(false);
      }, 6000);
    } catch {
      updateTriggeredRef.current = false;
      autoBlocked.current = true;
      setAutoUpdating(false);
      setUpdateError(true);
    }
  };

  const applyUpdate = async (manual = false) => {
    if (manual) {
      confirmUpdate(() => {
        void doApplyUpdate();
      });
      return;
    }
    await doApplyUpdate();
  };

  applyUpdateRef.current = () => { void applyUpdate(); };

  const snooze = () => {
    snoozeUntil.current = Date.now() + 10 * 60 * 1000;
    try { sessionStorage.setItem(SNOOZE_KEY, String(snoozeUntil.current)); } catch {}
    setIsSnoozed(true);
    setCountdown(null);
  };

  useEffect(() => {
    if (!needRefresh) return;
    let seconds: number | null = null;
    const tick = () => {
      const now = Date.now();
      const snoozed = now < snoozeUntil.current;
      setIsSnoozed(snoozed);
      const editing = isUserActivelyEditing() || now - lastEditTime.current < 15000;
      setIsEditing(editing);
      const safePage = typeof window !== "undefined" && isSafeUrlForAutoUpdate(window.location);
      let previousReload = now;
      try { previousReload = Number(sessionStorage.getItem(AUTO_RELOAD_KEY)) || 0; } catch {}
      if (
        autoBlocked.current ||
        snoozed ||
        editing ||
        !safePage ||
        document.visibilityState !== "visible" ||
        !navigator.onLine ||
        now - lastActivity.current < 7000 ||
        now - previousReload < 180000
      ) {
        seconds = null;
        setCountdown(null);
        return;
      }
      if (updateTriggeredRef.current) return;
      seconds = seconds === null ? 5 : seconds - 1;
      setCountdown(seconds);
      if (seconds <= 0) applyUpdateRef.current();
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [needRefresh]);

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
                      ? "Завершите работу и сохраните изменения перед обновлением."
                      : countdown !== null && countdown > 0
                        ? `Применяем обновление (${countdown}с)…`
                        : "Появилась новая версия. Можно обновить страницу, когда вам удобно."}
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                <button
                  onClick={() => void applyUpdate(true)}
                  disabled={autoUpdating}
                  className="h-8 px-3 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity flex items-center gap-1.5"
                >
                  <RefreshCw className="h-3 w-3" />
                  Обновить сейчас
                </button>
                {(
                  <button
                    onClick={snooze}
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
              onClick={snooze}
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
