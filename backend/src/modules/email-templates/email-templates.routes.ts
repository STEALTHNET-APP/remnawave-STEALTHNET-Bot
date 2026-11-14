/**
 * Редактор системных email-шаблонов.
 *
 * Дефолты, хранение и рендер живут в email-templates.service.ts — те же
 * шаблоны используют боевые отправители (см. renderEmailTemplate). Здесь только
 * HTTP-слой редактора.
 *
 * Endpoints:
 *   GET    /api/admin/email-templates/list           — все шаблоны (с defaults)
 *   GET    /api/admin/email-templates/:key            — один шаблон
 *   PUT    /api/admin/email-templates/:key            — обновить (subject + body)
 *   POST   /api/admin/email-templates/:key/preview    — отрендерить с тестовыми переменными
 *   POST   /api/admin/email-templates/:key/send-test  — отправить тестовое письмо
 */

import express, { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireAuth, requireAdminSection } from "../auth/middleware.js";
import { logAdmin } from "../audit/audit.service.js";
import { TEMPLATES, getStoredTemplate, renderTemplate, subjectKey, bodyKey } from "./email-templates.service.js";

function asyncRoute(fn: (req: express.Request, res: express.Response) => Promise<void | express.Response>) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

export const emailTemplatesRouter = Router();
emailTemplatesRouter.use(requireAuth);
emailTemplatesRouter.use(requireAdminSection);

emailTemplatesRouter.get(
  "/list",
  asyncRoute(async (_req, res) => {
    const items = await Promise.all(TEMPLATES.map((t) => getStoredTemplate(t.key)));
    return res.json({ items: items.filter(Boolean) });
  }),
);

emailTemplatesRouter.get(
  "/:key",
  asyncRoute(async (req, res) => {
    const item = await getStoredTemplate(req.params.key);
    if (!item) return res.status(404).json({ message: "Template not found" });
    return res.json(item);
  }),
);

const putSchema = z.object({
  subject: z.string().min(1).max(500),
  body: z.string().min(1).max(50_000),
});

emailTemplatesRouter.put(
  "/:key",
  asyncRoute(async (req, res) => {
    const def = TEMPLATES.find((t) => t.key === req.params.key);
    if (!def) return res.status(404).json({ message: "Template not found" });
    const parsed = putSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid payload", errors: parsed.error.flatten() });

    await prisma.systemSetting.upsert({
      where: { key: subjectKey(def.key) },
      create: { key: subjectKey(def.key), value: parsed.data.subject },
      update: { value: parsed.data.subject },
    });
    await prisma.systemSetting.upsert({
      where: { key: bodyKey(def.key) },
      create: { key: bodyKey(def.key), value: parsed.data.body },
      update: { value: parsed.data.body },
    });

    await logAdmin(req, "email_template.update", { type: "system", id: def.key }, {
      key: def.key,
      subjectLength: parsed.data.subject.length,
      bodyLength: parsed.data.body.length,
    });

    return res.json({ ok: true, ...(await getStoredTemplate(def.key))! });
  }),
);

const previewSchema = z.object({
  vars: z.record(z.string()).optional(),
});

emailTemplatesRouter.post(
  "/:key/preview",
  asyncRoute(async (req, res) => {
    const item = await getStoredTemplate(req.params.key);
    if (!item) return res.status(404).json({ message: "Template not found" });
    const parsed = previewSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid payload", errors: parsed.error.flatten() });

    const { getSystemConfig: getCfg } = await import("../client/client.service.js");
    const cfgForVars = await getCfg();
    const exampleVars: Record<string, string> = {};
    for (const v of item.variables) exampleVars[v.name] = v.example;
    // В превью/тесте подставляем РЕАЛЬНОЕ имя бренда из настроек вместо example-заглушки.
    if ("serviceName" in exampleVars && cfgForVars.serviceName) exampleVars.serviceName = cfgForVars.serviceName;
    const vars = { ...exampleVars, ...(parsed.data.vars ?? {}) };

    return res.json({
      subject: renderTemplate(item.subject, vars),
      body: renderTemplate(item.body, vars),
      vars,
    });
  }),
);

const sendTestSchema = z.object({
  toEmail: z.string().email(),
  vars: z.record(z.string()).optional(),
});

emailTemplatesRouter.post(
  "/:key/send-test",
  asyncRoute(async (req, res) => {
    const item = await getStoredTemplate(req.params.key);
    if (!item) return res.status(404).json({ message: "Template not found" });
    const parsed = sendTestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid payload", errors: parsed.error.flatten() });

    const { getSystemConfig: getCfg } = await import("../client/client.service.js");
    const cfgForVars = await getCfg();
    const exampleVars: Record<string, string> = {};
    for (const v of item.variables) exampleVars[v.name] = v.example;
    // В превью/тесте подставляем РЕАЛЬНОЕ имя бренда из настроек вместо example-заглушки.
    if ("serviceName" in exampleVars && cfgForVars.serviceName) exampleVars.serviceName = cfgForVars.serviceName;
    const vars = { ...exampleVars, ...(parsed.data.vars ?? {}) };

    const subject = renderTemplate(item.subject, vars);
    const body = renderTemplate(item.body, vars);

    try {
      const { sendEmail } = await import("../mail/mail.service.js");
      const config = cfgForVars as unknown as Record<string, unknown>;
      const smtpConfig = {
        host: (config.smtpHost as string) || "",
        port: (config.smtpPort as number) ?? 587,
        secure: (config.smtpSecure as boolean) ?? false,
        user: (config.smtpUser as string) ?? null,
        password: (config.smtpPassword as string) ?? null,
        fromEmail: (config.smtpFromEmail as string) ?? null,
        fromName: (config.smtpFromName as string) ?? null,
        provider: (config.mailProvider === "resend" ? "resend" : "smtp") as "smtp" | "resend",
        resendApiKey: (config.resendApiKey as string) ?? null,
        resendFromEmail: (config.resendFromEmail as string) ?? null,
      };
      const result = await sendEmail(smtpConfig, parsed.data.toEmail, subject, body);
      if (!result.ok) {
        return res.status(500).json({ message: result.error ?? "Failed to send" });
      }
    } catch (e) {
      return res.status(500).json({ message: e instanceof Error ? e.message : "Failed to send" });
    }

    await logAdmin(req, "email_template.send_test", { type: "system", id: item.key }, {
      key: item.key,
      to: parsed.data.toEmail,
    });

    return res.json({ ok: true });
  }),
);
