import { Router, Request, Response } from "express";
import { requireClientAuth } from "../client/client.middleware.js";
import { requireAuth } from "../auth/middleware.js";
import {
  getRouletteStatus,
  spinRoulette,
  getAdminRouletteStats,
  updateRouletteSettings,
} from "./roulette.service.js";

type AuthedReq = Request & { clientId: string };

export const rouletteClientRouter = Router();
rouletteClientRouter.use(requireClientAuth);

rouletteClientRouter.get("/", async (req: Request, res: Response) => {
  try {
    const clientId = (req as AuthedReq).clientId;
    const status = await getRouletteStatus(clientId);
    res.json(status);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Ошибка получения статуса рулетки" });
  }
});

rouletteClientRouter.post("/spin", async (req: Request, res: Response) => {
  try {
    const clientId = (req as AuthedReq).clientId;
    const subscriptionId = typeof req.body?.subscriptionId === "string" ? req.body.subscriptionId.trim() : undefined;
    const result = await spinRoulette(clientId, subscriptionId);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Ошибка вращения рулетки" });
  }
});

export const rouletteAdminRouter = Router();
rouletteAdminRouter.use(requireAuth);

rouletteAdminRouter.get("/", async (_req: Request, res: Response) => {
  try {
    const data = await getAdminRouletteStats();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Ошибка получения настроек рулетки" });
  }
});

rouletteAdminRouter.put("/", async (req: Request, res: Response) => {
  try {
    const updated = await updateRouletteSettings(req.body);
    res.json(updated);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Ошибка сохранения настроек рулетки" });
  }
});
