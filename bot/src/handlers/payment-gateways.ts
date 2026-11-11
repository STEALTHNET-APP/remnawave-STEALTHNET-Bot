import type { Context } from "grammy";
import * as api from "../api.js";
import {
  activeDiscountCode,
  addsubPending,
  convDropExtras,
  extendingSecondaryPending,
  extraOptionTargetSub,
  pendingDropExtras,
  selectedTariffOption,
  trialReplaceChoice,
} from "../state-store.js";
import {
  applyExtraDevicesPriceBot,
  backToMenu,
  buildTariffDiscountArg,
  editMessageContent,
  formatRuDays,
  payUrlMarkup,
  receiptPromptKeyboard,
  receiptPromptText,
  sortedPriceOptions,
  storePendingReceipt,
  tariffErrMarkup,
  RECEIPT_OK_LINE,
  type ConfigSnapshot,
  type CustomEmojiEntity,
  type TariffItem,
} from "./shared.js";

export type PaymentChrome = {
  config: ConfigSnapshot | null;
  backStyle: Parameters<typeof backToMenu>[1];
  emojiIds: Parameters<typeof backToMenu>[2];
};

export type PaymentMessage = { text: string; entities: CustomEmojiEntity[] };

export type ProductKind = "proxy" | "singbox";

export type ProductTariff = { id: string; name: string; price: number; currency: string };

export type SellOption = {
  kind: "traffic" | "devices" | "servers";
  id: string;
  name: string;
  price: number;
  currency: string;
  trafficGb?: number;
  deviceCount?: number;
};

export type TariffPaymentBody = {
  amount: number;
  currency: string;
  tariffId: string;
  tariffPriceOptionId?: string;
  deviceCount: number;
  promoCode?: string;
  asAdditional?: boolean;
  extendsSecondarySubId?: string;
  removeExtrasOnActivate: boolean;
  replaceTrialSubId?: string;
};

export type CloudCheckout = { paymentId: string; payUrl: string };

export type GatewayPayment = { url?: string; checkout?: CloudCheckout };

export type TariffCheckout = {
  body: TariffPaymentBody;
  finalPrice: number;
  discountArg?: { originalPrice: string; discountedPrice: string };
  name: string;
  currency: string;
  email: string | null;
  cleanup: () => void;
};

export type ProductGateway = {
  prefix: string;
  kind: ProductKind;
  create: (token: string, tariff: ProductTariff) => Promise<{ url: string }>;
};

export type TariffGateway = {
  prefix: string;
  errorText: string;
  errorMarkup?: "tariff" | "back";
  create: (token: string, body: TariffPaymentBody) => Promise<GatewayPayment>;
};

export type TopupGateway = {
  prefix: string;
  errorText: string;
  create: (token: string, amount: number, currency: string) => Promise<GatewayPayment>;
};

export const PRODUCT_GATEWAYS: ProductGateway[] = [
  {
    prefix: "pay_proxy_yoomoney:",
    kind: "proxy",
    create: async (token, tariff) => ({
      url: (await api.createYoomoneyPayment(token, { amount: tariff.price, paymentType: "AC", proxyTariffId: tariff.id })).paymentUrl,
    }),
  },
  {
    prefix: "pay_proxy_cryptopay:",
    kind: "proxy",
    create: async (token, tariff) => ({
      url: (await api.createCryptopayPayment(token, { amount: tariff.price, currency: tariff.currency, proxyTariffId: tariff.id })).payUrl,
    }),
  },
  {
    prefix: "pay_proxy_stars:",
    kind: "proxy",
    create: async (token, tariff) => ({
      url: (await api.createStarsPayment(token, { amount: tariff.price, currency: tariff.currency, proxyTariffId: tariff.id })).payUrl,
    }),
  },
  {
    prefix: "pay_singbox_yoomoney:",
    kind: "singbox",
    create: async (token, tariff) => ({
      url: (await api.createYoomoneyPayment(token, { amount: tariff.price, paymentType: "AC", singboxTariffId: tariff.id })).paymentUrl,
    }),
  },
  {
    prefix: "pay_singbox_cryptopay:",
    kind: "singbox",
    create: async (token, tariff) => ({
      url: (await api.createCryptopayPayment(token, { amount: tariff.price, currency: tariff.currency, singboxTariffId: tariff.id })).payUrl,
    }),
  },
  {
    prefix: "pay_singbox_stars:",
    kind: "singbox",
    create: async (token, tariff) => ({
      url: (await api.createStarsPayment(token, { amount: tariff.price, currency: tariff.currency, singboxTariffId: tariff.id })).payUrl,
    }),
  },
];

export const TARIFF_GATEWAYS: TariffGateway[] = [
  {
    prefix: "pay_tariff_yoomoney:",
    errorText: "Ошибка создания платежа ЮMoney",
    create: async (token, body) => ({
      url: (await api.createYoomoneyPayment(token, {
        amount: body.amount,
        paymentType: "AC",
        tariffId: body.tariffId,
        tariffPriceOptionId: body.tariffPriceOptionId,
        deviceCount: body.deviceCount,
        promoCode: body.promoCode,
        asAdditional: body.asAdditional,
        extendsSecondarySubId: body.extendsSecondarySubId,
        removeExtrasOnActivate: body.removeExtrasOnActivate,
        replaceTrialSubId: body.replaceTrialSubId,
      })).paymentUrl,
    }),
  },
  {
    prefix: "pay_tariff_cryptopay:",
    errorText: "Ошибка создания платежа",
    create: async (token, body) => ({ url: (await api.createCryptopayPayment(token, body)).payUrl }),
  },
  {
    prefix: "pay_tariff_stars:",
    errorText: "Ошибка создания платежа",
    create: async (token, body) => ({ url: (await api.createStarsPayment(token, body)).payUrl }),
  },
  {
    prefix: "pay_tariff_lava:",
    errorText: "Ошибка создания платежа Lava",
    errorMarkup: "back",
    create: async (token, body) => ({ url: (await api.createLavaPayment(token, body)).payUrl }),
  },
  {
    prefix: "pay_tariff_lavatop:",
    errorText: "Ошибка создания платежа Lava.top",
    errorMarkup: "back",
    create: async (token, body) => ({ url: (await api.createLavatopPayment(token, body)).payUrl }),
  },
  {
    prefix: "pay_tariff_heleket:",
    errorText: "Ошибка создания платежа Heleket",
    errorMarkup: "back",
    create: async (token, body) => ({ url: (await api.createHeleketPayment(token, body)).payUrl }),
  },
  {
    prefix: "pay_tariff_rollypay:",
    errorText: "Ошибка создания платежа RollyPay",
    errorMarkup: "back",
    create: async (token, body) => ({ url: (await api.createRollypayPayment(token, body)).payUrl }),
  },
  {
    prefix: "pay_tariff_cispay:",
    errorText: "Ошибка создания платежа RollyPay",
    errorMarkup: "back",
    create: async (token, body) => ({ url: (await api.createCispayPayment(token, body)).payUrl }),
  },
  {
    prefix: "pay_tariff_cloudpayments:",
    errorText: "Ошибка создания платежа CloudPayments",
    errorMarkup: "back",
    create: async (token, body) => ({ checkout: await api.createCloudpaymentsPayment(token, body) }),
  },
  {
    prefix: "pay_tariff_paritypay:",
    errorText: "Ошибка создания платежа ParityPay",
    errorMarkup: "back",
    create: async (token, body) => ({ url: (await api.createParitypayPayment(token, body)).payUrl }),
  },
];

export const TOPUP_GATEWAYS: TopupGateway[] = [
  {
    prefix: "topup_yoomoney:",
    errorText: "Ошибка создания платежа ЮMoney",
    create: async (token, amount) => ({
      url: (await api.createYoomoneyPayment(token, { amount, paymentType: "AC" })).paymentUrl,
    }),
  },
  {
    prefix: "topup_cryptopay:",
    errorText: "Ошибка создания платежа Crypto Bot",
    create: async (token, amount, currency) => ({
      url: (await api.createCryptopayPayment(token, { amount, currency })).payUrl,
    }),
  },
  {
    prefix: "topup_stars:",
    errorText: "Ошибка создания платежа Crypto Bot",
    create: async (token, amount, currency) => ({
      url: (await api.createStarsPayment(token, { amount, currency })).payUrl,
    }),
  },
  {
    prefix: "topup_lava:",
    errorText: "Ошибка создания платежа Lava",
    create: async (token, amount, currency) => ({
      url: (await api.createLavaPayment(token, { amount, currency })).payUrl,
    }),
  },
  {
    prefix: "topup_lavatop:",
    errorText: "Ошибка создания платежа Lava.top",
    create: async (token, amount, currency) => ({
      url: (await api.createLavatopPayment(token, { amount, currency })).payUrl,
    }),
  },
  {
    prefix: "topup_heleket:",
    errorText: "Ошибка создания платежа Heleket",
    create: async (token, amount, currency) => ({
      url: (await api.createHeleketPayment(token, { amount, currency })).payUrl,
    }),
  },
  {
    prefix: "topup_rollypay:",
    errorText: "Ошибка создания платежа RollyPay",
    create: async (token, amount, currency) => ({
      url: (await api.createRollypayPayment(token, { amount, currency })).payUrl,
    }),
  },
  {
    prefix: "topup_cispay:",
    errorText: "Ошибка создания платежа RollyPay",
    create: async (token, amount, currency) => ({
      url: (await api.createCispayPayment(token, { amount, currency })).payUrl,
    }),
  },
  {
    prefix: "topup_cloudpayments:",
    errorText: "Ошибка создания платежа CloudPayments",
    create: async (token, amount, currency) => ({
      checkout: await api.createCloudpaymentsPayment(token, { amount, currency }),
    }),
  },
  {
    prefix: "topup_paritypay:",
    errorText: "Ошибка создания платежа ParityPay",
    create: async (token, amount, currency) => ({
      url: (await api.createParitypayPayment(token, { amount, currency })).payUrl,
    }),
  },
];

export async function findProductTariff(kind: ProductKind, tariffId: string): Promise<ProductTariff | undefined> {
  const { items } = kind === "proxy" ? await api.getPublicProxyTariffs() : await api.getPublicSingboxTariffs();
  const tariffs = (items ?? []).flatMap((category) => category.tariffs as ProductTariff[]);
  return tariffs.find((tariff) => tariff.id === tariffId);
}

export async function sendPaymentError(
  ctx: Context,
  chrome: PaymentChrome,
  e: unknown,
  fallback: string,
  markup: "tariff" | "back" = "tariff",
): Promise<void> {
  const message = e instanceof Error ? e.message : fallback;
  const keyboard = markup === "back"
    ? backToMenu(chrome.config?.botBackLabel ?? null, chrome.backStyle, chrome.emojiIds)
    : tariffErrMarkup(e, chrome.config, chrome.backStyle, chrome.emojiIds);
  await editMessageContent(ctx, `❌ ${message}`, keyboard);
}

export async function completeBalancePayment(
  ctx: Context,
  chrome: PaymentChrome,
  pay: () => Promise<{ message: string }>,
  onPaid?: () => void,
): Promise<void> {
  try {
    const result = await pay();
    onPaid?.();
    await editMessageContent(ctx, `✅ ${result.message}`, backToMenu(chrome.config?.botBackLabel ?? null, chrome.backStyle, chrome.emojiIds));
  } catch (e) {
    await sendPaymentError(ctx, chrome, e, "Ошибка оплаты");
  }
}

export async function startYookassaCheckout(
  ctx: Context,
  chrome: PaymentChrome,
  params: {
    userId: number;
    savedEmail: string | null;
    build: (receiptEmail: string | undefined) => Promise<{ paymentId: string; confirmationUrl: string }>;
    message: () => PaymentMessage;
    onPaid?: () => void;
  },
): Promise<void> {
  const token = storePendingReceipt({
    userId: params.userId,
    savedEmail: params.savedEmail,
    builder: (receiptEmail) => params.build(receiptEmail),
    finalize: async (payment, { receiptSentTo }) => {
      params.onPaid?.();
      const message = params.message();
      const markup = payUrlMarkup(payment.confirmationUrl, chrome.config?.botBackLabel ?? null, chrome.backStyle, chrome.emojiIds);
      if (receiptSentTo) {
        await ctx.reply(`${message.text}\n\n${RECEIPT_OK_LINE(receiptSentTo)}`, { parse_mode: "HTML", reply_markup: markup });
      } else {
        await ctx.reply(message.text, { entities: message.entities, reply_markup: markup });
      }
    },
  });
  await editMessageContent(ctx, receiptPromptText(params.savedEmail), receiptPromptKeyboard(token, params.savedEmail));
}

export async function prepareTariffCheckout(params: {
  token: string;
  userId: number;
  tariff: TariffItem;
}): Promise<TariffCheckout> {
  const { token, userId, tariff } = params;
  const discountInfo = activeDiscountCode.get(userId);
  const promoCode = discountInfo?.code;
  const selection = selectedTariffOption.get(userId);
  const options = sortedPriceOptions(tariff.priceOptions);
  const effectiveOption = selection?.tariffId === tariff.id ? selection.option : (options.length === 1 ? options[0]! : null);
  const unitPrice = effectiveOption?.price ?? tariff.price;
  const effectiveDays = effectiveOption?.durationDays ?? tariff.durationDays;
  const extraDevices = selection?.tariffId === tariff.id ? selection.extraDevices : 0;
  const { extrasTotal } = applyExtraDevicesPriceBot(tariff.pricePerExtraDevice ?? 0, extraDevices, tariff.deviceDiscountTiers, effectiveDays);
  const effectivePrice = unitPrice + extrasTotal;
  const asAdditional = addsubPending.get(userId) === tariff.id;
  const extending = extendingSecondaryPending.get(userId);
  const extendsSecondarySubId = extending && extending.tariffId === tariff.id ? extending.secondaryId : undefined;
  const removeExtrasOnActivate = !!(extendsSecondarySubId && pendingDropExtras.get(userId) === extendsSecondarySubId) || (!extendsSecondarySubId && convDropExtras.has(userId));
  const replaceTrialSubId = !extendsSecondarySubId ? trialReplaceChoice.get(userId) : undefined;

  let subExtrasForPeriod = 0;
  if (extendsSecondarySubId && !removeExtrasOnActivate) {
    try {
      const allSubs = await api.getAllSubscriptions(token);
      const target = allSubs.items?.find((item) => item.id === extendsSecondarySubId);
      const monthly = target?.extraDevicesMonthlyPrice ?? 0;
      if (monthly > 0 && effectiveDays > 0) {
        subExtrasForPeriod = Math.round(monthly * (effectiveDays / 30) * 100) / 100;
      }
    } catch {}
  }

  const totalPrice = effectivePrice + subExtrasForPeriod;
  const me = await api.getMe(token);
  const { discountArg, finalPrice } = buildTariffDiscountArg(totalPrice, me?.personalDiscountPercent ?? 0, discountInfo, tariff.currency);
  const name = options.length > 1 || selection?.tariffId === tariff.id
    ? `${tariff.name} · ${formatRuDays(effectiveDays)}`
    : tariff.name;

  const cleanup = () => {
    if (promoCode) activeDiscountCode.delete(userId);
    selectedTariffOption.delete(userId);
    if (extendsSecondarySubId && removeExtrasOnActivate) extendingSecondaryPending.delete(userId);
    if (asAdditional) addsubPending.delete(userId);
    if (removeExtrasOnActivate) pendingDropExtras.delete(userId);
    convDropExtras.delete(userId);
    trialReplaceChoice.delete(userId);
  };

  return {
    body: {
      amount: totalPrice,
      currency: tariff.currency,
      tariffId: tariff.id,
      tariffPriceOptionId: effectiveOption?.id,
      deviceCount: extraDevices,
      promoCode,
      asAdditional: asAdditional || undefined,
      extendsSecondarySubId,
      removeExtrasOnActivate,
      replaceTrialSubId,
    },
    finalPrice,
    discountArg,
    name,
    currency: tariff.currency,
    email: me?.email ?? null,
    cleanup,
  };
}

export function resolveOptionTarget(userId: number): string | undefined {
  const target = extraOptionTargetSub.get(userId);
  return target && target !== "primary" ? target : undefined;
}

export async function computeOptionDisplayPrice(params: {
  token: string;
  option: SellOption;
  targetSubscriptionId?: string;
  personalDiscountPercent: number;
}): Promise<number> {
  let displayPrice = params.option.price;
  if (params.option.kind === "devices" && params.targetSubscriptionId) {
    try {
      const subs = await api.getAllSubscriptions(params.token);
      const targetSub = subs.items?.find((item) => item.id === params.targetSubscriptionId);
      const inner = targetSub?.subscription as Record<string, unknown> | null;
      const innerData = inner ? ((inner.response ?? inner.data ?? inner) as Record<string, unknown>) : null;
      const expireAtRaw = innerData?.expireAt ?? innerData?.expire_at;
      let daysLeft = 30;
      if (typeof expireAtRaw === "string" || typeof expireAtRaw === "number") {
        const exp = typeof expireAtRaw === "number" ? new Date(expireAtRaw * 1000) : new Date(expireAtRaw);
        if (!isNaN(exp.getTime())) daysLeft = Math.max(0, (exp.getTime() - Date.now()) / 86_400_000);
      }
      const coef = Math.max(1, daysLeft / 30);
      displayPrice = Math.floor(params.option.price * coef);
    } catch {}
  }
  if (params.personalDiscountPercent > 0) {
    displayPrice = Math.max(0, Math.floor(displayPrice * (1 - params.personalDiscountPercent / 100)));
  }
  return displayPrice;
}

export function optionDisplayName(option: SellOption): string {
  if (option.name) return option.name;
  if (option.kind === "traffic") return `+${option.trafficGb} ГБ`;
  if (option.kind === "devices") return `+${option.deviceCount} устр.`;
  return "Сервер";
}
