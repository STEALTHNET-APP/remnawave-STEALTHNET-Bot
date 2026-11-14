/**
 * Уведомления клиентов о событиях безопасности (сброс 2FA, смена пароля и др.).
 */
import { sendTelegramToUser } from "../notification/telegram-notify.service.js";
import { getSystemConfig } from "./client.service.js";
import { sendEmail, mailConfigFromSystem, isMailConfigured, brandedNotificationEmail } from "../mail/mail.service.js";

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export interface SecurityNotifyClient {
  id: string;
  email?: string | null;
  telegramId?: string | null;
  preferredLang?: string | null;
}

export async function notifyClientAbout2FAReset(client: SecurityNotifyClient): Promise<void> {
  const config = await getSystemConfig();
  const serviceName = config.serviceName?.trim() || "STEALTHNET";
  const isEn = (client.preferredLang || "").toLowerCase() === "en";

  // 1. Уведомление в Telegram
  if (client.telegramId?.trim()) {
    const text = isEn
      ? `⚠️ <b>Security Alert: 2FA Disabled</b>\n\nTwo-factor authentication (2FA) for your account has been reset by an administrator.\n\nYou can now sign in using your regular password and set up 2FA again in your profile.\n\n<i>If you did not request this, please contact support immediately and change your password.</i>`
      : `⚠️ <b>Безопасность аккаунта: 2FA отключена</b>\n\nДвухфакторная аутентификация (2FA) для вашего аккаунта была сброшена администратором.\n\nВы можете войти в личный кабинет по паролю и настроить 2FA заново в профиле.\n\n<i>Если вы не запрашивали сброс 2FA у поддержки, немедленно свяжитесь с администрацией и смените пароль.</i>`;

    sendTelegramToUser(client.telegramId.trim(), text).catch((err) => {
      console.warn(`[security-notify] failed to send Telegram 2FA reset notice to client ${client.id}:`, err);
    });
  }

  // 2. Уведомление на Email
  if (client.email?.trim()) {
    const mailConfig = mailConfigFromSystem(config);
    if (isMailConfigured(mailConfig)) {
      const subject = isEn ? `⚠️ Security Alert: 2FA has been reset — ${serviceName}` : `⚠️ Безопасность: 2FA была сброшена — ${serviceName}`;
      const title = isEn ? "Two-Factor Authentication Reset" : "Двухфакторная аутентификация сброшена";
      const bodyHtml = isEn
        ? `<p>Two-factor authentication (2FA) for your account (<strong>${escapeHtml(client.email)}</strong>) has been reset by an administrator.</p><p>You can now sign in with your password and re-enable 2FA in your account settings.</p><p style="color:#e11d48;font-weight:600;">If you did not request this reset, please contact support immediately.</p>`
        : `<p>Двухфакторная аутентификация (2FA) для вашего аккаунта (<strong>${escapeHtml(client.email)}</strong>) была сброшена администратором панели управления.</p><p>Вы можете войти в личный кабинет по паролю и настроить 2FA заново в настройках безопасности.</p><p style="color:#e11d48;font-weight:600;">Если вы не обращались в поддержку с просьбой о сбросе, немедленно свяжитесь с администратором сервиса.</p>`;

      const html = brandedNotificationEmail({
        serviceName,
        title,
        bodyHtml,
      });

      sendEmail(mailConfig, client.email.trim(), subject, html).catch((err) => {
        console.warn(`[security-notify] failed to send email 2FA reset notice to client ${client.id}:`, err);
      });
    }
  }
}

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
          ? `🔐 <b>Account Setup: Cabinet Password</b>\n\nA request was made to set a password for your ${escapeHtml(serviceName)} web cabinet.\n\nClick the button below to set your password (the link is valid for 1 hour):\n\n<i>If you did not request this, please ignore this message.</i>`
          : `🔑 <b>Password Reset Request</b>\n\nA password reset request was received for your ${serviceName} account.\n\nClick the button below to set a new password (the link is valid for 1 hour):\n\n<i>If you did not request a password reset, please ignore this message.</i>`)
      : (isFirstPassword
          ? `🔐 <b>Вход в личный кабинет: Установка пароля</b>\n\nБыл получен запрос на установку пароля для личного кабинета ${escapeHtml(serviceName)}.\n\nНажмите кнопку ниже, чтобы задать пароль (ссылка действительна 1 час):\n\n<i>Если вы не запрашивали установку пароля, просто проигнорируйте это сообщение.</i>`
          : `🔑 <b>Запрос на сброс пароля</b>\n\nБыл получен запрос на сброс пароля для вашего аккаунта ${escapeHtml(serviceName)}.\n\nНажмите кнопку ниже, чтобы установить новый пароль (ссылка действительна 1 час):\n\n<i>Если вы не запрашивали сброс пароля, просто проигнорируйте это сообщение.</i>`);

    const replyMarkup = {
      inline_keyboard: [
        [{ text: btnLabel, url: resetLink }],
      ],
    };

    await sendTelegramToUser(client.telegramId.trim(), text, null, replyMarkup).catch((err) => {
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
        ? `<p>A request was received to set a password for account (<strong>${escapeHtml(client.email ?? "")}</strong>).</p><p>Because your account was created via Telegram, the secure setup link has been sent to your <strong>Telegram bot</strong>.</p><p>Please open Telegram and follow the instructions in the bot. You can also sign in directly using the "Login with Telegram" button on the login page.</p>`
        : `<p>Был получен запрос на установку пароля для аккаунта <strong>${escapeHtml(client.email ?? "")}</strong>.</p><p>Так как ваш аккаунт зарегистрирован через Telegram, безопасная ссылка для установки пароля была отправлена в ваш <strong>Telegram-бот</strong>.</p><p>Пожалуйста, откройте Telegram и нажмите кнопку в сообщении от бота. Также вы можете входить в кабинет в 1 клик через кнопку «Войти через Telegram» на странице авторизации.</p>`;

      const html = brandedNotificationEmail({
        serviceName,
        title,
        bodyHtml,
      });

      await sendEmail(mailConfig, client.email.trim(), subject, html).catch((err) => {
        console.warn(`[security-notify] failed to send info email to client ${client.id}:`, err);
      });
    }
  }
}
