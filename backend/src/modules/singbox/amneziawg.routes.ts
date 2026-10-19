import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { awgConfigSchema, awgKey, awgPeerSchema } from "./amneziawg.js";

export const amneziawgRouter = Router();
amneziawgRouter.use(async (req, res, next) => {
  try {
    const token = req.get("x-singbox-node-token");
    if (!token) return res.sendStatus(401);
    const node = await prisma.singboxNode.findUnique({ where: { token } });
    if (!node || node.protocol !== "AMNEZIAWG") return res.sendStatus(401);
    res.locals.node = node;
    next();
  } catch (e) { next(e); }
});

amneziawgRouter.post("/register", async (req, res, next) => {
  try {
    const parsed = z.object({ publicKey: awgKey }).safeParse(req.body);
    if (!parsed.success) return res.sendStatus(400);
    const node = res.locals.node;
    const config = awgConfigSchema.parse(JSON.parse(node.customConfigJson));
    if (config.publicKey && config.publicKey !== parsed.data.publicKey) return res.status(409).json({ error: "Server key changed. Restore the awg-data volume or create a new node." });
    config.publicKey = parsed.data.publicKey;
    const claimed = await prisma.singboxNode.updateMany({ where: { id: node.id, customConfigJson: node.customConfigJson }, data: { customConfigJson: JSON.stringify(config), lastSeenAt: new Date() } });
    if (!claimed.count) return res.sendStatus(409);
    await prisma.singboxNode.updateMany({ where: { id: node.id, status: { not: "DISABLED" } }, data: { status: "ONLINE" } });
    return res.json({ nodeId: node.id, port: node.port, config });
  } catch (e) { next(e); }
});

amneziawgRouter.get("/peers", async (_req, res, next) => {
  try {
    const node = res.locals.node;
    const slots = node.status === "DISABLED" ? [] : await prisma.singboxSlot.findMany({ where: { nodeId: node.id, status: "ACTIVE", expiresAt: { gt: new Date() }, client: { isBlocked: false } } });
    const paid = new Set((await prisma.payment.findMany({ where: { id: { in: slots.flatMap(s => s.sourcePaymentId ? [s.sourcePaymentId] : []) }, status: "PAID" }, select: { id: true } })).map(p => p.id));
    const peers = slots.filter(s => s.sourcePaymentId && paid.has(s.sourcePaymentId) && (!s.trafficLimitBytes || s.trafficUsedBytes < s.trafficLimitBytes)).map(s => {
      const p = awgPeerSchema.parse(JSON.parse(s.secret!));
      return { id: s.id, publicKey: p.publicKey, presharedKey: p.presharedKey, address: p.address, expiresAt: s.expiresAt.toISOString(), trafficUsed: s.trafficUsedBytes.toString(), trafficLimit: s.trafficLimitBytes?.toString() ?? null };
    });
    res.set("Cache-Control", "no-store");
    return res.json({ peers, leaseUntil: new Date(Date.now() + 300000).toISOString() });
  } catch (e) { next(e); }
});

amneziawgRouter.post("/heartbeat", async (req, res, next) => {
  try {
    const parsed = z.object({ trafficIn: z.string().regex(/^\d{1,19}$/).optional(), trafficOut: z.string().regex(/^\d{1,19}$/).optional(), peers: z.array(z.object({ id: z.string(), trafficUsed: z.string().regex(/^\d{1,19}$/), connections: z.number().int().min(0).max(1) })).max(65533) }).safeParse(req.body);
    if (!parsed.success) return res.sendStatus(400);
    const node = res.locals.node;
    for (const p of parsed.data.peers) {
      const used = BigInt(p.trafficUsed);
      if (used > 9223372036854775807n) return res.sendStatus(400);
      await prisma.singboxSlot.updateMany({ where: { nodeId: node.id, id: p.id, trafficUsedBytes: { lt: used } }, data: { trafficUsedBytes: used } });
      await prisma.singboxSlot.updateMany({ where: { nodeId: node.id, id: p.id }, data: { currentConnections: p.connections } });
    }
    for (const [field, value] of [["trafficInBytes", parsed.data.trafficIn], ["trafficOutBytes", parsed.data.trafficOut]] as const) {
      if (value !== undefined && BigInt(value) <= 9223372036854775807n) await prisma.singboxNode.updateMany({ where: { id: node.id, [field]: { lt: BigInt(value) } }, data: { [field]: BigInt(value) } });
    }
    await prisma.singboxNode.update({ where: { id: node.id }, data: { lastSeenAt: new Date(), currentConnections: parsed.data.peers.reduce((n, p) => n + p.connections, 0) } });
    await prisma.singboxNode.updateMany({ where: { id: node.id, status: { not: "DISABLED" } }, data: { status: "ONLINE" } });
    return res.json({ ok: true });
  } catch (e) { next(e); }
});
