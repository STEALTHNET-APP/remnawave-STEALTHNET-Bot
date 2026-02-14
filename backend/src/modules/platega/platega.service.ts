/**
 * Platega.io — создание платежей и обработка callback
 * https://docs.platega.io/
 */

const PLATEGA_API_BASE = "https://app.platega.io";

export type PlategaConfig = {
  merchantId: string;
  secret: string;
};

export function isPlategaConfigured(config: PlategaConfig | null): boolean {
  return Boolean(config?.merchantId?.trim() && config?.secret?.trim());
}

/**
 * Создать транзакцию в Platega, получить ссылку на оплату
 * paymentMethod: 2=СПБ, 11=Карты, 12=Международный, 13=Криптовалюта
 */
export async function createPlategaTransaction(
  config: PlategaConfig,
  params: {
    amount: number;
    currency: string;
    orderId: string;
    paymentMethod: number;
    returnUrl: string;
    failedUrl: string;
    description?: string;
  }
): Promise<{ paymentUrl: string; transactionId: string } | { error: string }> {
  const { amount, currency, orderId, paymentMethod, returnUrl, failedUrl, description } = params;
  const url = `${PLATEGA_API_BASE}/transaction/process`;
  const body: Record<string, unknown> = {
    paymentMethod: Number(paymentMethod) || 2,
    paymentDetails: { amount: Number(amount), currency: currency.toUpperCase() },
    description: description || `Оплата заказа ${orderId}`,
    return: returnUrl,
    failedUrl,
    payload: orderId, // orderId передаём через payload — единственное кастомное поле в API Platega
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-MerchantId": config.merchantId.trim(),
    "X-Secret": config.secret.trim(),
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const text = await res.text();
    let data: Record<string, unknown>;
    try {
      data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      return { error: `Platega: invalid response (${res.status})` };
    }

    if (res.status === 401) {
      return { error: "Platega: неверный Merchant ID или секрет" };
    }
    if (res.status !== 200) {
      const msg = (data.message as string) || (data.error as string) || text?.slice(0, 200);
      return { error: `Platega: ${msg}` };
    }

    const paymentUrl = (data.redirect as string) || (data.url as string) || (data.paymentUrl as string);
    const transactionId = (data.transactionId as string) || (data.id as string);

    if (!paymentUrl) {
      return { error: "Platega не вернул ссылку на оплату" };
    }

    return { paymentUrl, transactionId: transactionId || "" };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { error: `Platega: ${message}` };
  }
}
