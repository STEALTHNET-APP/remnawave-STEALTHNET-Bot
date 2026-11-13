import type { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import { env } from "../../config/index.js";
import { sendEmail, type SmtpConfig, type EmailAttachment } from "../mail/mail.service.js";
import { normalizeEmail, signUnsubscribeToken } from "./unsubscribe-token.js";

export function unsubscribeUrl(publicAppUrl: string | null | undefined, email: string): string {
  let base: URL;
  try { base = new URL(publicAppUrl?.trim() || ""); } catch { throw new Error("Для отписки укажите HTTPS-адрес кабинета в настройках"); }
  if (base.protocol !== "https:" || base.username || base.password) throw new Error("Для отписки укажите HTTPS-адрес кабинета в настройках");
  base.pathname = `${base.pathname.replace(/\/+$/, "")}/api/public/email-unsubscribe`;
  base.search = "";
  base.hash = "";
  base.searchParams.set("token", signUnsubscribeToken(email, env.JWT_SECRET));
  return base.href;
}

export async function isEmailUnsubscribed(email: string): Promise<boolean> {
  return Boolean(await prisma.emailUnsubscribe.findUnique({ where: { email: normalizeEmail(email) } }));
}

export async function subscribedEmailFilter(): Promise<Prisma.ClientWhereInput> {
  const blocked = await prisma.emailUnsubscribe.findMany({ select: { email: true } });
  return { email: { not: null, ...(blocked.length ? { notIn: blocked.map(row => row.email), mode: "insensitive" as const } : {}) } };
}

export async function sendBroadcastEmail(
  config: SmtpConfig,
  publicAppUrl: string | null | undefined,
  to: string,
  subject: string,
  html: string,
  attachments?: EmailAttachment[],
): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  try {
    const email = normalizeEmail(to);
    if (await isEmailUnsubscribed(email)) {
      return { ok: false, skipped: true, error: "Получатель отписался от email-рассылок" };
    }
    const url = unsubscribeUrl(publicAppUrl, email);
    const escapedUrl = url.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    const footer = `<div style="padding:24px 16px;text-align:center;font:13px/1.6 Arial,sans-serif;color:#64748b;border-top:1px solid #e2e8f0;margin-top:24px">Не хотите получать рассылки? <a href="${escapedUrl}" style="color:#475569;text-decoration:underline">Отписаться от рассылки</a><br>Письма для входа и важные уведомления продолжат приходить.</div>`;
    const content = /<\/body\s*>/i.test(html) ? html.replace(/<\/body\s*>/i, footer + "</body>") : html + footer;
    return await sendEmail(config, email, subject, content, attachments, {
      "List-Unsubscribe": `<${url}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Не удалось подготовить рассылку" };
  }
}
