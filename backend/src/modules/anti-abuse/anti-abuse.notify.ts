/**
 * T-anti-abuse (15.06.2026, WolfVPN): доставка уведомлений клиенту при срабатывании
 * правила анти-абьюза (предупреждение / бан).
 *
 * Каналы — telegram и/или email (выбор в правиле). TG ID и email берём из НАШЕЙ БД
 * (owner подписки), т.к. в Remna они часто пустые. Email — фирменный шаблон
 * brandedNotificationEmail. Текст правила поддерживает плейсхолдеры:
 *   {tariff} {sub_index} {used} {limit} {period} {until}
 */

import { getSystemConfig } from "../client/client.service.js";
import { sendTelegramToUser } from "../notification/telegram-notify.service.js";
import { brandedNotificationEmail, isMailConfigured, mailConfigFromSystem, sendEmail } from "../mail/mail.service.js";

export interface AbuseChannels {
  telegram?: boolean;
  email?: boolean;
  site?: boolean;
}

export interface AbuseNotifyRecipient {
  ownerClientId: string;
  telegramId: string | null;
  email: string | null;
}

export interface AbuseNotifyVars {
  tariff: string;
  subIndex: number;
  periodBytes: number;
  limitBytes: number;
  /** Человекочитаемое окно: «за неделю», «за сутки» и т.п. */
  windowLabel: string;
  /** Для бана — до какого момента заблокировано. */
  bannedUntil?: Date | null;
}

export interface AbuseNotifyResult {
  telegram: boolean;
  email: boolean;
}

function formatBytes(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 0 : 1)} ГБ`;
  const mb = bytes / 1024 ** 2;
  return `${Math.max(0, Math.round(mb))} МБ`;
}

function formatDateRu(d: Date): string {
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  });
}

/** Экранирование для HTML/Telegram parse_mode=HTML (имя тарифа берётся из БД). */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderTemplate(tpl: string, vars: AbuseNotifyVars): string {
  // messageText (шаблон) — админский, его HTML не трогаем; экранируем только
  // подставляемые ДАННЫЕ (имя тарифа), иначе спецсимволы ломают доставку/инъекция.
  return tpl
    .replace(/\{tariff\}/g, escapeHtml(vars.tariff))
    .replace(/\{sub_index\}/g, String(vars.subIndex))
    .replace(/\{used\}/g, formatBytes(vars.periodBytes))
    .replace(/\{limit\}/g, formatBytes(vars.limitBytes))
    .replace(/\{period\}/g, vars.windowLabel)
    .replace(/\{until\}/g, vars.bannedUntil ? formatDateRu(vars.bannedUntil) : "");
}

const backToMenuMarkup: Record<string, unknown> = {
  inline_keyboard: [[{ text: "◀️ В меню", callback_data: "menu:main" }]],
};

/**
 * Отправить уведомление по выбранным каналам. Возвращает, что реально ушло
 * (для записи в журнал channelsSent). Ошибки канала не валят остальные каналы.
 */
export async function sendAbuseNotification(params: {
  channels: AbuseChannels;
  messageText: string;
  emailSubject?: string | null;
  recipient: AbuseNotifyRecipient;
  vars: AbuseNotifyVars;
}): Promise<AbuseNotifyResult> {
  const { channels, messageText, emailSubject, recipient, vars } = params;
  const result: AbuseNotifyResult = { telegram: false, email: false };
  const rendered = renderTemplate(messageText, vars);

  // --- Telegram ---
  if (channels.telegram && recipient.telegramId) {
    try {
      await sendTelegramToUser(
        recipient.telegramId,
        rendered,
        undefined,
        backToMenuMarkup,
        { clientIdForBotToken: recipient.ownerClientId },
      );
      result.telegram = true;
    } catch (e) {
      console.warn("[anti-abuse] telegram notify failed:", e instanceof Error ? e.message : e);
    }
  }

  // --- Email ---
  if (channels.email && recipient.email) {
    try {
      const config = await getSystemConfig();
      const mailConfig = mailConfigFromSystem(config);
      if (isMailConfigured(mailConfig)) {
        const serviceName = config.serviceName || "VPN";
        const subject = emailSubject?.trim() || `${serviceName}: уведомление по подписке`;
        const bodyHtml = rendered.replace(/\n/g, "<br>");
        const publicAppUrl = config.publicAppUrl?.trim() || undefined;
        const html = brandedNotificationEmail({
          serviceName,
          title: subject,
          bodyHtml,
          btnLabel: publicAppUrl ? "Открыть личный кабинет" : undefined,
          btnLink: publicAppUrl,
        });
        const sent = await sendEmail(mailConfig, recipient.email, subject, html);
        result.email = sent?.ok ?? true;
      }
    } catch (e) {
      console.warn("[anti-abuse] email notify failed:", e instanceof Error ? e.message : e);
    }
  }

  return result;
}
