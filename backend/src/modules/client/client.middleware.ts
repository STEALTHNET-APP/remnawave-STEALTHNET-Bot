import { Request, Response, NextFunction } from "express";
import { verifyClientToken } from "./client.service.js";
import { env } from "../../config/index.js";
import { prisma } from "../../db.js";
import { probeRemnaHealth } from "../remna/remna.client.js";

const BEARER = "Bearer ";

export async function requireClientAuth(req: Request, res: Response, next: NextFunction) {
  const raw = req.headers.authorization;
  const token = typeof raw === "string" && raw.startsWith(BEARER) ? raw.slice(BEARER.length) : null;

  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const payload = verifyClientToken(token);
  if (!payload) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }

  const client = await prisma.client.findUnique({ where: { id: payload.clientId } });
  if (!client || client.isBlocked) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  (req as Request & { clientId: string; client: typeof client }).clientId = client.id;
  (req as Request & { clientId: string; client: typeof client }).client = client;
  next();
}

export function requireRemnaOnline(_req: Request, res: Response, next: NextFunction) {
  void probeRemnaHealth().then(online => {
    if (!online) {
      res.status(503).json({ code: "REMNA_TEMPORARILY_OFFLINE", message: "Панель VPN временно недоступна. Повторите действие позже." });
    } else next();
  }).catch(next);
}
