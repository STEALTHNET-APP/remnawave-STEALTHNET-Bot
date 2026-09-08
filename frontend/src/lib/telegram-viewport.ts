/** Shared Mini App expansion. Fullscreen is owned exclusively by AuroraLayout. */
export function initTelegramViewport(): void {
  const tg = window.Telegram?.WebApp;
  if (!tg?.initData?.trim()) return;
  // A reload can inherit fullscreen from the old build. Aurora re-enters on mount.
  try { if (tg.isFullscreen) tg.exitFullscreen?.(); } catch { /* legacy client */ }
  try { tg.ready(); } catch { /* legacy client */ }
  try { tg.expand(); } catch { /* legacy client */ }
  try { tg.disableVerticalSwipes?.(); } catch { /* legacy client */ }
}

/** Returns cleanup so switching away from Aurora also leaves fullscreen. */
export function enterAuroraFullscreen(): () => void {
  const tg = window.Telegram?.WebApp;
  if (!tg?.initData?.trim() || !tg.requestFullscreen) return () => {};
  let active = true;
  const sync = () => {
    if (!active) return;
    const full = tg.isFullscreen === true;
    if (full) document.documentElement.dataset.tgFullscreen = "1";
    else delete document.documentElement.dataset.tgFullscreen;
    document.documentElement.style.setProperty("--app-tg-top", `${full ? (tg.safeAreaInset?.top ?? 0) + (tg.contentSafeAreaInset?.top ?? 0) : 0}px`);
    document.documentElement.style.setProperty("--app-tg-bottom", `${full ? (tg.safeAreaInset?.bottom ?? 0) + (tg.contentSafeAreaInset?.bottom ?? 0) : 0}px`);
  };
  const events = ["fullscreenChanged", "fullscreenFailed", "safeAreaChanged", "contentSafeAreaChanged", "viewportChanged"];
  for (const event of events) { try { tg.onEvent?.(event, sync); } catch { /* legacy event */ } }
  try { tg.requestFullscreen(); } catch { /* unsupported client retains expanded view */ }
  sync();
  return () => {
    active = false;
    for (const event of events) { try { tg.offEvent?.(event, sync); } catch { /* legacy client */ } }
    try { tg.exitFullscreen?.(); } catch { /* legacy client */ }
    delete document.documentElement.dataset.tgFullscreen;
    document.documentElement.style.removeProperty("--app-tg-top");
    document.documentElement.style.removeProperty("--app-tg-bottom");
  };
}
