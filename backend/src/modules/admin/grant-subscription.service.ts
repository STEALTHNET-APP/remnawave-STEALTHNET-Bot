import { getSystemConfig } from "../client/client.service.js";
import { createAdditionalSubscription } from "../gift/gift.service.js";
import { findConvertibleSubscription, extendSecondarySubscription, consolidateToSingleSubscription } from "../tariff/tariff-activation.service.js";

type GrantTariff = Parameters<typeof createAdditionalSubscription>[1] & { id: string };

/** Admin grants obey the global single-subscription setting, including trial conversion.
 * A failed update must never fall through to creating a second Remnawave user.
 * If an existing subscription could not be reused (e.g. its Remnawave user is gone)
 * a new one is created and — in single mode — the leftover duplicates are cleaned up
 * so the client keeps EXACTLY ONE non-gift subscription, mirroring the purchase flow
 * (activateTariffByPaymentId branch 2).
 */
export async function grantSubscriptionTariff(clientId: string, tariff: GrantTariff, extraDevices = 0): ReturnType<typeof createAdditionalSubscription> {
  const config = await getSystemConfig();
  const multiSubEnabled = config.multiSubscriptionsEnabled !== false;
  if (!multiSubEnabled) {
    const existing = await findConvertibleSubscription(clientId, tariff.id, false);
    if (existing) {
      const result = await extendSecondarySubscription(
        existing.id, tariff, undefined, extraDevices, false, false, !existing.sameTariff,
      );
      if (!result.ok) return result;
      return { ok: true, data: { subscriptionId: existing.id, subscriptionIndex: existing.subscriptionIndex } };
    }
  }
  const created = await createAdditionalSubscription(clientId, tariff, {
    skipConfigCheck: true, extraDevices, purchasedAsGift: false,
  });
  if (created.ok && !multiSubEnabled) {
    await consolidateToSingleSubscription(clientId, created.data.subscriptionId).catch(() => {});
  }
  return created;
}
