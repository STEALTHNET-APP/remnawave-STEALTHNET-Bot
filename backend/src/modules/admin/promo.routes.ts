import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { freeDaysSettings, PromoCodeError } from "../promo-code/free-days.service.js";

export const adminPromoGroupsRouter = Router();
export const adminPromoCodesRouter = Router();

// ——————————————— Промо-группы ———————————————

function generatePromoCode(length = 8): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let code = "";
  for (let i = 0; i < length; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

/** Список промо-групп + статистика активаций */
adminPromoGroupsRouter.get("/", async (_req, res) => {
  const groups = await prisma.promoGroup.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { activations: true } },
    },
  });
  return res.json(groups.map((g) => ({
    ...g,
    trafficLimitBytes: g.trafficLimitBytes.toString(),
    activationsCount: g._count.activations,
  })));
});

/** Одна промо-группа + список активаций */
adminPromoGroupsRouter.get("/:id", async (req, res) => {
  const group = await prisma.promoGroup.findUnique({
    where: { id: req.params.id },
    include: {
      activations: {
        include: {
          client: {
            select: { id: true, email: true, telegramId: true, telegramUsername: true, createdAt: true, remnawaveUuid: true },
          },
        },
        orderBy: { createdAt: "desc" },
      },
      _count: { select: { activations: true } },
    },
  });
  if (!group) return res.status(404).json({ message: "Not found" });
  return res.json({
    ...group,
    trafficLimitBytes: group.trafficLimitBytes.toString(),
    activationsCount: group._count.activations,
  });
});

const createPromoGroupSchema = z.object({
  name: z.string().min(1).max(200),
  squadUuid: z.string().min(1),
  trafficLimitBytes: z.union([z.string(), z.number()]).transform((v) => BigInt(v)),
  deviceLimit: z.number().int().min(0).nullable().optional(),
  durationDays: z.number().int().min(1),
  maxActivations: z.number().int().min(0).default(0),
  isActive: z.boolean().optional(),
});

/** Создать промо-группу */
adminPromoGroupsRouter.post("/", async (req, res) => {
  const parsed = createPromoGroupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Validation error", errors: parsed.error.flatten() });
  const data = parsed.data;

  // Генерируем уникальный код
  let code: string;
  let exists = true;
  do {
    code = generatePromoCode();
    const existing = await prisma.promoGroup.findUnique({ where: { code } });
    exists = !!existing;
  } while (exists);

  const group = await prisma.promoGroup.create({
    data: {
      name: data.name,
      code,
      squadUuid: data.squadUuid,
      trafficLimitBytes: data.trafficLimitBytes,
      deviceLimit: data.deviceLimit ?? null,
      durationDays: data.durationDays,
      maxActivations: data.maxActivations,
      isActive: data.isActive ?? true,
    },
  });
  return res.json({ ...group, trafficLimitBytes: group.trafficLimitBytes.toString() });
});

const updatePromoGroupSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  squadUuid: z.string().min(1).optional(),
  trafficLimitBytes: z.union([z.string(), z.number()]).transform((v) => BigInt(v)).optional(),
  deviceLimit: z.number().int().min(0).nullable().optional(),
  durationDays: z.number().int().min(1).optional(),
  maxActivations: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

/** Обновить промо-группу */
adminPromoGroupsRouter.patch("/:id", async (req, res) => {
  const parsed = updatePromoGroupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Validation error", errors: parsed.error.flatten() });

  const existing = await prisma.promoGroup.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ message: "Not found" });

  const group = await prisma.promoGroup.update({
    where: { id: req.params.id },
    data: parsed.data,
  });
  return res.json({ ...group, trafficLimitBytes: group.trafficLimitBytes.toString() });
});

/** Удалить промо-группу */
adminPromoGroupsRouter.delete("/:id", async (req, res) => {
  const existing = await prisma.promoGroup.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ message: "Not found" });
  await prisma.promoGroup.delete({ where: { id: req.params.id } });
  return res.json({ ok: true });
});

// ——————————————— Промокоды (скидки / бесплатные дни) ———————————————

/** Список промокодов */
adminPromoCodesRouter.get("/", async (_req, res) => {
  const codes = await prisma.promoCode.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { usages: true } } },
  });
  return res.json(codes.map((c) => ({
    ...c,
    trafficLimitBytes: c.trafficLimitBytes?.toString() ?? null,
    usagesCount: c._count.usages,
  })));
});

/** Один промокод + использования */
adminPromoCodesRouter.get("/:id", async (req, res) => {
  const code = await prisma.promoCode.findUnique({
    where: { id: req.params.id },
    include: {
      usages: {
        include: {
          client: {
            select: { id: true, email: true, telegramId: true, telegramUsername: true, createdAt: true, remnawaveUuid: true },
          },
        },
        orderBy: { createdAt: "desc" },
      },
      _count: { select: { usages: true } },
    },
  });
  if (!code) return res.status(404).json({ message: "Not found" });
  return res.json({
    ...code,
    trafficLimitBytes: code.trafficLimitBytes?.toString() ?? null,
    usagesCount: code._count.usages,
  });
});

const createPromoCodeSchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(200),
  type: z.enum(["DISCOUNT", "FREE_DAYS"]),
  discountPercent: z.number().min(0).max(100).nullable().optional(),
  discountFixed: z.number().min(0).nullable().optional(),
  tariffId: z.string().min(1).nullable().optional(),
  tariffPriceOptionId: z.string().min(1).nullable().optional(),
  squadUuid: z.string().nullable().optional(),
  trafficLimitBytes: z.union([z.string(), z.number()]).transform((v) => (v != null ? BigInt(v) : null)).nullable().optional(),
  deviceLimit: z.number().int().min(0).nullable().optional(),
  durationDays: z.number().int().min(1).nullable().optional(),
  maxUses: z.number().int().min(0).default(0),
  maxUsesPerClient: z.number().int().min(1).default(1),
  isActive: z.boolean().optional(),
  expiresAt: z.string().nullable().optional(),
});

/** Создать промокод */
adminPromoCodesRouter.post("/", async (req, res) => {
  const parsed = createPromoCodeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Validation error", errors: parsed.error.flatten() });
  const d = parsed.data;

  // Проверяем уникальность кода
  const exists = await prisma.promoCode.findUnique({ where: { code: d.code } });
  if (exists) return res.status(400).json({ message: "Промокод с таким кодом уже существует" });

  let freeDays = {};
  if (d.type === "FREE_DAYS") {
    try { freeDays = await freeDaysSettings(d); }
    catch (e) { if (e instanceof PromoCodeError) return res.status(e.status).json({ message: e.message }); throw e; }
  }
  const code = await prisma.promoCode.create({
    data: {
      code: d.code,
      name: d.name,
      type: d.type,
      discountPercent: d.type === "DISCOUNT" ? (d.discountPercent ?? null) : null,
      discountFixed: d.type === "DISCOUNT" ? (d.discountFixed ?? null) : null,
      squadUuid: d.type === "FREE_DAYS" ? (d.squadUuid ?? null) : null,
      trafficLimitBytes: d.type === "FREE_DAYS" ? (d.trafficLimitBytes ?? BigInt(0)) : null,
      deviceLimit: d.type === "FREE_DAYS" ? (d.deviceLimit ?? null) : null,
      durationDays: d.type === "FREE_DAYS" ? (d.durationDays ?? null) : null,
      ...freeDays,
      maxUses: d.maxUses,
      maxUsesPerClient: d.maxUsesPerClient,
      isActive: d.isActive ?? true,
      expiresAt: d.expiresAt ? new Date(d.expiresAt) : null,
    },
  });
  return res.json({ ...code, trafficLimitBytes: code.trafficLimitBytes?.toString() ?? null });
});

const updatePromoCodeSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  type: z.enum(["DISCOUNT", "FREE_DAYS"]).optional(),
  discountPercent: z.number().min(0).max(100).nullable().optional(),
  discountFixed: z.number().min(0).nullable().optional(),
  tariffId: z.string().min(1).nullable().optional(),
  tariffPriceOptionId: z.string().min(1).nullable().optional(),
  squadUuid: z.string().nullable().optional(),
  trafficLimitBytes: z.union([z.string(), z.number()]).transform((v) => (v != null ? BigInt(v) : null)).nullable().optional(),
  deviceLimit: z.number().int().min(0).nullable().optional(),
  durationDays: z.number().int().min(1).nullable().optional(),
  maxUses: z.number().int().min(0).optional(),
  maxUsesPerClient: z.number().int().min(1).optional(),
  isActive: z.boolean().optional(),
  expiresAt: z.string().nullable().optional(),
});

/** Обновить промокод */
adminPromoCodesRouter.patch("/:id", async (req, res) => {
  const parsed = updatePromoCodeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Validation error", errors: parsed.error.flatten() });

  const existing = await prisma.promoCode.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ message: "Not found" });

  const data: Record<string, unknown> = { ...parsed.data };
  const merged = { ...existing, ...parsed.data };
  const configChanged = ["type", "tariffId", "tariffPriceOptionId", "durationDays", "squadUuid", "trafficLimitBytes", "deviceLimit"]
    .some((key) => key in parsed.data);
  if (merged.type === "FREE_DAYS" && configChanged) {
    try { Object.assign(data, await freeDaysSettings(merged)); }
    catch (e) { if (e instanceof PromoCodeError) return res.status(e.status).json({ message: e.message }); throw e; }
  } else if (merged.type === "DISCOUNT") {
    Object.assign(data, { tariffId: null, tariffPriceOptionId: null, squadUuid: null, durationDays: null, trafficLimitBytes: null, deviceLimit: null });
  }
  if (data.expiresAt !== undefined) {
    data.expiresAt = data.expiresAt ? new Date(data.expiresAt as string) : null;
  }

  const code = await prisma.promoCode.update({
    where: { id: req.params.id },
    data,
  });
  return res.json({ ...code, trafficLimitBytes: code.trafficLimitBytes?.toString() ?? null });
});

/** Удалить промокод */
adminPromoCodesRouter.delete("/:id", async (req, res) => {
  const existing = await prisma.promoCode.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ message: "Not found" });
  await prisma.promoCode.delete({ where: { id: req.params.id } });
  return res.json({ ok: true });
});
