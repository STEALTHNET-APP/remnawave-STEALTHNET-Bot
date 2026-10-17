import type { Request, Response, NextFunction } from "express";
import { getSystemConfig } from "./client.service.js";
export async function maintenanceGuard(_req: Request, res: Response, next: NextFunction) {
  try {
    const config = await getSystemConfig();
    if (!config.maintenanceEnabled) return next();
    res.setHeader("Retry-After", "60");
    return res.status(503).json({ code: "MAINTENANCE", message: config.maintenanceMessage });
  } catch (error) { return next(error); }
}
