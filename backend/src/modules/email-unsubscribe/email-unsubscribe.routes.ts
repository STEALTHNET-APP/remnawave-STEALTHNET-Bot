import { Router } from "express";
import multer from "multer";
import { prisma } from "../../db.js";
import { env } from "../../config/index.js";
import { readUnsubscribeToken } from "./unsubscribe-token.js";

export const emailUnsubscribeRouter = Router();
const multipart = multer({ limits: { fields: 2, fieldSize: 1024, files: 0 } }).none();

function page(state: "confirm" | "done" | "invalid" | "error", token = ""): string {
  const title = state === "confirm" ? "Отписаться от рассылки?" : state === "done" ? "Вы отписались от рассылки" : state === "invalid" ? "Ссылка недействительна" : "Не удалось сохранить отписку";
  const text = state === "confirm" ? "Новости, акции и автоматические email-рассылки больше не будут приходить на этот адрес." : state === "done" ? "Больше не будем отправлять новости, акции и автоматические email-рассылки на этот адрес." : state === "invalid" ? "Откройте ссылку «Отписаться» из полученного письма." : "Попробуйте ещё раз немного позже. Настройки пока не изменились.";
  const form = state === "confirm" ? `<form method="post" action="?token=${encodeURIComponent(token)}"><input type="hidden" name="confirm" value="1"><button type="submit">Отписаться от рассылки</button></form>` : "";
  return `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#0b0e14;color:#f8fafc;font-family:system-ui,sans-serif}main{width:100%;max-width:480px;padding:36px;border:1px solid #2a303d;border-radius:24px;background:#141923}h1{font-size:26px;line-height:1.25;margin:0 0 20px}p{color:#b5bfce;line-height:1.6}small{display:block;color:#909caf;line-height:1.6;margin-top:24px}button{width:100%;border:0;border-radius:12px;padding:16px;margin-top:16px;background:#ec3c68;color:white;font:600 15px system-ui;cursor:pointer}button:focus-visible{outline:3px solid white;outline-offset:3px}</style></head><body><main><h1>${title}</h1><p>${text}</p>${form}${state === "confirm" || state === "done" ? "<small>Сброс пароля, подтверждение почты и служебные уведомления продолжат приходить. Сообщения в Telegram не изменятся.</small>" : ""}</main></body></html>`;
}

emailUnsubscribeRouter.use((_req, res, next) => {
  res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" });
  next();
});

emailUnsubscribeRouter.get("/", async (req, res) => {
  const email = readUnsubscribeToken(req.query.token, env.JWT_SECRET);
  if (!email) { res.status(400).type("html").send(page("invalid")); return; }
  try {
    const existing = await prisma.emailUnsubscribe.findUnique({ where: { email } });
    res.type("html").send(page(existing ? "done" : "confirm", String(req.query.token)));
  } catch {
    res.status(503).type("html").send(page("error"));
  }
});

emailUnsubscribeRouter.post("/", multipart, async (req, res) => {
  const email = readUnsubscribeToken(req.query.token, env.JWT_SECRET);
  if (!email || (req.body?.confirm !== "1" && req.body?.["List-Unsubscribe"] !== "One-Click")) {
    res.status(400).type("html").send(page("invalid"));
    return;
  }
  try {
    await prisma.emailUnsubscribe.upsert({ where: { email }, create: { email }, update: {} });
    res.type("html").send(page("done"));
  } catch {
    res.status(503).type("html").send(page("error"));
  }
});
