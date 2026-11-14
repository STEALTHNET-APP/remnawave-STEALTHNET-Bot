import express, { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma, createPayment } from "../../db.js";
import { logAdmin } from "../audit/audit.service.js";
import { verifyPassword } from "../auth/auth.service.js";
import { requireAction } from "../auth/middleware.js";
import {
  disableClient as bulkDisableClient,
  enableClient as bulkEnableClient,
  disableAllSubscriptionsInRemna,
  enableAllSubscriptionsInRemna,
  resetAllSubscriptionsTraffic,
  revokeAllSubscriptionsUrls,
  syncAllSubscriptionsToRemna,
  syncAllSubscriptionsFromRemna,
  wipeClientSubscriptions,
  auditClientSubscriptions,
} from "../client/client-bulk-ops.service.js";
import { notifyClientAbout2FAReset } from "../client/client-security-notify.service.js";
import { hashPassword as hashClientPassword } from "../client/client.service.js";
import {
  remnaGetUser,
  remnaUpdateUser,
  remnaRevokeUserSubscription,
  remnaDisableUser,
  remnaDeleteUser,
  remnaEnableUser,
  remnaResetUserTraffic,
  remnaGetUserByTelegramId,
  remnaGetUserByEmail,
  remnaGetUserByUsername,
  extractRemnaUuid,
  isRemnaConfigured,
  remnaGetUserHwidDevices,
  remnaDeleteUserHwidDevice,
  remnaGetUserBandwidthStats,
} from "../remna/remna.client.js";
import { applyDevicesToSubscription, removeAllExtraDevicesForSub } from "../subscription/extras.helper.js";
import { syncToRemna } from "../sync/sync.service.js";
import { ClientProfileError, updateClientSchema, updateAdminClientProfile } from "./client-profile.service.js";

export const adminClientsRouter = Router();

function asyncRoute(
  fn: (req: express.Request, res: express.Response) => Promise<void | express.Response>
) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

// Клиенты панели (наши пользователи — бот, сайт, mini app)
adminClientsRouter.get("/", async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const skip = (page - 1) * limit;
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const isBlockedParam = req.query.isBlocked;

    const where: Prisma.ClientWhereInput = {};
    const conditions: Prisma.ClientWhereInput[] = [];

    if (search.length > 0) {
      conditions.push({
        OR: [
          { email: { contains: search, mode: "insensitive" as const } },
          { telegramUsername: { contains: search, mode: "insensitive" as const } },
          { telegramId: { contains: search } },
          { referralCode: { contains: search, mode: "insensitive" as const } },
          { id: { contains: search } },
          { remnawaveUuid: { contains: search, mode: "insensitive" as const } },
        ],
      });
    }
    if (isBlockedParam === "true") conditions.push({ isBlocked: true });
    else if (isBlockedParam === "false") conditions.push({ isBlocked: false });

    if (conditions.length > 0) where.AND = conditions;
    const whereClause = conditions.length > 0 ? where : undefined;

    const [clients, total] = await Promise.all([
      prisma.client.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          email: true,
          telegramId: true,
          telegramUsername: true,
          preferredLang: true,
          preferredCurrency: true,
          balance: true,
          referralCode: true,
          remnawaveUuid: true,
          trialUsed: true,
          isBlocked: true,
          blockReason: true,
          referralPercent: true,
          personalDiscountPercent: true,
          personalDiscountIsOneTime: true,
          totpEnabled: true,
          createdAt: true,
          _count: { select: { referrals: true } },
        },
      }),
      prisma.client.count({ where: whereClause }),
    ]);
    let items: ((typeof clients)[number] & { activeNode?: string | null; onlineAt?: string | null })[] = clients;

    // Попробуем обогатить клиентов информацией об активной ноде и onlineAt из Remna
    if (isRemnaConfigured()) {
      const withRemna = clients.filter((c) => c.remnawaveUuid);
      const map: Record<string, { activeNode: string | null; onlineAt: string | null }> = {};
      await Promise.all(
        withRemna.map(async (c) => {
          try {
            const resRemna = await remnaGetUser(c.remnawaveUuid!);
            if (resRemna.error || !resRemna.data) {
              map[c.id] = { activeNode: null, onlineAt: null };
              return;
            }
            const raw = resRemna.data as Record<string, unknown>;
            const resp = (raw.response ?? raw) as Record<string, unknown>;
            let label: string | null = null;
            // Пытаемся вытащить имя активной ноды из возможных полей ответа Remna
            if (typeof resp.activeNodeName === "string" && resp.activeNodeName.trim()) {
              label = resp.activeNodeName.trim();
            } else if (typeof resp.currentNodeName === "string" && resp.currentNodeName.trim()) {
              label = resp.currentNodeName.trim();
            } else if (Array.isArray(resp.activeInternalSquads)) {
              const first = resp.activeInternalSquads[0] as { uuid?: string; name?: string } | string | undefined;
              if (first && typeof first === "object") {
                label = (first.name || first.uuid || "").trim() || null;
              }
            }
            // Извлекаем onlineAt из userTraffic
            const traffic = resp.userTraffic as Record<string, unknown> | undefined;
            const onlineAt = typeof traffic?.onlineAt === "string" ? traffic.onlineAt : null;
            map[c.id] = { activeNode: label, onlineAt };
          } catch {
            map[c.id] = { activeNode: null, onlineAt: null };
          }
        })
      );
      items = clients.map((c) => ({
        ...c,
        activeNode: map[c.id]?.activeNode ?? null,
        onlineAt: map[c.id]?.onlineAt ?? null,
      }));
    }

    return res.json({ items, total, page, limit });
  } catch (e) {
    console.error("GET /admin/clients error:", e);
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(500).json({ message: "Ошибка загрузки клиентов. Выполните: cd backend && npx prisma db push", error: msg });
  }
});

/**
 * POST /api/admin/clients/online-statuses
 * Лёгкий эндпоинт для поллинга онлайн-статусов клиентов.
 * Принимает { uuids: string[] } (remnawaveUuid), возвращает { [uuid]: { onlineAt: string | null } }
 */
adminClientsRouter.post("/online-statuses", async (req, res) => {
  try {
    const { uuids } = req.body as { uuids?: string[] };
    if (!Array.isArray(uuids) || uuids.length === 0) {
      return res.json({});
    }
    // Ограничим до 100 uuid за запрос
    const limited = uuids.slice(0, 100);
    const result: Record<string, { onlineAt: string | null }> = {};

    if (!isRemnaConfigured()) {
      for (const uuid of limited) result[uuid] = { onlineAt: null };
      return res.json(result);
    }

    await Promise.all(
      limited.map(async (uuid) => {
        try {
          const resRemna = await remnaGetUser(uuid);
          if (resRemna.error || !resRemna.data) {
            result[uuid] = { onlineAt: null };
            return;
          }
          const raw = resRemna.data as Record<string, unknown>;
          const resp = (raw.response ?? raw) as Record<string, unknown>;
          const traffic = resp.userTraffic as Record<string, unknown> | undefined;
          result[uuid] = {
            onlineAt: typeof traffic?.onlineAt === "string" ? traffic.onlineAt : null,
          };
        } catch {
          result[uuid] = { onlineAt: null };
        }
      })
    );

    return res.json(result);
  } catch (e) {
    console.error("POST /admin/clients/online-statuses error:", e);
    return res.status(500).json({ message: "Ошибка получения статусов" });
  }
});

const clientIdParam = z.object({ id: z.string().cuid() });

adminClientsRouter.get("/:id", async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  const client = await prisma.client.findUnique({
    where: { id: parsed.data.id },
    select: {
      id: true,
      email: true,
      telegramId: true,
      telegramUsername: true,
      preferredLang: true,
      preferredCurrency: true,
      balance: true,
      referralCode: true,
      remnawaveUuid: true,
      trialUsed: true,
      isBlocked: true,
      blockReason: true,
      referralPercent: true,
      personalDiscountPercent: true,
      personalDiscountIsOneTime: true,
      restrictedTariffIds: true,
      tariffRestrictionReason: true,
      totpEnabled: true,
      createdAt: true,
      _count: { select: { referrals: true } },
      // текущий реферер для inline-редактора в карточке клиента.
      referrerId: true,
      referrer: { select: { id: true, email: true, telegramUsername: true, telegramId: true, referralCode: true } },
    },
  });
  if (!client) return res.status(404).json({ message: "Клиент не найден" });
  return res.json(client);
});

adminClientsRouter.patch("/:id", asyncRoute(async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  const body = updateClientSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: body.error.issues[0]?.message ?? "Проверьте данные клиента", errors: body.error.flatten() });
  try {
    return res.json(await updateAdminClientProfile(parsed.data.id, body.data));
  } catch (error) {
    if (error instanceof ClientProfileError) return res.status(error.status).json({ message: error.message });
    throw error;
  }
}));

// T-admin-services (портировано из WolfVPN): вкладка «Услуги» — выдать/забрать доп. устройства подписке (action manage_services).
adminClientsRouter.get("/:id/services", requireAction("manage_services"), asyncRoute(async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  const subs = await prisma.subscription.findMany({
    where: { ownerId: parsed.data.id },
    orderBy: { subscriptionIndex: "asc" },
    select: {
      id: true,
      subscriptionIndex: true,
      remnawaveUuid: true,
      extraDevices: true,
      extraDevicesMonthlyPrice: true,
      tariff: { select: { name: true, menuEmoji: true, includedDevices: true, deviceLimit: true } },
    },
  });
  const items = subs.map((s) => ({
    subscriptionId: s.id,
    subscriptionIndex: s.subscriptionIndex,
    tariffName: s.tariff?.name ?? null,
    tariffEmoji: s.tariff?.menuEmoji ?? null,
    includedDevices: s.tariff?.includedDevices ?? s.tariff?.deviceLimit ?? 1,
    extraDevices: s.extraDevices ?? 0,
    extraDevicesMonthlyPrice: s.extraDevicesMonthlyPrice ?? 0,
    linked: !!s.remnawaveUuid,
  }));
  return res.json({ items });
}));

const grantDevicesSchema = z.object({
  subscriptionId: z.string().min(1),
  deviceCount: z.number().int().min(1).max(50),
  monthlyPrice: z.number().min(0).max(1_000_000),
});
adminClientsRouter.post("/:id/services/grant-devices", requireAction("manage_services"), asyncRoute(async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  const body = grantDevicesSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: body.error.issues[0]?.message ?? "Проверьте параметры выдачи" });
  const sub = await prisma.subscription.findFirst({ where: { id: body.data.subscriptionId, ownerId: parsed.data.id }, select: { id: true } });
  if (!sub) return res.status(404).json({ message: "Подписка не найдена у клиента" });
  const result = await applyDevicesToSubscription(body.data.subscriptionId, body.data.deviceCount, body.data.monthlyPrice);
  if (!result.ok) return res.status(502).json({ message: result.error ?? "Не удалось выдать устройства" });
  return res.json({ ok: true, newDeviceLimit: result.newDeviceLimit });
}));

const removeServicesSchema = z.object({ subscriptionId: z.string().min(1) });
adminClientsRouter.post("/:id/services/remove-devices", requireAction("manage_services"), asyncRoute(async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  const body = removeServicesSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Не указана подписка" });
  const sub = await prisma.subscription.findFirst({ where: { id: body.data.subscriptionId, ownerId: parsed.data.id }, select: { id: true } });
  if (!sub) return res.status(404).json({ message: "Подписка не найдена у клиента" });
  const result = await removeAllExtraDevicesForSub(body.data.subscriptionId);
  if (!result.ok) return res.status(502).json({ message: result.error ?? "Не удалось забрать услугу" });
  return res.json({ ok: true, extraDevicesRemoved: result.extraDevicesRemoved, newDeviceLimit: result.newDeviceLimit, hwidKicked: result.hwidKicked });
}));

// T-tariff-restriction (портировано из WolfVPN): задать/снять запрет тарифов клиенту.
const tariffRestrictionsSchema = z.object({
  tariffIds: z.array(z.string()).default([]),
  reason: z.string().max(2000).nullable().optional(),
});
adminClientsRouter.patch("/:id/tariff-restrictions", asyncRoute(async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  const body = tariffRestrictionsSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  const client = await prisma.client.findUnique({ where: { id: parsed.data.id }, select: { id: true } });
  if (!client) return res.status(404).json({ message: "Клиент не найден" });
  const ids = [...new Set(body.data.tariffIds.map((x) => String(x)).filter(Boolean))];
  const reason = (body.data.reason ?? "").trim() || null;
  await prisma.client.update({
    where: { id: parsed.data.id },
    data: {
      restrictedTariffIds: ids.length > 0 ? JSON.stringify(ids) : null,
      tariffRestrictionReason: reason,
    },
  });
  return res.json({ ok: true, restrictedTariffIds: ids, tariffRestrictionReason: reason });
}));

const setClientPasswordSchema = z.object({
  newPassword: z.string().min(8, "Пароль не менее 8 символов"),
});

adminClientsRouter.patch("/:id/password", async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  const body = setClientPasswordSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  const client = await prisma.client.findUnique({ where: { id: parsed.data.id } });
  if (!client) return res.status(404).json({ message: "Клиент не найден" });
  const passwordHash = await hashClientPassword(body.data.newPassword);
  await prisma.client.update({
    where: { id: parsed.data.id },
    data: { passwordHash },
  });
  return res.json({ success: true, message: "Пароль установлен" });
});

const resetClient2FASchema = z.object({
  adminPassword: z.string().min(1, "Введите пароль администратора").max(200),
});

adminClientsRouter.post(
  "/:id/reset-2fa",
  requireAction("reset_client_2fa"),
  rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req) => (req as express.Request & { adminId: string }).adminId,
    message: { message: "Слишком много попыток. Повторите через 15 минут." } }),
  asyncRoute(async (req, res) => {
    const parsed = clientIdParam.safeParse(req.params);
    if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
    const body = resetClient2FASchema.safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({ message: body.error.issues[0]?.message ?? "Invalid input", errors: body.error.flatten() });
    }

    // Sudo-mode: повторное подтверждение личности администратора
    const adminId = (req as express.Request & { adminId?: string }).adminId;
    if (!adminId) return res.status(401).json({ message: "Unauthorized" });

    const admin = await prisma.admin.findUnique({
      where: { id: adminId },
      select: { id: true, email: true, passwordHash: true },
    });
    if (!admin) return res.status(401).json({ message: "Администратор не найден" });

    const isPasswordValid = await verifyPassword(body.data.adminPassword, admin.passwordHash);
    if (!isPasswordValid) {
      return res.status(401).json({ message: "Неверный пароль администратора" });
    }

    const client = await prisma.client.findUnique({
      where: { id: parsed.data.id },
      select: { id: true, email: true, telegramId: true, telegramUsername: true, preferredLang: true, totpEnabled: true },
    });
    if (!client) return res.status(404).json({ message: "Клиент не найден" });
    if (!client.totpEnabled) {
      return res.status(400).json({ message: "Двухфакторная аутентификация у клиента не включена" });
    }

    // Сброс 2FA: удаляем секрет и выключаем флаг
    await prisma.client.update({
      where: { id: client.id },
      data: {
        totpEnabled: false,
        totpSecret: null,
      },
    });

    // Аудит: кто, кому, когда
    await logAdmin(req, "client.reset_2fa", { type: "client", id: client.id }, {
      email: client.email,
      telegramUsername: client.telegramUsername,
      telegramId: client.telegramId,
      adminEmail: admin.email,
    });

    // Уведомление клиента
    notifyClientAbout2FAReset(client).catch((err) => {
      console.warn("[admin] failed to dispatch 2FA reset notification:", err);
    });

    return res.json({ ok: true, message: "Двухфакторная аутентификация пользователя успешно сброшена" });
  }),
);

adminClientsRouter.delete("/:id", async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  const client = await prisma.client.findUnique({ where: { id: parsed.data.id }, select: { id: true, remnawaveUuid: true, telegramId: true, email: true } });
  if (!client) return res.status(404).json({ message: "Клиент не найден" });

  if (await prisma.cloudPaymentAgreement.count({ where: { clientId: parsed.data.id } }) || await prisma.payment.count({ where: { clientId: parsed.data.id, provider: "cloudpayments" } })) {
    return res.status(409).json({ message: "У клиента сохранена история CloudPayments. Отмените его автоплатежи в Настройки → Платежи → CloudPayments, затем заблокируйте аккаунт. История платежей останется доступной." });
  }

  // T (11.05.2026): удалять ВСЕ Remna-юзеры клиента,
  // включая дополнительные подписки (secondary_subscriptions с собственным remnawave_uuid).
  // Раньше удалялся только primary, secondary висели в Remna навсегда.
  if (isRemnaConfigured()) {
    let remnaUuid = client.remnawaveUuid;

    // Если remnawaveUuid нет — ищем юзера в Remna по telegramId / email
    if (!remnaUuid && client.telegramId?.trim()) {
      const byTg = await remnaGetUserByTelegramId(client.telegramId.trim());
      remnaUuid = extractRemnaUuid(byTg.data);
    }
    if (!remnaUuid && client.email?.trim()) {
      const byEmail = await remnaGetUserByEmail(client.email.trim());
      remnaUuid = extractRemnaUuid(byEmail.data);
    }

    if (remnaUuid) {
      const remnaRes = await remnaDeleteUser(remnaUuid);
      if (remnaRes.error) {
        console.warn(`[admin delete client] Remna delete primary failed for ${remnaUuid}:`, remnaRes.error);
      }
    }

    // Удаляем все secondary-subscriptions этого клиента из Remna.
    // (БД-каскад удалит сами строки; но Remna-юзеров надо чистить через API).
    const secondaries = await prisma.subscription.findMany({
      where: { ownerId: parsed.data.id, remnawaveUuid: { not: null } },
      select: { id: true, remnawaveUuid: true, subscriptionIndex: true },
    });
    let deletedCount = 0;
    let failedCount = 0;
    for (const sec of secondaries) {
      if (!sec.remnawaveUuid) continue;
      try {
        const r = await remnaDeleteUser(sec.remnawaveUuid);
        if (r.error) {
          failedCount++;
          console.warn(`[admin delete client] Remna delete secondary #${sec.subscriptionIndex} (${sec.remnawaveUuid}) failed:`, r.error);
        } else {
          deletedCount++;
        }
      } catch (e) {
        failedCount++;
        console.warn(`[admin delete client] Remna delete secondary #${sec.subscriptionIndex} threw:`, e);
      }
    }
    if (secondaries.length > 0) {
      console.log(`[admin delete client ${parsed.data.id}] Remna secondary cleanup: ${deletedCount} deleted, ${failedCount} failed (of ${secondaries.length})`);
    }
  }

  // Удаление из БД: cascade удалит secondary_subscriptions, payments (через FK), trial_usages и т.д.
  await prisma.client.delete({ where: { id: parsed.data.id } });
  return res.json({ success: true });
});

// сначала смотрим primary-подписку (subscriptionIndex=0),
// fallback на legacy Client.remnawaveUuid. После унификации UUID у новых клиентов живёт в
// Subscription, legacy field остался ради старых юзеров до бэкфилла.
async function getClientRemnaUuid(clientId: string): Promise<string | null> {
  const primary = await prisma.subscription.findUnique({
    where: { ownerId_subscriptionIndex: { ownerId: clientId, subscriptionIndex: 0 } },
    select: { remnawaveUuid: true },
  });
  if (primary?.remnawaveUuid) return primary.remnawaveUuid;
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { remnawaveUuid: true },
  });
  return client?.remnawaveUuid ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Массовые операции над клиентом.
// Работают по всем подпискам клиента (Subscription[*]) — после унификации.
// Возвращают структурированный отчёт { ok, skipped, failed, items[] }.
// ─────────────────────────────────────────────────────────────────────────────

/** Composite «Отключить клиента»: бан в боте + disable VPN на всех подписках + autoRenew off. */
adminClientsRouter.post("/:id/disable", asyncRoute(async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  const report = await bulkDisableClient(parsed.data.id);
  return res.json(report);
}));

/** Composite «Включить клиента»: разбан + Enable Remna для неистёкших подписок. */
adminClientsRouter.post("/:id/enable", asyncRoute(async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  const report = await bulkEnableClient(parsed.data.id);
  return res.json(report);
}));

/** Только Remna: disable всех подписок клиента (бан в боте не трогаем). */
adminClientsRouter.post("/:id/disable-all", asyncRoute(async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  return res.json(await disableAllSubscriptionsInRemna(parsed.data.id));
}));

adminClientsRouter.post("/:id/enable-all", asyncRoute(async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  return res.json(await enableAllSubscriptionsInRemna(parsed.data.id));
}));

/** Сбросить трафик на всех подписках клиента. */
adminClientsRouter.post("/:id/reset-all-traffic", asyncRoute(async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  return res.json(await resetAllSubscriptionsTraffic(parsed.data.id));
}));

/** Перевыпустить subscription URL на всех подписках клиента. */
adminClientsRouter.post("/:id/revoke-all-subscriptions", asyncRoute(async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  return res.json(await revokeAllSubscriptionsUrls(parsed.data.id));
}));

/** Push БД → Remna для всех подписок (выровнять лимиты/сквады по тарифу). */
adminClientsRouter.post("/:id/sync-push", asyncRoute(async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  return res.json(await syncAllSubscriptionsToRemna(parsed.data.id));
}));

/** Pull Remna → БД (выровнять кеш в БД + найти лишних в Remna). */
adminClientsRouter.post("/:id/sync-pull", asyncRoute(async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  return res.json(await syncAllSubscriptionsFromRemna(parsed.data.id));
}));

/** Полный sync = Pull + Push (Remna → БД, потом БД → Remna). */
adminClientsRouter.post("/:id/sync", asyncRoute(async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  const pullReport = await syncAllSubscriptionsFromRemna(parsed.data.id);
  const pushReport = await syncAllSubscriptionsToRemna(parsed.data.id);
  return res.json({ pull: pullReport, push: pushReport });
}));

/** Удалить все подписки клиента (DB + Remna). Клиент остаётся. */
adminClientsRouter.post("/:id/wipe-subscriptions", asyncRoute(async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  return res.json(await wipeClientSubscriptions(parsed.data.id));
}));

/** Audit (read-only): diff БД vs Remna. */
adminClientsRouter.get("/:id/audit", asyncRoute(async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  return res.json(await auditClientSubscriptions(parsed.data.id));
}));

/**
 * устройства со ВСЕХ подписок клиента.
 * Каждая `Subscription[*]` имеет свой Remna-юзер → свой набор HWID-устройств.
 * Возвращаем плоский список устройств с пометкой откуда (subscriptionIndex + tariff).
 */
adminClientsRouter.get("/:id/all-devices", asyncRoute(async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });

  // УНИФИЦИРОВАНО — ВСЕ устройства берутся только
  // из таблицы Subscription. client.remnawaveUuid — legacy, не учитывается (миграция:
  // root-подписка должна иметь Subscription-запись с subscriptionIndex=0).
  // Дедуп по UUID — на случай если две Subscription указывают на один Remna-юзер.
  const subs = await prisma.subscription.findMany({
    where: { ownerId: parsed.data.id },
    orderBy: { subscriptionIndex: "asc" },
    select: {
      id: true,
      subscriptionIndex: true,
      remnawaveUuid: true,
      tariff: { select: { name: true, menuEmoji: true } },
    },
  });

  const groups: Array<{
    subscriptionId: string;
    subscriptionIndex: number;
    tariffName: string | null;
    tariffEmoji: string | null;
    remnawaveUuid: string | null;
    devices: unknown[];
    deviceLimit: number | null;
  }> = [];
  let totalDevices = 0;
  const seenUuids = new Set<string>();

  for (const sub of subs) {
    if (!sub.remnawaveUuid) {
      groups.push({
        subscriptionId: sub.id,
        subscriptionIndex: sub.subscriptionIndex,
        tariffName: sub.tariff?.name ?? null,
        tariffEmoji: sub.tariff?.menuEmoji ?? null,
        remnawaveUuid: null,
        devices: [],
        deviceLimit: null,
      });
      continue;
    }
    if (seenUuids.has(sub.remnawaveUuid)) continue; // дедуп
    seenUuids.add(sub.remnawaveUuid);
    const r = await remnaGetUserHwidDevices(sub.remnawaveUuid);
    const d = (r.data as Record<string, unknown> | null)?.response as Record<string, unknown> | undefined;
    const devices = Array.isArray(d?.devices) ? (d.devices as unknown[]) : [];
    totalDevices += devices.length;

    let deviceLimit: number | null = null;
    const userRes = await remnaGetUser(sub.remnawaveUuid);
    const u = (userRes.data as Record<string, unknown> | null);
    const inner = (u?.response ?? u) as Record<string, unknown> | undefined;
    if (typeof inner?.hwidDeviceLimit === "number") deviceLimit = inner.hwidDeviceLimit;

    groups.push({
      subscriptionId: sub.id,
      subscriptionIndex: sub.subscriptionIndex,
      tariffName: sub.tariff?.name ?? null,
      tariffEmoji: sub.tariff?.menuEmoji ?? null,
      remnawaveUuid: sub.remnawaveUuid,
      devices,
      deviceLimit,
    });
  }
  return res.json({ groups, total: totalDevices });
}));

/**
 * сводка по всем подпискам клиента + Remna-данные.
 * Используется во вкладке «Remna» — показывает таблицу со всеми подписками клиента и
 * параметрами их Remna-юзеров: expireAt, traffic used/limit, deviceLimit, статус, squads.
 */
adminClientsRouter.get("/:id/subscriptions-overview", asyncRoute(async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });

  const subs = await prisma.subscription.findMany({
    where: { ownerId: parsed.data.id },
    orderBy: { subscriptionIndex: "asc" },
    select: {
      id: true,
      subscriptionIndex: true,
      remnawaveUuid: true,
      tariffId: true,
      trialId: true,
      purchasedAsGift: true,
      giftStatus: true,
      autoRenewEnabled: true,
      customPrice: true,
      tariff: { select: { name: true, menuEmoji: true, durationDays: true } },
      trial: { select: { name: true, durationDays: true } },
    },
  });

  const items = [] as Array<{
    subscriptionId: string;
    subscriptionIndex: number;
    tariffName: string | null;
    tariffEmoji: string | null;
    isTrial: boolean;
    trialName: string | null;
    purchasedAsGift: boolean;
    giftStatus: string | null;
    autoRenewEnabled: boolean;
    customPrice: number | null;
    remnawaveUuid: string | null;
    remna: {
      username: string | null;
      status: string | null;
      expireAt: string | null;
      trafficLimitBytes: number | null;
      trafficUsedBytes: number | null;
      hwidDeviceLimit: number | null;
      deviceCount: number;
      activeSquadsCount: number;
      subscriptionUrl: string | null;
      onlineAt: string | null;
    } | null;
  }>;

  for (const sub of subs) {
    let remna: typeof items[number]["remna"] = null;
    if (sub.remnawaveUuid) {
      const r = await remnaGetUser(sub.remnawaveUuid);
      const u = (r.data as Record<string, unknown> | null);
      const inner = (u?.response ?? u) as Record<string, unknown> | undefined;
      const traffic = (inner?.userTraffic ?? {}) as Record<string, unknown>;
      const squads = Array.isArray(inner?.activeInternalSquads) ? (inner.activeInternalSquads as unknown[]) : [];
      const devicesRes = await remnaGetUserHwidDevices(sub.remnawaveUuid).catch(() => ({ data: null }));
      const d = (devicesRes.data as Record<string, unknown> | null)?.response as Record<string, unknown> | undefined;
      const devices = Array.isArray(d?.devices) ? (d.devices as unknown[]) : [];
      remna = {
        username: typeof inner?.username === "string" ? inner.username : null,
        status: typeof inner?.status === "string" ? inner.status : null,
        expireAt: typeof inner?.expireAt === "string" ? inner.expireAt : null,
        trafficLimitBytes: typeof inner?.trafficLimitBytes === "number" ? inner.trafficLimitBytes : null,
        trafficUsedBytes: typeof traffic?.usedTrafficBytes === "number" ? traffic.usedTrafficBytes : null,
        hwidDeviceLimit: typeof inner?.hwidDeviceLimit === "number" ? inner.hwidDeviceLimit : null,
        deviceCount: devices.length,
        activeSquadsCount: squads.length,
        subscriptionUrl: typeof inner?.subscriptionUrl === "string" ? inner.subscriptionUrl : null,
        onlineAt: typeof inner?.onlineAt === "string" ? inner.onlineAt : null,
      };
    }
    items.push({
      subscriptionId: sub.id,
      subscriptionIndex: sub.subscriptionIndex,
      tariffName: sub.tariff?.name ?? null,
      tariffEmoji: sub.tariff?.menuEmoji ?? null,
      isTrial: sub.trialId != null,
      trialName: sub.trial?.name ?? null,
      purchasedAsGift: sub.purchasedAsGift,
      giftStatus: sub.giftStatus,
      autoRenewEnabled: sub.autoRenewEnabled,
      customPrice: sub.customPrice,
      remnawaveUuid: sub.remnawaveUuid,
      remna,
    });
  }
  return res.json({ items });
}));

adminClientsRouter.get("/:id/remna", async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  const remnaUuid = await getClientRemnaUuid(parsed.data.id);
  if (!remnaUuid) return res.status(400).json({ message: "Клиент не привязан к Remna" });
  const result = await remnaGetUser(remnaUuid);
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? {});
});

export const remnaUpdateBodySchema = z.object({
  trafficLimitBytes: z.number().int().min(0).optional(),
  trafficLimitStrategy: z.enum(["NO_RESET", "DAY", "WEEK", "MONTH", "MONTH_ROLLING"]).optional(),
  hwidDeviceLimit: z.number().int().min(0).nullable().optional(),
  expireAt: z.string().datetime().optional(),
  activeInternalSquads: z.array(z.string().uuid()).optional(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
  telegramId: z.number().int().nullable().optional(),
  email: z.string().email().nullable().optional(),
});

/** Извлечь из ответа Remna getUser: activeInternalSquads (uuid[]), telegramId, email — чтобы не затирать при PATCH. */
export function getRemnaUserFieldsForMerge(data: unknown): { activeInternalSquads: string[]; telegramId?: number; email?: string | null } {
  if (!data || typeof data !== "object") return { activeInternalSquads: [] };
  const o = data as Record<string, unknown>;
  const resp = (o.response ?? o) as Record<string, unknown> | undefined;
  const ais = resp?.activeInternalSquads;
  const squads: string[] = [];
  if (Array.isArray(ais)) {
    for (const s of ais) {
      const u = (s && typeof s === "object" && "uuid" in s) ? (s as Record<string, unknown>).uuid : s;
      if (typeof u === "string") squads.push(u);
    }
  }
  return {
    activeInternalSquads: squads,
    ...(typeof resp?.telegramId === "number" && { telegramId: resp.telegramId }),
    ...(resp?.email !== undefined && { email: resp.email != null ? String(resp.email) : null }),
  };
}

adminClientsRouter.patch("/:id/remna", async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  const remnaUuid = await getClientRemnaUuid(parsed.data.id);
  if (!remnaUuid) return res.status(400).json({ message: "Клиент не привязан к Remna" });
  const body = remnaUpdateBodySchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  const getRes = await remnaGetUser(remnaUuid);
  if (getRes.error) return res.status(getRes.status >= 400 ? getRes.status : 500).json({ message: getRes.error });
  const current = getRemnaUserFieldsForMerge(getRes.data);
  const patchBody: Record<string, unknown> = { uuid: remnaUuid };
  if (body.data.activeInternalSquads === undefined && current.activeInternalSquads.length > 0) patchBody.activeInternalSquads = current.activeInternalSquads;
  if (body.data.telegramId === undefined && current.telegramId !== undefined) patchBody.telegramId = current.telegramId;
  if (body.data.email === undefined && current.email !== undefined) patchBody.email = current.email;
  Object.assign(patchBody, body.data);
  const result = await remnaUpdateUser(patchBody);
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  // после успешного PATCH в Remna зеркалим expireAt
  // в БД (Subscription.expireAt у любой подписки с этим uuid). Раньше изменения
  // через admin UI расходились с БД.
  if (body.data.expireAt) {
    try {
      await prisma.subscription.updateMany({
        where: { ownerId: parsed.data.id, remnawaveUuid: remnaUuid },
        data: { expireAt: new Date(body.data.expireAt) },
      });
    } catch (e) {
      console.error("[admin/clients/remna] expireAt DB sync failed:", e);
    }
  }
  return res.json(result.data ?? {});
});

/**
 * Отвязать клиента от Remna (обнулить remnawaveUuid).
 *
 * Кейс: Remna-пользователь удалён (руками в панели Remna), но клиент в нашей БД остался
 * с «повисшим» remnawaveUuid → syncToRemna не находит его в Remna и выдаёт «fetch failed».
 * Этот endpoint разрывает связь — клиент остаётся, но считается «без VPN»; при следующей
 * покупке тарифа будет создан новый Remna-пользователь.
 */
adminClientsRouter.post("/:id/remna/unlink", async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  const client = await prisma.client.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, remnawaveUuid: true },
  });
  if (!client) return res.status(404).json({ message: "Клиент не найден" });
  if (!client.remnawaveUuid) return res.status(400).json({ message: "Клиент уже не привязан к Remna" });
  await prisma.client.update({ where: { id: client.id }, data: { remnawaveUuid: null } });
  return res.json({ ok: true });
});

adminClientsRouter.post("/:id/remna/revoke-subscription", async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  const remnaUuid = await getClientRemnaUuid(parsed.data.id);
  if (!remnaUuid) return res.status(400).json({ message: "Клиент не привязан к Remna" });
  const result = await remnaRevokeUserSubscription(remnaUuid);
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? {});
});

adminClientsRouter.post("/:id/remna/disable", async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  const remnaUuid = await getClientRemnaUuid(parsed.data.id);
  if (!remnaUuid) return res.status(400).json({ message: "Клиент не привязан к Remna" });
  const result = await remnaDisableUser(remnaUuid);
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? {});
});

adminClientsRouter.post("/:id/remna/enable", async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  const remnaUuid = await getClientRemnaUuid(parsed.data.id);
  if (!remnaUuid) return res.status(400).json({ message: "Клиент не привязан к Remna" });
  const result = await remnaEnableUser(remnaUuid);
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? {});
});

adminClientsRouter.post("/:id/remna/reset-traffic", async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  const remnaUuid = await getClientRemnaUuid(parsed.data.id);
  if (!remnaUuid) return res.status(400).json({ message: "Клиент не привязан к Remna" });
  const result = await remnaResetUserTraffic(remnaUuid);
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? {});
});

const grantTariffSchema = z.object({
  tariffId: z.string().min(1),
  // Опционально: конкретная опция длительности из priceOptions тарифа.
  // Если не указано — используется опция с минимальной ценой (default).
  tariffPriceOptionId: z.string().min(1).optional(),
  // Количество ДОП. устройств (0..tariff.maxExtraDevices). Если не задано — 0.
  deviceCount: z.number().int().min(0).max(100).optional(),
  note: z.string().max(500).optional(),
  createPaymentRecord: z.boolean().optional(),
  // override лимита трафика в БАЙТАХ.
  // Применяется только если у тарифа НЕ безлимит (tariff.trafficLimitBytes > 0).
  // null/undefined → используется лимит тарифа. 0 → безлимит (можно сделать безлимит из лимитного).
  trafficLimitBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable().optional(),
  // override длительности в днях. Если задано, перебивает
  // selectedOption.durationDays / tariff.durationDays. Используется админом для
  // выдачи нестандартной длительности (например, компенсация = 7 дней).
  // Диапазон 1..3650 (10 лет максимум, sanity-cap).
  customDurationDays: z.number().int().min(1).max(3650).optional(),
});

/**
 * POST /admin/clients/:id/grant-tariff
 * Выдаёт тариф клиенту вручную (без оплаты). Создаёт запись Payment со статусом PAID,
 * amount=0, provider="admin_grant", и активирует подписку в Remnawave.
 * Подходит для компенсаций, бонусов, корректировок — без начисления реферальных бонусов.
 */
adminClientsRouter.post("/:id/grant-tariff", async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  const body = grantTariffSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input" });

  const clientId = parsed.data.id;
  const { tariffId, tariffPriceOptionId, deviceCount, note, createPaymentRecord = true, trafficLimitBytes: trafficLimitOverride, customDurationDays } = body.data;

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, remnawaveUuid: true, email: true, telegramId: true, telegramUsername: true },
  });
  if (!client) return res.status(404).json({ message: "Клиент не найден" });

  const tariff = await prisma.tariff.findUnique({
    where: { id: tariffId },
    include: { priceOptions: { orderBy: [{ sortOrder: "asc" }, { durationDays: "asc" }] } },
  });
  if (!tariff) return res.status(404).json({ message: "Тариф не найден" });

  // Выбираем опцию: явный priceOptionId → найти и проверить; иначе — опция с минимальной ценой
  // (или fallback на legacy tariff.durationDays + tariff.price если опций нет).
  let selectedOption: { id: string; durationDays: number; price: number } | null = null;
  if (tariffPriceOptionId) {
    const opt = tariff.priceOptions.find((o) => o.id === tariffPriceOptionId);
    if (!opt) return res.status(400).json({ message: "Опция цены не найдена в этом тарифе" });
    selectedOption = { id: opt.id, durationDays: opt.durationDays, price: opt.price };
  } else if (tariff.priceOptions.length > 0) {
    const sorted = [...tariff.priceOptions].sort((a, b) => a.price - b.price);
    selectedOption = { id: sorted[0].id, durationDays: sorted[0].durationDays, price: sorted[0].price };
  }

  const adminId = (req as unknown as { adminId: string }).adminId;
  const now = new Date();

  // Количество ДОП. устройств клиенту бонусом (0..tariff.maxExtraDevices).
  // Параметр deviceCount в API — это extraDevices (legacy имя сохранено для совместимости фронта).
  const effectiveExtras = Math.min(Math.max(0, deviceCount ?? 0), tariff.maxExtraDevices);

  let paymentId: string | null = null;
  if (createPaymentRecord) {
    const orderId = `admin-grant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      const payment = await createPayment({
        data: {
          clientId,
          orderId,
          amount: 0,
          currency: tariff.currency,
          status: "PAID",
          provider: "admin_grant",
          tariffId: tariff.id,
          tariffPriceOptionId: selectedOption?.id ?? null,
          deviceCount: effectiveExtras,
          paidAt: now,
          metadata: JSON.stringify({ grantedBy: adminId, note: note ?? null, kind: "admin_grant" }),
        },
        select: { id: true },
      });
      paymentId = payment.id;
    } catch (e) {
      console.error("[admin/grant-tariff] Не удалось создать Payment:", e);
    }
  }

  // Админская выдача учитывает режим мультиподписки (это НЕ подарок).
  // можно переопределить trafficLimitBytes (только если у тарифа не безлимит).
  // Применяется ТОЛЬКО для лимитных тарифов: если у тарифа уже безлимит — override игнорируем.
  const hasTariffLimit = tariff.trafficLimitBytes != null && Number(tariff.trafficLimitBytes) > 0;
  const effectiveTrafficLimit: bigint | null =
    hasTariffLimit && trafficLimitOverride !== undefined && trafficLimitOverride !== null
      ? BigInt(trafficLimitOverride)
      : tariff.trafficLimitBytes;

  // customDurationDays перебивает выбор опции / legacy fallback.
  // Полезно если админ хочет выдать нестандартный срок (например, 7 дн. компенсации).
  const effectiveDurationDays = customDurationDays ?? selectedOption?.durationDays ?? tariff.durationDays;

  const { grantSubscriptionTariff } = await import("./grant-subscription.service.js");
  const subResult = await grantSubscriptionTariff(clientId, {
    id: tariff.id,
    name: tariff.name,
    price: selectedOption?.price ?? tariff.price,
    durationDays: effectiveDurationDays,
    trafficLimitBytes: effectiveTrafficLimit,
    deviceLimit: tariff.deviceLimit,
    includedDevices: tariff.includedDevices,
    pricePerExtraDevice: tariff.pricePerExtraDevice,
    maxExtraDevices: tariff.maxExtraDevices,
    deviceDiscountTiers: tariff.deviceDiscountTiers,
    internalSquadUuids: tariff.internalSquadUuids,
    trafficResetMode: tariff.trafficResetMode ?? undefined,
  }, effectiveExtras);

  if (!subResult.ok) {
    if (paymentId) {
      await prisma.payment.update({
        where: { id: paymentId },
        data: { status: "FAILED", metadata: JSON.stringify({ grantedBy: adminId, note: note ?? null, kind: "admin_grant", error: subResult.error }) },
      }).catch(() => { /* ignore */ });
    }
    return res.status(subResult.status && subResult.status >= 400 ? subResult.status : 500).json({
      ok: false,
      message: subResult.error ?? "Ошибка активации тарифа",
    });
  }

  // T-unify: привязываем Payment к созданной Subscription (для аналитики + auto-renew).
  if (paymentId) {
    await prisma.payment.update({
      where: { id: paymentId },
      data: { subscriptionId: subResult.data.subscriptionId },
    }).catch(() => { /* ignore */ });
    // отправляем клиенту уведомление в Telegram о выдаче подписки
    // (тот же поток что после обычной оплаты — текст с ссылкой подписки и кнопками).
    try {
      const { notifyTariffActivated } = await import("../notification/telegram-notify.service.js");
      await notifyTariffActivated(clientId, paymentId);
    } catch (e) {
      console.error("[admin/grant-tariff] notify client failed:", e);
    }
  }

  return res.json({
    ok: true,
    paymentId,
    subscriptionId: subResult.data.subscriptionId,
    subscriptionIndex: subResult.data.subscriptionIndex,
    // возвращаем выбранную опцию длительности,
    // а не tariff.durationDays (legacy минимум). Раньше success-сообщение всегда показывало 30 дн.
    // если был customDurationDays, возвращаем именно его.
    tariff: { id: tariff.id, name: tariff.name, durationDays: effectiveDurationDays },
  });
});

const attachRemnaSchema = z.object({
  /** username или uuid существующего Remna-юзера (одно из двух). */
  query: z.string().min(3).max(64),
  /** опционально: пометить подписку этим тарифом (для продлений/отображения). */
  tariffId: z.string().min(1).optional(),
});

/**
 * POST /admin/clients/:id/attach-remna-subscription
 *
 * привязать клиенту подписку на УЖЕ СУЩЕСТВУЮЩЕГО
 * Remna-юзера (по username или uuid), не создавая нового. Используется когда
 * юзер уже заведён в панели Remnawave руками — раньше grant-tariff всегда
 * создавал нового Remna-юзера, и привязать существующего было невозможно.
 */
adminClientsRouter.post("/:id/attach-remna-subscription", asyncRoute(async (req, res) => {
  const parsedId = clientIdParam.safeParse(req.params);
  if (!parsedId.success) return res.status(400).json({ message: "Invalid client id" });
  const body = attachRemnaSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  if (!isRemnaConfigured()) return res.status(503).json({ message: "Remna не настроена" });

  const clientId = parsedId.data.id;
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, telegramId: true, email: true },
  });
  if (!client) return res.status(404).json({ message: "Клиент не найден" });

  // Ищем Remna-юзера: строка похожа на uuid → по uuid, иначе по username.
  const q = body.data.query.trim();
  const looksLikeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q);
  const lookup = looksLikeUuid ? await remnaGetUser(q) : await remnaGetUserByUsername(q);
  const remnaUuid = extractRemnaUuid(lookup.data);
  if (lookup.error || !remnaUuid) {
    return res.status(404).json({ message: `Remna-юзер «${q}» не найден${lookup.error ? `: ${lookup.error}` : ""}` });
  }

  // Один Remna-юзер = одна подписка панели. Дубль привязки порождает двойное
  // управление одним юзером (продления конфликтуют) — запрещаем.
  const existing = await prisma.subscription.findFirst({
    where: { remnawaveUuid: remnaUuid },
    select: { id: true, ownerId: true, subscriptionIndex: true },
  });
  if (existing) {
    return res.status(409).json({
      message: existing.ownerId === clientId
        ? `Этот Remna-юзер уже привязан к подписке #${existing.subscriptionIndex} этого клиента`
        : "Этот Remna-юзер уже привязан к подписке другого клиента",
    });
  }

  if (body.data.tariffId) {
    const tariff = await prisma.tariff.findUnique({ where: { id: body.data.tariffId }, select: { id: true } });
    if (!tariff) return res.status(400).json({ message: "Тариф не найден" });
  }

  // expireAt из Remna — кэшируем в БД (broadcast-фильтры, авто-продление, admin UI).
  const remnaData = lookup.data as Record<string, unknown> | null;
  const payload = (remnaData?.response ?? remnaData) as Record<string, unknown> | null;
  const expireAtRaw = payload && typeof payload.expireAt === "string" ? payload.expireAt : null;
  const expireAt = expireAtRaw && !Number.isNaN(new Date(expireAtRaw).getTime()) ? new Date(expireAtRaw) : null;

  const { getNextSubscriptionIndex } = await import("../subscription/subscription.helpers.js");
  const subscriptionIndex = await getNextSubscriptionIndex(clientId);

  const created = await prisma.subscription.create({
    data: {
      ownerId: clientId,
      subscriptionIndex,
      remnawaveUuid: remnaUuid,
      tariffId: body.data.tariffId ?? null,
      expireAt,
    },
  });

  // Best-effort: привязываем TG/email клиента к Remna-юзеру (как при покупке).
  if (client.telegramId?.trim() || client.email?.trim()) {
    const rebind = await remnaUpdateUser({
      uuid: remnaUuid,
      ...(client.telegramId?.trim() && { telegramId: parseInt(client.telegramId, 10) }),
      ...(client.email?.trim() && { email: client.email.trim() }),
    });
    if (rebind.error) console.error("[admin/attach-remna] rebind tg/email failed:", rebind.error);
  }

  await logAdmin(req, "subscription.attach_remna", { type: "subscription", id: created.id }, {
    clientId,
    remnaUuid,
    query: q,
  });

  return res.json({
    ok: true,
    subscriptionId: created.id,
    subscriptionIndex,
    remnawaveUuid: remnaUuid,
    expireAt: expireAt?.toISOString() ?? null,
  });
}));

export const squadActionSchema = z.object({ squadUuid: z.string().uuid() });

adminClientsRouter.post("/:id/remna/squads/add", async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  const remnaUuid = await getClientRemnaUuid(parsed.data.id);
  if (!remnaUuid) return res.status(400).json({ message: "Клиент не привязан к Remna" });
  const body = squadActionSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input" });
  // Получаем текущие сквады пользователя, чтобы добавить новый без потери существующих
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
  if (!currentSquads.includes(body.data.squadUuid)) {
    currentSquads.push(body.data.squadUuid);
  }
  const result = await remnaUpdateUser({ uuid: remnaUuid, activeInternalSquads: currentSquads });
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? {});
});

adminClientsRouter.post("/:id/remna/squads/remove", async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  const remnaUuid = await getClientRemnaUuid(parsed.data.id);
  if (!remnaUuid) return res.status(400).json({ message: "Клиент не привязан к Remna" });
  const body = squadActionSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input" });
  // По api-1.yaml у DELETE .../remove-users нет requestBody — только uuid сквада в path; эндпоинт может убирать всех из сквада. Поэтому убираем сквад только у этого пользователя через PATCH user (как при add).
  const userRes = await remnaGetUser(remnaUuid);
  if (userRes.error) return res.status(userRes.status >= 400 ? userRes.status : 500).json({ message: userRes.error });
  const current = getRemnaUserFieldsForMerge(userRes.data);
  const currentSquads = current.activeInternalSquads.filter((u) => u !== body.data.squadUuid);
  const result = await remnaUpdateUser({ uuid: remnaUuid, activeInternalSquads: currentSquads });
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? {});
});

adminClientsRouter.get("/:id/remna/devices", async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  const remnaUuid = await getClientRemnaUuid(parsed.data.id);
  if (!remnaUuid) return res.status(400).json({ message: "Клиент не привязан к Remna" });
  const result = await remnaGetUserHwidDevices(remnaUuid);
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? {});
});

export const deleteDeviceSchema = z.object({ hwid: z.string().min(1) });

adminClientsRouter.post("/:id/remna/devices/delete", requireAction("delete_device"), async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  const remnaUuid = await getClientRemnaUuid(parsed.data.id);
  if (!remnaUuid) return res.status(400).json({ message: "Клиент не привязан к Remna" });
  const body = deleteDeviceSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input" });
  const result = await remnaDeleteUserHwidDevice(remnaUuid, body.data.hwid);
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? { success: true });
});

adminClientsRouter.get("/:id/remna/usage", async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  const remnaUuid = await getClientRemnaUuid(parsed.data.id);
  if (!remnaUuid) return res.status(400).json({ message: "Клиент не привязан к Remna" });
  const days = Math.min(Math.max(parseInt(req.query.days as string) || 30, 1), 90);
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const result = await remnaGetUserBandwidthStats(remnaUuid, fmt(start), fmt(end));
  if (result.error) return res.status(result.status >= 400 ? result.status : 500).json({ message: result.error });
  return res.json(result.data ?? {});
});

/** Список всех подписок клиента (primary + secondary) — для нового UI «Подписки клиента». */
adminClientsRouter.get("/:id/subscriptions", asyncRoute(async (req, res) => {
  const parsed = clientIdParam.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Invalid client id" });
  // расширили выборку: включаем не только subs, которыми клиент
  // владеет (ownerId), но и subs, ПОДАРЕННЫЕ ему (giftedToClientId). Раньше второй
  // случай не показывался в инлайн-блоке «Подписки клиента» в карточке клиента.
  const subs = await prisma.subscription.findMany({
    where: {
      OR: [
        { ownerId: parsed.data.id },
        { giftedToClientId: parsed.data.id },
      ],
    },
    orderBy: { subscriptionIndex: "asc" },
    include: {
      tariff: { select: { id: true, name: true } },
    },
  });
  return res.json({
    items: subs.map((s) => ({
      id: s.id,
      subscriptionIndex: s.subscriptionIndex,
      isPrimary: s.subscriptionIndex === 0,
      remnawaveUuid: s.remnawaveUuid,
      tariffId: s.tariffId,
      tariffName: s.tariff?.name ?? null,
      giftStatus: s.giftStatus,
      // добавили в ответ: нужны для UI-бейджей «Подарочная» и
      // «Получена в подарок» в инлайн-блоке карточки клиента (clients.tsx).
      purchasedAsGift: s.purchasedAsGift,
      ownerId: s.ownerId,
      giftedToClientId: s.giftedToClientId,
      autoRenewEnabled: s.autoRenewEnabled,
      expireAt: s.expireAt?.toISOString() ?? null,
      createdAt: s.createdAt.toISOString(),
    })),
  });
}));
