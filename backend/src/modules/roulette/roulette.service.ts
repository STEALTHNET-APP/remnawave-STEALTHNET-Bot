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

async function resolveTargetSubscription(clientId: string, targetSubscriptionId?: string | null) {
  const subInclude = {
    tariff: { select: { name: true } },
    trial: { select: { name: true } },
  };

  // 1. Если клиент явно указал подписку — проверяем её
  if (targetSubscriptionId && typeof targetSubscriptionId === "string" && targetSubscriptionId.trim()) {
    const requested = await prisma.subscription.findFirst({
      where: {
        id: targetSubscriptionId.trim(),
        ownerId: clientId,
        giftStatus: null,
        subRevokedAt: null,
        remnawaveUuid: { not: null },
      },
      include: subInclude,
    });
    if (requested) return requested;
  }

  // 2. Иначе выбираем наиболее актуальную активную подписку
  const now = new Date();
  const activeSub = await prisma.subscription.findFirst({
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
  return prisma.subscription.findFirst({
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

export async function getRouletteSettings(): Promise<RouletteSettings> {
  const settings = await prisma.systemSetting.findMany({
    where: { key: { in: ["roulette_enabled", "roulette_cooldown_hours", "roulette_sectors"] } },
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
  return { enabled, cooldownHours, sectors };
}

export async function updateRouletteSettings(params: {
  enabled?: boolean;
  cooldownHours?: number;
  sectors?: RouletteSector[];
}): Promise<RouletteSettings> {
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
  return getRouletteSettings();
}

export async function getRouletteStatus(clientId: string) {
  const settings = await getRouletteSettings();
  const lastSpin = await prisma.clientRouletteSpin.findFirst({
    where: { clientId },
    orderBy: { createdAt: "desc" },
  });

  const cooldownMs = settings.cooldownHours * 3600 * 1000;
  const now = Date.now();
  const lastSpinTime = lastSpin ? lastSpin.createdAt.getTime() : 0;
  const diff = now - lastSpinTime;
  const canSpin = settings.enabled && diff >= cooldownMs;
  const nextSpinAt = canSpin ? null : new Date(lastSpinTime + cooldownMs).toISOString();
  const secondsLeft = canSpin ? 0 : Math.max(0, Math.ceil((cooldownMs - diff) / 1000));

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
      where: { clientId },
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
    enabled: settings.enabled,
    cooldownHours: settings.cooldownHours,
    canSpin,
    nextSpinAt,
    secondsLeft,
    sectors: publicSectors,
    recentSpins,
    subscriptions: availableSubscriptions,
  };
}

// In-flight блокировка против race condition атак параллельными запросами
const activeSpins = new Set<string>();

export async function spinRoulette(clientId: string, targetSubscriptionId?: string) {
  if (activeSpins.has(clientId)) {
    throw new Error("Вращение уже обрабатывается, пожалуйста, подождите");
  }
  activeSpins.add(clientId);
  try {
    const settings = await getRouletteSettings();
    if (!settings.enabled) {
      throw new Error("Рулетка временно отключена");
    }

    const lastSpin = await prisma.clientRouletteSpin.findFirst({
      where: { clientId },
      orderBy: { createdAt: "desc" },
    });

    const cooldownMs = settings.cooldownHours * 3600 * 1000;
    const now = Date.now();
    const lastSpinTime = lastSpin ? lastSpin.createdAt.getTime() : 0;
    const diff = now - lastSpinTime;
    if (diff < cooldownMs) {
      const secondsLeft = Math.ceil((cooldownMs - diff) / 1000);
      throw new Error(`Следующая попытка будет доступна через ${Math.ceil(secondsLeft / 60)} мин.`);
    }

    // Взвешенный случайный выбор сектора
    const sectors = settings.sectors.length > 0 ? settings.sectors : DEFAULT_ROULETTE_SECTORS;
    const totalWeight = sectors.reduce((acc, s) => acc + (s.weight > 0 ? s.weight : 1), 0);
    let rand = Math.random() * totalWeight;
    let wonSector = sectors[0];
    for (const s of sectors) {
      const w = s.weight > 0 ? s.weight : 1;
      if (rand < w) {
        wonSector = s;
        break;
      }
      rand -= w;
    }

    // Применяем выигрыш
    let appliedDescription = wonSector.label;
    if (wonSector.type === "balance" && wonSector.value > 0) {
      await prisma.client.update({
        where: { id: clientId },
        data: { balance: { increment: wonSector.value } },
      });
    } else if (wonSector.type === "days" && wonSector.value > 0) {
      const sub = await resolveTargetSubscription(clientId, targetSubscriptionId);
      if (sub && sub.remnawaveUuid) {
        try {
          const remnaUser = await remnaGetUser(sub.remnawaveUuid);
          const curExpire = extractCurrentExpireAt(remnaUser, sub.expireAt);
          const newExpire = calculateExpireAt(curExpire, wonSector.value);
          await remnaUpdateUser({ uuid: sub.remnawaveUuid, expireAt: newExpire, status: "ACTIVE" });
          await prisma.subscription.update({
            where: { id: sub.id },
            data: {
              expireAt: new Date(newExpire),
              remnaStatus: "ACTIVE",
            },
          });
          const subName = sub.trial?.name || sub.tariff?.name || `Подписка #${sub.subscriptionIndex + 1}`;
          appliedDescription = `${wonSector.label} (${subName})`;
        } catch (e) {
          console.error("Рулетка: ошибка продления Remna-пользователя:", e);
        }
      } else {
        // Если активной подписки нет — конвертируем в рубли на баланс по 10 руб/день
        const fallbackAmount = wonSector.value * 10;
        await prisma.client.update({
          where: { id: clientId },
          data: { balance: { increment: fallbackAmount } },
        });
        appliedDescription = `+${fallbackAmount} ₽ на баланс (нет активной подписки)`;
      }
    } else if (wonSector.type === "traffic" && wonSector.value > 0) {
      const sub = await resolveTargetSubscription(clientId, targetSubscriptionId);
      if (sub && sub.remnawaveUuid) {
        try {
          const remnaUser = await remnaGetUser(sub.remnawaveUuid);
          const curLimit = extractCurrentTrafficLimitBytes(remnaUser, (sub as any).trafficLimitBytes);
          const extraBytes = wonSector.value * 1024 * 1024 * 1024;
          const newLimit = curLimit > 0 ? curLimit + extraBytes : extraBytes;
          await remnaUpdateUser({ uuid: sub.remnawaveUuid, trafficLimitBytes: newLimit });
          await prisma.subscription.update({
            where: { id: sub.id },
            data: { trafficLimitBytes: newLimit },
          });
          const subName = sub.trial?.name || sub.tariff?.name || `Подписка #${sub.subscriptionIndex + 1}`;
          appliedDescription = `${wonSector.label} (${subName})`;
        } catch (e) {
          console.error("Рулетка: ошибка добавления трафика Remna:", e);
        }
      }
    } else if (wonSector.type === "discount" && wonSector.value > 0) {
      await prisma.client.update({
        where: { id: clientId },
        data: {
          personalDiscountPercent: wonSector.value,
          personalDiscountIsOneTime: true,
        },
      });
    }

    // Сохраняем результат вращения
    const spinRecord = await prisma.clientRouletteSpin.create({
      data: {
        clientId,
        rewardType: wonSector.type,
        rewardValue: wonSector.value,
        rewardLabel: appliedDescription,
        sectorId: wonSector.id,
      },
    });

    const nextSpinAt = new Date(Date.now() + cooldownMs).toISOString();

    return {
      spinId: spinRecord.id,
      sectorId: wonSector.id,
      reward: {
        id: wonSector.id,
        type: wonSector.type,
        value: wonSector.value,
        label: appliedDescription,
        color: wonSector.color || "#6366f1",
        icon: wonSector.icon || "gift",
      },
      nextSpinAt,
    };
  } finally {
    activeSpins.delete(clientId);
  }
}

export async function getAdminRouletteStats() {
  const settings = await getRouletteSettings();
  const [totalSpins, spinsByType, recentSpins] = await Promise.all([
    prisma.clientRouletteSpin.count(),
    prisma.clientRouletteSpin.groupBy({
      by: ["rewardType"],
      _count: { id: true },
      _sum: { rewardValue: true },
    }),
    prisma.clientRouletteSpin.findMany({
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
