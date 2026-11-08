import { createHash } from "node:crypto";
import { InputFile } from "grammy";
import type { Context } from "grammy";
import type { Api } from "grammy";
import * as api from "../api.js";
import { DeviceFlow } from "../device-flow.js";
import { titleEmojiPrefix } from "../title-emoji.js";
import { renewableSubscriptions, connectableSubscriptions, directConnectionTarget } from "../subscription-actions.js";
import {
  mainMenu,
  backToMenu,
  deviceFlowButtons,
  backToSubLabel,
  backToSubsListLabel,
  backButton,
  supportSubMenu,
  helpMainMenu,
  documentsSubMenu,
  topUpPresets,
  tariffPayButtons,
  tariffsOfCategoryButtons,
  tariffCategoryButtons,
  tariffPaymentMethodButtons,
  tariffOptionPickerButtons,
  tariffDevicePickerButtons,
  type InnerButtonStyles,
  proxyTariffPayButtons,
  proxyTariffsOfCategoryButtons,
  proxyCategoryButtons,
  proxyPaymentMethodButtons,
  singboxTariffPayButtons,
  singboxTariffsOfCategoryButtons,
  singboxPaymentMethodButtons,
  topupPaymentMethodButtons,
  payUrlMarkup,
  profileButtons,
  extraOptionsButtons,
  optionPaymentMethodButtons,
  langButtons,
  currencyButtons,
  trialConfirmButton,
  openSubscribePageMarkup,
  giftMenuButtons,
  giftSubscriptionButtons,
  giftCodeResultButtons,
  giftPostPurchaseButtons,
  giftCodesListButtons,
  giftTariffButtons,
  giftPaymentButtons,
  mySubsListButtons,
  subDetailButtons,
  tariffActionChoiceButtons,
  type InlineMarkup,
  type InnerEmojiIds,
} from "../keyboard.js";
import { t as _t, formatDays as _formatDays, setTranslations } from "../i18n.js";
import {
  storePendingReceipt,
  peekPendingReceipt,
  takePendingReceipt,
  setPendingEmailInput,
  takePendingEmailInput,
  hasPendingEmailInput,
  receiptPromptText,
  receiptPromptKeyboard,
  EMAIL_PROMPT_TEXT,
  RECEIPT_OK_LINE,
  isValidEmail,
} from "../yk-receipt.js";
import { isSubscriptionCached, cacheSubscription, userLangCache, tokenStore, activeDiscountCode, selectedTariffOption, trialReplaceChoice, awaitingPromoCode, awaitingGiftCode, awaitingWithdrawAmount, awaitingWithdrawDetails, awaitingCustomTopup, awaitingAdminSearch, lastAdminSearch, awaitingAdminBalance, awaitingBroadcastMessage, lastBroadcastMessage, lastSquadsForAdd, lastSquadsForRemove, tariffOptionsCache, selectedGiftOption, giftOptionsCache, addsubPending, extendingSecondaryPending, pendingDropExtras, extraOptionTargetSub, extraOptionPending, trialConvertPickCache, convDropExtras, type DiscountInfo, type BroadcastPayload } from "../state-store.js";
export * from "../keyboard.js";
export { t as _t, formatDays as _formatDays, setTranslations } from "../i18n.js";
export { DeviceFlow, formatDeviceCount, subscriptionDeviceLimit } from "../device-flow.js";
export { referralRewardLines } from "../referral-rewards.js";
export { renewableSubscriptions, connectableSubscriptions, directConnectionTarget } from "../subscription-actions.js";
export { shouldShowPurchaseChoice } from "../purchase-choice.js";
export { storePendingReceipt, peekPendingReceipt, takePendingReceipt, setPendingEmailInput, takePendingEmailInput, hasPendingEmailInput, receiptPromptText, receiptPromptKeyboard, EMAIL_PROMPT_TEXT, RECEIPT_OK_LINE, isValidEmail } from "../yk-receipt.js";

export function formatRuDays(n: number): string {
  return _formatDays(n, "ru");
}

export function setUserLang(userId: number, lang: string) {
  userLangCache.set(userId, lang);
}

export function getUserLang(userId: number): string {
  return userLangCache.get(userId) ?? "ru";
}

export type SubscriptionCheckState = "subscribed" | "not_subscribed" | "cannot_verify";

export type ForceChannelTarget = {
  chatId: string | null;
  joinUrl: string | null;
};

export function parseForceChannelTarget(channelInput: string): ForceChannelTarget {
  const raw = channelInput.trim();
  if (!raw) return { chatId: null, joinUrl: null };

  const looksLikeUrl = /^https?:\/\//i.test(raw) || /^t\.me\//i.test(raw);
  if (looksLikeUrl) {
    const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      const u = new URL(candidate);
      const hostOk = u.hostname === "t.me" || u.hostname.endsWith(".t.me");
      const path = u.pathname.replace(/^\/+|\/+$/g, "");
      if (hostOk && path) {
        if (path.startsWith("c/")) {
          const idPart = path.slice(2).split("/")[0];
          if (/^\d+$/.test(idPart)) {
            return { chatId: `-100${idPart}`, joinUrl: candidate };
          }
        }
        if (path.startsWith("+") || path.startsWith("joinchat/")) {
          return { chatId: null, joinUrl: candidate };
        }
        const uname = path.split("/")[0];
        if (/^[a-zA-Z0-9_]{5,}$/.test(uname)) {
          return { chatId: `@${uname}`, joinUrl: `https://t.me/${uname}` };
        }
      }
    } catch {
      // fallthrough
    }
  }

  if (raw.startsWith("@")) {
    const uname = raw.slice(1);
    if (/^[a-zA-Z0-9_]{5,}$/.test(uname)) {
      return { chatId: `@${uname}`, joinUrl: `https://t.me/${uname}` };
    }
  }

  if (/^[a-zA-Z0-9_]{5,}$/.test(raw)) {
    return { chatId: `@${raw}`, joinUrl: `https://t.me/${raw}` };
  }

  if (/^-?\d+$/.test(raw)) {
    const joinUrl = raw.startsWith("-100") ? `https://t.me/c/${raw.slice(4)}` : null;
    return { chatId: raw, joinUrl };
  }

  return { chatId: null, joinUrl: null };
}

function telegramErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isTransientTelegramError(error: unknown): boolean {
  const candidate = error as { error_code?: unknown; code?: unknown; message?: unknown; description?: unknown } | null;
  const errorCode = typeof candidate?.error_code === "number" ? candidate.error_code : 0;
  if (errorCode >= 500) return true;
  const code = typeof candidate?.code === "string" ? candidate.code.toUpperCase() : "";
  if (["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "ENETUNREACH"].includes(code)) return true;
  const text = `${typeof candidate?.message === "string" ? candidate.message : ""} ${typeof candidate?.description === "string" ? candidate.description : ""}`.toLowerCase();
  return /network request|fetch failed|timed? ?out|socket hang up|econnreset|etimedout|eai_again|und_err/.test(text);
}

function isNotParticipantError(error: unknown): boolean {
  const candidate = error as { message?: unknown; description?: unknown } | null;
  const text = `${typeof candidate?.message === "string" ? candidate.message : ""} ${typeof candidate?.description === "string" ? candidate.description : ""}`.toLowerCase();
  return /user_not_participant|user not found|participant_id_invalid|chat member not found/.test(text);
}

/** Проверяет, подписан ли пользователь на указанный канал/группу. */
export async function checkUserSubscription(
  telegramApi: Api,
  userId: number,
  channelInput: string,
): Promise<{ state: SubscriptionCheckState; target: ForceChannelTarget; error?: string }> {
  const target = parseForceChannelTarget(channelInput);
  if (!target.chatId) {
    return { state: "cannot_verify", target, error: "invalid_channel_id" };
  }
  if (isSubscriptionCached(userId)) {
    return { state: "subscribed", target };
  }
  let lastError = "";
  let lastWasTransient = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const member = await telegramApi.getChatMember(target.chatId, userId);
      if (["member", "administrator", "creator", "restricted"].includes(member.status)) {
        cacheSubscription(userId);
        return { state: "subscribed", target };
      }
      return { state: "not_subscribed", target };
    } catch (e: unknown) {
      lastError = telegramErrorMessage(e);
      if (isNotParticipantError(e)) {
        return { state: "not_subscribed", target };
      }
      lastWasTransient = isTransientTelegramError(e);
      if (!lastWasTransient || attempt === 2) break;
      await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 300 : 600));
    }
  }
  if (lastWasTransient) {
    console.warn("getChatMember network error after retries:", lastError);
  } else {
    console.warn("getChatMember error:", lastError, { channelInput, parsedChatId: target.chatId });
  }
  return { state: "cannot_verify", target, error: lastError };
}

export function subscribeKeyboard(channelInput: string, lang = "ru"): InlineMarkup {
  const target = parseForceChannelTarget(channelInput);
  const rows: InlineMarkup["inline_keyboard"] = [];
  if (target.joinUrl) {
    rows.push([{ text: _t("subscribe.channel_button", lang), url: target.joinUrl }]);
  }
  rows.push([{ text: _t("subscribe.check_button", lang), callback_data: "check_subscribe" }]);
  return { inline_keyboard: rows };
}

/**
 * Проверяет подписку и, если не подписан, отправляет/редактирует сообщение.
 * Возвращает true если НЕ подписан (нужно прервать обработку).
 */
export async function enforceSubscription(
  ctx: {
    from?: { id: number };
    // #78: тип чата нужен, чтобы не проверять подписку для сообщений не из лички
    chat?: { type?: string };
    reply: (text: string, opts?: { reply_markup?: InlineMarkup }) => Promise<unknown>;
    api: Api;
  },
  config: Awaited<ReturnType<typeof api.getPublicConfig>>,
): Promise<boolean> {
  // #78: бот для пользователей работает только в личке — сообщения из каналов/групп
  // (например, ответы админа в «Сообщения каналу») не проверяем
  if (ctx.chat && ctx.chat.type !== "private") return false;
  if (!config?.forceSubscribeEnabled) return false;
  const channelId = config.forceSubscribeChannelId?.trim();
  if (!channelId) return false;
  const userId = ctx.from?.id;
  if (!userId) return false;
  const lang = getUserLang(userId);
  const result = await checkUserSubscription(ctx.api, userId, channelId);
  if (result.state === "subscribed") return false;
  const msg = config.forceSubscribeMessage?.trim() || _t("subscribe.default_message", lang);
  if (result.state === "cannot_verify") {
    await ctx.reply(
      `⚠️ ${msg}\n\n${_t("subscribe.cannot_verify", lang)}`,
      { reply_markup: subscribeKeyboard(channelId, lang) }
    );
    return true;
  }
  await ctx.reply(`⚠️ ${msg}`, { reply_markup: subscribeKeyboard(channelId, lang) });
  return true;
}

export type TariffPriceOption = { id: string; durationDays: number; price: number; sortOrder: number };
export type DeviceDiscountTier = { minExtraDevices: number; discountPercent: number };
export type TariffItem = {
  id: string;
  name: string;
  description?: string | null;
  durationDays: number;
  trafficLimitBytes?: number | null;
  trafficResetMode?: string;
  deviceLimit?: number | null;
  includedDevices?: number;
  pricePerExtraDevice?: number;
  maxExtraDevices?: number;
  deviceDiscountTiers?: DeviceDiscountTier[];
  price: number;
  currency: string;
  // T11+T12 (11.05.2026) — rich-text список локаций тарифа.
  locations?: string | null;
  priceOptions?: TariffPriceOption[];
};

/**
 * Цена пакета доп. устройств с учётом длительности.
 * pricePerExtra указан за 30 дней (база). Для других опций умножаем на (days/30).
 * Формула: extrasTotal = pricePerExtra × extras × (100 − discount) / 100 × (durationDays / 30)
 */
export const EXTRA_DEVICE_BASE_DAYS = 30;
export function applyExtraDevicesPriceBot(
  pricePerExtra: number,
  extraCount: number,
  tiers: DeviceDiscountTier[] | undefined,
  durationDays: number = EXTRA_DEVICE_BASE_DAYS,
): { extrasTotal: number; pct: number } {
  const safeCount = Math.max(0, Math.floor(extraCount));
  if (safeCount === 0 || pricePerExtra <= 0) return { extrasTotal: 0, pct: 0 };
  const sorted = [...(tiers ?? [])].sort((a, b) => b.minExtraDevices - a.minExtraDevices);
  const tier = sorted.find((t) => safeCount >= t.minExtraDevices);
  const pct = tier?.discountPercent ?? 0;
  const safeDays = Math.max(1, durationDays);
  const monthly = pricePerExtra * safeCount * (100 - pct) / 100;
  const extrasTotal = Math.round(monthly * (safeDays / EXTRA_DEVICE_BASE_DAYS) * 100) / 100;
  return { extrasTotal, pct };
}

/** Включена ли продажа доп. устройств для тарифа. */
export function hasExtraDevices(t: TariffItem): boolean {
  return (t.pricePerExtraDevice ?? 0) > 0 && (t.maxExtraDevices ?? 0) > 0;
}

export async function checkoutExtraDeviceCap(
  token: string,
  tariff: TariffItem,
  targetSubscriptionId?: string | null,
  asAdditional = false,
): Promise<number> {
  const maximum = Math.max(0, tariff.maxExtraDevices ?? 0);
  if (maximum <= 0) return 0;
  if (asAdditional) return maximum;
  try {
    const { items } = await api.getAllSubscriptions(token);
    const subs = items ?? [];
    let targetId = targetSubscriptionId ?? null;
    if (!targetId) {
      const matching = renewableSubscriptions(subs, tariff.id);
      targetId = (matching.find((it) => it.subscriptionIndex === 0) ?? matching[0])?.id ?? null;
    }
    const target = targetId ? subs.find((it) => it.id === targetId) : null;
    return Math.max(0, maximum - (target?.extraDevices ?? 0));
  } catch {
    return maximum;
  }
}

/**
 * Помечает каждый тариф флагом `hasOptions` для отображения «от» в кнопках.
 * "от" показывается если: несколько priceOptions ИЛИ включены доп. устройства.
 */
export function markHasOptions<T extends { tariffs: TariffItem[] }>(categories: T[]): (T & { tariffs: (TariffItem & { hasOptions: boolean })[] })[] {
  return categories.map((c) => ({
    ...c,
    tariffs: c.tariffs.map((t) => ({
      ...t,
      hasOptions: (t.priceOptions?.length ?? 0) > 1 || hasExtraDevices(t),
    })),
  }));
}
export type TariffCategory = { id: string; name: string; emoji?: string; emojiKey?: string | null; singleSubscriptionMode?: boolean; tariffs: TariffItem[] };

/**
 * Сортировка опций цен. Опции с durationDays > 0 идут по sortOrder, затем по durationDays.
 * Возвращает копию массива (не мутирует оригинал).
 */
export function sortedPriceOptions(options: TariffPriceOption[] | undefined | null): TariffPriceOption[] {
  if (!options || options.length === 0) return [];
  return [...options].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.durationDays - b.durationDays;
  });
}

/** Опция с лучшей ценой за день (для пометки эмодзи). Возвращает id или null. */
export function bestPricePerDayOptionId(options: TariffPriceOption[]): string | null {
  if (options.length <= 1) return null;
  let bestId: string | null = null;
  let bestPerDay = Number.POSITIVE_INFINITY;
  for (const o of options) {
    if (o.durationDays <= 0) continue;
    const perDay = o.price / o.durationDays;
    if (perDay < bestPerDay) {
      bestPerDay = perDay;
      bestId = o.id;
    }
  }
  return bestId;
}

/** Кэш списка priceOptions тарифа для пользователя — для разрешения индекса из callback_data. */
// «addsub» mode — userId → tariffId, выставляется когда пользователь
// в category-aware диалоге выбрал «Купить как доп. подписку» (callback `pay_tariff:<id>:add`).
// Читается в pay_<provider>: handlers — если совпадает tariffId, передаём asAdditional=true
// в create<Provider>Payment, и на webhook'е activateTariffByPaymentId создаст secondary
// subscription через createAdditionalSubscription. Для balance — переключается на
// buyGiftSubscription напрямую (без webhook). Чистится при успешной оплате и при
// возврате в menu:main / menu:tariffs.
export function getToken(userId: number): string | undefined {
  return tokenStore.get(userId);
}

export function setToken(userId: number, token: string): void {
  tokenStore.set(userId, token);
}

/**
 * Получить токен пользователя. Если токен отсутствует (рестарт бота, протух и т.д.),
 * автоматически переавторизует через registerByTelegram и возвращает свежий токен.
 */
export async function getOrRestoreToken(userId: number, username?: string): Promise<string | null> {
  const existing = tokenStore.get(userId);
  if (existing) return existing;
  try {
    const config = await api.getPublicConfig();
    if (config?.translations) setTranslations(config.translations);
    const auth = await api.registerByTelegram({
      telegramId: String(userId),
      telegramUsername: username,
      preferredLang: config?.defaultLanguage ?? "ru",
      preferredCurrency: config?.defaultCurrency ?? "usd",
    });
    tokenStore.set(userId, auth.token);
    if (auth.client?.preferredLang) setUserLang(userId, auth.client.preferredLang);
    return auth.token;
  } catch {
    return null;
  }
}

// Пользователи, ожидающие ввода промокода
export async function tryAutoDeleteUnknown(ctx: Context): Promise<void> {
  try {
    const config = await api.getPublicConfig();
    if (!config?.botAutoDeleteUnknownMessages) return;
    await ctx.deleteMessage().catch(() => {});
  } catch { /* не критично */ }
}

/** Достаём subscriptionUrl из ответа Remna */
export function getSubscriptionUrl(sub: unknown): string | null {
  if (!sub || typeof sub !== "object") return null;
  const o = sub as Record<string, unknown>;
  const resp = o.response ?? o.data;
  if (resp && typeof resp === "object") {
    const r = resp as Record<string, unknown>;
    const url = r.subscriptionUrl ?? r.subscription_url;
    if (typeof url === "string" && url.trim()) return url.trim();
  }
  if (typeof o.subscriptionUrl === "string" && o.subscriptionUrl.trim()) return o.subscriptionUrl.trim();
  return null;
}

/** Достаём объект пользователя из ответа Remna (response или data или сам объект) */
export function getSubUser(sub: unknown): Record<string, unknown> | null {
  if (!sub || typeof sub !== "object") return null;
  const o = sub as Record<string, unknown>;
  const resp = o.response ?? o.data ?? o;
  const r = typeof resp === "object" && resp !== null ? (resp as Record<string, unknown>) : null;
  if (r && (r.user != null || r.expireAt != null || r.subscriptionUrl != null)) {
    const user = r.user;
    return (typeof user === "object" && user !== null ? user : r) as Record<string, unknown>;
  }
  return r;
}

export function bytesToGb(bytes: number): string {
  return (bytes / (1024 * 1024 * 1024)).toFixed(2);
}

/** Прогресс-бар из символов (0..1), длина barLen */
export function progressBar(pct: number, barLen: number): string {
  const filled = Math.round(Math.max(0, Math.min(1, pct)) * barLen);
  return "█".repeat(filled) + "░".repeat(barLen - filled);
}

// подсказка под ссылкой подписки.
// Редактируется в админке (Тексты бота → bot_instruction_fallback_text). Этот дефолт
// используется если настройка пустая. Хелпер ниже подставляет текст из конфига или дефолт.
export const DEFAULT_INSTRUCTION_FALLBACK =
  "💡 Если инструкции не открываются: скопируйте ссылку подписки и вставьте её в приложение Happ вручную или обратитесь в поддержку.";
export function instructionFallbackText(cfg: { botInstructionFallbackText?: string | null } | null | undefined): string {
  return (cfg?.botInstructionFallbackText ?? "").trim() || DEFAULT_INSTRUCTION_FALLBACK;
}

export const DEFAULT_MENU_TEXTS: Record<string, string> = {
  // маркетинговый welcome — весь текст в одной мульти-строке.
  // Остальные строки (welcomeTitlePrefix, balance/tariff/status/expire/...) скрыты по
  // умолчанию через DEFAULT_MENU_LINE_VISIBILITY — админ-конфиг может их вернуть точечно.
  welcomeTitlePrefix: "🛡 ",
  welcomeGreeting: [
    "🌐 Большой выбор локаций",
    "🎥 YouTube на высокой скорости без рекламы",
    "👥 Выгодная реферальная программа",
  ].join("\n"),
  balancePrefix: "💰 Ваш Баланс: ",
  telegramIdPrefix: "🆔 Telegram ID: ",
  tariffPrefix: "💎 Ваш тариф : ",
  subscriptionPrefix: "{{CHART}} Статус подписки — ",
  statusInactive: "{{STATUS_INACTIVE}} Истекла",
  statusActive: "{{STATUS_ACTIVE}} Активна",
  statusExpired: "{{STATUS_EXPIRED}} Истекла",
  statusLimited: "{{STATUS_LIMITED}} Ограничена",
  statusDisabled: "{{STATUS_DISABLED}} Отключена",
  expirePrefix: "📅 до ",
  daysLeftPrefix: "⏰ осталось ",
  devicesLabel: "📱 Устройств: ",
  devicesAvailable: " доступно",
  trafficPrefix: "📈 Трафик — ",
  linkLabel: "🔗 Ссылка подключения:",
  chooseAction: "Выберите действие:",
  subsCountLabel: "🔢 Подписок: ",
  subLineFormat: "{{SUB_STATUS}} {{SUB_TYPE}} Подписка #{{SUB_NUM}} — **{{SUB_DAYS}}** до {{SUB_DATE}}{{SUB_TRAFFIC}}",
};

// дефолтная видимость строк welcome-меню.
// Маркетинговый шаблон в welcomeGreeting уже содержит все нужные инструкции,
// поэтому дублирующие info-строки (баланс/тариф/статус/дни/устройства/трафик/ссылка/CTA)
// скрыты по умолчанию. Админ может включить их обратно через
// SystemSetting → Bot → menuLineVisibility[key] = true.
export const DEFAULT_MENU_LINE_VISIBILITY: Record<string, boolean> = {
  welcomeTitlePrefix: false,
  balancePrefix: false,
  telegramIdPrefix: true,
  tariffPrefix: false,
  subscriptionPrefix: false,
  expirePrefix: false,
  daysLeftPrefix: false,
  devicesLabel: false,
  trafficPrefix: false,
  linkLabel: false,
  chooseAction: false,
};

export const DEFAULT_TARIFFS_TEXT = "Тарифы\n\n{{CATEGORY}}\n{{TARIFFS}}\n\nВыберите тариф для оплаты:";
export const DEFAULT_PAYMENT_TEXT = "Оплата: {{NAME}} — {{PRICE}}\n\n{{ACTION}}";

export type BotTariffLineFields = {
  name?: boolean;
  durationDays?: boolean;
  price?: boolean;
  currency?: boolean;
  trafficLimit?: boolean;
  trafficResetMode?: boolean;
  deviceLimit?: boolean;
};

export const DEFAULT_TARIFF_LINE_FIELDS: Required<BotTariffLineFields> = {
  name: true,
  durationDays: false,
  price: true,
  currency: true,
  trafficLimit: false,
  trafficResetMode: false,
  deviceLimit: false,
};

export function formatDaysRu(days: number): string {
  const full = _formatDays(days, "ru");
  return full.replace(/^\d+\s*/, "");
}

export const RESET_MODE_LABELS: Record<string, string> = {
  no_reset: "",
  on_purchase: "сброс при покупке",
  monthly: "сброс ежемесячно",
  monthly_rolling: "скользящий месяц",
};

/**
 * единая точка маппинга currency-кода в символ.
 * Используется в formatTariffLine и в proxy/singbox fallback-строках, чтобы в боте
 * везде показывалось «₽» вместо «rub» / «RUB» / «руб». Mirrors keyboard.ts:currencySymbol.
 */
export function currencySymbol(currency: string): string {
  const c = (currency || "").toUpperCase();
  return c === "RUB" ? "₽" : c === "USD" ? "$" : c === "UAH" ? "₴" : c === "EUR" ? "€" : c;
}

export function formatTariffLine(tariff: TariffItem, fields: Required<BotTariffLineFields>): string {
  const parts: string[] = [];
  const opts = sortedPriceOptions(tariff.priceOptions);
  const multi = opts.length > 1;
  // Минимальная цена и минимальная длительность среди опций (для приставки «от»).
  const minPrice = multi ? opts.reduce((m, o) => (o.price < m ? o.price : m), opts[0]!.price) : tariff.price;
  const minDays = multi ? opts.reduce((m, o) => (o.durationDays < m ? o.durationDays : m), opts[0]!.durationDays) : tariff.durationDays;
  if (fields.name) parts.push(tariff.name);
  if (fields.durationDays) {
    const prefix = multi ? "от " : "";
    parts.push(`${prefix}${minDays} ${formatDaysRu(minDays)}`);
  }
  if (fields.price) {
    const prefix = multi ? "от " : "";
    const pricePart = fields.currency ? `${prefix}${minPrice} ${currencySymbol(tariff.currency)}` : `${prefix}${minPrice}`;
    parts.push(pricePart);
  } else if (fields.currency) {
    parts.push(`${currencySymbol(tariff.currency)}`);
  }
  if (fields.trafficLimit) {
    const limit = tariff.trafficLimitBytes;
    parts.push(limit == null ? "трафик без лимита" : `трафик ${bytesToGb(limit)} GB`);
  }
  if (fields.trafficResetMode) {
    const label = RESET_MODE_LABELS[tariff.trafficResetMode ?? "no_reset"];
    if (label) parts.push(label);
  }
  if (fields.deviceLimit) {
    const limit = tariff.deviceLimit;
    parts.push(limit == null ? "устройства без лимита" : `устройства ${limit}`);
  }
  if (!parts.length) return `• ${tariff.name}`;
  return `• ${parts.join(" — ")}`;
}

export function renderTariffsText(template: string, category: string, tariffLines: string): string {
  const rendered = template
    .split("{{CATEGORY}}").join(category)
    .split("{{TARIFFS}}").join(tariffLines);
  // автозамена математического знака бесконечности (U+221E)
  // на полноценный emoji «♾️» (U+267E + VS16). Иначе в Telegram «∞» отображается
  // тонким моноширинным символом — клиенты ожидают яркий emoji-бесконечность.
  return rendered.replace(/∞/g, "♾️");
}

export function renderPaymentText(
  template: string,
  vars: { name: string; price: string; amount: string; currency: string; action: string }
): string {
  return template
    .split("{{NAME}}").join(vars.name)
    .split("{{PRICE}}").join(vars.price)
    .split("{{AMOUNT}}").join(vars.amount)
    .split("{{CURRENCY}}").join(vars.currency)
    .split("{{ACTION}}").join(vars.action);
}

export function buildPaymentMessage(
  config: Awaited<ReturnType<typeof api.getPublicConfig>> | null | undefined,
  vars: { name: string; price: string; amount: string; currency: string; action: string },
  discount?: { originalPrice: string; discountedPrice: string }
): { text: string; entities: CustomEmojiEntity[] } {
  const priceDisplay = discount
    ? `${discount.originalPrice} → ${discount.discountedPrice}`
    : vars.price;
  const template = (config?.botPaymentText ?? "").trim() || DEFAULT_PAYMENT_TEXT;
  const base = renderPaymentText(template, { ...vars, price: priceDisplay });
  const result = applyCustomEmojiPlaceholders(base, config?.botEmojis);
  if (discount) {
    const pos = result.text.indexOf(priceDisplay);
    if (pos >= 0) {
      result.entities.push(
        { type: "strikethrough", offset: pos, length: discount.originalPrice.length },
        { type: "bold", offset: pos + discount.originalPrice.length + 3, length: discount.discountedPrice.length },
      );
    }
  }
  return result;
}

export function t(texts: Record<string, string> | null | undefined, key: string): string {
  return (texts?.[key] ?? DEFAULT_MENU_TEXTS[key]) || "";
}

export type CustomEmojiEntity =
  | { type: "custom_emoji"; offset: number; length: number; custom_emoji_id: string }
  | { type: "strikethrough"; offset: number; length: number }
  | { type: "bold"; offset: number; length: number }
  // моноширинный текст — копируется по тапу в Telegram.
  | { type: "code"; offset: number; length: number };

/** Длина первого символа в UTF-16 (для entity) */
export function firstCharLengthUtf16(s: string): number {
  if (!s.length) return 0;
  const cp = s.codePointAt(0);
  return cp != null && cp > 0xffff ? 2 : 1;
}

export const DEFAULT_EMOJI_UNICODE: Record<string, string> = {
  PACKAGE: "📦", TARIFFS: "📦", CARD: "💳", LINK: "🔗", PUZZLE: "👤", PROFILE: "👤",
  TRIAL: "🎁", SERVERS: "🌐", CONNECT: "🌐",
  CHART: "📊",
  STATUS_ACTIVE: "🟡", STATUS_EXPIRED: "🔴", STATUS_INACTIVE: "🔴",
  STATUS_LIMITED: "🟡", STATUS_DISABLED: "🔴",
};
export const DEFAULT_CUSTOM_EMOJI_CHAR = "🙂";

export const DEFAULT_MENU_EMOJI_KEY_BY_ID: Record<string, string> = {
  tariffs: "PACKAGE",
  proxy: "SERVERS",
  my_proxy: "SERVERS",
  singbox: "SERVERS",
  my_singbox: "SERVERS",
  profile: "PUZZLE",
  devices: "DEVICES",
  topup: "CARD",
  referral: "LINK",
  trial: "TRIAL",
  vpn: "SERVERS",
  cabinet: "SERVERS",
  support: "NOTE",
  tickets: "NOTE",
  promocode: "STAR",
  extra_options: "PACKAGE",
};

export function getMenuEmojiKey(
  config: Awaited<ReturnType<typeof api.getPublicConfig>> | null | undefined,
  menuId: string
): string | null | undefined {
  const btn = config?.botButtons?.find((b) => b.id === menuId);
  if (btn && btn.emojiKey === "") return null;
  return btn?.emojiKey || DEFAULT_MENU_EMOJI_KEY_BY_ID[menuId];
}

/** Заголовок с эмодзи: если в botEmojis есть tgEmojiId для ключа — добавляем entity (премиум-эмодзи в тексте). */
export function titleWithEmoji(
  emojiKey: string,
  rest: string,
  botEmojis?: Record<string, { unicode?: string; tgEmojiId?: string }> | null
): { text: string; entities: CustomEmojiEntity[] } {
  // если body уже начинается с эмодзи (хардкод в коде
  // или юзер в шаблоне написал эмодзи) — не добавляем дополнительный префикс,
  // иначе получаются дубли вида «👥 👥 Реферальная программа».
  if (/^\p{Extended_Pictographic}/u.test(rest.trimStart())) {
    return { text: rest, entities: [] };
  }
  const prefix = titleEmojiPrefix(emojiKey, botEmojis, DEFAULT_EMOJI_UNICODE);
  const space = rest.startsWith("\n") ? "" : " ";
  return { text: prefix.text + space + rest, entities: prefix.entities };
}

/**
 * расширенный парсер текста меню — поддерживает И custom-emoji
 * placeholder'ы `{{KEY}}` (как applyCustomEmojiPlaceholders), И markdown-жирный
 * `**слово**`. Используется в pushLine/pushRaw (buildMainMenuText), чтобы админ
 * мог пометить «» жирным через шаблон welcomeGreeting.
 *
 * Single-pass char-iterator (не regex), поэтому offset'ы entity всегда корректны.
 * Внутри `**...**` рекурсивно прогоняется через ту же функцию — поддерживает
 * вложенные placeholder'ы внутри жирного.
 */
export function applyMarkdownAndEmoji(
  rawText: string,
  botEmojis?: Record<string, { unicode?: string; tgEmojiId?: string }> | null
): { text: string; entities: CustomEmojiEntity[] } {
  if (!rawText) return { text: "", entities: [] };
  const entities: CustomEmojiEntity[] = [];
  let out = "";
  let i = 0;
  const n = rawText.length;
  while (i < n) {
    // {{KEY}} — emoji placeholder
    if (rawText[i] === "{" && rawText[i + 1] === "{") {
      const end = rawText.indexOf("}}", i + 2);
      if (end > i + 2) {
        const key = rawText.slice(i + 2, end);
        if (/^[A-Z0-9_]+$/.test(key)) {
          const entry = botEmojis?.[key];
          const fallbackUnicode = DEFAULT_EMOJI_UNICODE[key];
          const unicode = entry?.unicode?.trim() || (entry?.tgEmojiId ? DEFAULT_CUSTOM_EMOJI_CHAR : "") || fallbackUnicode || "";
          if (unicode) {
            const off = out.length;
            out += unicode;
            if (entry?.tgEmojiId) {
              entities.push({ type: "custom_emoji", offset: off, length: unicode.length, custom_emoji_id: entry.tgEmojiId });
            }
            i = end + 2;
            continue;
          }
        }
      }
    }
    // **text** — bold markdown
    if (rawText[i] === "*" && rawText[i + 1] === "*") {
      const end = rawText.indexOf("**", i + 2);
      if (end > i + 2) {
        const inner = rawText.slice(i + 2, end);
        const innerProcessed = applyMarkdownAndEmoji(inner, botEmojis);
        const off = out.length;
        for (const e of innerProcessed.entities) {
          entities.push({ ...e, offset: off + e.offset });
        }
        entities.push({ type: "bold", offset: off, length: innerProcessed.text.length });
        out += innerProcessed.text;
        i = end + 2;
        continue;
      }
    }
    // `code` — моноширинный текст. В Telegram такой
    // текст копируется по одному тапу («tap to copy»). Используется для Telegram ID в «Помощи».
    if (rawText[i] === "`") {
      const end = rawText.indexOf("`", i + 1);
      if (end > i + 1) {
        const inner = rawText.slice(i + 1, end);
        const off = out.length;
        entities.push({ type: "code", offset: off, length: inner.length });
        out += inner;
        i = end + 1;
        continue;
      }
    }
    out += rawText[i];
    i++;
  }
  return { text: out, entities };
}

export function applyCustomEmojiPlaceholders(
  text: string,
  botEmojis?: Record<string, { unicode?: string; tgEmojiId?: string }> | null
): { text: string; entities: CustomEmojiEntity[] } {
  if (!text) return { text, entities: [] };
  const entities: CustomEmojiEntity[] = [];
  const re = /\{\{([A-Z0-9_]+)\}\}/g;
  let out = "";
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const key = match[1]!;
    out += text.slice(lastIdx, match.index);
    const entry = botEmojis?.[key];
    const fallbackUnicode = DEFAULT_EMOJI_UNICODE[key];
    const unicode = entry?.unicode?.trim() || (entry?.tgEmojiId ? DEFAULT_CUSTOM_EMOJI_CHAR : "") || fallbackUnicode || "";
    if (unicode) {
      const offset = out.length;
      out += unicode;
      if (entry?.tgEmojiId) {
        entities.push({ type: "custom_emoji", offset, length: unicode.length, custom_emoji_id: entry.tgEmojiId });
      }
    } else {
      out += match[0];
    }
    lastIdx = match.index + match[0].length;
  }
  out += text.slice(lastIdx);
  return { text: out, entities };
}

export function titleWithEmojiAndCustomEmojis(
  emojiKey: string,
  rest: string,
  botEmojis?: Record<string, { unicode?: string; tgEmojiId?: string }> | null
): { text: string; entities: CustomEmojiEntity[] } {
  const prefix = titleEmojiPrefix(emojiKey, botEmojis, DEFAULT_EMOJI_UNICODE);
  const space = rest.startsWith("\n") ? "" : " ";
  const leading = prefix.text + space;
  const { text: restText, entities: restEntities } = applyCustomEmojiPlaceholders(rest, botEmojis);
  const entities: CustomEmojiEntity[] = [...prefix.entities];
  for (const e of restEntities) {
    entities.push({ ...e, offset: e.offset + leading.length });
  }
  return { text: leading + restText, entities };
}

export function titleWithOptionalEmoji(
  emojiKey: string | null | undefined,
  rest: string,
  botEmojis?: Record<string, { unicode?: string; tgEmojiId?: string }> | null
): { text: string; entities: CustomEmojiEntity[] } {
  if (!emojiKey) return applyCustomEmojiPlaceholders(rest, botEmojis);
  // если body уже начинается с эмодзи (юзер сам прописал
  // эмодзи в начале шаблона/заголовка) — не добавляем дополнительный префикс,
  // иначе получаются дубли вида «🛒🛒 Выберите тип подписки».
  if (/^\p{Extended_Pictographic}/u.test(rest.trimStart())) {
    return applyCustomEmojiPlaceholders(rest, botEmojis);
  }
  return titleWithEmojiAndCustomEmojis(emojiKey, rest, botEmojis);
}

/** Полный текст главного меню + entities для премиум-эмодзи в тексте (владелец бота должен иметь Telegram Premium). */
/**
 * парсит сырой Remnawave user из item.subscription и возвращает
 * готовые поля для форматирования (статус-эмодзи, тип-эмодзи, дни, дата, трафик).
 * Используется и в welcome-блоке (formatSubLine), и в «Мои подписки» handler'е.
 */
export function parseSubInfo(item: {
  type: "root" | "secondary";
  subscriptionIndex: number | null;
  subscription: unknown;
  /** для определения ♾️ префикса у безлимитного Unblock (legacy fallback). */
  tariffDisplayName?: string | null;
  /** эмодзи-префикс из админки (Tariff.menuEmoji) — приоритетнее name-matching. */
  tariffMenuEmoji?: string | null;
}): {
  idx: number;
  typeEmoji: string;
  /** «🟢»/«🟡»/«🔴» — для текста (welcome). */
  statusEmojiBig: string;
  /** «✅»/«🟡»/«❌» — для кнопок (более компактный/контрастный). */
  statusEmojiSmall: string;
  /** Например «205 дн.». «—» если нет данных. */
  daysStr: string;
  /** «DD.MM.YYYY». «—» если нет данных. */
  dateStr: string;
  /** « | X/Y ГБ» или пусто (если без лимита). */
  trafficSuffix: string;
  /** true если подписка EXPIRED/DISABLED или expireAt в прошлом. */
  isExpired: boolean;
} {
  const subData = item.subscription as Record<string, unknown> | null;
  const inner = subData ? ((subData.response ?? subData.data ?? subData) as Record<string, unknown>) : null;
  const status = (inner?.status ?? inner?.userStatus ?? "ACTIVE") as string;
  const statusEmojiBig =
    status === "ACTIVE" ? "🟢" :
    status === "EXPIRED" ? "🔴" :
    status === "LIMITED" ? "🟡" :
    status === "DISABLED" ? "🔴" : "🟡";
  const statusEmojiSmall =
    status === "ACTIVE" ? "✅" :
    status === "EXPIRED" ? "❌" :
    status === "LIMITED" ? "🟡" :
    status === "DISABLED" ? "❌" : "🟡";
  // эмодзи зависит от ТАРИФА, не от типа подписки (root/secondary).
  // Приоритет:
  //   1. tariffMenuEmoji — настраиваемое поле Tariff.menuEmoji из админки (если задано)
  //   2. legacy name-matching: «Безлимит/∞» → ♾️🔒, «Unblock/Анблок» → 🔒, «Стандарт» → 🌐
  //   3. fallback по типу подписки: root → 🌐, secondary → 🔒
  let typeEmoji: string;
  const adminEmoji = item.tariffMenuEmoji?.trim();
  if (adminEmoji) {
    typeEmoji = adminEmoji;
  } else {
    const tariffNameRaw = item.tariffDisplayName ?? "";
    const tariffNameLower = tariffNameRaw.toLowerCase();
    const isUnlimited = tariffNameRaw.includes("∞") || tariffNameLower.includes("безлимит");
    const isUnblock = tariffNameLower.includes("unblock") || tariffNameLower.includes("анблок");
    const isStandard = tariffNameLower.includes("стандарт");
    if (isUnlimited) {
      typeEmoji = "♾️🔒";
    } else if (isUnblock) {
      typeEmoji = "🔒";
    } else if (isStandard) {
      typeEmoji = "🌐";
    } else {
      typeEmoji = item.type === "root" ? "🌐" : "🔒";
    }
  }
  const idx = item.subscriptionIndex ?? 0;

  let daysStr = "—";
  let dateStr = "—";
  let expiredByDate = false;
  const expireAtRaw = inner?.expireAt ?? inner?.expire_at;
  if (typeof expireAtRaw === "string" || typeof expireAtRaw === "number") {
    const expireAt = typeof expireAtRaw === "number" ? new Date(expireAtRaw * 1000) : new Date(expireAtRaw);
    if (!isNaN(expireAt.getTime())) {
      const diffMs = expireAt.getTime() - Date.now();
      const days = Math.max(0, Math.ceil(diffMs / 86_400_000));
      daysStr = `${days} дн.`;
      dateStr = expireAt.toLocaleDateString("ru-RU");
      if (diffMs <= 0) expiredByDate = true;
    }
  }
  // подписка считается истёкшей если EXPIRED/DISABLED по
  // Remna-статусу ИЛИ если expireAt прошёл (даже если статус ещё ACTIVE — может быть
  // задержка перевода в EXPIRED на стороне Remna).
  const isExpired = status === "EXPIRED" || status === "DISABLED" || expiredByDate;

  let trafficSuffix = "";
  const tlimit = inner?.trafficLimitBytes ?? inner?.traffic_limit_bytes;
  const tused = (inner?.userTraffic as { usedTrafficBytes?: number } | undefined)?.usedTrafficBytes
    ?? inner?.trafficUsedBytes ?? inner?.usedTrafficBytes ?? inner?.traffic_used_bytes;
  const limitNum = typeof tlimit === "string" ? parseFloat(tlimit) : Number(tlimit);
  const usedNum = typeof tused === "string" ? parseFloat(tused) : Number(tused);
  if (Number.isFinite(limitNum) && limitNum > 0) {
    const u = bytesToGb(Number.isFinite(usedNum) ? usedNum : 0);
    const l = bytesToGb(limitNum);
    trafficSuffix = ` | ${u}/${l} ГБ`;
  }

  return { idx, typeEmoji, statusEmojiBig, statusEmojiSmall, daysStr, dateStr, trafficSuffix, isExpired };
}

/**
 * форматирует строку для welcome-блока «Мои подписки» под главным меню.
 * Шаблон: «🟢 🌐 Подписка #N — N дн. до DD.MM.YYYY [| used/limit ГБ]».
 * **daysStr** обёрнуты в bold-markdown для applyMarkdownAndEmoji в pushRaw.
 */
export function formatSubLine(item: {
  type: "root" | "secondary";
  subscriptionIndex: number | null;
  subscription: unknown;
  /** T16 (12.05.2026) — название тарифа и кастомный эмодзи для главного меню. */
  tariffDisplayName?: string | null;
  tariffMenuEmoji?: string | null;
}, template: string | undefined, showNumber: boolean): string {
  const { idx, typeEmoji, statusEmojiBig, daysStr, dateStr, trafficSuffix } = parseSubInfo(item);
  const tpl = (template && template.trim()) || "{{SUB_STATUS}} {{SUB_TYPE}} Подписка #{{SUB_NUM}} — **{{SUB_DAYS}}** до {{SUB_DATE}}{{SUB_TRAFFIC}}";
  const displayTemplate = showNumber ? tpl : tpl.replace(/[ \t]*[#№]?[ \t]*\{\{SUB_NUM\}\}/g, "");
  return displayTemplate
    .split("{{SUB_STATUS}}").join(statusEmojiBig)
    .split("{{SUB_TYPE}}").join(typeEmoji)
    .split("{{SUB_NUM}}").join(String(idx))
    .split("{{SUB_DAYS}}").join(daysStr)
    .split("{{SUB_DATE}}").join(dateStr)
    .split("{{SUB_TRAFFIC}}").join(trafficSuffix);
}

export function buildMainMenuText(opts: {
  multiSubscriptionsEnabled?: boolean;
  serviceName: string;
  telegramId: number;
  balance: number;
  currency: string;
  subscription: unknown;
  /** Отображаемое имя тарифа с бэкенда: Триал, название с сайта или «Тариф не выбран» */
  tariffDisplayName?: string | null;
  menuTexts?: Record<string, string> | null;
  menuLineVisibility?: Record<string, boolean> | null;
  menuTextCustomEmojiIds?: Record<string, string> | null;
  botEmojis?: Record<string, { unicode?: string; tgEmojiId?: string }> | null;
  /** Кастомный инфо-блок (тех. работы, акции, контакты). Скрывается если пусто. */
  infoBlock?: string | null;
  /**
   * список ВСЕХ подписок клиента (root + secondary), для блок подписок
   * под welcomeGreeting (фейковая нагрузка + список). Если undefined — блок не
   * рендерится (для других callers, без блока подписок).
   */
  allSubs?: {
    items: Array<{
      type: "root" | "secondary";
      id: string;
      subscriptionIndex: number | null;
      subscription: unknown;
      tariffDisplayName: string;
      /** T16 (12.05.2026) — эмодзи-префикс тарифа для главного меню бота. */
      tariffMenuEmoji?: string | null;
    }>;
  } | null;
}): { text: string; entities: CustomEmojiEntity[] } {
  const { serviceName, balance, currency, subscription, tariffDisplayName, menuTexts, menuLineVisibility, menuTextCustomEmojiIds, botEmojis, infoBlock, allSubs } = opts;
  const name = serviceName.trim() || "Кабинет";
  const balanceStr = formatMoney(balance, currency);
  const lines: string[] = [];
  const lineStartKeys: (string | null)[] = [];
  const lineEntitiesByIndex: CustomEmojiEntity[][] = [];
  // Учитываем DEFAULT_MENU_LINE_VISIBILITY (см. константу выше).
  // Приоритет: admin override (menuLineVisibility[key]) → default → visible.
  const shouldShow = (key: string) => {
    if (menuLineVisibility && key in menuLineVisibility) return menuLineVisibility[key] !== false;
    if (key in DEFAULT_MENU_LINE_VISIBILITY) return DEFAULT_MENU_LINE_VISIBILITY[key]!;
    return true;
  };
  const pushLine = (key: string, text: string) => {
    if (!shouldShow(key)) return;
    // applyMarkdownAndEmoji вместо applyCustomEmojiPlaceholders —
    // дополнительно парсит **bold** markdown в шаблонах (для жирного «»).
    const { text: processed, entities } = applyMarkdownAndEmoji(text, botEmojis);
    lines.push(processed);
    lineStartKeys.push(key);
    lineEntitiesByIndex.push(entities);
  };

  // Приветствие + имя сервиса в ОДНУ строку, жирным:
  // «👋 Добро пожаловать в 🛡 STEALTHNET».
  pushLine("welcomeGreeting", `**${t(menuTexts, "welcomeGreeting")}${t(menuTexts, "welcomeTitlePrefix")}${name}**`);
  // Баланс — сразу под шапкой (выше списка подписок), жирным.
  pushLine("balancePrefix", `**${t(menuTexts, "balancePrefix")}${balanceStr}**`);
  pushLine("telegramIdPrefix", t(menuTexts, "telegramIdPrefix") + "`" + opts.telegramId + "`");

  // Блок «список подписок» — все root + secondary активные/полученные в подарок
  // (как в «Мои подписки»), сразу после шапки.
  if (allSubs !== undefined) {
    // pushRaw тоже идёт через applyMarkdownAndEmoji — поддерживает **bold**
    // (количество подписок, дни) и {{KEY}} placeholders.
    const pushRaw = (text: string) => {
      const { text: processed, entities } = applyMarkdownAndEmoji(text, botEmojis);
      lines.push(processed);
      lineStartKeys.push(null);
      lineEntitiesByIndex.push(entities);
    };
    if (allSubs && allSubs.items.length > 0) {
      pushRaw("");
      if (opts.multiSubscriptionsEnabled === true) {
        pushLine("subsCountLabel", t(menuTexts, "subsCountLabel") + `**${allSubs.items.length}**`);
      }
      const sorted = [...allSubs.items].sort((a, b) => {
        if (a.type !== b.type) return a.type === "root" ? -1 : 1;
        return (a.subscriptionIndex ?? 0) - (b.subscriptionIndex ?? 0);
      });
      for (const item of sorted) {
        pushRaw(formatSubLine(item, t(menuTexts, "subLineFormat"), opts.multiSubscriptionsEnabled === true));
      }
    }
  }

  const user = getSubUser(subscription);
  const url = getSubscriptionUrl(subscription);
  const tariffName = (tariffDisplayName && tariffDisplayName.trim()) || "Тариф не выбран";
  pushLine("tariffPrefix", t(menuTexts, "tariffPrefix") + tariffName);

  if (!user && !url) {
    pushLine("subscriptionPrefix", t(menuTexts, "subscriptionPrefix") + t(menuTexts, "statusInactive"));
    pushLine("trafficPrefix", t(menuTexts, "trafficPrefix") + " 0.00 GB");
    pushLine("chooseAction", t(menuTexts, "chooseAction"));
  } else {
    const expireAt = user?.expireAt ?? user?.expirationDate ?? user?.expire_at;
    let expireDate: Date | null = null;
    if (expireAt != null) {
      const d = typeof expireAt === "number" ? new Date(expireAt * 1000) : new Date(String(expireAt));
      if (!Number.isNaN(d.getTime())) expireDate = d;
    }
    const status = (user?.status ?? user?.userStatus ?? "ACTIVE") as string;
    const statusLabel =
      status === "ACTIVE" ? t(menuTexts, "statusActive")
      : status === "EXPIRED" ? t(menuTexts, "statusExpired")
      : status === "LIMITED" ? t(menuTexts, "statusLimited")
      : status === "DISABLED" ? t(menuTexts, "statusDisabled")
      : `🟡 ${status}`;
    const expireStr = expireDate
      ? expireDate.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
      : "—";
    const daysLeft =
      expireDate && expireDate > new Date()
        ? Math.max(0, Math.ceil((expireDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
        : null;

    pushLine("subscriptionPrefix", t(menuTexts, "subscriptionPrefix") + statusLabel);
    pushLine("expirePrefix", t(menuTexts, "expirePrefix") + expireStr);
    if (daysLeft != null) {
      pushLine("daysLeftPrefix", t(menuTexts, "daysLeftPrefix") + `${daysLeft} ${daysLeft === 1 ? "день" : daysLeft < 5 ? "дня" : "дней"}`);
    }
    const deviceLimit = user?.hwidDeviceLimit ?? user?.deviceLimit ?? user?.device_limit;
    const devicesUsed = user?.devicesUsed ?? user?.devices_used;
    if (deviceLimit != null && typeof deviceLimit === "number") {
      const available = devicesUsed != null ? Math.max(0, deviceLimit - Number(devicesUsed)) : deviceLimit;
      pushLine("devicesLabel", t(menuTexts, "devicesLabel") + available + t(menuTexts, "devicesAvailable"));
    }
    const trafficUsedBytes =
      (user?.userTraffic as { usedTrafficBytes?: number } | undefined)?.usedTrafficBytes ??
      user?.trafficUsedBytes ??
      user?.usedTrafficBytes ??
      user?.traffic_used_bytes;
    const trafficLimitBytes = user?.trafficLimitBytes ?? user?.traffic_limit_bytes;
    const usedNum = typeof trafficUsedBytes === "string" ? parseFloat(trafficUsedBytes) : Number(trafficUsedBytes);
    const limitNum = typeof trafficLimitBytes === "string" ? parseFloat(trafficLimitBytes) : Number(trafficLimitBytes);
    if (Number.isFinite(usedNum) && Number.isFinite(limitNum) && limitNum > 0) {
      const pct = usedNum / limitNum;
      const usedGb = bytesToGb(usedNum);
      const limitGb = bytesToGb(limitNum);
      const pctInt = Math.round(Math.min(100, pct * 100));
      pushLine("trafficPrefix", t(menuTexts, "trafficPrefix") + `🟢 ${progressBar(pct, 14)} ${pctInt}% (${usedGb} / ${limitGb} GB)`);
    } else if (Number.isFinite(usedNum)) {
      pushLine("trafficPrefix", t(menuTexts, "trafficPrefix") + ` ${bytesToGb(usedNum)} GB`);
    } else {
      pushLine("trafficPrefix", t(menuTexts, "trafficPrefix") + " 0.00 GB");
    }
    if (url) {
      if (shouldShow("linkLabel")) {
        const { text: label, entities } = applyCustomEmojiPlaceholders(t(menuTexts, "linkLabel"), botEmojis);
        lines.push(label, url);
        lineStartKeys.push("linkLabel", null);
        lineEntitiesByIndex.push(entities, []);
      }
    }
    pushLine("chooseAction", t(menuTexts, "chooseAction"));
  }

  // Кастомный инфо-блок: пустая строка-разделитель + сам блок построчно.
  // Скрывается если null/empty. Каждая строка обрабатывается отдельно для корректной позиции entities.
  const trimmedInfo = infoBlock?.trim();
  if (trimmedInfo) {
    lines.push("");
    lineStartKeys.push(null);
    lineEntitiesByIndex.push([]);
    for (const rawLine of trimmedInfo.split("\n")) {
      const { text: processed, entities } = applyCustomEmojiPlaceholders(rawLine, botEmojis);
      lines.push(processed);
      lineStartKeys.push(null);
      lineEntitiesByIndex.push(entities);
    }
  }

  const text = lines.join("\n");
  const entities: CustomEmojiEntity[] = [];
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const lineEntities = lineEntitiesByIndex[i] ?? [];
    for (const e of lineEntities) {
      entities.push({ ...e, offset: e.offset + offset });
    }
    const key = lineStartKeys[i];
    if (key && menuTextCustomEmojiIds?.[key] && !lineEntities.some((e) => e.offset === 0)) {
      const line = lines[i]!;
      const firstLen = firstCharLengthUtf16(line);
      if (firstLen > 0) entities.push({ type: "custom_emoji", offset, length: firstLen, custom_emoji_id: menuTextCustomEmojiIds[key]! });
    }
    offset += lines[i]!.length + 1;
  }
  return { text, entities };
}

export const TELEGRAM_CAPTION_MAX = 1024;

export const mediaFileIdCache = new Map<string, { fileId: string; expires: number }>();
export const mediaCacheKey = (value: string) => createHash("sha256").update(value.trim()).digest("hex");

export function rememberMediaFileId(key: string | null | undefined, message: unknown): void {
  if (!key || !message || typeof message !== "object") return;
  const msg = message as Record<string, unknown>;
  if (Array.isArray(msg.photo) && msg.photo.length > 0) {
    const largest = msg.photo[msg.photo.length - 1] as { file_id?: string };
    if (largest?.file_id) {
      mediaFileIdCache.set(mediaCacheKey(key), { fileId: largest.file_id, expires: Date.now() + 60_000 });
    }
  } else if (msg.animation && typeof msg.animation === "object") {
    const anim = msg.animation as { file_id?: string };
    if (anim?.file_id) {
      mediaFileIdCache.set(mediaCacheKey(key), { fileId: anim.file_id, expires: Date.now() + 60_000 });
    }
  }
  if (mediaFileIdCache.size > 8) mediaFileIdCache.delete(mediaFileIdCache.keys().next().value!);
}

/** Логотип из настроек: data URL или URL → источник для sendPhoto/sendAnimation и признак GIF (с поддержкой Telegram file_id кэша) */
export function logoToMediaSource(logo: string | null | undefined): { source: InputFile | string; isGif: boolean } | null {
  if (!logo || !logo.trim()) return null;
  const s = logo.trim();
  const cachedFileId = mediaFileIdCache.get(mediaCacheKey(s));
  const isGif = /\.gif(\?|$)/i.test(s) || /^data:image\/gif/i.test(s);
  if (cachedFileId && cachedFileId.expires > Date.now()) {
    return { source: cachedFileId.fileId, isGif };
  }
  if (s.startsWith("http://") || s.startsWith("https://")) {
    return { source: s, isGif };
  }
  const base64Match = /^data:image\/([a-z]+);base64,(.+)$/i.exec(s);
  if (base64Match) {
    try {
      const subtype = (base64Match[1] ?? "").toLowerCase();
      const buf = Buffer.from(base64Match[2]!, "base64");
      if (buf.length > 0) {
        const isGifSub = subtype === "gif";
        const name = isGifSub ? "logo.gif" : "logo.png";
        return { source: new InputFile(buf, name), isGif: isGifSub };
      }
    } catch {
      return null;
    }
  }
  try {
    const buf = Buffer.from(s, "base64");
    if (buf.length > 0) return { source: new InputFile(buf, "logo.png"), isGif: false };
  } catch {
    // ignore
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
//  Rich Messages (Telegram Bot API 10.1) — helpers
//  grammY не типизирует sendRichMessage → зовём через api.raw (Proxy, прокси-aware),
//  с fallback на прямой HTTP. Старым клиентам прилетит "обновитесь" (решение: только rich).
// ─────────────────────────────────────────────────────────────────────────

export type RichInlineKeyboard = { inline_keyboard: unknown[][] };

/**
 * Публичный URL логотипа для rich `![](url)` (бэкенд отдаёт байты на /api/public/bot-asset/logo.png).
 * Берём logoBot (логотип из админки) → botWelcomeImage. Если ни того ни другого нет — null
 * (картинку не вставляем). `?v=<len>` — cache-bust: Telegram кэширует картинку по URL,
 * при смене логотипа в админке длина меняется → новый URL → Telegram перезапрашивает.
 */
export function botLogoUrl(config: { publicAppUrl?: string | null; logoBot?: string | null; botWelcomeImage?: string | null } | null | undefined): string | null {
  const base = (config?.publicAppUrl ?? "").replace(/\/+$/, "");
  if (!base) return null;
  const logo = config?.logoBot || config?.botWelcomeImage || "";
  if (!logo) return null;
  return `${base}/api/public/bot-asset/logo.png?v=${logo.length}`;
}

/** Экранирование текста для ячейки rich-таблицы (| и переводы строк ломают разметку). */
export function richCell(s: string | null | undefined): string {
  return String(s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

/** Компактный GB: "0.00"→"0", "5.00"→"5", "2.34"→"2.3" (чтобы ячейка таблицы не переносилась). */
export function gbCompact(gbStr: string | null): string {
  if (gbStr == null) return "—";
  const n = parseFloat(gbStr);
  if (!Number.isFinite(n)) return gbStr;
  if (Number.isInteger(n)) return String(n);
  return n < 10 ? n.toFixed(1) : String(Math.round(n));
}

/** Склонение «день/дня/дней». */
export function pluralDays(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "день";
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return "дня";
  return "дней";
}

/** Статус + дни + трафик + устройства из subscription-объекта (как в buildMainMenuText). */
export function richSubStats(subscription: unknown): {
  status: string;
  daysLeft: number | null;
  trafficUsedGb: string | null;
  trafficLimitGb: string | null;
  trafficPct: number | null;
  devicesUsed: number | null;
  deviceLimit: number | null;
} {
  const u = getSubUser(subscription) as Record<string, any> | null;
  const empty = { status: "—", daysLeft: null, trafficUsedGb: null, trafficLimitGb: null, trafficPct: null, devicesUsed: null, deviceLimit: null };
  if (!u) return empty;

  const expireAt = u.expireAt ?? u.expirationDate ?? u.expire_at;
  let expireDate: Date | null = null;
  if (expireAt != null) {
    const d = typeof expireAt === "number" ? new Date(expireAt * 1000) : new Date(String(expireAt));
    if (!Number.isNaN(d.getTime())) expireDate = d;
  }
  const status = String(u.status ?? u.userStatus ?? "ACTIVE");
  const daysLeft =
    expireDate && expireDate > new Date()
      ? Math.max(0, Math.ceil((expireDate.getTime() - Date.now()) / 86_400_000))
      : null;

  // устройства
  const dlRaw = u.hwidDeviceLimit ?? u.deviceLimit ?? u.device_limit;
  const deviceLimit = typeof dlRaw === "number" ? dlRaw : dlRaw != null && Number.isFinite(Number(dlRaw)) ? Number(dlRaw) : null;
  const duRaw = u.devicesUsed ?? u.devices_used;
  const devicesUsed = duRaw != null && Number.isFinite(Number(duRaw)) ? Number(duRaw) : null;

  // трафик
  const usedRaw = u.userTraffic?.usedTrafficBytes ?? u.trafficUsedBytes ?? u.usedTrafficBytes ?? u.traffic_used_bytes;
  const limitRaw = u.trafficLimitBytes ?? u.traffic_limit_bytes;
  const usedNum = typeof usedRaw === "string" ? parseFloat(usedRaw) : Number(usedRaw);
  const limitNum = typeof limitRaw === "string" ? parseFloat(limitRaw) : Number(limitRaw);
  let trafficUsedGb: string | null = null;
  let trafficLimitGb: string | null = null;
  let trafficPct: number | null = null;
  if (Number.isFinite(usedNum)) trafficUsedGb = bytesToGb(usedNum);
  if (Number.isFinite(limitNum) && limitNum > 0) {
    trafficLimitGb = bytesToGb(limitNum);
    trafficPct = Math.round(Math.min(100, (usedNum / limitNum) * 100));
  }
  return { status, daysLeft, trafficUsedGb, trafficLimitGb, trafficPct, devicesUsed, deviceLimit };
}

/**
 * Кнопки ВНУТРИ rich-сообщения (Bot API 10.3, RichBlockButtons).
 *
 * Схема выяснена на живом API 25.08.2026 (rich_message валидируется ДО поиска
 * чата, поэтому её можно прощупать, ничего никому не отправляя):
 *   • блок  — {"type":"buttons","buttons":[…]}; массив ПЛОСКИЙ, вложенные ряды
 *     отбиваются ("InlineButton must be an Object") — раскладку Telegram
 *     делает сам, поэтому buttonsPerRow здесь не применим;
 *   • кнопка — text + ОДНО действие (callback_data | url | web_app |
 *     copy_text | switch_inline_query). Кнопка без действия отбивается
 *     ("Text buttons are not allowed in the inline keyboard");
 *   • style — ровно четыре значения: primary | success | danger | default
 *     (secondary/warning → "Invalid button style specified");
 *   • disabled — булево, принимается.
 */
// Сколько кнопок уезжает ВНУТРЬ рич-сообщения. Раскладкой управлять нельзя
// (проверено: Telegram выбрасывает columns/per_row/layout/is_compact и решает
// сам), поэтому единственный рычаг — количество: на 2 подписи читаются
// целиком, дальше он ужимает их в круглые иконки и режет текст.
// Технический потолок API — 8 (9 → RICH_MESSAGE_BUTTONS_TOO_MANY).
export const RICH_BUTTONS_PER_ROW = 2;
export const RICH_BUTTONS_MAX = 8;

export type RichButton = Record<string, unknown>;

export function richButtonsBlock(markup?: RichInlineKeyboard): Record<string, unknown> | null {
  const rows = markup?.inline_keyboard;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const buttons: RichButton[] = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    for (const raw of row) {
      const b = raw as RichButton;
      if (!b || typeof b !== "object") continue;
      // Пропускаем кнопки без действия — API такие отвергает и роняет ВСЁ сообщение.
      const hasAction = ["callback_data", "url", "web_app", "copy_text", "switch_inline_query"]
        .some((k) => b[k] != null);
      if (!hasAction) continue;
      buttons.push(b);
    }
  }
  // ⚠️ Предел — 8 кнопок на сообщение (замерено на живом API 25.08.2026:
  // 9 → RICH_MESSAGE_BUTTONS_TOO_MANY, 8 → ok). Ошибка приходит только при
  // ОТПРАВКЕ, до неё payload проходит валидацию, поэтому поймать её можно
  // лишь на реальном чате. Если кнопок больше — отдаём null, и вызывающий
  // код кладёт их обычной клавиатурой под сообщением (она тоже цветная).
  if (buttons.length === 0 || buttons.length > RICH_BUTTONS_MAX) return null;
  return { type: "buttons", buttons };
}

/**
 * Делит клавиатуру: первые RICH_BUTTONS_INSIDE кнопок (в порядке, заданном
 * админкой) уезжают ВНУТРЬ сообщения, остальные остаются обычной клавиатурой
 * снизу. Кнопки без действия отбрасываем — API их не принимает и роняет всё
 * сообщение целиком.
 */
export function flattenMenuButtons(markup?: RichInlineKeyboard): Record<string, unknown>[] {
  const rows = markup?.inline_keyboard;
  if (!Array.isArray(rows)) return [];
  const out: Record<string, unknown>[] = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    for (const raw of row) {
      const b = raw as Record<string, unknown>;
      if (!b || typeof b !== "object") continue;
      // Кнопку без действия API не принимает и роняет ВСЁ сообщение — отбрасываем.
      const hasAction = ["callback_data", "url", "web_app", "copy_text", "switch_inline_query"].some((k) => b[k] != null);
      if (hasAction) out.push(b);
    }
  }
  return out;
}

/** Отправка rich-сообщения, собранного БЛОКАМИ (кнопки внутри). */
export async function sendRichBlocks(
  ctx: { api: { raw?: unknown }; chat?: { id: number } },
  blocks: Record<string, unknown>[],
  reply_markup?: RichInlineKeyboard,
): Promise<unknown> {
  const chatId = ctx.chat?.id;
  if (chatId == null) throw new Error("sendRichBlocks: no chat id");
  const payload: Record<string, unknown> = { chat_id: chatId, rich_message: { blocks } };
  if (reply_markup) payload.reply_markup = reply_markup;
  const raw = (ctx.api as { raw?: Record<string, unknown> }).raw;
  const fn = raw?.sendRichMessage;
  if (typeof fn === "function") {
    return (fn as (p: Record<string, unknown>) => Promise<unknown>).call(raw, payload);
  }
  const token = process.env.BOT_TOKEN ?? "";
  const res = await fetch(`https://api.telegram.org/bot${token}/sendRichMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json()) as { ok?: boolean; description?: string };
  if (!data.ok) throw new Error(`sendRichMessage(blocks) failed: ${data.description ?? ""}`);
  return data;
}

/** Отправка rich-сообщения (Rich Markdown) с inline-клавиатурой. */
export async function sendRichMarkdown(
  ctx: { api: { raw?: unknown }; chat?: { id: number } },
  markdown: string,
  reply_markup?: RichInlineKeyboard,
): Promise<unknown> {
  const chatId = ctx.chat?.id;
  if (chatId == null) throw new Error("sendRichMarkdown: no chat id");
  // ⚠️ НЕ класть кнопки в blocks вместе с markdown: при передаче обоих полей
  // Telegram МОЛЧА отбрасывает разметку и оставляет только блоки — уходит
  // сообщение без единой строчки текста (проверено 25.08.2026: в ответе
  // rich_message.blocks вернулся один блок "buttons"). Кнопки внутри возможны
  // только если ВСЁ сообщение собрано блоками (heading/paragraph/table/
  // divider/buttons), и не более 8 штук. Здесь — разметка + обычная
  // клавиатура снизу, она тоже цветная.
  const payload: Record<string, unknown> = { chat_id: chatId, rich_message: { markdown } };
  if (reply_markup) payload.reply_markup = reply_markup;
  const raw = (ctx.api as { raw?: Record<string, unknown> }).raw;
  const fn = raw?.sendRichMessage;
  if (typeof fn === "function") {
    return (fn as (p: Record<string, unknown>) => Promise<unknown>).call(raw, payload);
  }
  // Fallback: прямой HTTP (прокси-форки разрулим позже; стенд ходит напрямую).
  const token = process.env.BOT_TOKEN ?? "";
  const res = await fetch(`https://api.telegram.org/bot${token}/sendRichMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json()) as { ok?: boolean; description?: string };
  if (!data.ok) throw new Error(`sendRichMessage failed: ${data.description ?? JSON.stringify(data)}`);
  return data;
}

/** Главное меню в формате Rich Markdown (логотип + заголовок + баланс + таблица подписок). */
/**
 * Главное меню БЛОКАМИ (Bot API 10.3) — чтобы кнопки были ВНУТРИ сообщения.
 *
 * Почему отдельная сборка, а не переиспользование markdown-версии:
 * при передаче `markdown` и `blocks` вместе Telegram МОЛЧА выбрасывает
 * разметку и оставляет только блоки — уходит сообщение без текста.
 * Поэтому либо разметка + клавиатура снизу, либо ВСЁ блоками.
 *
 * Формы выяснены на живом API 25.08.2026:
 *   heading   {type:"heading", text, size}
 *   photo     {type:"photo", photo:{type:"photo", media:"<url>"}}
 *   paragraph {type:"paragraph", text, entities?}
 *   table     {type:"table", cells:[[{text,is_header?,align?}]], is_bordered?, is_striped?}
 *   divider   {type:"divider"}
 *   buttons   {type:"buttons", buttons:[…]}  — не более RICH_BUTTONS_MAX
 */
export function buildMainMenuRichBlocks(opts: {
  serviceName: string;
  balance: number;
  currency: string;
  logoUrl: string | null;
  allSubs?: { items: Array<{ type: "root" | "secondary"; subscriptionIndex: number | null; subscription: unknown; tariffDisplayName: string; tariffMenuEmoji?: string | null; }> } | null;
  infoBlock?: string | null;
  menuTexts?: Record<string, string> | null;
  buttons: Record<string, unknown>[];
}): Record<string, unknown>[] {
  const { serviceName, balance, currency, logoUrl, allSubs, infoBlock, menuTexts, buttons } = opts;
  const mt = menuTexts ?? null;
  const name = serviceName.trim() || "Кабинет";
  const blocks: Record<string, unknown>[] = [];

  const title = `${t(mt, "welcomeGreeting")} в ${t(mt, "welcomeTitlePrefix")}${name}`;
  blocks.push({ type: "heading", text: title, size: 1 });
  if (logoUrl) blocks.push({ type: "photo", photo: { type: "photo", media: logoUrl } });

  const bal = `${t(mt, "balancePrefix")}${formatMoney(balance, currency)}`;
  blocks.push({ type: "paragraph", text: bal, entities: [{ type: "bold", offset: 0, length: bal.length }] });

  const items = allSubs?.items ?? [];
  if (items.length > 0) {
    blocks.push({ type: "heading", text: "🔢 Ваши подписки", size: 2 });
    const sorted = [...items].sort((a, b) => {
      if (a.type !== b.type) return a.type === "root" ? -1 : 1;
      return (a.subscriptionIndex ?? 0) - (b.subscriptionIndex ?? 0);
    });
    const cells: Record<string, unknown>[][] = [[
      { text: "Подписка", is_header: true },
      { text: "Осталось", is_header: true, align: "center" },
      { text: "Трафик", is_header: true, align: "center" },
      { text: "Устр.", is_header: true, align: "center" },
    ]];
    for (const it of sorted) {
      const st = richSubStats(it.subscription);
      const badge =
        st.status === "ACTIVE" ? "🟢"
        : st.status === "EXPIRED" ? "🔴"
        : st.status === "LIMITED" ? "🟠"
        : st.status === "DISABLED" ? "⚪"
        : "🟡";
      const emoji = it.tariffMenuEmoji ? `${it.tariffMenuEmoji} ` : "";
      const left = st.daysLeft != null ? `${st.daysLeft} ${pluralDays(st.daysLeft)}` : "—";
      const traffic =
        st.trafficUsedGb != null && st.trafficLimitGb != null
          ? `${gbCompact(st.trafficUsedGb)}/${gbCompact(st.trafficLimitGb)} GB`
          : st.trafficUsedGb != null ? `${gbCompact(st.trafficUsedGb)} GB` : "—";
      const devices = st.deviceLimit != null ? `${st.devicesUsed ?? 0}/${st.deviceLimit}` : "—";
      cells.push([
        { text: `${badge} ${emoji}${richCell(it.tariffDisplayName)}` },
        { text: left, align: "center" },
        { text: traffic, align: "center" },
        { text: devices, align: "center" },
      ]);
    }
    blocks.push({ type: "table", cells, is_bordered: true, is_striped: true });
  } else {
    blocks.push({ type: "paragraph", text: "Активных подписок пока нет — выбери тариф ниже." });
  }

  const info = infoBlock?.trim();
  if (info) {
    blocks.push({ type: "divider" });
    for (const line of info.split("\n")) {
      const clean = richCell(line);
      if (clean) blocks.push({ type: "paragraph", text: clean });
    }
  }

  // Кнопки ВНУТРИ сообщения (10.3), сеткой по RICH_BUTTONS_PER_ROW в ряд.
  //
  // Раскладкой управлять нечем: поля columns/per_row/layout/is_compact API
  // молча выбрасывает (проверено по ответу — сохраняются только type и
  // buttons), а один блок из 8 кнопок Telegram ужимает в круглые иконки с
  // обрезанными подписями. Приём: КАЖДЫЙ РЯД — отдельный блок buttons, тогда
  // подписи читаются целиком.
  //
  // ⚠️ Предел в 8 кнопок действует НА БЛОК, а не на сообщение (проверено
  // 25.08.2026: 9 в одном блоке → RICH_MESSAGE_BUTTONS_TOO_MANY, а четыре
  // блока по 2 проходят). Так что рядов может быть сколько угодно.
  //
  // ⚠️ Нужен свежий клиент Telegram. На версии старше 10.3 (24.08.2026)
  // сообщение с блоком buttons НЕ РИСУЕТСЯ ВООБЩЕ — приходит пустой пузырь,
  // без всякого «обновите приложение». API при этом отвечает ok и честно
  // сохраняет блоки, так что по логам не поймать: спрашивать версию Telegram.
  for (let i = 0; i < buttons.length; i += RICH_BUTTONS_PER_ROW) {
    const row = buttons.slice(i, i + RICH_BUTTONS_PER_ROW);
    if (row.length) blocks.push({ type: "buttons", buttons: row });
  }
  return blocks;
}

export function buildMainMenuRichMarkdown(opts: {
  serviceName: string;
  balance: number;
  currency: string;
  logoUrl: string | null;
  allSubs?: {
    items: Array<{
      type: "root" | "secondary";
      subscriptionIndex: number | null;
      subscription: unknown;
      tariffDisplayName: string;
      tariffMenuEmoji?: string | null;
    }>;
  } | null;
  infoBlock?: string | null;
  menuTexts?: Record<string, string> | null;
}): string {
  const { serviceName, balance, currency, logoUrl, allSubs, infoBlock, menuTexts } = opts;
  const mt = menuTexts ?? null;
  const name = serviceName.trim() || "Кабинет";
  const out: string[] = [];

  // Крупный ЖИРНЫЙ заголовок «Добро пожаловать в …» — ВЫШЕ картинки (H1 + **bold**).
  out.push(`# **${t(mt, "welcomeGreeting")} в ${t(mt, "welcomeTitlePrefix")}${name}**`, "");
  if (logoUrl) out.push(`![${richCell(name)}](${logoUrl})`, "");
  out.push(`**${t(mt, "balancePrefix")}${formatMoney(balance, currency)}**`, "");

  const items = allSubs?.items ?? [];
  if (items.length > 0) {
    out.push(`## 🔢 Ваши подписки`, "");
    out.push(`| Подписка | Осталось | Трафик | Устр. |`);
    out.push(`|---|:---:|:---:|:---:|`);
    const sorted = [...items].sort((a, b) => {
      if (a.type !== b.type) return a.type === "root" ? -1 : 1;
      return (a.subscriptionIndex ?? 0) - (b.subscriptionIndex ?? 0);
    });
    for (const it of sorted) {
      const s = richSubStats(it.subscription);
      const badge =
        s.status === "ACTIVE" ? "🟢"
        : s.status === "EXPIRED" ? "🔴"
        : s.status === "LIMITED" ? "🟠"
        : s.status === "DISABLED" ? "⚪"
        : "🟡";
      const emoji = it.tariffMenuEmoji ? `${it.tariffMenuEmoji} ` : "";
      const left = s.daysLeft != null ? `${s.daysLeft} ${pluralDays(s.daysLeft)}` : "—";
      const traffic =
        s.trafficUsedGb != null && s.trafficLimitGb != null
          ? `${gbCompact(s.trafficUsedGb)}/${gbCompact(s.trafficLimitGb)} GB`
          : s.trafficUsedGb != null
          ? `${gbCompact(s.trafficUsedGb)} GB`
          : "—";
      const devices = s.deviceLimit != null ? `${s.devicesUsed ?? 0}/${s.deviceLimit}` : "—";
      out.push(`| ${badge} ${emoji}${richCell(it.tariffDisplayName)} | ${left} | ${traffic} | ${devices} |`);
    }
    out.push("");
  } else {
    out.push(`_Активных подписок пока нет — выбери тариф ниже._`, "");
  }

  const info = infoBlock?.trim();
  if (info) {
    out.push("---", "");
    for (const line of info.split("\n")) out.push(`> ${richCell(line)}`);
  }
  return out.join("\n").trim();
}

/** Редактировать сообщение: текст и клавиатура (если с фото/анимацией — caption, иначе text) */
export async function editMessageContent(ctx: {
  api: Api;
  editMessageCaption: (opts: { caption: string; caption_entities?: CustomEmojiEntity[]; reply_markup?: InlineMarkup }) => Promise<unknown>;
  editMessageText: (text: string, opts?: { entities?: CustomEmojiEntity[]; reply_markup?: InlineMarkup }) => Promise<unknown>;
  deleteMessage: () => Promise<unknown>;
  chat?: { id: number };
  callbackQuery?: { message?: { photo?: unknown[]; animation?: unknown; video?: unknown } };
}, text: string, reply_markup: InlineMarkup, entities?: CustomEmojiEntity[]): Promise<unknown> {
  const msg = ctx.callbackQuery?.message;
  const hasPhoto = msg && typeof msg === "object" && "photo" in msg && Array.isArray((msg as { photo: unknown[] }).photo) && (msg as { photo: unknown[] }).photo.length > 0;
  const hasAnimation = msg && typeof msg === "object" && "animation" in msg && (msg as { animation: unknown }).animation != null;
  const hasVideo = msg && typeof msg === "object" && "video" in msg && (msg as { video: unknown }).video != null;
  if (hasVideo && ctx.chat?.id) {
    await ctx.deleteMessage().catch(() => {});
    return ctx.api.sendMessage(ctx.chat.id, text, { entities: entities?.length ? entities : undefined, reply_markup });
  }
  const hasMediaWithCaption = hasPhoto || hasAnimation;
  const caption = text.length > TELEGRAM_CAPTION_MAX ? text.slice(0, TELEGRAM_CAPTION_MAX - 3) + "..." : text;
  const truncatedEntities = text.length > TELEGRAM_CAPTION_MAX && entities ? entities.filter((e) => e.offset + e.length <= TELEGRAM_CAPTION_MAX - 3) : entities;
  if (hasMediaWithCaption) {
    return ctx.editMessageCaption({ caption, caption_entities: truncatedEntities?.length ? truncatedEntities : undefined, reply_markup }).catch((err) => {
      if (String(err).includes("message is not modified")) return null;
      throw err;
    });
  }
  return ctx.editMessageText(text, { entities: entities?.length ? entities : undefined, reply_markup }).catch((err) => {
    if (String(err).includes("message is not modified")) return null;
    throw err;
  });
}

/**
 * единый билд экрана «Помощь».
 * Возвращает текст (ID в `backtick` → копируется по тапу), entities и клавиатуру.
 * Используется И командой `/support`, И callback `menu:support` — чтобы не было
 * рассинхрона «через раз копируется ID» (раньше /support слал plain text без entities).
 */
export function buildHelpScreen(opts: {
  helpIntroText?: string | null;
  supportLink?: string | null;
  publicAppUrl?: string | null;
  ticketsEnabled?: boolean;
  botBackLabel?: string | null;
  botEmojis?: Record<string, { unicode?: string; tgEmojiId?: string }> | null;
  tgId: string;
  tgUsername: string;
  subsCount: number;
  backStyle?: string;
  emojiIds?: InnerEmojiIds;
  lang?: string;
}): { text: string; entities: CustomEmojiEntity[]; markup: InlineMarkup } {
  const introRaw = (opts.helpIntroText ?? "").trim();
  const lines: string[] = [];
  if (introRaw) lines.push(introRaw, "");
  // Часы работы НЕ хардкодим — они задаются в helpIntroText (см. админку), иначе дублировались бы.
  lines.push(`🆔 Telegram ID: \`${opts.tgId}\``);
  if (opts.tgUsername) lines.push(`👤 Username: @${opts.tgUsername}`);
  lines.push(`🗒 Активных подписок: ${opts.subsCount}`);
  const { text, entities } = applyMarkdownAndEmoji(lines.join("\n"), opts.botEmojis ?? null);
  const markup = helpMainMenu(
    { support: opts.supportLink, appUrl: opts.publicAppUrl, ticketsEnabled: opts.ticketsEnabled },
    opts.botBackLabel ?? null,
    opts.backStyle,
    opts.emojiIds,
    opts.lang ?? "ru",
  );
  return { text, entities, markup };
}

export function formatMoney(amount: number, currency: string): string {
  const c = currency.toUpperCase();
  const sym = c === "RUB" ? "₽" : c === "USD" ? "$" : "₴";
  if (typeof amount !== "number" || !Number.isFinite(amount)) return `0 ${sym}`;
  const rounded = Math.round(amount * 100) / 100;
  const formatted = new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 2,
    minimumFractionDigits: Number.isInteger(rounded) ? 0 : 2,
  }).format(rounded);
  return `${formatted} ${sym}`;
}

/** Рассчитать цену со скидкой */
export function getDiscountedPrice(price: number, discount: DiscountInfo): number {
  let final = price;
  if (discount.discountPercent && discount.discountPercent > 0) final -= final * discount.discountPercent / 100;
  if (discount.discountFixed && discount.discountFixed > 0) final -= discount.discountFixed;
  return Math.max(0, Math.round(final * 100) / 100);
}

/**
 * унифицированный расчёт «зачёркивания»
 * для тарифа с учётом обоих типов скидок — персональной (clients.personal_discount_percent)
 * и промокода (activeDiscountCode). Стэкаются в порядке «сначала персональная, затем
 * промокод» (так же делает бэк в payment endpoints).
 *
 * Возвращает:
 *   - `finalPrice` — целое в рублях (Math.floor, без копеек — как считает бэк)
 *   - `discountArg` — для `buildPaymentMessage`, рисующий `~~basePrice~~ → finalPrice (−N%)`.
 *     `undefined` если ни одной скидки не применилось.
 *
 * Важно: на бэк всё равно отправляем `basePrice` (бэк сам пересчитает с pd + promo —
 * не доверяем боту); этот helper только для UI.
 */
export function buildTariffDiscountArg(
  basePrice: number,
  personalDiscountPercent: number,
  promo: DiscountInfo | undefined,
  currency: string,
): { discountArg: { originalPrice: string; discountedPrice: string } | undefined; finalPrice: number } {
  let withPd = basePrice;
  if (personalDiscountPercent > 0) {
    withPd = Math.max(0, Math.floor(basePrice * (1 - personalDiscountPercent / 100)));
  }
  const withPromo = promo ? getDiscountedPrice(withPd, promo) : withPd;
  const finalPrice = Math.max(0, Math.floor(withPromo));
  if (finalPrice >= Math.floor(basePrice)) {
    return { discountArg: undefined, finalPrice };
  }
  const pct = Math.round((1 - finalPrice / basePrice) * 100);
  return {
    discountArg: {
      originalPrice: formatMoney(Math.floor(basePrice), currency),
      discountedPrice: formatMoney(finalPrice, currency) + " (-" + pct + "%)",
    },
    finalPrice,
  };
}

/**
 * Парсинг start-параметра.
 * Новый формат (через __): ref_CODE__s_SOURCE__m_MEDIUM__k_CAMPAIGN__n_CONTENT__t_TERM
 * Старый формат (через _c_): ref_CODE_c_SOURCE_CAMPAIGN
 * Кампания без рефкода: c_SOURCE_CAMPAIGN (например /start c_vk_winter)
 */
export type ConfigSnapshot = Awaited<ReturnType<typeof api.getPublicConfig>>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// T-tariff-restriction (портировано из WolfVPN): при отказе-ограничении (code TARIFF_RESTRICTED)
// показываем ЯВНУЮ кнопку «🏠 Главное меню» (чтобы юзер не застрял), иначе обычный backToMenu.
export function tariffErrMarkup(e: unknown, config: ConfigSnapshot | null, backStyle: Parameters<typeof backToMenu>[1], emojiIds: Parameters<typeof backToMenu>[2]): ReturnType<typeof backToMenu> {
  if ((e as { code?: string } | null)?.code === "TARIFF_RESTRICTED") {
    return { inline_keyboard: [[{ text: "🏠 Главное меню", callback_data: "menu:main" }]] };
  }
  return backToMenu(config?.botBackLabel ?? null, backStyle, emojiIds);
}

export async function showPaymentMethodsForTariff(ctx: any, userId: number, tariff: TariffItem, option: TariffPriceOption | null, extraDevices: number, config: ConfigSnapshot | null, innerStyles: InnerButtonStyles | undefined, innerEmojiIds: InnerEmojiIds | undefined, token: string, subExtrasMonthlyPrice: number = 0): Promise<void> {
  const opts = sortedPriceOptions(tariff.priceOptions);
  const eff = option ?? opts[0] ?? null;
  const unitPrice = eff?.price ?? tariff.price;
  const effectiveDays = eff?.durationDays ?? tariff.durationDays;
  const includedDevices = tariff.includedDevices ?? 1;
  const { extrasTotal } = applyExtraDevicesPriceBot(tariff.pricePerExtraDevice ?? 0, extraDevices, tariff.deviceDiscountTiers, effectiveDays);
  // добавляем стоимость доп. устройств подписки
  // (накопленных через sell-options), масштабированную на выбранную длительность.
  const subExtrasForPeriod = subExtrasMonthlyPrice > 0 && effectiveDays > 0
    ? Math.round(subExtrasMonthlyPrice * (effectiveDays / 30) * 100) / 100
    : 0;
  const effectivePrice = unitPrice + extrasTotal + subExtrasForPeriod;
  const methods = config?.plategaMethods ?? [];
  const client = await api.getMe(token);
  // помощник стэкает персональную скидку клиента
  // и активный промокод. Возвращает finalPrice + discountArg для зачёркивания базовой цены.
  const personalDiscount = client?.personalDiscountPercent ?? 0;
  const discountInfo = activeDiscountCode.get(userId);
  const { discountArg, finalPrice: priceForDisplay } = buildTariffDiscountArg(effectivePrice, personalDiscount, discountInfo, tariff.currency);
  const balanceLabel = client && client.balance >= priceForDisplay ? `💰 Оплатить балансом (${formatMoney(client.balance, client.preferredCurrency ?? "RUB")})` : null;
  const totalDevices = includedDevices + extraDevices;
  const devicesSuffix = extraDevices > 0 ? ` · ${totalDevices} устр (+${extraDevices} доп.)` : "";
  const nameWithDays = opts.length > 1 || option
    ? `${tariff.name} · ${formatRuDays(effectiveDays)}${devicesSuffix}`
    : `${tariff.name}${devicesSuffix}`;
  const pay = buildPaymentMessage(config, {
    name: nameWithDays,
    price: formatMoney(priceForDisplay, tariff.currency),
    amount: String(priceForDisplay),
    currency: tariff.currency,
    action: "Выберите способ оплаты:",
  }, discountArg);
  // T11+T12 (11.05.2026): для тарифов с одним priceOption (Unblock и т.п.) этот экран —
  // первый видимый юзеру шаг покупки. Подставляем `tariff.description` чтобы клиент
  // увидел rich-text (как на эталонных скринах 4 / Unblock и Безлимитная Unblock).
  // Для тарифов с несколькими opts (Стандартная) описание уже показано в picker'е длительности.
  const desc = ((tariff as TariffItem & { description?: string | null }).description ?? "").trim();
  // предупреждение о конвертации (режим «одна подписка из
  // категории»): покупка обновит существующую подписку, а не создаст вторую.
  let convNote = "";
  // интерактивные ряды НАД клавиатурой способов оплаты
  // (toggle «сохранить/убрать устройства», выбор заменяемого триала).
  const extraRows: { text: string; callback_data: string }[][] = [];
  let convHasExtras = false;
  let trialsCount = 0;
  try {
    const conv = await api.tariffConversionPreview(token, { tariffId: tariff.id, priceOptionId: eff?.id });
    if (conv.willConvert && conv.subscription) {
      const subName = conv.subscription.tariffName ? `«${conv.subscription.tariffName}»` : `#${conv.subscription.index}`;
      const extras = conv.extras;
      const dropChosen = convDropExtras.has(userId);
      if (conv.mode === "extend") {
        // тот же тариф = продление: дни складываются, ничего не сбрасывается.
        // newDevicesNote: НОВЫЕ устройства, выбранные в ЭТОЙ покупке (extraDevices) —
        // они уже в цене и добавятся в любом случае; количества показываем с ними.
        const newSuffix = extraDevices > 0 ? ` + ${extraDevices} новых из этой покупки` : "";
        convNote = `\n\n🔄 Этот тариф у вас уже есть — подписка ${subName} будет ПРОДЛЕНА (дни сложатся: остаток ${conv.remainingDays ?? 0} дн. + ${conv.purchasedDays ?? 0} дн. = ${conv.totalDays ?? 0} дн.).${extraDevices > 0 ? "" : " Устройства и серверы останутся как есть."}`;
        if (extras && extras.extraDevices > 0) {
          convHasExtras = true;
          if (dropChosen) {
            convNote += `\n📱 Прежние доп. устройства (+${extras.extraDevices}) будут УБРАНЫ — без доплаты за них. Останется ${extras.drop.totalDevices + extraDevices} устройств (из тарифа${newSuffix}).`;
            if (extraDevices >= extras.extraDevices) {
              convNote += `\n⚠️ Вы убираете ${extras.extraDevices} прежних и добавляете ${extraDevices} новых — устройств меньше не станет, а за новые вы платите. Если хотели оставить как есть — выберите «сохранить» и уберите новые устройства.`;
            }
          } else if ((extras.keep.extraCost ?? 0) > 0) {
            convNote += `\n📱 Доплата за +${extras.extraDevices} прежних доп. устройств: ${extras.keep.extraCost} ₽ за период. Всего будет ${extras.keep.totalDevices + extraDevices} устройств (${extras.keep.totalDevices} прежних${newSuffix}).`;
          } else {
            convNote += `\n📱 Ваши +${extras.extraDevices} доп. устройств сохранятся (итого ${extras.keep.totalDevices + extraDevices} устройств${newSuffix ? ` — ${extras.keep.totalDevices} прежних${newSuffix}` : ""}) — без доплаты.`;
          }
        }
      } else if (conv.mode === "replace") {
        // Глобальный single-режим (мульти-подписки выкл): покупка другого тарифа = ЖЁСТКАЯ замена.
        convNote = `\n\n🔄 Внимание: покупка ДРУГОГО тарифа ЗАМЕНИТ текущую подписку ${subName}.\nСтарая подписка удалится, остаток ${conv.remainingDays ?? 0} дн. СГОРИТ — создастся новая на выбранный тариф (${conv.purchasedDays ?? 0} дн. с нуля). VPN-ссылка сохранится. Вторая подписка не создаётся.`;
      } else {
        const head = conv.subscription.isTrial
          ? "🔄 Пробная подписка станет платной"
          : `🔄 Подписка ${subName} будет обновлена`;
        const daysPart = (conv.convertedDays ?? 0) > 0 && (conv.remainingDays ?? 0) > 0
          ? `\nОстаток ${conv.remainingDays} дн. → ${conv.convertedDays} дн. по цене нового тарифа. Итого: ${conv.totalDays} дн.`
          : "";
        convNote = `\n\n${head} — вторая подписка не создаётся.${daysPart}`;
        // расклад по доп. устройствам: вариант выбирается toggle-кнопкой ниже
        // (по умолчанию — сохранить; «убрать» даёт больше конвертированных дней).
        if (extras && extras.extraDevices > 0) {
          convHasExtras = true;
          const newSuffixConv = extraDevices > 0 ? ` + ${extraDevices} новых из этой покупки` : "";
          if (dropChosen) {
            convNote += `\n📱 Прежние доп. устройства (+${extras.extraDevices}) будут УБРАНЫ: конвертация ${extras.drop.convertedDays} дн. Останется ${extras.drop.totalDevices + extraDevices} устройств (из тарифа${newSuffixConv}).`;
            if (extraDevices >= extras.extraDevices) {
              convNote += `\n⚠️ Вы убираете ${extras.extraDevices} прежних и добавляете ${extraDevices} новых — устройств меньше не станет, а за новые вы платите.`;
            }
          } else {
            convNote += `\n📱 Ваши +${extras.extraDevices} доп. устройств сохранятся (итого ${extras.keep.totalDevices + extraDevices} устройств${newSuffixConv ? ` — ${extras.keep.totalDevices} прежних${newSuffixConv}` : ""}, конвертация ${extras.keep.convertedDays} дн.).`;
          }
        }
      }
      if ((conv.othersToRemove ?? 0) > 0) {
        convNote += `\n⚠️ Остальные ${conv.othersToRemove} ваши подписки будут УДАЛЕНЫ — останется одна.`;
      }
      if (convHasExtras) {
        extraRows.push([{ text: `📱 Устройства: ${dropChosen ? "убрать ✓" : "сохранить ✓"}`, callback_data: "convx:toggle" }]);
      }
    }
    // покупка заменяет активный триал (полностью, с удалением).
    // Показываем предупреждение с именем заменяемого пробника; при нескольких
    // триалах — кнопку циклического выбора, какой именно заменить.
    if (!convNote) {
      const subsAll = await api.getAllSubscriptions(token);
      const trialsOwned = (subsAll.items ?? []).filter((s) => s.trialId);
      trialsCount = trialsOwned.length;
      if (trialsOwned.length > 0) {
        const chosenId = trialReplaceChoice.get(userId);
        const chosen = trialsOwned.find((s) => s.id === chosenId) ?? trialsOwned[0];
        const tname = chosen.trialName ?? chosen.tariffDisplayName;
        convNote = `\n\n⚠️ Покупка заменит ваш пробный период «${tname}» — дни и трафик пробника не переносятся.`;
        if (trialsOwned.length > 1) {
          // фиксируем выбор сразу: экран и payload покупки всегда согласованы.
          trialReplaceChoice.set(userId, chosen.id);
          convNote += `\nЗаменится: «${tname}»`;
          extraRows.push([{ text: "🎁 Заменить другой пробник ▸", callback_data: "trialrepl:next" }]);
        }
      }
    }
  } catch { /* превью не критично — не блокируем оплату */ }
  // сбросы устаревшего выбора: превью без extras / триалов ≤1.
  if (!convHasExtras) convDropExtras.delete(userId);
  if (trialsCount <= 1) trialReplaceChoice.delete(userId);
  // convNote добавляется СУФФИКСОМ: префикс сместил бы offsets pay.entities (custom emoji).
  const finalText = `${desc && opts.length === 1 ? `${desc}\n\n${pay.text}` : pay.text}${convNote}`;
  const markup = tariffPaymentMethodButtons(tariff.id, methods, config?.botBackLabel ?? null, innerStyles?.back, innerEmojiIds, balanceLabel, !!config?.yoomoneyEnabled, !!config?.yookassaEnabled, !!config?.cryptopayEnabled, tariff.currency, !!config?.heleketEnabled, !!config?.rollypayEnabled, !!config?.lavaEnabled, !!config?.lavatopEnabled, config?.botEmojis ?? null, !!config?.paritypayEnabled, !!config?.cloudpaymentsEnabled);
  for (let i = extraRows.length - 1; i >= 0; i--) markup.inline_keyboard.unshift(extraRows[i]!);
  await editMessageContent(ctx, finalText, markup, pay.entities);
}

/** Picker доп. устройств для подарочной подписки. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function showGiftDevicePicker(ctx: any, userId: number, tariff: TariffItem, option: TariffPriceOption | null, config: ConfigSnapshot | null, innerStyles: InnerButtonStyles | undefined, innerEmojiIds: InnerEmojiIds | undefined): Promise<void> {
  const opts = sortedPriceOptions(tariff.priceOptions);
  const eff = option ?? opts[0] ?? null;
  const unitPrice = eff?.price ?? tariff.price;
  const days = eff?.durationDays ?? tariff.durationDays;
  const tiers = tariff.deviceDiscountTiers;
  const pricePerExtra = tariff.pricePerExtraDevice ?? 0;
  const maxExtras = tariff.maxExtraDevices ?? 0;
  const includedDevices = tariff.includedDevices ?? 1;
  const sym = tariff.currency.toUpperCase() === "RUB" ? "₽" : tariff.currency.toUpperCase() === "USD" ? "$" : tariff.currency;

  const tiles = Array.from({ length: maxExtras + 1 }, (_, i) => {
    const extras = i;
    const { extrasTotal, pct } = applyExtraDevicesPriceBot(pricePerExtra, extras, tiers, days);
    return { extras, total: unitPrice + extrasTotal, pct };
  });
  const bestExtra = tiles.slice(1).reduce((best, cur) => {
    const perDev = cur.total / (includedDevices + cur.extras);
    if (best == null || perDev < best.perDev) return { extras: cur.extras, perDev };
    return best;
  }, null as { extras: number; perDev: number } | null);

  const rows: { text: string; callback_data: string }[][] = [];
  let row: { text: string; callback_data: string }[] = [];
  for (const tile of tiles) {
    const isBest = bestExtra?.extras === tile.extras && tile.extras > 0 && tile.pct === 0;
    const badge = tile.pct > 0 ? ` 🎁−${tile.pct}%` : isBest ? " ⭐" : "";
    const prefix = tile.extras === 0 ? "Без доп." : `+${tile.extras} устр`;
    const label = `${prefix} · ${tile.total} ${sym}${badge}`.slice(0, 64);
    row.push({ text: label, callback_data: `gift_tdev:${tile.extras}` });
    if (row.length >= 2) { rows.push(row); row = []; }
  }
  if (row.length > 0) rows.push(row);
  rows.push([{ text: "🏠 Главное меню", callback_data: "menu:main" }]);

  const text = `🎁 ${tariff.name} · ${days} ${formatRuDays(days)}\n\n📱 В тариф включено: ${includedDevices} устр.\nДобавьте дополнительные:`;
  // Mark unused params to satisfy linter
  void innerStyles; void innerEmojiIds;
  await editMessageContent(ctx, text, { inline_keyboard: rows } as InlineMarkup);
}

/** Финальный экран оплаты подарка балансом (с уже выбранной длительностью + extras). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function showGiftPaymentConfirm(ctx: any, userId: number, tariff: TariffItem, option: TariffPriceOption | null, extras: number, config: ConfigSnapshot | null, innerStyles: InnerButtonStyles | undefined, innerEmojiIds: InnerEmojiIds | undefined, token: string): Promise<void> {
  const opts = sortedPriceOptions(tariff.priceOptions);
  const eff = option ?? opts[0] ?? null;
  const unitPrice = eff?.price ?? tariff.price;
  const days = eff?.durationDays ?? tariff.durationDays;
  const includedDevices = tariff.includedDevices ?? 1;
  const { extrasTotal } = applyExtraDevicesPriceBot(tariff.pricePerExtraDevice ?? 0, extras, tariff.deviceDiscountTiers, days);
  const total = unitPrice + extrasTotal;
  const totalDevices = includedDevices + extras;
  const client = await api.getMe(token);
  const balanceLabel = `💰 Оплатить балансом (${formatMoney(client?.balance ?? 0, client?.preferredCurrency ?? "RUB")})`;
  const devicesSuffix = extras > 0 ? ` · ${totalDevices} устр (+${extras} доп.)` : "";
  const text = `🛒 ${tariff.name} · ${days} ${formatRuDays(days)}${devicesSuffix}\n\nСтоимость: ${formatMoney(total, tariff.currency)}\n\nПодтвердите оплату:`;
  void userId;
  // теперь подарочную можно оплатить любым включённым провайдером.
  // Баланс показываем только если на нём достаточно денег.
  const hasBalance = (client?.balance ?? 0) >= total;
  await editMessageContent(ctx, text, giftPaymentButtons(
    tariff.id,
    hasBalance ? balanceLabel : null,
    config?.botBackLabel ?? null,
    innerStyles,
    innerEmojiIds,
    !!config?.yookassaEnabled,
    !!config?.yoomoneyEnabled,
    !!config?.cryptopayEnabled,
    !!config?.heleketEnabled, !!config?.rollypayEnabled,
    !!config?.lavaEnabled,
    tariff.currency,
    !!config?.paritypayEnabled,
    !!config?.cloudpaymentsEnabled,
    config?.plategaMethods ?? [],
  ));
}

// ——— Callback: меню и действия
export async function groupedProfileMenu(config: Awaited<ReturnType<typeof api.getPublicConfig>>, token: string, trialUsed: boolean): Promise<InlineMarkup | undefined> {
  if (!config?.botGroupCabinet) return undefined;
  const [bootstrap, proxy, singbox] = await Promise.all([
    api.getBotBootstrap(token),
    api.getPublicProxyTariffs().catch(() => ({ items: [] })),
    api.getPublicSingboxTariffs().catch(() => ({ items: [] })),
  ]);
  const subscriptions = bootstrap?.allSubscriptions ?? { items: [] };
  const trials = bootstrap?.availableTrials ?? { items: [], hasAnyEnabled: false };
  return mainMenu({
    liteMode: config.liteMode === true,
    section: "profile", groupCabinet: true,
    paidTrial: bootstrap?.cloudTrialAvailable === true && config.cloudpaymentsEnabled && config.cloudpaymentsTrialTariffId && (config.cloudpaymentsTrialDays ?? 0) > 0 ? { amount: config.cloudpaymentsTrialAmount ?? 1, days: config.cloudpaymentsTrialDays! } : null,
    showTrial: trials.hasAnyEnabled ? trials.items.length > 0 : Boolean(config.trialEnabled && !(bootstrap?.client.trialUsed ?? trialUsed)),
    showVpn: connectableSubscriptions(subscriptions.items).length > 0,
    showRenew: renewableSubscriptions(subscriptions.items).length > 0,
    connectTarget: directConnectionTarget(subscriptions.items, config.publicAppUrl, config.useRemnaSubscriptionPage === true),
    showProxy: proxy.items.some(c => c.tariffs.length > 0),
    showSingbox: singbox.items.some(c => c.tariffs.length > 0),
    appUrl: config.publicAppUrl ?? null,
    botButtons: config.botButtons,
    menuMode: config.botMenuMode,
    buttonsPerRow: config.botButtonsPerRow,
    showExtraOptions: config.sellOptionsEnabled && (config.sellOptions?.length ?? 0) > 0,
    showGift: config.giftSubscriptionsEnabled,
  });
}

export function callbackUi(config: ConfigSnapshot | null): {
  appUrl: string | null;
  innerStyles: InnerButtonStyles;
  botEmojis: NonNullable<ConfigSnapshot>["botEmojis"] | undefined;
  innerEmojiIds: InnerEmojiIds | undefined;
} {
  const appUrl = config?.publicAppUrl?.replace(/\/$/, "") ?? null;
  const rawStyles = config?.botInnerButtonStyles;
  const innerStyles: InnerButtonStyles = {
    tariffPay: rawStyles?.tariffPay !== undefined ? rawStyles.tariffPay : "success",
    topup: rawStyles?.topup !== undefined ? rawStyles.topup : "primary",
    back: rawStyles?.back !== undefined ? rawStyles.back : "danger",
    profile: rawStyles?.profile !== undefined ? rawStyles.profile : "primary",
    trialConfirm: rawStyles?.trialConfirm !== undefined ? rawStyles.trialConfirm : "success",
    lang: rawStyles?.lang !== undefined ? rawStyles.lang : "primary",
    currency: rawStyles?.currency !== undefined ? rawStyles.currency : "primary",
  };
  const botEmojis = config?.botEmojis;
  const innerEmojiIds: InnerEmojiIds | undefined = botEmojis
    ? {
        back: botEmojis.BACK?.tgEmojiId,
        card: botEmojis.CARD?.tgEmojiId,
        tariff: botEmojis.PACKAGE?.tgEmojiId || botEmojis.TARIFFS?.tgEmojiId,
        trial: botEmojis.TRIAL?.tgEmojiId,
        profile: botEmojis.PROFILE?.tgEmojiId || botEmojis.PUZZLE?.tgEmojiId,
        connect: botEmojis.SERVERS?.tgEmojiId || botEmojis.CONNECT?.tgEmojiId,
      }
    : undefined;
  return { appUrl, innerStyles, botEmojis, innerEmojiIds };
}

export async function blockUnsubscribedCallback(
  ctx: Context,
  userId: number,
  config: ConfigSnapshot | null,
): Promise<boolean> {
  if (!config?.forceSubscribeEnabled || !config.forceSubscribeChannelId?.trim()) return false;
  const lang = getUserLang(userId);
  const channelId = config.forceSubscribeChannelId.trim();
  const result = await checkUserSubscription(ctx.api, userId, channelId);
  if (result.state === "subscribed") return false;
  const msg = config.forceSubscribeMessage?.trim() || _t("subscribe.default_message", lang);
  const details = result.state === "cannot_verify" ? `\n\n${_t("subscribe.cannot_verify", lang)}` : "";
  await editMessageContent(ctx, `⚠️ ${msg}${details}`, subscribeKeyboard(channelId, lang));
  return true;
}

export function textInputUserId(ctx: Context): number | null {
  if (ctx.chat && ctx.chat.type !== "private") return null;
  if (ctx.message?.text?.startsWith("/")) return null;
  return ctx.from?.id ?? null;
}


export { showCloudCheckout, clearCloudEmail } from "../cloudpayments-flow.js";
export const deviceFlow = new DeviceFlow();
