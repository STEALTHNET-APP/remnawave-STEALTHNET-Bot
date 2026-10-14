/**
 * Слияние двух клиентских аккаунтов в один (схема «инициатор — основной»).
 *
 * Используется при привязке Telegram/email, когда обнаруживается второй аккаунт
 * того же человека:
 *   - привязка TG: у Telegram-аккаунта нет email/пароля/OAuth → его данные
 *     (подписки, баланс, платежи, рефералы) переезжают в аккаунт-инициатор,
 *     сам он удаляется, telegramId переходит инициатору;
 *   - привязка email: владелец почты подтвердил письмо и у него нет Telegram →
 *     аналогично сливается в инициатора, email переходит инициатору.
 *
 * ВСЁ выполняется одной транзакцией: перенос FK-строк → чистка pending-заявок →
 * удаление поглощаемого клиента (освобождает unique telegramId/email) →
 * обновление полей основного. Каждая подписка несёт собственный remnawaveUuid.
 * После транзакции root-юзер поглощаемого в Remnawave (если остался ничейным)
 * удаляется (issue #84) — best-effort, падение НЕ роняет уже успешный merge.
 */

import { prisma } from "../../db.js";

import { isRemnaConfigured, remnaDeleteUser } from "../remna/remna.client.js";

export interface MergeAssignFields {
  /** Присвоить основному telegramId (обычно — телеграм поглощаемого). */
  telegramId?: string;
  telegramUsername?: string | null;
  /** Присвоить основному email (обычно — почта поглощаемого). */
  email?: string;
}

export interface MergeClientsResult {
  movedSubscriptions: number;
  movedPayments: number;
  balanceAdded: number;
}

export async function mergeClients(
  primaryId: string,
  absorbedId: string,
  assign: MergeAssignFields = {},
): Promise<MergeClientsResult> {
  if (primaryId === absorbedId) throw new Error("Нельзя объединить аккаунт сам с собой");

  // ISSUE #84: фиксируем root-uuid поглощаемого — он нужен для удаления из Remna ПОСЛЕ транзакции.
  let absorbedRemnawaveUuid: string | null = null;
  let primaryRemnawaveUuid: string | null = null;

  const result = await prisma.$transaction(
    async (tx) => {
      const [primary, absorbed] = await Promise.all([
        tx.client.findUnique({ where: { id: primaryId } }),
        tx.client.findUnique({ where: { id: absorbedId } }),
      ]);
      if (!primary) throw new Error("Основной аккаунт не найден");
      if (!absorbed) throw new Error("Объединяемый аккаунт не найден");
      // ISSUE #84: запоминаем root-uuid до того, как строка поглощаемого будет удалена.
      absorbedRemnawaveUuid = absorbed.remnawaveUuid;
      primaryRemnawaveUuid = primary.remnawaveUuid;

      // ── Подписки: unique(ownerId, subscriptionIndex) → переносим по одной с реиндексацией ──
      const primaryMax = await tx.subscription.aggregate({
        where: { ownerId: primaryId },
        _max: { subscriptionIndex: true },
      });
      let nextIdx = (primaryMax._max.subscriptionIndex ?? -1) + 1;
      const absorbedSubs = await tx.subscription.findMany({
        where: { ownerId: absorbedId },
        orderBy: { subscriptionIndex: "asc" },
        select: { id: true },
      });
      for (const sub of absorbedSubs) {
        await tx.subscription.update({
          where: { id: sub.id },
          data: { ownerId: primaryId, subscriptionIndex: nextIdx++ },
        });
      }
      await tx.subscription.updateMany({
        where: { giftedToClientId: absorbedId },
        data: { giftedToClientId: primaryId },
      });

      // ── Прямые переносы clientId → primary (без unique-конфликтов) ──
      const movedPayments = (
        await tx.payment.updateMany({ where: { clientId: absorbedId }, data: { clientId: primaryId } })
      ).count;
      await tx.ticket.updateMany({ where: { clientId: absorbedId }, data: { clientId: primaryId } });
      await tx.withdrawalRequest.updateMany({ where: { clientId: absorbedId }, data: { clientId: primaryId } });
      await tx.referralCredit.updateMany({ where: { referrerId: absorbedId }, data: { referrerId: primaryId } });
      await tx.promoCodeUsage.updateMany({ where: { clientId: absorbedId }, data: { clientId: primaryId } });
      await tx.autoBroadcastLog.updateMany({ where: { clientId: absorbedId }, data: { clientId: primaryId } });
      await tx.proxySlot.updateMany({ where: { clientId: absorbedId }, data: { clientId: primaryId } });
      await tx.singboxSlot.updateMany({ where: { clientId: absorbedId }, data: { clientId: primaryId } });
      await tx.contestWinner.updateMany({ where: { clientId: absorbedId }, data: { clientId: primaryId } });
      await tx.giftHistory.updateMany({ where: { clientId: absorbedId }, data: { clientId: primaryId } });
      await tx.giftCode.updateMany({ where: { creatorId: absorbedId }, data: { creatorId: primaryId } });
      await tx.giftCode.updateMany({ where: { redeemedById: absorbedId }, data: { redeemedById: primaryId } });

      // ── Переносы с дедупликацией по unique-констрейнтам ──
      // PromoActivation: unique(promoGroupId, clientId)
      const primaryPromos = await tx.promoActivation.findMany({
        where: { clientId: primaryId },
        select: { promoGroupId: true },
      });
      const havePromo = new Set(primaryPromos.map((p) => p.promoGroupId));
      const absorbedPromos = await tx.promoActivation.findMany({ where: { clientId: absorbedId } });
      for (const pa of absorbedPromos) {
        if (havePromo.has(pa.promoGroupId)) {
          await tx.promoActivation.delete({ where: { id: pa.id } });
        } else {
          await tx.promoActivation.update({ where: { id: pa.id }, data: { clientId: primaryId } });
        }
      }
      // ClientTrialUsage: unique(clientId, trialId)
      const primaryTrials = await tx.clientTrialUsage.findMany({
        where: { clientId: primaryId },
        select: { trialId: true },
      });
      const haveTrial = new Set(primaryTrials.map((t) => t.trialId));
      const absorbedTrials = await tx.clientTrialUsage.findMany({ where: { clientId: absorbedId } });
      for (const tu of absorbedTrials) {
        if (haveTrial.has(tu.trialId)) {
          await tx.clientTrialUsage.delete({ where: { id: tu.id } });
        } else {
          await tx.clientTrialUsage.update({ where: { id: tu.id }, data: { clientId: primaryId } });
        }
      }

      // ── Рефералы-дети поглощаемого → приглашены основным ──
      await tx.client.updateMany({
        where: { referrerId: absorbedId },
        data: { referrerId: primaryId },
      });

      // ── Реферер-родитель основного ──
      let newReferrerId = primary.referrerId;
      if (primary.referrerId === absorbedId) {
        // Поглощаемый пригласил основного — наследуем его цепочку (не сам на себя).
        newReferrerId = absorbed.referrerId && absorbed.referrerId !== primaryId ? absorbed.referrerId : null;
      } else if (!primary.referrerId && absorbed.referrerId && absorbed.referrerId !== primaryId) {
        newReferrerId = absorbed.referrerId;
      }

      // ── Pending-заявки поглощаемого (FK-каскада на них нет — чистим руками) ──
      await tx.pendingTelegramLink.deleteMany({ where: { clientId: absorbedId } });
      await tx.pendingEmailLink.deleteMany({ where: { clientId: absorbedId } });

      // ── Удаляем поглощаемого (освобождает unique telegramId/email), затем обновляем основного ──
      await tx.client.delete({ where: { id: absorbedId } });

      await tx.client.update({
        where: { id: primaryId },
        data: {
          balance: primary.balance + absorbed.balance,
          trialUsed: primary.trialUsed || absorbed.trialUsed,
          referrerId: newReferrerId,
          // Способы входа поглощаемого переносим только в ПУСТЫЕ поля основного,
          // чтобы после слияния человек мог логиниться всеми прежними способами
          // (напр. основной пришёл из бота без пароля, поглощаемый — email+пароль).
          ...(primary.passwordHash || !absorbed.passwordHash ? {} : { passwordHash: absorbed.passwordHash }),
          ...(primary.googleId || !absorbed.googleId ? {} : { googleId: absorbed.googleId }),
          ...(primary.appleId || !absorbed.appleId ? {} : { appleId: absorbed.appleId }),
          // legacy-указатели переносим только в пустые поля основного
          ...(primary.remnawaveUuid || !absorbed.remnawaveUuid ? {} : { remnawaveUuid: absorbed.remnawaveUuid }),
          ...(primary.currentTariffId || !absorbed.currentTariffId ? {} : { currentTariffId: absorbed.currentTariffId }),
          ...(assign.telegramId !== undefined
            ? {
                telegramId: assign.telegramId,
                telegramUnreachable:
                  absorbed.telegramId === assign.telegramId ? absorbed.telegramUnreachable : false,
              }
            : {}),
          ...(assign.telegramUsername !== undefined ? { telegramUsername: assign.telegramUsername } : {}),
          ...(assign.email !== undefined ? { email: assign.email } : {}),
        },
      });

      return {
        movedSubscriptions: absorbedSubs.length,
        movedPayments,
        balanceAdded: absorbed.balance,
      };
    },
    { timeout: 30000, maxWait: 10000 },
  );

  // ── ISSUE #84 / #186: после успешной транзакции удаляем ничейный root-юзер поглощаемого из Remna ──
  // Root-uuid клиента обычно совпадает с remnawaveUuid его подписки #0, а подписки переезжают
  // к основному ВМЕСТЕ со своими uuid. Поэтому удаляем только если на uuid больше никто не
  // ссылается (ни Subscription, ни Client) — иначе пропадёт оплаченный доступ (issue #186).
  // Если удаление падает — только warning, НЕ роняем merge (транзакция уже успешна).
  if (absorbedRemnawaveUuid && isRemnaConfigured()) {
    const uuid: string = absorbedRemnawaveUuid;
    let referenced: ReadonlySet<string> | null = null;
    try {
      const [subRefs, clientRefs] = await Promise.all([
        prisma.subscription.count({ where: { remnawaveUuid: uuid } }),
        prisma.client.count({ where: { remnawaveUuid: uuid } }),
      ]);
      referenced = subRefs + clientRefs > 0 ? new Set([uuid]) : new Set<string>();
    } catch (e) {
      console.warn(`[merge-clients] issue #186: не удалось проверить ссылки на ${uuid}, удаление пропущено:`, e);
    }
    const toDelete = referenced ? pickRemnaUserToDelete(uuid, primaryRemnawaveUuid, referenced) : null;
    if (toDelete) {
      const del = await remnaDeleteUser(toDelete);
      if (del.error && del.status !== 404) {
        console.warn(
          `[merge-clients] ISSUE #84: не удалось удалить ничейный root-юзер поглощаемого ${toDelete} из Remna:`,
          del.error,
        );
      }
    } else if (referenced) {
      console.info(`[merge-clients] issue #186: Remna-юзер ${uuid} поглощаемого ещё используется — не удаляем`);
    }
  }

  return result;
}

/**
 * Какой Remna-юзер поглощаемого можно удалить после merge (issue #84 / #186).
 * Возвращает uuid только если он есть, не совпадает с root-uuid основного и на него
 * не ссылается ни одна подписка/клиент после merge (`referencedUuids`). Иначе null.
 */
export function pickRemnaUserToDelete(
  absorbedRootUuid: string | null,
  primaryRootUuid: string | null,
  referencedUuids: ReadonlySet<string>,
): string | null {
  if (!absorbedRootUuid) return null;
  if (absorbedRootUuid === primaryRootUuid) return null;
  if (referencedUuids.has(absorbedRootUuid)) return null;
  return absorbedRootUuid;
}

/**
 * Можно ли слить Telegram-аккаунт в инициатора при привязке TG:
 * у него не должно быть собственных web-идентичностей (email/пароль/OAuth).
 * Баланс/платежи/подписки слиянию НЕ мешают — они переносятся.
 */
export function isBotOnlyAccount(c: {
  email: string | null;
  passwordHash: string | null;
  googleId: string | null;
  appleId: string | null;
}): boolean {
  return !c.email && !c.passwordHash && !c.googleId && !c.appleId;
}
