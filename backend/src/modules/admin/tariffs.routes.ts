import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";

export const adminTariffsRouter = Router();

/** Сериализация тарифа для JSON (BigInt → number) с опциями цен. */
export function tariffToJson(t: {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  durationDays: number;
  internalSquadUuids: string[];
  trafficLimitBytes: bigint | null;
  trafficResetMode: string;
  deviceLimit: number | null;
  includedDevices: number;
  pricePerExtraDevice: number;
  maxExtraDevices: number;
  deviceDiscountTiers: unknown;
  price: number;
  currency: string;
  sortOrder: number;
  lavatopOfferId?: string | null;
  locations?: string | null; // T11+T12 (11.05.2026)
  menuEmoji?: string | null; // T16 (12.05.2026) — эмодзи в главном меню бота
  purchaseCooldownDays?: number | null; // T-cooldown (13.05.2026) — кулдаун покупки тарифа в днях
  createdAt: Date;
  updatedAt: Date;
  priceOptions?: { id: string; durationDays: number; price: number; sortOrder: number }[];
}) {
  return {
    id: t.id,
    categoryId: t.categoryId,
    name: t.name,
    description: t.description ?? null,
    durationDays: t.durationDays,
    internalSquadUuids: t.internalSquadUuids,
    trafficLimitBytes: t.trafficLimitBytes != null ? Number(t.trafficLimitBytes) : null,
    trafficResetMode: t.trafficResetMode,
    deviceLimit: t.deviceLimit,
    includedDevices: t.includedDevices,
    pricePerExtraDevice: t.pricePerExtraDevice,
    maxExtraDevices: t.maxExtraDevices,
    deviceDiscountTiers: Array.isArray(t.deviceDiscountTiers)
      ? (t.deviceDiscountTiers as { minExtraDevices: number; discountPercent: number }[])
      : [],
    price: t.price,
    currency: t.currency,
    sortOrder: t.sortOrder,
    lavatopOfferId: t.lavatopOfferId ?? null,
    // T11+T12 (11.05.2026) — для админки чтобы загружать в textarea при редактировании.
    locations: t.locations ?? null,
    // T16 (12.05.2026) — эмодзи-префикс в главном меню бота перед названием подписки.
    menuEmoji: t.menuEmoji ?? null,
    // T-cooldown (13.05.2026) — кулдаун покупки тарифа в днях (null = без ограничения).
    purchaseCooldownDays: t.purchaseCooldownDays ?? null,
    priceOptions: (t.priceOptions ?? []).map((o) => ({
      id: o.id,
      durationDays: o.durationDays,
      price: o.price,
      sortOrder: o.sortOrder,
    })),
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

// ——— Тарифы ———
const tariffIdSchema = z.object({ id: z.string().min(1) });
// добавлен "carry_over" — перенос остатка трафика.
const TRAFFIC_RESET_MODES = ["no_reset", "carry_over", "on_purchase", "monthly", "monthly_rolling"] as const;
const priceOptionInputSchema = z.object({
  durationDays: z.number().int().min(1).max(3650),
  price: z.number().min(0),
});
// Лесенка скидок за число ДОП. устройств: {minExtraDevices, discountPercent}.
const deviceDiscountTierSchema = z.object({
  minExtraDevices: z.number().int().min(1).max(100),
  discountPercent: z.number().min(0).max(90),
});
const createTariffSchema = z.object({
  categoryId: z.string().min(1),
  name: z.string().min(1).max(255),
  description: z.string().max(5000).nullable().optional(),
  durationDays: z.number().int().min(1).max(3650).optional(), // legacy: будет проигнорирован если priceOptions заданы
  internalSquadUuids: z.array(z.string().uuid()).min(1),
  trafficLimitBytes: z.number().int().nonnegative().nullable().optional(),
  trafficResetMode: z.enum(TRAFFIC_RESET_MODES).optional(),
  deviceLimit: z.number().int().nonnegative().nullable().optional(),
  includedDevices: z.number().int().min(1).max(100).optional(),
  pricePerExtraDevice: z.number().min(0).optional(),
  maxExtraDevices: z.number().int().min(0).max(100).optional(),
  deviceDiscountTiers: z.array(deviceDiscountTierSchema).max(20).optional(),
  price: z.number().min(0).optional(), // legacy: используется как fallback если priceOptions не заданы
  currency: z.string().max(10).optional(),
  sortOrder: z.number().int().optional(),
  /** UUID оффера в Lava.top для этого тарифа. При оплате через Lava.top создаётся MONTHLY-подписка. */
  lavatopOfferId: z.string().max(200).nullable().optional(),
  /** T11+T12 (11.05.2026) — rich-text список локаций тарифа (для бота кнопка «🌐 Локации»). */
  locations: z.string().max(10000).nullable().optional(),
  /** T16 (12.05.2026) — эмодзи в главном меню бота. */
  menuEmoji: z.string().max(16).nullable().optional(),
  /** T-cooldown (13.05.2026) — кулдаун покупки тарифа (дней). null/0 = без ограничения. */
  purchaseCooldownDays: z.number().int().min(0).max(3650).nullable().optional(),
  priceOptions: z.array(priceOptionInputSchema).min(1).max(20).optional(),
});
const updateTariffSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(5000).nullable().optional(),
  durationDays: z.number().int().min(1).max(3650).optional(),
  internalSquadUuids: z.array(z.string().uuid()).optional(),
  trafficLimitBytes: z.number().int().nonnegative().nullable().optional(),
  trafficResetMode: z.enum(TRAFFIC_RESET_MODES).optional(),
  deviceLimit: z.number().int().nonnegative().nullable().optional(),
  includedDevices: z.number().int().min(1).max(100).optional(),
  pricePerExtraDevice: z.number().min(0).optional(),
  maxExtraDevices: z.number().int().min(0).max(100).optional(),
  deviceDiscountTiers: z.array(deviceDiscountTierSchema).max(20).optional(),
  price: z.number().min(0).optional(),
  currency: z.string().max(10).optional(),
  lavatopOfferId: z.string().max(200).nullable().optional(),
  /** T11+T12 (11.05.2026) — rich-text список локаций. */
  locations: z.string().max(10000).nullable().optional(),
  /** T16 (12.05.2026) — эмодзи в главном меню бота. */
  menuEmoji: z.string().max(16).nullable().optional(),
  /** T-cooldown (13.05.2026) — кулдаун покупки тарифа (дней). null/0 = без ограничения. */
  purchaseCooldownDays: z.number().int().min(0).max(3650).nullable().optional(),
  sortOrder: z.number().int().optional(),
  priceOptions: z.array(priceOptionInputSchema).min(1).max(20).optional(),
});

adminTariffsRouter.get("/", async (req, res) => {
  const categoryId = req.query.categoryId as string | undefined;
  const where = categoryId ? { categoryId } : {};
  const list = await prisma.tariff.findMany({
    where,
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      priceOptions: { orderBy: [{ sortOrder: "asc" }, { durationDays: "asc" }] },
    },
  });
  return res.json({ items: list.map(tariffToJson) });
});

adminTariffsRouter.post("/", async (req, res) => {
  const body = createTariffSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Неверные данные", errors: body.error.flatten() });
  const category = await prisma.tariffCategory.findUnique({ where: { id: body.data.categoryId } });
  if (!category) return res.status(400).json({ message: "Категория не найдена" });

  // Определяем legacy duration/price из priceOptions если они заданы (минимальная опция = legacy).
  // Это нужно потому что Tariff.durationDays и Tariff.price обязательные поля схемы (NOT NULL).
  let legacyDays = body.data.durationDays;
  let legacyPrice = body.data.price ?? 0;
  if (body.data.priceOptions && body.data.priceOptions.length > 0) {
    const sorted = [...body.data.priceOptions].sort((a, b) => a.price - b.price);
    legacyPrice = sorted[0].price;
    legacyDays = sorted[0].durationDays;
  }
  if (legacyDays == null) {
    return res.status(400).json({ message: "Не указана длительность или опции цен" });
  }

  const created = await prisma.tariff.create({
    data: {
      categoryId: body.data.categoryId,
      name: body.data.name,
      description: body.data.description ?? null,
      durationDays: legacyDays,
      internalSquadUuids: body.data.internalSquadUuids,
      trafficLimitBytes: body.data.trafficLimitBytes != null ? BigInt(body.data.trafficLimitBytes) : null,
      trafficResetMode: body.data.trafficResetMode ?? "no_reset",
      deviceLimit: body.data.deviceLimit ?? null,
      includedDevices: body.data.includedDevices ?? 1,
      pricePerExtraDevice: body.data.pricePerExtraDevice ?? 0,
      maxExtraDevices: body.data.maxExtraDevices ?? 0,
      deviceDiscountTiers: body.data.deviceDiscountTiers ?? [],
      price: legacyPrice,
      currency: (body.data.currency ?? "usd").toLowerCase(),
      sortOrder: body.data.sortOrder ?? 0,
      lavatopOfferId: body.data.lavatopOfferId?.trim() || null,
      // T11+T12 (11.05.2026) — rich-text локаций тарифа.
      locations: body.data.locations?.trim() || null,
      // T16 (12.05.2026) — эмодзи в главном меню бота.
      menuEmoji: body.data.menuEmoji?.trim() || null,
      // T-cooldown (13.05.2026) — кулдаун покупки тарифа (null/0 = без ограничения).
      purchaseCooldownDays: body.data.purchaseCooldownDays && body.data.purchaseCooldownDays > 0
        ? body.data.purchaseCooldownDays
        : null,
      priceOptions: body.data.priceOptions
        ? {
          create: body.data.priceOptions.map((o, idx) => ({
            durationDays: o.durationDays,
            price: o.price,
            sortOrder: idx,
          })),
        }
        : {
          // Если priceOptions не заданы — создаём одну дефолтную из legacy полей
          create: [{ durationDays: legacyDays, price: legacyPrice, sortOrder: 0 }],
        },
    },
    include: { priceOptions: { orderBy: [{ sortOrder: "asc" }, { durationDays: "asc" }] } },
  });
  return res.status(201).json(tariffToJson(created));
});

adminTariffsRouter.patch("/:id", async (req, res) => {
  const idParse = tariffIdSchema.safeParse({ id: req.params.id });
  if (!idParse.success) return res.status(400).json({ message: "Invalid id" });
  const body = updateTariffSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Неверные данные", errors: body.error.flatten() });
  const data: { name?: string; description?: string | null; durationDays?: number; internalSquadUuids?: string[]; trafficLimitBytes?: bigint | null; trafficResetMode?: string; deviceLimit?: number | null; includedDevices?: number; pricePerExtraDevice?: number; maxExtraDevices?: number; deviceDiscountTiers?: { minExtraDevices: number; discountPercent: number }[]; price?: number; currency?: string; sortOrder?: number; lavatopOfferId?: string | null; locations?: string | null; menuEmoji?: string | null; purchaseCooldownDays?: number | null } = {};
  if (body.data.name != null) data.name = body.data.name;
  if (body.data.description !== undefined) data.description = body.data.description ?? null;
  if (body.data.internalSquadUuids != null) data.internalSquadUuids = body.data.internalSquadUuids;
  if (body.data.trafficLimitBytes !== undefined) data.trafficLimitBytes = body.data.trafficLimitBytes != null ? BigInt(body.data.trafficLimitBytes) : null;
  if (body.data.trafficResetMode !== undefined) data.trafficResetMode = body.data.trafficResetMode;
  if (body.data.deviceLimit !== undefined) data.deviceLimit = body.data.deviceLimit ?? null;
  if (body.data.includedDevices !== undefined) data.includedDevices = body.data.includedDevices;
  if (body.data.pricePerExtraDevice !== undefined) data.pricePerExtraDevice = body.data.pricePerExtraDevice;
  if (body.data.maxExtraDevices !== undefined) data.maxExtraDevices = body.data.maxExtraDevices;
  if (body.data.deviceDiscountTiers !== undefined) data.deviceDiscountTiers = body.data.deviceDiscountTiers;
  if (body.data.currency !== undefined) data.currency = body.data.currency.toLowerCase();
  if (body.data.sortOrder != null) data.sortOrder = body.data.sortOrder;
  if (body.data.lavatopOfferId !== undefined) data.lavatopOfferId = body.data.lavatopOfferId?.trim() || null;
  // T11+T12 (11.05.2026) — обновление локаций тарифа.
  if (body.data.locations !== undefined) data.locations = body.data.locations?.trim() || null;
  // T16 (12.05.2026) — обновление эмодзи в главном меню бота.
  if (body.data.menuEmoji !== undefined) data.menuEmoji = body.data.menuEmoji?.trim() || null;
  // T-cooldown (13.05.2026) — обновление кулдауна покупки (null/0 = без ограничения).
  if (body.data.purchaseCooldownDays !== undefined) {
    data.purchaseCooldownDays = body.data.purchaseCooldownDays && body.data.purchaseCooldownDays > 0
      ? body.data.purchaseCooldownDays
      : null;
  }
  // Если priceOptions переданы — синхронизируем legacy поля с минимальной опцией.
  if (body.data.priceOptions && body.data.priceOptions.length > 0) {
    const sorted = [...body.data.priceOptions].sort((a, b) => a.price - b.price);
    data.price = sorted[0].price;
    data.durationDays = sorted[0].durationDays;
  } else {
    // Иначе разрешаем менять legacy поля напрямую (на случай редактирования существующих тарифов).
    if (body.data.durationDays != null) data.durationDays = body.data.durationDays;
    if (body.data.price !== undefined) data.price = body.data.price;
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (body.data.priceOptions && body.data.priceOptions.length > 0) {
      // Полная замена опций цен: удалить старые → создать новые (CASCADE на Payment.tariffPriceOptionId
      // делает SET NULL, существующие платежи сохранятся, но потеряют ссылку).
      await tx.tariffPriceOption.deleteMany({ where: { tariffId: idParse.data.id } });
      await tx.tariffPriceOption.createMany({
        data: body.data.priceOptions.map((o, idx) => ({
          tariffId: idParse.data.id,
          durationDays: o.durationDays,
          price: o.price,
          sortOrder: idx,
        })),
      });
    }
    return tx.tariff.update({
      where: { id: idParse.data.id },
      data,
      include: { priceOptions: { orderBy: [{ sortOrder: "asc" }, { durationDays: "asc" }] } },
    });
  });
  return res.json(tariffToJson(updated));
});

adminTariffsRouter.delete("/:id", async (req, res) => {
  const idParse = tariffIdSchema.safeParse({ id: req.params.id });
  if (!idParse.success) return res.status(400).json({ message: "Invalid id" });
  await prisma.tariff.delete({ where: { id: idParse.data.id } });
  return res.json({ success: true });
});
