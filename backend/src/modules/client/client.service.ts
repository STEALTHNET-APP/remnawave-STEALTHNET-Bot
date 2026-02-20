import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomBytes } from "crypto";
import { prisma } from "../../db.js";
import { env } from "../../config/index.js";

const SALT_ROUNDS = 12;

export type ClientTokenPayload = { clientId: string; type: "client_access" };

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signClientToken(clientId: string, expiresIn = "7d"): string {
  return jwt.sign(
    { clientId, type: "client_access" } as ClientTokenPayload,
    env.JWT_SECRET,
    { expiresIn } as jwt.SignOptions
  );
}

export function verifyClientToken(token: string): ClientTokenPayload | null {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as ClientTokenPayload;
    return decoded?.type === "client_access" ? decoded : null;
  } catch {
    return null;
  }
}

export function generateReferralCode(): string {
  return "REF-" + randomBytes(4).toString("hex").toUpperCase();
}

const SYSTEM_CONFIG_KEYS = [
  "active_languages", "active_currencies", "default_language", "default_currency",
  "default_referral_percent", "referral_percent_level_2", "referral_percent_level_3",
  "trial_days", "trial_squad_uuid", "trial_device_limit", "trial_traffic_limit",
  "service_name", "logo", "favicon", "remna_client_url",
  "smtp_host", "smtp_port", "smtp_secure", "smtp_user", "smtp_password",
  "smtp_from_email", "smtp_from_name", "public_app_url",
  "telegram_bot_token", "telegram_bot_username",
  "platega_merchant_id", "platega_secret", "platega_methods",
  "yoomoney_client_id", "yoomoney_client_secret", "yoomoney_receiver_wallet", "yoomoney_notification_secret",
  "yookassa_shop_id", "yookassa_secret_key",
  "bot_buttons", "bot_back_label", "bot_menu_texts", "bot_inner_button_styles",
  "bot_emojis", // JSON: { "TRIAL": { "unicode": "🎁", "tgEmojiId": "..." }, "PACKAGE": ... } — эмодзи кнопок/текста, TG ID для премиум
  "category_emojis", // JSON: { "ordinary": "📦", "premium": "⭐" } — эмодзи категорий по коду
  "subscription_page_config",
  "support_link", "agreement_link", "offer_link", "instructions_link", // Поддержка: тех поддержка, соглашения, оферта, инструкции
  "theme_accent", // Глобальная цветовая тема: default, blue, violet, rose, orange, green, emerald, cyan, amber, red, pink, indigo
  "force_subscribe_enabled", "force_subscribe_channel_id", "force_subscribe_message", // Принудительная подписка на канал/группу
  // Продажа опций: доп. трафик, доп. устройства, доп. серверы (сквады)
  "sell_options_enabled", "sell_options_traffic_enabled", "sell_options_traffic_products",
  "sell_options_devices_enabled", "sell_options_devices_products",
  "sell_options_servers_enabled", "sell_options_servers_products",
  "google_analytics_id", "yandex_metrika_id", // Маркетинг: счётчики для кабинета
  "auto_broadcast_cron", // Расписание авто-рассылки (cron, например "0 9 * * *" = 9:00 каждый день)
];

/** Продукт «Доп. трафик»: объём в ГБ, цена, валюта */
export type SellOptionTrafficProduct = { id: string; name: string; trafficGb: number; price: number; currency: string };
/** Продукт «Доп. устройства»: кол-во устройств, цена */
export type SellOptionDeviceProduct = { id: string; name: string; deviceCount: number; price: number; currency: string };
/** Продукт «Доп. сервер»: сквад Remna, опционально трафик (ГБ), цена */
export type SellOptionServerProduct = { id: string; name: string; squadUuid: string; trafficGb?: number; price: number; currency: string };

export type BotButtonConfig = { id: string; visible: boolean; label: string; order: number; style?: string; emojiKey?: string };
export type BotEmojiEntry = { unicode?: string; tgEmojiId?: string };
export type BotEmojisConfig = Record<string, BotEmojiEntry>;
const DEFAULT_BOT_BUTTONS: BotButtonConfig[] = [
  { id: "tariffs", visible: true, label: "📦 Тарифы", order: 0, style: "success" },
  { id: "profile", visible: true, label: "👤 Профиль", order: 1, style: "" },
  { id: "topup", visible: true, label: "💳 Пополнить баланс", order: 2, style: "success" },
  { id: "referral", visible: true, label: "🔗 Реферальная программа", order: 3, style: "primary" },
  { id: "trial", visible: true, label: "🎁 Попробовать бесплатно", order: 4, style: "success" },
  { id: "vpn", visible: true, label: "🌐 Подключиться к VPN", order: 5, style: "danger" },
  { id: "cabinet", visible: true, label: "🌐 Web Кабинет", order: 6, style: "primary" },
  { id: "support", visible: true, label: "🆘 Поддержка", order: 7, style: "primary" },
  { id: "promocode", visible: true, label: "🎟️ Промокод", order: 8, style: "primary" },
  { id: "extra_options", visible: true, label: "➕ Доп. опции", order: 9, style: "primary" },
];

export type BotMenuTexts = {
  welcomeTitlePrefix?: string;
  welcomeGreeting?: string;
  balancePrefix?: string;
  tariffPrefix?: string;
  subscriptionPrefix?: string;
  statusInactive?: string;
  statusActive?: string;
  statusExpired?: string;
  statusLimited?: string;
  statusDisabled?: string;
  expirePrefix?: string;
  daysLeftPrefix?: string;
  devicesLabel?: string;
  devicesAvailable?: string;
  trafficPrefix?: string;
  linkLabel?: string;
  chooseAction?: string;
};

const DEFAULT_BOT_MENU_TEXTS: Required<BotMenuTexts> = {
  welcomeTitlePrefix: "🛡 ",
  welcomeGreeting: "👋 Добро пожаловать в ",
  balancePrefix: "💰 Баланс: ",
  tariffPrefix: "💎 Ваш тариф : ",
  subscriptionPrefix: "📊 Статус подписки — ",
  statusInactive: "🔴 Истекла",
  statusActive: "🟡 Активна",
  statusExpired: "🔴 Истекла",
  statusLimited: "🟡 Ограничена",
  statusDisabled: "🔴 Отключена",
  expirePrefix: "📅 до ",
  daysLeftPrefix: "⏰ осталось ",
  devicesLabel: "📱 Устройств: ",
  devicesAvailable: " доступно",
  trafficPrefix: "📈 Трафик — ",
  linkLabel: "🔗 Ссылка подключения:",
  chooseAction: "Выберите действие:",
};

export type BotInnerButtonStyles = {
  tariffPay?: string;
  topup?: string;
  back?: string;
  profile?: string;
  trialConfirm?: string;
  lang?: string;
  currency?: string;
};

const DEFAULT_BOT_INNER_BUTTON_STYLES: Required<BotInnerButtonStyles> = {
  tariffPay: "success",
  topup: "primary",
  back: "danger",
  profile: "primary",
  trialConfirm: "success",
  lang: "primary",
  currency: "primary",
};

function parseBotInnerButtonStyles(raw: string | undefined): Required<BotInnerButtonStyles> {
  if (!raw || !raw.trim()) return { ...DEFAULT_BOT_INNER_BUTTON_STYLES };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_BOT_INNER_BUTTON_STYLES };
    const out = { ...DEFAULT_BOT_INNER_BUTTON_STYLES };
    for (const k of Object.keys(DEFAULT_BOT_INNER_BUTTON_STYLES) as (keyof BotInnerButtonStyles)[]) {
      if (typeof parsed[k] === "string" && ["primary", "success", "danger", ""].includes(parsed[k] as string)) {
        out[k] = parsed[k] as string; // сохраняем "" как «без стиля», не подменяем дефолтом
      }
    }
    return out;
  } catch {
    return { ...DEFAULT_BOT_INNER_BUTTON_STYLES };
  }
}

function parseBotMenuTexts(raw: string | undefined): Required<BotMenuTexts> {
  if (!raw || !raw.trim()) return { ...DEFAULT_BOT_MENU_TEXTS };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_BOT_MENU_TEXTS };
    const out = { ...DEFAULT_BOT_MENU_TEXTS };
    for (const k of Object.keys(DEFAULT_BOT_MENU_TEXTS) as (keyof BotMenuTexts)[]) {
      if (typeof parsed[k] === "string") out[k] = parsed[k] as string;
    }
    return out;
  } catch {
    return { ...DEFAULT_BOT_MENU_TEXTS };
  }
}

function parseBotButtons(raw: string | undefined): BotButtonConfig[] {
  if (!raw || !raw.trim()) return DEFAULT_BOT_BUTTONS;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return DEFAULT_BOT_BUTTONS;
    const result = parsed.map((x: unknown, i: number) => {
      const o = x as Record<string, unknown>;
      const id = typeof o.id === "string" ? o.id : String(o.id ?? "button");
      const def = DEFAULT_BOT_BUTTONS.find((d) => d.id === id) ?? { label: id, order: i, style: "" as string };
      return {
        id,
        visible: typeof o.visible === "boolean" ? o.visible : true,
        label: typeof o.label === "string" && o.label.trim() ? o.label.trim() : def.label,
        order: typeof o.order === "number" ? o.order : (typeof o.order === "string" ? parseInt(o.order, 10) : i),
        style: typeof o.style === "string" ? o.style : (def as BotButtonConfig).style ?? "",
        emojiKey: typeof o.emojiKey === "string" && o.emojiKey.trim() ? o.emojiKey.trim() : undefined,
      };
    });
    // Дополняем кнопками из дефолтов, которых нет в сохранённом списке
    const savedIds = new Set(result.map((b) => b.id));
    for (const def of DEFAULT_BOT_BUTTONS) {
      if (!savedIds.has(def.id)) {
        result.push({ id: def.id, visible: def.visible, label: def.label, order: def.order, style: def.style ?? "", emojiKey: undefined });
      }
    }
    return result;
  } catch {
    return DEFAULT_BOT_BUTTONS;
  }
}

function parseBotEmojis(raw: string | undefined): BotEmojisConfig {
  if (!raw || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: BotEmojisConfig = {};
    for (const [key, val] of Object.entries(parsed)) {
      if (val == null) continue;
      if (typeof val === "string" && val.trim()) {
        out[key] = { unicode: val.trim() };
        continue;
      }
      if (typeof val !== "object") continue;
      const v = val as Record<string, unknown>;
      const unicode = typeof v.unicode === "string" ? v.unicode.trim() : undefined;
      const tgEmojiId = typeof v.tgEmojiId === "string" ? v.tgEmojiId.trim() : (typeof v.tgEmojiId === "number" ? String(v.tgEmojiId) : undefined);
      if (unicode || tgEmojiId) out[key] = { unicode, tgEmojiId };
    }
    return out;
  } catch {
    return {};
  }
}

export async function getSystemConfig() {
  const settings = await prisma.systemSetting.findMany({
    where: { key: { in: SYSTEM_CONFIG_KEYS } },
  });
  const map = Object.fromEntries(settings.map((s: { key: string; value: string }) => [s.key, s.value]));
  const activeLangs = (map.active_languages || "ru,en").split(",").map((s: string) => s.trim());
  const activeCurrs = (map.active_currencies || "usd,rub").split(",").map((s: string) => s.trim());
  return {
    activeLanguages: activeLangs,
    activeCurrencies: activeCurrs,
    defaultLanguage: map.default_language && activeLangs.includes(map.default_language) ? map.default_language : activeLangs[0] ?? "ru",
    defaultCurrency: map.default_currency && activeCurrs.includes(map.default_currency) ? map.default_currency : activeCurrs[0] ?? "usd",
    defaultReferralPercent: parseFloat(map.default_referral_percent || "30"),
    referralPercentLevel2: parseFloat(map.referral_percent_level_2 || "10"),
    referralPercentLevel3: parseFloat(map.referral_percent_level_3 || "10"),
    trialDays: parseInt(map.trial_days || "3", 10),
    trialSquadUuid: map.trial_squad_uuid || null,
    trialDeviceLimit: map.trial_device_limit != null && map.trial_device_limit !== "" ? parseInt(map.trial_device_limit, 10) : null,
    trialTrafficLimitBytes: map.trial_traffic_limit != null && map.trial_traffic_limit !== "" ? parseInt(map.trial_traffic_limit, 10) : null,
    serviceName: map.service_name || "STEALTHNET",
    logo: map.logo || null,
    favicon: map.favicon || null,
    remnaClientUrl: map.remna_client_url || null,
    smtpHost: map.smtp_host || null,
    smtpPort: map.smtp_port != null && map.smtp_port !== "" ? parseInt(map.smtp_port, 10) : 587,
    smtpSecure: map.smtp_secure === "true" || map.smtp_secure === "1",
    smtpUser: map.smtp_user || null,
    smtpPassword: map.smtp_password || null,
    smtpFromEmail: map.smtp_from_email || null,
    smtpFromName: map.smtp_from_name || null,
    publicAppUrl: map.public_app_url || null,
    telegramBotToken: map.telegram_bot_token || null,
    telegramBotUsername: map.telegram_bot_username || null,
    plategaMerchantId: map.platega_merchant_id || null,
    plategaSecret: map.platega_secret || null,
    plategaMethods: parsePlategaMethods(map.platega_methods),
    yoomoneyClientId: map.yoomoney_client_id || null,
    yoomoneyClientSecret: map.yoomoney_client_secret || null,
    yoomoneyReceiverWallet: map.yoomoney_receiver_wallet || null,
    yoomoneyNotificationSecret: map.yoomoney_notification_secret || null,
    yookassaShopId: map.yookassa_shop_id || null,
    yookassaSecretKey: map.yookassa_secret_key || null,
    botButtons: parseBotButtons(map.bot_buttons),
    botEmojis: parseBotEmojis(map.bot_emojis),
    botBackLabel: (map.bot_back_label || "◀️ В меню").trim() || "◀️ В меню",
    botMenuTexts: parseBotMenuTexts(map.bot_menu_texts),
    botInnerButtonStyles: parseBotInnerButtonStyles(map.bot_inner_button_styles),
    categoryEmojis: parseCategoryEmojis(map.category_emojis),
    subscriptionPageConfig: map.subscription_page_config ?? null,
    supportLink: (map.support_link ?? "").trim() || null,
    agreementLink: (map.agreement_link ?? "").trim() || null,
    offerLink: (map.offer_link ?? "").trim() || null,
    instructionsLink: (map.instructions_link ?? "").trim() || null,
    themeAccent: (map.theme_accent ?? "").trim() || "default",
    forceSubscribeEnabled: map.force_subscribe_enabled === "true" || map.force_subscribe_enabled === "1",
    forceSubscribeChannelId: (map.force_subscribe_channel_id ?? "").trim() || null,
    forceSubscribeMessage: (map.force_subscribe_message ?? "").trim() || null,
    sellOptionsEnabled: map.sell_options_enabled === "true" || map.sell_options_enabled === "1",
    sellOptionsTrafficEnabled: map.sell_options_traffic_enabled === "true" || map.sell_options_traffic_enabled === "1",
    sellOptionsTrafficProducts: parseSellOptionTrafficProducts(map.sell_options_traffic_products),
    sellOptionsDevicesEnabled: map.sell_options_devices_enabled === "true" || map.sell_options_devices_enabled === "1",
    sellOptionsDevicesProducts: parseSellOptionDeviceProducts(map.sell_options_devices_products),
    sellOptionsServersEnabled: map.sell_options_servers_enabled === "true" || map.sell_options_servers_enabled === "1",
    sellOptionsServersProducts: parseSellOptionServerProducts(map.sell_options_servers_products),
    googleAnalyticsId: (map.google_analytics_id ?? "").trim() || null,
    yandexMetrikaId: (map.yandex_metrika_id ?? "").trim() || null,
    autoBroadcastCron: (map.auto_broadcast_cron ?? "").trim() || null,
  };
}

export type CategoryEmojis = Record<string, string>;

function parseCategoryEmojis(raw: string | undefined): CategoryEmojis {
  if (!raw || !raw.trim()) return { ordinary: "📦", premium: "⭐" };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return { ordinary: "📦", premium: "⭐" };
    const out: CategoryEmojis = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string" && v.trim()) out[k] = v.trim();
    }
    if (Object.keys(out).length === 0) return { ordinary: "📦", premium: "⭐" };
    return out;
  } catch {
    return { ordinary: "📦", premium: "⭐" };
  }
}

export type PlategaMethodConfig = { id: number; enabled: boolean; label: string };
const DEFAULT_PLATEGA_METHODS: PlategaMethodConfig[] = [
  { id: 2, enabled: true, label: "СПБ" },
  { id: 11, enabled: false, label: "Карты" },
  { id: 12, enabled: false, label: "Международный" },
  { id: 13, enabled: false, label: "Криптовалюта" },
];

function parsePlategaMethods(raw: string | undefined): PlategaMethodConfig[] {
  if (!raw || !raw.trim()) return DEFAULT_PLATEGA_METHODS;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return DEFAULT_PLATEGA_METHODS;
    return parsed.map((m: unknown) => {
      const x = m as Record<string, unknown>;
      return {
        id: typeof x.id === "number" ? x.id : Number(x.id) || 2,
        enabled: Boolean(x.enabled),
        label: typeof x.label === "string" ? x.label : String(x.id),
      };
    });
  } catch {
    return DEFAULT_PLATEGA_METHODS;
  }
}

function parseSellOptionTrafficProducts(raw: string | undefined): SellOptionTrafficProduct[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x: unknown): x is Record<string, unknown> => x != null && typeof x === "object")
      .map((x, i) => ({
        id: typeof x.id === "string" ? x.id : `traffic_${i}`,
        name: typeof x.name === "string" ? x.name : `+${x.trafficGb ?? 0} ГБ`,
        trafficGb: typeof x.trafficGb === "number" ? x.trafficGb : Number(x.trafficGb) || 0,
        price: typeof x.price === "number" ? x.price : Number(x.price) || 0,
        currency: typeof x.currency === "string" ? x.currency : "rub",
      }))
      .filter((p) => p.trafficGb > 0 && p.price >= 0);
  } catch {
    return [];
  }
}

function parseSellOptionDeviceProducts(raw: string | undefined): SellOptionDeviceProduct[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x: unknown): x is Record<string, unknown> => x != null && typeof x === "object")
      .map((x, i) => ({
        id: typeof x.id === "string" ? x.id : `devices_${i}`,
        name: typeof x.name === "string" ? x.name : `+${x.deviceCount ?? 0} устр.`,
        deviceCount: typeof x.deviceCount === "number" ? x.deviceCount : Number(x.deviceCount) || 0,
        price: typeof x.price === "number" ? x.price : Number(x.price) || 0,
        currency: typeof x.currency === "string" ? x.currency : "rub",
      }))
      .filter((p) => p.deviceCount > 0 && p.price >= 0);
  } catch {
    return [];
  }
}

function parseSellOptionServerProducts(raw: string | undefined): SellOptionServerProduct[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x: unknown): x is Record<string, unknown> => x != null && typeof x === "object")
      .map((x, i) => ({
        id: typeof x.id === "string" ? x.id : `server_${i}`,
        name: typeof x.name === "string" ? x.name : "Доп. сервер",
        squadUuid: typeof x.squadUuid === "string" ? x.squadUuid : "",
        trafficGb: typeof x.trafficGb === "number" && x.trafficGb >= 0 ? x.trafficGb : (typeof x.trafficGb !== "undefined" ? Number(x.trafficGb) || 0 : 0),
        price: typeof x.price === "number" ? x.price : Number(x.price) || 0,
        currency: typeof x.currency === "string" ? x.currency : "rub",
      }))
      .filter((p) => p.squadUuid.length > 0 && p.price >= 0);
  } catch {
    return [];
  }
}

/** Кнопка для бота: label уже с эмодзи (Unicode) и опционально TG custom emoji ID для премиум-эмодзи */
export type PublicBotButton = { id: string; visible: boolean; label: string; order: number; style?: string; iconCustomEmojiId?: string };

/** Публичный конфиг для сайта/бота (без паролей и секретов). botButtons с подставленными эмодзи. */
export async function getPublicConfig() {
  const full = await getSystemConfig();
  const trialDays = full.trialDays ?? 0;
  const trialEnabled = trialDays > 0 && Boolean(full.trialSquadUuid?.trim());
  const botEmojis = full.botEmojis ?? {};
  const defaultEmojiKeyByButtonId: Record<string, string> = {
    trial: "TRIAL", tariffs: "PACKAGE", profile: "PUZZLE", topup: "CARD", referral: "LINK", vpn: "SERVERS", cabinet: "SERVERS",
  };
  const resolvedButtons: PublicBotButton[] = (full.botButtons ?? []).map((b) => {
    const emojiKey = b.emojiKey ?? defaultEmojiKeyByButtonId[b.id];
    const entry = emojiKey ? botEmojis[emojiKey] : undefined;
    let label = b.label;
    let iconCustomEmojiId: string | undefined;
    if (entry) {
      if (entry.tgEmojiId) iconCustomEmojiId = entry.tgEmojiId;
      if (entry.unicode) label = (entry.unicode + " " + label).trim();
    }
    return { id: b.id, visible: b.visible, label, order: b.order, style: b.style, iconCustomEmojiId };
  });

  const menuTexts = full.botMenuTexts ?? DEFAULT_BOT_MENU_TEXTS;
  const resolvedBotMenuTexts: Record<string, string> = {};
  const menuTextCustomEmojiIds: Record<string, string> = {};
  for (const [k, v] of Object.entries(menuTexts)) {
    let s = String(v ?? "");
    for (const [ek, ev] of Object.entries(botEmojis)) {
      const placeholder = "{{" + ek + "}}";
      if (s.includes(placeholder)) s = s.split(placeholder).join(ev.unicode ?? "").trim();
    }
    resolvedBotMenuTexts[k] = s;
    // Если строка начинается с unicode эмодзи, у которого есть tgEmojiId — передаём ID для entities в сообщении
    for (const [ek, ev] of Object.entries(botEmojis)) {
      if (ev.tgEmojiId && ev.unicode && s.startsWith(ev.unicode)) {
        menuTextCustomEmojiIds[k] = ev.tgEmojiId;
        break;
      }
    }
  }

  return {
    activeLanguages: full.activeLanguages,
    activeCurrencies: full.activeCurrencies,
    defaultLanguage: full.defaultLanguage,
    defaultCurrency: full.defaultCurrency,
    serviceName: full.serviceName,
    logo: full.logo,
    favicon: full.favicon,
    remnaClientUrl: full.remnaClientUrl,
    publicAppUrl: full.publicAppUrl,
    telegramBotUsername: full.telegramBotUsername,
    plategaMethods: full.plategaMethods.filter((m) => m.enabled).map((m) => ({ id: m.id, label: m.label })),
    yoomoneyEnabled: Boolean(full.yoomoneyReceiverWallet?.trim()),
    yookassaEnabled: Boolean(full.yookassaShopId?.trim() && full.yookassaSecretKey?.trim()),
    trialEnabled,
    trialDays,
    botButtons: resolvedButtons,
    botBackLabel: full.botBackLabel,
    botMenuTexts: menuTexts,
    resolvedBotMenuTexts,
    menuTextCustomEmojiIds,
    botEmojis,
    botInnerButtonStyles: full.botInnerButtonStyles ?? DEFAULT_BOT_INNER_BUTTON_STYLES,
    categoryEmojis: full.categoryEmojis,
    defaultReferralPercent: full.defaultReferralPercent ?? 0,
    referralPercentLevel2: full.referralPercentLevel2 ?? 0,
    referralPercentLevel3: full.referralPercentLevel3 ?? 0,
    supportLink: full.supportLink ?? null,
    agreementLink: full.agreementLink ?? null,
    offerLink: full.offerLink ?? null,
    instructionsLink: full.instructionsLink ?? null,
    themeAccent: full.themeAccent ?? "default",
    googleAnalyticsId: full.googleAnalyticsId ?? null,
    yandexMetrikaId: full.yandexMetrikaId ?? null,
    forceSubscribeEnabled: full.forceSubscribeEnabled ?? false,
    forceSubscribeChannelId: full.forceSubscribeChannelId ?? null,
    forceSubscribeMessage: full.forceSubscribeMessage ?? null,
    showProxyEnabled: await prisma.proxyTariff.count({ where: { enabled: true } }).then((n) => n > 0),
    sellOptionsEnabled: (() => {
      const so = full as { sellOptionsEnabled?: boolean; sellOptionsTrafficEnabled?: boolean; sellOptionsTrafficProducts?: unknown[]; sellOptionsDevicesEnabled?: boolean; sellOptionsDevicesProducts?: unknown[]; sellOptionsServersEnabled?: boolean; sellOptionsServersProducts?: unknown[] };
      if (so.sellOptionsEnabled !== true) return false;
      const hasTraffic = so.sellOptionsTrafficEnabled && (so.sellOptionsTrafficProducts?.length ?? 0) > 0;
      const hasDevices = so.sellOptionsDevicesEnabled && (so.sellOptionsDevicesProducts?.length ?? 0) > 0;
      const hasServers = so.sellOptionsServersEnabled && (so.sellOptionsServersProducts?.length ?? 0) > 0;
      return hasTraffic || hasDevices || hasServers;
    })(),
    sellOptions: (() => {
      const so = full as {
        sellOptionsEnabled?: boolean;
        sellOptionsTrafficEnabled?: boolean;
        sellOptionsTrafficProducts?: SellOptionTrafficProduct[];
        sellOptionsDevicesEnabled?: boolean;
        sellOptionsDevicesProducts?: SellOptionDeviceProduct[];
        sellOptionsServersEnabled?: boolean;
        sellOptionsServersProducts?: SellOptionServerProduct[];
      };
      if (!so.sellOptionsEnabled) return [];
      const out: Array<
        { kind: "traffic"; id: string; name: string; trafficGb: number; price: number; currency: string } |
        { kind: "devices"; id: string; name: string; deviceCount: number; price: number; currency: string } |
        { kind: "servers"; id: string; name: string; squadUuid: string; trafficGb: number; price: number; currency: string }
      > = [];
      if (so.sellOptionsTrafficEnabled && so.sellOptionsTrafficProducts?.length) {
        for (const p of so.sellOptionsTrafficProducts) {
          out.push({ kind: "traffic", id: p.id, name: p.name, trafficGb: p.trafficGb, price: p.price, currency: p.currency });
        }
      }
      if (so.sellOptionsDevicesEnabled && so.sellOptionsDevicesProducts?.length) {
        for (const p of so.sellOptionsDevicesProducts) {
          out.push({ kind: "devices", id: p.id, name: p.name, deviceCount: p.deviceCount, price: p.price, currency: p.currency });
        }
      }
      if (so.sellOptionsServersEnabled && so.sellOptionsServersProducts?.length) {
        for (const p of so.sellOptionsServersProducts) {
          out.push({ kind: "servers", id: p.id, name: p.name, squadUuid: p.squadUuid, trafficGb: p.trafficGb ?? 0, price: p.price, currency: p.currency });
        }
      }
      return out;
    })(),
  };
}
