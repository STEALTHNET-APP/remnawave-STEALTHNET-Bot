import { randomBytes, createHmac } from "crypto";
import { randomUUID } from "crypto";
import { env } from "../../config/index.js";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import {
  hashPassword,
  verifyPassword,
  signClientToken,
  generateReferralCode,
  getSystemConfig,
  getPublicConfig,
  type SellOptionTrafficProduct,
  type SellOptionDeviceProduct,
  type SellOptionServerProduct,
} from "./client.service.js";
import { requireClientAuth } from "./client.middleware.js";
import { remnaCreateUser, remnaUpdateUser, isRemnaConfigured, remnaGetUser, remnaGetUserByUsername, remnaGetUserByEmail, remnaGetUserByTelegramId, extractRemnaUuid } from "../remna/remna.client.js";
import { sendVerificationEmail, isSmtpConfigured } from "../mail/mail.service.js";
import { createPlategaTransaction, isPlategaConfigured } from "../platega/platega.service.js";
import { activateTariffForClient } from "../tariff/tariff-activation.service.js";
import { applyExtraOptionByPaymentId } from "../extra-options/extra-options.service.js";
import { getAuthUrl, exchangeCodeForToken, requestPayment, processPayment } from "../yoomoney/yoomoney.service.js";
import { createYookassaPayment } from "../yookassa/yookassa.service.js";

/** Извлекает текущий expireAt из ответа Remna. Возвращает Date если в будущем, иначе null. */
function extractCurrentExpireAt(data: unknown): Date | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const resp = (o.response ?? o.data ?? o) as Record<string, unknown>;
  const raw = resp?.expireAt;
  if (typeof raw !== "string") return null;
  try {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return null;
    return d.getTime() > Date.now() ? d : null;
  } catch {
    return null;
  }
}

/** Считает expireAt: если текущая подписка активна — добавляет дни к ней, иначе от now. */
function calculateExpireAt(currentExpireAt: Date | null, durationDays: number): string {
  const base = currentExpireAt ?? new Date();
  return new Date(base.getTime() + durationDays * 24 * 60 * 60 * 1000).toISOString();
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
    return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  }

  const data = body.data;
  const hasEmail = data.email && data.password;
  const hasTelegram = data.telegramId;

  if (!hasEmail && !hasTelegram) {
    return res.status(400).json({ message: "Provide email+password or telegramId" });
  }

  // Регистрация по email: создаём ожидание и отправляем письмо с ссылкой
  if (hasEmail) {
    const existing = await prisma.client.findUnique({ where: { email: data.email! } });
    if (existing) return res.status(400).json({ message: "Email already registered" });

    const config = await getSystemConfig();
    const smtpConfig = {
      host: config.smtpHost || "",
      port: config.smtpPort,
      secure: config.smtpSecure,
      user: config.smtpUser,
      password: config.smtpPassword,
      fromEmail: config.smtpFromEmail,
      fromName: config.smtpFromName,
    };
    if (!isSmtpConfigured(smtpConfig)) {
      return res.status(503).json({ message: "Email registration is not configured. Contact administrator." });
    }

    const appUrl = (config.publicAppUrl || "").replace(/\/$/, "");
    if (!appUrl) {
      return res.status(503).json({ message: "Public app URL is not set in settings." });
    }

    const verificationToken = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 ч

    const referralCode = generateReferralCode();
    let referrerId: string | null = null;
    if (data.referralCode) {
      const referrer = await prisma.client.findFirst({ where: { referralCode: data.referralCode } });
      if (referrer) referrerId = referrer.id;
    }
    const passwordHash = await hashPassword(data.password!);

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

    const verificationLink = `${appUrl}/cabinet/verify-email?token=${verificationToken}`;
    const sendResult = await sendVerificationEmail(
      smtpConfig,
      data.email!,
      verificationLink,
      config.serviceName
    );
    if (!sendResult.ok) {
      await prisma.pendingEmailRegistration.deleteMany({ where: { verificationToken } }).catch(() => { });
      return res.status(500).json({ message: "Failed to send verification email. Try again later." });
    }

    return res.status(201).json({ message: "Check your email to complete registration", requiresVerification: true });
  }

  // Регистрация / вход по Telegram
  if (hasTelegram) {
    const existing = await prisma.client.findUnique({ where: { telegramId: data.telegramId! } });
    if (existing) {
      const token = signClientToken(existing.id);
      return res.json({ token, client: toClientShape(existing) });
    }
  }

  // Не создаём пользователя в Remna при регистрации — клиент неактивен до триала или оплаты тарифа.
  const referralCode = generateReferralCode();
  let referrerId: string | null = null;
  if (data.referralCode) {
    const referrer = await prisma.client.findFirst({ where: { referralCode: data.referralCode } });
    if (referrer) referrerId = referrer.id;
  }

  const passwordHash = data.password ? await hashPassword(data.password) : null;
  const client = await prisma.client.create({
    data: {
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
    },
  });

  const token = signClientToken(client.id);
  return res.status(201).json({ token, client: toClientShape(client) });
});

const verifyEmailSchema = z.object({ token: z.string().min(1) });
clientAuthRouter.post("/verify-email", async (req, res) => {
  const parse = verifyEmailSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ message: "Invalid input" });
  const { token } = parse.data;

  const pending = await prisma.pendingEmailRegistration.findUnique({
    where: { verificationToken: token },
  });
  if (!pending) return res.status(400).json({ message: "Invalid or expired link" });
  if (new Date() > pending.expiresAt) {
    await prisma.pendingEmailRegistration.delete({ where: { id: pending.id } }).catch(() => { });
    return res.status(400).json({ message: "Link expired. Please register again." });
  }

  const existingClient = await prisma.client.findUnique({ where: { email: pending.email } });
  if (existingClient) {
    await prisma.pendingEmailRegistration.delete({ where: { id: pending.id } }).catch(() => { });
    const signToken = signClientToken(existingClient.id);
    return res.json({ token: signToken, client: toClientShape(existingClient) });
  }

  // Не создаём пользователя в Remna при регистрации — клиент неактивен до триала или оплаты тарифа.
  const referralCode = generateReferralCode();
  let referrerId: string | null = null;
  if (pending.referralCode) {
    const referrer = await prisma.client.findFirst({ where: { referralCode: pending.referralCode } });
    if (referrer) referrerId = referrer.id;
  }

  const client = await prisma.client.create({
    data: {
      email: pending.email,
      passwordHash: pending.passwordHash,
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
    },
  });

  await prisma.pendingEmailRegistration.delete({ where: { id: pending.id } }).catch(() => { });

  const signToken = signClientToken(client.id);
  return res.status(201).json({ token: signToken, client: toClientShape(client) });
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

clientAuthRouter.post("/login", async (req, res) => {
  const body = loginSchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ message: "Invalid input" });
  }

  const client = await prisma.client.findUnique({ where: { email: body.data.email } });
  if (!client || !client.passwordHash || client.isBlocked) {
    return res.status(401).json({ message: "Invalid email or password" });
  }

  const valid = await verifyPassword(body.data.password, client.passwordHash);
  if (!valid) return res.status(401).json({ message: "Invalid email or password" });

  const token = signClientToken(client.id);
  return res.json({ token, client: toClientShape(client) });
});

/** Валидация initData из Telegram Web App (Mini App). https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app */
function validateTelegramInitData(initData: string, botToken: string): boolean {
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
function parseTelegramUser(initData: string): { id: number; username?: string } | null {
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

const telegramMiniappSchema = z.object({ initData: z.string().min(1) });

clientAuthRouter.post("/telegram-miniapp", async (req, res) => {
  const body = telegramMiniappSchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  }
  const config = await getSystemConfig();
  const botToken = config.telegramBotToken ?? "";
  if (!validateTelegramInitData(body.data.initData, botToken)) {
    return res.status(401).json({ message: "Invalid or expired Telegram data" });
  }
  const tgUser = parseTelegramUser(body.data.initData);
  if (!tgUser) return res.status(400).json({ message: "Missing user in init data" });

  const telegramId = String(tgUser.id);
  const telegramUsername = tgUser.username?.trim() ?? null;
  const existing = await prisma.client.findUnique({ where: { telegramId } });
  if (existing) {
    if (existing.isBlocked) return res.status(403).json({ message: "Account is blocked" });
    const token = signClientToken(existing.id);
    return res.json({ token, client: toClientShape(existing) });
  }

  const configForDefaults = await getSystemConfig();
  let remnawaveUuid: string | null = null;
  if (isRemnaConfigured()) {
    const rawName = `tg${tgUser.id}`;
    const username = rawName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 36) || "user_" + Date.now().toString(36);
    // Без активной подписки — как при регистрации по email; доступ после триала или оплаты
    const remnaRes = await remnaCreateUser({
      username: username.length >= 3 ? username : "u_" + username,
      trafficLimitBytes: 0,
      trafficLimitStrategy: "NO_RESET",
      expireAt: new Date(Date.now() - 1000).toISOString(),
      telegramId: tgUser.id,
    });
    remnawaveUuid = extractRemnaUuid(remnaRes.data);
    if (remnaRes.error || remnawaveUuid == null) {
      console.error("[Remna] create user (telegram initData) failed:", { error: remnaRes.error, status: remnaRes.status, data: remnaRes.data });
      return res.status(503).json({ message: "Сервис временно недоступен. Не удалось создать учётную запись VPN. Попробуйте позже." });
    }
  }
  const referralCode = generateReferralCode();
  const client = await prisma.client.create({
    data: {
      email: null,
      passwordHash: null,
      remnawaveUuid,
      referralCode,
      referrerId: null,
      preferredLang: configForDefaults.defaultLanguage ?? "ru",
      preferredCurrency: configForDefaults.defaultCurrency ?? "usd",
      telegramId,
      telegramUsername,
    },
  });
  const token = signClientToken(client.id);
  return res.status(201).json({ token, client: toClientShape(client) });
});

clientAuthRouter.get("/me", requireClientAuth, async (req, res) => {
  const client = (req as unknown as { client: { id: string } }).client;
  const full = await prisma.client.findUnique({
    where: { id: client.id },
    select: { id: true, email: true, telegramId: true, telegramUsername: true, preferredLang: true, preferredCurrency: true, balance: true, referralCode: true, referralPercent: true, remnawaveUuid: true, trialUsed: true, isBlocked: true, yoomoneyAccessToken: true },
  });
  if (!full) return res.status(401).json({ message: "Unauthorized" });
  return res.json(toClientShape(full));
});

function toClientShape(c: {
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
  };
}

// Единый роутер /api/client: /auth (логин, регистрация, me) + кабинет (подписка, платежи)
export const clientRouter = Router();
clientRouter.use("/auth", clientAuthRouter);

// ЮMoney OAuth callback — без авторизации клиента (редирект с ЮMoney)
function yoomoneyStateSign(clientId: string): string {
  const payload = JSON.stringify({ clientId });
  const sig = createHmac("sha256", env.JWT_SECRET).update(payload).digest("base64url");
  return Buffer.from(payload, "utf8").toString("base64url") + "." + sig;
}
function yoomoneyStateVerify(state: string): string | null {
  const dot = state.indexOf(".");
  if (dot <= 0) return null;
  const payloadB64 = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as { clientId?: string };
    if (!payload?.clientId) return null;
    const expected = createHmac("sha256", env.JWT_SECRET).update(JSON.stringify({ clientId: payload.clientId })).digest("base64url");
    if (sig !== expected) return null;
    return payload.clientId;
  } catch {
    return null;
  }
}

clientRouter.get("/yoomoney/callback", async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : null;
  const state = typeof req.query.state === "string" ? req.query.state : null;
  const config = await getSystemConfig();
  const appUrl = (config.publicAppUrl || "").replace(/\/$/, "");
  const redirectFail = appUrl ? `${appUrl}/cabinet?yoomoney=error` : "/";
  if (!code?.trim() || !state?.trim()) {
    return res.redirect(302, redirectFail);
  }
  const clientId = yoomoneyStateVerify(state);
  if (!clientId) {
    return res.redirect(302, redirectFail);
  }
  const redirectUri = appUrl ? `${appUrl}/api/client/yoomoney/callback` : "";
  if (!redirectUri) {
    return res.redirect(302, redirectFail);
  }
  const result = await exchangeCodeForToken({
    code: code.trim(),
    clientId: config.yoomoneyClientId || "",
    redirectUri,
    clientSecret: config.yoomoneyClientSecret,
  });
  if ("error" in result) {
    return res.redirect(302, appUrl ? `${appUrl}/cabinet?yoomoney=error&reason=${encodeURIComponent(result.error)}` : redirectFail);
  }
  await prisma.client.update({
    where: { id: clientId },
    data: { yoomoneyAccessToken: result.access_token },
  });
  const redirectOk = appUrl ? `${appUrl}/cabinet?yoomoney=connected` : redirectFail;
  return res.redirect(302, redirectOk);
});

clientRouter.use(requireClientAuth);

const updateProfileSchema = z.object({
  preferredLang: z.string().max(10).optional(),
  preferredCurrency: z.string().max(10).optional(),
});

clientRouter.patch("/profile", async (req, res) => {
  const client = (req as unknown as { client: { id: string } }).client;
  const body = updateProfileSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  const updates: { preferredLang?: string; preferredCurrency?: string } = {};
  if (body.data.preferredLang !== undefined) updates.preferredLang = body.data.preferredLang;
  if (body.data.preferredCurrency !== undefined) updates.preferredCurrency = body.data.preferredCurrency;
  if (Object.keys(updates).length === 0) {
    const current = await prisma.client.findUnique({ where: { id: client.id }, select: { id: true, email: true, telegramId: true, telegramUsername: true, preferredLang: true, preferredCurrency: true, balance: true, referralCode: true, remnawaveUuid: true, trialUsed: true, isBlocked: true } });
    return res.json(current ? toClientShape(current) : { message: "Not found" });
  }
  const updated = await prisma.client.update({
    where: { id: client.id },
    data: updates,
    select: { id: true, email: true, telegramId: true, telegramUsername: true, preferredLang: true, preferredCurrency: true, balance: true, referralCode: true, remnawaveUuid: true, trialUsed: true, isBlocked: true },
  });
  return res.json(toClientShape(updated));
});

clientRouter.get("/referral-stats", async (req, res) => {
  const client = (req as unknown as { client: { id: string } }).client;
  const c = await prisma.client.findUnique({
    where: { id: client.id },
    select: {
      referralCode: true,
      referralPercent: true,
      _count: { select: { referrals: true } },
    },
  });
  if (!c) return res.status(404).json({ message: "Not found" });
  const config = await getSystemConfig();
  let referralPercent: number = c.referralPercent ?? 0;
  if (referralPercent === 0) {
    referralPercent = config.defaultReferralPercent ?? 0;
  }
  const totalEarnings = await prisma.referralCredit.aggregate({
    where: { referrerId: client.id },
    _sum: { amount: true },
  });
  return res.json({
    referralCode: c.referralCode,
    referralPercent,
    referralPercentLevel2: config.referralPercentLevel2 ?? 0,
    referralPercentLevel3: config.referralPercentLevel3 ?? 0,
    referralCount: c._count.referrals,
    totalEarnings: totalEarnings._sum.amount ?? 0,
  });
});

clientRouter.post("/trial", async (req, res) => {
  const client = (req as unknown as { client: { id: string; remnawaveUuid: string | null; trialUsed: boolean; email: string | null; telegramId: string | null } }).client;
  if (client.trialUsed) {
    return res.status(400).json({ message: "Триал уже использован" });
  }
  const config = await getSystemConfig();
  const trialDays = config.trialDays ?? 0;
  const trialSquadUuid = config.trialSquadUuid?.trim() || null;
  if (trialDays <= 0 || !trialSquadUuid) {
    return res.status(503).json({ message: "Триал не настроен" });
  }
  if (!isRemnaConfigured()) {
    return res.status(503).json({ message: "Сервис временно недоступен" });
  }

  const trafficLimitBytes = config.trialTrafficLimitBytes ?? 0;
  const hwidDeviceLimit = config.trialDeviceLimit ?? null;

  if (client.remnawaveUuid) {
    const userRes = await remnaGetUser(client.remnawaveUuid);
    const currentExpireAt = extractCurrentExpireAt(userRes.data);
    const expireAt = calculateExpireAt(currentExpireAt, trialDays);

    const updateRes = await remnaUpdateUser({
      uuid: client.remnawaveUuid,
      expireAt,
      trafficLimitBytes,
      hwidDeviceLimit,
      activeInternalSquads: [trialSquadUuid],
    });
    if (updateRes.error) {
      return res.status(updateRes.status >= 400 ? updateRes.status : 500).json({ message: updateRes.error });
    }
    // Не вызываем add-users: по api-1.yaml эндпоинт добавляет ВСЕХ пользователей в сквад; назначение уже сделано через remnaUpdateUser(activeInternalSquads).
  } else {
    // Сначала ищем существующего пользователя в Remna (по Telegram ID, email, username), чтобы не получать "username already exists"
    let existingUuid: string | null = null;
    let currentExpireAt: Date | null = null;
    if (client.telegramId?.trim()) {
      const byTgRes = await remnaGetUserByTelegramId(client.telegramId.trim());
      existingUuid = extractRemnaUuid(byTgRes.data);
      if (existingUuid) currentExpireAt = extractCurrentExpireAt(byTgRes.data);
    }
    if (!existingUuid && client.email?.trim()) {
      const byEmailRes = await remnaGetUserByEmail(client.email.trim());
      existingUuid = extractRemnaUuid(byEmailRes.data);
      if (existingUuid) currentExpireAt = extractCurrentExpireAt(byEmailRes.data);
    }
    if (!existingUuid) {
      const rawName = client.email?.split("@")[0] || `user${client.id.slice(-6)}`;
      const username = rawName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 36) || "u_" + Date.now().toString(36);
      const finalUsername = username.length >= 3 ? username : "u_" + username;
      const byUsernameRes = await remnaGetUserByUsername(finalUsername);
      existingUuid = extractRemnaUuid(byUsernameRes.data);
      if (existingUuid) currentExpireAt = extractCurrentExpireAt(byUsernameRes.data);
    }

    const expireAt = calculateExpireAt(currentExpireAt, trialDays);

    if (!existingUuid) {
      const rawName = client.email?.split("@")[0] || `user${client.id.slice(-6)}`;
      const username = rawName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 36) || "u_" + Date.now().toString(36);
      const finalUsername = username.length >= 3 ? username : "u_" + username;
      const createRes = await remnaCreateUser({
        username: finalUsername,
        trafficLimitBytes,
        trafficLimitStrategy: "NO_RESET",
        expireAt,
        hwidDeviceLimit: hwidDeviceLimit ?? undefined,
        activeInternalSquads: [trialSquadUuid],
      });
      existingUuid = extractRemnaUuid(createRes.data);
    }

    if (!existingUuid) {
      return res.status(502).json({ message: "Ошибка создания пользователя" });
    }

    await remnaUpdateUser({
      uuid: existingUuid,
      expireAt,
      trafficLimitBytes,
      hwidDeviceLimit,
      activeInternalSquads: [trialSquadUuid],
    });
    // Не вызываем add-users: по api-1.yaml эндпоинт добавляет ВСЕХ пользователей в сквад.
    await prisma.client.update({
      where: { id: client.id },
      data: { remnawaveUuid: existingUuid, trialUsed: true },
    });
    const updated = await prisma.client.findUnique({ where: { id: client.id }, select: { id: true, email: true, telegramId: true, telegramUsername: true, preferredLang: true, preferredCurrency: true, balance: true, referralCode: true, remnawaveUuid: true, trialUsed: true, isBlocked: true } });
    return res.json({ message: "Триал активирован", client: updated ? toClientShape(updated) : null });
  }

  await prisma.client.update({
    where: { id: client.id },
    data: { trialUsed: true },
  });
  const updated = await prisma.client.findUnique({ where: { id: client.id }, select: { id: true, email: true, telegramId: true, telegramUsername: true, preferredLang: true, preferredCurrency: true, balance: true, referralCode: true, remnawaveUuid: true, trialUsed: true, isBlocked: true } });
  return res.json({ message: "Триал активирован", client: updated ? toClientShape(updated) : null });
});

// ——— Активация промо-ссылки ———
clientRouter.post("/promo/activate", async (req, res) => {
  const client = (req as unknown as { client: { id: string; remnawaveUuid: string | null; email: string | null; telegramId: string | null } }).client;
  const { code } = req.body as { code?: string };
  if (!code?.trim()) return res.status(400).json({ message: "Промокод не указан" });

  const group = await prisma.promoGroup.findUnique({ where: { code: code.trim() } });
  if (!group || !group.isActive) return res.status(404).json({ message: "Промокод не найден или неактивен" });

  // Проверяем, не активировал ли уже этот клиент эту промо-группу
  const existing = await prisma.promoActivation.findUnique({
    where: { promoGroupId_clientId: { promoGroupId: group.id, clientId: client.id } },
  });
  if (existing) return res.status(400).json({ message: "Вы уже активировали этот промокод" });

  // Проверяем лимит активаций
  if (group.maxActivations > 0) {
    const count = await prisma.promoActivation.count({ where: { promoGroupId: group.id } });
    if (count >= group.maxActivations) return res.status(400).json({ message: "Лимит активаций промокода исчерпан" });
  }

  if (!isRemnaConfigured()) return res.status(503).json({ message: "Сервис временно недоступен" });

  const trafficLimitBytes = Number(group.trafficLimitBytes);
  const hwidDeviceLimit = group.deviceLimit ?? null;

  if (client.remnawaveUuid) {
    // Получаем текущий expireAt и добавляем дни
    const userRes = await remnaGetUser(client.remnawaveUuid);
    const currentExpireAt = extractCurrentExpireAt(userRes.data);
    const expireAt = calculateExpireAt(currentExpireAt, group.durationDays);

    const updateRes = await remnaUpdateUser({
      uuid: client.remnawaveUuid,
      expireAt,
      trafficLimitBytes,
      hwidDeviceLimit,
      activeInternalSquads: [group.squadUuid],
    });
    if (updateRes.error) {
      return res.status(updateRes.status >= 400 ? updateRes.status : 500).json({ message: updateRes.error });
    }
    // Не вызываем add-users: по api-1.yaml эндпоинт добавляет ВСЕХ пользователей в сквад.
  } else {
    // Ищем существующего пользователя или создаём нового
    let existingUuid: string | null = null;
    let currentExpireAt: Date | null = null;
    if (client.telegramId?.trim()) {
      const byTgRes = await remnaGetUserByTelegramId(client.telegramId.trim());
      existingUuid = extractRemnaUuid(byTgRes.data);
      if (existingUuid) currentExpireAt = extractCurrentExpireAt(byTgRes.data);
    }
    if (!existingUuid && client.email?.trim()) {
      const byEmailRes = await remnaGetUserByEmail(client.email.trim());
      existingUuid = extractRemnaUuid(byEmailRes.data);
      if (existingUuid) currentExpireAt = extractCurrentExpireAt(byEmailRes.data);
    }
    const expireAt = calculateExpireAt(currentExpireAt, group.durationDays);
    if (!existingUuid) {
      const rawName = client.email?.split("@")[0] || `user${client.id.slice(-6)}`;
      const username = rawName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 36) || "u_" + Date.now().toString(36);
      const finalUsername = username.length >= 3 ? username : "u_" + username;
      const createRes = await remnaCreateUser({
        username: finalUsername,
        trafficLimitBytes,
        trafficLimitStrategy: "NO_RESET",
        expireAt,
        hwidDeviceLimit: hwidDeviceLimit ?? undefined,
        activeInternalSquads: [group.squadUuid],
      });
      existingUuid = extractRemnaUuid(createRes.data);
    }
    if (!existingUuid) return res.status(502).json({ message: "Ошибка создания пользователя VPN" });

    await remnaUpdateUser({ uuid: existingUuid, expireAt, trafficLimitBytes, hwidDeviceLimit, activeInternalSquads: [group.squadUuid] });
    // Не вызываем add-users: по api-1.yaml эндпоинт добавляет ВСЕХ пользователей в сквад.

    await prisma.client.update({
      where: { id: client.id },
      data: { remnawaveUuid: existingUuid },
    });
  }

  // Записываем активацию
  await prisma.promoActivation.create({
    data: { promoGroupId: group.id, clientId: client.id },
  });

  return res.json({ message: "Промокод активирован! Подписка подключена." });
});

// ——— Промокоды (скидки / бесплатные дни) ———

/** Общая валидация промокода — возвращает объект PromoCode или ошибку */
type PromoCodeRow = NonNullable<Awaited<ReturnType<typeof prisma.promoCode.findUnique>>>;
type ValidateResult = { ok: true; promo: PromoCodeRow } | { ok: false; error: string; status: number };

async function validatePromoCode(code: string, clientId: string): Promise<ValidateResult> {
  const promo = await prisma.promoCode.findUnique({ where: { code: code.trim() } });
  if (!promo || !promo.isActive) return { ok: false, error: "Промокод не найден или неактивен", status: 404 };
  if (promo.expiresAt && promo.expiresAt < new Date()) return { ok: false, error: "Срок действия промокода истёк", status: 400 };

  if (promo.maxUses > 0) {
    const totalUsages = await prisma.promoCodeUsage.count({ where: { promoCodeId: promo.id } });
    if (totalUsages >= promo.maxUses) return { ok: false, error: "Лимит использований промокода исчерпан", status: 400 };
  }

  const clientUsages = await prisma.promoCodeUsage.count({
    where: { promoCodeId: promo.id, clientId },
  });
  if (clientUsages >= promo.maxUsesPerClient) return { ok: false, error: "Вы уже использовали этот промокод", status: 400 };

  return { ok: true, promo };
}

/** Проверить промокод (для скидки — возвращает данные скидки; для FREE_DAYS — информацию) */
clientRouter.post("/promo-code/check", async (req, res) => {
  const client = (req as unknown as { client: { id: string } }).client;
  const { code } = req.body as { code?: string };
  if (!code?.trim()) return res.status(400).json({ message: "Промокод не указан" });

  const result = await validatePromoCode(code, client.id);
  if (!result.ok) return res.status(result.status).json({ message: result.error });

  const promo = result.promo;
  if (promo.type === "DISCOUNT") {
    return res.json({
      type: "DISCOUNT",
      discountPercent: promo.discountPercent,
      discountFixed: promo.discountFixed,
      name: promo.name,
    });
  }
  return res.json({
    type: "FREE_DAYS",
    durationDays: promo.durationDays,
    name: promo.name,
  });
});

/** Применить промокод FREE_DAYS — активирует подписку */
clientRouter.post("/promo-code/activate", async (req, res) => {
  const client = (req as unknown as { client: { id: string; remnawaveUuid: string | null; email: string | null; telegramId: string | null } }).client;
  const { code } = req.body as { code?: string };
  if (!code?.trim()) return res.status(400).json({ message: "Промокод не указан" });

  const result = await validatePromoCode(code, client.id);
  if (!result.ok) return res.status(result.status).json({ message: result.error });

  const promo = result.promo;

  if (promo.type === "DISCOUNT") {
    return res.status(400).json({ message: "Промокод на скидку применяется при оплате тарифа" });
  }

  // FREE_DAYS
  if (!promo.squadUuid || !promo.durationDays) {
    return res.status(400).json({ message: "Промокод не полностью настроен" });
  }

  if (!isRemnaConfigured()) return res.status(503).json({ message: "Сервис временно недоступен" });

  const trafficLimitBytes = Number(promo.trafficLimitBytes ?? 0);
  const hwidDeviceLimit = promo.deviceLimit ?? null;

  if (client.remnawaveUuid) {
    const userRes = await remnaGetUser(client.remnawaveUuid);
    const currentExpireAt = extractCurrentExpireAt(userRes.data);
    const expireAt = calculateExpireAt(currentExpireAt, promo.durationDays);

    const updateRes = await remnaUpdateUser({
      uuid: client.remnawaveUuid,
      expireAt,
      trafficLimitBytes,
      hwidDeviceLimit,
      activeInternalSquads: [promo.squadUuid],
    });
    if (updateRes.error) {
      return res.status(updateRes.status >= 400 ? updateRes.status : 500).json({ message: updateRes.error });
    }
    // Не вызываем add-users: по api-1.yaml эндпоинт добавляет ВСЕХ пользователей в сквад.
  } else {
    let existingUuid: string | null = null;
    let currentExpireAt: Date | null = null;
    if (client.telegramId?.trim()) {
      const byTgRes = await remnaGetUserByTelegramId(client.telegramId.trim());
      existingUuid = extractRemnaUuid(byTgRes.data);
      if (existingUuid) currentExpireAt = extractCurrentExpireAt(byTgRes.data);
    }
    if (!existingUuid && client.email) {
      const byEmailRes = await remnaGetUserByEmail(client.email.trim());
      existingUuid = extractRemnaUuid(byEmailRes.data);
      if (existingUuid) currentExpireAt = extractCurrentExpireAt(byEmailRes.data);
    }
    const expireAt = calculateExpireAt(currentExpireAt, promo.durationDays);
    if (!existingUuid) {
      const rawName = client.email?.split("@")[0] || `user${client.id.slice(-6)}`;
      const username = rawName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 36) || "u_" + Date.now().toString(36);
      const finalUsername = username.length >= 3 ? username : "u_" + username;
      const createRes = await remnaCreateUser({
        username: finalUsername,
        trafficLimitBytes,
        trafficLimitStrategy: "NO_RESET",
        expireAt,
        hwidDeviceLimit: hwidDeviceLimit ?? undefined,
        activeInternalSquads: [promo.squadUuid],
      });
      existingUuid = extractRemnaUuid(createRes.data);
    }
    if (!existingUuid) return res.status(502).json({ message: "Ошибка создания пользователя VPN" });

    await remnaUpdateUser({ uuid: existingUuid, expireAt, trafficLimitBytes, hwidDeviceLimit, activeInternalSquads: [promo.squadUuid] });
    // Не вызываем add-users: по api-1.yaml эндпоинт добавляет ВСЕХ пользователей в сквад.
    await prisma.client.update({ where: { id: client.id }, data: { remnawaveUuid: existingUuid } });
  }

  await prisma.promoCodeUsage.create({ data: { promoCodeId: promo.id, clientId: client.id } });
  return res.json({ message: `Промокод активирован! Подписка на ${promo.durationDays} дн. подключена.` });
});

// Определить отображаемое имя тарифа по последнему оплаченному платежу клиента
async function resolveTariffDisplayName(clientId: string): Promise<string> {
  const lastPaidPayment = await prisma.payment.findFirst({
    where: { clientId, status: "PAID", tariffId: { not: null } },
    orderBy: { paidAt: "desc" },
    select: { tariff: { select: { category: { select: { name: true } } } } },
  });
  if (lastPaidPayment?.tariff?.category?.name) return lastPaidPayment.tariff.category.name;
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { trialUsed: true } });
  if (client?.trialUsed) return "Триал";
  return "Тариф не выбран";
}

clientRouter.get("/subscription", async (req, res) => {
  const client = (req as unknown as { client: { id: string; remnawaveUuid: string | null } }).client;
  if (!client.remnawaveUuid) {
    return res.json({ subscription: null, tariffDisplayName: null, message: "Подписка не привязана" });
  }
  const result = await remnaGetUser(client.remnawaveUuid);
  if (result.error) {
    return res.json({ subscription: null, tariffDisplayName: null, message: result.error });
  }
  const tariffDisplayName = await resolveTariffDisplayName(client.id);
  return res.json({ subscription: result.data ?? null, tariffDisplayName });
});

const createPlategaPaymentSchema = z.object({
  amount: z.number().positive().optional(),
  currency: z.string().min(1).max(10).optional(),
  paymentMethod: z.number().int().min(2).max(13),
  description: z.string().max(500).optional(),
  tariffId: z.string().min(1).optional(),
  promoCode: z.string().max(50).optional(),
  extraOption: z.object({ kind: z.enum(["traffic", "devices", "servers"]), productId: z.string().min(1) }).optional(),
});
clientRouter.post("/payments/platega", async (req, res) => {
  const clientId = (req as unknown as { clientId: string }).clientId;
  const parsed = createPlategaPaymentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });
  }
  const { amount: originalAmount, currency, paymentMethod, description, tariffId, promoCode: promoCodeStr, extraOption } = parsed.data;

  let tariffIdToStore: string | null = null;
  let finalAmount: number;
  let currencyToUse: string;
  let metadataExtra: Record<string, unknown> | null = null;

  if (extraOption) {
    const config = await getSystemConfig();
    if (!(config as { sellOptionsEnabled?: boolean }).sellOptionsEnabled) {
      return res.status(400).json({ message: "Продажа опций отключена" });
    }
    const cfg = config as {
      sellOptionsTrafficEnabled?: boolean; sellOptionsTrafficProducts?: SellOptionTrafficProduct[];
      sellOptionsDevicesEnabled?: boolean; sellOptionsDevicesProducts?: SellOptionDeviceProduct[];
      sellOptionsServersEnabled?: boolean; sellOptionsServersProducts?: SellOptionServerProduct[];
    };
    if (extraOption.kind === "traffic") {
      const product = cfg.sellOptionsTrafficEnabled && cfg.sellOptionsTrafficProducts?.find((p) => p.id === extraOption.productId);
      if (!product) return res.status(400).json({ message: "Опция не найдена" });
      finalAmount = product.price;
      currencyToUse = product.currency.toUpperCase();
      metadataExtra = { extraOption: { kind: "traffic", trafficBytes: Math.round(product.trafficGb * 1024 ** 3) } };
    } else if (extraOption.kind === "devices") {
      const product = cfg.sellOptionsDevicesEnabled && cfg.sellOptionsDevicesProducts?.find((p) => p.id === extraOption.productId);
      if (!product) return res.status(400).json({ message: "Опция не найдена" });
      finalAmount = product.price;
      currencyToUse = product.currency.toUpperCase();
      metadataExtra = { extraOption: { kind: "devices", deviceCount: product.deviceCount } };
    } else {
      const product = cfg.sellOptionsServersEnabled && cfg.sellOptionsServersProducts?.find((p) => p.id === extraOption.productId);
      if (!product) return res.status(400).json({ message: "Опция не найдена" });
      finalAmount = product.price;
      currencyToUse = product.currency.toUpperCase();
      metadataExtra = {
        extraOption: {
          kind: "servers",
          squadUuid: product.squadUuid,
          ...((product.trafficGb ?? 0) > 0 && { trafficBytes: Math.round((product.trafficGb ?? 0) * 1024 ** 3) }),
        },
      };
    }
  } else {
    if (originalAmount == null || !currency) return res.status(400).json({ message: "Укажите сумму и валюту" });
    finalAmount = originalAmount;
    currencyToUse = currency.toUpperCase();
    if (tariffId) {
      const tariff = await prisma.tariff.findUnique({ where: { id: tariffId } });
      if (!tariff) return res.status(400).json({ message: "Тариф не найден" });
      tariffIdToStore = tariffId;
    }
  }

  // Применяем промокод на скидку (не для опций по умолчанию, можно разрешить — тогда скидка с опции)
  let promoCodeRecord: { id: string } | null = null;
  if (promoCodeStr?.trim() && !extraOption) {
    const result = await validatePromoCode(promoCodeStr.trim(), clientId);
    if (!result.ok) return res.status(result.status).json({ message: result.error });
    const promo = result.promo;
    if (promo.type !== "DISCOUNT") return res.status(400).json({ message: "Этот промокод не даёт скидку на оплату" });

    if (promo.discountPercent && promo.discountPercent > 0) {
      finalAmount = Math.max(0, finalAmount - finalAmount * promo.discountPercent / 100);
    }
    if (promo.discountFixed && promo.discountFixed > 0) {
      finalAmount = Math.max(0, finalAmount - promo.discountFixed);
    }
    finalAmount = Math.round(finalAmount * 100) / 100;
    if (finalAmount <= 0) return res.status(400).json({ message: "Итоговая сумма не может быть 0" });
    promoCodeRecord = promo;
  }

  const config = await getSystemConfig();
  const plategaConfig = {
    merchantId: config.plategaMerchantId || "",
    secret: config.plategaSecret || "",
  };
  if (!isPlategaConfigured(plategaConfig)) {
    return res.status(503).json({ message: "Platega не настроен" });
  }

  const methods = config.plategaMethods || [];
  const allowed = methods.find((m) => m.id === paymentMethod && m.enabled);
  if (!allowed) {
    return res.status(400).json({ message: "Метод оплаты недоступен" });
  }

  const serviceName = config.serviceName?.trim() || "STEALTHNET";
  const orderId = randomUUID();
  const paymentKind = tariffIdToStore ? "tariff" : metadataExtra ? "option" : "topup";
  const appUrl = (config.publicAppUrl || "").replace(/\/$/, "");
  const returnUrl = appUrl
    ? `${appUrl}/cabinet/dashboard?payment=success&payment_kind=${paymentKind}&oid=${orderId}`
    : "";
  const failedUrl = appUrl
    ? `${appUrl}/cabinet/dashboard?payment=failed&payment_kind=${paymentKind}&oid=${orderId}`
    : "";
  const plategaDescription = tariffIdToStore
    ? `Тариф ${serviceName} #${orderId}`
    : metadataExtra
      ? `Опция ${serviceName} #${orderId}`
      : `Пополнение баланса ${serviceName} #${orderId}`;

  const paymentMeta = metadataExtra
    ? { ...metadataExtra, ...(promoCodeRecord ? { promoCodeId: promoCodeRecord.id, originalAmount: finalAmount } : {}) }
    : (promoCodeRecord ? { promoCodeId: promoCodeRecord.id, originalAmount: originalAmount ?? finalAmount } : null);
  const payment = await prisma.payment.create({
    data: {
      clientId,
      orderId,
      amount: finalAmount,
      currency: currencyToUse,
      status: "PENDING",
      provider: "platega",
      tariffId: tariffIdToStore,
      metadata: paymentMeta ? JSON.stringify(paymentMeta) : null,
    },
  });

  const result = await createPlategaTransaction(plategaConfig, {
    amount: finalAmount,
    currency: currencyToUse,
    orderId,
    paymentMethod,
    returnUrl,
    failedUrl,
    description: plategaDescription,
  });

  if ("error" in result) {
    await prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED" } });
    return res.status(502).json({ message: result.error });
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: { externalId: result.transactionId },
  });

  // Записываем использование промокода
  if (promoCodeRecord) {
    await prisma.promoCodeUsage.create({ data: { promoCodeId: promoCodeRecord.id, clientId } });
  }

  return res.status(201).json({
    paymentUrl: result.paymentUrl,
    orderId,
    paymentId: payment.id,
    discountApplied: promoCodeRecord ? true : false,
    finalAmount,
  });
});

// ——— Оплата тарифа балансом ———

const payByBalanceSchema = z.object({
  tariffId: z.string().min(1),
  promoCode: z.string().max(50).optional(),
});

clientRouter.post("/payments/balance", async (req, res) => {
  const clientRaw = (req as unknown as { client: { id: string; remnawaveUuid: string | null; email: string | null; telegramId: string | null } }).client;
  const parsed = payByBalanceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });

  const { tariffId, promoCode: promoCodeStr } = parsed.data;

  const tariff = await prisma.tariff.findUnique({ where: { id: tariffId } });
  if (!tariff) return res.status(400).json({ message: "Тариф не найден" });

  let finalPrice = tariff.price;

  // Промокод на скидку
  let promoCodeRecord: { id: string } | null = null;
  if (promoCodeStr?.trim()) {
    const result = await validatePromoCode(promoCodeStr.trim(), clientRaw.id);
    if (!result.ok) return res.status(result.status).json({ message: result.error });
    const promo = result.promo;
    if (promo.type !== "DISCOUNT") return res.status(400).json({ message: "Этот промокод не даёт скидку на оплату" });

    if (promo.discountPercent && promo.discountPercent > 0) {
      finalPrice = Math.max(0, finalPrice - finalPrice * promo.discountPercent / 100);
    }
    if (promo.discountFixed && promo.discountFixed > 0) {
      finalPrice = Math.max(0, finalPrice - promo.discountFixed);
    }
    finalPrice = Math.round(finalPrice * 100) / 100;
    promoCodeRecord = promo;
  }

  // Проверяем баланс
  const clientDb = await prisma.client.findUnique({ where: { id: clientRaw.id } });
  if (!clientDb) return res.status(401).json({ message: "Unauthorized" });
  if (clientDb.balance < finalPrice) {
    return res.status(400).json({ message: `Недостаточно средств. Баланс: ${clientDb.balance.toFixed(2)}, нужно: ${finalPrice.toFixed(2)}` });
  }

  // Активируем тариф в Remnawave
  const activateResult = await activateTariffForClient(
    { id: clientRaw.id, remnawaveUuid: clientDb.remnawaveUuid, email: clientDb.email, telegramId: clientDb.telegramId },
    tariff,
  );
  if (!activateResult.ok) return res.status(activateResult.status).json({ message: activateResult.error });

  // Списываем баланс
  await prisma.client.update({
    where: { id: clientRaw.id },
    data: { balance: { decrement: finalPrice } },
  });

  // Создаём запись об оплате
  const orderId = randomUUID();
  const payment = await prisma.payment.create({
    data: {
      clientId: clientRaw.id,
      orderId,
      amount: finalPrice,
      currency: tariff.currency.toUpperCase(),
      status: "PAID",
      provider: "balance",
      tariffId,
      paidAt: new Date(),
      metadata: promoCodeRecord ? JSON.stringify({ promoCodeId: promoCodeRecord.id, originalPrice: tariff.price }) : null,
    },
  });

  // Записываем использование промокода
  if (promoCodeRecord) {
    await prisma.promoCodeUsage.create({ data: { promoCodeId: promoCodeRecord.id, clientId: clientRaw.id } });
  }

  // Реферальные начисления
  const { distributeReferralRewards } = await import("../referral/referral.service.js");
  await distributeReferralRewards(payment.id).catch(() => { });

  return res.json({
    message: `Тариф «${tariff.name}» активирован! Списано ${finalPrice.toFixed(2)} ${tariff.currency.toUpperCase()} с баланса.`,
    paymentId: payment.id,
    newBalance: clientDb.balance - finalPrice,
  });
});

// ——— Оплата опции (доп. трафик/устройства/сервер) балансом ———
const payOptionByBalanceSchema = z.object({
  extraOption: z.object({ kind: z.enum(["traffic", "devices", "servers"]), productId: z.string().min(1) }),
});
clientRouter.post("/payments/balance/option", async (req, res) => {
  const clientRaw = (req as unknown as { clientId: string }).clientId;
  const parsed = payOptionByBalanceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });

  const config = await getSystemConfig();
  if (!(config as { sellOptionsEnabled?: boolean }).sellOptionsEnabled) {
    return res.status(400).json({ message: "Продажа опций отключена" });
  }

  const cfg = config as {
    sellOptionsTrafficEnabled?: boolean; sellOptionsTrafficProducts?: SellOptionTrafficProduct[];
    sellOptionsDevicesEnabled?: boolean; sellOptionsDevicesProducts?: SellOptionDeviceProduct[];
    sellOptionsServersEnabled?: boolean; sellOptionsServersProducts?: SellOptionServerProduct[];
  };
  const { kind, productId } = parsed.data.extraOption;
  let price: number;
  let currency: string;
  let metadataExtra: Record<string, unknown>;

  if (kind === "traffic") {
    const product = cfg.sellOptionsTrafficEnabled && cfg.sellOptionsTrafficProducts?.find((p) => p.id === productId);
    if (!product) return res.status(400).json({ message: "Опция не найдена" });
    price = product.price;
    currency = product.currency;
    metadataExtra = { extraOption: { kind: "traffic", trafficBytes: Math.round(product.trafficGb * 1024 ** 3) } };
  } else if (kind === "devices") {
    const product = cfg.sellOptionsDevicesEnabled && cfg.sellOptionsDevicesProducts?.find((p) => p.id === productId);
    if (!product) return res.status(400).json({ message: "Опция не найдена" });
    price = product.price;
    currency = product.currency;
    metadataExtra = { extraOption: { kind: "devices", deviceCount: product.deviceCount } };
  } else {
    const product = cfg.sellOptionsServersEnabled && cfg.sellOptionsServersProducts?.find((p) => p.id === productId);
    if (!product) return res.status(400).json({ message: "Опция не найдена" });
    price = product.price;
    currency = product.currency;
    metadataExtra = {
      extraOption: {
        kind: "servers",
        squadUuid: product.squadUuid,
        ...((product.trafficGb ?? 0) > 0 && { trafficBytes: Math.round((product.trafficGb ?? 0) * 1024 ** 3) }),
      },
    };
  }

  const clientDb = await prisma.client.findUnique({ where: { id: clientRaw } });
  if (!clientDb) return res.status(401).json({ message: "Unauthorized" });
  if (clientDb.balance < price) {
    return res.status(400).json({ message: `Недостаточно средств. Баланс: ${clientDb.balance.toFixed(2)}, нужно: ${price.toFixed(2)}` });
  }

  const orderId = randomUUID();
  const payment = await prisma.payment.create({
    data: {
      clientId: clientDb.id,
      orderId,
      amount: price,
      currency: currency.toUpperCase(),
      status: "PAID",
      provider: "balance",
      paidAt: new Date(),
      metadata: JSON.stringify(metadataExtra),
    },
  });

  const applyResult = await applyExtraOptionByPaymentId(payment.id);
  if (!applyResult.ok) {
    await prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED" } });
    return res.status(applyResult.status).json({ message: (applyResult as { error?: string }).error || "Ошибка применения опции" });
  }

  await prisma.client.update({
    where: { id: clientDb.id },
    data: { balance: { decrement: price } },
  });

  const { distributeReferralRewards } = await import("../referral/referral.service.js");
  await distributeReferralRewards(payment.id).catch(() => { });

  const newBalance = clientDb.balance - price;
  return res.json({
    message: "Опция применена. Списано с баланса.",
    paymentId: payment.id,
    newBalance,
  });
});

// ——— ЮMoney: пополнение баланса ———

clientRouter.get("/yoomoney/auth-url", async (req, res) => {
  const clientId = (req as unknown as { clientId: string }).clientId;
  const config = await getSystemConfig();
  const appUrl = (config.publicAppUrl || "").replace(/\/$/, "");
  if (!config.yoomoneyClientId?.trim() || !appUrl) {
    return res.status(503).json({ message: "ЮMoney не настроен или не указан URL приложения" });
  }
  const redirectUri = `${appUrl}/api/client/yoomoney/callback`;
  const state = yoomoneyStateSign(clientId);
  const url = getAuthUrl({ clientId: config.yoomoneyClientId, redirectUri, state });
  return res.json({ url });
});

const yoomoneyRequestTopupSchema = z.object({ amount: z.number().positive().max(1e7) });
clientRouter.post("/yoomoney/request-topup", async (req, res) => {
  const client = (req as unknown as { client: { id: string; yoomoneyAccessToken?: string | null } }).client;
  const parsed = yoomoneyRequestTopupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Укажите сумму", errors: parsed.error.flatten() });
  const { amount } = parsed.data;
  if (!client.yoomoneyAccessToken?.trim()) {
    return res.status(400).json({ message: "Сначала подключите кошелёк ЮMoney" });
  }
  const config = await getSystemConfig();
  const receiver = config.yoomoneyReceiverWallet?.trim();
  if (!receiver) return res.status(503).json({ message: "ЮMoney не настроен" });

  const serviceName = config.serviceName?.trim() || "STEALTHNET";
  const amountRounded = Math.round(amount * 100) / 100;
  const orderId = randomUUID();
  const payment = await prisma.payment.create({
    data: {
      clientId: client.id,
      orderId,
      amount: amountRounded,
      currency: "RUB",
      status: "PENDING",
      provider: "yoomoney",
      metadata: JSON.stringify({ type: "balance_topup" }),
    },
  });

  const result = await requestPayment(client.yoomoneyAccessToken, {
    to: receiver,
    amount_due: amountRounded,
    label: payment.id,
    message: `Пополнение баланса ${serviceName}. Заказ ${orderId}`,
    comment: `Пополнение баланса`,
  });

  if (result.status === "refused") {
    await prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED" } });
    return res.status(400).json({ message: result.error_description ?? result.error });
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: { metadata: JSON.stringify({ type: "balance_topup", request_id: result.request_id }) },
  });

  return res.json({
    paymentId: payment.id,
    request_id: result.request_id,
    money_source: result.money_source,
    contract_amount: result.contract_amount,
  });
});

const yoomoneyProcessPaymentSchema = z.object({
  paymentId: z.string().min(1),
  request_id: z.string().min(1),
  money_source: z.string().optional(),
  csc: z.string().max(10).optional(),
});
clientRouter.post("/yoomoney/process-payment", async (req, res) => {
  const client = (req as unknown as { client: { id: string; yoomoneyAccessToken?: string | null } }).client;
  const parsed = yoomoneyProcessPaymentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Неверные параметры", errors: parsed.error.flatten() });
  const { paymentId, request_id, money_source, csc } = parsed.data;

  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, clientId: client.id, status: "PENDING", provider: "yoomoney" },
  });
  if (!payment) return res.status(404).json({ message: "Платёж не найден или уже обработан" });
  if (!client.yoomoneyAccessToken?.trim()) return res.status(400).json({ message: "Кошелёк ЮMoney не подключён" });

  const result = await processPayment(client.yoomoneyAccessToken, { request_id, money_source, csc });

  if (result.status === "in_progress") {
    return res.status(202).json({ status: "in_progress", message: "Платёж обрабатывается, повторите запрос через минуту" });
  }
  if (result.status === "ext_auth_required") {
    return res.status(200).json({ status: "ext_auth_required", acs_uri: result.acs_uri, acs_params: result.acs_params });
  }
  if (result.status === "refused") {
    return res.status(400).json({ message: result.error });
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: "PAID", paidAt: new Date(), externalId: result.payment_id ?? undefined },
  });
  const updated = await prisma.client.update({
    where: { id: client.id },
    data: { balance: { increment: payment.amount } },
    select: { balance: true },
  });

  return res.json({ message: "Баланс пополнен", newBalance: updated.balance });
});

// ——— ЮMoney: форма перевода (оплата картой). Пополнение баланса, тариф или опция ———
const yoomoneyFormPaymentSchema = z.object({
  amount: z.number().positive().max(1e7).optional(),
  paymentType: z.enum(["PC", "AC"]), // PC = с кошелька, AC = с карты
  tariffId: z.string().min(1).optional(),
  extraOption: z.object({ kind: z.enum(["traffic", "devices", "servers"]), productId: z.string().min(1) }).optional(),
});
clientRouter.post("/yoomoney/create-form-payment", async (req, res) => {
  const clientId = (req as unknown as { clientId: string }).clientId;
  const parsed = yoomoneyFormPaymentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Укажите сумму и способ оплаты", errors: parsed.error.flatten() });
  const { amount: amountBody, paymentType, tariffId: tariffIdBody, extraOption } = parsed.data;
  const config = await getSystemConfig();
  const receiver = config.yoomoneyReceiverWallet?.trim();
  if (!receiver) return res.status(503).json({ message: "ЮMoney не настроен" });

  let tariffIdToStore: string | null = null;
  let amountRounded: number;
  let metadataObj: Record<string, unknown> = { paymentType };

  if (extraOption) {
    if (!(config as { sellOptionsEnabled?: boolean }).sellOptionsEnabled) {
      return res.status(400).json({ message: "Продажа опций отключена" });
    }
    const cfg = config as {
      sellOptionsTrafficEnabled?: boolean; sellOptionsTrafficProducts?: SellOptionTrafficProduct[];
      sellOptionsDevicesEnabled?: boolean; sellOptionsDevicesProducts?: SellOptionDeviceProduct[];
      sellOptionsServersEnabled?: boolean; sellOptionsServersProducts?: SellOptionServerProduct[];
    };
    if (extraOption.kind === "traffic") {
      const product = cfg.sellOptionsTrafficEnabled && cfg.sellOptionsTrafficProducts?.find((p) => p.id === extraOption.productId);
      if (!product) return res.status(400).json({ message: "Опция не найдена" });
      amountRounded = Math.round(product.price * 100) / 100;
      metadataObj = { paymentType, extraOption: { kind: "traffic", trafficBytes: Math.round(product.trafficGb * 1024 ** 3) } };
    } else if (extraOption.kind === "devices") {
      const product = cfg.sellOptionsDevicesEnabled && cfg.sellOptionsDevicesProducts?.find((p) => p.id === extraOption.productId);
      if (!product) return res.status(400).json({ message: "Опция не найдена" });
      amountRounded = Math.round(product.price * 100) / 100;
      metadataObj = { paymentType, extraOption: { kind: "devices", deviceCount: product.deviceCount } };
    } else {
      const product = cfg.sellOptionsServersEnabled && cfg.sellOptionsServersProducts?.find((p) => p.id === extraOption.productId);
      if (!product) return res.status(400).json({ message: "Опция не найдена" });
      amountRounded = Math.round(product.price * 100) / 100;
      metadataObj = {
        paymentType,
        extraOption: {
          kind: "servers",
          squadUuid: product.squadUuid,
          ...((product.trafficGb ?? 0) > 0 && { trafficBytes: Math.round((product.trafficGb ?? 0) * 1024 ** 3) }),
        },
      };
    }
  } else {
    if (amountBody == null) return res.status(400).json({ message: "Укажите сумму" });
    amountRounded = Math.round(amountBody * 100) / 100;
    if (tariffIdBody) {
      const tariff = await prisma.tariff.findUnique({ where: { id: tariffIdBody } });
      if (!tariff) return res.status(400).json({ message: "Тариф не найден" });
      tariffIdToStore = tariffIdBody;
    }
  }

  const orderId = randomUUID();
  const payment = await prisma.payment.create({
    data: {
      clientId,
      orderId,
      amount: amountRounded,
      currency: "RUB",
      status: "PENDING",
      provider: "yoomoney_form",
      tariffId: tariffIdToStore,
      metadata: JSON.stringify(metadataObj),
    },
  });

  const serviceName = config.serviceName?.trim() || "STEALTHNET";
  const appUrl = (config.publicAppUrl || "").replace(/\/$/, "");
  const successURL = appUrl ? `${appUrl}/cabinet?yoomoney_form=success` : "";
  const targets = tariffIdToStore
    ? `Тариф ${serviceName} #${orderId}`
    : extraOption
      ? `Опция ${serviceName} #${orderId}`
      : `Пополнение баланса ${serviceName} #${orderId}`;
  const params = new URLSearchParams({
    receiver,
    "quickpay-form": "shop",
    targets,
    sum: String(amountRounded),
    paymentType,
    label: payment.id.slice(0, 64),
    successURL,
  });
  const paymentUrl = `https://yoomoney.ru/quickpay/confirm.xml?${params.toString()}`;

  return res.status(201).json({
    paymentId: payment.id,
    paymentUrl,
    form: {
      receiver,
      sum: amountRounded,
      label: payment.id,
      paymentType,
      successURL,
    },
    successURL,
  });
});

clientRouter.get("/yoomoney/form-payment/:paymentId", async (req, res) => {
  const clientId = (req as unknown as { clientId: string }).clientId;
  const paymentId = typeof req.params.paymentId === "string" ? req.params.paymentId : "";
  if (!paymentId) return res.status(400).json({ message: "paymentId required" });

  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, clientId, status: "PENDING", provider: "yoomoney_form" },
    select: { id: true, amount: true, metadata: true },
  });
  if (!payment) return res.status(404).json({ message: "Платёж не найден или уже оплачен" });

  const config = await getSystemConfig();
  const receiver = config.yoomoneyReceiverWallet?.trim();
  if (!receiver) return res.status(503).json({ message: "ЮMoney не настроен" });

  let paymentType = "PC";
  try {
    const meta = payment.metadata ? JSON.parse(payment.metadata) as { paymentType?: string } : {};
    if (meta.paymentType === "AC" || meta.paymentType === "PC") paymentType = meta.paymentType;
  } catch { /* ignore */ }

  const appUrl = (config.publicAppUrl || "").replace(/\/$/, "");
  const successURL = appUrl ? `${appUrl}/cabinet?yoomoney_form=success` : "";

  return res.json({
    receiver,
    sum: payment.amount,
    label: payment.id,
    paymentType,
    successURL,
  });
});

// ——— ЮKassa API: создание платежа (тариф, пополнение или опция), редирект на confirmation_url ———
const yookassaCreatePaymentSchema = z.object({
  amount: z.number().positive().max(1e7).optional(),
  currency: z.string().min(1).max(10).optional(),
  tariffId: z.string().min(1).optional(),
  promoCode: z.string().optional(),
  extraOption: z.object({
    kind: z.enum(["traffic", "devices", "servers"]),
    productId: z.string().min(1),
  }).optional(),
});
clientRouter.post("/yookassa/create-payment", async (req, res) => {
  try {
    const clientId = (req as unknown as { clientId: string }).clientId;
    const parsed = yookassaCreatePaymentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Неверные параметры", errors: parsed.error.flatten() });
    const { amount: amountBody, currency: currencyBody, tariffId: tariffIdBody, promoCode, extraOption } = parsed.data;
    const config = await getSystemConfig();
    const shopId = config.yookassaShopId?.trim();
    const secretKey = config.yookassaSecretKey?.trim();
    if (!shopId || !secretKey) return res.status(503).json({ message: "ЮKassa не настроена" });

    let amountRounded: number;
    let currencyUpper: string;
    let tariffIdToStore: string | null = null;
    let metadataObj: Record<string, unknown> = promoCode ? { promoCode } : {};

    if (extraOption) {
      if (!(config as { sellOptionsEnabled?: boolean }).sellOptionsEnabled) {
        return res.status(400).json({ message: "Продажа опций отключена" });
      }
      const cfg = config as {
        sellOptionsTrafficEnabled?: boolean;
        sellOptionsTrafficProducts?: SellOptionTrafficProduct[];
        sellOptionsDevicesEnabled?: boolean;
        sellOptionsDevicesProducts?: SellOptionDeviceProduct[];
        sellOptionsServersEnabled?: boolean;
        sellOptionsServersProducts?: SellOptionServerProduct[];
      };
      if (extraOption.kind === "traffic") {
        const product = cfg.sellOptionsTrafficEnabled && cfg.sellOptionsTrafficProducts?.find((p) => p.id === extraOption.productId);
        if (!product) return res.status(400).json({ message: "Опция не найдена" });
        amountRounded = Math.round(product.price * 100) / 100;
        currencyUpper = product.currency.toUpperCase();
        metadataObj = { extraOption: { kind: "traffic", trafficBytes: Math.round(product.trafficGb * 1024 ** 3) } };
      } else if (extraOption.kind === "devices") {
        const product = cfg.sellOptionsDevicesEnabled && cfg.sellOptionsDevicesProducts?.find((p) => p.id === extraOption.productId);
        if (!product) return res.status(400).json({ message: "Опция не найдена" });
        amountRounded = Math.round(product.price * 100) / 100;
        currencyUpper = product.currency.toUpperCase();
        metadataObj = { extraOption: { kind: "devices", deviceCount: product.deviceCount } };
      } else {
        const product = cfg.sellOptionsServersEnabled && cfg.sellOptionsServersProducts?.find((p) => p.id === extraOption.productId);
        if (!product) return res.status(400).json({ message: "Опция не найдена" });
        amountRounded = Math.round(product.price * 100) / 100;
        currencyUpper = product.currency.toUpperCase();
        metadataObj = {
          extraOption: {
            kind: "servers",
            squadUuid: product.squadUuid,
            ...((product.trafficGb ?? 0) > 0 && { trafficBytes: Math.round((product.trafficGb ?? 0) * 1024 ** 3) }),
          },
        };
      }
      if (currencyUpper !== "RUB") return res.status(400).json({ message: "ЮKassa принимает только рубли (RUB)" });
    } else {
      if (amountBody == null || !currencyBody) return res.status(400).json({ message: "Укажите сумму и валюту" });
      currencyUpper = currencyBody.toUpperCase();
      if (currencyUpper !== "RUB") return res.status(400).json({ message: "ЮKassa принимает только рубли (RUB)" });
      if (tariffIdBody) {
        const tariff = await prisma.tariff.findUnique({ where: { id: tariffIdBody } });
        if (!tariff) return res.status(400).json({ message: "Тариф не найден" });
        tariffIdToStore = tariffIdBody;
      }
      amountRounded = Math.round(amountBody * 100) / 100;
    }

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { email: true },
    });
    const customerEmail = client?.email?.trim() || null;

    const orderId = randomUUID();
    const payment = await prisma.payment.create({
      data: {
        clientId,
        orderId,
        amount: amountRounded,
        currency: currencyUpper,
        status: "PENDING",
        provider: "yookassa",
        tariffId: tariffIdToStore,
        metadata: Object.keys(metadataObj).length > 0 ? JSON.stringify(metadataObj) : null,
      },
    });

    const serviceName = config.serviceName?.trim() || "STEALTHNET";
    const appUrl = (config.publicAppUrl || "").replace(/\/$/, "");
    const returnUrl = appUrl ? `${appUrl}/cabinet?yookassa=success` : "";
    const description = tariffIdToStore
      ? `Тариф ${serviceName} #${orderId}`
      : extraOption
        ? `Опция ${serviceName} #${orderId}`
        : `Пополнение баланса ${serviceName} #${orderId}`;

    const result = await createYookassaPayment({
      shopId,
      secretKey,
      amount: amountRounded,
      currency: currencyUpper,
      returnUrl,
      description,
      metadata: { payment_id: payment.id },
      customerEmail,
    });

    if (!result.ok) {
      await prisma.payment.delete({ where: { id: payment.id } }).catch(() => { });
      return res.status(500).json({ message: result.error });
    }

    return res.status(201).json({
      paymentId: payment.id,
      confirmationUrl: result.confirmationUrl,
      yookassaPaymentId: result.paymentId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[yookassa/create-payment]", message, err);
    return res.status(500).json({ message: message || "Ошибка создания платежа" });
  }
});

clientRouter.get("/payments", async (req, res) => {
  const clientId = (req as unknown as { clientId: string }).clientId;
  const payments = await prisma.payment.findMany({
    where: { clientId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, orderId: true, amount: true, currency: true, status: true, createdAt: true, paidAt: true },
  });
  return res.json({
    items: payments.map((p) => ({
      id: p.id,
      orderId: p.orderId,
      amount: p.amount,
      currency: p.currency,
      status: p.status,
      createdAt: p.createdAt.toISOString(),
      paidAt: p.paidAt?.toISOString() ?? null,
    })),
  });
});

// Публичный конфиг для бота, mini app, сайта (без паролей и секретов)
export const publicConfigRouter = Router();
publicConfigRouter.get("/config", async (_req, res) => {
  const config = await getPublicConfig();
  return res.json(config);
});

/**
 * Промежуточная страница для диплинков: открывается через Telegram.WebApp.openLink() в системном браузере,
 * который уже может обработать кастомную URL-схему (happ://, stash://, v2rayng:// и т.д.).
 * В Telegram Mini App WebView кастомные схемы заблокированы — это единственный рабочий обходной путь.
 */
publicConfigRouter.get("/deeplink", (req, res) => {
  const url = typeof req.query.url === "string" ? req.query.url : "";
  if (!url) return res.status(400).send("Missing url parameter");
  // HTML-страница с авто-редиректом + кнопка-fallback
  const safeUrl = url.replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Открытие приложения…</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0d1117;color:#e6edf3}
  .btn{display:inline-block;margin-top:24px;padding:14px 32px;background:#2ea043;color:#fff;border:none;border-radius:12px;font-size:17px;text-decoration:none;cursor:pointer}
  .btn:active{opacity:.85}
  .sub{margin-top:16px;font-size:13px;color:#8b949e;max-width:90%;text-align:center;word-break:break-all}
</style>
</head><body>
<p>Открываем приложение…</p>
<a class="btn" href="${safeUrl}" id="open">Открыть приложение</a>
<p class="sub">Если приложение не открылось — нажмите кнопку выше.<br>Ссылка подписки скопирована в буфер обмена.</p>
<script>
  // Авто-редирект через 300мс (даём странице отрисоваться)
  setTimeout(function(){ window.location.href = "${safeUrl.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"; }, 300);
</script>
</body></html>`;
  res.type("html").send(html);
});

/** Конфиг страницы подписки (приложения по платформам, тексты) — для кабинета /cabinet/subscribe */
publicConfigRouter.get("/subscription-page", async (_req, res) => {
  try {
    const row = await prisma.systemSetting.findUnique({
      where: { key: "subscription_page_config" },
    });
    if (!row?.value) return res.json(null);
    const parsed = JSON.parse(row.value) as unknown;
    return res.json(parsed);
  } catch {
    return res.json(null);
  }
});

function tariffToJson(t: { id: string; name: string; description: string | null; durationDays: number; internalSquadUuids: string[]; trafficLimitBytes: bigint | null; deviceLimit: number | null; price: number; currency: string }) {
  return {
    id: t.id,
    name: t.name,
    description: t.description ?? null,
    durationDays: t.durationDays,
    trafficLimitBytes: t.trafficLimitBytes != null ? Number(t.trafficLimitBytes) : null,
    deviceLimit: t.deviceLimit,
    price: t.price,
    currency: t.currency,
  };
}

publicConfigRouter.get("/tariffs", async (_req, res) => {
  try {
    const config = await getSystemConfig();
    const categoryEmojis = config.categoryEmojis ?? { ordinary: "📦", premium: "⭐" };
    const list = await prisma.tariffCategory.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: { tariffs: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
    });
    return res.json({
      items: list.map((c) => {
        const emoji = (c.emojiKey && categoryEmojis[c.emojiKey]) ? categoryEmojis[c.emojiKey] : "";
        return {
          id: c.id,
          name: c.name,
          emojiKey: c.emojiKey ?? null,
          emoji,
          tariffs: c.tariffs.map(tariffToJson),
        };
      }),
    });
  } catch (e) {
    console.error("GET /public/tariffs error:", e);
    return res.status(500).json({ message: "Ошибка загрузки тарифов" });
  }
});
