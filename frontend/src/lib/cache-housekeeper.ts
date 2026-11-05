const LAST_CLEANUP_KEY = "stealthnet_last_cache_cleanup";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RUNTIME_CACHE_NAMES = new Set(["images-v2", "google-fonts"]);
const PRECACHE_PREFIX = "workbox-precache-v2-";

const TEMPORARY_KEY_PREFIXES = [
  "stealthnet_oauth_",
  "stealthnet_nonce_",
  "stealthnet_temp_",
  "stealthnet_banner_",
  "oauth_state",
  "oauth_nonce",
];

const LEGACY_LOCAL_KEY_PREFIXES = [
  ...TEMPORARY_KEY_PREFIXES,
  "stealthnet_google_oauth_",
];

function readLastCleanup(): number {
  try {
    return Number(localStorage.getItem(LAST_CLEANUP_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeLastCleanup(now: number): void {
  try {
    localStorage.setItem(LAST_CLEANUP_KEY, String(now));
  } catch {}
}

function isUnexpired(value: string | null, now: number): boolean {
  if (!value) return false;
  try {
    const parsed = JSON.parse(value) as { expiresAt?: unknown; exp?: unknown };
    const expiresAt = typeof parsed.expiresAt === "number" ? parsed.expiresAt : typeof parsed.exp === "number" ? parsed.exp : 0;
    return expiresAt > now;
  } catch {
    return false;
  }
}

function purgeTemporaryKeys(storage: Storage, prefixes: string[], now: number): void {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key && prefixes.some(prefix => key.startsWith(prefix))) keys.push(key);
  }
  for (const key of keys) {
    if (isUnexpired(storage.getItem(key), now)) continue;
    try {
      storage.removeItem(key);
    } catch {}
  }
}

async function activePrecacheName(): Promise<string | undefined> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return undefined;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    return registration?.scope ? `${PRECACHE_PREFIX}${registration.scope}` : undefined;
  } catch {
    return undefined;
  }
}

async function purgeCaches(): Promise<void> {
  if (typeof window === "undefined" || !("caches" in window)) return;
  const currentPrecache = await activePrecacheName();
  const isCurrent = (name: string): boolean => {
    if (RUNTIME_CACHE_NAMES.has(name)) return true;
    if (currentPrecache) return name === currentPrecache;
    return name.startsWith(PRECACHE_PREFIX);
  };
  const names = await window.caches.keys();
  await Promise.all(names.filter(name => !isCurrent(name)).map(name => window.caches.delete(name)));
}

export async function cacheHousekeeper(now = Date.now()): Promise<void> {
  const lastCleanup = readLastCleanup();
  if (lastCleanup > 0 && now - lastCleanup <= CACHE_TTL_MS) return;

  try {
    await purgeCaches();
  } catch {}

  try {
    if (typeof sessionStorage !== "undefined") purgeTemporaryKeys(sessionStorage, TEMPORARY_KEY_PREFIXES, now);
  } catch {}
  try {
    if (typeof localStorage !== "undefined") purgeTemporaryKeys(localStorage, LEGACY_LOCAL_KEY_PREFIXES, now);
  } catch {}

  writeLastCleanup(now);
}
