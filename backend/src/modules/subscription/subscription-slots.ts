export type SlotCandidate = {
  id: string;
  subscriptionIndex: number;
  giftStatus?: string | null;
};

export function isReservedGiftStatus(giftStatus: string | null | undefined): boolean {
  return giftStatus === "GIFT_RESERVED" || giftStatus === "GIFT_CODE_ACTIVE";
}

export function planSubscriptionSlotOrder<T extends SlotCandidate>(subs: T[]): {
  ordered: T[];
  promotedId: string | null;
  reindexed: boolean;
} {
  const usable = subs.filter((sub) => !isReservedGiftStatus(sub.giftStatus));
  if (usable.length === 0) return { ordered: [], promotedId: null, reindexed: false };

  const ordered = [...usable, ...subs.filter((sub) => isReservedGiftStatus(sub.giftStatus))];

  return {
    ordered,
    promotedId: ordered[0].subscriptionIndex !== 0 ? ordered[0].id : null,
    reindexed: ordered.some((sub, i) => sub.subscriptionIndex !== i),
  };
}
