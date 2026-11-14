import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { tariffToJson } from "./tariffs.routes.js";

export const adminTariffCategoriesRouter = Router();

const tariffCategoryIdSchema = z.object({ id: z.string().min(1) });

adminTariffCategoriesRouter.get("/", async (_req, res) => {
  try {
    const list = await prisma.tariffCategory.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: {
        tariffs: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          include: {
            priceOptions: { orderBy: [{ sortOrder: "asc" }, { durationDays: "asc" }] },
          },
        },
      },
    });
    return res.json({
      items: list.map((c) => ({
        id: c.id,
        name: c.name,
        emojiKey: c.emojiKey ?? null,
        sortOrder: c.sortOrder,
        singleSubscriptionMode: c.singleSubscriptionMode,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
        tariffs: c.tariffs.map(tariffToJson),
      })),
    });
  } catch (e) {
    console.error("GET /tariff-categories error:", e);
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("does not exist") || msg.includes("tariff_categories")) {
      return res.status(503).json({
        message: "Таблицы тарифов не найдены. Выполните в папке backend: npx prisma db push",
      });
    }
    return res.status(500).json({ message: "Ошибка загрузки категорий тарифов", error: msg });
  }
});

const createTariffCategorySchema = z.object({
  name: z.string().min(1).max(255),
  sortOrder: z.number().int().optional(),
  emojiKey: z.string().max(32).optional().nullable(),
  singleSubscriptionMode: z.boolean().optional(),
});
const updateTariffCategorySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  sortOrder: z.number().int().optional(),
  emojiKey: z.string().max(32).optional().nullable(),
  singleSubscriptionMode: z.boolean().optional(),
});

adminTariffCategoriesRouter.post("/", async (req, res) => {
  const body = createTariffCategorySchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Неверные данные", errors: body.error.flatten() });
  const created = await prisma.tariffCategory.create({
    data: {
      name: body.data.name,
      sortOrder: body.data.sortOrder ?? 0,
      emojiKey: body.data.emojiKey ?? undefined,
      singleSubscriptionMode: body.data.singleSubscriptionMode ?? false,
    },
  });
  return res.status(201).json({
    id: created.id,
    name: created.name,
    emojiKey: created.emojiKey,
    sortOrder: created.sortOrder,
    singleSubscriptionMode: created.singleSubscriptionMode,
    createdAt: created.createdAt.toISOString(),
    updatedAt: created.updatedAt.toISOString(),
  });
});

adminTariffCategoriesRouter.patch("/:id", async (req, res) => {
  const idParse = tariffCategoryIdSchema.safeParse({ id: req.params.id });
  if (!idParse.success) return res.status(400).json({ message: "Invalid id" });
  const body = updateTariffCategorySchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Неверные данные", errors: body.error.flatten() });
  const data: { name?: string; sortOrder?: number; emojiKey?: string | null; singleSubscriptionMode?: boolean } = {};
  if (body.data.name !== undefined) data.name = body.data.name;
  if (body.data.sortOrder !== undefined) data.sortOrder = body.data.sortOrder;
  if (body.data.emojiKey !== undefined) data.emojiKey = body.data.emojiKey;
  if (body.data.singleSubscriptionMode !== undefined) data.singleSubscriptionMode = body.data.singleSubscriptionMode;
  const updated = await prisma.tariffCategory.update({
    where: { id: idParse.data.id },
    data,
  });
  return res.json({
    id: updated.id,
    name: updated.name,
    emojiKey: updated.emojiKey,
    sortOrder: updated.sortOrder,
    singleSubscriptionMode: updated.singleSubscriptionMode,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  });
});

adminTariffCategoriesRouter.delete("/:id", async (req, res) => {
  const idParse = tariffCategoryIdSchema.safeParse({ id: req.params.id });
  if (!idParse.success) return res.status(400).json({ message: "Invalid id" });
  await prisma.tariffCategory.delete({ where: { id: idParse.data.id } });
  return res.json({ success: true });
});
