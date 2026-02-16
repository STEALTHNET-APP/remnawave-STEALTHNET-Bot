/**
 * STEALTHNET 3.0 — API клиент бота (вызовы бэкенда).
 */

const API_URL = (process.env.API_URL || "").replace(/\/$/, "");
if (!API_URL) {
  console.warn("API_URL not set in .env — bot API calls will fail");
}

function getHeaders(token?: string): HeadersInit {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

async function fetchJson<T>(path: string, opts?: { method?: string; body?: unknown; token?: string }): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: opts?.method ?? "GET",
    headers: getHeaders(opts?.token),
    ...(opts?.body !== undefined && { body: JSON.stringify(opts.body) }),
  });
  const data = (await res.json().catch(() => ({}))) as T | { message?: string };
  if (!res.ok) {
    const msg = typeof (data as { message?: string }).message === "string" ? (data as { message: string }).message : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

/** Публичный конфиг (тарифы, кнопки, способы оплаты, trial и т.д.) */
export async function getPublicConfig(): Promise<{
  serviceName?: string | null;
  logo?: string | null;
  publicAppUrl?: string | null;
  defaultCurrency?: string;
  trialEnabled?: boolean;
  trialDays?: number;
  plategaMethods?: { id: number; label: string }[];
  yoomoneyEnabled?: boolean;
  yookassaEnabled?: boolean;
  botButtons?: { id: string; visible: boolean; label: string; order: number; style?: string; iconCustomEmojiId?: string }[] | null;
  /** Тексты меню с уже подставленными эмодзи ({{BALANCE}} → unicode из bot_emojis) */
  resolvedBotMenuTexts?: Record<string, string>;
  /** Для каких ключей текста меню в начале стоит премиум-эмодзи: key → custom_emoji_id (для entities) */
  menuTextCustomEmojiIds?: Record<string, string>;
  /** Эмодзи по ключам: unicode и tgEmojiId (премиум) — для кнопок и подстановки в текст */
  botEmojis?: Record<string, { unicode?: string; tgEmojiId?: string }>;
  botBackLabel?: string | null;
  botMenuTexts?: Record<string, string> | null;
  botInnerButtonStyles?: Record<string, string> | null;
  activeLanguages?: string[];
  activeCurrencies?: string[];
  defaultReferralPercent?: number;
  referralPercentLevel2?: number;
  referralPercentLevel3?: number;
  supportLink?: string | null;
  agreementLink?: string | null;
  offerLink?: string | null;
  instructionsLink?: string | null;
  forceSubscribeEnabled?: boolean;
  forceSubscribeChannelId?: string | null;
  forceSubscribeMessage?: string | null;
  sellOptionsEnabled?: boolean;
  sellOptions?: Array<
    | { kind: "traffic"; id: string; name: string; trafficGb: number; price: number; currency: string }
    | { kind: "devices"; id: string; name: string; deviceCount: number; price: number; currency: string }
    | { kind: "servers"; id: string; name: string; squadUuid: string; trafficGb?: number; price: number; currency: string }
  >;
} | null> {
  return fetchJson("/api/public/config");
}

/** Регистрация / вход по Telegram */
export async function registerByTelegram(body: {
  telegramId: string;
  telegramUsername?: string;
  preferredLang?: string;
  preferredCurrency?: string;
  referralCode?: string;
}): Promise<{ token: string; client: { id: string; telegramUsername?: string | null; preferredCurrency: string; balance: number; trialUsed?: boolean; referralCode?: string | null } }> {
  return fetchJson("/api/client/auth/register", { method: "POST", body });
}

/** Текущий пользователь */
export async function getMe(token: string): Promise<{
  id: string;
  telegramUsername?: string | null;
  preferredLang: string;
  preferredCurrency: string;
  balance: number;
  referralCode?: string | null;
  referralPercent?: number | null;
  trialUsed?: boolean;
}> {
  return fetchJson("/api/client/auth/me", { token });
}

/** Подписка Remna (для ссылки VPN, статус, трафик) + отображаемое имя тарифа с сайта */
export async function getSubscription(token: string): Promise<{ subscription: unknown; tariffDisplayName?: string | null; message?: string }> {
  return fetchJson("/api/client/subscription", { token });
}

/** Публичный список тарифов по категориям (emoji из админки по коду ordinary/premium) */
export async function getPublicTariffs(): Promise<{
  items: {
    id: string;
    name: string;
    emojiKey: string | null;
    emoji: string;
    tariffs: { id: string; name: string; price: number; currency: string }[];
  }[];
}> {
  return fetchJson("/api/public/tariffs");
}

/** Создать платёж Platega (возвращает paymentUrl). Для опции — extraOption. */
export async function createPlategaPayment(
  token: string,
  body: {
    amount?: number;
    currency?: string;
    paymentMethod: number;
    description?: string;
    tariffId?: string;
    extraOption?: { kind: "traffic" | "devices" | "servers"; productId: string };
  }
): Promise<{ paymentUrl: string; orderId: string; paymentId: string }> {
  return fetchJson("/api/client/payments/platega", { method: "POST", body, token });
}

/** Создать платёж ЮMoney (оплата картой). Для тарифа — tariffId, для опции — extraOption. */
export async function createYoomoneyPayment(
  token: string,
  body: { amount?: number; paymentType: "PC" | "AC"; tariffId?: string; extraOption?: { kind: "traffic" | "devices" | "servers"; productId: string } }
): Promise<{ paymentId: string; paymentUrl: string }> {
  return fetchJson("/api/client/yoomoney/create-form-payment", { method: "POST", body, token });
}

/** Создать платёж ЮKassa (карта, СБП). Только RUB. Для тарифа — tariffId. Для опции — extraOption. */
export async function createYookassaPayment(
  token: string,
  body: { amount?: number; currency?: string; tariffId?: string; extraOption?: { kind: "traffic" | "devices" | "servers"; productId: string } }
): Promise<{ paymentId: string; confirmationUrl: string }> {
  return fetchJson("/api/client/yookassa/create-payment", { method: "POST", body, token });
}

/** Обновить профиль (язык, валюта) */
export async function updateProfile(
  token: string,
  body: { preferredLang?: string; preferredCurrency?: string }
): Promise<unknown> {
  return fetchJson("/api/client/profile", { method: "PATCH", body, token });
}

/** Активировать триал */
export async function activateTrial(token: string): Promise<{ message: string }> {
  return fetchJson("/api/client/trial", { method: "POST", body: {}, token });
}

/** Оплата тарифа балансом */
export async function payByBalance(token: string, tariffId: string): Promise<{ message: string; paymentId: string; newBalance: number }> {
  return fetchJson("/api/client/payments/balance", { method: "POST", body: { tariffId }, token });
}

/** Оплата опции (доп. трафик/устройства/сервер) с баланса */
export async function payOptionByBalance(
  token: string,
  extraOption: { kind: "traffic" | "devices" | "servers"; productId: string }
): Promise<{ message: string; paymentId: string; newBalance: number }> {
  return fetchJson("/api/client/payments/balance/option", { method: "POST", body: { extraOption }, token });
}

/** Активировать промо-ссылку (PromoGroup) */
export async function activatePromo(token: string, code: string): Promise<{ message: string }> {
  return fetchJson("/api/client/promo/activate", { method: "POST", body: { code }, token });
}

/** Проверить промокод (PromoCode — скидка / бесплатные дни) */
export async function checkPromoCode(token: string, code: string): Promise<{ type: string; discountPercent?: number | null; discountFixed?: number | null; durationDays?: number | null; name: string }> {
  return fetchJson("/api/client/promo-code/check", { method: "POST", body: { code }, token });
}

/** Активировать промокод FREE_DAYS */
export async function activatePromoCode(token: string, code: string): Promise<{ message: string }> {
  return fetchJson("/api/client/promo-code/activate", { method: "POST", body: { code }, token });
}
