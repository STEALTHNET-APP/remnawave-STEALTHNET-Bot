/**
 * Уведомления клиентов о событиях безопасности (сброс и установка пароля).
 */
import { sendTelegramToUser } from "../notification/telegram-notify.service.js";
import { getSystemConfig } from "./client.service.js";
import { sendEmail, mailConfigFromSystem, isMailConfigured, brandedNotificationEmail } from "../mail/mail.service.js";

export interface SecurityNotifyClient {
  id: string;
  email?: string | null;
  telegramId?: string | null;
  preferredLang?: string | null;
}

/**
 * Уведомление о запросе установки/сброса пароля через Telegram-бот и/или Email.
 */
export async function notifyClientPasswordReset(
  client: SecurityNotifyClient,
  resetLink: string,
  isFirstPassword = false,
): Promise<void> {
  const config = await getSystemConfig();
  const serviceName = config.serviceName?.trim() || "STEALTHNET";
  const isEn = (client.preferredLang || "").toLowerCase() === "en";

  // 1. Отправка кнопки со ссылкой в Telegram-бот (если аккаунт привязан к Telegram)
  if (client.telegramId?.trim()) {
    const btnLabel = isFirstPassword
      ? (isEn ? "🔐 Set Password" : "🔐 Установить пароль")
      : (isEn ? "🔑 Reset Password" : "🔑 Сбросить пароль");

    const text = isEn
      ? (isFirstPassword
          ? `🔐 <b>Account Setup: Cabinet Password</b>\n\nA request was made to set a password for your ${serviceName} web cabinet.\n\nClick the button below to set your password (the link is valid for 1 hour):\n\n<i>If you did not request this, please ignore this message.</i>`
          : `🔑 <b>Password Reset Request</b>\n\nA password reset request was received for your ${serviceName} account.\n\nClick the button below to set a new password (the link is valid for 1 hour):\n\n<i>If you did not request a password reset, please ignore this message.</i>`)
      : (isFirstPassword
          ? `🔐 <b>Вход в личный кабинет: Установка пароля</b>\n\nБыл получен запрос на установку пароля для личного кабинета ${serviceName}.\n\nНажмите кнопку ниже, чтобы задать пароль (ссылка действительна 1 час):\n\n<i>Если вы не запрашивали установку пароля, просто проигнорируйте это сообщение.</i>`
          : `🔑 <b>Запрос на сброс пароля</b>\n\nБыл получен запрос на сброс пароля для вашего аккаунта ${serviceName}.\n\nНажмите кнопку ниже, чтобы установить новый пароль (ссылка действительна 1 час):\n\n<i>Если вы не запрашивали сброс пароля, просто проигнорируйте это сообщение.</i>`);

    const replyMarkup = {
      inline_keyboard: [
        [{ text: btnLabel, url: resetLink }],
      ],
    };

    sendTelegramToUser(client.telegramId.trim(), text, null, replyMarkup).catch((err) => {
      console.warn(`[security-notify] failed to send Telegram password reset to client ${client.id}:`, err);
    });
  }

  // 2. Информационное уведомление на Email (если аккаунт без пароля из Telegram)
  // Для Telegram-аккаунтов без верифицированной веб-почты мы не отправляем токен на email (защита от перехвата),
  // но отправляем понятное информационное письмо о том, что кнопка отправлена в их Telegram-бот.
  if (isFirstPassword && client.email?.trim()) {
    const mailConfig = mailConfigFromSystem(config);
    if (isMailConfigured(mailConfig)) {
      const subject = isEn
        ? `🔐 Password setup request — ${serviceName}`
        : `🔐 Запрос установки пароля — ${serviceName}`;
      const title = isEn ? "Password Setup Request" : "Запрос на установку пароля";
      const bodyHtml = isEn
        ? `<p>A request was received to set a password for account (<strong>${client.email}</strong>).</p><p>Because your account was created via Telegram, the secure setup link has been sent to your <strong>Telegram bot</strong>.</p><p>Please open Telegram and follow the instructions in the bot. You can also sign in directly using the "Login with Telegram" button on the login page.</p>`
        : `<p>Был получен запрос на установку пароля для аккаунта <strong>${client.email}</strong>.</p><p>Так как ваш аккаунт зарегистрирован через Telegram, безопасная ссылка для установки пароля была отправлена в ваш <strong>Telegram-бот</strong>.</p><p>Пожалуйста, откройте Telegram и нажмите кнопку в сообщении от бота. Также вы можете входить в кабинет в 1 клик через кнопку «Войти через Telegram» на странице авторизации.</p>`;

      const html = brandedNotificationEmail({
        serviceName,
        title,
        bodyHtml,
      });

      sendEmail(mailConfig, client.email.trim(), subject, html).catch((err) => {
        console.warn(`[security-notify] failed to send info email to client ${client.id}:`, err);
      });
    }
  }
}
