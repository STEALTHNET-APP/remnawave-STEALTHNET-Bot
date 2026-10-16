import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import type { ReqAdmin } from "../auth/middleware.js";
import { getSystemConfig } from "../client/client.service.js";
import { isMailConfigured, mailConfigFromSystem, sendEmail } from "./mail.service.js";
import { logAdmin } from "../audit/audit.service.js";

export const mailTestRouter = Router();
const schema = z.object({ toEmail: z.string().trim().email().max(254) }).strict();

mailTestRouter.use((req, res, next) => {
  if ((req as typeof req & ReqAdmin).adminRole !== "ADMIN") {
    return res.status(403).json({ message: "Проверка почты доступна только администратору" });
  }
  next();
});

mailTestRouter.post("/", rateLimit({
  windowMs: 60_000,
  limit: 5,
  keyGenerator: (req) => (req as typeof req & ReqAdmin).adminId,
  message: { message: "Слишком много проверок. Попробуйте через минуту." },
}), async (req, res, next) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Укажите корректный email получателя" });
  try {
    const config = mailConfigFromSystem(await getSystemConfig());
    if (!isMailConfigured(config)) {
      return res.status(400).json({ message: "Сначала сохраните настройки почтового сервиса" });
    }
    const sent = await sendEmail(config, parsed.data.toEmail, "Проверка отправки почты",
      "<p>Это тестовое письмо из панели управления. Отправка почты работает.</p>");
    if (!sent.ok) {
      return res.status(502).json({ message: "Почтовый сервис не принял письмо. Проверьте адрес отправителя, доступы и настройки подключения." });
    }
    await logAdmin(req, "mail.send_test", { type: "system", id: "mail" }, { to: parsed.data.toEmail });
    return res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});
