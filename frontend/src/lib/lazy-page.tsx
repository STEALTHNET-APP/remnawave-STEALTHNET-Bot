import { canSafelyApplyUpdate } from "./update-safety";
import { Component, lazy, Suspense, type ComponentProps, type ComponentType, type ReactNode } from "react";

const CHUNK_RETRY_KEY = "chunk_retry_timestamp";
const CHUNK_RETRY_WINDOW_MS = 30_000;
const CHUNK_ERROR_PATTERNS = [
  /ChunkLoadError/i,
  /Failed to fetch dynamically imported module/i,
  /Loading chunk [\w-]+ failed/i,
  /Importing a module script failed/i,
  /error loading dynamically imported module/i,
];

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return CHUNK_ERROR_PATTERNS.some(pattern => pattern.test(message));
}

function reloadWithCleanup(): void {
  window.location.reload();
}

export function recoverChunkLoad(now = Date.now()): boolean {
  if (!canSafelyApplyUpdate({ now })) return false;
  let lastAttempt = 0;
  try {
    lastAttempt = Number(sessionStorage.getItem(CHUNK_RETRY_KEY)) || 0;
  } catch {
    return false;
  }
  if (now - lastAttempt <= CHUNK_RETRY_WINDOW_MS) return false;
  try {
    sessionStorage.setItem(CHUNK_RETRY_KEY, String(now));
  } catch {
    return false;
  }
  reloadWithCleanup();
  return true;
}

export function forceApplicationReload(): void {
  try {
    sessionStorage.removeItem(CHUNK_RETRY_KEY);
  } catch {}
  reloadWithCleanup();
}

class PageLoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <div role="alert" className="p-6"><p>Не удалось открыть раздел. Проверьте соединение и обновите страницу.</p><button className="mt-4 underline" onClick={forceApplicationReload}>Обновить страницу</button></div>;
    return this.props.children;
  }
}

function withChunkRecovery<C extends ComponentType<any>>(load: () => Promise<{ default: C }>) {
  return () => load().catch((error: unknown) => {
    if (!isChunkLoadError(error)) throw error;
    if (recoverChunkLoad()) return new Promise<{ default: C }>(() => {});
    throw error;
  });
}

export function lazyPage<C extends ComponentType<any>>(load: () => Promise<{ default: C }>) {
  const Page = lazy(withChunkRecovery(load));
  return function DeferredPage(props: ComponentProps<C>) {
    return <PageLoadBoundary><Suspense fallback={<div role="status" className="p-6 text-sm text-muted-foreground">Открываем раздел…</div>}><Page {...props} /></Suspense></PageLoadBoundary>;
  };
}
