/**
 * Email-шаблоны: единый источник для редактора (routes) И реальных отправителей.
 *
 * Хранение: каждый шаблон = пара ключей в system_settings:
 *   email_template_<key>_subject — тема
 *   email_template_<key>_body    — HTML тело (поддерживает {{переменные}})
 *
 * до выноса в сервис ключи email_template_* читал только сам
 * редактор (list/preview/send-test), а боевые письма слались с захардкоженным HTML
 * из mail.service.ts — правки админа «не сохранялись» (сохранялись, но не применялись).
 * Теперь отправители рендерят шаблон через renderEmailTemplate().
 *
 * wired=true — шаблон реально используется отправителем. wired=false — пока
 * редактируется «впрок» (отправитель ещё не реализован); UI честно показывает бейдж.
 *
 * defaultBody — адаптивная HTML-вёрстка (table-based + inline-стили) для максимальной
 * совместимости с Gmail / Outlook / Apple Mail. Акцент #ec4899 (бренд STEALTHNET);
 * админ может переопределить любой шаблон в разделе «Почта → Шаблоны».
 */

import { prisma } from "../../db.js";

export interface TemplateDef {
  key: string;
  label: string;
  description: string;
  variables: { name: string; example: string; required?: boolean }[];
  defaultSubject: string;
  defaultBody: string;
  /** Подключён ли шаблон к реальному отправителю писем. */
  wired: boolean;
}

/**
 * Собирает готовое HTML-письмо из блоков (шапка/заголовок/текст + внутренности + подпись).
 * inner — центральная часть (кнопка, ссылка-fallback, коробка-квитанция и т.п.).
 */
function layout(opts: { heading: string; intro: string; inner: string; note?: string }): string {
  const note = opts.note
    ? `<p style="margin:20px 0 0;font-size:13px;line-height:1.55;color:#9ca3af;">${opts.note}</p>`
    : "";
  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light">
<title>{{serviceName}}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f7;-webkit-text-size-adjust:100%;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f4f7;margin:0;padding:0;">
<tr>
<td align="center" style="padding:32px 14px;">
<table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:520px;background-color:#ffffff;border-radius:16px;border:1px solid #ececef;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<tr>
<td style="padding:30px 34px 0;">
<div style="font-size:19px;font-weight:800;letter-spacing:-0.02em;color:#0f172a;">{{serviceName}}</div>
<div style="height:3px;line-height:3px;font-size:0;width:38px;background-color:#ec4899;border-radius:2px;margin-top:11px;">&nbsp;</div>
</td>
</tr>
<tr>
<td style="padding:18px 34px 4px;">
<h1 style="margin:0 0 8px;font-size:21px;line-height:1.3;font-weight:700;color:#0f172a;">${opts.heading}</h1>
<p style="margin:0 0 22px;font-size:15px;line-height:1.62;color:#4b5563;">${opts.intro}</p>
${opts.inner}
${note}
</td>
</tr>
<tr>
<td style="padding:24px 34px 30px;">
<div style="border-top:1px solid #f0f0f3;padding-top:16px;">
<p style="margin:0;font-size:12px;line-height:1.55;color:#9ca3af;">Это автоматическое письмо от {{serviceName}}. Отвечать на него не нужно.</p>
</div>
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
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 2px;">
<tr>
<td align="center" style="border-radius:11px;background-color:#ec4899;">
<a href="${url}" target="_blank" style="display:inline-block;padding:13px 30px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:11px;">${label}</a>
</td>
</tr>
</table>`;
}

/** Ссылка-fallback под кнопкой (на случай, если кнопка не нажимается). */
function linkFallback(url: string): string {
  return `<p style="margin:22px 0 4px;font-size:13px;color:#6b7280;">Или откройте ссылку вручную:</p>
<p style="margin:0;font-size:13px;line-height:1.5;word-break:break-all;"><a href="${url}" target="_blank" style="color:#ec4899;text-decoration:none;">${url}</a></p>`;
}

/** Строка в коробке-квитанции. */
function row(label: string, value: string): string {
  return `<tr><td style="padding:6px 0;font-size:14px;color:#6b7280;">${label}</td><td align="right" style="padding:6px 0;font-size:14px;font-weight:700;color:#0f172a;">${value}</td></tr>`;
}

/** Коробка-квитанция (для писем без кнопки). */
function infoBox(rows: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f8f8fb;border:1px solid #ececef;border-radius:12px;">
<tr><td style="padding:14px 18px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>
</td></tr>
</table>`;
}

export const TEMPLATES: TemplateDef[] = [
  {
    key: "welcome",
    label: "Приветственное письмо",
    description: "Отправляется после регистрации нового клиента (если включён email-канал)",
    variables: [
      { name: "email", example: "user@example.com", required: true },
      { name: "loginUrl", example: "https://stealthnet.app/login", required: true },
      { name: "serviceName", example: "STEALTHNET" },
    ],
    defaultSubject: "Добро пожаловать в {{serviceName}}!",
    defaultBody: layout({
      heading: "Добро пожаловать!",
      intro: "Спасибо, что зарегистрировались в {{serviceName}}. Ваш аккаунт создан на адрес <b style=\"color:#0f172a;\">{{email}}</b>.",
      inner: button("{{loginUrl}}", "Войти в личный кабинет") + linkFallback("{{loginUrl}}"),
      note: "Есть вопросы? Напишите нам в Telegram-бот — поможем.",
    }),
    wired: false,
  },
  {
    key: "email_verification",
    label: "Верификация email",
    description: "Письмо со ссылкой подтверждения при регистрации по email",
    variables: [
      { name: "verifyUrl", example: "https://stealthnet.app/cabinet/verify-email?token=...", required: true },
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
      { name: "verifyUrl", example: "https://stealthnet.app/cabinet/verify-link-email?token=...", required: true },
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
      { name: "resetUrl", example: "https://stealthnet.app/reset?token=...", required: true },
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
    description: "После PAID платежа",
    variables: [
      { name: "amount", example: "9.99", required: true },
      { name: "currency", example: "USD", required: true },
      { name: "tariffName", example: "1 месяц", required: true },
      { name: "expiresAt", example: "2026-06-05", required: true },
      { name: "serviceName", example: "STEALTHNET" },
    ],
    defaultSubject: "Оплата подтверждена — {{serviceName}}",
    defaultBody: layout({
      heading: "Оплата прошла успешно",
      intro: "Спасибо за оплату! Подписка активирована — детали ниже.",
      inner: infoBox(
        row("Тариф", "{{tariffName}}") +
        row("Сумма", "{{amount}} {{currency}}") +
        row("Активна до", "{{expiresAt}}")
      ),
    }),
    wired: false,
  },
  {
    key: "subscription_expiring",
    label: "Скоро истекает подписка",
    description: "За N дней до истечения",
    variables: [
      { name: "tariffName", example: "1 месяц", required: true },
      { name: "daysLeft", example: "3", required: true },
      { name: "renewUrl", example: "https://stealthnet.app/renew", required: true },
      { name: "serviceName", example: "STEALTHNET" },
    ],
    defaultSubject: "Подписка истекает через {{daysLeft}} дн. — {{serviceName}}",
    defaultBody: layout({
      heading: "Подписка скоро закончится",
      intro: "Ваша подписка <b style=\"color:#0f172a;\">{{tariffName}}</b> истекает через <b style=\"color:#0f172a;\">{{daysLeft}}</b> дн. Продлите её, чтобы не остаться без доступа.",
      inner: button("{{renewUrl}}", "Продлить подписку") + linkFallback("{{renewUrl}}"),
    }),
    wired: false,
  },
  {
    key: "subscription_expired",
    label: "Подписка истекла",
    description: "В день истечения",
    variables: [
      { name: "tariffName", example: "1 месяц", required: true },
      { name: "serviceName", example: "STEALTHNET" },
    ],
    defaultSubject: "Подписка истекла — {{serviceName}}",
    defaultBody: layout({
      heading: "Подписка закончилась",
      intro: "Ваша подписка <b style=\"color:#0f172a;\">{{tariffName}}</b> истекла. Продлите её в личном кабинете или в Telegram-боте, чтобы снова пользоваться сервисом.",
      inner: infoBox(row("Тариф", "{{tariffName}}") + row("Статус", "истекла")),
    }),
    wired: false,
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
    body: renderTemplate(item.body, vars),
  };
}
