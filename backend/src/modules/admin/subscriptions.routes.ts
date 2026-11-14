import express, { Router } from "express";
import { z } from "zod";
import { prisma, createPayment } from "../../db.js";
import { logAdmin } from "../audit/audit.service.js";
import { requireAction } from "../auth/middleware.js";
import {
  remnaGetUser,
  remnaUpdateUser,
  remnaRevokeUserSubscription,
  remnaDisableUser,
  remnaEnableUser,
  remnaResetUserTraffic,
  remnaGetUserHwidDevices,
  remnaDeleteUserHwidDevice,
  remnaGetUserBandwidthStats,
} from "../remna/remna.client.js";
// activateTariffForClient больше не используется в admin —
// выдача подписки идёт через createAdditionalSubscription (создание новой Subscription).
// extendSecondarySubscription — для админского продления конкретной
// подписки (grant-extend): тот же механизм, что и оплаченное продление.
import { extendSecondarySubscription } from "../tariff/tariff-activation.service.js";
import { promoteSubscriptionToPrimary } from "../subscription/subscription.helpers.js";
import { Prisma } from "@prisma/client";
import { deleteDeviceSchema, getRemnaUserFieldsForMerge, remnaUpdateBodySchema, squadActionSchema } from "./clients.routes.js";
import { chooseGrantExtendMode, extendSubscriptionDaysOnly } from "./grant-extend-days.service.js";

export const adminSubscriptionsRouter = Router();

function asyncRoute(
  fn: (req: express.Request, res: express.Response) => Promise<void | express.Response>
) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

async function getSubscriptionRemnaUuid(subId: string): Promise<string | null> {
  const sub = await prisma.subscription.findUnique({
    where: { id: subId },
    select: { remnawaveUuid: true },
  });
  return sub?.remnawaveUuid ?? null;
}

const subIdParam = z.object({ subId: z.string().min(1) });

const grantExtendSchema = z.object({
  // Тариф для продления. Если не задан — тариф самой подписки.
  tariffId: z.string().min(1).optional(),
  tariffPriceOptionId: z.string().min(1).optional(),
  // Нестандартный срок (компенсации и т.п.) — перебивает опцию/тариф.
  customDurationDays: z.number().int().min(1).max(3650).optional(),
  note: z.string().max(500).optional(),
  createPaymentRecord: z.boolean().optional(),
});

/**
 * POST /admin/subscriptions/:subId/grant-extend
 *
 * ручное ПРОДЛЕНИЕ конкретной подписки админом (компенсация,
 * бонус). Раньше grant-tariff всегда создавал НОВУЮ подписку — продлить выданный
 * клиенту ключ было невозможно. Использует тот же унифицированный механизм, что
 * и оплаченное продление (extendSecondarySubscription) — работает для ЛЮБОЙ
 * подписки (включая index 0), с учётом тарифа и накопленных доп. устройств.
 */
adminSubscriptionsRouter.post("/:subId/grant-extend", asyncRoute(async (req, res) => {
  const subId = String(req.params.subId ?? "");
  if (!subId) return res.status(400).json({ message: "Invalid subscription id" });
  const body = grantExtendSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });

  const sub = await prisma.subscription.findUnique({
    where: { id: subId },
    select: { id: true, ownerId: true, subscriptionIndex: true, tariffId: true, trialId: true, remnawaveUuid: true },
  });
  if (!sub) return res.status(404).json({ message: "Подписка не найдена" });
  if (!sub.remnawaveUuid) return res.status(400).json({ message: "Подписка не привязана к Remnawave" });

  // Триал / подписка без тарифа и тариф явно не выбран → продлеваем только дату
  // (лимиты, сквады, trialId не трогаем). Явный tariffId = конвертация в тариф (ниже).
  if (chooseGrantExtendMode(sub, body.data.tariffId) === "days_only") {
    const days = body.data.customDurationDays;
    if (!days) return res.status(400).json({ message: "Укажите срок продления (дней)" });
    const daysResult = await extendSubscriptionDaysOnly({ id: sub.id, remnawaveUuid: sub.remnawaveUuid }, days);
    if (!daysResult.ok) {
      return res.status(daysResult.status >= 400 ? daysResult.status : 500).json({ ok: false, message: daysResult.error });
    }
    await logAdmin(req, "subscription.grant_extend", { type: "subscription", id: sub.id }, {
      tariffId: null,
      trialId: sub.trialId,
      mode: "days_only",
      days,
      expireAt: daysResult.expireAt.toISOString(),
      reactivated: daysResult.reactivated,
      note: body.data.note ?? null,
    });
    try {
      const { notifySubscriptionExtendedByAdmin } = await import("../notification/telegram-notify.service.js");
      await notifySubscriptionExtendedByAdmin(sub.ownerId, daysResult.expireAt);
    } catch (e) {
      console.error("[admin/grant-extend] notify client failed:", e);
    }
    return res.json({
      ok: true,
      paymentId: null,
      subscriptionId: sub.id,
      subscriptionIndex: sub.subscriptionIndex,
      mode: "days_only",
      expireAt: daysResult.expireAt.toISOString(),
      tariff: null,
    });
  }

  const effectiveTariffId = body.data.tariffId ?? sub.tariffId;
  if (!effectiveTariffId) {
    return res.status(400).json({ message: "У подписки нет тарифа — укажите tariffId для продления" });
  }
  const tariff = await prisma.tariff.findUnique({
    where: { id: effectiveTariffId },
    include: { priceOptions: { orderBy: [{ sortOrder: "asc" }, { durationDays: "asc" }] } },
  });
  if (!tariff) return res.status(404).json({ message: "Тариф не найден" });

  let selectedOption: { id: string; durationDays: number; price: number } | undefined;
  if (body.data.tariffPriceOptionId) {
    const opt = tariff.priceOptions.find((o) => o.id === body.data.tariffPriceOptionId);
    if (!opt) return res.status(400).json({ message: "Опция цены не найдена в этом тарифе" });
    selectedOption = { id: opt.id, durationDays: opt.durationDays, price: opt.price };
  } else if (tariff.priceOptions.length > 0) {
    const sorted = [...tariff.priceOptions].sort((a, b) => a.price - b.price);
    selectedOption = { id: sorted[0].id, durationDays: sorted[0].durationDays, price: sorted[0].price };
  }
  // Нестандартный срок: подменяем длительность выбранной опции (цена admin_grant всё равно 0).
  if (body.data.customDurationDays) {
    selectedOption = {
      id: selectedOption?.id ?? "",
      durationDays: body.data.customDurationDays,
      price: selectedOption?.price ?? tariff.price,
    };
  }

  const adminId = (req as unknown as { adminId: string }).adminId;
  const effectiveDays = selectedOption?.durationDays ?? tariff.durationDays;

  let paymentId: string | null = null;
  if (body.data.createPaymentRecord ?? true) {
    try {
      const payment = await createPayment({
        data: {
          clientId: sub.ownerId,
          orderId: `admin-extend-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          amount: 0,
          currency: tariff.currency,
          status: "PAID",
          provider: "admin_grant",
          tariffId: tariff.id,
          tariffPriceOptionId: selectedOption?.id || null,
          subscriptionId: sub.id,
          paidAt: new Date(),
          metadata: JSON.stringify({
            grantedBy: adminId,
            note: body.data.note ?? null,
            kind: "admin_grant",
            extendsSecondarySubId: sub.id,
            customDurationDays: body.data.customDurationDays ?? null,
          }),
        },
        select: { id: true },
      });
      paymentId = payment.id;
    } catch (e) {
      console.error("[admin/grant-extend] Не удалось создать Payment:", e);
    }
  }

  const result = await extendSecondarySubscription(sub.id, {
    id: tariff.id,
    durationDays: effectiveDays,
    trafficLimitBytes: tariff.trafficLimitBytes,
    deviceLimit: tariff.deviceLimit,
    includedDevices: tariff.includedDevices,
    pricePerExtraDevice: tariff.pricePerExtraDevice,
    maxExtraDevices: tariff.maxExtraDevices,
    deviceDiscountTiers: tariff.deviceDiscountTiers,
    internalSquadUuids: tariff.internalSquadUuids,
    trafficResetMode: tariff.trafficResetMode ?? undefined,
    price: selectedOption?.price ?? tariff.price,
  }, selectedOption);

  if (!result.ok) {
    if (paymentId) {
      await prisma.payment.update({
        where: { id: paymentId },
        data: { status: "FAILED", metadata: JSON.stringify({ grantedBy: adminId, kind: "admin_grant", error: result.error }) },
      }).catch(() => { /* ignore */ });
    }
    return res.status(result.status >= 400 ? result.status : 500).json({ ok: false, message: result.error });
  }

  await logAdmin(req, "subscription.grant_extend", { type: "subscription", id: sub.id }, {
    tariffId: tariff.id,
    days: effectiveDays,
    note: body.data.note ?? null,
  });

  if (paymentId) {
    try {
      const { notifyTariffActivated } = await import("../notification/telegram-notify.service.js");
      await notifyTariffActivated(sub.ownerId, paymentId);
    } catch (e) {
      console.error("[admin/grant-extend] notify client failed:", e);
    }
  }

  return res.json({
    ok: true,
    paymentId,
    subscriptionId: sub.id,
    subscriptionIndex: sub.subscriptionIndex,
    tariff: { id: tariff.id, name: tariff.name, durationDays: effectiveDays },
  });
}));

const updateSubscriptionDbSchema = z.object({
  customName: z.string().max(60).nullable().optional(),
  tariffId: z.string().min(1).nullable().optional(),
  remnawaveUuid: z.string().min(1).nullable().optional(),
  expireAt: z.string().datetime({ offset: true }).nullable().optional(),
  customPrice: z.number().min(0).nullable().optional(),
  autoRenewEnabled: z.boolean().optional(),
  extraDevices: z.number().int().min(0).optional(),
  syncToClient: z.boolean().optional(),
});

adminSubscriptionsRouter.post("/:subId/make-primary", asyncRoute(async (req, res) => {
  const parsed = subIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid subscription id" });

  const result = await promoteSubscriptionToPrimary(parsed.data.subId);
  if (!result) return res.status(404).json({ message: "Подписка не найдена" });

  await logAdmin(req, "subscription.make_primary", { type: "subscription", id: result.id }, {
    ownerId: result.ownerId,
    previousPrimaryId: result.previousPrimaryId,
  });

  return res.json({ ok: true, subscriptionId: result.id, subscriptionIndex: 0 });
}));

adminSubscriptionsRouter.patch("/:subId", asyncRoute(async (req, res) => {
  const parsed = subIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid subscription id" });
  const body = updateSubscriptionDbSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });

  const sub = await prisma.subscription.findUnique({
    where: { id: parsed.data.subId },
    select: { id: true, ownerId: true, subscriptionIndex: true, remnawaveUuid: true, tariffId: true },
  });
  if (!sub) return res.status(404).json({ message: "Подписка не найдена" });

  const input = body.data;

  if (input.tariffId) {
    const tariff = await prisma.tariff.findUnique({ where: { id: input.tariffId }, select: { id: true } });
    if (!tariff) return res.status(404).json({ message: "Тариф не найден" });
  }

  if (input.remnawaveUuid) {
    const linked = await prisma.subscription.findFirst({
      where: { remnawaveUuid: input.remnawaveUuid, id: { not: sub.id } },
      select: { id: true, ownerId: true },
    });
    if (linked && linked.ownerId !== sub.ownerId) {
      return res.status(409).json({ message: "Этот Remna UUID уже привязан к другому клиенту" });
    }
  }

  const data: Prisma.SubscriptionUncheckedUpdateInput = {};
  if (input.customName !== undefined) data.customName = input.customName;
  if (input.tariffId !== undefined) data.tariffId = input.tariffId;
  if (input.remnawaveUuid !== undefined) data.remnawaveUuid = input.remnawaveUuid;
  if (input.expireAt !== undefined) data.expireAt = input.expireAt ? new Date(input.expireAt) : null;
  if (input.customPrice !== undefined) data.customPrice = input.customPrice;
  if (input.autoRenewEnabled !== undefined) data.autoRenewEnabled = input.autoRenewEnabled;
  if (input.extraDevices !== undefined) data.extraDevices = input.extraDevices;

  if (Object.keys(data).length === 0) {
    return res.status(400).json({ message: "Нет полей для обновления" });
  }

  const updated = await prisma.subscription.update({ where: { id: sub.id }, data });

  const syncToClient = input.syncToClient === true || sub.subscriptionIndex === 0;
  if (syncToClient) {
    const clientData: Prisma.ClientUncheckedUpdateInput = {};
    if (input.remnawaveUuid !== undefined) clientData.remnawaveUuid = input.remnawaveUuid;
    if (input.tariffId !== undefined) clientData.currentTariffId = input.tariffId;
    if (Object.keys(clientData).length > 0) {
      await prisma.client.update({ where: { id: sub.ownerId }, data: clientData });
    }
  }

  await logAdmin(req, "subscription.update_db", { type: "subscription", id: updated.id }, {
    ownerId: sub.ownerId,
    subscriptionIndex: sub.subscriptionIndex,
    changes: { ...input },
    syncedToClient: syncToClient,
  });

  return res.json({ ok: true, subscription: updated });
}));

// ─────────────────────────────────────────────────────────────────────────────
// Per-subscription Remna endpoints.
//
// Параллельный набор к `/clients/:id/remna/*` — но работает per-subscription.
// Используется в UI «Подписки клиента» — каждая подписка имеет свой Remna user
// и должна управляться отдельно (limits, squads, disable/enable, reset-traffic).
//
// Helper getSubscriptionRemnaUuid берёт `Subscription.remnawaveUuid` по subId.
// ─────────────────────────────────────────────────────────────────────────────

/** GET Remna user данных для подписки (Username, лимиты, трафик, expireAt, сквады). */
adminSubscriptionsRouter.get("/:subId/remna", asyncRoute(async (req, res) => {
  const parsed = subIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid subscription id" });
  const remnaUuid = await getSubscriptionRemnaUuid(parsed.data.subId);
  if (!remnaUuid) return res.status(400).json({ message: "Подписка не привязана к Remna" });
  const result = await remnaGetUser(remnaUuid);
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? {});
}));

/** PATCH лимитов / сквадов / телеграма Remna user конкретной подписки. */
adminSubscriptionsRouter.patch("/:subId/remna", asyncRoute(async (req, res) => {
  const parsed = subIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid subscription id" });
  const remnaUuid = await getSubscriptionRemnaUuid(parsed.data.subId);
  if (!remnaUuid) return res.status(400).json({ message: "Подписка не привязана к Remna" });
  const body = remnaUpdateBodySchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  // для MANAGER разрешено менять ТОЛЬКО hwidDeviceLimit,
  // и только при наличии action `change_device_limit`. Остальные поля — admin-only.
  const reqExt = req as express.Request & { adminRole?: "ADMIN" | "MANAGER"; adminAllowedSections?: string[] };
  if (reqExt.adminRole !== "ADMIN") {
    const allowedKeys = new Set(["hwidDeviceLimit"]);
    const presentKeys = Object.keys(body.data).filter((k) => (body.data as Record<string, unknown>)[k] !== undefined);
    const onlyAllowed = presentKeys.length > 0 && presentKeys.every((k) => allowedKeys.has(k));
    if (!onlyAllowed) {
      return res.status(403).json({ message: "MANAGER может менять только лимит устройств в этом эндпоинте" });
    }
    if (!(reqExt.adminAllowedSections ?? []).includes("action:change_device_limit")) {
      return res.status(403).json({ message: "Требуется право «change_device_limit»" });
    }
  }
  const getRes = await remnaGetUser(remnaUuid);
  if (getRes.error) return res.status(getRes.status >= 400 ? getRes.status : 500).json({ message: getRes.error });
  const current = getRemnaUserFieldsForMerge(getRes.data);
  const patchBody: Record<string, unknown> = { uuid: remnaUuid };
  if (body.data.activeInternalSquads === undefined && current.activeInternalSquads.length > 0) patchBody.activeInternalSquads = current.activeInternalSquads;
  if (body.data.telegramId === undefined && current.telegramId !== undefined) patchBody.telegramId = current.telegramId;
  if (body.data.email === undefined && current.email !== undefined) patchBody.email = current.email;
  Object.assign(patchBody, body.data);
  // когда админ меняет expireAt и status явно
  // не передан — форсим ACTIVE если новая дата в будущем. Иначе Remna user
  // остаётся в старом status (например EXPIRED после истечения), и бот продолжает
  // рисовать «истекла», хоть expireAt уже в будущем. EXPIRED не форсим — Remna
  // сама переключит когда expireAt в прошлом.
  if (body.data.expireAt && body.data.status === undefined) {
    const newExpire = new Date(body.data.expireAt);
    // EXPIRED не форсим — Remna сама переключит status когда expireAt в прошлом.
    // Форсим только ACTIVE при «продлении» (expireAt в будущем): без этого
    // user, который уже был EXPIRED, остаётся EXPIRED даже после продления.
    if (!Number.isNaN(newExpire.getTime()) && newExpire.getTime() > Date.now()) {
      patchBody.status = "ACTIVE";
    }
  }
  const result = await remnaUpdateUser(patchBody);
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  // зеркалим expireAt в БД для этой подписки —
  // чтобы auto-broadcast / бот видели ту же дату что в Remna. Без этого после
  // PATCH через UI «Применить лимиты» расходились БД и Remna (бот мог слать
  // уведомления «истекает через 15 мин» когда в Remna уже истекло, и наоборот).
  if (body.data.expireAt) {
    try {
      await prisma.subscription.update({
        where: { id: parsed.data.subId },
        data: { expireAt: new Date(body.data.expireAt) },
      });
    } catch (e) {
      console.error("[admin/subscriptions/remna] expireAt DB sync failed:", e);
    }
  }
  return res.json(result.data ?? {});
}));

/** Отвязать подписку от Remna (обнулить Subscription.remnawaveUuid). */
adminSubscriptionsRouter.post("/:subId/remna/unlink", asyncRoute(async (req, res) => {
  const parsed = subIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid subscription id" });
  const sub = await prisma.subscription.findUnique({
    where: { id: parsed.data.subId },
    select: { id: true, remnawaveUuid: true },
  });
  if (!sub) return res.status(404).json({ message: "Подписка не найдена" });
  if (!sub.remnawaveUuid) return res.status(400).json({ message: "Подписка уже не привязана к Remna" });
  await prisma.subscription.update({ where: { id: sub.id }, data: { remnawaveUuid: null } });
  return res.json({ ok: true });
}));

adminSubscriptionsRouter.post("/:subId/remna/revoke-subscription", asyncRoute(async (req, res) => {
  const parsed = subIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid subscription id" });
  const remnaUuid = await getSubscriptionRemnaUuid(parsed.data.subId);
  if (!remnaUuid) return res.status(400).json({ message: "Подписка не привязана к Remna" });
  const result = await remnaRevokeUserSubscription(remnaUuid);
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? {});
}));

adminSubscriptionsRouter.post("/:subId/remna/disable", asyncRoute(async (req, res) => {
  const parsed = subIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid subscription id" });
  const remnaUuid = await getSubscriptionRemnaUuid(parsed.data.subId);
  if (!remnaUuid) return res.status(400).json({ message: "Подписка не привязана к Remna" });
  const result = await remnaDisableUser(remnaUuid);
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? {});
}));

adminSubscriptionsRouter.post("/:subId/remna/enable", asyncRoute(async (req, res) => {
  const parsed = subIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid subscription id" });
  const remnaUuid = await getSubscriptionRemnaUuid(parsed.data.subId);
  if (!remnaUuid) return res.status(400).json({ message: "Подписка не привязана к Remna" });
  const result = await remnaEnableUser(remnaUuid);
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? {});
}));

adminSubscriptionsRouter.post("/:subId/remna/reset-traffic", asyncRoute(async (req, res) => {
  const parsed = subIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid subscription id" });
  const remnaUuid = await getSubscriptionRemnaUuid(parsed.data.subId);
  if (!remnaUuid) return res.status(400).json({ message: "Подписка не привязана к Remna" });
  const result = await remnaResetUserTraffic(remnaUuid);
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? {});
}));

adminSubscriptionsRouter.post("/:subId/remna/squads/add", asyncRoute(async (req, res) => {
  const parsed = subIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid subscription id" });
  const remnaUuid = await getSubscriptionRemnaUuid(parsed.data.subId);
  if (!remnaUuid) return res.status(400).json({ message: "Подписка не привязана к Remna" });
  const body = squadActionSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input" });
  const userRes = await remnaGetUser(remnaUuid);
  const userData = userRes.data as Record<string, unknown> | undefined;
  const resp = (userData?.response ?? userData) as Record<string, unknown> | undefined;
  const currentSquads: string[] = [];
  const ais = resp?.activeInternalSquads;
  if (Array.isArray(ais)) {
    for (const s of ais) {
      const u = (s && typeof s === "object" && "uuid" in s) ? (s as Record<string, unknown>).uuid : s;
      if (typeof u === "string") currentSquads.push(u);
    }
  }
  if (!currentSquads.includes(body.data.squadUuid)) currentSquads.push(body.data.squadUuid);
  const result = await remnaUpdateUser({ uuid: remnaUuid, activeInternalSquads: currentSquads });
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? {});
}));

adminSubscriptionsRouter.post("/:subId/remna/squads/remove", asyncRoute(async (req, res) => {
  const parsed = subIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid subscription id" });
  const remnaUuid = await getSubscriptionRemnaUuid(parsed.data.subId);
  if (!remnaUuid) return res.status(400).json({ message: "Подписка не привязана к Remna" });
  const body = squadActionSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input" });
  const userRes = await remnaGetUser(remnaUuid);
  if (userRes.error) return res.status(userRes.status >= 400 ? userRes.status : 500).json({ message: userRes.error });
  const current = getRemnaUserFieldsForMerge(userRes.data);
  const currentSquads = current.activeInternalSquads.filter((u) => u !== body.data.squadUuid);
  const result = await remnaUpdateUser({ uuid: remnaUuid, activeInternalSquads: currentSquads });
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? {});
}));

adminSubscriptionsRouter.get("/:subId/remna/devices", asyncRoute(async (req, res) => {
  const parsed = subIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid subscription id" });
  const remnaUuid = await getSubscriptionRemnaUuid(parsed.data.subId);
  if (!remnaUuid) return res.status(400).json({ message: "Подписка не привязана к Remna" });
  const result = await remnaGetUserHwidDevices(remnaUuid);
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? {});
}));

adminSubscriptionsRouter.post("/:subId/remna/devices/delete", requireAction("delete_device"), asyncRoute(async (req, res) => {
  const parsed = subIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid subscription id" });
  const remnaUuid = await getSubscriptionRemnaUuid(parsed.data.subId);
  if (!remnaUuid) return res.status(400).json({ message: "Подписка не привязана к Remna" });
  const body = deleteDeviceSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input" });
  const result = await remnaDeleteUserHwidDevice(remnaUuid, body.data.hwid);
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? { success: true });
}));

adminSubscriptionsRouter.get("/:subId/remna/usage", asyncRoute(async (req, res) => {
  const parsed = subIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid subscription id" });
  const remnaUuid = await getSubscriptionRemnaUuid(parsed.data.subId);
  if (!remnaUuid) return res.status(400).json({ message: "Подписка не привязана к Remna" });
  const days = Math.min(Math.max(parseInt(req.query.days as string) || 30, 1), 90);
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const result = await remnaGetUserBandwidthStats(remnaUuid, fmt(start), fmt(end));
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? {});
}));
