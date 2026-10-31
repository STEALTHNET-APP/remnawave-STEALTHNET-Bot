import { api } from "./api";
import type { CheckoutMethod } from "./checkout-methods";

export * from "./checkout-methods";

/**
 * Общий слой оплаты для клиентских экранов Aurora.
 *
 * Один список способов оплаты и одна функция создания платежа для тарифов,
 * пополнения, прокси, sing-box, дополнительных опций и конструктора тарифа.
 * Провайдеры включаются только по флагам public config, как в классическом
 * кабинете, поэтому поведение экранов не расходится.
 */

export type CheckoutProduct =
  | { kind: "topup"; amount: number }
  | {
      kind: "tariff";
      amount: number;
      currency: string;
      tariffId: string;
      tariffPriceOptionId?: string;
      deviceCount?: number;
      promoCode?: string;
      asAdditional?: boolean;
      asGift?: boolean;
      extendsSecondarySubId?: string;
      removeExtrasOnActivate?: boolean;
      replaceTrialSubId?: string;
    }
  | { kind: "proxy"; amount: number; currency: string; proxyTariffId: string; promoCode?: string }
  | { kind: "singbox"; amount: number; currency: string; singboxTariffId: string; promoCode?: string }
  | {
      kind: "option";
      extraOption: { kind: "traffic" | "devices" | "servers"; productId: string; targetSubscriptionId?: string };
      promoCode?: string;
    }
  | {
      kind: "custom";
      customBuild: { days: number; devices: number; trafficGb?: number };
      promoCode?: string;
      currency?: string;
    };

export interface CheckoutResult {
  url?: string;
  provider?: string;
  paymentId?: string;
  balanceApplied?: boolean;
  message?: string;
}

interface PaymentBase {
  amount?: number;
  currency?: string;
  description?: string;
  promoCode?: string;
  tariffId?: string;
  tariffPriceOptionId?: string;
  deviceCount?: number;
  proxyTariffId?: string;
  singboxTariffId?: string;
  extraOption?: { kind: "traffic" | "devices" | "servers"; productId: string; targetSubscriptionId?: string };
  customBuild?: { days: number; devices: number; trafficGb?: number };
  asAdditional?: boolean;
  asGift?: boolean;
  extendsSecondarySubId?: string;
  removeExtrasOnActivate?: boolean;
  replaceTrialSubId?: string;
}

function paymentBase(product: CheckoutProduct): PaymentBase {
  switch (product.kind) {
    case "topup":
      return { amount: product.amount };
    case "tariff":
      return {
        amount: product.amount,
        currency: product.currency,
        tariffId: product.tariffId,
        tariffPriceOptionId: product.tariffPriceOptionId,
        deviceCount: product.deviceCount,
        promoCode: product.promoCode,
        asAdditional: product.asAdditional,
        asGift: product.asGift,
        extendsSecondarySubId: product.extendsSecondarySubId,
        removeExtrasOnActivate: product.removeExtrasOnActivate,
        replaceTrialSubId: product.replaceTrialSubId,
      };
    case "proxy":
      return { amount: product.amount, currency: product.currency, proxyTariffId: product.proxyTariffId, promoCode: product.promoCode };
    case "singbox":
      return { amount: product.amount, currency: product.currency, singboxTariffId: product.singboxTariffId, promoCode: product.promoCode };
    case "option":
      return { extraOption: product.extraOption, promoCode: product.promoCode };
    case "custom":
      return { customBuild: product.customBuild, promoCode: product.promoCode, currency: product.currency };
  }
}

function yoomoneyUrl(form: { receiver: string; sum: number; label: string; paymentType: string; successURL: string }): string {
  return `https://yoomoney.ru/quickpay/confirm.xml?quickpay-form=shop&receiver=${encodeURIComponent(form.receiver)}&sum=${form.sum}&label=${encodeURIComponent(form.label)}&paymentType=${form.paymentType}&successURL=${encodeURIComponent(form.successURL)}`;
}

/** Создаёт платёж выбранным способом. Бросает ошибку с текстом от API. */
export async function startCheckout(
  token: string,
  method: CheckoutMethod,
  product: CheckoutProduct,
): Promise<CheckoutResult> {
  if (method.kind === "balance") return payFromBalance(token, product);

  const base = paymentBase(product);

  switch (method.kind) {
    case "platega": {
      if (method.plategaId == null) throw new Error("Способ оплаты недоступен");
      const res = await api.clientCreatePlategaPayment(token, {
        ...base,
        paymentMethod: method.plategaId,
        description: base.description,
      });
      return { url: res.paymentUrl, provider: method.label, paymentId: res.paymentId };
    }
    case "yookassa": {
      const res = await api.yookassaCreatePayment(token, { ...base, currency: "RUB" });
      return { url: res.confirmationUrl, provider: method.label, paymentId: res.paymentId };
    }
    case "yoomoney": {
      const res = await api.yoomoneyCreateFormPayment(token, { ...base, paymentType: "AC" });
      const url = res.paymentUrl || (res.form ? yoomoneyUrl(res.form) : "");
      if (!url) throw new Error("Не удалось получить ссылку на оплату");
      return { url, provider: method.label, paymentId: res.paymentId };
    }
    case "telegram_stars": {
      const res = await api.starsCreatePayment(token, { ...base } as Record<string, unknown>);
      return { url: res.payUrl, provider: "Telegram Stars", paymentId: res.paymentId };
    }
    case "cryptopay": {
      const res = await api.cryptopayCreatePayment(token, base);
      const url = res.miniAppPayUrl ?? res.webAppPayUrl ?? res.payUrl;
      return { url, provider: method.label, paymentId: res.paymentId };
    }
    case "heleket": {
      const res = await api.heleketCreatePayment(token, base);
      return { url: res.payUrl, provider: method.label, paymentId: res.paymentId };
    }
    case "rollypay": {
      const res = await api.rollypayCreatePayment(token, base);
      return { url: res.payUrl, provider: method.label, paymentId: res.paymentId };
    }
    case "paritypay": {
      const res = await api.paritypayCreatePayment(token, base);
      return { url: res.payUrl, provider: method.label, paymentId: res.paymentId };
    }
    case "cloudpayments": {
      const res = await api.cloudpaymentsCreatePayment(token, base);
      return { url: res.payUrl, provider: method.label, paymentId: res.paymentId };
    }
    case "lava": {
      const res = await api.lavaCreatePayment(token, base);
      return { url: res.payUrl, provider: method.label, paymentId: res.paymentId };
    }
    case "overpay": {
      const res = await api.overpayCreatePayment(token, base);
      return { url: res.payUrl, provider: method.label, paymentId: res.paymentId };
    }
    default:
      throw new Error("Способ оплаты недоступен");
  }
}

async function payFromBalance(token: string, product: CheckoutProduct): Promise<CheckoutResult> {
  switch (product.kind) {
    case "tariff": {
      const res = await api.clientPayByBalance(token, {
        tariffId: product.tariffId,
        tariffPriceOptionId: product.tariffPriceOptionId,
        deviceCount: product.deviceCount,
        promoCode: product.promoCode,
        asAdditional: product.asAdditional,
        asGift: product.asGift,
        extendsSecondarySubId: product.extendsSecondarySubId,
        removeExtrasOnActivate: product.removeExtrasOnActivate,
        replaceTrialSubId: product.replaceTrialSubId,
      });
      return { balanceApplied: true, message: res.message };
    }
    case "proxy": {
      const res = await api.clientPayByBalance(token, { proxyTariffId: product.proxyTariffId });
      return { balanceApplied: true, message: res.message };
    }
    case "singbox": {
      const res = await api.clientPayByBalance(token, { singboxTariffId: product.singboxTariffId });
      return { balanceApplied: true, message: res.message };
    }
    case "option": {
      const res = await api.clientPayOptionByBalance(token, {
        extraOption: { kind: product.extraOption.kind, productId: product.extraOption.productId },
        targetSubscriptionId: product.extraOption.targetSubscriptionId,
      });
      return { balanceApplied: true, message: res.message };
    }
    case "custom": {
      const res = await api.customBuildPayBalance(token, {
        days: product.customBuild.days,
        devices: product.customBuild.devices,
        trafficGb: product.customBuild.trafficGb,
        promoCode: product.promoCode,
      });
      return { balanceApplied: true, message: res.message };
    }
    default:
      throw new Error("Оплата с баланса недоступна для этого товара");
  }
}

