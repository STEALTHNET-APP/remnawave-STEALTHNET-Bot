/**
 * Уведомления клиентов об ответах на тикеты (Telegram & Email).
 */

import { prisma } from "../../db.js";
import { getSystemConfig } from "../client/client.service.js";
import { sendTelegramToUser } from "../notification/telegram-notify.service.js";
import {
  sendEmail,
  mailConfigFromSystem,
  isMailConfigured,
  brandedNotificationEmail,
} from "../mail/mail.service.js";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatTicketReplySnippet(content: string, attachmentsCount = 0, isEn = false): string {
  const snippet = content.trim();
  const hasAttachments = Boolean(attachmentsCount && attachmentsCount > 0);
  if (!snippet && hasAttachments) {
    return isEn ? "📎 (Attached files)" : "📎 (Прикреплены файлы)";
  }
  if (snippet.length > 300) {
    return `${snippet.slice(0, 297)}...`;
  }
  return snippet;
}

export function buildTelegramReplyPayload(opts: {
  subject: string;
  snippet: string;
  attachmentsCount?: number;
  hasText: boolean;
  ticketUrl?: string;
  isEn?: boolean;
}): {
  text: string;
  replyMarkup?: {
    inline_keyboard: (
      | { text: string; web_app: { url: string } }
      | { text: string; url: string }
    )[][];
  };
} {
  const { subject, snippet, attachmentsCount, hasText, ticketUrl, isEn } = opts;
  const header = isEn
    ? "💬 <b>Support Reply</b>"
    : "💬 <b>Ответ службы поддержки</b>";
  const intro = isEn
    ? `A new reply has been posted to your ticket «<b>${escapeHtml(subject)}</b>»:`
    : `По вашему обращению «<b>${escapeHtml(subject)}</b>» поступил ответ:`;
  const quote = snippet ? `\n\n<blockquote>${escapeHtml(snippet)}</blockquote>` : "";
  const hasAttachments = Boolean(attachmentsCount && attachmentsCount > 0);
  const attachHint = hasAttachments && hasText
    ? `\n\n📎 <i>${isEn ? `Attached files: ${attachmentsCount}` : `Прикреплено файлов: ${attachmentsCount}`}</i>`
    : "";

  const text = `${header}\n\n${intro}${quote}${attachHint}`;

  let replyMarkup:
    | {
        inline_keyboard: (
          | { text: string; web_app: { url: string } }
          | { text: string; url: string }
        )[][];
      }
    | undefined = undefined;

  if (ticketUrl) {
    const label = isEn ? "💬 Open Ticket" : "💬 Открыть обращение";
    const button = ticketUrl.startsWith("https://")
      ? { text: label, web_app: { url: ticketUrl } }
      : { text: label, url: ticketUrl };
    replyMarkup = {
      inline_keyboard: [[button]],
    };
  }

  return { text, replyMarkup };
}

export function buildEmailReplyPayload(opts: {
  serviceName: string;
  subject: string;
  snippet: string;
  attachmentsCount?: number;
  ticketUrl?: string;
  isEn?: boolean;
}): { emailSubject: string; title: string; html: string } {
  const { serviceName, subject, snippet, attachmentsCount, ticketUrl, isEn } = opts;
  const emailSubject = isEn
    ? `💬 Support reply on ticket "${subject}" — ${serviceName}`
    : `💬 Ответ службы поддержки по обращению «${subject}» — ${serviceName}`;

  const title = isEn ? "New Support Reply" : "Новый ответ службы поддержки";
  const introHtml = isEn
    ? `<p>A support agent has replied to your ticket <b>«${escapeHtml(subject)}»</b>:</p>`
    : `<p>Служба поддержки ответила на ваше обращение <b>«${escapeHtml(subject)}»</b>:</p>`;

  const quoteHtml = snippet
    ? `<blockquote style="margin: 16px 0; padding: 14px 18px; background: #f8fafc; border-left: 4px solid #10b981; border-radius: 6px; font-style: normal; color: #334155; line-height: 1.6; white-space: pre-wrap;">${escapeHtml(snippet)}</blockquote>`
    : "";

  const hasAttachments = Boolean(attachmentsCount && attachmentsCount > 0);
  const attachHtml = hasAttachments
    ? `<p style="font-size: 13px; color: #64748b; margin-top: 8px;">📎 ${isEn ? `Attachments: ${attachmentsCount}` : `Прикреплено файлов: ${attachmentsCount}`}</p>`
    : "";

  const bodyHtml = `${introHtml}${quoteHtml}${attachHtml}`;

  const html = brandedNotificationEmail({
    serviceName,
    title,
    bodyHtml,
    btnLabel: isEn ? "Open Ticket" : "Перейти к тикету",
    btnLink: ticketUrl || undefined,
  });

  return { emailSubject, title, html };
}

export interface TicketReplyClientNotifyParams {
  ticketId: string;
  clientId: string;
  replyContent: string;
  attachmentsCount?: number;
}

export async function notifyClientAboutSupportReply(
  params: TicketReplyClientNotifyParams,
): Promise<void> {
  const [ticket, client] = await Promise.all([
    prisma.ticket.findUnique({
      where: { id: params.ticketId },
      select: { id: true, subject: true, status: true },
    }),
    prisma.client.findUnique({
      where: { id: params.clientId },
      select: { id: true, email: true, telegramId: true, preferredLang: true },
    }),
  ]);

  if (!ticket || !client) return;

  const config = await getSystemConfig();
  const serviceName = config.serviceName?.trim() || "STEALTHNET";
  const baseUrl = (config.publicAppUrl || "").replace(/\/+$/, "");
  const isEn = (client.preferredLang || "").toLowerCase() === "en";

  const ticketUrl = baseUrl ? `${baseUrl}/cabinet/tickets?id=${ticket.id}` : "";
  const snippet = formatTicketReplySnippet(params.replyContent, params.attachmentsCount, isEn);
  const hasText = Boolean(params.replyContent.trim());

  // 1. Отправка в Telegram
  if (client.telegramId?.trim()) {
    const { text, replyMarkup } = buildTelegramReplyPayload({
      subject: ticket.subject,
      snippet,
      attachmentsCount: params.attachmentsCount,
      hasText,
      ticketUrl: ticketUrl || undefined,
      isEn,
    });

    sendTelegramToUser(client.telegramId.trim(), text, null, replyMarkup).catch((err) => {
      console.warn(`[ticket-notify] failed to send Telegram notice to client ${client.id}:`, err);
    });
  }

  // 2. Отправка на Email
  if (client.email?.trim()) {
    const mailConfig = mailConfigFromSystem(config);
    if (isMailConfigured(mailConfig)) {
      const { emailSubject, html } = buildEmailReplyPayload({
        serviceName,
        subject: ticket.subject,
        snippet,
        attachmentsCount: params.attachmentsCount,
        ticketUrl: ticketUrl || undefined,
        isEn,
      });

      sendEmail(mailConfig, client.email.trim(), emailSubject, html).catch((err) => {
        console.warn(`[ticket-notify] failed to send email notice to client ${client.id}:`, err);
      });
    }
  }
}
