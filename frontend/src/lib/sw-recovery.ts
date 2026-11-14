import { applyWorkerUpdate } from "../components/pwa/pwa-apply-update";
import { canSafelyApplyUpdate } from "./update-safety";

const RETRY_KEY = "chunk_retry_timestamp";
const RETRY_WINDOW_MS = 30_000;

export type BundleRecoveryOptions = {
  now?: number;
  force?: boolean;
  reload?: () => void;
  container?: ServiceWorkerContainer;
  cacheStorage?: CacheStorage;
};

function serviceWorkerContainer(): ServiceWorkerContainer | undefined {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return undefined;
  return navigator.serviceWorker;
}

function browserCaches(): CacheStorage | undefined {
  return typeof caches === "undefined" ? undefined : caches;
}

function reloadPage(): void {
  window.location.reload();
}

function attemptTimestamp(): number {
  try {
    return Number(sessionStorage.getItem(RETRY_KEY)) || 0;
  } catch {
    return 0;
  }
}

function inRetryWindow(now: number): boolean {
  const lastAttempt = attemptTimestamp();
  return lastAttempt > 0 && now - lastAttempt <= RETRY_WINDOW_MS;
}

function markAttempt(now: number): void {
  try {
    sessionStorage.setItem(RETRY_KEY, String(now));
  } catch {}
}

export function resetRetryWindow(): void {
  try {
    sessionStorage.removeItem(RETRY_KEY);
  } catch {}
}

async function unregisterAll(container: ServiceWorkerContainer | undefined): Promise<void> {
  if (!container?.getRegistrations) return;
  const registrations = await container.getRegistrations().catch(() => []);
  await Promise.all(registrations.map(registration => registration.unregister().catch(() => false)));
}

async function deleteCaches(store: CacheStorage | undefined): Promise<void> {
  if (!store?.keys) return;
  const keys = await store.keys().catch(() => []);
  await Promise.all(keys.map(key => store.delete(key).catch(() => false)));
}

export async function hardResetApplication(options: BundleRecoveryOptions = {}): Promise<void> {
  const reload = options.reload ?? reloadPage;
  await unregisterAll(options.container ?? serviceWorkerContainer());
  await deleteCaches(options.cacheStorage ?? browserCaches());
  reload();
}

export async function recoverFromStaleBundle(options: BundleRecoveryOptions = {}): Promise<boolean> {
  const now = options.now ?? Date.now();
  if (!options.force) {
    if (!canSafelyApplyUpdate({ now })) return false;
    if (inRetryWindow(now)) return false;
  }
  markAttempt(now);
  const container = options.container ?? serviceWorkerContainer();
  const reload = options.reload ?? reloadPage;
  const registration = await container?.getRegistration().catch(() => undefined);
  if (registration) {
    const updated = await registration.update().then(() => true).catch(() => false);
    if (!updated) return false;
    if (registration.waiting) {
      const activated = await applyWorkerUpdate(() => Promise.resolve(), registration, container, reload)
        .then(() => true)
        .catch(() => false);
      if (activated) return true;
    } else if (!registration.installing) {
      reload();
      return true;
    }
  }
  await hardResetApplication({ ...options, container, reload });
  return true;
}

export function forceApplicationReload(options: BundleRecoveryOptions = {}): Promise<void> {
  resetRetryWindow();
  return hardResetApplication(options);
}
