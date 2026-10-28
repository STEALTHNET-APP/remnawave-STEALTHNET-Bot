const CLIENT_SUBS_CACHE_TTL_MS = 30_000;

interface CacheEntry<T> {
  data: T;
  ts: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();

export function getCachedClientSubscriptions<T>(clientId: string): T | null {
  const entry = cache.get(clientId);
  if (!entry) return null;
  if (Date.now() - entry.ts > CLIENT_SUBS_CACHE_TTL_MS) {
    cache.delete(clientId);
    return null;
  }
  return entry.data as T;
}

export function setCachedClientSubscriptions<T>(clientId: string, data: T): void {
  cache.set(clientId, { data, ts: Date.now() });
  if (cache.size > 2000) {
    const now = Date.now();
    for (const [k, v] of cache.entries()) {
      if (now - v.ts > CLIENT_SUBS_CACHE_TTL_MS) cache.delete(k);
    }
  }
}

export function getClientSubsInFlight<T>(clientId: string): Promise<T> | undefined {
  return inFlight.get(clientId) as Promise<T> | undefined;
}

export function setClientSubsInFlight<T>(clientId: string, promise: Promise<T>): void {
  inFlight.set(clientId, promise);
}

export function clearClientSubsInFlight(clientId: string): void {
  inFlight.delete(clientId);
}

export function invalidateClientSubscriptions(clientId?: string | null): void {
  if (!clientId) return;
  cache.delete(clientId);
  inFlight.delete(clientId);
}
