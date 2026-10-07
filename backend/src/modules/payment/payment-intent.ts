export type PaymentIntentInput = {
  asAdditional?: boolean;
  asGift?: boolean;
  extendsSecondarySubId?: string;
  removeExtrasOnActivate?: boolean;
  replaceTrialSubId?: string;
};

export type ParsedPaymentIntent = {
  renewalTargetId: string | null;
  isAdditionalSubscription: boolean;
};

export class PaymentIntentConflictError extends Error {
  readonly code = "PAYMENT_INTENT_CONFLICT";

  constructor() {
    super("PAYMENT_INTENT_CONFLICT: платёж не может одновременно продлевать и создавать подписку");
    this.name = "PaymentIntentConflictError";
  }
}

export function parsePaymentIntentMetadata(metadata: unknown): ParsedPaymentIntent {
  let value: unknown = metadata;
  if (typeof metadata === "string") {
    try {
      value = JSON.parse(metadata);
    } catch {
      value = null;
    }
  }

  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const renewalTargetId = typeof record.extendsSecondarySubId === "string" && record.extendsSecondarySubId.trim()
    ? record.extendsSecondarySubId.trim()
    : null;
  const isAdditionalSubscription = record.isAdditionalSubscription === true;

  if (renewalTargetId && isAdditionalSubscription) throw new PaymentIntentConflictError();
  return { renewalTargetId, isAdditionalSubscription };
}

export function buildPaymentIntentMetadata(input: PaymentIntentInput): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};

  if (input.extendsSecondarySubId) {
    metadata.extendsSecondarySubId = input.extendsSecondarySubId;
    if (input.removeExtrasOnActivate === true) metadata.removeExtrasOnActivate = true;
  } else if (input.asAdditional) {
    metadata.isAdditionalSubscription = true;
  }

  if (input.asGift) metadata.purchasedAsGift = true;
  if (input.replaceTrialSubId) metadata.replaceTrialSubId = input.replaceTrialSubId;

  return metadata;
}

/**
 * Продление обязано сохранять тариф подписки. Исключения:
 * - триал: переход на другой тариф разрешён правилами триала (convertEnabled /
 *   convertAllTariffs / convertTariffIds), их проверяет активация;
 * - подписка без тарифа (legacy-триал, ручная выдача): переход на тариф — это конвертация.
 */
export function isRenewalTargetTariffAllowed(
  target: { tariffId: string | null; trialId: string | null },
  tariffId: string,
): boolean {
  if (target.trialId != null || target.tariffId == null) return true;
  return target.tariffId === tariffId;
}
