/**
 * Отправка писем: SMTP (nodemailer) ИЛИ Resend API — выбор через настройку `mail_provider`.
 *
 * Здесь только транспорт (sendEmail). Контент системных писем
 * (верификация, привязка почты, сброс пароля и т.п.) не хардкодится в этом
 * файле — он рендерится из редактируемых шаблонов админки:
 * email-templates.service.ts → renderEmailTemplate(key, vars).
 *
 * Все отправители собирают конфиг через mailConfigFromSystem(config) — единый
 * источник, чтобы переключение SMTP↔Resend работало сразу во всех письмах.
 */

import nodemailer from "nodemailer";

export type MailProvider = "smtp" | "resend";

export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string | null;
  password: string | null;
  fromEmail: string | null;
  fromName: string | null;
  /** Выбранный провайдер отправки (по умолчанию smtp). */
  provider?: MailProvider;
  /** Resend: API-ключ (re_...). */
  resendApiKey?: string | null;
  /** Resend: адрес отправителя на верифицированном домене (fallback — fromEmail). */
  resendFromEmail?: string | null;
};

/** SMTP настроен (хватает параметров для отправки). */
export function isSmtpConfigured(config: SmtpConfig): boolean {
  return Boolean(config.host && config.port && config.fromEmail);
}

/** Resend настроен (есть ключ и адрес отправителя). */
export function isResendConfigured(config: SmtpConfig): boolean {
  return Boolean(config.resendApiKey && (config.resendFromEmail || config.fromEmail));
}

/** Настроен ли ВЫБРАННЫЙ провайдер (единый гейт для всех auth-флоу). */
export function isMailConfigured(config: SmtpConfig): boolean {
  return config.provider === "resend" ? isResendConfigured(config) : isSmtpConfigured(config);
}

/**
 * Собрать транспорт-конфиг из системного конфига (getSystemConfig()).
 * Единственная точка, где camelCase-поля настроек превращаются в MailConfig —
 * используется всеми отправителями (регистрация/сброс/рассылки/шаблоны).
 */
export function mailConfigFromSystem(c: {
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpSecure?: boolean | null;
  smtpUser?: string | null;
  smtpPassword?: string | null;
  smtpFromEmail?: string | null;
  smtpFromName?: string | null;
  mailProvider?: string | null;
  resendApiKey?: string | null;
  resendFromEmail?: string | null;
}): SmtpConfig {
  return {
    host: c.smtpHost || "",
    port: c.smtpPort ?? 587,
    secure: c.smtpSecure ?? false,
    user: c.smtpUser ?? null,
    password: c.smtpPassword ?? null,
    fromEmail: c.smtpFromEmail ?? null,
    fromName: c.smtpFromName ?? null,
    provider: c.mailProvider === "resend" ? "resend" : "smtp",
    resendApiKey: c.resendApiKey ?? null,
    resendFromEmail: c.resendFromEmail ?? null,
  };
}

export type EmailAttachment = { filename: string; content: Buffer };

/** Branded wrapper for free-form operational notifications. */
export function brandedNotificationEmail(opts: {
  serviceName: string;
  title: string;
  bodyHtml: string;
  btnLabel?: string;
  btnLink?: string;
}): string {
  const { serviceName, title, bodyHtml, btnLabel, btnLink } = opts;
  const button = btnLabel && btnLink
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:8px;"><tr><td style="border-radius:12px;background:linear-gradient(135deg,#10b981 0%,#059669 100%);box-shadow:0 6px 16px rgba(16,185,129,0.35);"><a href="${btnLink}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:15px 38px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px;">${btnLabel}</a></td></tr></table>`
    : "";

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;margin:0;padding:32px 12px;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;"><tr><td align="center"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 6px 28px rgba(15,23,42,0.08);"><tr><td style="background:linear-gradient(135deg,#0b1220 0%,#0f2a22 100%);padding:30px 36px;text-align:center;"><span style="font-size:26px;font-weight:800;color:#ffffff;letter-spacing:0.4px;">🔐 ${serviceName}</span></td></tr><tr><td style="padding:38px 40px 8px 40px;"><h1 style="margin:0 0 14px;font-size:23px;line-height:1.3;color:#0f172a;font-weight:700;">${title}</h1><div style="margin:0 0 22px;font-size:15px;line-height:1.65;color:#475569;">${bodyHtml}</div>${button}</td></tr><tr><td style="padding:30px 40px 0;"><div style="border-top:1px solid #eef0f3;font-size:1px;line-height:1px;">&nbsp;</div></td></tr><tr><td style="padding:18px 40px 34px;text-align:center;"><p style="margin:0;font-size:12px;line-height:1.6;color:#aeb6c2;">${serviceName}</p></td></tr></table></td></tr></table>`;
}

/**
 * Отправить произвольное письмо выбранным провайдером. Опционально — вложения.
 */
export async function sendEmail(
  config: SmtpConfig,
  to: string,
  subject: string,
  html: string,
  attachments?: EmailAttachment[],
  headers?: Record<string, string>,
): Promise<{ ok: boolean; error?: string }> {
  if (config.provider === "resend") {
    return sendViaResend(config, to, subject, html, attachments, headers);
  }
  return sendViaSmtp(config, to, subject, html, attachments, headers);
}

/** Транспорт Resend (HTTP API, без SMTP). */
async function sendViaResend(
  config: SmtpConfig,
  to: string,
  subject: string,
  html: string,
  attachments?: EmailAttachment[],
  headers?: Record<string, string>,
): Promise<{ ok: boolean; error?: string }> {
  if (!isResendConfigured(config)) {
    return { ok: false, error: "Resend not configured" };
  }
  const fromEmail = config.resendFromEmail || config.fromEmail!;
  const from = config.fromName ? `${config.fromName} <${fromEmail}>` : fromEmail;
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html,
        ...(headers ? { headers } : {}),
        ...(attachments?.length
          ? { attachments: attachments.map((a) => ({ filename: a.filename, content: a.content.toString("base64") })) }
          : {}),
      }),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return { ok: false, error: `Resend ${resp.status}: ${text.slice(0, 300)}` };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/** Транспорт SMTP (nodemailer). */
async function sendViaSmtp(
  config: SmtpConfig,
  to: string,
  subject: string,
  html: string,
  attachments?: EmailAttachment[],
  headers?: Record<string, string>,
): Promise<{ ok: boolean; error?: string }> {
  if (!isSmtpConfigured(config)) {
    return { ok: false, error: "SMTP not configured" };
  }

  const auth = config.user && config.password ? { user: config.user, pass: config.password } : undefined;
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
  });

  const from = config.fromName
    ? `"${config.fromName}" <${config.fromEmail}>`
    : config.fromEmail!;

  try {
    await transporter.sendMail({
      from,
      to,
      subject,
      html,
      ...(headers ? { headers } : {}),
      ...(attachments?.length ? { attachments: attachments.map((a) => ({ filename: a.filename, content: a.content })) } : {}),
    });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
