import express, { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import { remnaGetUser, remnaUpdateUser, remnaDeleteUser, isRemnaConfigured } from "../remna/remna.client.js";

export const adminSecondarySubscriptionsRouter = Router();

function asyncRoute(
  fn: (req: express.Request, res: express.Response) => Promise<void | express.Response>
) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

// ────── Secondary Subscriptions Admin API ──────

adminSecondarySubscriptionsRouter.get("/", asyncRoute(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const skip = (page - 1) * limit;
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const giftStatus = typeof req.query.giftStatus === "string" ? req.query.giftStatus : "";
  const dateFrom = typeof req.query.dateFrom === "string" ? req.query.dateFrom : "";
  const dateTo = typeof req.query.dateTo === "string" ? req.query.dateTo : "";
  const sortBy = typeof req.query.sortBy === "string" ? req.query.sortBy : "createdAt";
  const sortDir = req.query.sortDir === "asc" ? "asc" as const : "desc" as const;

  const where: Prisma.SubscriptionWhereInput = {};
  const conditions: Prisma.SubscriptionWhereInput[] = [];

  // Gift status filter
  if (giftStatus === "owned") {
    conditions.push({
      OR: [
        { giftStatus: null, giftedToClientId: null },
        { giftStatus: "", giftedToClientId: null },
        { giftStatus: "ACTIVATED_SELF" },
      ],
    });
  } else if (giftStatus === "null") {
    conditions.push({
      OR: [
        { giftStatus: null, giftedToClientId: null },
        { giftStatus: "", giftedToClientId: null },
      ],
    });
  } else if (giftStatus === "ACTIVATED_SELF") {
    conditions.push({ giftStatus: "ACTIVATED_SELF" });
  } else if (giftStatus === "GIFT_RESERVED" || giftStatus === "GIFT_CODE_ACTIVE" || giftStatus === "GIFTED") {
    conditions.push({ giftStatus });
  }

  // Search by owner email/telegramUsername/telegramId
  // старая реализация фильтровала через nested relation:
  //   { owner: { telegramUsername: { contains, mode: "insensitive" } } }
  // В нашем Prisma (6.19.2) этот паттерн с mode:"insensitive" в nested relation
  // молча возвращал 0 строк (баг проявлялся не для всех клиентов). Сейчас сначала
  // резолвим matching client IDs отдельным запросом — этот же синтаксис на
  // ТОП-уровне (как в /admin/clients) работает надёжно — а потом фильтруем
  // subscriptions по `ownerId in (..)` или `giftedToClientId in (..)`.
  if (search.length > 0) {
    const matchedClients = await prisma.client.findMany({
      where: {
        OR: [
          { id: { equals: search } },
          { email: { contains: search, mode: "insensitive" as const } },
          { telegramUsername: { contains: search, mode: "insensitive" as const } },
          { telegramId: { contains: search } },
        ],
      },
      select: { id: true },
      take: 500,
    });
    const matchedClientIds = matchedClients.map((c) => c.id);
    conditions.push({
      OR: [
        ...(matchedClientIds.length > 0
          ? [
              { ownerId: { in: matchedClientIds } },
              { giftedToClientId: { in: matchedClientIds } },
              // поиск по ОТПРАВИТЕЛЮ подарка —
              // подписки, у которых gift-код создан этим клиентом (username/tgid/email/id).
              { giftCodes: { some: { creatorId: { in: matchedClientIds } } } },
            ]
          : []),
        { remnawaveUuid: { contains: search } },
        { id: { contains: search } },
        // поиск по ПОДАРОЧНОМУ КОДУ (XXXX-XXXX-XXXX).
        { giftCodes: { some: { code: { contains: search, mode: "insensitive" as const } } } },
      ],
    });
  }

  // Date range filter
  if (dateFrom) {
    const d = new Date(dateFrom);
    if (!isNaN(d.getTime())) conditions.push({ createdAt: { gte: d } });
  }
  if (dateTo) {
    const d = new Date(dateTo);
    if (!isNaN(d.getTime())) conditions.push({ createdAt: { lte: d } });
  }

  if (conditions.length > 0) where.AND = conditions;

  // Determine orderBy
  const allowedSorts: Record<string, Prisma.SubscriptionOrderByWithRelationInput> = {
    createdAt: { createdAt: sortDir },
    updatedAt: { updatedAt: sortDir },
    subscriptionIndex: { subscriptionIndex: sortDir },
  };
  const orderBy = allowedSorts[sortBy] ?? { createdAt: sortDir };

  const [items, total] = await Promise.all([
    prisma.subscription.findMany({
      where,
      skip,
      take: limit,
      orderBy,
      include: {
        owner: {
          select: { id: true, email: true, telegramId: true, telegramUsername: true },
        },
        giftedToClient: {
          select: { id: true, email: true, telegramId: true, telegramUsername: true },
        },
        tariff: {
          select: { id: true, name: true, durationDays: true, price: true },
        },
        giftCodes: {
          select: {
            id: true,
            code: true,
            status: true,
            giftMessage: true,
            expiresAt: true,
            redeemedAt: true,
            createdAt: true,
            redeemedBy: { select: { id: true, email: true, telegramUsername: true } },
            // для отображения «отправителя» в админке.
            creator: { select: { id: true, email: true, telegramUsername: true } },
            createdByAdmin: true,
            createdByAdminId: true,
          },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    }),
    prisma.subscription.count({ where }),
  ]);

  // резолвим имена админов одним batch-запросом — не дёргаем БД в цикле.
  const adminIds = Array.from(new Set(items.map((s) => s.giftCodes[0]?.createdByAdminId).filter((v): v is string => !!v)));
  const adminsMap: Record<string, { id: string; email: string }> = {};
  if (adminIds.length > 0) {
    const admins = await prisma.admin.findMany({
      where: { id: { in: adminIds } },
      select: { id: true, email: true },
    });
    for (const a of admins) adminsMap[a.id] = a;
  }

  return res.json({
    items: items.map((s) => {
      const lastCode = s.giftCodes[0] ?? null;
      // отправитель — это:
      //   • Конкретный админ из admins-таблицы (по createdByAdminId) → префикс 👑.
      //   • Если createdByAdmin=true но adminId не сохранён (legacy) → «👑 Администратор».
      //   • Иначе клиент-даритель из creator gift code.
      const isAdminGift = lastCode?.createdByAdmin === true;
      let giftSender: { id: string; email: string | null; telegramUsername: string | null; isAdmin: boolean } | null = null;
      if (isAdminGift) {
        const adminEntry = lastCode?.createdByAdminId ? adminsMap[lastCode.createdByAdminId] : null;
        if (adminEntry) {
          giftSender = { id: adminEntry.id, email: adminEntry.email, telegramUsername: null, isAdmin: true };
        } else {
          giftSender = { id: "admin", email: null, telegramUsername: "Администратор", isAdmin: true };
        }
      } else if (lastCode?.creator) {
        giftSender = { ...lastCode.creator, isAdmin: false };
      }
      return {
        ...s,
        latestGiftCode: lastCode,
        giftSender,
        giftCodes: undefined,
      };
    }),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
}));

adminSecondarySubscriptionsRouter.get("/:id", asyncRoute(async (req, res) => {
  const sub = await prisma.subscription.findUnique({
    where: { id: req.params.id },
    include: {
      owner: {
        select: { id: true, email: true, telegramId: true, telegramUsername: true },
      },
      giftedToClient: {
        select: { id: true, email: true, telegramId: true, telegramUsername: true },
      },
      tariff: {
        select: { id: true, name: true, durationDays: true, price: true, category: true },
      },
      giftCodes: {
        select: {
          id: true,
          code: true,
          status: true,
          giftMessage: true,
          expiresAt: true,
          redeemedAt: true,
          createdAt: true,
          creator: { select: { id: true, email: true, telegramUsername: true } },
          redeemedBy: { select: { id: true, email: true, telegramUsername: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!sub) return res.status(404).json({ message: "Подписка не найдена" });

  // Fetch Remnawave data if UUID exists
  let remnaData: Record<string, unknown> | null = null;
  if (sub.remnawaveUuid && isRemnaConfigured()) {
    try {
      const r = await remnaGetUser(sub.remnawaveUuid);
      if (!r.error && r.data) {
        const raw = r.data as Record<string, unknown>;
        remnaData = (raw.response ?? raw) as Record<string, unknown>;
      }
    } catch { /* skip */ }
  }

  // Fetch history
  const history = await prisma.giftHistory.findMany({
    where: { subscriptionId: sub.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return res.json({ ...sub, remnaData, history });
}));

// PATCH доп. подписки админом — менять дни и лимит трафика.
// addDays: положительное → продлить (от текущего expireAt или now если истекла),
//          отрицательное → сократить срок.
// trafficLimitBytes: 0 → безлимит, число > 0 → конкретный лимит, null → не менять.
// Изменения пишутся в Remnawave (PATCH user) + лог в gift_history.
const editSecondarySubSchema = z.object({
  addDays: z.number().int().min(-3650).max(3650).optional(),
  trafficLimitBytes: z.number().int().min(0).nullable().optional(),
});
adminSecondarySubscriptionsRouter.patch("/:id", asyncRoute(async (req, res) => {
  const parsed = editSecondarySubSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Неверные данные", errors: parsed.error.flatten() });
  if (parsed.data.addDays == null && parsed.data.trafficLimitBytes === undefined) {
    return res.status(400).json({ message: "Нужно указать хотя бы одно поле для изменения" });
  }
  const sub = await prisma.subscription.findUnique({
    where: { id: req.params.id },
    select: { id: true, remnawaveUuid: true, ownerId: true },
  });
  if (!sub) return res.status(404).json({ message: "Подписка не найдена" });
  if (!sub.remnawaveUuid) return res.status(400).json({ message: "Подписка не привязана к Remnawave" });
  if (!isRemnaConfigured()) return res.status(503).json({ message: "Remnawave не настроен" });

  // Читаем текущее состояние user в Remna — нам нужен expireAt для расчёта.
  const userRes = await remnaGetUser(sub.remnawaveUuid);
  if (userRes.error || !userRes.data) {
    return res.status(404).json({ message: "Пользователь Remnawave не найден" });
  }
  const inner = (userRes.data as Record<string, unknown>) ?? {};
  const responseObj = (inner.response ?? inner.data ?? inner) as Record<string, unknown>;
  const currentExpireAtRaw = responseObj.expireAt ?? responseObj.expire_at;

  const updatePayload: { uuid: string; expireAt?: string; trafficLimitBytes?: number } = { uuid: sub.remnawaveUuid };

  let newExpireAt: Date | null = null;
  if (parsed.data.addDays != null && parsed.data.addDays !== 0) {
    let baseDate: Date;
    if (typeof currentExpireAtRaw === "string" || typeof currentExpireAtRaw === "number") {
      const d = typeof currentExpireAtRaw === "number" ? new Date(currentExpireAtRaw * 1000) : new Date(currentExpireAtRaw);
      // Если подписка истекла — стартуем от now, иначе стек от текущего expireAt.
      baseDate = !isNaN(d.getTime()) && d.getTime() > Date.now() ? d : new Date();
    } else {
      baseDate = new Date();
    }
    newExpireAt = new Date(baseDate.getTime() + parsed.data.addDays * 24 * 60 * 60 * 1000);
    updatePayload.expireAt = newExpireAt.toISOString();
  }

  if (parsed.data.trafficLimitBytes !== undefined) {
    updatePayload.trafficLimitBytes = parsed.data.trafficLimitBytes ?? 0; // null → 0 (безлимит)
  }

  const updateRes = await remnaUpdateUser(updatePayload);
  if (updateRes.error) {
    return res.status(updateRes.status >= 400 ? updateRes.status : 500).json({ message: updateRes.error });
  }

  // синкаем expireAt в БД для broadcast-фильтра.
  if (newExpireAt) {
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { expireAt: newExpireAt },
    }).catch(() => {});
  }

  await prisma.giftHistory.create({
    data: {
      clientId: sub.ownerId,
      subscriptionId: sub.id,
      eventType: "EDITED_BY_ADMIN",
      metadata: {
        addDays: parsed.data.addDays ?? null,
        newExpireAt: newExpireAt?.toISOString() ?? null,
        trafficLimitBytes: parsed.data.trafficLimitBytes !== undefined ? parsed.data.trafficLimitBytes : null,
      },
    },
  });

  return res.json({ success: true, expireAt: newExpireAt?.toISOString() ?? null, trafficLimitBytes: parsed.data.trafficLimitBytes ?? null });
}));

adminSecondarySubscriptionsRouter.delete("/:id", asyncRoute(async (req, res) => {
  const sub = await prisma.subscription.findUnique({
    where: { id: req.params.id },
    select: { id: true, remnawaveUuid: true, ownerId: true },
  });
  if (!sub) return res.status(404).json({ message: "Подписка не найдена" });

  // Delete Remnawave user if exists
  if (sub.remnawaveUuid && isRemnaConfigured()) {
    try {
      await remnaDeleteUser(sub.remnawaveUuid);
    } catch { /* best effort */ }
  }

  // Log event
  await prisma.giftHistory.create({
    data: {
      clientId: sub.ownerId,
      subscriptionId: sub.id,
      eventType: "DELETED",
      metadata: { deletedBy: "admin" },
    },
  });

  // Cascade deletes GiftCodes via DB relation
  await prisma.subscription.delete({ where: { id: sub.id } });

  return res.json({ success: true });
}));

adminSecondarySubscriptionsRouter.delete("/bulk", asyncRoute(async (req, res) => {
  const { ids } = req.body as { ids?: string[] };
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ message: "Укажите массив ids" });
  }

  const subs = await prisma.subscription.findMany({
    where: { id: { in: ids } },
    select: { id: true, remnawaveUuid: true, ownerId: true },
  });

  // Delete Remnawave users
  if (isRemnaConfigured()) {
    await Promise.allSettled(
      subs.filter((s) => s.remnawaveUuid).map((s) => remnaDeleteUser(s.remnawaveUuid!))
    );
  }

  // Log events
  await prisma.giftHistory.createMany({
    data: subs.map((s) => ({
      clientId: s.ownerId,
      subscriptionId: s.id,
      eventType: "DELETED",
      metadata: { deletedBy: "admin", bulk: true },
    })),
  });

  await prisma.subscription.deleteMany({ where: { id: { in: ids } } });

  return res.json({ success: true, deleted: subs.length });
}));
