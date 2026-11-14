const LAST_CLEANUP_KEY = "stealthnet_last_cache_cleanup";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
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

function isExpired(value: string | null, now: number): boolean {
  if (!value) return false;
  try {
    const parsed = JSON.parse(value);
    const expiry = typeof parsed?.expiresAt === "number" ? parsed.expiresAt : typeof parsed?.exp === "number" ? parsed.exp * 1000 : undefined;
    return typeof expiry === "number" && Number.isFinite(expiry) && expiry > 0 && expiry <= now;
  } catch { return false; }
}

function purgeTemporaryKeys(storage: Storage, prefixes: string[], now: number): void {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key && prefixes.some(prefix => key.startsWith(prefix))) keys.push(key);
  }
  for (const key of keys) {
    if (!isExpired(storage.getItem(key), now)) continue;
    try {
      storage.removeItem(key);
    } catch {}
  }
}

export async function cacheHousekeeper(now = Date.now()): Promise<void> {
  const lastCleanup = readLastCleanup();
  if (lastCleanup > 0 && now - lastCleanup <= CACHE_TTL_MS) return;


  try {
    if (typeof sessionStorage !== "undefined") purgeTemporaryKeys(sessionStorage, TEMPORARY_KEY_PREFIXES, now);
  } catch {}
  try {
    if (typeof localStorage !== "undefined") purgeTemporaryKeys(localStorage, LEGACY_LOCAL_KEY_PREFIXES, now);
  } catch {}

  writeLastCleanup(now);
}
