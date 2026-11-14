/**
 * Внутренние эндпоинты для консоль-контейнера (host-network Go wish-app).
 * Гейт: заголовок X-Internal-Key == JWT_SECRET (консоль получает JWT_SECRET через env).
 * НЕ для публики: даже если nginx проксирует /api/internal/*, без секрета — 401.
 *   GET /api/internal/console/creds    — user/password/port (консоль биндит порт + авторизует SSH)
 *   GET /api/internal/console/metrics  — данные для дашборда (health + бизнес + ресурсы сервера)
 */
import os from "node:os";
import { Router } from "express";
import { env } from "../../config/index.js";
import { prisma } from "../../db.js";
import { aggregateHealth } from "../diagnostics/health.service.js";

export const consoleInternalRouter = Router();

consoleInternalRouter.use((req, res, next) => {
  const key = req.header("x-internal-key");
  if (!key || key !== env.JWT_SECRET) {
    return res.status(401).json({ message: "unauthorized" });
  }
  next();
});

async function getSetting(k: string): Promise<string | null> {
  const r = await prisma.systemSetting.findUnique({ where: { key: k } });
  return r?.value ?? null;
}

consoleInternalRouter.get("/creds", async (_req, res) => {
  const [user, password, port] = await Promise.all([
    getSetting("console_user"),
    getSetting("console_password"),
    getSetting("console_port"),
  ]);
  res.json({ user: user ?? "", password: password ?? "", port: Number(port) || 0 });
});

consoleInternalRouter.get("/metrics", async (_req, res) => {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const soon = new Date(now.getTime() + 3 * 24 * 3600 * 1000);

  const n = (v: unknown, d = 0): number =>
    typeof v === "number" && Number.isFinite(v) ? v : d;

  const [
    health,
    total,
    blocked,
    newToday,
    newWeek,
    activeSubs,
    autoRenewSubs,
    expiringSoon,
    paidToday,
    paidMonth,
    lastPaid,
    serviceName,
  ] = await Promise.all([
    aggregateHealth().catch(() => null),
    prisma.client.count().catch(() => 0),
    prisma.client.count({ where: { isBlocked: true } }).catch(() => 0),
    prisma.client.count({ where: { createdAt: { gte: startOfDay } } }).catch(() => 0),
    prisma.client.count({ where: { createdAt: { gte: weekAgo } } }).catch(() => 0),
    prisma.subscription
      .count({ where: { expireAt: { gt: now }, tariffId: { not: null } } })
      .catch(() => 0),
    prisma.subscription
      .count({ where: { autoRenewEnabled: true, expireAt: { gt: now } } })
      .catch(() => 0),
    prisma.subscription
      .count({ where: { expireAt: { gt: now, lt: soon } } })
      .catch(() => 0),
    prisma.payment
      .aggregate({
        _sum: { amount: true },
        _count: true,
        where: { status: "PAID", createdAt: { gte: startOfDay } },
      })
      .catch(() => ({ _sum: { amount: 0 }, _count: 0 })),
    prisma.payment
      .aggregate({
        _sum: { amount: true },
        _count: true,
        where: { status: "PAID", createdAt: { gte: startOfMonth } },
      })
      .catch(() => ({ _sum: { amount: 0 }, _count: 0 })),
    prisma.payment
      .findFirst({ where: { status: "PAID" }, orderBy: { createdAt: "desc" }, select: { currency: true } })
      .catch(() => null),
    getSetting("service_name"),
  ]);

  let loadAvg = 0;
  try {
    loadAvg = Number((os.loadavg()[0] ?? 0).toFixed(2));
  } catch {
    /* loadavg недоступен на некоторых платформах */
  }

  res.json({
    serviceName: serviceName ?? "STEALTHNET",
    health,
    clients: { total, blocked, newToday, newWeek },
    subscriptions: { active: activeSubs, autoRenew: autoRenewSubs, expiringSoon },
    revenue: {
      today: n(paidToday._sum.amount),
      todayCount: n(paidToday._count),
      month: n(paidMonth._sum.amount),
      monthCount: n(paidMonth._count),
      currency: lastPaid?.currency ?? "RUB",
    },
    server: {
      hostname: os.hostname(),
      uptimeSec: Math.round(os.uptime()),
      loadAvg,
      cpuCount: os.cpus().length,
    },
    ts: Date.now(),
  });
});
