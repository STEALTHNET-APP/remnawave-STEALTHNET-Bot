import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { botTerms } from "./terms.service.js";

export const botTermsRouter = Router();
botTermsRouter.use((req, res, next) => {
  const expected = Buffer.from((process.env.BOT_TOKEN ?? "").trim());
  const token = Buffer.from(req.get("X-Telegram-Bot-Token") ?? "");
  if (!expected.length || token.length !== expected.length || !timingSafeEqual(token, expected)) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
  next();
});
const telegramId = z.string().regex(/^[1-9][0-9]{0,15}$/).refine((value) => Number.isSafeInteger(Number(value)));
const statusSchema = z.object({ telegramId, pendingStart: z.string().max(128).regex(/^[A-Za-z0-9_-]*$/).optional() }).strict();
const acceptSchema = z.object({ telegramId, version: z.string().regex(/^[a-f0-9]{32}$/) }).strict();

botTermsRouter.post("/status", async (req, res) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: "Invalid request" }); return; }
  try {
    res.json(await botTerms(parsed.data.telegramId, { pendingStart: parsed.data.pendingStart }));
  } catch {
    res.status(503).json({ message: "Не удалось проверить согласие. Попробуйте позже." });
  }
});
botTermsRouter.post("/accept", async (req, res) => {
  const parsed = acceptSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: "Invalid request" }); return; }
  try {
    const result = await botTerms(parsed.data.telegramId, { acceptVersion: parsed.data.version });
    res.status(result.stale ? 409 : 200).json(result);
  } catch {
    res.status(503).json({ message: "Не удалось сохранить согласие. Попробуйте позже." });
  }
});
