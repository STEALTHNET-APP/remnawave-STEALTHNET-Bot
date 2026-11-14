import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../ui/dialog";
import { applyWorkerUpdate } from "./pwa-apply-update";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useRegisterSW } from "virtual:pwa-register/react";
import { motion, AnimatePresence } from "framer-motion";
import { X, CheckCircle2, RefreshCw, Clock } from "lucide-react";

import { AUTO_RELOAD_KEY, SNOOZE_KEY, SNOOZE_MS, COLD_START_MS, LONG_SESSION_MS, readSessionTime, createEditTracker, canSafelyApplyUpdate, isSafeUrlForAutoUpdate, isUserActivelyEditing, hasUnsavedFormInput, type SafeLocation } from "../../lib/update-safety";
export { canSafelyApplyUpdate, hasPaymentSearchParams, isSafeUrlForAutoUpdate, isTelegramInvoiceOpen, hasOpenOverlay, hasFileUploadInProgress, hasUnsavedFormInput, isUserActivelyEditing } from "../../lib/update-safety";

export function PwaUpdatePrompt() {
  const location = useLocation();
  const [registration, setRegistration] = useState<ServiceWorkerRegistration>();
  const [autoUpdating, setAutoUpdating] = useState(false);
  const [updateError, setUpdateError] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState(false);
  const [promptVisible, setPromptVisible] = useState(false);
  const [snoozeUntil, setSnoozeUntil] = useState(() => readSessionTime(SNOOZE_KEY));
  const [snoozed, setSnoozed] = useState(() => readSessionTime(SNOOZE_KEY) > Date.now());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [offlineVisible, setOfflineVisible] = useState(false);
  const updateTriggeredRef = useRef(false);
  const applyingRef = useRef(false);
  const lastEditTime = useRef(0);
  const editTracker = useRef(createEditTracker());
  const autoBlocked = useRef(false);
  const coldStart = useRef(true);
  const availableAt = useRef(0);
  const routeChangedAt = useRef(Date.now());
  const routeKey = useRef(location.key);

  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, value) { setRegistration(value); },
    onRegisterError(err) { console.warn("[PWA] SW registration failed:", err); },
  });

  const hasPendingUpdate = needRefresh || waitingWorker || Boolean(registration?.waiting);

  const canAutoApply = useCallback((target?: SafeLocation) => canSafelyApplyUpdate({
    location: target,
    lastEditTime: lastEditTime.current,
    hasTrackedChanges: editTracker.current.hasChanges(),
  }), []);

  const doApplyUpdate = useCallback(async () => {
    if (updateTriggeredRef.current || applyingRef.current) return;
    applyingRef.current = true;
    autoBlocked.current = false;
    updateTriggeredRef.current = true;
    setAutoUpdating(true);
    setUpdateError(false);
    try {
      try {
        sessionStorage.setItem(AUTO_RELOAD_KEY, String(Date.now()));
      } catch {}

      await applyWorkerUpdate(
        () => updateServiceWorker(true), registration,
        "serviceWorker" in navigator ? navigator.serviceWorker : undefined,
      );
    } catch {
      updateTriggeredRef.current = false;
      autoBlocked.current = true;
      setAutoUpdating(false);
      setUpdateError(true);
      setPromptVisible(true);
    } finally {
      applyingRef.current = false;
    }
  }, [registration, updateServiceWorker]);

  useEffect(() => {
    const stopColdStart = () => { coldStart.current = false; };
    const timer = window.setTimeout(stopColdStart, COLD_START_MS);
    for (const event of ["pointerdown", "touchstart", "keydown"]) window.addEventListener(event, stopColdStart, true);
    return () => {
      window.clearTimeout(timer);
      for (const event of ["pointerdown", "touchstart", "keydown"]) window.removeEventListener(event, stopColdStart, true);
    };
  }, []);

  useEffect(() => {
    const edit = (event: Event) => {
      editTracker.current.edit(event);
      lastEditTime.current = Date.now();
    };
    const focus = (event: Event) => editTracker.current.focus(event);
    document.addEventListener("focusin", focus, true);
    for (const event of ["input", "change"]) document.addEventListener(event, edit, true);
    return () => {
      document.removeEventListener("focusin", focus, true);
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
    const refreshWaiting = () => setWaitingWorker(Boolean(registration.waiting));
    const onUpdateFound = () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener("statechange", refreshWaiting);
    };
    refreshWaiting();
    registration.addEventListener("updatefound", onUpdateFound);
    const waitingPoll = window.setInterval(refreshWaiting, 30 * 1000);
    const check = () => {
      if (!registration.installing && navigator.onLine && document.visibilityState === "visible") {
        registration.update().catch(() => {});
      }
    };
    const interval = window.setInterval(check, 5 * 60 * 1000);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      registration.removeEventListener("updatefound", onUpdateFound);
      window.clearInterval(waitingPoll);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, [registration]);

  useEffect(() => {
    if (!offlineReady) return;
    setOfflineVisible(true);
    const timer = window.setTimeout(() => { setOfflineVisible(false); setOfflineReady(false); }, 4500);
    return () => window.clearTimeout(timer);
  }, [offlineReady, setOfflineReady]);

  useEffect(() => {
    if (!snoozed) return;
    const remaining = snoozeUntil - Date.now();
    if (remaining <= 0) {
      setSnoozed(false);
      return;
    }
    const timer = window.setTimeout(() => setSnoozed(false), remaining);
    return () => window.clearTimeout(timer);
  }, [snoozed, snoozeUntil]);

  useEffect(() => {
    if (!hasPendingUpdate) {
      availableAt.current = 0;
      updateTriggeredRef.current = false;
      autoBlocked.current = false;
      setPromptVisible(false);
      setUpdateError(false);
      setAutoUpdating(false);
      return;
    }
    if (!availableAt.current) availableAt.current = Date.now();
    if (snoozed || !isSafeUrlForAutoUpdate(location)) {
      setPromptVisible(false);
      return;
    }
    const startedAt = Math.max(availableAt.current, routeChangedAt.current);
    const remaining = Math.max(0, LONG_SESSION_MS - (Date.now() - startedAt));
    if (remaining === 0) {
      setPromptVisible(true);
      return;
    }
    setPromptVisible(false);
    const timer = window.setTimeout(() => setPromptVisible(true), remaining);
    return () => window.clearTimeout(timer);
  }, [hasPendingUpdate, snoozed, location]);

  useEffect(() => {
    if (!hasPendingUpdate) return;
    if (!coldStart.current || autoBlocked.current) return;
    if (!canAutoApply(location)) return;
    void doApplyUpdate();
  }, [hasPendingUpdate, location, canAutoApply, doApplyUpdate]);

  useEffect(() => {
    const previousKey = routeKey.current;
    if (previousKey === location.key) return;
    routeKey.current = location.key;
    routeChangedAt.current = Date.now();
    if (!hasPendingUpdate || autoBlocked.current) return;
    if (!canAutoApply(location)) return;
    void doApplyUpdate();
  }, [location, hasPendingUpdate, canAutoApply, doApplyUpdate]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState !== "hidden") return;
      if (!hasPendingUpdate || autoBlocked.current || !navigator.onLine) return;
      if (!canAutoApply()) return;
      void doApplyUpdate();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [hasPendingUpdate, canAutoApply, doApplyUpdate]);

  const applyUpdate = (manual = false) => {
    if (manual) {
      const editing = isUserActivelyEditing(Date.now(), lastEditTime.current)
        || editTracker.current.hasChanges()
        || hasUnsavedFormInput();
      if (editing) {
        setConfirmOpen(true);
        return;
      }
    }
    void doApplyUpdate();
  };

  const snooze = () => {
    const until = Date.now() + SNOOZE_MS;
    try {
      sessionStorage.setItem(SNOOZE_KEY, String(until));
    } catch {}
    setSnoozeUntil(until);
    setSnoozed(true);
    setPromptVisible(false);
  };

  return (
    <>
    <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
      <DialogContent className="z-[10001]">
        <DialogHeader>
          <DialogTitle>Обновить страницу?</DialogTitle>
          <DialogDescription>Несохранённые изменения будут потеряны. Сначала сохраните их или подтвердите обновление.</DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-3">
          <button className="rounded-lg border px-4 py-2" onClick={() => setConfirmOpen(false)}>Остаться</button>
          <button className="rounded-lg bg-primary px-4 py-2 text-primary-foreground" onClick={() => { setConfirmOpen(false); void doApplyUpdate(); }}>Обновить без сохранения</button>
        </div>
      </DialogContent>
    </Dialog>
    <AnimatePresence>
      {hasPendingUpdate && !snoozed && promptVisible && (
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
              <RefreshCw className={`h-4 w-4 ${autoUpdating ? "animate-spin" : ""}`} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">Доступна новая версия</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {autoUpdating
                  ? "Применяем обновление…"
                  : updateError
                    ? "Не удалось обновить. Попробуйте ещё раз."
                    : "Обновите приложение, когда вам удобно."}
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                <button
                  onClick={() => applyUpdate(true)}
                  disabled={autoUpdating}
                  className="h-8 px-3 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity flex items-center gap-1.5"
                >
                  <RefreshCw className="h-3 w-3" />
                  Обновить сейчас
                </button>
                <button
                  onClick={snooze}
                  disabled={autoUpdating}
                  className="h-8 px-2.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors flex items-center gap-1"
                >
                  <Clock className="h-3 w-3" />
                  Позже
                </button>
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
    </>
  );
}
