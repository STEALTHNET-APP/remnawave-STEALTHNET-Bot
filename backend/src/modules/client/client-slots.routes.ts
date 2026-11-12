import { Router } from "express";
import { prisma } from "../../db.js";
import { webClientRouter } from "../amnezia-web/client.routes.js";
import { isWebPanel, WEB_PROTOCOLS } from "../amnezia-web/api.js";
import { buildSingboxSlotSubscriptionLink } from "../singbox/singbox-link.js";

export const clientSlotsRouter = Router();

clientSlotsRouter.get("/proxy-slots", async (req, res) => {
  const client = (req as unknown as { client: { id: string } }).client;
  const now = new Date();
  const slots = await prisma.proxySlot.findMany({
    where: { clientId: client.id, status: "ACTIVE", expiresAt: { gt: now } },
    select: {
      id: true,
      login: true,
      password: true,
      expiresAt: true,
      trafficLimitBytes: true,
      trafficUsedBytes: true,
      connectionLimit: true,
      node: { select: { publicHost: true, socksPort: true, httpPort: true } },
    },
    orderBy: { expiresAt: "asc" },
  });
  return res.json({
    slots: slots.map((s) => ({
      id: s.id,
      login: s.login,
      password: s.password,
      expiresAt: s.expiresAt.toISOString(),
      trafficLimitBytes: s.trafficLimitBytes?.toString() ?? null,
      trafficUsedBytes: s.trafficUsedBytes.toString(),
      connectionLimit: s.connectionLimit,
      host: s.node.publicHost ?? "host",
      socksPort: s.node.socksPort,
      httpPort: s.node.httpPort,
    })),
  });
});

clientSlotsRouter.use(webClientRouter);

clientSlotsRouter.get("/singbox-slots", async (req, res) => {
  res.set("Cache-Control", "no-store");
  const client = (req as unknown as { client: { id: string } }).client;
  const now = new Date();
  const slots = await prisma.singboxSlot.findMany({
    where: { clientId: client.id, OR: [{ status: "ACTIVE", expiresAt: { gt: now } }, ...(req.query.includeInactive === "true" ? [{ node: { protocol: { in: [...WEB_PROTOCOLS] } }, status: { in: ["ACTIVE", "PROVISIONING"] } }] : [])] },
    select: {
      id: true,
      status: true,
      syncPending: true,
      sourcePaymentId: true,
      singboxTariff: { select: { enabled: true } },
      userIdentifier: true,
      secret: true,
      expiresAt: true,
      trafficLimitBytes: true,
      trafficUsedBytes: true,
      node: { select: { status: true, publicHost: true, port: true, protocol: true, tlsEnabled: true, customConfigJson: true } },
    },
    orderBy: { expiresAt: "asc" },
  });
  const payments = await prisma.payment.findMany({ where: { id: { in: slots.map(s => s.sourcePaymentId).filter((id): id is string => !!id) } }, select: { id: true, status: true } });
  const paid = new Set(payments.filter(p => p.status === "PAID").map(p => p.id));
  return res.json({
    slots: slots.filter(s => !isWebPanel(s.node.protocol) || (s.sourcePaymentId && paid.has(s.sourcePaymentId))).map((s) => {
      const link = s.status === "ACTIVE" && s.expiresAt > now ? buildSingboxSlotSubscriptionLink(
        {
          publicHost: s.node.publicHost ?? "",
          port: s.node.port ?? 443,
          protocol: s.node.protocol ?? "VLESS",
          tlsEnabled: s.node.tlsEnabled,
          customConfigJson: s.node.customConfigJson,
        },
        { userIdentifier: s.userIdentifier, secret: s.secret },
        `slot-${s.id.slice(-8)}`
      ) : "";
      return {
        id: s.id,
        status: s.syncPending || s.status === "PROVISIONING" ? "PENDING" : s.expiresAt <= now ? "EXPIRED" : s.trafficLimitBytes && s.trafficUsedBytes >= s.trafficLimitBytes ? "TRAFFIC_LIMIT" : s.node.status === "DISABLED" ? "DISABLED" : "ACTIVE",
        nodeOnline: s.node.status === "ONLINE",
        canRenew: isWebPanel(s.node.protocol) && s.status === "ACTIVE" && s.node.status !== "DISABLED" && !!s.singboxTariff?.enabled && !s.syncPending,
        subscriptionLink: link,
        expiresAt: s.expiresAt.toISOString(),
        trafficLimitBytes: s.trafficLimitBytes?.toString() ?? null,
        trafficUsedBytes: s.trafficUsedBytes.toString(),
        protocol: s.node.protocol ?? "VLESS",
      };
    }),
  });
});
