import { findTelegramSubscriptions, checkTelegramSubscriptionOwners, restoreTelegramSubscriptions, TelegramSubscriptionCheckError } from "./telegram-subscriptions.service.js";
import { randomBytes, createHmac } from "crypto";
import { verify } from "otplib";
import { Router, type Request } from "express";
import { z } from "zod";
import { env } from "../../config/index.js";
import { prisma, asClientUncheckedCreate, asClientWhere, asTelegramAuthUpdate, type TelegramAuthTokenRecord } from "../../db.js";
import { mergeClients } from "./merge-clients.service.js";
import {
  hashPassword,
  verifyPassword,
  signClientToken,
  signClient2FAPendingToken,
  verifyClient2FAPendingToken,
  generateReferralCode,
  getSystemConfig,
} from "./client.service.js";
import { notifyAdminsAboutNewClient } from "../notification/telegram-notify.service.js";
import { requireClientAuth } from "./client.middleware.js";
import { isRemnaConfigured, remnaGetUserByEmail, remnaGetUserByTelegramId, remnaGetUserByShortUuid, extractRemnaUuid } from "../remna/remna.client.js";
import { isMailConfigured, mailConfigFromSystem, sendEmail } from "../mail/mail.service.js";
import { renderEmailTemplate } from "../email-templates/email-templates.service.js";
import { notifyClientPasswordReset } from "./client-security-notify.service.js";
import { signClientPasswordResetToken, verifyClientPasswordResetToken } from "../auth/auth.service.js";
import { NO_PASSWORD_HASH, resolveRegisterRoute, clientPasswordHashFromPending, decideVerifyEmail, consumedPendingExpiry, passwordResetFingerprint, canResetPassword, isEmailUniqueViolation } from "./email-registration.js";
import { upsertSubscriptionByRemnaUuid } from "../subscription/subscription.helpers.js";
import { getBotByToken, getPrimaryBot } from "../bot/bot.service.js";
import { extractBotTokenFromRequest } from "../bot/bot.middleware.js";
import { validateEmailForSignup } from "../signup-protection/email-blocklist.js";

/** Извлекает реальный IP клиента (с учётом trust proxy). */
function getRequestIp(req: Request): string | null {
  const ip = req.ip || req.socket?.remoteAddress || null;
  if (!ip) return null;
  return ip.startsWith("::ffff:") ? ip.slice(7) : ip;
}

/**
 * Определяет, какому Bot-клону принадлежит запрос на регистрацию/логин.
 *
 * Логика:
 *   1) Если в заголовке X-Telegram-Bot-Token есть токен активного клона — используем его.
 *      (это путь из бота: каждый клон шлёт свой токен в API)
 *   2) Иначе — primary bot (это путь из веб-кабинета: webhook'ов, OAuth и т.п.,
 *      где явной привязки к клону нет).
 *
 * Возвращает объект Bot или null, если в БД нет primary бота (broken state — должно
 * быть сделано миграцией). Вызывающий код в случае null возвращает 503.
 */
async function resolveBotForClientRequest(req: { headers: Record<string, unknown> | unknown }) {
  const token = extractBotTokenFromRequest(req as Parameters<typeof extractBotTokenFromRequest>[0]);
  if (token) {
    const fromHeader = await getBotByToken(token);
    if (fromHeader) return fromHeader;
  }
  return getPrimaryBot();
}

export const clientAuthRouter = Router();

const utmSchema = {
  utm_source: z.string().max(255).optional(),
  utm_medium: z.string().max(255).optional(),
  utm_campaign: z.string().max(255).optional(),
  utm_content: z.string().max(255).optional(),
  utm_term: z.string().max(255).optional(),
};

const registerSchema = z.object({
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  telegramId: z.string().optional(),
  telegramUsername: z.string().optional(),
  preferredLang: z.string().max(5).default("ru"),
  preferredCurrency: z.string().max(5).default("usd"),
  referralCode: z.string().optional(),
  ...utmSchema,
});

clientAuthRouter.post("/register", async (req, res) => {
  const body = registerSchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ message: "Проверьте введённые данные", errors: body.error.flatten() });
  }

  const data = body.data;
  // #200: email-регистрация допустима без пароля — его задают на шаге онбординга.
  const route = resolveRegisterRoute(data);
  const hasEmail = route === "email";

  if (!route) {
    return res.status(400).json({ message: "Укажите email или войдите через Telegram" });
  }

  // Какому клону принадлежит регистрация — определяем по X-Telegram-Bot-Token
  // (бот шлёт свой токен) либо берём primary (веб-регистрация).
  const requestBot = await resolveBotForClientRequest(req);
  if (!requestBot) {
    return res.status(503).json({ message: "Сервис временно недоступен. Обратитесь в поддержку." });
  }

  // Регистрация по email: создаём ожидание и отправляем письмо с ссылкой
  if (hasEmail) {
    const existing = await prisma.client.findUnique({ where: { email: data.email! } });
    if (existing) return res.status(400).json({ message: "Этот email уже зарегистрирован" });

    const config = await getSystemConfig();

    // ——— Антибот-защита: блок-лист доменов и паттернов ———
    if (config.signupProtectionEnabled !== false) {
      const check = validateEmailForSignup(data.email!, {
        customDomainBlocklist: config.emailDomainBlocklist ?? "",
        customPatternBlocklist: config.emailPatternBlocklist ?? "",
      });
      if (!check.ok) {
        // Намеренно НЕ говорим конкретно «домен в блок-листе» —
        // чтобы бот не мог попробовать другой домен из ответа.
        return res.status(400).json({ message: "Этот email нельзя использовать для регистрации." });
      }
    }

    // ——— Антибот-защита: лимит регистраций с одного IP ———
    // Окно 60 секунд. Запросы от Telegram-бота (X-Telegram-Bot-Token) пропускаем —
    // иначе все регистрации через /start блокируются (бот стучится от одного IP).
    const clientIp = getRequestIp(req);
    const isFromBot = typeof req.headers["x-telegram-bot-token"] === "string"
      && (req.headers["x-telegram-bot-token"] as string).length > 10;
    if (clientIp && !isFromBot && config.signupProtectionEnabled !== false) {
      const WINDOW_MS = 60_000; // 60 секунд
      const since = new Date(Date.now() - WINDOW_MS);
      const recentFromIp = await prisma.client.count({
        where: { registrationIp: clientIp, createdAt: { gte: since } },
      });
      // Историческое имя поля — 'PerHour', но фактически это лимит на текущее окно (60 сек).
      const maxPerWindow = config.signupMaxPerIpPerHour ?? 3;
      if (recentFromIp >= maxPerWindow) {
        // Считаем когда самая старая регистрация в окне выйдет → resetAt
        const oldest = await prisma.client.findFirst({
          where: { registrationIp: clientIp, createdAt: { gte: since } },
          orderBy: { createdAt: "asc" },
          select: { createdAt: true },
        });
        const resetAt = oldest?.createdAt
          ? oldest.createdAt.getTime() + WINDOW_MS
          : Date.now() + WINDOW_MS;
        const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
        res.setHeader("Retry-After", retryAfter);
        return res.status(429).json({
          message: `Слишком много регистраций с этого IP. Попробуйте через ${retryAfter} сек.`,
          retryAfter,
          resetAt: new Date(resetAt).toISOString(),
        });
      }
    }

    // Режим без подтверждения почты — создаём клиента сразу
    if (config.skipEmailVerification) {
      const referralCode = generateReferralCode();
      let referrerId: string | null = null;
      if (data.referralCode) {
        const referrer = await prisma.client.findFirst({ where: { referralCode: data.referralCode } });
        if (referrer) referrerId = referrer.id;
      }
      const passwordHash = data.password ? await hashPassword(data.password) : null;
      const client = await prisma.client.create({
        data: asClientUncheckedCreate({
          email: data.email!,
          passwordHash,
          remnawaveUuid: null,
          referralCode,
          referrerId,
          preferredLang: data.preferredLang,
          preferredCurrency: data.preferredCurrency,
          telegramId: null,
          telegramUsername: null,
          utmSource: data.utm_source ?? null,
          utmMedium: data.utm_medium ?? null,
          utmCampaign: data.utm_campaign ?? null,
          utmContent: data.utm_content ?? null,
          utmTerm: data.utm_term ?? null,
          autoRenewEnabled: config.defaultAutoRenewEnabled ?? false,
          onboardingCompleted: false,
          registrationIp: clientIp,
          registrationUa: (req.headers["user-agent"] as string)?.slice(0, 500) ?? null,
          registrationSource: "web",
        }),
      });
      notifyAdminsAboutNewClient(client.id).catch(() => {});
      const token = signClientToken(client.id);
      return res.status(201).json({ token, client: toClientShape(client) });
    }

    const smtpConfig = mailConfigFromSystem(config);
    if (!isMailConfigured(smtpConfig)) {
      return res.status(503).json({ message: "Регистрация по email не настроена. Обратитесь к администратору." });
    }

    const appUrl = (config.publicAppUrl || "").replace(/\/$/, "");
    if (!appUrl) {
      return res.status(503).json({ message: "Не задан публичный адрес приложения в настройках." });
    }

    const verificationToken = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 ч

    const referralCode = generateReferralCode();
    let referrerId: string | null = null;
    if (data.referralCode) {
      const referrer = await prisma.client.findFirst({ where: { referralCode: data.referralCode } });
      if (referrer) referrerId = referrer.id;
    }
    const passwordHash = data.password ? await hashPassword(data.password) : NO_PASSWORD_HASH;

    await prisma.pendingEmailRegistration.create({
      data: {
        email: data.email!,
        passwordHash,
        preferredLang: data.preferredLang,
        preferredCurrency: data.preferredCurrency,
        referralCode: data.referralCode || null,
        utmSource: data.utm_source ?? null,
        utmMedium: data.utm_medium ?? null,
        utmCampaign: data.utm_campaign ?? null,
        utmContent: data.utm_content ?? null,
        utmTerm: data.utm_term ?? null,
        verificationToken,
        expiresAt,
      },
    });
    // IP/UA сохраним в Client при подтверждении письма (см. /verify-email)
    void clientIp;

    const verificationLink = `${appUrl}/cabinet/verify-email?token=${verificationToken}`;
    // письмо рендерится из редактируемого шаблона
    // (админка → Email-шаблоны), а не из захардкоженного HTML.
    const verificationTpl = await renderEmailTemplate("email_verification", {
      verifyUrl: verificationLink,
      hours: "24",
      serviceName: config.serviceName ?? "STEALTHNET",
    });
    const sendResult = verificationTpl
      ? await sendEmail(smtpConfig, data.email!, verificationTpl.subject, verificationTpl.body)
      : { ok: false as const, error: "email_verification template missing" };
    console.log(`[register] Email send result to ${data.email}:`, sendResult);
    if (!sendResult.ok) {
      await prisma.pendingEmailRegistration.deleteMany({ where: { verificationToken } }).catch(() => {});
      return res.status(500).json({ message: "Не удалось отправить письмо подтверждения. Попробуйте позже." });
    }

    return res.status(201).json({ message: "Проверьте почту, чтобы завершить регистрацию", requiresVerification: true });
  }

  // 🔒 SECURITY: вход/регистрация по telegramId доверяется ТОЛЬКО аутентифицированному боту.
  // Без этого любой слал {telegramId:<жертва>} БЕЗ токена и получал сессию любого аккаунта.
  const tgAuthToken = extractBotTokenFromRequest(req as Parameters<typeof extractBotTokenFromRequest>[0]);
  const tgAuthBot = tgAuthToken ? await getBotByToken(tgAuthToken) : null;
  if (!tgAuthBot) {
    return res.status(401).json({ message: "Вход через Telegram требует авторизации бота" });
  }

  // Регистрация / вход по Telegram (используется ботом). 2FA не требуем — только для входа на сайте.
  if (route === "telegram") {
    const existing = await prisma.client.findFirst({
      where: asClientWhere({ telegramId: data.telegramId! }),
      select: { id: true, email: true, telegramId: true, telegramUsername: true, preferredLang: true, preferredCurrency: true, balance: true, referralCode: true, referralPercent: true, remnawaveUuid: true, trialUsed: true, isBlocked: true, autoRenewEnabled: true, autoRenewTariffId: true, yoomoneyAccessToken: true, totpEnabled: true, createdAt: true, onboardingCompleted: true, passwordHash: true },
    });
    if (existing) {
      if (!existing.isBlocked) {
        const blConfig = await getSystemConfig();
        if (blConfig.blacklistEnabled) {
          const { checkAndBlockIfBlacklisted } = await import("../blacklist/blacklist.service.js");
          const blocked = await checkAndBlockIfBlacklisted(data.telegramId!);
          if (blocked) return res.status(403).json({ message: "Аккаунт заблокирован" });
        }
      }
      if (existing.isBlocked) return res.status(403).json({ message: "Аккаунт заблокирован" });

      let subscriptionCheckPending = false;
      try {
        const ids = await findTelegramSubscriptions(data.telegramId!);
        await restoreTelegramSubscriptions(existing, ids);
        const restored = await prisma.client.findUniqueOrThrow({ where: { id: existing.id }, select: { remnawaveUuid: true, trialUsed: true } });
        Object.assign(existing, restored);
      } catch (error) {
        if (error instanceof TelegramSubscriptionCheckError && error.status === 409) return res.status(error.status).json({ message: error.message });
        subscriptionCheckPending = true;
      }

      // isNewClient=false — клиент уже был
      // (бот не будет fire after_registration broadcast).
      return res.json({ token: signClientToken(existing.id), client: toClientShape(existing), isNewClient: false, subscriptionCheckPending });
    }
  }

  const configForAutoRenew = await getSystemConfig();
  let telegramSubscriptionIds: string[] = [];
  let subscriptionCheckPending = false;
  try {
    telegramSubscriptionIds = await findTelegramSubscriptions(data.telegramId!);
    await checkTelegramSubscriptionOwners(telegramSubscriptionIds);
  } catch (error) {
    if (error instanceof TelegramSubscriptionCheckError && error.status === 409) return res.status(error.status).json({ message: error.message });
    subscriptionCheckPending = true;
  }
  const remnawaveUuid = telegramSubscriptionIds[0] ?? null;

  const referralCode = generateReferralCode();
  let referrerId: string | null = null;
  if (data.referralCode) {
    const referrer = await prisma.client.findFirst({ where: { referralCode: data.referralCode } });
    if (referrer) referrerId = referrer.id;
  }

  const passwordHash = data.password ? await hashPassword(data.password) : null;
  const tgRegIp = getRequestIp(req);
  // для TG-юзеров без email сразу
  // ставим onboardingCompleted=false — пусть привяжет почту через онбординг
  // при первом заходе на сайт. Для остальных оставляем дефолт schema (true).
  const isBareTgUser = !!data.telegramId && !data.email;
  const client = await prisma.client.create({
    data: asClientUncheckedCreate({
      email: data.email ?? null,
      passwordHash,
      remnawaveUuid: null,
      referralCode,
      referrerId,
      preferredLang: data.preferredLang,
      preferredCurrency: data.preferredCurrency,
      telegramId: data.telegramId ?? null,
      telegramUsername: data.telegramUsername ?? null,
      utmSource: data.utm_source ?? null,
      utmMedium: data.utm_medium ?? null,
      utmCampaign: data.utm_campaign ?? null,
      utmContent: data.utm_content ?? null,
      utmTerm: data.utm_term ?? null,
      autoRenewEnabled: configForAutoRenew.defaultAutoRenewEnabled ?? false,
      registrationIp: tgRegIp,
      registrationUa: (req.headers["user-agent"] as string)?.slice(0, 500) ?? null,
      registrationSource: data.telegramId ? "telegram" : "web",
      ...(isBareTgUser ? { onboardingCompleted: false } : {}),
      ...(remnawaveUuid ? { trialUsed: true } : {}),
    }),
  });
  notifyAdminsAboutNewClient(client.id).catch(() => {});

  try {
    await restoreTelegramSubscriptions(client, telegramSubscriptionIds);
    const restored = await prisma.client.findUniqueOrThrow({ where: { id: client.id }, select: { remnawaveUuid: true, trialUsed: true } });
    Object.assign(client, restored);
  } catch (error) {
    if (error instanceof TelegramSubscriptionCheckError) return res.status(error.status).json({ message: error.message });
    return res.status(503).json({ message: "Не удалось восстановить подписки. Повторите /start." });
  }

  if (data.telegramId) {
    const blConfig2 = await getSystemConfig();
    if (blConfig2.blacklistEnabled) {
      const { checkAndBlockIfBlacklisted } = await import("../blacklist/blacklist.service.js");
      const blocked = await checkAndBlockIfBlacklisted(data.telegramId);
      if (blocked) return res.status(403).json({ message: "Аккаунт заблокирован" });
    }
  }

  const token = signClientToken(client.id);
  // isNewClient=true — клиент только что создан.
  // Бот после регистрации проверяет флаг и запускает event-driven welcome (after_registration).
  return res.status(201).json({ token, client: toClientShape(client), isNewClient: true, subscriptionCheckPending });
});

const verifyLinkEmailSchema = z.object({ token: z.string().min(1) });
clientAuthRouter.post("/verify-link-email", async (req, res) => {
  const parse = verifyLinkEmailSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ message: "Проверьте введённые данные" });
  const { token } = parse.data;
  const pending = await prisma.pendingEmailLink.findUnique({ where: { verificationToken: token } });
  if (!pending) return res.status(400).json({ message: "Недействительная или просроченная ссылка" });
  if (new Date() > pending.expiresAt) {
    await prisma.pendingEmailLink.deleteMany({ where: { id: pending.id } }).catch(() => {});
    return res.status(400).json({ message: "Ссылка просрочена. Запросите привязку почты снова." });
  }
  const existingByEmail = await prisma.client.findUnique({
    where: { email: pending.email },
    select: { id: true, telegramId: true },
  });
  const clientSelect = { id: true, email: true, telegramId: true, telegramUsername: true, preferredLang: true, preferredCurrency: true, balance: true, referralCode: true, referralPercent: true, remnawaveUuid: true, trialUsed: true, isBlocked: true, autoRenewEnabled: true, autoRenewTariffId: true, yoomoneyAccessToken: true, totpEnabled: true, createdAt: true, onboardingCompleted: true } as const;
  if (existingByEmail && existingByEmail.id !== pending.clientId) {
    // Почта уже принадлежит другому аккаунту. Владелец подтвердил, что почта его
    // (перешёл по ссылке из письма) — значит это его второй аккаунт. Сливаем его
    // в инициатора привязки (схема Алекса: инициатор — основной, дубль удаляется).
    // Отказ только если у владельца почты уже есть Telegram (полноценный аккаунт).
    if (existingByEmail.telegramId) {
      await prisma.pendingEmailLink.deleteMany({ where: { id: pending.id } }).catch(() => {});
      return res.status(400).json({ message: "Эта почта привязана к другому аккаунту с Telegram. Объединение невозможно — обратитесь в поддержку." });
    }
    try {
      await mergeClients(pending.clientId, existingByEmail.id, { email: pending.email });
    } catch (e) {
      console.error("[verify-link-email] merge failed:", e);
      await prisma.pendingEmailLink.deleteMany({ where: { id: pending.id } }).catch(() => {});
      return res.status(500).json({ message: "Не удалось объединить аккаунты. Обратитесь в поддержку." });
    }
    await prisma.pendingEmailLink.deleteMany({ where: { id: pending.id } }).catch(() => {});
    const merged = await prisma.client.findUnique({ where: { id: pending.clientId }, select: clientSelect });
    if (!merged) return res.status(500).json({ message: "Не удалось завершить привязку" });
    return res.json(buildAuthResponse(merged));
  }
  const client = await prisma.client.update({
    where: { id: pending.clientId },
    data: { email: pending.email },
    select: clientSelect,
  });
  await prisma.pendingEmailLink.deleteMany({ where: { id: pending.id } }).catch(() => {});
  const auth = buildAuthResponse(client);
  return res.json(auth);
});

const verifyEmailSchema = z.object({ token: z.string().min(1) });
const alreadyVerifiedResponse = {
  alreadyVerified: true,
  message: "Email уже подтверждён. Войдите в аккаунт; если пароль ещё не задан — воспользуйтесь «Забыли пароль?».",
} as const;
clientAuthRouter.post("/verify-email", async (req, res) => {
  const parse = verifyEmailSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ message: "Проверьте введённые данные" });
  const { token } = parse.data;

  const pending = await prisma.pendingEmailRegistration.findUnique({
    where: { verificationToken: token },
  });
  const now = new Date();
  const expired = pending ? now > pending.expiresAt : false;
  const existingClient = pending
    ? await prisma.client.findUnique({ where: { email: pending.email }, select: { id: true } })
    : null;
  const decision = decideVerifyEmail({ pendingExists: Boolean(pending), expired, clientExists: Boolean(existingClient) });
  if (!pending || decision === "invalid") return res.status(400).json({ message: "Ссылка недействительна или устарела" });
  if (decision === "expired") {
    await prisma.pendingEmailRegistration.delete({ where: { id: pending.id } }).catch(() => {});
    return res.status(400).json({ message: "Ссылка истекла — зарегистрируйтесь заново." });
  }
  if (decision === "already_verified") {
    // #200: повторный переход (повторное открытие, превью почтового клиента). Сессию НЕ выдаём —
    // старая/утёкшая ссылка не должна давать вход после использования.
    if (expired) await prisma.pendingEmailRegistration.delete({ where: { id: pending.id } }).catch(() => {});
    return res.json(alreadyVerifiedResponse);
  }

  // Не создаём пользователя в Remna при регистрации — клиент неактивен до триала или оплаты тарифа.
  const referralCode = generateReferralCode();
  let referrerId: string | null = null;
  if (pending.referralCode) {
    const referrer = await prisma.client.findFirst({ where: { referralCode: pending.referralCode } });
    if (referrer) referrerId = referrer.id;
  }

  // Email-регистрация — всегда primary bot (веб-кабинет, без привязки к клону).
  const primaryBot = await getPrimaryBot();
  if (!primaryBot) {
    return res.status(503).json({ message: "Сервис временно недоступен. Обратитесь в поддержку." });
  }

  const configForAutoRenew = await getSystemConfig();
  let client;
  try {
    client = await prisma.client.create({
      data: asClientUncheckedCreate({
        email: pending.email,
        // #200: пароль не выбран → null → hasPassword: false → онбординг попросит задать пароль
        passwordHash: clientPasswordHashFromPending(pending.passwordHash),
        remnawaveUuid: null,
        referralCode,
        referrerId,
        preferredLang: pending.preferredLang,
        preferredCurrency: pending.preferredCurrency,
        telegramId: null,
        telegramUsername: null,
        utmSource: pending.utmSource,
        utmMedium: pending.utmMedium,
        utmCampaign: pending.utmCampaign,
        utmContent: pending.utmContent,
        utmTerm: pending.utmTerm,
        autoRenewEnabled: configForAutoRenew.defaultAutoRenewEnabled ?? false,
        onboardingCompleted: false,
        // IP/UA на момент перехода по ссылке из письма (не на момент создания pending —
        // боты обычно не ходят по ссылкам, а если ходят — это уже другой IP, ещё лучше)
        registrationIp: getRequestIp(req),
        registrationUa: (req.headers["user-agent"] as string)?.slice(0, 500) ?? null,
        registrationSource: "web",
      }),
    });
  } catch (e) {
    // Параллельный первый переход уже создал клиента (unique email) — сессию не выдаём.
    if (isEmailUniqueViolation(e)) return res.json(alreadyVerifiedResponse);
    throw e;
  }

  // Не удаляем запись сразу: короткое окно, в котором повтор отвечает «уже подтверждено».
  // Хеш пароля из ожидающей записи больше не нужен — стираем.
  await prisma.pendingEmailRegistration
    .update({ where: { id: pending.id }, data: { passwordHash: NO_PASSWORD_HASH, expiresAt: consumedPendingExpiry(now, pending.expiresAt) } })
    .catch(() => {});

  notifyAdminsAboutNewClient(client.id).catch(() => {});
  const signToken = signClientToken(client.id);
  return res.status(201).json({ token: signToken, client: toClientShape(client) });
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// #200: один текст для «неверный пароль» и «пароля нет» — без перечисления аккаунтов.
const LOGIN_FAILED_MESSAGE = "Неверный email или пароль. Если вы регистрировались по email и не задавали пароль — воспользуйтесь «Забыли пароль?».";

clientAuthRouter.post("/login", async (req, res) => {
  const body = loginSchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ message: "Проверьте введённые данные" });
  }

  const client = await prisma.client.findUnique({ where: { email: body.data.email } });
  if (!client || !client.passwordHash || client.isBlocked) {
    return res.status(401).json({ message: LOGIN_FAILED_MESSAGE });
  }

  const valid = await verifyPassword(body.data.password, client.passwordHash);
  if (!valid) return res.status(401).json({ message: LOGIN_FAILED_MESSAGE });

  const full = await prisma.client.findUnique({
    where: { id: client.id },
    select: { id: true, email: true, telegramId: true, telegramUsername: true, preferredLang: true, preferredCurrency: true, balance: true, referralCode: true, referralPercent: true, remnawaveUuid: true, trialUsed: true, isBlocked: true, autoRenewEnabled: true, autoRenewTariffId: true, yoomoneyAccessToken: true, totpEnabled: true, createdAt: true, onboardingCompleted: true, passwordHash: true },
  });
  if (!full) return res.status(401).json({ message: LOGIN_FAILED_MESSAGE });
  const auth = buildAuthResponse(full);
  return res.json(auth);
});

/** Валидация initData из Telegram Web App (Mini App). https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app */
export function validateTelegramInitData(initData: string, botToken: string): boolean {
  if (!initData?.trim() || !botToken?.trim()) return false;
  const params = new URLSearchParams(initData.trim());
  const hash = params.get("hash");
  if (!hash) return false;
  params.delete("hash");
  const authDate = params.get("auth_date");
  if (!authDate) return false;
  const authTimestamp = parseInt(authDate, 10);
  if (!Number.isFinite(authTimestamp) || Date.now() / 1000 - authTimestamp > 3600) return false; // не старше 1 часа
  const sorted = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = sorted.map(([k, v]) => `${k}=${v}`).join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const computedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  return computedHash === hash;
}

/** Парсинг user из initData (JSON в параметре user) */
export function parseTelegramUser(initData: string): { id: number; username?: string } | null {
  const params = new URLSearchParams(initData.trim());
  const userStr = params.get("user");
  if (!userStr) return null;
  try {
    const user = JSON.parse(userStr) as Record<string, unknown>;
    const id = typeof user.id === "number" ? user.id : Number(user.id);
    if (!Number.isFinite(id)) return null;
    const username = typeof user.username === "string" ? user.username : undefined;
    return { id, username };
  } catch {
    return null;
  }
}

// T-pwd-reset (портировано из WolfVPN + Issue #200 + Hybrid Telegram/Email): запрос сброса пароля.
// respondOk всегда (защита от перебора email).
const forgotPasswordSchema = z.object({ email: z.string().email() });
clientAuthRouter.post("/forgot-password", async (req, res) => {
  const cfg = await getSystemConfig();
  if (!cfg.passwordResetEnabled) return res.status(404).json({ message: "Восстановление пароля временно недоступно" });
  const body = forgotPasswordSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Введите корректный email" });
  const email = body.data.email.toLowerCase().trim();
  const respondOk = () => res.json({ ok: true });
  try {
    // поиск регистронезависимый. Регистрация/логин хранят email
    // как ввёл юзер, а здесь он приводился к lowercase — юзер с «Test@example.com»
    // в БД не находился, и письмо сброса молча не отправлялось (при ok:true в ответе).
    const client = await prisma.client.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        isBlocked: true,
        registrationSource: true,
        telegramId: true,
        preferredLang: true,
      },
    });

    if (!client || client.isBlocked) {
      console.info(`[forgot-password] Request for "${email}": client not found or blocked (silent ok)`);
      return respondOk();
    }

    const canEmailReset = canResetPassword(client);
    const hasTelegram = Boolean(client.telegramId?.trim());
    const isFirstPassword = !client.passwordHash?.trim();

    // Если у аккаунта нет пароля, он не верифицирован через web и нет привязки к Telegram —
    // в целях безопасности (защита от перехвата аккаунта через произвольный email) отклоняем.
    if (!canEmailReset && !hasTelegram) {
      console.info(`[forgot-password] Request for "${email}" (client ${client.id}): skipped — no password and no Telegram link`);
      return respondOk();
    }

    const config = await getSystemConfig();
    const appUrl = (config.publicAppUrl || "").replace(/\/$/, "");
    if (!appUrl) {
      console.warn(`[forgot-password] Cannot generate reset link: publicAppUrl is not set`);
      return respondOk();
    }

    const token = signClientPasswordResetToken({ clientId: client.id, pv: passwordResetFingerprint(client.passwordHash) }, env.JWT_SECRET);
    const resetLink = `${appUrl}/cabinet/reset-password?token=${encodeURIComponent(token)}`;

    // 1. Канал Telegram: если клиент привязан к Telegram-боту, отправляем кнопку прямо в бот
    // (для Telegram-аккаунтов без пароля также отправляется поясняющее письмо на email).
    if (hasTelegram) {
      console.info(`[forgot-password] Dispatching Telegram reset button to user ${client.telegramId} (client ${client.id})`);
      await notifyClientPasswordReset(client, resetLink, isFirstPassword).catch((err) => {
        console.warn(`[forgot-password] Telegram notification error:`, err);
      });
    }

    // 2. Канал Email: если аккаунт имеет пароль или зарегистрирован через web — отправляем стандартное письмо со ссылкой
    if (canEmailReset) {
      const smtpConfig = mailConfigFromSystem(config);
      if (isMailConfigured(smtpConfig)) {
        const resetTpl = await renderEmailTemplate("password_reset", {
          resetUrl: resetLink,
          minutes: "60",
          serviceName: config.serviceName ?? "STEALTHNET",
        });
        if (resetTpl) {
          const mailRes = await sendEmail(smtpConfig, client.email ?? email, resetTpl.subject, resetTpl.body).catch((err) => ({ ok: false, error: String(err) }));
          console.info(`[forgot-password] Sent reset email to "${client.email ?? email}":`, mailRes.ok ? "OK" : `FAILED (${mailRes.error})`);
        }
      } else {
        console.warn(`[forgot-password] Mail provider not configured, skipped email dispatch`);
      }
    }

    return respondOk();
  } catch (err) {
    console.error(`[forgot-password] Unexpected error for "${email}":`, err);
    return respondOk();
  }
});

// T-pwd-reset: установка нового пароля по токену из письма или Telegram (одноразовый — pv инвалидируется после смены).
const resetPasswordSchema = z.object({ token: z.string().min(10), password: z.string().min(8, "Минимум 8 символов") });
clientAuthRouter.post("/reset-password", async (req, res) => {
  const cfg = await getSystemConfig();
  if (!cfg.passwordResetEnabled) return res.status(404).json({ message: "Восстановление пароля временно недоступно" });
  const body = resetPasswordSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: body.error.issues[0]?.message ?? "Проверьте данные" });
  const payload = verifyClientPasswordResetToken(body.data.token, env.JWT_SECRET);
  if (!payload) return res.status(400).json({ message: "Ссылка недействительна или устарела" });
  const client = await prisma.client.findUnique({
    where: { id: payload.clientId },
    select: { id: true, passwordHash: true, isBlocked: true, registrationSource: true, telegramId: true },
  });
  const canEmailReset = canResetPassword(client ?? { passwordHash: null, registrationSource: null });
  const hasTelegram = Boolean(client?.telegramId?.trim());
  if (!client || client.isBlocked || (!canEmailReset && !hasTelegram)) {
    return res.status(400).json({ message: "Ссылка недействительна" });
  }
  if (passwordResetFingerprint(client.passwordHash) !== payload.pv) return res.status(400).json({ message: "Ссылка уже использована — запросите сброс заново" });
  const newHash = await hashPassword(body.data.password);
  const updated = await prisma.client.updateMany({ where: { id: client.id, passwordHash: client.passwordHash }, data: { passwordHash: newHash } });
  if (!updated.count) return res.status(400).json({ message: "Ссылка уже использована — запросите сброс заново" });
  return res.json({ ok: true });
});

const telegramMiniappSchema = z.object({ initData: z.string().min(1) });

clientAuthRouter.post("/telegram-miniapp", async (req, res) => {
  const body = telegramMiniappSchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ message: "Проверьте введённые данные", errors: body.error.flatten() });
  }
  // v5.0.0: Mini App initData подписан токеном единственного бота инсталляции
  // (process.env.BOT_TOKEN). Раньше проверяли по каждому активному клону.
  const botToken = (process.env.BOT_TOKEN ?? "").trim();
  if (!botToken || !validateTelegramInitData(body.data.initData, botToken)) {
    return res.status(401).json({ message: "Данные Telegram недействительны или устарели" });
  }
  const tgUser = parseTelegramUser(body.data.initData);
  if (!tgUser) return res.status(400).json({ message: "Не удалось получить данные пользователя Telegram" });

  const telegramId = String(tgUser.id);
  const telegramUsername = tgUser.username?.trim() ?? null;
  const existing = await prisma.client.findFirst({
    where: asClientWhere({ telegramId }),
    select: { id: true, email: true, telegramId: true, telegramUsername: true, preferredLang: true, preferredCurrency: true, balance: true, referralCode: true, referralPercent: true, remnawaveUuid: true, trialUsed: true, isBlocked: true, autoRenewEnabled: true, autoRenewTariffId: true, yoomoneyAccessToken: true, totpEnabled: true, createdAt: true, onboardingCompleted: true, passwordHash: true },
  });
  if (existing) {
    if (existing.isBlocked) return res.status(403).json({ message: "Аккаунт заблокирован" });
    // Existing account onboarding state remains authoritative across devices.

    const auth = buildAuthResponse(existing);
    return res.json(auth);
  }

  const configForDefaults = await getSystemConfig();
  // Если Remna-пользователь уже существует (например, создан ботом раньше) — используем его;
  // иначе создаём с remnawaveUuid=null, Remna-юзер будет создан при активации триала / покупке тарифа.
  // Это предотвращает появление «истёкшей подписки» в UI сразу после регистрации.
  let remnawaveUuid: string | null = null;
  if (isRemnaConfigured()) {
    const byTgRes = await remnaGetUserByTelegramId(telegramId);
    remnawaveUuid = extractRemnaUuid(byTgRes.data);
  }
  const referralCode = generateReferralCode();
  // новый TG-юзер без email/пароля → онбординг.
  const client = await prisma.client.create({
    data: asClientUncheckedCreate({
      email: null,
      passwordHash: null,
      remnawaveUuid,
      referralCode,
      referrerId: null,
      preferredLang: configForDefaults.defaultLanguage ?? "ru",
      preferredCurrency: configForDefaults.defaultCurrency ?? "usd",
      telegramId,
      telegramUsername,
      autoRenewEnabled: configForDefaults.defaultAutoRenewEnabled ?? false,
      onboardingCompleted: false,
    }),
  });
  notifyAdminsAboutNewClient(client.id).catch(() => {});
  const token = signClientToken(client.id);
  // isNewClient=true — клиент только что создан.
  // Бот после регистрации проверяет флаг и запускает event-driven welcome (after_registration).
  return res.status(201).json({ token, client: toClientShape(client), isNewClient: true });
});

const twoFaLoginSchema = z.object({ tempToken: z.string().min(1), code: z.string().length(6, "Код 6 цифр").regex(/^\d+$/) });
clientAuthRouter.post("/2fa-login", async (req, res) => {
  const body = twoFaLoginSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Введите 6-значный код", errors: body.error.flatten() });
  const payload = verifyClient2FAPendingToken(body.data.tempToken);
  if (!payload) return res.status(401).json({ message: "Сессия истекла. Войдите снова." });
  const client = await prisma.client.findUnique({
    where: { id: payload.clientId },
    select: { id: true, email: true, telegramId: true, telegramUsername: true, preferredLang: true, preferredCurrency: true, balance: true, referralCode: true, referralPercent: true, remnawaveUuid: true, trialUsed: true, isBlocked: true, autoRenewEnabled: true, autoRenewTariffId: true, yoomoneyAccessToken: true, totpSecret: true, totpEnabled: true, createdAt: true, onboardingCompleted: true, passwordHash: true },
  });
  if (!client?.totpEnabled || !client.totpSecret) return res.status(401).json({ message: "2FA не включена. Войдите снова." });
  const result = await verify({ secret: client.totpSecret, token: body.data.code });
  if (!result.valid) return res.status(401).json({ message: "Неверный код" });
  const token = signClientToken(client.id);
  return res.json({ token, client: toClientShape(client) });
});

clientAuthRouter.get("/me", requireClientAuth, async (req, res) => {
  const client = (req as unknown as { client: { id: string } }).client;
  const full = await prisma.client.findUnique({
    where: { id: client.id },
    select: {
      id: true, email: true, telegramId: true, telegramUsername: true, preferredLang: true, preferredCurrency: true,
      balance: true, referralCode: true, referralPercent: true, remnawaveUuid: true, trialUsed: true, isBlocked: true,
      autoRenewEnabled: true, autoRenewTariffId: true, autoRenewPromoCode: true, yoomoneyAccessToken: true,
      totpEnabled: true, createdAt: true, yookassaPaymentMethodTitle: true, onboardingCompleted: true, passwordHash: true,
      // «Мои подписки» / Commit 2 — нужен currentTariff для category-aware диалога
      // при покупке тарифа из другой категории (продлить vs сменить vs купить как доп.).
      currentTariffId: true,
      currentTariff: { select: { id: true, name: true, categoryId: true } },
      // нужен боту для расчёта и отображения
      // зачёркнутой базовой цены на экранах выбора платежки и оплаты тарифа.
      personalDiscountPercent: true,
    },
  });
  if (!full) return res.status(401).json({ message: "Требуется авторизация" });
  return res.json(toClientShape(full));
});

/**
 * Извлекает shortUuid из ссылки-подписки. Формат Remnawave:
 * `https://<domain>/api/sub/<shortUuid>` или `.../api/sub/<shortUuid>/<clientType>`
 * (happ|singbox|clash|…). Берём сегмент СРАЗУ после "sub" (не последний — им
 * может оказаться clientType). Допускаем и голый shortUuid (без URL).
 */
function extractShortUuidFromSubUrl(raw: string): string | null {
  const s0 = (raw || "").trim();
  if (!s0) return null;
  const valid = (v: string | undefined): v is string => !!v && /^[A-Za-z0-9_-]{6,}$/.test(v);
  if (!/^https?:\/\//i.test(s0)) return valid(s0) ? s0 : null; // голый shortUuid
  const path = s0.split(/[?#]/)[0];
  const segs = path.split("/").filter(Boolean); // [https:, domain, api, sub, <shortUuid>, <clientType?>]
  const subIdx = segs.lastIndexOf("sub");
  if (subIdx >= 0 && valid(segs[subIdx + 1])) return segs[subIdx + 1];
  const last = segs[segs.length - 1]; // фолбэк: последний валидный сегмент
  return valid(last) ? last : null;
}

/**
 * POST /api/client/auth/by-subscription — авто-логин по ссылке-подписке (кабинет в приложении).
 * Ключ входа = сама ссылка-подписка (её знает только владелец). Пароль/2FA не нужны:
 * приложение шлёт полный sub-URL → извлекаем shortUuid → Remnawave-юзер → наш клиент-владелец
 * → client-JWT. Адрес ЭТОЙ панели приложение узнаёт из кастомного заголовка `x-cabinet-url`
 * в ответе подписки (как announce/истории), поэтому механика работает на любой панели-форке.
 */
const bySubscriptionSchema = z.object({ subscriptionUrl: z.string().min(1).max(2048) });
clientAuthRouter.post("/by-subscription", async (req, res) => {
  const parsed = bySubscriptionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "subscriptionUrl обязателен" });
  if (!isRemnaConfigured()) return res.status(503).json({ message: "Remnawave не настроен" });

  const shortUuid = extractShortUuidFromSubUrl(parsed.data.subscriptionUrl);
  if (!shortUuid) return res.status(400).json({ message: "Не удалось разобрать ссылку подписки" });

  // Remnawave-юзер по shortUuid → его uuid.
  const remnaRes = await remnaGetUserByShortUuid(shortUuid);
  if (remnaRes.error) return res.status(404).json({ message: "Подписка не найдена" });
  const uuid = extractRemnaUuid(remnaRes.data);
  if (!uuid) return res.status(404).json({ message: "Подписка не найдена" });

  // Наш клиент-владелец: сперва по таблице подписок (актуальнее при перевыпуске),
  // затем фолбэк по client.remnawaveUuid.
  const sub = await prisma.subscription.findFirst({ where: { remnawaveUuid: uuid }, select: { ownerId: true } });
  const clientId = sub?.ownerId
    ?? (await prisma.client.findFirst({ where: { remnawaveUuid: uuid }, select: { id: true } }))?.id
    ?? null;
  if (!clientId) return res.status(404).json({ message: "Аккаунт не найден" });

  const full = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, email: true, telegramId: true, telegramUsername: true, preferredLang: true, preferredCurrency: true, balance: true, referralCode: true, referralPercent: true, remnawaveUuid: true, trialUsed: true, isBlocked: true, autoRenewEnabled: true, autoRenewTariffId: true, yoomoneyAccessToken: true, totpEnabled: true, createdAt: true, onboardingCompleted: true, passwordHash: true },
  });
  if (!full || full.isBlocked) return res.status(403).json({ message: "Аккаунт недоступен" });

  // Вход по подписке БЕЗ 2FA-барьера: ключ = сама ссылка; второй фактор — только для email/пароля.
  return res.json({ token: signClientToken(full.id), client: toClientShape(full) });
});

/**
 * event-driven welcome для after_registration
 * правил. Бот вызывает после успешной регистрации нового клиента (`isNewClient=true`
 * из /register). Запускает все enabled rules с triggerType=after_registration.
 *
 * Дедуп тот же что у крон-пути — `(rule_id, client_id)` через autoBroadcastLog.
 * Идемпотентно: повторный вызов для того же клиента отбрасывается дедупом.
 */
clientAuthRouter.post("/fire-on-registration", requireClientAuth, async (req, res) => {
  const client = (req as unknown as { client: { id: string } }).client;
  try {
    const { fireRegistrationRulesForClient } = await import("../auto-broadcast/auto-broadcast.service.js");
    const results = await fireRegistrationRulesForClient(client.id);
    const totalSent = results.reduce((s, r) => s + r.sent, 0);
    return res.json({ ok: true, rulesProcessed: results.length, sent: totalSent });
  } catch (e) {
    console.error("[fire-on-registration] failed:", e);
    return res.status(500).json({ ok: false, message: e instanceof Error ? e.message : "Внутренняя ошибка" });
  }
});

export function toClientShape(c: {
  id: string;
  email: string | null;
  telegramId?: string | null;
  telegramUsername?: string | null;
  preferredLang: string;
  preferredCurrency: string;
  balance: number;
  referralCode: string | null;
  referralPercent?: number | null;
  remnawaveUuid: string | null;
  trialUsed?: boolean;
  isBlocked?: boolean;
  yoomoneyAccessToken?: string | null;
  totpEnabled?: boolean;
  createdAt?: Date;
  autoRenewEnabled?: boolean;
  autoRenewTariffId?: string | null;
  autoRenewPromoCode?: string | null;
  yookassaPaymentMethodTitle?: string | null;
  onboardingCompleted?: boolean;
  passwordHash?: string | null;
  // currentTariff передаётся боту для category-aware диалога.
  currentTariffId?: string | null;
  currentTariff?: { id: string; name: string; categoryId: string | null } | null;
  // бот использует поле для зачёркивания базовой цены.
  personalDiscountPercent?: number | null;
}) {
  return {
    id: c.id,
    email: c.email,
    telegramId: c.telegramId ?? null,
    telegramUsername: c.telegramUsername ?? null,
    preferredLang: c.preferredLang,
    preferredCurrency: c.preferredCurrency,
    balance: c.balance,
    referralCode: c.referralCode,
    referralPercent: c.referralPercent ?? null,
    remnawaveUuid: c.remnawaveUuid,
    trialUsed: c.trialUsed ?? false,
    isBlocked: c.isBlocked ?? false,
    yoomoneyConnected: Boolean(c.yoomoneyAccessToken),
    totpEnabled: c.totpEnabled ?? false,
    createdAt: c.createdAt ? c.createdAt.toISOString() : undefined,
    autoRenewEnabled: c.autoRenewEnabled ?? false,
    autoRenewTariffId: c.autoRenewTariffId ?? null,
    autoRenewPromoCode: c.autoRenewPromoCode ?? null,
    yookassaPaymentMethodTitle: c.yookassaPaymentMethodTitle ?? null,
    onboardingCompleted: c.onboardingCompleted ?? true,
    hasPassword: Boolean(c.passwordHash && c.passwordHash.trim()),
    // используется ботом в pay_tariff handler для category-check.
    currentTariffId: c.currentTariffId ?? null,
    currentTariff: c.currentTariff
      ? { id: c.currentTariff.id, name: c.currentTariff.name, categoryId: c.currentTariff.categoryId ?? null }
      : null,
    // бот рендерит зачёркнутую базовую цену.
    personalDiscountPercent: c.personalDiscountPercent ?? null,
  };
}

/** Если у клиента включена 2FA — возвращаем tempToken для шага ввода кода; иначе — обычные token и client. */
function buildAuthResponse(c: { id: string; totpEnabled?: boolean } & Parameters<typeof toClientShape>[0]) {
  if (c.totpEnabled) {
    return { requires2FA: true as const, tempToken: signClient2FAPendingToken(c.id) };
  }
  return { token: signClientToken(c.id), client: toClientShape(c) };
}

// ——— Google OAuth: фронтенд отправляет id_token, полученный через Sign In With Google ———
const googleAuthSchema = z.object({ idToken: z.string().min(1) });
clientAuthRouter.post("/google", async (req, res) => {
  const parse = googleAuthSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ message: "Проверьте введённые данные" });
  const config = await getSystemConfig();
  if (!config.googleLoginEnabled || !config.googleClientId) {
    return res.status(403).json({ message: "Вход через Google отключён" });
  }
  let payload: { sub?: string; email?: string; email_verified?: boolean } | undefined;
  try {
    const { OAuth2Client } = await import("google-auth-library");
    const gClient = new OAuth2Client(config.googleClientId);
    const ticket = await gClient.verifyIdToken({
      idToken: parse.data.idToken,
      audience: config.googleClientId,
    });
    payload = ticket.getPayload();
  } catch (err) {
    console.error("[Google OAuth] verify error:", err);
    return res.status(401).json({ message: "Недействительный токен Google" });
  }
  if (!payload?.sub) return res.status(401).json({ message: "Недействительный токен Google" });
  const googleId = payload.sub;
  // 🔒 SECURITY: email из Google доверяем ТОЛЬКО при email_verified=true (иначе линковка
  // по email к существующему аккаунту = захват).
  const emailVerified = payload.email_verified === true;
  const googleEmail = emailVerified ? payload.email ?? null : null;

  const existing = await prisma.client.findUnique({
    where: { googleId },
    select: { id: true, email: true, telegramId: true, telegramUsername: true, preferredLang: true, preferredCurrency: true, balance: true, referralCode: true, referralPercent: true, remnawaveUuid: true, trialUsed: true, isBlocked: true, autoRenewEnabled: true, autoRenewTariffId: true, yoomoneyAccessToken: true, totpEnabled: true, createdAt: true, onboardingCompleted: true, passwordHash: true },
  });
  if (existing) {
    if (existing.isBlocked) return res.status(403).json({ message: "Аккаунт заблокирован" });
    const auth = buildAuthResponse(existing);
    return res.json(auth);
  }

  if (googleEmail && emailVerified) {
    const byEmail = await prisma.client.findUnique({
      where: { email: googleEmail },
      select: { id: true, email: true, googleId: true, telegramId: true, telegramUsername: true, preferredLang: true, preferredCurrency: true, balance: true, referralCode: true, referralPercent: true, remnawaveUuid: true, trialUsed: true, isBlocked: true, autoRenewEnabled: true, autoRenewTariffId: true, yoomoneyAccessToken: true, totpEnabled: true, createdAt: true, onboardingCompleted: true, passwordHash: true },
    });
    if (byEmail) {
      if (byEmail.isBlocked) return res.status(403).json({ message: "Аккаунт заблокирован" });
      await prisma.client.update({ where: { id: byEmail.id }, data: { googleId } });
      const auth = buildAuthResponse(byEmail);
      return res.json(auth);
    }
  }

  const configForDefaults = await getSystemConfig();
  // Если есть Remna-юзер с такой почтой — используем его; иначе оставляем remnawaveUuid=null,
  // Remna-юзер будет создан при активации триала / покупке тарифа.
  let remnawaveUuid: string | null = null;
  if (isRemnaConfigured() && googleEmail?.trim()) {
    const byEmailRes = await remnaGetUserByEmail(googleEmail.trim());
    remnawaveUuid = extractRemnaUuid(byEmailRes.data);
  }
  const referralCode = generateReferralCode();
  const client = await prisma.client.create({
    data: asClientUncheckedCreate({
      email: googleEmail,
      passwordHash: null,
      remnawaveUuid,
      referralCode,
      referrerId: null,
      preferredLang: configForDefaults.defaultLanguage ?? "ru",
      preferredCurrency: configForDefaults.defaultCurrency ?? "usd",
      telegramId: null,
      telegramUsername: null,
      googleId,
      autoRenewEnabled: configForDefaults.defaultAutoRenewEnabled ?? false,
    }),
  });
  notifyAdminsAboutNewClient(client.id).catch(() => {});
  const token = signClientToken(client.id);
  // isNewClient=true — клиент только что создан.
  // Бот после регистрации проверяет флаг и запускает event-driven welcome (after_registration).
  return res.status(201).json({ token, client: toClientShape(client), isNewClient: true });
});

// ——— Apple Sign In: фронтенд отправляет id_token (JWT от Apple) ———
const appleAuthSchema = z.object({ idToken: z.string().min(1) });
clientAuthRouter.post("/apple", async (req, res) => {
  const parse = appleAuthSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ message: "Проверьте введённые данные" });
  const config = await getSystemConfig();
  if (!config.appleLoginEnabled || !config.appleClientId) {
    return res.status(403).json({ message: "Вход через Apple отключён" });
  }

  let appleSub: string | null = null;
  let appleEmail: string | null = null;
  try {
    const { createRemoteJWKSet, jwtVerify } = await import("jose");
    const APPLE_JWKS = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));
    const { payload: jwtPayload } = await jwtVerify(parse.data.idToken, APPLE_JWKS, {
      issuer: "https://appleid.apple.com",
      audience: config.appleClientId,
    });
    appleSub = (jwtPayload.sub as string) ?? null;
    appleEmail = (jwtPayload as { email?: string }).email ?? null;
  } catch (err) {
    console.error("[Apple OAuth] verify error:", err);
    return res.status(401).json({ message: "Недействительный токен Apple" });
  }
  if (!appleSub) return res.status(401).json({ message: "Недействительный токен Apple" });

  const existing = await prisma.client.findUnique({
    where: { appleId: appleSub },
    select: { id: true, email: true, telegramId: true, telegramUsername: true, preferredLang: true, preferredCurrency: true, balance: true, referralCode: true, referralPercent: true, remnawaveUuid: true, trialUsed: true, isBlocked: true, autoRenewEnabled: true, autoRenewTariffId: true, yoomoneyAccessToken: true, totpEnabled: true, createdAt: true, onboardingCompleted: true, passwordHash: true },
  });
  if (existing) {
    if (existing.isBlocked) return res.status(403).json({ message: "Аккаунт заблокирован" });
    const auth = buildAuthResponse(existing);
    return res.json(auth);
  }

  if (appleEmail) {
    const byEmail = await prisma.client.findUnique({
      where: { email: appleEmail },
      select: { id: true, email: true, appleId: true, telegramId: true, telegramUsername: true, preferredLang: true, preferredCurrency: true, balance: true, referralCode: true, referralPercent: true, remnawaveUuid: true, trialUsed: true, isBlocked: true, autoRenewEnabled: true, autoRenewTariffId: true, yoomoneyAccessToken: true, totpEnabled: true, createdAt: true, onboardingCompleted: true, passwordHash: true },
    });
    if (byEmail) {
      if (byEmail.isBlocked) return res.status(403).json({ message: "Аккаунт заблокирован" });
      await prisma.client.update({ where: { id: byEmail.id }, data: { appleId: appleSub } });
      const auth = buildAuthResponse(byEmail);
      return res.json(auth);
    }
  }

  const configForDefaults = await getSystemConfig();
  // Если есть Remna-юзер с такой почтой — используем его; иначе оставляем remnawaveUuid=null,
  // Remna-юзер будет создан при активации триала / покупке тарифа.
  let remnawaveUuid: string | null = null;
  if (isRemnaConfigured() && appleEmail?.trim()) {
    const byEmailRes = await remnaGetUserByEmail(appleEmail.trim());
    remnawaveUuid = extractRemnaUuid(byEmailRes.data);
  }
  const referralCode = generateReferralCode();
  const client = await prisma.client.create({
    data: asClientUncheckedCreate({
      email: appleEmail,
      passwordHash: null,
      remnawaveUuid,
      referralCode,
      referrerId: null,
      preferredLang: configForDefaults.defaultLanguage ?? "ru",
      preferredCurrency: configForDefaults.defaultCurrency ?? "usd",
      telegramId: null,
      telegramUsername: null,
      appleId: appleSub,
      autoRenewEnabled: configForDefaults.defaultAutoRenewEnabled ?? false,
    }),
  });
  notifyAdminsAboutNewClient(client.id).catch(() => {});
  const token = signClientToken(client.id);
  // isNewClient=true — клиент только что создан.
  // Бот после регистрации проверяет флаг и запускает event-driven welcome (after_registration).
  return res.status(201).json({ token, client: toClientShape(client), isNewClient: true });
});

// ——— Deep-link Telegram авторизация (tg:// протокол, обходит блокировки) ———

// 1) Генерация одноразового токена для deep-link авторизации
clientAuthRouter.post("/telegram-login-token", async (_req, res) => {
  try {
    // Чистим просроченные токены
    await prisma.telegramAuthToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });

    const token = randomBytes(16).toString("hex"); // 32 hex chars — with "auth_" prefix = 37, well under Telegram's 64-char start param limit
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 минут

    const record = await prisma.telegramAuthToken.create({
      data: { token, expiresAt },
    });

    return res.json({ token: record.token, expiresAt: record.expiresAt.toISOString() });
  } catch (err) {
    console.error("[telegram-login-token] error:", err);
    return res.status(500).json({ message: "Не удалось создать токен авторизации" });
  }
});

// 1.5) Native redirect: 302 на https://t.me/BOT?start=auth_TOKEN — обходит блокировку tg:// схемы на iOS Safari/Telegram WebView
clientAuthRouter.get("/telegram-login-redirect", async (req, res) => {
  const { token } = req.query;
  if (typeof token !== "string" || !token.trim()) {
    return res.status(400).send("Отсутствует токен");
  }

  try {
    const record = await prisma.telegramAuthToken.findUnique({
      where: { token: token.trim() },
      select: { id: true, expiresAt: true },
    });

    if (!record) return res.status(404).send("Токен не найден или устарел");
    if (record.expiresAt < new Date()) {
      await prisma.telegramAuthToken.delete({ where: { id: record.id } }).catch(() => {});
      return res.status(410).send("Токен устарел");
    }

    const config = await getSystemConfig();
    const botUsername = (config.telegramBotUsername ?? "").replace(/^@/, "").trim();
    if (!botUsername) return res.status(503).send("Telegram bot not configured");

    const tgUrl = `https://t.me/${encodeURIComponent(botUsername)}?start=auth_${encodeURIComponent(token.trim())}`;
    return res.redirect(302, tgUrl);
  } catch (err) {
    console.error("[telegram-login-redirect] error:", err);
    return res.status(500).send("Внутренняя ошибка");
  }
});

// 2) Поллинг: проверяем, подтвердил ли пользователь токен через бота
clientAuthRouter.get("/telegram-login-check", async (req, res) => {
  const { token } = req.query;
  if (typeof token !== "string" || !token.trim()) {
    return res.status(400).json({ message: "Отсутствует токен" });
  }

  try {
    const record = (await prisma.telegramAuthToken.findUnique({
      where: { token: token.trim() },
    })) as TelegramAuthTokenRecord | null;

    if (!record) {
      return res.status(404).json({ message: "Токен не найден или устарел" });
    }

    if (record.expiresAt < new Date()) {
      await prisma.telegramAuthToken.delete({ where: { id: record.id } }).catch(() => {});
      return res.status(410).json({ message: "Токен устарел" });
    }

    if (!record.confirmedTelegramId) {
      return res.json({ confirmed: false });
    }

    // Токен подтверждён — ищем/создаём клиента
    const telegramId = record.confirmedTelegramId;
    const telegramUsername = record.confirmedUsername ?? null;

    // Удаляем использованный токен
    const consumed = await prisma.telegramAuthToken.deleteMany({ where: { id: record.id, expiresAt: { gt: new Date() } } });
    if (consumed.count !== 1) return res.status(410).json({ message: "Токен уже использован или устарел" });

    const clientSelect = { id: true, email: true, telegramId: true, telegramUsername: true, preferredLang: true, preferredCurrency: true, balance: true, referralCode: true, referralPercent: true, remnawaveUuid: true, trialUsed: true, isBlocked: true, autoRenewEnabled: true, autoRenewTariffId: true, yoomoneyAccessToken: true, totpEnabled: true, createdAt: true, onboardingCompleted: true, passwordHash: true };

    const existing = await prisma.client.findFirst({
      where: asClientWhere({ telegramId}),
      select: clientSelect,
    });

    if (existing) {
      if (existing.isBlocked) return res.status(403).json({ message: "Аккаунт заблокирован" });
      // Обновляем username если изменился
      if (telegramUsername && existing.telegramUsername !== telegramUsername) {
        await prisma.client.update({ where: { id: existing.id }, data: { telegramUsername } }).catch(() => {});
      }
      // Do not restart completed onboarding when email was skipped.

      const auth = buildAuthResponse(existing);
      return res.json({ confirmed: true, ...auth });
    }

    // Новый клиент — регистрируем
    const configForDefaults = await getSystemConfig();
    // при регистрации Remna-юзер НЕ создаётся (поведение
    // тянулось с 3.2.5: создавался истёкший «безлимит» с expireAt=now, и в кабинете
    // у свежего клиента сразу висела пустая подписка «Истекла / Тариф не выбран»).
    // Подписка появляется только при покупке/триале — как у регистрации по email
    // и через бота. Если юзер уже существует в Remna (создан ботом ранее) — просто
    // привязываем его uuid, ничего не создавая.
    let remnawaveUuid: string | null = null;
    if (isRemnaConfigured()) {
      const byTgRes = await remnaGetUserByTelegramId(telegramId);
      remnawaveUuid = extractRemnaUuid(byTgRes.data);
    }

    const referralCode = generateReferralCode();
    // новый TG-юзер через сайт → сразу онбординг.
    const client = await prisma.client.create({
      data: asClientUncheckedCreate({
        email: null,
        passwordHash: null,
        remnawaveUuid,
        referralCode,
        referrerId: null,
        preferredLang: configForDefaults.defaultLanguage ?? "ru",
        preferredCurrency: configForDefaults.defaultCurrency ?? "usd",
        telegramId,
        telegramUsername,
        autoRenewEnabled: configForDefaults.defaultAutoRenewEnabled ?? false,
        onboardingCompleted: false,
      }),
    });

    notifyAdminsAboutNewClient(client.id).catch(() => {});
    const jwt = signClientToken(client.id);
    return res.json({ confirmed: true, token: jwt, client: toClientShape(client), justCreated: true });
  } catch (err) {
    console.error("[telegram-login-check] error:", err);
    return res.status(500).json({ message: "Внутренняя ошибка" });
  }
});

// 3) Подтверждение токена ботом (бот вызывает этот эндпоинт, когда юзер отправляет /start auth_TOKEN)
clientAuthRouter.post("/telegram-login-confirm", async (req, res) => {
  // v5.0.0: токен бота один (BOT_TOKEN из env).
  const receivedBotToken = (req.headers["x-telegram-bot-token"] as string ?? "").trim();
  const expectedToken = (process.env.BOT_TOKEN ?? "").trim();
  if (!receivedBotToken || !expectedToken || receivedBotToken !== expectedToken) {
    return res.status(403).json({ message: "Требуется авторизация" });
  }

  const { token, telegramId, telegramUsername } = req.body ?? {};
  if (typeof token !== "string" || !token.trim()) {
    return res.status(400).json({ message: "Отсутствует токен" });
  }
  if (!/^[1-9]\d{0,15}$/.test(String(telegramId ?? ""))) {
    return res.status(400).json({ message: "Некорректный Telegram ID" });
  }

  try {
    const record = await prisma.telegramAuthToken.findUnique({
      where: { token: token.trim() },
    });

    if (!record) {
      return res.status(404).json({ message: "Токен не найден" });
    }

    if (record.expiresAt < new Date()) {
      await prisma.telegramAuthToken.delete({ where: { id: record.id } }).catch(() => {});
      return res.status(410).json({ message: "Токен устарел" });
    }

    if (record.confirmedTelegramId) {
      return res.status(409).json({ message: "Токен уже подтверждён" });
    }

    const confirmed = await prisma.telegramAuthToken.updateMany({
      where: { id: record.id, confirmedTelegramId: null, expiresAt: { gt: new Date() } },
      data: asTelegramAuthUpdate({
        confirmedTelegramId: String(telegramId),
        confirmedUsername: telegramUsername ? String(telegramUsername) : null,
      }),
    });
    if (confirmed.count !== 1) return res.status(409).json({ message: "Токен уже подтверждён или устарел" });

    return res.json({ ok: true });
  } catch (err) {
    console.error("[telegram-login-confirm] error:", err);
    return res.status(500).json({ message: "Внутренняя ошибка" });
  }
});
