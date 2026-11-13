let initialized = false;

export function initTelegramViewport(): void {
  if (initialized) return;
  initialized = true;
  const root = document.documentElement;
  const tg = window.Telegram?.WebApp;
  const syncViewport = () => {
    const viewport = window.visualViewport;
    const unscaled = !viewport || Math.abs(viewport.scale - 1) < 0.01;
    const visibleHeight = unscaled && viewport ? viewport.height : window.innerHeight;
    const telegramHeight = tg?.initData?.trim() && Number.isFinite(tg.viewportHeight) && (tg.viewportHeight ?? 0) > 0 ? tg.viewportHeight! : visibleHeight;
    root.style.setProperty("--app-viewport-height", `${Math.min(visibleHeight, telegramHeight)}px`);
    root.style.setProperty("--app-viewport-top", `${unscaled && viewport ? viewport.offsetTop : 0}px`);
  };
  window.addEventListener("resize", syncViewport);
  window.visualViewport?.addEventListener("resize", syncViewport);
  window.visualViewport?.addEventListener("scroll", syncViewport);
  syncViewport();

  if (!tg?.initData?.trim()) return;
  root.dataset.tgMiniapp = "1";
  document.querySelector('meta[name="viewport"]')?.setAttribute("content", "width=device-width, initial-scale=1.0, minimum-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover");
  const preventGesture = (event: Event) => event.preventDefault();
  document.addEventListener("gesturestart", preventGesture, { passive: false });
  document.addEventListener("gesturechange", preventGesture, { passive: false });
  document.addEventListener("touchmove", (event) => {
    if (event.touches.length > 1) event.preventDefault();
  }, { passive: false });
  const inset = (value: number | undefined) => Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;
  const sync = () => {
    if (tg.isFullscreen) root.dataset.tgFullscreen = "1";
    else delete root.dataset.tgFullscreen;
    for (const side of ["top", "bottom", "left", "right"] as const) {
      root.style.setProperty(`--app-tg-${side}`, `${inset(tg.safeAreaInset?.[side]) + inset(tg.contentSafeAreaInset?.[side])}px`);
    }
    syncViewport();
  };
  for (const event of ["fullscreenChanged", "fullscreenFailed", "safeAreaChanged", "contentSafeAreaChanged", "viewportChanged"]) {
    try { tg.onEvent?.(event, sync); } catch {}
  }
  try { tg.ready(); } catch {}
  try { tg.expand(); } catch {}
  try { tg.disableVerticalSwipes?.(); } catch {}
  sync();
}

export function enterAuroraFullscreen(): () => void {
  const tg = window.Telegram?.WebApp;
  if (!tg?.initData?.trim() || !tg.requestFullscreen) return () => {};
  try { tg.requestFullscreen(); } catch {}
  return () => {
    try { tg.exitFullscreen?.(); } catch {}
  };
}
