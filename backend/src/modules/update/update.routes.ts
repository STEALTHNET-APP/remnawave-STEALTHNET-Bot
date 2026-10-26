import { Router } from "express";
import { request } from "node:http";
import { z } from "zod";
import type { ReqAdmin } from "../auth/middleware.js";
import { APP_BUILD } from "../../config/app-version.js";

export const updateRouter = Router();

updateRouter.use((req, res, next) => {
  if ((req as typeof req & ReqAdmin).adminRole !== "ADMIN") {
    return res.status(403).json({ message: "Обновления доступны только администратору" });
  }
  next();
});

export function updaterRequest(path: string, body?: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = request({
      socketPath: process.env.UPDATER_SOCKET || "/run/stealthnet-updater/control.sock",
      path, method: payload ? "POST" : "GET",
      headers: payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {},
    }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        data += chunk;
        if (data.length > 128 * 1024) req.destroy(new Error("Ответ службы обновления слишком большой"));
      });
      res.on("end", () => {
        try { resolve({ status: res.statusCode || 502, data: JSON.parse(data) }); }
        catch { reject(new Error("Некорректный ответ службы обновления")); }
      });
      res.on("error", reject);
    });
    req.setTimeout(5000, () => req.destroy(new Error("Служба обновления не отвечает")));
    req.on("error", reject);
    req.end(payload);
  });
}

const installSchema = z.object({ localChangesId: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict();

const settingsSchema = z.object({ enabled: z.boolean(), channel: z.enum(["stable", "main"]), hourUtc: z.number().int().min(0).max(23), backupRetentionDays: z.number().int().min(1).max(30).default(3) }).strict();

updateRouter.get("/", async (_req, res) => {
  try {
    const result = await updaterRequest("/status");
    res.status(result.status).json({ ...result.data, installed: APP_BUILD, connected: true });
  } catch {
    res.json({ installed: APP_BUILD, connected: false });
  }
});

for (const action of ["check", "install", "settings"] as const) {
  updateRouter.post(`/${action}`, async (req, res) => {
    const parsed = (action === "settings" ? settingsSchema : action === "install" ? installSchema : z.object({}).strict()).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Некорректные параметры обновления" });
    try {
      const result = await updaterRequest(`/${action}`, parsed.data);
      return res.status(result.status).json({ ...result.data, installed: APP_BUILD, connected: true });
    } catch {
      return res.status(503).json({ message: "Служба обновления недоступна. Проверьте её на сервере." });
    }
  });
}
