import { invalidateSystemConfigCache } from "../client/client.service.js";
import { nextRouletteSpinAt, DEFAULT_ROULETTE_TIME_ZONE } from "./roulette-cooldown.js";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import {
  remnaGetUser,
  remnaUpdateUser,
} from "../remna/remna.client.js";

export type RouletteRewardType = "days" | "balance" | "traffic" | "discount" | "empty";

export type RouletteSector = {
  id: string;
  type: RouletteRewardType;
  value: number;
  label: string;
  weight: number;
  color?: string;
  icon?: string;
};

export type RouletteSettings = {
  enabled: boolean;
  cooldownHours: number;
  resetMode?: "hours" | "daily";
  timeZone?: string;
  sectors: RouletteSector[];
};

export type RouletteClientSubscription = {
  id: string;
  index: number;
  name: string;
  expireAt: string | null;
  isExpired: boolean;
  remnaStatus: string | null;
};

export const DEFAULT_ROULETTE_SECTORS: RouletteSector[] = [
  { id: "s1", type: "days", value: 1, label: "+1 день подписки", weight: 20, color: "#4f46e5", icon: "calendar" },
  { id: "s2", type: "balance", value: 10, label: "10 ₽ на баланс", weight: 25, color: "#10b981", icon: "wallet" },
  { id: "s3", type: "empty", value: 0, label: "Попробуй завтра 🍀", weight: 35, color: "#64748b", icon: "frown" },
  { id: "s4", type: "days", value: 2, label: "+2 дня подписки", weight: 10, color: "#8b5cf6", icon: "calendar" },
  { id: "s5", type: "balance", value: 25, label: "25 ₽ на баланс", weight: 8, color: "#06b6d4", icon: "wallet" },
  { id: "s6", type: "traffic", value: 5, label: "+5 ГБ трафика", weight: 15, color: "#f59e0b", icon: "wifi" },
  { id: "s7", type: "discount", value: 10, label: "Скидка 10%", weight: 12, color: "#ec4899", icon: "tag" },
  { id: "s8", type: "balance", value: 50, label: "50 ₽ на баланс", weight: 5, color: "#e11d48", icon: "sparkles" },
];

function extractCurrentExpireAt(data: unknown, fallbackDbDate?: Date | null): Date | null {
  if (data && typeof data === "object") {
    const o = data as any;
    const raw =
      o?.data?.response?.expireAt ??
      o?.response?.expireAt ??
      o?.data?.expireAt ??
      o?.expireAt;
    if (typeof raw === "string" || typeof raw === "number") {
      const d = new Date(raw);
      if (!Number.isNaN(d.getTime()) && d.getTime() > Date.now()) {
        return d;
      }
    }
  }
  if (fallbackDbDate && fallbackDbDate.getTime() > Date.now()) {
    return fallbackDbDate;
  }
  return null;
}

function calculateExpireAt(currentExpireAt: Date | null, durationDays: number): string {
  const base = currentExpireAt && currentExpireAt.getTime() > Date.now()
    ? currentExpireAt
    : new Date();
  return new Date(base.getTime() + durationDays * 24 * 60 * 60 * 1000).toISOString();
}

function extractCurrentTrafficLimitBytes(data: unknown, fallbackBytes?: number | null): number {
  if (data && typeof data === "object") {
    const o = data as any;
    const v =
      o?.data?.response?.trafficLimitBytes ??
      o?.response?.trafficLimitBytes ??
      o?.data?.trafficLimitBytes ??
      o?.trafficLimitBytes;
    if (typeof v === "number") return v;
    if (typeof v === "string") {
      const n = parseInt(v, 10);
      if (Number.isFinite(n)) return n;
    }
  }
  return typeof fallbackBytes === "number" && fallbackBytes > 0 ? fallbackBytes : 0;
}

async function resolveTargetSubscription(clientId: string, targetSubscriptionId?: string | null, db: Prisma.TransactionClient = prisma) {
  const subInclude = {
    tariff: { select: { name: true } },
    trial: { select: { name: true } },
  };

  // 1. Если клиент явно указал подписку — проверяем её
  if (targetSubscriptionId && typeof targetSubscriptionId === "string" && targetSubscriptionId.trim()) {
    const requested = await db.subscription.findFirst({
      where: {
        id: targetSubscriptionId.trim(),
        ownerId: clientId,
        giftStatus: null,
        subRevokedAt: null,
        remnawaveUuid: { not: null },
      },
      include: subInclude,
    });
    if (!requested) throw new Error("Подписка не найдена");
    return requested;
  }

  // 2. Иначе выбираем наиболее актуальную активную подписку
  const now = new Date();
  const activeSub = await db.subscription.findFirst({
    where: {
      ownerId: clientId,
      giftStatus: null,
      subRevokedAt: null,
      remnawaveUuid: { not: null },
      OR: [
        { expireAt: { gt: now } },
        { remnaStatus: "ACTIVE" },
      ],
    },
    orderBy: [
      { expireAt: { sort: "desc", nulls: "last" } },
      { subscriptionIndex: "asc" },
    ],
    include: subInclude,
  });
  if (activeSub) return activeSub;

  // 3. Fallback: любая существующая подписка клиента с Remnawave UUID
  return db.subscription.findFirst({
    where: {
      ownerId: clientId,
      giftStatus: null,
      subRevokedAt: null,
      remnawaveUuid: { not: null },
    },
    orderBy: [
      { expireAt: { sort: "desc", nulls: "last" } },
      { subscriptionIndex: "asc" },
    ],
    include: subInclude,
  });
}

export async function getRouletteSettings(db: Prisma.TransactionClient = prisma): Promise<RouletteSettings> {
  const settings = await db.systemSetting.findMany({
    where: { key: { in: ["roulette_enabled", "roulette_cooldown_hours", "roulette_sectors", "roulette_reset_mode", "roulette_time_zone"] } },
  });
  const map = Object.fromEntries(settings.map((s) => [s.key, s.value]));
  const enabled = map.roulette_enabled !== "false";
  const cooldownHours = Math.max(1, parseInt(map.roulette_cooldown_hours ?? "24", 10) || 24);
  let sectors: RouletteSector[] = DEFAULT_ROULETTE_SECTORS;
  if (map.roulette_sectors) {
    try {
      const parsed = JSON.parse(map.roulette_sectors);
      if (Array.isArray(parsed) && parsed.length > 0) {
        sectors = parsed;
      }
    } catch {}
  }
  const resetMode = map.roulette_reset_mode === "daily" ? "daily" : "hours";
  let timeZone = map.roulette_time_zone || DEFAULT_ROULETTE_TIME_ZONE;
  try { new Intl.DateTimeFormat("en", { timeZone }); } catch { timeZone = DEFAULT_ROULETTE_TIME_ZONE; }
  return { enabled, cooldownHours, sectors, resetMode, timeZone };
}

export async function updateRouletteSettings(params: {
  enabled?: boolean;
  cooldownHours?: number;
  resetMode?: "hours" | "daily";
  timeZone?: string;
  sectors?: RouletteSector[];
}): Promise<RouletteSettings> {
  const schedule = z.object({
    enabled: z.boolean().optional(),
    cooldownHours: z.number().int().min(1).max(720).optional(),
    resetMode: z.enum(["hours", "daily"]).optional(),
    timeZone: z.string().trim().min(1).max(100).refine(value => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }, "Unknown time zone").optional(),
  }).parse(params);
  for (const [key, value] of [["roulette_reset_mode", schedule.resetMode], ["roulette_time_zone", schedule.timeZone]]) {
    if (value !== undefined) await prisma.systemSetting.upsert({ where: { key: key! }, create: { key: key!, value }, update: { value } });
  }
  if (params.enabled !== undefined) {
    const val = params.enabled ? "true" : "false";
    await prisma.systemSetting.upsert({
      where: { key: "roulette_enabled" },
      create: { key: "roulette_enabled", value: val },
      update: { value: val },
    });
  }
  if (params.cooldownHours !== undefined) {
    const val = String(Math.max(1, params.cooldownHours));
    await prisma.systemSetting.upsert({
      where: { key: "roulette_cooldown_hours" },
      create: { key: "roulette_cooldown_hours", value: val },
      update: { value: val },
    });
  }
  if (params.sectors !== undefined && Array.isArray(params.sectors)) {
    const validTypes = new Set(["days", "balance", "traffic", "discount", "empty"]);
    const cleanedSectors: RouletteSector[] = params.sectors.map((s, idx) => {
      const type = (validTypes.has(s.type) ? s.type : "balance") as RouletteRewardType;
      const value = type === "empty" ? 0 : Math.max(0, Number(s.value) || 0);
      const weight = Math.max(0, Number(s.weight) || 0);
      const label = typeof s.label === "string" && s.label.trim() ? s.label.trim().slice(0, 60) : `Сектор ${idx + 1}`;
      const color = typeof s.color === "string" && s.color.startsWith("#") ? s.color : "#4f46e5";
      const id = typeof s.id === "string" && s.id.trim() ? s.id.trim() : `s_${idx + 1}_${Date.now()}`;
      const defaultIcon = type === "days" ? "calendar" : type === "balance" ? "wallet" : type === "traffic" ? "wifi" : type === "discount" ? "tag" : "frown";
      return {
        id,
        type,
        value,
        label,
        weight,
        color,
        icon: s.icon || defaultIcon,
      };
    });

    const val = JSON.stringify(cleanedSectors);
    await prisma.systemSetting.upsert({
      where: { key: "roulette_sectors" },
      create: { key: "roulette_sectors", value: val },
      update: { value: val },
    });
  }
  invalidateSystemConfigCache();
  return getRouletteSettings();
}

export async function getRouletteStatus(clientId: string) {
  const settings = await getRouletteSettings();
  const lastSpin = await prisma.clientRouletteSpin.findFirst({
    where: { clientId },
    orderBy: { createdAt: "desc" },
  });

  const now = Date.now();
  const nextAt = lastSpin ? nextRouletteSpinAt(lastSpin.createdAt, settings) : 0;
  const pendingReward = lastSpin?.status === "PENDING";
  const canSpin = pendingReward || (settings.enabled && now >= nextAt);
  const nextSpinAt = nextAt > now && !pendingReward ? new Date(nextAt).toISOString() : null;
  const secondsLeft = nextSpinAt ? Math.max(0, Math.ceil((nextAt - now) / 1000)) : 0;

  // Клиенту отдаём секторы без полей weight (вероятностей), чтобы не раскрывать шансы
  const publicSectors = settings.sectors.map(({ id, type, value, label, color, icon }) => ({
    id,
    type,
    value,
    label,
    color: color || "#6366f1",
    icon: icon || "gift",
  }));

  const [recentSpins, clientSubs] = await Promise.all([
    prisma.clientRouletteSpin.findMany({
      where: { clientId, status: "APPLIED" },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        rewardType: true,
        rewardValue: true,
        rewardLabel: true,
        sectorId: true,
        createdAt: true,
      },
    }),
    prisma.subscription.findMany({
      where: {
        ownerId: clientId,
        remnawaveUuid: { not: null },
        subRevokedAt: null,
        giftStatus: null,
      },
      select: {
        id: true,
        subscriptionIndex: true,
        expireAt: true,
        remnaStatus: true,
        tariff: { select: { name: true } },
        trial: { select: { name: true } },
      },
      orderBy: [
        { expireAt: { sort: "desc", nulls: "last" } },
        { subscriptionIndex: "asc" },
      ],
    }),
  ]);

  const availableSubscriptions: RouletteClientSubscription[] = clientSubs.map((s) => {
    const isExpired = s.expireAt ? s.expireAt.getTime() <= Date.now() : false;
    const name = s.trial?.name || s.tariff?.name || `Подписка #${s.subscriptionIndex + 1}`;
    return {
      id: s.id,
      index: s.subscriptionIndex,
      name,
      expireAt: s.expireAt ? s.expireAt.toISOString() : null,
      isExpired,
      remnaStatus: s.remnaStatus,
    };
  });

  return {
    enabled: settings.enabled || pendingReward,
    pendingReward,
    cooldownHours: settings.cooldownHours,
    resetMode: settings.resetMode,
    timeZone: settings.timeZone,
    canSpin,
    nextSpinAt,
    secondsLeft,
    sectors: publicSectors,
    recentSpins,
    subscriptions: availableSubscriptions,
  };
}

type AwardPlan = {
  sector: RouletteSector;
  cooldownHours: number;
  resetMode?: "hours" | "daily";
  timeZone?: string;
  subscriptionId?: string;
  uuid?: string;
  expireAt?: string;
  trafficLimitBytes?: number;
  balance?: number;
  discount?: number;
};

async function lockClient(db: Prisma.TransactionClient, clientId: string) {
  await db.$queryRaw`SELECT id FROM clients WHERE id = ${clientId} FOR UPDATE`;
  const client = await db.client.findUnique({ where: { id: clientId } });
  if (!client || client.isBlocked) throw new Error("Рулетка недоступна");
  return client;
}

async function readRemnaUser(uuid: string): Promise<Record<string, unknown>> {
  const result = await remnaGetUser(uuid);
  if (result.error || result.status < 200 || result.status >= 300 || !result.data) {
    throw new Error("Не удалось получить подписку. Попробуйте ещё раз.");
  }
  const envelope = result.data as { response?: unknown };
  const user = envelope.response ?? result.data;
  if (!user || typeof user !== "object" || Array.isArray(user)) throw new Error("Некорректный ответ VPN");
  return user as Record<string, unknown>;
}

async function reserveSpin(clientId: string, targetSubscriptionId?: string) {
  return prisma.$transaction(async db => {
    const client = await lockClient(db, clientId);
    const last = await db.clientRouletteSpin.findFirst({ where: { clientId }, orderBy: { createdAt: "desc" } });
    if (last?.status === "PENDING") return last;
    const settings = await getRouletteSettings(db);
    if (!settings.enabled) throw new Error("Рулетка временно отключена");
    if (last && Date.now() < nextRouletteSpinAt(last.createdAt, settings)) {
      throw new Error("Следующая попытка пока недоступна");
    }
    const sectors = settings.sectors.filter(s => Number.isFinite(s.weight) && s.weight > 0 && Number.isFinite(s.value) && s.value >= 0);
    if (!sectors.length) throw new Error("В рулетке нет доступных призов");
    let rand = Math.random() * sectors.reduce((sum, s) => sum + s.weight, 0);
    let sector = sectors[sectors.length - 1];
    for (const candidate of sectors) { rand -= candidate.weight; if (rand < 0) { sector = candidate; break; } }
    const plan: AwardPlan = { sector: { ...sector }, cooldownHours: settings.cooldownHours, resetMode: settings.resetMode, timeZone: settings.timeZone };
    let label = sector.label;
    if (sector.type === "balance") plan.balance = sector.value;
    if (sector.type === "discount") {
      const existing = client.personalDiscountPercent ?? 0;
      if (existing > 0 && !client.personalDiscountIsOneTime) label = `Ваша постоянная скидка ${existing}% сохранена`;
      else if (existing >= sector.value) label = `Ваша скидка ${existing}% сохранена`;
      else plan.discount = Math.min(100, sector.value);
    }
    if ((sector.type === "days" || sector.type === "traffic") && sector.value > 0) {
      const sub = await resolveTargetSubscription(clientId, targetSubscriptionId, db);
      if (!sub?.remnawaveUuid) {
        if (sector.type === "days") {
          plan.balance = sector.value * 10;
          label = `+${plan.balance} ₽ на баланс (нет подписки)`;
        } else {
          label = "Нет подписки для добавления трафика";
        }
      } else {
        const user = await readRemnaUser(sub.remnawaveUuid);
        plan.subscriptionId = sub.id;
        plan.uuid = sub.remnawaveUuid;
        if (sector.type === "days") {
          if (typeof user.expireAt !== "string" || !Number.isFinite(Date.parse(user.expireAt))) throw new Error("Не удалось определить срок подписки");
          plan.expireAt = calculateExpireAt(extractCurrentExpireAt(user), sector.value);
        } else {
          const limit = Number(user.trafficLimitBytes);
          if (user.trafficLimitBytes == null || !Number.isSafeInteger(limit) || limit < 0) throw new Error("Не удалось определить лимит трафика");
          if (limit === 0) label = "У подписки уже безлимитный трафик";
          else {
            const target = limit + Math.round(sector.value * 1024 ** 3);
            if (!Number.isSafeInteger(target)) throw new Error("Слишком большой приз трафика");
            plan.trafficLimitBytes = target;
          }
        }
      }
    }
    plan.sector.label = label;
    return db.clientRouletteSpin.create({ data: {
      clientId, rewardType: sector.type, rewardValue: sector.value, rewardLabel: label,
      sectorId: sector.id, status: "PENDING", awardPlan: plan as unknown as Prisma.InputJsonValue,
    } });
  }, { maxWait: 15_000, timeout: 30_000 });
}

async function deliverSpin(clientId: string, spinId: string) {
  return prisma.$transaction(async db => {
    const client = await lockClient(db, clientId);
    const spin = await db.clientRouletteSpin.findFirstOrThrow({ where: { id: spinId, clientId } });
    if (spin.status === "APPLIED") return spin;
    const plan = spin.awardPlan as unknown as AwardPlan;
    if (!plan?.sector) throw new Error("Не удалось прочитать сохранённый приз");
    if (plan.expireAt || plan.trafficLimitBytes != null) {
      const sub = await db.subscription.findFirst({ where: {
        id: plan.subscriptionId, ownerId: clientId, remnawaveUuid: plan.uuid,
        giftStatus: null, subRevokedAt: null,
      } });
      if (!sub || !plan.uuid) throw new Error("Подписка изменилась. Приз сохранён, обратитесь в поддержку.");
      if (sub.bannedUntil) throw new Error("Подписка заблокирована. Приз сохранён, получите его после разблокировки.");
      const user = await readRemnaUser(plan.uuid);
      const patch: { uuid: string; expireAt?: string; trafficLimitBytes?: number; status?: string } = { uuid: plan.uuid };
      if (plan.expireAt) {
        const current = typeof user.expireAt === "string" ? Date.parse(user.expireAt) : NaN;
        if (!Number.isFinite(current)) throw new Error("Не удалось определить срок подписки");
        patch.expireAt = new Date(Math.max(current, Date.parse(plan.expireAt))).toISOString();
        if (user.status === "EXPIRED" && !sub.bannedUntil) patch.status = "ACTIVE";
      } else {
        const current = Number(user.trafficLimitBytes);
        if (user.trafficLimitBytes == null || !Number.isSafeInteger(current) || current < 0) throw new Error("Не удалось определить лимит трафика");
        patch.trafficLimitBytes = current === 0 ? 0 : Math.max(current, plan.trafficLimitBytes!);
      }
      const result = await remnaUpdateUser(patch);
      if (result.error || result.status < 200 || result.status >= 300) {
        throw new Error("Не удалось выдать приз. Он сохранён — нажмите «Получить приз» ещё раз.");
      }
      const remote = result.data as { response?: { status?: unknown }; status?: unknown } | undefined;
      const remoteStatus = remote?.response?.status ?? remote?.status;
      const status = typeof remoteStatus === "string" && ["ACTIVE", "DISABLED", "LIMITED", "EXPIRED"].includes(remoteStatus)
        ? remoteStatus : patch.status;
      await db.subscription.update({ where: { id: sub.id }, data: {
        ...(patch.expireAt ? { expireAt: new Date(patch.expireAt) } : {}),
        ...(status ? { remnaStatus: status } : {}),
        ...(patch.trafficLimitBytes != null ? { trafficLimitBytes: patch.trafficLimitBytes } : {}),
      } });
    }
    if (plan.balance != null && plan.balance > 0) {
      await db.client.update({ where: { id: clientId }, data: { balance: { increment: plan.balance } } });
    }
    if (plan.discount != null && plan.discount > (client.personalDiscountPercent ?? 0)) {
      // A permanent discount must not become a disposable one.
      await db.client.update({ where: { id: clientId }, data: {
        personalDiscountPercent: plan.discount,
        personalDiscountIsOneTime: client.personalDiscountPercent && !client.personalDiscountIsOneTime ? false : true,
      } });
    }
    return db.clientRouletteSpin.update({ where: { id: spin.id }, data: { status: "APPLIED" } });
  }, { maxWait: 15_000, timeout: 30_000 });
}

export async function spinRoulette(clientId: string, targetSubscriptionId?: string) {
  const reserved = await reserveSpin(clientId, targetSubscriptionId);
  const spin = await deliverSpin(clientId, reserved.id);
  const plan = spin.awardPlan as unknown as AwardPlan;
  return {
    spinId: spin.id, sectorId: spin.sectorId,
    reward: { ...plan.sector, label: spin.rewardLabel, color: plan.sector.color || "#6366f1", icon: plan.sector.icon || "gift" },
    nextSpinAt: new Date(nextRouletteSpinAt(spin.createdAt, plan)).toISOString(),
  };
}

export async function getAdminRouletteStats() {
  const settings = await getRouletteSettings();
  const [totalSpins, spinsByType, recentSpins] = await Promise.all([
    prisma.clientRouletteSpin.count({ where: { status: "APPLIED" } }),
    prisma.clientRouletteSpin.groupBy({
      by: ["rewardType"],
      where: { status: "APPLIED" },
      _count: { id: true },
      _sum: { rewardValue: true },
    }),
    prisma.clientRouletteSpin.findMany({
      where: { status: "APPLIED" },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: {
        client: {
          select: {
            id: true,
            email: true,
            telegramUsername: true,
            telegramId: true,
          },
        },
      },
    }),
  ]);

  return {
    settings,
    totalSpins,
    spinsByType,
    recentSpins,
  };
}
