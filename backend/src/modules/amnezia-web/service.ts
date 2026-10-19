import { refreshWebEntitlements } from "./renewal.js";
import { z } from "zod";
import { prisma } from "../../db.js";
import { WebPanelApi, webPanelSchema, isWebPanel, WEB_PROTOCOLS } from "./api.js";

const journalSchema = z.object({ config: z.string().optional(), userId: z.string().optional(), attemptAt: z.number().optional() });
const prefixFor = (nodeId: string) => `stealthnet_${nodeId}_`;
const remoteName = (nodeId: string, slotId: string) => `${prefixFor(nodeId)}${slotId}`;
async function locked<T>(fn: () => Promise<T>): Promise<T> {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(741963)`;
    return fn();
  }, { timeout: 300000, maxWait: 10000 });
}
async function syncNode(nodeId: string, provision = false) {
  const node = await prisma.singboxNode.findUnique({ where: { id: nodeId } });
  if (!node || !isWebPanel(node.protocol)) return;
  const settings = webPanelSchema.parse(JSON.parse(node.customConfigJson || "null"));
  if (!settings.owner || !settings.serverUid) throw new Error("Не настроена привязка Amnezia Web Panel");
  await refreshWebEntitlements(nodeId);
  const api = new WebPanelApi(settings);
  const server = await api.server();
  const users = await api.users(prefixFor(node.id));
  const slots = await prisma.singboxSlot.findMany({ where: { nodeId }, include: { client: { select: { isBlocked: true } } } });
  const payments = await prisma.payment.findMany({ where: { id: { in: slots.map(s => s.sourcePaymentId).filter((id): id is string => !!id) } }, select: { id: true, status: true } });
  const paid = new Set(payments.filter(p => p.status === "PAID").map(p => p.id));
  const owned = users.filter(u => u.username.startsWith(prefixFor(node.id)) && u.description === settings.owner);
  for (const user of owned) {
    const slot = slots.find(s => remoteName(node.id, s.id) === user.username);
    if (!slot || !slot.sourcePaymentId || !paid.has(slot.sourcePaymentId) || slot.status === "REVOKED") {
      if (slot) {
        const pending = journalSchema.safeParse(JSON.parse(slot.secret || "{}"));
        if (pending.success && pending.data.attemptAt && Date.now() - pending.data.attemptAt < 120000) continue;
      }
      await api.remove(user.id, user.username, server.id);
      continue;
    }
    const usage = BigInt(Math.floor(user.traffic_used));
    const used = usage > slot.trafficUsedBytes ? usage : slot.trafficUsedBytes;
    await prisma.singboxSlot.update({ where: { id: slot.id }, data: { trafficUsedBytes: used } });
    slot.trafficUsedBytes = used;
  }
  let active = 0;
  let failures = 0;
  for (const slot of slots) {
    try {
    const valid = !!slot.sourcePaymentId && paid.has(slot.sourcePaymentId) && slot.status !== "REVOKED" && slot.expiresAt.getTime() > Date.now() && (!slot.trafficLimitBytes || slot.trafficUsedBytes < slot.trafficLimitBytes) && !slot.client.isBlocked && node.status !== "DISABLED";
    let user = owned.find(u => u.username === remoteName(node.id, slot.id));
    if (!valid) {
      if (user && slot.sourcePaymentId && paid.has(slot.sourcePaymentId) && slot.status !== "REVOKED") await api.toggle(user.id, false, user.enabled);
      if (slot.syncPending) await prisma.singboxSlot.update({ where: { id: slot.id }, data: { syncPending: false } });
      continue;
    }
    if (slot.status === "PROVISIONING" && !provision) continue;
    const journal = journalSchema.parse(JSON.parse(slot.secret || "{}"));
    if (user && slot.status === "ACTIVE" && journal.userId === user.id && journal.config) {
      const expiration = slot.expiresAt.toISOString().replace(/Z$/, "");
      const limit = slot.trafficLimitBytes ? Number(slot.trafficLimitBytes) : 0;
      if (user.expiration_date !== expiration || user.traffic_limit !== limit) await api.request(`/api/users/${encodeURIComponent(user.id)}/update`, { expiration_date: expiration, traffic_limit: limit / 1073741824 });
      await api.toggle(user.id, true, user.enabled);
      if (slot.syncPending) await prisma.singboxSlot.update({ where: { id: slot.id }, data: { syncPending: false } });
      active++;
      continue;
    }
    if (!user) {
      if (users.some(u => u.username === remoteName(node.id, slot.id))) throw new Error("Конфликт владельца пользователя Amnezia Web Panel");
      await api.request("/api/users/add", { username: remoteName(node.id, slot.id), role: "none", description: settings.owner, expiration_date: slot.expiresAt.toISOString().replace(/Z$/, ""), traffic_limit: slot.trafficLimitBytes ? Number(slot.trafficLimitBytes) / 1073741824 : 0 });
      user = (await api.users(remoteName(node.id, slot.id))).find(u => u.username === remoteName(node.id, slot.id) && u.description === settings.owner);
      if (!user) throw new Error("Amnezia Web Panel не создала пользователя");
      await api.toggle(user.id, false);
    }
    let connections = await api.connections(user.id);
    if (!connections.length) {
      if (journal.attemptAt && Date.now() - journal.attemptAt < 120000) throw new Error("Ожидание завершения запроса Amnezia Web Panel");
      const peers = z.object({ clients: z.array(z.object({ clientId: z.string(), assigned_user_id: z.string().optional(), userData: z.object({ clientName: z.string().optional() }).passthrough().optional() })) }).parse(await api.request(`/api/servers/${server.id}/connections?protocol=${encodeURIComponent(settings.protocol)}`));
      const existing = peers.clients.filter(p => p.userData?.clientName === remoteName(node.id, slot.id));
      if (existing.length > 1 || existing.some(p => p.assigned_user_id && p.assigned_user_id !== user!.id)) throw new Error("Конфликт подключения Amnezia Web Panel");
      await prisma.singboxSlot.update({ where: { id: slot.id }, data: { secret: JSON.stringify({ ...journal, userId: user.id, attemptAt: Date.now() }) } });
      if (settings.protocol === "wireguard" && !existing.length) await api.request(`/api/servers/${server.id}/connections/add`, { protocol: settings.protocol, name: remoteName(node.id, slot.id), user_id: user.id });
      else await api.request(`/api/users/${encodeURIComponent(user.id)}/connections/add`, { server_id: server.id, protocol: settings.protocol, name: remoteName(node.id, slot.id), ...(existing[0] ? { client_id: existing[0].clientId } : {}) });
      connections = await api.connections(user.id);
    }
    if (connections.length !== 1 || connections[0]!.server_id !== server.id || connections[0]!.protocol !== settings.protocol) throw new Error("Неверная привязка подключения Amnezia Web Panel");
    const connection = connections[0]!;
    const config = await api.configFor(connection.server_id, connection.client_id, connection.protocol);
    if (node.protocol !== "AWP_XRAY" && !config.includes("[Interface]")) throw new Error("Панель вернула неподдерживаемую конфигурацию");
    if (node.protocol === "AWP_XRAY" && !/^(vless|vmess|trojan):\/\//.test(config)) throw new Error("Панель вернула неподдерживаемую ссылку Xray");
    await api.request(`/api/users/${encodeURIComponent(user.id)}/update`, { expiration_date: slot.expiresAt.toISOString().replace(/Z$/, ""), traffic_limit: slot.trafficLimitBytes ? Number(slot.trafficLimitBytes) / 1073741824 : 0 });
    await api.toggle(user.id, true);
    const liveSlot = await prisma.singboxSlot.findUnique({ where: { id: slot.id }, include: { node: { select: { status: true } } } });
    if (!liveSlot || liveSlot.status === "REVOKED" || liveSlot.expiresAt.getTime() <= Date.now() || liveSlot.node.status === "DISABLED") { await api.toggle(user.id, false); continue; }
    const latest = await prisma.payment.findUnique({ where: { id: slot.sourcePaymentId! }, select: { status: true } });
    const current = await prisma.client.findUnique({ where: { id: slot.clientId }, select: { isBlocked: true } });
    if (latest?.status !== "PAID" || !current || current.isBlocked) { await api.toggle(user.id, false); continue; }
    await prisma.singboxSlot.update({ where: { id: slot.id }, data: { secret: JSON.stringify({ userId: user.id, config }), status: "ACTIVE", syncPending: false } });
    active++;
    } catch {
      failures++;
      await prisma.singboxSlot.updateMany({ where: { id: slot.id }, data: { syncPending: true } });
    }
  }
  let metadata: string | undefined;
  try {
    const stats = z.object({ cpu: z.number(), ram_percent: z.number(), disk_percent: z.number() }).parse(await api.request(`/api/servers/${server.id}/stats`, {}));
    metadata = JSON.stringify(stats);
  } catch {}
  await prisma.singboxNode.update({ where: { id: nodeId }, data: { metadata, ...(node.status !== "DISABLED" ? { status: failures ? "OFFLINE" : "ONLINE" } : {}), lastSeenAt: new Date(), currentConnections: active, trafficInBytes: slots.reduce((sum, s) => sum + s.trafficUsedBytes, 0n) } });
  if (failures) throw new Error("Не все доступы синхронизированы");
}
export async function provisionWebPayment(paymentId: string) {
  const external = await prisma.singboxSlot.findMany({ where: { sourcePaymentId: paymentId, node: { protocol: { in: [...WEB_PROTOCOLS] } } }, select: { nodeId: true } });
  if (!external.length) return;
  for (const nodeId of new Set(external.map(s => s.nodeId))) await locked(() => syncNode(nodeId, true));
  return locked(async () => {
    const slots = await prisma.singboxSlot.findMany({ where: { sourcePaymentId: paymentId }, select: { status: true } });
    if (!slots.length || slots.some(s => s.status !== "ACTIVE")) throw new Error("Amnezia Web Panel ещё не активировала доступ");
  });
}

let running = false;
export async function reconcileWebPanels() {
  if (running) return;
  running = true;
  try {
    const nodes = await prisma.singboxNode.findMany({ where: { protocol: { in: [...WEB_PROTOCOLS] } }, select: { id: true } });
    for (const node of nodes) {
      try { await locked(() => syncNode(node.id, true)); }
      catch {
        await prisma.singboxNode.updateMany({ where: { id: node.id, status: { not: "DISABLED" } }, data: { status: "OFFLINE" } });
        console.error(`[Amnezia Web Panel] Не удалось синхронизировать ноду ${node.id}`);
      }
    }
  } finally { running = false; }
}
export async function updateWebSlot(nodeId: string, slotId: string, data: { expiresAt?: string; status?: "ACTIVE" | "REVOKED" }) {
  await locked(async () => {
    await refreshWebEntitlements(nodeId);
    const slot = await prisma.singboxSlot.findFirst({ where: { id: slotId, nodeId }, include: { node: true } });
    if (!slot || !isWebPanel(slot.node.protocol)) throw new Error("Доступ не найден");
    await prisma.singboxSlot.update({ where: { id: slotId }, data: { ...(data.expiresAt ? { expiresAt: new Date(data.expiresAt), ...(slot.renewalBaseExpiresAt ? { renewalAdjustmentMs: slot.renewalAdjustmentMs + new Date(data.expiresAt).getTime() - slot.expiresAt.getTime() } : {}) } : {}), ...(data.status ? { status: data.status } : {}) } });
    await syncNode(nodeId, true);
  });
}

export async function removeWebNode(nodeId: string) {
  return locked(async () => {
    const node = await prisma.singboxNode.findUnique({ where: { id: nodeId }, include: { _count: { select: { slots: true } } } });
    if (!node || !isWebPanel(node.protocol)) return;
    if (await prisma.singboxSlot.count({ where: { nodeId, status: { in: ["ACTIVE", "PROVISIONING"] }, expiresAt: { gt: new Date() } } })) throw new Error("Сначала отзовите активные доступы этой ноды");
    const settings = webPanelSchema.parse(JSON.parse(node.customConfigJson || "null"));
    const api = new WebPanelApi(settings);
    const server = await api.server();
    for (const user of await api.users(prefixFor(nodeId))) if (user.username.startsWith(prefixFor(nodeId)) && user.description === settings.owner) await api.remove(user.id, user.username, server.id);
    await prisma.singboxNode.delete({ where: { id: nodeId } });
  });
}
