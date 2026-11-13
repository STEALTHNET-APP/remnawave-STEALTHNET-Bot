import express, { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { hashPassword } from "../auth/auth.service.js";

export const adminAdminsRouter = Router();

function asyncRoute(
  fn: (req: express.Request, res: express.Response) => Promise<void | express.Response>
) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

// ═══════════════════════════════════════════════════════════════
//  МЕНЕДЖЕРЫ (только для роли ADMIN)
// ═══════════════════════════════════════════════════════════════

export const ADMIN_ALLOWED_SECTIONS = [
  // Overview
  "dashboard",
  "remna-nodes", // виджет нод Remna на дашборде
  "analytics",
  "sales-report",
  "traffic-abuse",
  // Management
  "clients",
  "proxy",
  "singbox",
  "backup",
  "tickets",
  "withdrawals", // Заявки на вывод USDT
  // Subscription
  "tariffs",
  "trials", // Trial-пресеты (мульти-триал система)
  "auto-renew", // Конструктор уведомлений автосписания
  "promo",
  "promo-codes",
  "marketing",
  "referral-network",
  "referrals", // Страница «Рефералка» (статистика рефералов)
  "secondary-subscriptions",
  // Tools
  "video-instructions",
  "broadcast",
  "auto-broadcast",
  "contests",
  "tour-constructor",
  "promo-vpn", // Продвижение VPN через Gramads
  "marketplace",
  // Settings
  "settings",
  "languages",
  "api-keys",
  "bots", // Боты-клоны
  "antibot",
  "diagnostics",
  "webhook-inbox",
  "audit", // Аудит-лог
] as const;

/** Список админов и менеджеров (только ADMIN). */
adminAdminsRouter.get("/", asyncRoute(async (req, res) => {
  const ext = req as unknown as { adminRole?: string };
  if (ext.adminRole !== "ADMIN") {
    return res.status(403).json({ message: "Only admin can list managers" });
  }
  const list = await prisma.admin.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      role: true,
      allowedSections: true,
      mustChangePassword: true,
      createdAt: true,
    },
  });
  const allowedSections = (raw: string | null): string[] => {
    if (!raw?.trim()) return [];
    try {
      const p = JSON.parse(raw) as unknown;
      // возвращаем только секции, action:* — отдельный endpoint.
      return Array.isArray(p) ? p.filter((s): s is string => typeof s === "string" && !s.startsWith("action:")) : [];
    } catch {
      return [];
    }
  };
  return res.json(
    list.map((a) => ({
      id: a.id,
      email: a.email,
      role: a.role,
      allowedSections: allowedSections(a.allowedSections),
      mustChangePassword: a.mustChangePassword,
      createdAt: a.createdAt.toISOString(),
    }))
  );
}));

const createManagerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Min 8 characters"),
  allowedSections: z.array(z.string()).optional(),
});

/** Создать менеджера (только ADMIN). */
adminAdminsRouter.post("/", asyncRoute(async (req, res) => {
  const ext = req as unknown as { adminRole?: string };
  if (ext.adminRole !== "ADMIN") {
    return res.status(403).json({ message: "Only admin can create managers" });
  }
  const body = createManagerSchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  }
  const existing = await prisma.admin.findUnique({ where: { email: body.data.email } });
  if (existing) {
    return res.status(400).json({ message: "Email already registered" });
  }
  const sections = (body.data.allowedSections ?? []).filter((s) =>
    (ADMIN_ALLOWED_SECTIONS as readonly string[]).includes(s)
  );
  const passwordHash = await hashPassword(body.data.password);
  const admin = await prisma.admin.create({
    data: {
      email: body.data.email,
      passwordHash,
      mustChangePassword: true,
      role: "MANAGER",
      allowedSections: JSON.stringify(sections),
    },
    select: { id: true, email: true, role: true, allowedSections: true, createdAt: true },
  });
  const allowed = admin.allowedSections
    ? (() => {
        try {
          const p = JSON.parse(admin.allowedSections) as unknown;
          return Array.isArray(p) ? p.filter((s): s is string => typeof s === "string") : [];
        } catch {
          return [];
        }
      })()
    : [];
  return res.status(201).json({
    id: admin.id,
    email: admin.email,
    role: admin.role,
    allowedSections: allowed,
    createdAt: admin.createdAt.toISOString(),
  });
}));

const updateManagerSchema = z.object({
  allowedSections: z.array(z.string()).optional(),
  password: z.string().min(8, "Min 8 characters").optional(),
});

/** Обновить менеджера (разделы доступа и/или пароль). Только ADMIN. */
adminAdminsRouter.patch("/:id", asyncRoute(async (req, res) => {
  const ext = req as unknown as { adminRole?: string; adminId?: string };
  if (ext.adminRole !== "ADMIN") {
    return res.status(403).json({ message: "Only admin can update managers" });
  }
  const body = updateManagerSchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  }
  const target = await prisma.admin.findUnique({ where: { id: req.params.id } });
  if (!target) return res.status(404).json({ message: "Not found" });
  if (target.role === "ADMIN") {
    return res.status(403).json({ message: "Cannot modify full admin" });
  }
  const updates: { allowedSections?: string; passwordHash?: string } = {};
  if (body.data.allowedSections !== undefined) {
    const sections = body.data.allowedSections.filter((s) =>
      (ADMIN_ALLOWED_SECTIONS as readonly string[]).includes(s)
    );
    // сохраняем actions (action:*) из текущего значения,
    // иначе PATCH секций стирает права из Permissions-диалога. Парсим как JSON или CSV
    // (для обратной совместимости со старыми CSV-записями от admin-permissions).
    const existingRaw = target.allowedSections ?? "";
    let existingItems: string[] = [];
    try {
      const p = JSON.parse(existingRaw) as unknown;
      if (Array.isArray(p)) existingItems = p.filter((s): s is string => typeof s === "string");
    } catch {
      existingItems = existingRaw.split(",").map((s) => s.trim()).filter(Boolean);
    }
    const existingActions = existingItems.filter((s) => s.startsWith("action:"));
    updates.allowedSections = JSON.stringify([...sections, ...existingActions]);
  }
  if (body.data.password?.trim()) {
    updates.passwordHash = await hashPassword(body.data.password);
  }
  const updated = await prisma.admin.update({
    where: { id: req.params.id },
    data: updates,
    select: { id: true, email: true, role: true, allowedSections: true },
  });
  const allowed = updated.allowedSections
    ? (() => {
        try {
          const p = JSON.parse(updated.allowedSections) as unknown;
          // только секции, action:* — отдельный endpoint.
          return Array.isArray(p) ? p.filter((s): s is string => typeof s === "string" && !s.startsWith("action:")) : [];
        } catch {
          return [];
        }
      })()
    : [];
  return res.json({
    id: updated.id,
    email: updated.email,
    role: updated.role,
    allowedSections: allowed,
  });
}));

/** Удалить менеджера. Только ADMIN. Нельзя удалить полного админа. */
adminAdminsRouter.delete("/:id", asyncRoute(async (req, res) => {
  const ext = req as unknown as { adminRole?: string; adminId?: string };
  if (ext.adminRole !== "ADMIN") {
    return res.status(403).json({ message: "Only admin can delete managers" });
  }
  if (req.params.id === ext.adminId) {
    return res.status(400).json({ message: "Cannot delete yourself" });
  }
  const target = await prisma.admin.findUnique({ where: { id: req.params.id } });
  if (!target) return res.status(404).json({ message: "Not found" });
  if (target.role === "ADMIN") {
    return res.status(403).json({ message: "Cannot delete full admin" });
  }
  await prisma.admin.delete({ where: { id: req.params.id } });
  return res.json({ success: true });
}));
