/**
 * Email-шаблоны: единый источник для редактора (routes) И реальных отправителей.
 *
 * Хранение: каждый шаблон = пара ключей в system_settings:
 *   email_template_<key>_subject — тема
 *   email_template_<key>_body    — HTML тело (поддерживает {{переменные}})
 *
 * Отправители рендерят шаблон через renderEmailTemplate().
 *
 * wired=true — шаблон реально используется отправителем. wired=false — пока
 * редактируется «впрок» (отправитель ещё не реализован); UI честно показывает бейдж.
 * hidden=true — шаблон не показывается в редакторе (отправляется другим механизмом).
 *
 * defaultBody — адаптивная HTML-вёрстка (table-based + inline-стили) для максимальной
 * совместимости с Gmail / Outlook / Apple Mail / Яндекс.Почта / Mail.ru.
 */

import { prisma } from "../../db.js";

const FONT_STACK = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const BRAND = "#4f46e5";
const BRAND_LIGHT = "#6366f1";
const TEXT = "#0f172a";
const MUTED = "#64748b";
const CARD_BG = "#f8fafc";
const CARD_BORDER = "#e2e8f0";

export interface TemplateDef {
  key: string;
  label: string;
  description: string;
  variables: { name: string; example: string; required?: boolean }[];
  defaultSubject: string;
  defaultBody: string;
  /** Подключён ли шаблон к реальному отправителю писем. */
  wired: boolean;
  /** Не показывать в списке редактора. */
  hidden?: boolean;
}

export interface LayoutOptions {
  heading?: string;
  intro?: string;
  inner: string;
  note?: string;
  footerLinks?: { label: string; url: string }[];
  brand?: string;
}

export function escapeEmailHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Собирает готовое HTML-письмо из блоков (шапка/заголовок/текст + внутренности + подпись).
 * inner — центральная часть (кнопка, ссылка-fallback, коробка-квитанция и т.п.).
 */
function layout(opts: LayoutOptions): string {
  const brand = opts.brand ?? "{{serviceName}}";
  const heading = opts.heading
    ? `<h1 class="email-heading" style="margin:0 0 10px;font-family:${FONT_STACK};font-size:23px;line-height:1.32;font-weight:800;letter-spacing:-0.02em;color:${TEXT};mso-line-height-rule:exactly;">${opts.heading}</h1>`
    : "";
  const intro = opts.intro
    ? `<p style="margin:0 0 22px;font-family:${FONT_STACK};font-size:15px;line-height:1.68;color:#334155;mso-line-height-rule:exactly;">${opts.intro}</p>`
    : "";
  const note = opts.note
    ? `<p style="margin:20px 0 0;font-family:${FONT_STACK};font-size:13px;line-height:1.65;color:${MUTED};mso-line-height-rule:exactly;">${opts.note}</p>`
    : "";
  const footerLinks = opts.footerLinks?.length
    ? `<p style="margin:0 0 6px;font-family:${FONT_STACK};font-size:12px;line-height:1.6;color:${MUTED};">
${opts.footerLinks.map((l) => `<a href="${l.url}" target="_blank" rel="noopener noreferrer" style="color:${BRAND};text-decoration:none;font-weight:600;">${l.label}</a>`).join(' <span style="color:#cbd5e1;">&middot;</span> ')}
</p>`
    : "";
  const preheader = opts.heading ? escapeEmailHtml(opts.heading.replace(/\{\{\w+\}\}/g, "")) : "";

  return `<!DOCTYPE html>
<html lang="ru" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light">
<title>${brand}</title>
<!--[if mso]>
<noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
<![endif]-->
<style>
  html,body{margin:0 !important;padding:0 !important;width:100% !important;}
  table{border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;}
  img{border:0;line-height:100%;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;}
  a{text-decoration:none;}
  @media only screen and (max-width:620px){
    .email-wrap{padding:16px 10px !important;}
    .email-card{width:100% !important;max-width:100% !important;border-radius:14px !important;}
    .email-pad{padding-left:22px !important;padding-right:22px !important;}
    .email-heading{font-size:21px !important;}
    .email-btn a{display:block !important;padding:15px 20px !important;}
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:#eef2f7;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#eef2f7;opacity:0;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#eef2f7" style="background-color:#eef2f7;margin:0;padding:0;">
<tr>
<td align="center" class="email-wrap" style="padding:34px 12px;">
<table role="presentation" width="580" cellpadding="0" cellspacing="0" border="0" class="email-card" bgcolor="#ffffff" style="width:580px;max-width:580px;background-color:#ffffff;border:1px solid #dbe3ec;border-radius:18px;">
<tr>
<td class="email-pad" style="padding:30px 36px 0;">
<div style="font-family:${FONT_STACK};font-size:19px;line-height:1.3;font-weight:800;letter-spacing:-0.02em;color:${TEXT};">${brand}</div>
<div style="height:4px;line-height:4px;font-size:0;width:46px;background-color:${BRAND};background-image:linear-gradient(90deg,${BRAND} 0%,#8b5cf6 100%);border-radius:3px;margin-top:12px;">&nbsp;</div>
</td>
</tr>
<tr>
<td class="email-pad" style="padding:22px 36px 6px;">
${heading}
${intro}
${opts.inner}
${note}
</td>
</tr>
<tr>
<td class="email-pad" style="padding:26px 36px 0;">
<div style="border-top:1px solid ${CARD_BORDER};height:1px;line-height:1px;font-size:0;">&nbsp;</div>
</td>
</tr>
<tr>
<td class="email-pad" style="padding:18px 36px 30px;">
<p style="margin:0 0 8px;font-family:${FONT_STACK};font-size:12px;line-height:1.65;color:${MUTED};">Это автоматическое системное уведомление от ${brand}. Отвечать на него не нужно.</p>
${footerLinks}
<p style="margin:6px 0 0;font-family:${FONT_STACK};font-size:11px;line-height:1.6;color:#94a3b8;">&copy; ${brand}. Все права защищены.</p>
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>`;
}

/** Bulletproof-кнопка (table-based, корректно в Outlook). */
function button(url: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" class="email-btn" style="margin:0 0 2px;">
<tr>
<td align="center" bgcolor="${BRAND}" style="border-radius:12px;background-color:${BRAND};background-image:linear-gradient(135deg,${BRAND} 0%,${BRAND_LIGHT} 100%);mso-padding-alt:14px 32px;">
<a href="${url}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:14px 32px;font-family:${FONT_STACK};font-size:15px;line-height:1.2;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px;mso-line-height-rule:exactly;">${label}</a>
</td>
</tr>
</table>`;
}

/** Ссылка-fallback под кнопкой (на случай, если кнопка не нажимается). */
function linkFallback(url: string): string {
  return `<p style="margin:20px 0 0;font-family:${FONT_STACK};font-size:12px;line-height:1.6;color:${MUTED};">Если кнопка не открывается, скопируйте ссылку:</p>
<p style="margin:4px 0 0;font-family:${FONT_STACK};font-size:12px;line-height:1.55;word-break:break-all;"><a href="${url}" target="_blank" rel="noopener noreferrer" style="color:${BRAND_LIGHT};text-decoration:none;">${url}</a></p>`;
}

/** Строка в коробке-квитанции. */
function row(label: string, value: string, first = false): string {
  return `<tr><td style="padding:13px 0;font-family:${FONT_STACK};font-size:13px;line-height:1.5;color:${MUTED};${first ? "" : `border-top:1px solid ${CARD_BORDER};`}">${label}</td><td align="right" style="padding:13px 0;font-family:${FONT_STACK};font-size:13px;line-height:1.5;font-weight:700;color:${TEXT};${first ? "" : `border-top:1px solid ${CARD_BORDER};`}">${value}</td></tr>`;
}

/** Коробка-квитанция / карточка данных. */
function infoBox(rows: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CARD_BG}" style="width:100%;background-color:${CARD_BG};border:1px solid ${CARD_BORDER};border-radius:14px;">
<tr><td style="padding:4px 20px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>
</td></tr>
</table>`;
}

/** Акцентная плашка (например, тема обращения в тикете). */
function accentBox(kicker: string, title: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#eef2ff" style="width:100%;background-color:#eef2ff;border:1px solid #e0e7ff;border-radius:14px;">
<tr><td style="padding:15px 18px;">
<div style="font-family:${FONT_STACK};font-size:11px;line-height:1.4;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${BRAND_LIGHT};">${kicker}</div>
<div style="margin-top:5px;font-family:${FONT_STACK};font-size:15px;line-height:1.5;font-weight:700;color:${TEXT};word-break:break-word;">${title}</div>
</td></tr>
</table>`;
}

/** Цитата ответа поддержки: мягкий фон, скругление, акцентная полоса слева. */
function quoteBox(text: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CARD_BG}" style="width:100%;background-color:${CARD_BG};border:1px solid ${CARD_BORDER};border-radius:14px;">
<tr><td style="padding:18px 20px 18px 18px;border-left:3px solid ${BRAND_LIGHT};font-family:${FONT_STACK};font-size:14px;line-height:1.75;color:#334155;white-space:pre-wrap;word-break:break-word;mso-line-height-rule:exactly;">${text}</td></tr>
</table>`;
}

/** Ссылка подписки в отдельной карточке (для копирования в VPN-приложение). */
function linkBox(label: string, url: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CARD_BG}" style="width:100%;background-color:${CARD_BG};border:1px solid ${CARD_BORDER};border-radius:14px;">
<tr><td style="padding:14px 18px;">
<div style="font-family:${FONT_STACK};font-size:11px;line-height:1.4;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED};">${label}</div>
<div style="margin-top:6px;font-family:${FONT_STACK};font-size:13px;line-height:1.6;word-break:break-all;"><a href="${url}" target="_blank" rel="noopener noreferrer" style="color:${BRAND};text-decoration:none;">${url}</a></div>
</td></tr>
</table>`;
}

/** Inline-бейдж (вложения, статусы). */
export function emailBadge(text: string): string {
  return `<span style="display:inline-block;margin:2px 0 0;padding:6px 12px;background-color:#eef2ff;border:1px solid #e0e7ff;border-radius:999px;font-family:${FONT_STACK};font-size:12px;line-height:1.4;font-weight:600;color:#4338ca;">${text}</span>`;
}

function paragraphs(text: string): string {
  const blocks = text.replace(/\r\n/g, "\n").trim().split(/\n{2,}/);
  return blocks
    .map((block) => `<p style="margin:0 0 16px;font-family:${FONT_STACK};font-size:15px;line-height:1.7;color:#334155;mso-line-height-rule:exactly;">${block.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/**
 * Письмо для рассылок (Авто-рассылки / ручные рассылки): брендовый контейнер,
 * абзацы сообщения и необязательная CTA-кнопка.
 */
export function buildBroadcastEmailHtml(opts: {
  serviceName: string;
  message: string;
  buttonText?: string | null;
  buttonUrl?: string | null;
  cabinetUrl?: string | null;
}): string {
  const serviceName = escapeEmailHtml(opts.serviceName.trim() || "Сервис");
  const cta = opts.buttonText?.trim() && opts.buttonUrl?.trim()
    ? button(opts.buttonUrl.trim(), escapeEmailHtml(opts.buttonText.trim()))
    : "";
  const footerLinks = opts.cabinetUrl
    ? [{ label: "Личный кабинет", url: opts.cabinetUrl }]
    : [];
  return layout({
    brand: serviceName,
    inner: `${paragraphs(opts.message)}${cta}`,
    footerLinks,
  });
}

export const TEMPLATES: TemplateDef[] = [
  {
    key: "welcome",
    label: "Приветственное письмо",
    description: "Отправляется после подтверждения email или первого входа через Google",
    variables: [
      { name: "serviceName", example: "STEALTHNET" },
      { name: "email", example: "user@example.com", required: true },
      { name: "loginUrl", example: "https://example.com/cabinet/login", required: true },
      { name: "clientName", example: "Алексей" },
    ],
    defaultSubject: "Добро пожаловать в {{serviceName}}!",
    defaultBody: layout({
      heading: "Добро пожаловать в {{serviceName}}",
      intro: "Здравствуйте, {{clientName}}! Аккаунт на адрес <b style=\"color:#0f172a;\">{{email}}</b> создан. Теперь доступны личный кабинет, подписка и поддержка в одном месте.",
      inner: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CARD_BG}" style="width:100%;background-color:${CARD_BG};border:1px solid ${CARD_BORDER};border-radius:14px;">
<tr><td style="padding:16px 20px;font-family:${FONT_STACK};font-size:14px;line-height:1.75;color:#334155;">
<b style="color:${TEXT};">Что дальше</b><br>
1. Выберите подходящий тариф в кабинете.<br>
2. Скопируйте ссылку подписки.<br>
3. Добавьте её в VPN-приложение и подключитесь.
</td></tr>
</table>
<div style="height:22px;line-height:22px;font-size:0;">&nbsp;</div>
${button("{{loginUrl}}", "Войти в личный кабинет")}
${linkFallback("{{loginUrl}}")}`,
      note: "Есть вопросы? Напишите нам в поддержку через личный кабинет или Telegram-бот.",
      footerLinks: [{ label: "Личный кабинет", url: "{{loginUrl}}" }],
    }),
    wired: true,
  },
  {
    key: "email_verification",
    label: "Верификация email",
    description: "Письмо со ссылкой подтверждения при регистрации по email",
    variables: [
      { name: "verifyUrl", example: "https://example.com/cabinet/verify-email?token=...", required: true },
      { name: "hours", example: "24", required: true },
      { name: "serviceName", example: "STEALTHNET" },
    ],
    defaultSubject: "Подтверждение регистрации — {{serviceName}}",
    defaultBody: layout({
      heading: "Подтвердите email",
      intro: "Чтобы завершить регистрацию в {{serviceName}}, подтвердите ваш адрес — нажмите кнопку ниже.",
      inner: button("{{verifyUrl}}", "Подтвердить email") + linkFallback("{{verifyUrl}}"),
      note: "Ссылка действительна {{hours}} ч. Если вы не регистрировались — просто проигнорируйте это письмо.",
    }),
    wired: true,
  },
  {
    key: "link_email",
    label: "Привязка почты",
    description: "Письмо со ссылкой подтверждения при привязке почты к существующему аккаунту",
    variables: [
      { name: "verifyUrl", example: "https://example.com/cabinet/verify-link-email?token=...", required: true },
      { name: "hours", example: "24", required: true },
      { name: "serviceName", example: "STEALTHNET" },
    ],
    defaultSubject: "Привязка почты к аккаунту — {{serviceName}}",
    defaultBody: layout({
      heading: "Подтвердите привязку почты",
      intro: "Вы добавляете этот адрес к своему аккаунту в {{serviceName}}. Подтвердите привязку — нажмите кнопку ниже.",
      inner: button("{{verifyUrl}}", "Подтвердить привязку") + linkFallback("{{verifyUrl}}"),
      note: "Ссылка действительна {{hours}} ч. Если вы не запрашивали привязку — просто проигнорируйте это письмо.",
    }),
    wired: true,
  },
  {
    key: "password_reset",
    label: "Сброс пароля",
    description: "Ссылка для сброса пароля",
    variables: [
      { name: "resetUrl", example: "https://example.com/cabinet/reset-password?token=...", required: true },
      { name: "minutes", example: "60", required: true },
      { name: "serviceName", example: "STEALTHNET" },
    ],
    defaultSubject: "Сброс пароля — {{serviceName}}",
    defaultBody: layout({
      heading: "Сброс пароля",
      intro: "Вы запросили сброс пароля в {{serviceName}}. Чтобы задать новый пароль, нажмите кнопку ниже.",
      inner: button("{{resetUrl}}", "Задать новый пароль") + linkFallback("{{resetUrl}}"),
      note: "Ссылка действительна {{minutes}} мин. Если вы не запрашивали сброс — просто проигнорируйте это письмо, пароль останется прежним.",
    }),
    wired: true,
  },
  {
    key: "payment_confirmed",
    label: "Успешная оплата",
    description: "Чек об оплате тарифа — отправляется после подтверждения платежа",
    variables: [
      { name: "serviceName", example: "STEALTHNET" },
      { name: "tariffName", example: "1 месяц", required: true },
      { name: "amount", example: "9.99", required: true },
      { name: "currency", example: "USD", required: true },
      { name: "expiresAt", example: "2026-06-05 12:00 UTC", required: true },
      { name: "subscriptionUrl", example: "https://example.com/sub/abc", required: true },
      { name: "orderId", example: "order-123", required: true },
    ],
    defaultSubject: "✅ Оплата подтверждена — {{serviceName}}",
    defaultBody: layout({
      heading: "Оплата прошла успешно",
      intro: "Спасибо за оплату! Подписка активирована — детали платежа ниже.",
      inner: `${infoBox(
        row("Тариф", "{{tariffName}}", true) +
        row("Сумма", "{{amount}} {{currency}}") +
        row("Действует до", "{{expiresAt}}") +
        row("Номер заказа", "{{orderId}}"),
      )}
<div style="height:18px;line-height:18px;font-size:0;">&nbsp;</div>
${linkBox("Ссылка подписки для приложения", "{{subscriptionUrl}}")}
<div style="height:22px;line-height:22px;font-size:0;">&nbsp;</div>
${button("{{subscriptionUrl}}", "Открыть подписку")}
${linkFallback("{{subscriptionUrl}}")}`,
      note: "Добавьте ссылку подписки в приложение Happ или другое VPN-приложение. Если ссылка не открывается — скопируйте её из блока выше.",
      footerLinks: [{ label: "Мои подписки", url: "{{subscriptionUrl}}" }],
    }),
    wired: true,
  },
  {
    key: "trial_activated",
    label: "Пробный период активирован",
    description: "Отправляется после успешной активации пробной подписки",
    variables: [
      { name: "serviceName", example: "STEALTHNET" },
      { name: "trialName", example: "Пробный доступ", required: true },
      { name: "durationDays", example: "3", required: true },
      { name: "expiresAt", example: "2026-06-05 12:00 UTC", required: true },
      { name: "subscriptionUrl", example: "https://example.com/sub/abc", required: true },
      { name: "cabinetUrl", example: "https://example.com/cabinet/dashboard", required: true },
    ],
    defaultSubject: "🎁 Пробный период «{{trialName}}» активирован — {{serviceName}}",
    defaultBody: layout({
      heading: "Пробный период активирован",
      intro: "Пробная подписка «<b style=\"color:#0f172a;\">{{trialName}}</b>» готова к использованию. Осталось подключить устройство.",
      inner: `${infoBox(
        row("Пробный период", "{{trialName}}", true) +
        row("Длительность", "{{durationDays}} дн.") +
        row("Действует до", "{{expiresAt}}"),
      )}
<div style="height:18px;line-height:18px;font-size:0;">&nbsp;</div>
${linkBox("Ссылка подписки для приложения", "{{subscriptionUrl}}")}
<div style="height:22px;line-height:22px;font-size:0;">&nbsp;</div>
${button("{{subscriptionUrl}}", "Настроить VPN")}
${linkFallback("{{subscriptionUrl}}")}`,
      note: "Скопируйте ссылку подписки и добавьте её в VPN-приложение (например, Happ). По всем вопросам пишите в поддержку — поможем с настройкой.",
      footerLinks: [{ label: "Личный кабинет", url: "{{cabinetUrl}}" }],
    }),
    wired: true,
  },
  {
    key: "ticket_reply",
    label: "Ответ службы поддержки в тикете",
    description: "Отправляется клиенту при новом ответе поддержки на тикет",
    variables: [
      { name: "serviceName", example: "STEALTHNET" },
      { name: "ticketId", example: "A1B2C3D4", required: true },
      { name: "ticketSubject", example: "Не подключается VPN", required: true },
      { name: "replyText", example: "Мы обновили конфигурацию — попробуйте подключиться снова.", required: true },
      { name: "ticketUrl", example: "https://example.com/cabinet/tickets?id=...", required: true },
      { name: "attachmentsInfo", example: "📎 Прикреплено файлов: 2" },
    ],
    defaultSubject: "💬 Ответ по обращению «{{ticketSubject}}» — {{serviceName}}",
    defaultBody: layout({
      heading: "Ответ службы поддержки",
      intro: "По вашему обращению поступил новый ответ.",
      inner: `${accentBox("Обращение #{{ticketId}}", "«{{ticketSubject}}»")}
<div style="height:18px;line-height:18px;font-size:0;">&nbsp;</div>
${quoteBox("{{replyText}}")}
<div style="margin-top:14px;">{{attachmentsInfo}}</div>
<div style="height:22px;line-height:22px;font-size:0;">&nbsp;</div>
${button("{{ticketUrl}}", "Перейти к обращению")}
${linkFallback("{{ticketUrl}}")}`,
      note: "Ответьте на это обращение в личном кабинете — так переписка сохранится в одном месте.",
      footerLinks: [{ label: "Мои обращения", url: "{{ticketUrl}}" }],
    }),
    wired: true,
  },
  {
    key: "subscription_expiring",
    label: "Скоро истекает подписка",
    description: "Напоминание отправляется планировщиком «Авто-рассылки»",
    variables: [
      { name: "tariffName", example: "1 месяц", required: true },
      { name: "daysLeft", example: "3", required: true },
      { name: "renewUrl", example: "https://example.com/cabinet/dashboard", required: true },
      { name: "serviceName", example: "STEALTHNET" },
    ],
    defaultSubject: "Подписка истекает через {{daysLeft}} дн. — {{serviceName}}",
    defaultBody: layout({
      heading: "Подписка скоро закончится",
      intro: "Ваша подписка <b style=\"color:#0f172a;\">{{tariffName}}</b> истекает через <b style=\"color:#0f172a;\">{{daysLeft}}</b> дн. Продлите её, чтобы не остаться без доступа.",
      inner: button("{{renewUrl}}", "Продлить подписку") + linkFallback("{{renewUrl}}"),
      footerLinks: [{ label: "Личный кабинет", url: "{{renewUrl}}" }],
    }),
    wired: false,
    hidden: true,
  },
  {
    key: "subscription_expired",
    label: "Подписка истекла",
    description: "Напоминание отправляется планировщиком «Авто-рассылки»",
    variables: [
      { name: "tariffName", example: "1 месяц", required: true },
      { name: "serviceName", example: "STEALTHNET" },
    ],
    defaultSubject: "Подписка истекла — {{serviceName}}",
    defaultBody: layout({
      heading: "Подписка закончилась",
      intro: "Ваша подписка <b style=\"color:#0f172a;\">{{tariffName}}</b> истекла. Продлите её в личном кабинете или в Telegram-боте, чтобы снова пользоваться сервисом.",
      inner: infoBox(row("Тариф", "{{tariffName}}", true) + row("Статус", "истекла")),
    }),
    wired: false,
    hidden: true,
  },
];

export function subjectKey(k: string) { return `email_template_${k}_subject`; }
export function bodyKey(k: string) { return `email_template_${k}_body`; }

function isLegacyVerificationSubject(subject: string): boolean {
  return subject.includes("{{code}}") || subject.trim().toLowerCase().startsWith("код подтверждения");
}

export async function migrateLegacyEmailVerificationSubject(): Promise<boolean> {
  const def = TEMPLATES.find((t) => t.key === "email_verification");
  if (!def) return false;
  const key = subjectKey("email_verification");
  const stored = await prisma.systemSetting.findUnique({ where: { key } });
  if (!stored || !isLegacyVerificationSubject(stored.value)) return false;
  await prisma.systemSetting.update({ where: { key }, data: { value: def.defaultSubject } });
  return true;
}

export interface StoredTemplate {
  key: string;
  label: string;
  description: string;
  variables: TemplateDef["variables"];
  subject: string;
  body: string;
  isDefault: boolean;
  wired: boolean;
}

/** Шаблон из БД с фоллбэком на дефолт. null — неизвестный ключ. */
export async function getStoredTemplate(key: string): Promise<StoredTemplate | null> {
  const def = TEMPLATES.find((t) => t.key === key);
  if (!def) return null;

  const [s, b] = await Promise.all([
    prisma.systemSetting.findUnique({ where: { key: subjectKey(key) } }),
    prisma.systemSetting.findUnique({ where: { key: bodyKey(key) } }),
  ]);
  let subject = s?.value ?? def.defaultSubject;
  if (key === "email_verification" && isLegacyVerificationSubject(subject)) {
    subject = def.defaultSubject;
  }
  return {
    key: def.key,
    label: def.label,
    description: def.description,
    variables: def.variables,
    subject,
    body: b?.value ?? def.defaultBody,
    isDefault: !s && !b,
    wired: def.wired,
  };
}

export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template
    .replace(/\{\{(\w+)\}\}/g, (_m, name) => vars[name] ?? (name === "code" ? "" : `{{${name}}}`))
    .replace(/\s*:\s*$/, "")
    .trim();
}

/**
 * Отрендерить шаблон для боевой отправки: stored-or-default + подстановка переменных.
 * null — неизвестный ключ (отправитель должен иметь свой fallback или не слать).
 */
export async function renderEmailTemplate(
  key: string,
  vars: Record<string, string>,
): Promise<{ subject: string; body: string } | null> {
  const item = await getStoredTemplate(key);
  if (!item) return null;
  return {
    subject: renderTemplate(item.subject, vars),
    body: renderTemplate(item.body, Object.fromEntries(Object.entries(vars).map(([name, value]) => [name, name === "attachmentsInfo" ? value : escapeEmailHtml(value)]))),
  };
}
