import express, { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { getRemnaCapabilities } from "../remna/remna-capabilities.js";
import { getSystemConfig, invalidateSystemConfigCache } from "../client/client.service.js";
import {
  isRemnaConfigured,
  remnaCreateConfigProfile,
  remnaCreateHost,
  remnaCreateInfraBillingNode,
  remnaCreateInfraProvider,
  remnaCreateInternalSquad,
  remnaCreateNode,
  remnaDeleteAllUserDevices,
  remnaDeleteConfigProfile,
  remnaDeleteHost,
  remnaDeleteInfraBillingNode,
  remnaDeleteInfraProvider,
  remnaDeleteInternalSquad,
  remnaDeleteNode,
  remnaDeleteNodePlugin,
  remnaDeleteUserDevice,
  remnaDisableNode,
  remnaDropConnections,
  remnaEnableNode,
  remnaGetBandwidthStats,
  remnaGetConfigProfiles,
  remnaGetExternalSquads,
  remnaGetHosts,
  remnaGetHostTags,
  remnaGetHwidStats,
  remnaGetHwidTopUsers,
  remnaGetInfraBillingNodes,
  remnaGetInfraProviders,
  remnaGetInternalSquads,
  remnaGetNodePlugins,
  remnaGetNodes,
  remnaGetNodesMetrics,
  remnaGetNodeUsersUsage,
  remnaGetPubKey,
  remnaGetRecap,
  remnaGetSquadAccessibleNodes,
  remnaGetSubscriptions,
  remnaGetSubscriptionTemplates,
  remnaGetSubSettings,
  remnaGetSubTemplate,
  remnaGetSubTemplates,
  remnaGetSystemStats,
  remnaGetSystemStatsNodes,
  remnaGetTorrentReports,
  remnaGetTorrentStats,
  remnaGetUserDevices,
  remnaGetUsers,
  remnaHostsBulk,
  remnaResetNodeTraffic,
  remnaRestartAllNodes,
  remnaRestartNode,
  remnaTruncateTorrent,
  remnaUpdateConfigProfile,
  remnaUpdateHost,
  remnaUpdateInfraBillingNode,
  remnaUpdateInternalSquad,
  remnaUpdateNode,
  remnaUpdateNodePlugin,
  remnaUpdateSubSettings,
  remnaUpdateSubTemplate,
  remnaUsersBulkDelete,
  remnaUsersBulkResetTraffic,
  remnaUsersBulkRevoke,
  remnaUsersBulkUpdateSquads,
  testRemnaApiConnection,
} from "../remna/remna.client.js";

export const adminRemnaRouter = Router();

function asyncRoute(
  fn: (req: express.Request, res: express.Response) => Promise<void | express.Response>
) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

adminRemnaRouter.get("/status", (_req, res) => {
  res.json({ configured: isRemnaConfigured() });
});

adminRemnaRouter.get("/users", async (req, res) => {
  const page = req.query.page ? Number(req.query.page) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const result = await remnaGetUsers({ page, limit });
  if (result.error) {
    return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  }
  return res.json(result.data ?? {});
});

adminRemnaRouter.get("/subscriptions", async (req, res) => {
  const page = req.query.page ? Number(req.query.page) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const result = await remnaGetSubscriptions({ page, limit });
  if (result.error) {
    return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  }
  return res.json(result.data ?? {});
});

adminRemnaRouter.get("/subscription-templates", async (_req, res) => {
  const result = await remnaGetSubscriptionTemplates();
  if (result.error) {
    return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  }
  return res.json(result.data ?? {});
});

adminRemnaRouter.get("/squads/internal", asyncRoute(async (_req, res) => {
  const result = await remnaGetInternalSquads();
  if (result.error) {
    return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  }
  return res.json(result.data ?? {});
}));

adminRemnaRouter.get("/squads/external", async (_req, res) => {
  const result = await remnaGetExternalSquads();
  if (result.error) {
    return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  }
  return res.json(result.data ?? {});
});

adminRemnaRouter.get("/system/stats", async (_req, res) => {
  const result = await remnaGetSystemStats();
  if (result.error) {
    return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  }
  return res.json(result.data ?? {});
});

adminRemnaRouter.get("/system/stats/nodes", async (_req, res) => {
  const result = await remnaGetSystemStatsNodes();
  if (result.error) {
    return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  }
  return res.json(result.data ?? {});
});

adminRemnaRouter.get("/nodes", async (_req, res) => {
  const result = await remnaGetNodes();
  if (result.error) {
    return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  }
  return res.json(result.data ?? {});
});

const remnaNodeUuidSchema = z.object({ uuid: z.string().uuid() });

adminRemnaRouter.post("/nodes/:uuid/enable", async (req, res) => {
  const parsed = remnaNodeUuidSchema.safeParse({ uuid: req.params.uuid });
  if (!parsed.success) return res.status(400).json({ message: "Invalid node UUID" });
  const result = await remnaEnableNode(parsed.data.uuid);
  if (result.error) {
    return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  }
  return res.json(result.data ?? { ok: true });
});

adminRemnaRouter.post("/nodes/:uuid/disable", async (req, res) => {
  const parsed = remnaNodeUuidSchema.safeParse({ uuid: req.params.uuid });
  if (!parsed.success) return res.status(400).json({ message: "Invalid node UUID" });
  const result = await remnaDisableNode(parsed.data.uuid);
  if (result.error) {
    return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  }
  return res.json(result.data ?? { ok: true });
});

adminRemnaRouter.post("/nodes/:uuid/restart", async (req, res) => {
  const parsed = remnaNodeUuidSchema.safeParse({ uuid: req.params.uuid });
  if (!parsed.success) return res.status(400).json({ message: "Invalid node UUID" });
  const result = await remnaRestartNode(parsed.data.uuid);
  if (result.error) {
    return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  }
  return res.json(result.data ?? { ok: true });
});

// ─── Ноды: CRUD + config-профили (Remnawave 2.8.x) ───
const remnaNodeCreateSchema = z.object({
  name: z.string().min(3),
  address: z.string().min(1),
  port: z.number().int().optional(),
  countryCode: z.string().optional(),
  consumptionMultiplier: z.number().optional(),
  trafficLimitBytes: z.number().optional(),
  notifyPercent: z.number().optional(),
  trafficResetDay: z.number().int().optional(),
  isTrafficTrackingActive: z.boolean().optional(),
  note: z.string().optional(),
  configProfile: z.object({
    activeConfigProfileUuid: z.string().uuid(),
    activeInbounds: z.array(z.string().uuid()),
  }),
});
const remnaNodeUpdateSchema = remnaNodeCreateSchema.partial();

adminRemnaRouter.get("/config-profiles", async (_req, res) => {
  const result = await remnaGetConfigProfiles();
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? {});
});

// Публичный ключ панели (SSL_CERT) для install-команды новой ноды.
adminRemnaRouter.get("/pubkey", async (_req, res) => {
  const result = await remnaGetPubKey();
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? {});
});

// Топ-пользователи по трафику на конкретной ноде за период (bandwidth-статы 2.8.0).
adminRemnaRouter.get("/nodes/:uuid/users-usage", async (req, res) => {
  const idp = remnaNodeUuidSchema.safeParse({ uuid: req.params.uuid });
  if (!idp.success) return res.status(400).json({ message: "Invalid node UUID" });
  const days = Math.min(Math.max(parseInt(req.query.days as string) || 7, 1), 90);
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const result = await remnaGetNodeUsersUsage(idp.data.uuid, fmt(start), fmt(end), 50);
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? {});
});

adminRemnaRouter.post("/nodes/restart-all", async (_req, res) => {
  const result = await remnaRestartAllNodes();
  if (result.error) return res.status(result.status >= 400 ? result.status : 502).json({ message: result.error });
  return res.json(result.data ?? { ok: true });
});

adminRemnaRouter.post("/nodes/:uuid/reset-traffic", async (req, res) => {
  const result = await remnaResetNodeTraffic(req.params.uuid);
  if (result.error) return res.status(result.status >= 400 ? result.status : 502).json({ message: result.error });
  return res.json(result.data ?? { ok: true });
});

adminRemnaRouter.get("/system/bandwidth", async (_req, res) => {
  const result = await remnaGetBandwidthStats();
  if (result.error) return res.status(result.status >= 400 ? result.status : 502).json({ message: result.error });
  return res.json(result.data);
});

adminRemnaRouter.get("/infra-billing/nodes", async (_req, res) => {
  const result = await remnaGetInfraBillingNodes();
  if (result.error) return res.status(result.status >= 400 ? result.status : 502).json({ message: result.error });
  return res.json(result.data);
});

const remnaPass = (result: { error?: string | null; status: number; data?: unknown }, res: import("express").Response, fallback?: unknown) => {
  if (result.error) return res.status(result.status >= 400 ? result.status : 502).json({ message: result.error });
  return res.json(result.data ?? fallback ?? { ok: true });
};

adminRemnaRouter.get("/infra-billing/providers", async (_req, res) => remnaPass(await remnaGetInfraProviders(), res));
adminRemnaRouter.post("/infra-billing/providers", async (req, res) => remnaPass(await remnaCreateInfraProvider(req.body), res));
adminRemnaRouter.delete("/infra-billing/providers/:uuid", async (req, res) => remnaPass(await remnaDeleteInfraProvider(req.params.uuid), res));
adminRemnaRouter.post("/infra-billing/nodes", async (req, res) => remnaPass(await remnaCreateInfraBillingNode(req.body), res));
adminRemnaRouter.patch("/infra-billing/nodes", async (req, res) => remnaPass(await remnaUpdateInfraBillingNode(req.body), res));
adminRemnaRouter.delete("/infra-billing/nodes/:uuid", async (req, res) => remnaPass(await remnaDeleteInfraBillingNode(req.params.uuid), res));
/**
 * POST /api/admin/remna/test-connection
 * Проверка связи с Remnawave API (переданными или текущими реквизитами)
 */
adminRemnaRouter.post("/test-connection", asyncRoute(async (req, res) => {
  const body = z.object({
    apiUrl: z.string().url().max(1000).refine(value => /^https?:\/\//.test(value)).optional(),
    adminToken: z.string().max(5000).optional(),
    secretKey: z.string().max(1000).optional(),
  }).safeParse(req.body ?? {});
  if (!body.success) return res.status(400).json({ message: "Неверные настройки подключения" });
  await getSystemConfig();
  const result = await testRemnaApiConnection(body.data);
  return res.json(result);
}));

/**
 * POST /api/admin/remna/reset-config
 * Сброс настроек Remnawave к значениям из .env
 */
adminRemnaRouter.post("/reset-config", asyncRoute(async (_req, res) => {
  await prisma.systemSetting.deleteMany({
    where: { key: { in: ["remna_api_url", "remna_admin_token", "remna_secret_key"] } },
  });
  invalidateSystemConfigCache();
  await getSystemConfig();
  return res.json({ ok: true });
}));

adminRemnaRouter.get("/subscription-settings", async (_req, res) => remnaPass(await remnaGetSubSettings(), res));
adminRemnaRouter.patch("/subscription-settings", async (req, res) => remnaPass(await remnaUpdateSubSettings(req.body), res));
adminRemnaRouter.get("/user-devices/:uuid", async (req, res) => remnaPass(await remnaGetUserDevices(req.params.uuid), res));
adminRemnaRouter.post("/user-devices/:uuid/delete", async (req, res) => remnaPass(await remnaDeleteUserDevice(req.params.uuid, req.body?.hwid), res));
adminRemnaRouter.post("/user-devices/:uuid/delete-all", async (req, res) => remnaPass(await remnaDeleteAllUserDevices(req.params.uuid), res));
adminRemnaRouter.get("/squads/:uuid/accessible-nodes", async (req, res) => remnaPass(await remnaGetSquadAccessibleNodes(req.params.uuid), res));
adminRemnaRouter.delete("/torrent/truncate", async (_req, res) => remnaPass(await remnaTruncateTorrent(), res));

adminRemnaRouter.get("/hosts/tags", async (_req, res) => remnaPass(await remnaGetHostTags(), res));
adminRemnaRouter.post("/users/bulk/:action", async (req, res) => {
  const uuids: string[] = Array.isArray(req.body?.uuids) ? req.body.uuids : [];
  const a = req.params.action;
  if (a === "reset-traffic") return remnaPass(await remnaUsersBulkResetTraffic(uuids), res);
  if (a === "revoke") return remnaPass(await remnaUsersBulkRevoke(uuids), res);
  if (a === "delete") return remnaPass(await remnaUsersBulkDelete(uuids), res);
  if (a === "update-squads") return remnaPass(await remnaUsersBulkUpdateSquads(uuids, Array.isArray(req.body?.activeInternalSquads) ? req.body.activeInternalSquads : []), res);
  return res.status(400).json({ message: "bad action" });
});
adminRemnaRouter.get("/node-plugins", async (_req, res) => remnaPass(await remnaGetNodePlugins(), res));
adminRemnaRouter.delete("/node-plugins/:uuid", async (req, res) => remnaPass(await remnaDeleteNodePlugin(req.params.uuid), res));
adminRemnaRouter.patch("/node-plugins", async (req, res) => remnaPass(await remnaUpdateNodePlugin(req.body), res));

adminRemnaRouter.get("/sub-templates", async (_req, res) => remnaPass(await remnaGetSubTemplates(), res));
adminRemnaRouter.get("/sub-templates/:uuid", async (req, res) => remnaPass(await remnaGetSubTemplate(req.params.uuid), res));
adminRemnaRouter.patch("/sub-templates", async (req, res) => remnaPass(await remnaUpdateSubTemplate(req.body), res));
adminRemnaRouter.get("/hwid/stats", async (_req, res) => remnaPass(await remnaGetHwidStats(), res));
adminRemnaRouter.get("/hwid/top-users", async (_req, res) => remnaPass(await remnaGetHwidTopUsers(), res));
adminRemnaRouter.get("/recap", async (_req, res) => remnaPass(await remnaGetRecap(), res));
adminRemnaRouter.post("/hosts/bulk/:action", async (req, res) => {
  const action = req.params.action;
  if (action !== "enable" && action !== "disable" && action !== "delete") return res.status(400).json({ message: "bad action" });
  return remnaPass(await remnaHostsBulk(action, Array.isArray(req.body?.uuids) ? req.body.uuids : []), res);
});
adminRemnaRouter.get("/torrent/reports", async (req, res) => remnaPass(await remnaGetTorrentReports({ start: Number(req.query.start) || 0, size: Number(req.query.size) || 50 }), res));
adminRemnaRouter.get("/torrent/stats", async (_req, res) => remnaPass(await remnaGetTorrentStats(), res));
/**
 * Что умеет подключённая Remnawave. Фронт по этому ответу прячет блоки,
 * которых в 3.x больше нет (гео-карта на /api/ip-control, ссылки happ://).
 */
adminRemnaRouter.get("/capabilities", async (_req, res) => {
  res.json(await getRemnaCapabilities());
});

adminRemnaRouter.post("/drop-connections", async (req, res) => remnaPass(await remnaDropConnections(req.body?.dropBy), res));

adminRemnaRouter.get("/nodes-metrics", async (_req, res) => {
  const result = await remnaGetNodesMetrics();
  if (result.error) return res.status(result.status >= 400 ? result.status : 502).json({ message: result.error });
  return res.json(result.data);
});

adminRemnaRouter.post("/nodes", async (req, res) => {
  const parsed = remnaNodeCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Неверные данные ноды", errors: parsed.error.flatten() });
  const result = await remnaCreateNode(parsed.data);
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? { ok: true });
});

adminRemnaRouter.patch("/nodes/:uuid", async (req, res) => {
  const idp = remnaNodeUuidSchema.safeParse({ uuid: req.params.uuid });
  if (!idp.success) return res.status(400).json({ message: "Invalid node UUID" });
  const bodyp = remnaNodeUpdateSchema.safeParse(req.body ?? {});
  if (!bodyp.success) return res.status(400).json({ message: "Неверные данные", errors: bodyp.error.flatten() });
  const result = await remnaUpdateNode({ uuid: idp.data.uuid, ...bodyp.data });
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? { ok: true });
});

adminRemnaRouter.delete("/nodes/:uuid", async (req, res) => {
  const idp = remnaNodeUuidSchema.safeParse({ uuid: req.params.uuid });
  if (!idp.success) return res.status(400).json({ message: "Invalid node UUID" });
  const result = await remnaDeleteNode(idp.data.uuid);
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? { ok: true });
});

// ─── Сквады (internal): CRUD ───
const remnaSquadCreateSchema = z.object({ name: z.string().min(1), inbounds: z.array(z.string().uuid()) });
adminRemnaRouter.post("/squads/internal", async (req, res) => {
  const parsed = remnaSquadCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Неверные данные сквада", errors: parsed.error.flatten() });
  const result = await remnaCreateInternalSquad(parsed.data);
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? { ok: true });
});
adminRemnaRouter.patch("/squads/internal/:uuid", async (req, res) => {
  const idp = remnaNodeUuidSchema.safeParse({ uuid: req.params.uuid });
  if (!idp.success) return res.status(400).json({ message: "Invalid squad UUID" });
  const b = (req.body ?? {}) as { name?: string; inbounds?: string[] };
  const result = await remnaUpdateInternalSquad({ uuid: idp.data.uuid, ...b });
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? { ok: true });
});
adminRemnaRouter.delete("/squads/internal/:uuid", async (req, res) => {
  const idp = remnaNodeUuidSchema.safeParse({ uuid: req.params.uuid });
  if (!idp.success) return res.status(400).json({ message: "Invalid squad UUID" });
  const result = await remnaDeleteInternalSquad(idp.data.uuid);
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? { ok: true });
});

// ─── Хосты: CRUD ───
adminRemnaRouter.get("/hosts", async (_req, res) => {
  const result = await remnaGetHosts();
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? {});
});
adminRemnaRouter.post("/hosts", async (req, res) => {
  if (typeof req.body !== "object" || req.body === null) return res.status(400).json({ message: "Тело хоста обязательно" });
  const result = await remnaCreateHost(req.body as Record<string, unknown>);
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? { ok: true });
});
adminRemnaRouter.patch("/hosts/:uuid", async (req, res) => {
  const idp = remnaNodeUuidSchema.safeParse({ uuid: req.params.uuid });
  if (!idp.success) return res.status(400).json({ message: "Invalid host UUID" });
  const result = await remnaUpdateHost({ uuid: idp.data.uuid, ...((req.body ?? {}) as Record<string, unknown>) });
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? { ok: true });
});
adminRemnaRouter.delete("/hosts/:uuid", async (req, res) => {
  const idp = remnaNodeUuidSchema.safeParse({ uuid: req.params.uuid });
  if (!idp.success) return res.status(400).json({ message: "Invalid host UUID" });
  const result = await remnaDeleteHost(idp.data.uuid);
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? { ok: true });
});

// ─── Config-профили: CRUD (GET есть выше) ───
const remnaProfileCreateSchema = z.object({ name: z.string().min(1), config: z.any() });
adminRemnaRouter.post("/config-profiles", async (req, res) => {
  const parsed = remnaProfileCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Неверные данные профиля", errors: parsed.error.flatten() });
  const result = await remnaCreateConfigProfile(parsed.data);
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? { ok: true });
});
adminRemnaRouter.patch("/config-profiles/:uuid", async (req, res) => {
  const idp = remnaNodeUuidSchema.safeParse({ uuid: req.params.uuid });
  if (!idp.success) return res.status(400).json({ message: "Invalid profile UUID" });
  const b = (req.body ?? {}) as { name?: string; config?: unknown };
  const result = await remnaUpdateConfigProfile({ uuid: idp.data.uuid, ...b });
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? { ok: true });
});
adminRemnaRouter.delete("/config-profiles/:uuid", async (req, res) => {
  const idp = remnaNodeUuidSchema.safeParse({ uuid: req.params.uuid });
  if (!idp.success) return res.status(400).json({ message: "Invalid profile UUID" });
  const result = await remnaDeleteConfigProfile(idp.data.uuid);
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? { ok: true });
});
