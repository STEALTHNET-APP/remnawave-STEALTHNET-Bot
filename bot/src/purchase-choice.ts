export type SubscriptionPurchaseCandidate = {
  tariffId?: string | null;
};

export function shouldShowPurchaseChoice(input: {
  tariffId: string;
  subscriptions: SubscriptionPurchaseCandidate[];
  isBypass: boolean;
  isSingleCategory: boolean;
}): boolean {
  if (input.isBypass || input.isSingleCategory) return false;
  return input.subscriptions.some((subscription) => subscription.tariffId === input.tariffId);
}
