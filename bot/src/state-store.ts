export type DiscountInfo = {
  code: string;
  discountPercent?: number | null;
  discountFixed?: number | null;
};

export type BroadcastPayload = {
  text: string;
  photoFileId?: string;
  buttonText?: string;
  buttonUrl?: string;
};

export type StatePriceOption = {
  id: string;
  durationDays: number;
  price: number;
  sortOrder: number;
};

type Expirable = { sweep(now: number): void; delete(key: unknown): void; clear(): void };

const USER_STATE_TTL_MS = 30 * 60_000;
const LONG_LIVED_TTL_MS = 24 * 60 * 60_000;

const registered: Expirable[] = [];
const ephemeral: Expirable[] = [];

export class TtlMap<K, V> implements Expirable {
  private readonly data = new Map<K, { value: V; expires: number }>();

  constructor(private readonly ttlMs: number) {}

  get(key: K): V | undefined {
    const entry = this.data.get(key);
    if (!entry) return undefined;
    if (entry.expires <= Date.now()) {
      this.data.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V): this {
    this.data.set(key, { value, expires: Date.now() + this.ttlMs });
    return this;
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: K): boolean {
    return this.data.delete(key);
  }

  clear(): void {
    this.data.clear();
  }

  get size(): number {
    this.sweep(Date.now());
    return this.data.size;
  }

  sweep(now: number): void {
    for (const [key, entry] of this.data) {
      if (entry.expires <= now) this.data.delete(key);
    }
  }
}

export class TtlSet<K> implements Expirable {
  private readonly data = new Map<K, number>();

  constructor(private readonly ttlMs: number) {}

  add(key: K): this {
    this.data.set(key, Date.now() + this.ttlMs);
    return this;
  }

  has(key: K): boolean {
    const expires = this.data.get(key);
    if (expires === undefined) return false;
    if (expires <= Date.now()) {
      this.data.delete(key);
      return false;
    }
    return true;
  }

  delete(key: K): boolean {
    return this.data.delete(key);
  }

  clear(): void {
    this.data.clear();
  }

  get size(): number {
    this.sweep(Date.now());
    return this.data.size;
  }

  sweep(now: number): void {
    for (const [key, expires] of this.data) {
      if (expires <= now) this.data.delete(key);
    }
  }
}

function userMap<V>(ttlMs = USER_STATE_TTL_MS): TtlMap<number, V> {
  const map = new TtlMap<number, V>(ttlMs);
  registered.push(map);
  ephemeral.push(map);
  return map;
}

function userSet(ttlMs = USER_STATE_TTL_MS): TtlSet<number> {
  const set = new TtlSet<number>(ttlMs);
  registered.push(set);
  ephemeral.push(set);
  return set;
}

function userCache<V>(ttlMs = USER_STATE_TTL_MS): TtlMap<number, V> {
  const map = new TtlMap<number, V>(ttlMs);
  registered.push(map);
  return map;
}

export const userLangCache = new TtlMap<number, string>(LONG_LIVED_TTL_MS);
export const tokenStore = new TtlMap<number, string>(LONG_LIVED_TTL_MS);
registered.push(userLangCache, tokenStore);

export const addsubPending = userMap<string>();
export const extendingSecondaryPending = userMap<{ tariffId: string; secondaryId: string }>();
export const trialConvertPickCache = userMap<{ sid: string; options: { id: string; name: string }[] }>();
export const pendingDropExtras = userMap<string>();
export const extraOptionTargetSub = userMap<string>();
export const extraOptionPending = userMap<{ kind: "traffic" | "devices" | "servers"; productId: string }>();
export const tariffOptionsCache = userMap<{ tariffId: string; options: StatePriceOption[] }>();
export const selectedTariffOption = userMap<{ tariffId: string; option: StatePriceOption; extraDevices: number }>();
export const trialReplaceChoice = userMap<string>();
export const convDropExtras = userSet();
export const selectedGiftOption = userMap<{ tariffId: string; option: StatePriceOption | null; extraDevices: number }>();
export const giftOptionsCache = userMap<{ tariffId: string; options: StatePriceOption[] }>();

export const awaitingPromoCode = userSet();
export const activeDiscountCode = userCache<DiscountInfo>();
export const awaitingGiftCode = userSet();
export const awaitingWithdrawAmount = userSet();
export const awaitingWithdrawWallet = userMap<number>();
export const awaitingCustomTopup = userSet();

export const awaitingAdminSearch = userSet();
export const lastAdminSearch = userMap<string>(60 * 60_000);
export const awaitingAdminBalance = userMap<string>();
export const awaitingBroadcastMessage = userSet();
export const lastBroadcastMessage = userMap<string | BroadcastPayload>(60 * 60_000);
export const lastSquadsForAdd = userMap<{ clientId: string; items: { uuid: string; name: string }[] }>(60 * 60_000);
export const lastSquadsForRemove = userMap<{ clientId: string; items: { uuid: string; name: string }[] }>(60 * 60_000);

export const startThrottle = userCache<number>(60_000);

export function clearUserState(userId: number): void {
  for (const collection of ephemeral) collection.delete(userId);
}

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const collection of registered) collection.sweep(now);
}, 60_000);
cleanupTimer.unref();
