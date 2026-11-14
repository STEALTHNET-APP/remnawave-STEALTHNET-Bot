import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { logAdmin } from "../audit/audit.service.js";
import { runTrialCleanup } from "../trial/trial-cleanup.service.js";

export const adminTrialsRouter = Router();

// ─── CRUD для Trial-пресетов ──────────────────
// Каждый триал привязан к одному из тарифов (наследует squads/devices/traffic).
// Длительность задаётся отдельно. Один клиент = одна активация каждого триала.

const trialIdSchema = z.object({ id: z.string().min(1) });

const createTrialSchema = z.object({
  name: z.string().min(1).max(255),
  /** источник: тариф (наследуем сквады/лимиты) ИЛИ standalone (squadUuids). */
  tariffId: z.string().min(1).nullable().optional(),
  /** standalone-триал: сквады напрямую (псевдо-тариф, в каталоге не виден). */
  squadUuids: z.array(z.string().min(1)).max(20).nullable().optional(),
  /** лимит устройств standalone-триала. */
  deviceLimit: z.number().int().min(1).max(100).nullable().optional(),
  price: z.number().finite().min(0).max(1000000).multipleOf(0.01).optional(),
  durationDays: z.number().int().min(1).max(365),
  /** опциональный лимит трафика триала в байтах (null = из тарифа). */
  trafficLimitBytes: z.number().int().nonnegative().nullable().optional(),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  description: z.string().max(2000).nullable().optional(),
  /** можно ли конвертировать триал (false → у подписки нет кнопок вовсе). */
  convertEnabled: z.boolean().optional(),
  /** конвертация в ЛЮБОЙ тариф (перебивает convertTariffIds). */
  convertAllTariffs: z.boolean().optional(),
  /** тарифы, в которые можно конвертировать триал
   *  (переход на их сквады). Пусто/null — только тариф триала. */
  convertTariffIds: z.array(z.string().min(1)).max(50).nullable().optional(),
}).refine((d) => Boolean(d.tariffId) || (d.squadUuids?.length ?? 0) > 0, {
  message: "Укажите тариф ИЛИ сквады standalone-триала",
});

const updateTrialSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  tariffId: z.string().min(1).nullable().optional(),
  squadUuids: z.array(z.string().min(1)).max(20).nullable().optional(),
  deviceLimit: z.number().int().min(1).max(100).nullable().optional(),
  price: z.number().finite().min(0).max(1000000).multipleOf(0.01).optional(),
  durationDays: z.number().int().min(1).max(365).optional(),
  /** опциональный лимит трафика триала в байтах (null = из тарифа). */
  trafficLimitBytes: z.number().int().nonnegative().nullable().optional(),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  description: z.string().max(2000).nullable().optional(),
  convertEnabled: z.boolean().optional(),
  convertAllTariffs: z.boolean().optional(),
  /** тарифы для конвертации триала. */
  convertTariffIds: z.array(z.string().min(1)).max(50).nullable().optional(),
});

function trialToJson(t: {
  id: string;
  name: string;
  tariffId: string | null;
  squadUuids?: string | null;
  deviceLimit?: number | null;
  price: number;
  durationDays: number;
  trafficLimitBytes?: bigint | null;
  enabled: boolean;
  sortOrder: number;
  description: string | null;
  convertEnabled?: boolean;
  convertAllTariffs?: boolean;
  convertTariffIds?: string | null;
  createdAt: Date;
  updatedAt: Date;
  tariff?: { id: string; name: string } | null;
}) {
  // тарифы для конвертации / сквады хранятся JSON-строкой — наружу массивами.
  const parseArr = (raw: string | null | undefined): string[] => {
    try {
      const parsed = raw ? JSON.parse(raw) as unknown : [];
      return Array.isArray(parsed) ? parsed.map((x) => String(x)) : [];
    } catch { return []; }
  };
  return {
    id: t.id,
    name: t.name,
    tariffId: t.tariffId,
    squadUuids: parseArr(t.squadUuids),
    deviceLimit: t.deviceLimit ?? null,
    price: t.price,
    durationDays: t.durationDays,
    // T16 (12.05.2026) — BigInt → number для JSON; null = используется лимит тарифа.
    trafficLimitBytes: t.trafficLimitBytes != null ? Number(t.trafficLimitBytes) : null,
    enabled: t.enabled,
    sortOrder: t.sortOrder,
    description: t.description,
    convertEnabled: t.convertEnabled ?? true,
    convertAllTariffs: t.convertAllTariffs ?? false,
    convertTariffIds: parseArr(t.convertTariffIds),
    tariffName: t.tariff?.name ?? null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

const cleanupNowSchema = z.object({
  dryRun: z.boolean().optional(),
});

adminTrialsRouter.post("/cleanup-now", async (req, res) => {
  const body = cleanupNowSchema.safeParse(req.body ?? {});
  if (!body.success) return res.status(400).json({ message: "Неверные данные", errors: body.error.flatten() });
  try {
    const result = await runTrialCleanup({ dryRun: body.data.dryRun ?? false });
    await logAdmin(req, "trials.cleanup_run", undefined, {
      dryRun: result.dryRun,
      candidateCount: result.candidateCount,
      deletedCount: result.deletedCount,
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error("[trial-cleanup] Manual run failed:", error);
    return res.status(500).json({ message: "Не удалось выполнить очистку" });
  }
});

adminTrialsRouter.get("/", async (_req, res) => {
  const list = await prisma.trial.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: { tariff: { select: { id: true, name: true } } },
  });
  return res.json({ items: list.map(trialToJson) });
});

adminTrialsRouter.post("/", async (req, res) => {
  const body = createTrialSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Неверные данные", errors: body.error.flatten() });
  if (body.data.tariffId) {
    const tariff = await prisma.tariff.findUnique({ where: { id: body.data.tariffId } });
    if (!tariff) return res.status(400).json({ message: "Тариф не найден" });
  }
  const created = await prisma.trial.create({
    data: {
      name: body.data.name,
      tariffId: body.data.tariffId ?? null,
      squadUuids: body.data.squadUuids?.length ? JSON.stringify(body.data.squadUuids) : null,
      deviceLimit: body.data.deviceLimit ?? null,
      price: body.data.price ?? 0,
      durationDays: body.data.durationDays,
      // T16 (12.05.2026) — отдельный лимит трафика триала (null = из тарифа).
      trafficLimitBytes: body.data.trafficLimitBytes != null ? BigInt(body.data.trafficLimitBytes) : null,
      enabled: body.data.enabled ?? true,
      sortOrder: body.data.sortOrder ?? 0,
      description: body.data.description ?? null,
      convertEnabled: body.data.convertEnabled ?? true,
      convertAllTariffs: body.data.convertAllTariffs ?? false,
      convertTariffIds: body.data.convertTariffIds?.length ? JSON.stringify(body.data.convertTariffIds) : null,
    },
    include: { tariff: { select: { id: true, name: true } } },
  });
  return res.status(201).json(trialToJson(created));
});

adminTrialsRouter.patch("/:id", async (req, res) => {
  const idParse = trialIdSchema.safeParse({ id: req.params.id });
  if (!idParse.success) return res.status(400).json({ message: "Invalid id" });
  const body = updateTrialSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Неверные данные", errors: body.error.flatten() });
  if (body.data.tariffId) {
    const tariff = await prisma.tariff.findUnique({ where: { id: body.data.tariffId } });
    if (!tariff) return res.status(400).json({ message: "Тариф не найден" });
  }
  // T16 (12.05.2026) — BigInt из number / null.
  const updateData: {
    name?: string;
    tariffId?: string | null;
    squadUuids?: string | null;
    deviceLimit?: number | null;
    price?: number;
    durationDays?: number;
    trafficLimitBytes?: bigint | null;
    enabled?: boolean;
    sortOrder?: number;
    description?: string | null;
    convertEnabled?: boolean;
    convertAllTariffs?: boolean;
    convertTariffIds?: string | null;
  } = {};
  if (body.data.name !== undefined) updateData.name = body.data.name;
  if (body.data.tariffId !== undefined) updateData.tariffId = body.data.tariffId ?? null;
  if (body.data.squadUuids !== undefined) {
    updateData.squadUuids = body.data.squadUuids?.length ? JSON.stringify(body.data.squadUuids) : null;
  }
  if (body.data.deviceLimit !== undefined) updateData.deviceLimit = body.data.deviceLimit ?? null;
  if (body.data.price !== undefined) updateData.price = body.data.price;
  if (body.data.durationDays !== undefined) updateData.durationDays = body.data.durationDays;
  if (body.data.trafficLimitBytes !== undefined) {
    updateData.trafficLimitBytes = body.data.trafficLimitBytes != null ? BigInt(body.data.trafficLimitBytes) : null;
  }
  if (body.data.enabled !== undefined) updateData.enabled = body.data.enabled;
  if (body.data.sortOrder !== undefined) updateData.sortOrder = body.data.sortOrder;
  if (body.data.description !== undefined) updateData.description = body.data.description ?? null;
  if (body.data.convertEnabled !== undefined) updateData.convertEnabled = body.data.convertEnabled;
  if (body.data.convertAllTariffs !== undefined) updateData.convertAllTariffs = body.data.convertAllTariffs;
  if (body.data.convertTariffIds !== undefined) {
    updateData.convertTariffIds = body.data.convertTariffIds?.length ? JSON.stringify(body.data.convertTariffIds) : null;
  }
  // триал не может остаться без ОБОИХ источников
  // (tariffId и squadUuids) — иначе активация сломается.
  const currentTrial = await prisma.trial.findUnique({
    where: { id: idParse.data.id },
    select: { tariffId: true, squadUuids: true },
  });
  if (!currentTrial) return res.status(404).json({ message: "Триал не найден" });
  const effTariffId = updateData.tariffId !== undefined ? updateData.tariffId : currentTrial.tariffId;
  const effSquads = updateData.squadUuids !== undefined ? updateData.squadUuids : currentTrial.squadUuids;
  if (!effTariffId && !effSquads) {
    return res.status(400).json({ message: "Укажите тариф ИЛИ сквады standalone-триала" });
  }
  const updated = await prisma.trial.update({
    where: { id: idParse.data.id },
    data: updateData,
    include: { tariff: { select: { id: true, name: true } } },
  });
  return res.json(trialToJson(updated));
});

adminTrialsRouter.delete("/:id", async (req, res) => {
  const idParse = trialIdSchema.safeParse({ id: req.params.id });
  if (!idParse.success) return res.status(400).json({ message: "Invalid id" });
  // ON DELETE CASCADE на client_trial_usages — записи использования удалятся автоматически.
  // SecondarySubscription.trial_id (ON DELETE SET NULL) — оставит подписки клиентов живыми.
  await prisma.trial.delete({ where: { id: idParse.data.id } });
  return res.json({ success: true });
});
