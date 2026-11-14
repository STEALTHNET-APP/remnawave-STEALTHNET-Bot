/**
 * Админ-роуты SSH-консоли:
 *   GET  /api/admin/console            — данные доступа (юзер/порт/пароль/IP + готовая ssh-команда)
 *   POST /api/admin/console/regenerate — перегенерировать доступ
 */
import { Router } from "express";
import { requireAuth, requireAdminSection } from "../auth/middleware.js";
import { getConsoleAccess, regenerateConsoleAccess } from "./console.service.js";

export const consoleAdminRouter = Router();
consoleAdminRouter.use(requireAuth);
consoleAdminRouter.use(requireAdminSection);

consoleAdminRouter.get("/", async (_req, res) => {
  res.json(await getConsoleAccess());
});

consoleAdminRouter.post("/regenerate", async (_req, res) => {
  res.json(await regenerateConsoleAccess());
});
