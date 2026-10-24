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
