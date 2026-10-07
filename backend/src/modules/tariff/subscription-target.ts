/**
 * Чистая логика выбора подписки, которую покупка тарифа должна конвертировать/продлить
 * вместо создания новой. Без БД и Remnawave — сюда приходят уже загруженные кандидаты.
 */

/**
 * Легаси-триал (POST /api/client/trial) хранится как подписка без тарифа, без trialId
 * и без цены. Окончательно он подтверждается сквадом Remnawave (см. isOnTrialSquad) —
 * тем же правилом, по которому UI называет подписку «Тест».
 * customPrice отсекает кастом-билды (у них tariffId тоже null, но цена записана).
 */
export function isLegacyTrialRecord(sub: {
  tariffId: string | null;
  trialId: string | null;
  purchasedAsGift: boolean;
  giftStatus: string | null;
  remnawaveUuid: string | null;
  customPrice: number | null;
}): boolean {
  return sub.tariffId == null
    && sub.trialId == null
    && !sub.purchasedAsGift
    && sub.giftStatus == null
    && sub.remnawaveUuid != null
    && sub.customPrice == null;
}

/** Remna-юзер сидит на триальном скваде из настроек. Без настроенного сквада — не триал. */
export function isOnTrialSquad(squadUuids: readonly string[], trialSquadUuid: string | null | undefined): boolean {
  const trial = trialSquadUuid?.trim();
  if (!trial) return false;
  return squadUuids.includes(trial);
}

export type ConvertibleCandidate = {
  id: string;
  subscriptionIndex: number;
  tariffId: string | null;
  /** categoryId тарифа подписки (null — без тарифа/категории) */
  categoryId: string | null;
  trialId: string | null;
  expireAt: Date | null;
  isLegacyTrial: boolean;
};

export type PickOptions = {
  /** покупаемый тариф */
  tariffId: string;
  /** категория покупаемого тарифа */
  categoryId: string | null;
  multiSubEnabled: boolean;
  /** категория покупаемого тарифа в режиме «одна подписка из категории» */
  perCategorySingle: boolean;
  /** явный выбор пользователя (replaceTrialSubId) */
  preferredSubId?: string | null;
};

function byExpireDesc(a: ConvertibleCandidate, b: ConvertibleCandidate): number {
  const ta = a.expireAt?.getTime();
  const tb = b.expireAt?.getTime();
  if (ta == null && tb == null) return 0;
  if (ta == null) return 1; // nulls last
  if (tb == null) return -1;
  return tb - ta;
}

function latest(list: ConvertibleCandidate[]): ConvertibleCandidate | null {
  return [...list].sort(byExpireDesc)[0] ?? null;
}

/**
 * Кандидаты — НЕ подарочные подписки клиента, привязанные к Remnawave.
 *
 * Мульти ВЫКЛ (глобальный single): тот же тариф (не триал) → явно выбранный триал → платная
 *   (tariffId, не триал) с max expireAt → любая с max expireAt. Платная предпочитается
 *   триалу: иначе живущий дольше триал оставался бы, а платную снёс бы consolidate.
 * Мульти ВКЛ + single-категория: явный выбор в категории → тот же тариф → любая из категории.
 * Мульти ВКЛ, иначе (и fallback для категории): легаси-триал заменяется на месте, если
 *   пользователь не выбрал явно другой триал. Платные подписки и мульти-триалы не трогаем —
 *   для них остаётся создание новой подписки / replaceTrialOnPurchase.
 */
export function pickConvertibleSubscription(
  candidates: readonly ConvertibleCandidate[],
  opts: PickOptions,
): ConvertibleCandidate | null {
  const preferred = opts.preferredSubId
    ? candidates.find((c) => c.id === opts.preferredSubId) ?? null
    : null;
  const sameTariff = (c: ConvertibleCandidate) => c.tariffId === opts.tariffId && c.trialId == null;

  if (!opts.multiSubEnabled) {
    // Явный выбор (бот шлёт replaceTrialSubId при любом выборе) побеждает только если это
    // триал и у клиента нет платной подписки того же тарифа — иначе продлеваем платную,
    // а не жёстко заменяем триал с последующим удалением платной консолидацией.
    const same = latest(candidates.filter(sameTariff));
    if (same) return same;
    if (preferred && (preferred.trialId != null || preferred.isLegacyTrial)) return preferred;
    const paid = latest(candidates.filter((c) => c.tariffId != null && c.trialId == null));
    if (paid) return paid;
    return latest([...candidates]);
  }

  if (opts.perCategorySingle && opts.categoryId != null) {
    const inCategory = candidates.filter((c) => c.tariffId != null && c.categoryId === opts.categoryId);
    if (preferred && inCategory.includes(preferred)) return preferred;
    const hit = latest(inCategory.filter(sameTariff)) ?? latest(inCategory);
    if (hit) return hit;
  }

  if (opts.preferredSubId && !(preferred?.isLegacyTrial)) return null;
  return latest(candidates.filter((c) => c.isLegacyTrial));
}
