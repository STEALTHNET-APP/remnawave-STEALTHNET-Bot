/**
 * Клиент Remna (RemnaWave) API — по спецификации api-1.yaml
 * Все запросы с Bearer ADMIN_TOKEN.
 */

import { env } from "../../config/index.js";

const REMNA_API_URL = env.REMNA_API_URL?.replace(/\/$/, "") ?? "";
const REMNA_ADMIN_TOKEN = env.REMNA_ADMIN_TOKEN ?? "";

export function isRemnaConfigured(): boolean {
  return Boolean(REMNA_API_URL && REMNA_ADMIN_TOKEN);
}

function getHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${REMNA_ADMIN_TOKEN}`,
  };
}

export async function remnaFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<{ data?: T; error?: string; status: number }> {
  if (!isRemnaConfigured()) {
    return { error: "Remna API not configured", status: 503 };
  }

  const url = `${REMNA_API_URL}${path.startsWith("/") ? path : `/${path}`}`;
  try {
    const res = await fetch(url, {
      ...options,
      headers: { ...getHeaders(), ...(options.headers as object) },
    });
    const text = await res.text();
    let data: T | undefined;
    if (text) {
      try {
        data = JSON.parse(text) as T;
      } catch {
        // non-JSON response
      }
    }
    if (!res.ok) {
      return {
        error: (data as { message?: string })?.message ?? res.statusText ?? text.slice(0, 200),
        status: res.status,
      };
    }
    return { data: data as T, status: res.status };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { error: message, status: 500 };
  }
}

/** GET /api/users — пагинация Remna: size и start (offset) */
export function remnaGetUsers(params?: { page?: number; limit?: number; start?: number; size?: number }) {
  const search = new URLSearchParams();
  if (params?.size != null) search.set("size", String(params.size));
  else if (params?.limit != null) search.set("size", String(params.limit));
  if (params?.start != null) search.set("start", String(params.start));
  else if (params?.page != null && params?.limit != null)
    search.set("start", String((params.page - 1) * params.limit));
  const q = search.toString();
  return remnaFetch<unknown>(`/api/users${q ? `?${q}` : ""}`);
}

/** GET /api/users/{uuid} */
export function remnaGetUser(uuid: string) {
  return remnaFetch<unknown>(`/api/users/${uuid}`);
}

/** GET /api/users/by-username/{username} */
export function remnaGetUserByUsername(username: string) {
  const encoded = encodeURIComponent(username);
  return remnaFetch<unknown>(`/api/users/by-username/${encoded}`);
}

/** GET /api/users/by-email/{email} — может вернуть массив или объект с users */
export function remnaGetUserByEmail(email: string) {
  const encoded = encodeURIComponent(email);
  return remnaFetch<unknown>(`/api/users/by-email/${encoded}`);
}

/** GET /api/users/by-telegram-id/{telegramId} */
export function remnaGetUserByTelegramId(telegramId: string) {
  const encoded = encodeURIComponent(telegramId);
  return remnaFetch<unknown>(`/api/users/by-telegram-id/${encoded}`);
}

/** Извлечь UUID из ответа Remna (create/get: объект, response, data, users[0]). */
export function extractRemnaUuid(d: unknown): string | null {
  if (!d || typeof d !== "object") return null;
  const o = d as Record<string, unknown>;
  if (typeof o.uuid === "string") return o.uuid;
  const resp = (o.response ?? o.data) as Record<string, unknown> | undefined;
  if (resp && typeof resp.uuid === "string") return resp.uuid;
  const users = Array.isArray(o.users) ? o.users : Array.isArray(o.response) ? o.response : Array.isArray(o.data) ? o.data : null;
  const first = users?.[0];
  return first && typeof first === "object" && first !== null && typeof (first as Record<string, unknown>).uuid === "string"
    ? (first as Record<string, unknown>).uuid as string
    : null;
}

/**
 * Формирует username для Remna (3–36 символов, только [a-zA-Z0-9_-]).
 * Приоритет: Telegram username → Telegram ID (tg123) → email (local part) → fallback.
 */
export function remnaUsernameFromClient(opts: {
  telegramUsername?: string | null;
  telegramId?: string | null;
  email?: string | null;
  clientIdFallback?: string;
}): string {
  const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 36);
  if (opts.telegramUsername?.trim()) {
    const u = sanitize(opts.telegramUsername.trim());
    if (u.length >= 3) return u;
  }
  if (opts.telegramId?.trim()) {
    const t = "tg" + opts.telegramId.trim().replace(/\D/g, "");
    if (t.length >= 3) return t.slice(0, 36);
  }
  if (opts.email?.trim()) {
    const local = opts.email.split("@")[0]?.trim();
    if (local) {
      const e = sanitize(local);
      if (e.length >= 3) return e;
    }
    const full = sanitize(opts.email.trim());
    if (full.length >= 3) return full;
  }
  const fallback = opts.clientIdFallback
    ? "user" + opts.clientIdFallback.slice(-8).replace(/[^a-zA-Z0-9_-]/g, "0")
    : "user" + Date.now().toString(36);
  const out = sanitize(fallback);
  return out.length >= 3 ? out : "u_" + out.slice(0, 34);
}

/** POST /api/users */
export function remnaCreateUser(body: Record<string, unknown>) {
  return remnaFetch<unknown>("/api/users", { method: "POST", body: JSON.stringify(body) });
}

/** PATCH /api/users */
export function remnaUpdateUser(body: Record<string, unknown>) {
  return remnaFetch<unknown>("/api/users", { method: "PATCH", body: JSON.stringify(body) });
}

/** GET /api/subscriptions */
export function remnaGetSubscriptions(params?: { page?: number; limit?: number }) {
  const search = new URLSearchParams();
  if (params?.page != null) search.set("page", String(params.page));
  if (params?.limit != null) search.set("limit", String(params.limit));
  const q = search.toString();
  return remnaFetch<unknown>(`/api/subscriptions${q ? `?${q}` : ""}`);
}

/** GET /api/subscription-templates */
export function remnaGetSubscriptionTemplates() {
  return remnaFetch<unknown>("/api/subscription-templates");
}

/** GET /api/internal-squads, /api/external-squads */
export function remnaGetInternalSquads() {
  return remnaFetch<unknown>("/api/internal-squads");
}

export function remnaGetExternalSquads() {
  return remnaFetch<unknown>("/api/external-squads");
}

/** GET /api/system/stats */
export function remnaGetSystemStats() {
  return remnaFetch<unknown>("/api/system/stats");
}

/** GET /api/system/stats/nodes — статистика нод по дням */
export function remnaGetSystemStatsNodes() {
  return remnaFetch<unknown>("/api/system/stats/nodes");
}

/** GET /api/nodes — список нод (uuid, name, address, isConnected, isDisabled, isConnecting, ...) */
export function remnaGetNodes() {
  return remnaFetch<unknown>("/api/nodes");
}

/** POST /api/nodes/{uuid}/actions/enable */
export function remnaEnableNode(uuid: string) {
  return remnaFetch<unknown>(`/api/nodes/${uuid}/actions/enable`, { method: "POST" });
}

/** POST /api/nodes/{uuid}/actions/disable */
export function remnaDisableNode(uuid: string) {
  return remnaFetch<unknown>(`/api/nodes/${uuid}/actions/disable`, { method: "POST" });
}

/** POST /api/nodes/{uuid}/actions/restart */
export function remnaRestartNode(uuid: string) {
  return remnaFetch<unknown>(`/api/nodes/${uuid}/actions/restart`, { method: "POST" });
}

/** POST /api/users/{uuid}/actions/revoke — отозвать подписку */
export function remnaRevokeUserSubscription(uuid: string, body?: { expirationDate?: string }) {
  return remnaFetch<unknown>(`/api/users/${uuid}/actions/revoke`, {
    method: "POST",
    body: body ? JSON.stringify(body) : "{}",
  });
}

/** POST /api/users/{uuid}/actions/disable */
export function remnaDisableUser(uuid: string) {
  return remnaFetch<unknown>(`/api/users/${uuid}/actions/disable`, { method: "POST" });
}

/** POST /api/users/{uuid}/actions/enable */
export function remnaEnableUser(uuid: string) {
  return remnaFetch<unknown>(`/api/users/${uuid}/actions/enable`, { method: "POST" });
}

/** POST /api/users/{uuid}/actions/reset-traffic */
export function remnaResetUserTraffic(uuid: string) {
  return remnaFetch<unknown>(`/api/users/${uuid}/actions/reset-traffic`, { method: "POST" });
}

/** POST /api/users/bulk/update-squads — uuids + activeInternalSquads */
export function remnaBulkUpdateUsersSquads(body: { uuids: string[]; activeInternalSquads: string[] }) {
  return remnaFetch<unknown>("/api/users/bulk/update-squads", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** POST /api/internal-squads/{squadUuid}/bulk-actions/add-users */
export function remnaAddUsersToInternalSquad(squadUuid: string, body: { userUuids: string[] }) {
  return remnaFetch<unknown>(`/api/internal-squads/${squadUuid}/bulk-actions/add-users`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** DELETE /api/internal-squads/{squadUuid}/bulk-actions/remove-users */
export function remnaRemoveUsersFromInternalSquad(squadUuid: string, body: { userUuids: string[] }) {
  return remnaFetch<unknown>(`/api/internal-squads/${squadUuid}/bulk-actions/remove-users`, {
    method: "DELETE",
    body: JSON.stringify(body),
  });
}
