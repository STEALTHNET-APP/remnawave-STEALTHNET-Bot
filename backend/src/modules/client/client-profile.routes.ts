import { randomUUID } from "crypto";
import { generateSecret, generateURI, verify } from "otplib";
import { Router } from "express";
import { z } from "zod";
import { prisma, asClientWhere, asClientSelect, type ClientEmptyCloneRow } from "../../db.js";
import { mergeClients, isBotOnlyAccount } from "./merge-clients.service.js";
import {
  hashPassword,
  verifyPassword,
  getSystemConfig,
  isSystemSmtpConfigured,
  validatePromoCode,
} from "./client.service.js";
import { requireClientAuth } from "./client.middleware.js";
import { isMailConfigured, mailConfigFromSystem, sendEmail } from "../mail/mail.service.js";
import { renderEmailTemplate } from "../email-templates/email-templates.service.js";
import { canSetPasswordWithoutCurrent } from "./email-registration.js";
import { findConvertibleSubscription, computeConvertedDays } from "../tariff/tariff-activation.service.js";
import { isMultiSubscriptionsEnabled } from "./multi-subscriptions.js";
import { parseTelegramUser, toClientShape, validateTelegramInitData } from "./client-auth.routes.js";

export const clientProfileRouter = Router();

// ——— 2FA (TOTP) ———
const twoFaConfirmSchema = z.object({ code: z.string().length(6, "Код должен быть 6 цифр").regex(/^\d+$/) });
clientProfileRouter.post("/2fa/setup", async (req, res) => {
  const client = (req as unknown as { client: { id: string; email: string | null } }).client;
  const current = await prisma.client.findUnique({ where: { id: client.id }, select: { totpEnabled: true } });
  if (current?.totpEnabled) return res.status(400).json({ message: "2FA уже включена" });
  const secret = generateSecret();
  const label = client.email?.trim() || `client-${client.id}`;
  const otpauthUrl = generateURI({ issuer: "STEALTHNET", label, secret });
  await prisma.client.update({
    where: { id: client.id },
    data: { totpSecret: secret, totpEnabled: false },
  });
  return res.json({ secret, otpauthUrl });
});
clientProfileRouter.post("/2fa/confirm", async (req, res) => {
  const client = (req as unknown as { client: { id: string } }).client;
  const body = twoFaConfirmSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Введите 6-значный код из приложения", errors: body.error.flatten() });
  const row = await prisma.client.findUnique({ where: { id: client.id }, select: { totpSecret: true, totpEnabled: true } });
  if (!row?.totpSecret) return res.status(400).json({ message: "Сначала запустите настройку 2FA" });
  if (row.totpEnabled) return res.status(400).json({ message: "2FA уже включена" });
  const result = await verify({ secret: row.totpSecret, token: body.data.code });
  if (!result.valid) return res.status(400).json({ message: "Неверный код. Проверьте время на устройстве." });
  await prisma.client.update({
    where: { id: client.id },
    data: { totpEnabled: true },
  });
  return res.json({ message: "Двухфакторная аутентификация включена" });
});
clientProfileRouter.post("/2fa/disable", async (req, res) => {
  const client = (req as unknown as { client: { id: string } }).client;
  const body = twoFaConfirmSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Введите 6-значный код из приложения", errors: body.error.flatten() });
  const row = await prisma.client.findUnique({ where: { id: client.id }, select: { totpSecret: true, totpEnabled: true } });
  if (!row?.totpEnabled || !row.totpSecret) return res.status(400).json({ message: "2FA не включена" });
  const result = await verify({ secret: row.totpSecret, token: body.data.code });
  if (!result.valid) return res.status(400).json({ message: "Неверный код" });
  await prisma.client.update({
    where: { id: client.id },
    data: { totpSecret: null, totpEnabled: false },
  });
  return res.json({ message: "Двухфакторная аутентификация отключена" });
});

// ——— Change Password ———
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Введите текущий пароль"),
  newPassword: z.string().min(6, "Минимум 6 символов"),
});

clientProfileRouter.post("/change-password", requireClientAuth, async (req, res) => {
  const client = (req as unknown as { client: { id: string; passwordHash: string | null } }).client;
  const body = changePasswordSchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ message: "Проверьте введённые данные", errors: body.error.flatten() });
  }

  // Получаем актуальный passwordHash из базы
  const clientData = await prisma.client.findUnique({
    where: { id: client.id },
    select: { passwordHash: true },
  });

  if (!clientData?.passwordHash) {
    return res.status(400).json({ message: "У вас нет пароля. Используйте вход через Telegram или Email." });
  }

  const valid = await verifyPassword(body.data.currentPassword, clientData.passwordHash);
  if (!valid) {
    return res.status(400).json({ message: "Неверный текущий пароль" });
  }

  const newPasswordHash = await hashPassword(body.data.newPassword);
  await prisma.client.update({
    where: { id: client.id },
    data: { passwordHash: newPasswordHash },
  });

  return res.json({ message: "Пароль успешно изменён" });
});

const setPasswordSchema = z.object({
  newPassword: z.string().min(6, "Минимум 6 символов"),
});

clientProfileRouter.post("/set-password", requireClientAuth, async (req, res) => {
  const client = (req as unknown as { client: { id: string; passwordHash: string | null } }).client;
  const body = setPasswordSchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ message: "Проверьте введённые данные", errors: body.error.flatten() });
  }

  const clientData = await prisma.client.findUnique({
    where: { id: client.id },
    select: { passwordHash: true },
  });

  // Только если пароля нет. Исключение для dummy-пароля (#200) убрано: оно позволяло перезаписать
  // существующий пароль без текущего. Смена — /change-password или «Забыли пароль?».
  if (!clientData || !canSetPasswordWithoutCurrent(clientData.passwordHash)) {
    return res.status(400).json({ message: "Пароль уже установлен. Используйте смену пароля." });
  }

  const newPasswordHash = await hashPassword(body.data.newPassword);
  await prisma.client.update({
    where: { id: client.id },
    data: { passwordHash: newPasswordHash },
  });

  return res.json({ message: "Пароль установлен" });
});

clientProfileRouter.post("/complete-onboarding", requireClientAuth, async (req, res) => {
  const client = (req as unknown as { client: { id: string } }).client;
  await prisma.client.update({
    where: { id: client.id },
    data: { onboardingCompleted: true },
  });
  return res.json({ message: "Onboarding завершён" });
});

const updateProfileSchema = z.object({
  preferredLang: z.string().max(10).optional(),
  preferredCurrency: z.string().max(10).optional(),
});

clientProfileRouter.patch("/profile", async (req, res) => {
  const client = (req as unknown as { client: { id: string } }).client;
  const body = updateProfileSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Проверьте введённые данные", errors: body.error.flatten() });
  const updates: { preferredLang?: string; preferredCurrency?: string } = {};
  if (body.data.preferredLang !== undefined) updates.preferredLang = body.data.preferredLang;
  if (body.data.preferredCurrency !== undefined) updates.preferredCurrency = body.data.preferredCurrency;
  if (Object.keys(updates).length === 0) {
    const current = await prisma.client.findUnique({ where: { id: client.id }, select: { id: true, email: true, telegramId: true, telegramUsername: true, preferredLang: true, preferredCurrency: true, balance: true, referralCode: true, remnawaveUuid: true, trialUsed: true, isBlocked: true, autoRenewEnabled: true, autoRenewTariffId: true, createdAt: true, onboardingCompleted: true, passwordHash: true } });
    return res.json(current ? toClientShape(current) : { message: "Не найдено" });
  }
  const updated = await prisma.client.update({
    where: { id: client.id },
    data: updates,
    select: { id: true, email: true, telegramId: true, telegramUsername: true, preferredLang: true, preferredCurrency: true, balance: true, referralCode: true, remnawaveUuid: true, trialUsed: true, isBlocked: true, autoRenewEnabled: true, autoRenewTariffId: true, createdAt: true, onboardingCompleted: true, passwordHash: true },
  });
  return res.json(toClientShape(updated));
});

const updateAutoRenewSchema = z.object({
  enabled: z.boolean().optional(),
  tariffId: z.string().nullable().optional(),
  promoCode: z.string().max(50).nullable().optional(),
});

clientProfileRouter.patch("/auto-renew", async (req, res) => {
  const client = (req as unknown as { client: { id: string } }).client;
  const body = updateAutoRenewSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Проверьте введённые данные", errors: body.error.flatten() });

  const updates: {
    autoRenewEnabled?: boolean;
    autoRenewTariffId?: string | null;
    autoRenewPriceOptionId?: string | null;
    autoRenewExtraDevices?: number;
    autoRenewPromoCode?: string | null;
  } = {};
  if (body.data.enabled !== undefined) updates.autoRenewEnabled = body.data.enabled;
  if (body.data.tariffId !== undefined) updates.autoRenewTariffId = body.data.tariffId;

  // При включении автопродления (без явного tariffId) — авто-подтягиваем контекст из последнего
  // успешного тарифного платежа: тариф + опция длительности + кол-во доп. устройств. Без этого
  // плашка «следующее списание» не появится для клиентов, которые до изменений уже включали
  // автопродление, но мы не сохраняли priceOption / extras.
  if (body.data.enabled === true && body.data.tariffId === undefined) {
    const lastPaid = await prisma.payment.findFirst({
      where: { clientId: client.id, status: "PAID", tariffId: { not: null } },
      orderBy: { paidAt: "desc" },
      select: { tariffId: true, tariffPriceOptionId: true, deviceCount: true },
    });
    if (lastPaid?.tariffId) {
      updates.autoRenewTariffId = lastPaid.tariffId;
      updates.autoRenewPriceOptionId = lastPaid.tariffPriceOptionId;
      updates.autoRenewExtraDevices = lastPaid.deviceCount ?? 0;
    } else {
      // Нет тарифной истории — fallback на currentTariffId.
      const cur = await prisma.client.findUnique({
        where: { id: client.id },
        select: { currentTariffId: true },
      });
      if (cur?.currentTariffId) updates.autoRenewTariffId = cur.currentTariffId;
    }
  }

  if (body.data.promoCode !== undefined) {
    const code = body.data.promoCode?.trim() ?? "";
    // Пустая строка = удалить промокод из автопродления.
    if (!code) {
      updates.autoRenewPromoCode = null;
    } else {
      // Валидируем DISCOUNT-промокод прежде чем сохранять.
      const result = await validatePromoCode(code, client.id);
      if (!result.ok) return res.status(result.status).json({ message: result.error });
      if (result.promo.type !== "DISCOUNT") return res.status(400).json({ message: "Для автопродления нужен промокод со скидкой" });
      updates.autoRenewPromoCode = code;
    }
  }

  if (Object.keys(updates).length === 0) {
    const current = await prisma.client.findUnique({ where: { id: client.id }, select: { id: true, email: true, telegramId: true, telegramUsername: true, preferredLang: true, preferredCurrency: true, balance: true, referralCode: true, remnawaveUuid: true, trialUsed: true, isBlocked: true, autoRenewEnabled: true, autoRenewTariffId: true, autoRenewPromoCode: true, createdAt: true, onboardingCompleted: true, passwordHash: true } });
    return res.json(current ? toClientShape(current) : { message: "Не найдено" });
  }

  // МОСТ В UNIFIED-ЦИКЛ: профильный тумблер (бот «Профиль → Автопродление») — мастер-переключатель
  // per-sub автосписания. Раньше PATCH писал ТОЛЬКО в legacy Client.*-поля, которые unified-цикл
  // (source-of-truth) не читает, а legacy Client-цикл требует autoRenewTariffId (null без платёжной
  // истории) и сломан tx-isolation багом → кнопка показывала «включено», но НИКОГДА не списывала.
  if (body.data.enabled === true) {
    // Включаем на всех обычных (не подарочных) подписках, которым есть что продлевать;
    // autoRenewTariffId подтягиваем из tariffId, если пуст (нужен циклу при удалении тарифа).
    const subsToEnable = await prisma.subscription.findMany({
      where: {
        ownerId: client.id,
        giftStatus: null,
        OR: [{ tariffId: { not: null } }, { autoRenewTariffId: { not: null } }],
      },
      select: { id: true, tariffId: true, autoRenewTariffId: true },
    });
    for (const s of subsToEnable) {
      await prisma.subscription.update({
        where: { id: s.id },
        data: { autoRenewEnabled: true, ...(s.autoRenewTariffId ? {} : { autoRenewTariffId: s.tariffId }) },
      });
    }
  } else if (body.data.enabled === false) {
    await prisma.subscription.updateMany({
      where: { ownerId: client.id },
      data: { autoRenewEnabled: false },
    });
  }

  const updated = await prisma.client.update({
    where: { id: client.id },
    data: updates,
    select: { id: true, email: true, telegramId: true, telegramUsername: true, preferredLang: true, preferredCurrency: true, balance: true, referralCode: true, remnawaveUuid: true, trialUsed: true, isBlocked: true, autoRenewEnabled: true, autoRenewTariffId: true, autoRenewPromoCode: true, createdAt: true, onboardingCompleted: true, passwordHash: true },
  });
  return res.json(toClientShape(updated));
});

/** Запросить код для привязки Telegram через бота (аккаунт без Telegram, залогинен по почте) */
clientProfileRouter.post("/link-telegram-request", async (req, res) => {
  const client = (req as unknown as { client: { id: string; telegramId: string | null } }).client;
  if (client.telegramId) return res.status(400).json({ message: "Telegram уже привязан" });
  await prisma.pendingTelegramLink.deleteMany({ where: { clientId: client.id } });
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await prisma.pendingTelegramLink.create({
    data: { clientId: client.id, code, expiresAt },
  });
  const config = await getSystemConfig();
  const botUsername = (config.telegramBotUsername ?? "").replace(/^@/, "") || null;
  return res.json({ code, expiresAt: expiresAt.toISOString(), botUsername });
});

/** Привязать Telegram из Mini App (initData от Telegram WebApp) */
const linkTelegramSchema = z.object({ initData: z.string().min(1) });
clientProfileRouter.post("/link-telegram", async (req, res) => {
  const client = (req as unknown as { client: { id: string; telegramId: string | null } }).client;
  if (client.telegramId) return res.status(400).json({ message: "Telegram уже привязан" });
  const body = linkTelegramSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Проверьте введённые данные", errors: body.error.flatten() });
  // v5.0.0: initData подписан токеном единственного бота инсталляции.
  const botToken = (process.env.BOT_TOKEN ?? "").trim();
  if (!botToken || !validateTelegramInitData(body.data.initData, botToken)) {
    return res.status(401).json({ message: "Недействительные или устаревшие данные Telegram" });
  }
  const tgUser = parseTelegramUser(body.data.initData);
  if (!tgUser) return res.status(400).json({ message: "Нет данных пользователя" });
  const telegramId = String(tgUser.id);
  const telegramUsername = tgUser.username?.trim() ?? null;
  const other = (await prisma.client.findFirst({
    where: asClientWhere({ telegramId}),
    select: asClientSelect({
      id: true,
      email: true,
      passwordHash: true,
      googleId: true,
      appleId: true,
      remnawaveUuid: true,
      balance: true,
      _count: { select: { payments: true, ownedSubscriptions: true } },
    }),
  })) as ClientEmptyCloneRow | null;
  if (other && other.id !== client.id) {
    // Второй аккаунт с этим telegramId. Сливаем в текущего (инициатор из мини-аппа),
    // если TG-аккаунт не самостоятельная web-идентичность (нет email/пароля/OAuth) —
    // независимо от наличия подписок/баланса (схема Алекса). Иначе отказ.
    if (!isBotOnlyAccount(other)) {
      return res.status(409).json({ message: "Этот Telegram-аккаунт уже привязан к другому аккаунту с почтой. Сначала войдите в тот аккаунт и отвяжите Telegram, либо обратитесь в поддержку." });
    }
    try {
      await mergeClients(client.id, other.id, { telegramId, telegramUsername });
    } catch (e) {
      console.error("[link-telegram] merge failed:", e);
      return res.status(500).json({ message: "Не удалось объединить аккаунты. Обратитесь в поддержку." });
    }
  } else {
    await prisma.client.update({ where: { id: client.id }, data: { telegramId, telegramUsername } });
  }
  const updated = await prisma.client.findUnique({
    where: { id: client.id },
    select: { id: true, email: true, telegramId: true, telegramUsername: true, preferredLang: true, preferredCurrency: true, balance: true, referralCode: true, remnawaveUuid: true, trialUsed: true, isBlocked: true, autoRenewEnabled: true, autoRenewTariffId: true, yoomoneyAccessToken: true, createdAt: true, onboardingCompleted: true, passwordHash: true },
  });
  if (!updated) return res.status(500).json({ message: "Не удалось привязать Telegram" });
  return res.json({ client: toClientShape(updated) });
});

/**
 * мгновенная привязка email БЕЗ верификации.
 * Используется когда SMTP не настроен или skipEmailVerification=true в админке.
 * В обоих случаях нет смысла слать письмо — либо нельзя, либо не требуется.
 */
/**
 * Превью конвертации для режима «одна подписка из категории».
 *
 * UI (кабинет/миниаппки/бот) зовёт перед оплатой тарифа: если покупка
 * конвертирует существующую подписку — показываем юзеру красивое предупреждение
 * с расчётом (какая подписка, сколько дней остатка, во сколько они превратятся).
 */
clientProfileRouter.get("/tariff-conversion-preview", async (req, res) => {
  const client = (req as unknown as { client: { id: string } }).client;
  const tariffId = typeof req.query.tariffId === "string" ? req.query.tariffId : "";
  const priceOptionId = typeof req.query.priceOptionId === "string" ? req.query.priceOptionId : null;
  if (!tariffId) return res.status(400).json({ message: "tariffId обязателен" });

  const replaceTrialSubId = typeof req.query.replaceTrialSubId === "string" && req.query.replaceTrialSubId.trim()
    ? req.query.replaceTrialSubId.trim()
    : null;
  let cfgMS: Awaited<ReturnType<typeof getSystemConfig>>;
  try {
    cfgMS = await getSystemConfig();
  } catch (e) {
    console.error("[conversion-preview] system config unavailable:", e);
    return res.status(503).json({ message: "Настройки временно недоступны, повторите позже" });
  }
  const multiSubEnabled = isMultiSubscriptionsEnabled(cfgMS);
  const convertible = await findConvertibleSubscription(client.id, tariffId, multiSubEnabled, {
    preferredSubId: replaceTrialSubId,
    trialSquadUuid: cfgMS.trialSquadUuid,
  });
  if (!convertible) return res.json({ willConvert: false });
  // Single-режим: сколько ДРУГИХ подписок клиента удалится при консолидации (кроме конвертируемой).
  const othersToRemove = !multiSubEnabled
    ? Math.max(0, (await prisma.subscription.count({ where: { ownerId: client.id, purchasedAsGift: false, giftStatus: null } })) - 1)
    : 0;

  const tariff = await prisma.tariff.findUnique({
    where: { id: tariffId },
    select: { name: true, durationDays: true, price: true, includedDevices: true, priceOptions: { select: { id: true, durationDays: true, price: true } } },
  });
  if (!tariff) return res.json({ willConvert: false });

  // Доп. устройства конвертируемой подписки — для выбора «сохранить/убрать».
  const subExtras = await prisma.subscription.findUnique({
    where: { id: convertible.id },
    select: { extraDevices: true, extraDevicesMonthlyPrice: true },
  });
  const extraDevices = subExtras?.extraDevices ?? 0;
  const extrasMonthly = subExtras?.extraDevicesMonthlyPrice ?? 0;

  const option = priceOptionId ? tariff.priceOptions.find((o) => o.id === priceOptionId) ?? null : null;
  const purchasedDays = option?.durationDays ?? tariff.durationDays;
  const newPrice = option?.price ?? tariff.price;
  const newBasePerDay = purchasedDays > 0 ? newPrice / purchasedDays : 0;

  const remainingMs = convertible.expireAt ? convertible.expireAt.getTime() - Date.now() : 0;
  const remainingDays = Math.max(0, Math.floor(remainingMs / 86_400_000));

  // покупается ТОТ ЖЕ тариф → это продление: дни складываются
  // 1:1, сквады/трафик не трогаются. UI переключает оплату в extend-флоу
  // (extendsSecondarySubId) — там честно считается доплата за доп. устройства
  // и работает выбор «сохранить/убрать», единый для ЛЮБОЙ подписки.
  if (convertible.sameTariff) {
    const extSub = await prisma.subscription.findUnique({
      where: { id: convertible.id },
      select: { extraDevices: true, extraDevicesMonthlyPrice: true },
    });
    const extDevices = extSub?.extraDevices ?? 0;
    const extMonthly = extSub?.extraDevicesMonthlyPrice ?? 0;
    const keepCostForPeriod = extDevices > 0 && purchasedDays > 0
      ? Math.round(extMonthly * (purchasedDays / 30) * 100) / 100
      : 0;
    return res.json({
      willConvert: true,
      mode: "extend",
      othersToRemove,
      subscription: {
        id: convertible.id,
        index: convertible.subscriptionIndex,
        tariffName: convertible.tariffName,
        expireAt: convertible.expireAt?.toISOString() ?? null,
        isTrial: convertible.trialId != null || convertible.isLegacyTrial,
        trialId: convertible.trialId,
        trialName: convertible.trialName,
      },
      remainingDays,
      convertedDays: remainingDays,
      purchasedDays,
      totalDays: purchasedDays + remainingDays,
      extras: extDevices > 0 ? {
        extraDevices: extDevices,
        extraDevicesMonthlyPrice: extMonthly,
        newIncludedDevices: Math.max(1, tariff.includedDevices ?? 1),
        /** «сохранить»: доплата за устройства на купленный период. */
        keep: { totalDevices: Math.max(1, tariff.includedDevices ?? 1) + extDevices, convertedDays: remainingDays, totalDays: purchasedDays + remainingDays, extraCost: keepCostForPeriod },
        /** «убрать»: без доплаты, устройств меньше. */
        drop: { totalDevices: Math.max(1, tariff.includedDevices ?? 1), convertedDays: remainingDays, totalDays: purchasedDays + remainingDays, extraCost: 0 },
      } : undefined,
    });
  }

  // та же математика, что в extendSecondarySubscription(convertMode):
  // полная старая ставка = база + устройства; при «убрать» вся ценность уходит в дни
  // чистого тарифа, при «оставить» — в дни тарифа с устройствами.
  // Глобальный single-режим (мульти-подписки выкл): смена тарифа = ЖЁСТКАЯ замена.
  // Старая подписка обнуляется, остаток дней СГОРАЕТ, новая с нуля на выбранный тариф.
  if (!multiSubEnabled && !convertible.promoGranted) {
    return res.json({
      willConvert: true,
      mode: "replace",
      othersToRemove,
      subscription: {
        id: convertible.id,
        index: convertible.subscriptionIndex,
        tariffName: convertible.tariffName,
        expireAt: convertible.expireAt?.toISOString() ?? null,
        isTrial: convertible.trialId != null || convertible.isLegacyTrial,
        trialId: convertible.trialId,
        trialName: convertible.trialName,
      },
      remainingDays,
      convertedDays: 0,
      purchasedDays,
      totalDays: purchasedDays,
    });
  }

  const extrasPerDay = extraDevices > 0 ? extrasMonthly / 30 : 0;
  const oldFullPerDay = convertible.currentPricePerDay != null
    ? convertible.currentPricePerDay + extrasPerDay
    : (extrasPerDay > 0 ? extrasPerDay : null);
  const convertedDaysDrop = convertible.promoGranted ? remainingDays : computeConvertedDays({
    remainingDays,
    oldPricePerDay: oldFullPerDay,
    newPricePerDay: newBasePerDay,
  });
  const convertedDaysKeep = convertible.promoGranted ? remainingDays : extraDevices > 0
    ? computeConvertedDays({
        remainingDays,
        oldPricePerDay: oldFullPerDay,
        newPricePerDay: newBasePerDay + extrasPerDay,
      })
    : convertedDaysDrop;

  const newIncludedDevices = Math.max(1, tariff.includedDevices ?? 1);

  return res.json({
    willConvert: true,
    mode: "convert",
      othersToRemove,
    subscription: {
      id: convertible.id,
      index: convertible.subscriptionIndex,
      tariffName: convertible.tariffName,
      expireAt: convertible.expireAt?.toISOString() ?? null,
      isTrial: convertible.trialId != null || convertible.isLegacyTrial,
      trialId: convertible.trialId,
      trialName: convertible.trialName,
    },
    remainingDays,
    // обратная совместимость: convertedDays = вариант «оставить устройства» (дефолт UI).
    convertedDays: convertedDaysKeep,
    purchasedDays,
    totalDays: purchasedDays + convertedDaysKeep,
    // выбор судьбы доп. устройств при конвертации.
    extras: {
      extraDevices,
      extraDevicesMonthlyPrice: extrasMonthly,
      newIncludedDevices,
      /** оставить устройства: всего устройств / дней конвертируется */
      keep: { totalDevices: newIncludedDevices + extraDevices, convertedDays: convertedDaysKeep, totalDays: purchasedDays + convertedDaysKeep },
      /** убрать устройства: всего устройств / дней конвертируется (больше) */
      drop: { totalDevices: newIncludedDevices, convertedDays: convertedDaysDrop, totalDays: purchasedDays + convertedDaysDrop },
    },
  });
});

const linkEmailDirectSchema = z.object({ email: z.string().email() });
clientProfileRouter.post("/link-email-direct", async (req, res) => {
  const client = (req as unknown as { client: { id: string; email: string | null } }).client;
  if (client.email?.trim()) return res.status(400).json({ message: "Почта уже привязана" });
  const body = linkEmailDirectSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Некорректный email", errors: body.error.flatten() });
  const email = body.data.email.trim().toLowerCase();

  // Защита от обхода: метод работает только если SMTP не настроен ИЛИ
  // skipEmailVerification=true. Иначе админ хочет полноценную верификацию.
  // критерий «SMTP настроен» обязан совпадать с публичным
  // smtpConfigured (по нему фронт выбирает direct vs request) — раньше здесь
  // дефолтился порт 587 и при пустом порте юзер попадал в тупик.
  const config = await getSystemConfig();
  const smtpOk = isSystemSmtpConfigured(config);
  if (smtpOk && !config.skipEmailVerification) {
    return res.status(400).json({ message: "Требуется верификация. Используйте /link-email-request." });
  }

  const existing = await prisma.client.findUnique({ where: { email } });
  if (existing && existing.id !== client.id) {
    return res.status(400).json({ message: "Эта почта уже используется другим аккаунтом" });
  }

  const updated = await prisma.client.update({
    where: { id: client.id },
    data: { email },
    select: { id: true, email: true, telegramId: true, telegramUsername: true, preferredLang: true, preferredCurrency: true, balance: true, referralCode: true, referralPercent: true, remnawaveUuid: true, trialUsed: true, isBlocked: true, autoRenewEnabled: true, autoRenewTariffId: true, yoomoneyAccessToken: true, totpEnabled: true, createdAt: true, onboardingCompleted: true, passwordHash: true },
  });
  return res.json({ message: "Почта привязана", client: toClientShape(updated) });
});

/** Запросить привязку email (отправить письмо со ссылкой) */
const linkEmailRequestSchema = z.object({ email: z.string().email() });
clientProfileRouter.post("/link-email-request", async (req, res) => {
  const client = (req as unknown as { client: { id: string; email: string | null } }).client;
  if (client.email?.trim()) return res.status(400).json({ message: "Почта уже привязана" });
  const body = linkEmailRequestSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Некорректный email", errors: body.error.flatten() });
  const email = body.data.email.trim().toLowerCase();
  const config = await getSystemConfig();
  const smtpConfig = mailConfigFromSystem(config);
  if (!isMailConfigured(smtpConfig)) return res.status(503).json({ message: "Отправка писем не настроена. Обратитесь в поддержку." });
  const existing = await prisma.client.findUnique({
    where: { email },
    select: { id: true, telegramId: true },
  });
  // Почта занята другим аккаунтом. По схеме Алекса:
  //  - если у владельца почты НЕТ Telegram — слияние возможно (произойдёт после
  //    подтверждения письма, см. verify-link-email). Письмо всё равно шлём.
  //  - если у владельца почты УЖЕ привязан Telegram — это полноценный аккаунт,
  //    привязать такую почту нельзя.
  if (existing && existing.id !== client.id && existing.telegramId) {
    return res.status(400).json({ message: "Эта почта уже привязана к другому аккаунту с Telegram. Объединение невозможно — обратитесь в поддержку." });
  }
  await prisma.pendingEmailLink.deleteMany({ where: { clientId: client.id } });
  const verificationToken = randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await prisma.pendingEmailLink.create({
    data: { clientId: client.id, email, verificationToken, expiresAt },
  });
  const appUrl = (config.publicAppUrl || "").replace(/\/$/, "");
  const verificationLink = appUrl ? `${appUrl}/cabinet/verify-link-email?token=${verificationToken}` : "";
  if (!verificationLink) return res.status(500).json({ message: "Не задан URL приложения в настройках" });
  const linkTpl = await renderEmailTemplate("link_email", {
    verifyUrl: verificationLink,
    hours: "24",
    serviceName: config.serviceName ?? "STEALTHNET",
  });
  const sendResult = linkTpl
    ? await sendEmail(smtpConfig, email, linkTpl.subject, linkTpl.body)
    : { ok: false as const, error: "link_email template missing" };
  if (!sendResult.ok) {
    await prisma.pendingEmailLink.deleteMany({ where: { verificationToken } }).catch(() => {});
    return res.status(500).json({ message: "Не удалось отправить письмо. Попробуйте позже." });
  }
  return res.json({ message: "Письмо с ссылкой отправлено на указанный email" });
});
