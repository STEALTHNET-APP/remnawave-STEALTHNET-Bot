import { z } from "zod";

export type PlategaTransactionParams = {
  amount: number;
  currency: string;
  orderId: string;
  paymentMethod: number;
  returnUrl: string;
  failedUrl: string;
  description?: string;
  email?: string | null;
  metadata?: Record<string, unknown>;
};

const payerEmailSchema = z.string().email();

export function buildPlategaTransactionBody(params: PlategaTransactionParams): Record<string, unknown> {
  const { amount, currency, orderId, paymentMethod, returnUrl, failedUrl, description } = params;
  const body: Record<string, unknown> = {
    paymentMethod: Number(paymentMethod) || 2,
    paymentDetails: { amount: Number(amount), currency: currency.toUpperCase() },
    description: description || `Оплата заказа ${orderId}`,
    return: returnUrl,
    failedUrl,
    payload: orderId,
  };

  const email = params.email?.trim();
  const metadata = { ...params.metadata };
  if (email && payerEmailSchema.safeParse(email).success) metadata.email = email;
  if (Object.keys(metadata).length > 0) body.metadata = metadata;

  return body;
}
