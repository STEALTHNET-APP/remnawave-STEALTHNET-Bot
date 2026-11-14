import { createHash } from "node:crypto";
import { z } from "zod";

export const WEB_PROTOCOLS = ["AWP_AWG", "AWP_WIREGUARD", "AWP_XRAY"] as const;
export const isWebPanel = (protocol: string) => WEB_PROTOCOLS.includes(protocol as typeof WEB_PROTOCOLS[number]);
export const webPanelSchema = z.object({
  url: z.string().url().max(2048).refine(value => {
    const u = new URL(value);
    return !u.username && !u.password && !u.search && !u.hash && (u.protocol === "https:" || (u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)));
  }, "Нужен HTTPS-адрес панели без логина, пароля и параметров"),
  apiToken: z.string().min(16).max(512).regex(/^[\w-]+$/),
  serverId: z.number().int().min(0),
  protocol: z.string().regex(/^(wireguard|(awg|awg2|awg3|awg_legacy|xray)(__\d+)?)$/),
  serverUid: z.string().min(1).optional(),
  owner: z.string().min(16).optional(),
});
export type WebPanelConfig = z.infer<typeof webPanelSchema>;
export function webProtocol(protocol: string) {
  return protocol.startsWith("awg") ? "AWP_AWG" : protocol.startsWith("wireguard") ? "AWP_WIREGUARD" : "AWP_XRAY";
}
const serverSchema = z.object({ uid: z.string().min(1), name: z.string().optional(), host: z.string(), protocols: z.record(z.unknown()).default({}) });
export const remoteUserSchema = z.object({ id: z.string().min(1), username: z.string(), description: z.string().nullable().optional(), enabled: z.boolean(), expiration_date: z.string().nullable().optional(), traffic_limit: z.number().nonnegative().default(0), traffic_used: z.number().nonnegative().default(0) });
export type RemoteUser = z.infer<typeof remoteUserSchema>;
const connectionSchema = z.object({ id: z.string(), server_id: z.number().int(), protocol: z.string(), client_id: z.string().min(1), name: z.string() });
export class WebPanelApi {
  private readonly peers = new Map<string, unknown>();
  constructor(readonly config: WebPanelConfig, private readonly deadline = Date.now() + 240000) {}
  async request(path: string, body?: unknown): Promise<unknown> {
    const cacheable = body === undefined && /^\/api\/servers\/\d+\/connections\?/.test(path);
    if (cacheable && this.peers.has(path)) return this.peers.get(path);
    if (body !== undefined) this.peers.clear();
    const remaining = this.deadline - Date.now();
    if (remaining <= 0) throw new Error("Истекло время синхронизации Amnezia Web Panel");
    let response: Response;
    try {
      response = await fetch(`${this.config.url.replace(/\/+$/, "")}${path}`, { method: body === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${this.config.apiToken}`, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(Math.min(45000, remaining)), redirect: "error" });
    } catch { throw new Error("Amnezia Web Panel недоступна или не ответила вовремя"); }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Amnezia Web Panel: HTTP ${response.status}`); }
    if (!response.body) throw new Error("Пустой ответ Amnezia Web Panel");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > 32 * 1024 * 1024) { await reader.cancel(); throw new Error("Ответ Amnezia Web Panel слишком большой"); }
      chunks.push(next.value);
    }
    try {
      const data = JSON.parse(Buffer.concat(chunks).toString());
      if (data?.error) throw new Error();
      if (cacheable) this.peers.set(path, data);
      return data;
    } catch { throw new Error("Некорректный ответ Amnezia Web Panel"); }
  }
  async servers() {
    const data = z.object({ servers: z.array(serverSchema), users: z.array(z.object({ id: z.string(), role: z.string(), enabled: z.boolean().optional() })), api_tokens: z.array(z.object({ token_hash: z.string(), user_id: z.string() })) }).parse(await this.request("/api/settings/backup/download"));
    const hash = createHash("sha256").update(this.config.apiToken).digest("hex");
    const owner = data.api_tokens.find(t => t.token_hash === hash)?.user_id;
    if (!data.users.some(u => u.id === owner && u.role === "admin" && u.enabled !== false)) throw new Error("Нужен API-токен администратора Amnezia Web Panel");
    return data.servers.map((server, id) => ({ ...server, id }));
  }
  async server() {
    const servers = await this.servers();
    const server = this.config.serverUid ? servers.find(s => s.uid === this.config.serverUid) : servers[this.config.serverId];
    if (!server || !(this.config.protocol in server.protocols)) throw new Error("Сервер или протокол отсутствует в Amnezia Web Panel");
    return server;
  }
  async users(prefix: string) {
    const users: RemoteUser[] = [];
    for (let page = 1; page <= 1000; page++) {
      const data = z.object({ users: z.array(remoteUserSchema), pages: z.number().int().nonnegative() }).parse(await this.request(`/api/users?search=${encodeURIComponent(prefix)}&page=${page}&size=100`));
      users.push(...data.users);
      if (page >= data.pages) return users;
    }
    throw new Error("Слишком много пользователей Amnezia Web Panel");
  }
  async connections(userId: string) {
    return z.object({ connections: z.array(connectionSchema) }).parse(await this.request(`/api/users/${encodeURIComponent(userId)}/connections`)).connections;
  }
  async configFor(serverId: number, clientId: string, protocol: string) {
    return z.object({ config: z.string().min(1).max(65536) }).parse(await this.request(`/api/servers/${serverId}/connections/config`, { protocol, client_id: clientId })).config;
  }
  async toggle(userId: string, enabled: boolean, currentEnabled?: boolean) {
    if (currentEnabled !== enabled) await this.request(`/api/users/${encodeURIComponent(userId)}/toggle`, { enabled });
    for (const connection of await this.connections(userId)) {
      const read = async () => {
        const data = z.object({ clients: z.array(z.object({ clientId: z.string(), userData: z.object({ enabled: z.boolean().optional() }).passthrough().optional() })) }).parse(await this.request(`/api/servers/${connection.server_id}/connections?protocol=${encodeURIComponent(connection.protocol)}`));
        return data.clients.find(peer => peer.clientId === connection.client_id);
      };
      let peer = await read();
      if (!peer) throw new Error("Подключение отсутствует на сервере Amnezia Web Panel");
      if ((peer.userData?.enabled !== false) !== enabled) {
        await this.request(`/api/servers/${connection.server_id}/connections/toggle`, { protocol: connection.protocol, client_id: connection.client_id, enable: enabled });
        peer = await read();
        if (!peer || (peer.userData?.enabled !== false) !== enabled) throw new Error("Amnezia Web Panel не применила состояние подключения");
      }
    }
  }
  async remove(userId: string, name?: string, serverId?: number) {
    if (name && serverId !== undefined) {
      const peers = z.object({ clients: z.array(z.object({ clientId: z.string(), assigned_user_id: z.string().optional(), userData: z.object({ clientName: z.string().optional() }).passthrough().optional() })) }).parse(await this.request(`/api/servers/${serverId}/connections?protocol=${encodeURIComponent(this.config.protocol)}`));
      for (const peer of peers.clients) {
        if (peer.userData?.clientName === name && !peer.assigned_user_id) await this.request(`/api/servers/${serverId}/connections/remove`, { protocol: this.config.protocol, client_id: peer.clientId });
      }
    }
    const connections = await this.connections(userId);
    for (const connection of connections) {
      await this.request(`/api/servers/${connection.server_id}/connections/remove`, { protocol: connection.protocol, client_id: connection.client_id });
    }
    await this.request(`/api/users/${encodeURIComponent(userId)}/delete`, {});
  }
}
