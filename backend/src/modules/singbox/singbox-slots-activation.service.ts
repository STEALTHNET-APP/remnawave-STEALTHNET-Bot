import { randomBytes, randomUUID } from "node:crypto";
import { prisma } from "../../db.js";
import { awgConfigSchema, freeAwgAddress, newAwgPeer } from "./amneziawg.js";

export type CreateSingboxSlotsResult =
  | { ok: true; slotsCreated: number; slotIds: string[] }
  | { ok: false; error: string; status: number };

export async function createSingboxSlotsByPaymentId(paymentId: string): Promise<CreateSingboxSlotsResult> {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(741962)`;
    const payment = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!payment?.singboxTariffId || payment.status !== "PAID") return { ok: false, error: "Нет оплаченного тарифа", status: 400 };
    const previous = await tx.singboxSlot.findMany({ where: { sourcePaymentId: paymentId }, select: { id: true } });
    if (previous.length) return { ok: true, slotsCreated: previous.length, slotIds: previous.map(s => s.id) };
    const tariff = await tx.singboxTariff.findUnique({ where: { id: payment.singboxTariffId } });
    if (!tariff) return { ok: false, error: "Тариф не найден", status: 404 };
    const client = await tx.client.findUnique({ where: { id: payment.clientId } });
    if (!client || client.isBlocked) return { ok: false, error: "Клиент недоступен", status: 403 };
    const now = new Date();
    const nodes = await tx.singboxNode.findMany({
      where: { status: "ONLINE", lastSeenAt: { gt: new Date(now.getTime() - 300000) }, protocol: tariff.protocol === "SINGBOX" ? { in: ["VLESS", "SHADOWSOCKS", "TROJAN", "HYSTERIA2"] } : tariff.protocol },
      orderBy: { id: "asc" },
      include: { slots: { select: { userIdentifier: true, status: true, expiresAt: true } } },
    });
    const planned: { nodeId: string; userIdentifier: string; secret: string | null }[] = [];
    const counts = new Map(nodes.map(n => [n.id, n.slots.filter(s => s.status === "ACTIVE" && s.expiresAt > now).length]));
    for (let i = 0; i < tariff.slotCount; i++) {
      let allocated = false;
      for (let j = 0; j < nodes.length; j++) {
        const node = nodes[(i + j) % nodes.length]!;
        if ((counts.get(node.id) ?? 0) >= (node.capacity ?? Infinity)) continue;
        let secret: string | null = node.protocol === "VLESS" ? null : randomBytes(24).toString("base64url");
        let userIdentifier = randomUUID() as string;
        if (node.protocol === "AMNEZIAWG") {
          const config = awgConfigSchema.safeParse(JSON.parse(node.customConfigJson || "null"));
          if (!config.success || !config.data.publicKey || !node.publicHost) continue;
          const used = new Set([...node.slots.map(s => s.userIdentifier), ...planned.filter(s => s.nodeId === node.id).map(s => s.userIdentifier)]);
          const address = freeAwgAddress(used);
          if (!address) continue;
          userIdentifier = address;
          secret = JSON.stringify(newAwgPeer(address));
        }
        planned.push({ nodeId: node.id, userIdentifier, secret });
        counts.set(node.id, (counts.get(node.id) ?? 0) + 1);
        allocated = true;
        break;
      }
      if (!allocated) return { ok: false, error: "Недостаточно свободных мест на нодах нужного протокола", status: 503 };
    }
    const slotIds: string[] = [];
    for (const slot of planned) {
      const created = await tx.singboxSlot.create({ data: { ...slot, clientId: client.id, singboxTariffId: tariff.id, sourcePaymentId: paymentId,
        expiresAt: new Date(now.getTime() + tariff.durationDays * 86400000), trafficLimitBytes: tariff.trafficLimitBytes, status: "ACTIVE" } });
      slotIds.push(created.id);
    }
    return { ok: true, slotsCreated: slotIds.length, slotIds };
  }, { timeout: 30000 });
}
