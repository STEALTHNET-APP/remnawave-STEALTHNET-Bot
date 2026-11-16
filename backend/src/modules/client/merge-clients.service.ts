import { prisma } from "../../db.js";

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

  const result = await prisma.$transaction(
    async (tx) => {
      const [primary, absorbed] = await Promise.all([
        tx.client.findUnique({ where: { id: primaryId } }),
        tx.client.findUnique({ where: { id: absorbedId } }),
      ]);
      if (!primary) throw new Error("Основной аккаунт не найден");
      if (!absorbed) throw new Error("Объединяемый аккаунт не найден");
      for (const client of [primary, absorbed]) {
        if (!client.remnawaveUuid) continue;
        const refs = await tx.subscription.findMany({
          where: { remnawaveUuid: client.remnawaveUuid },
          select: { ownerId: true },
        });
        const otherClient = await tx.client.findFirst({
          where: { remnawaveUuid: client.remnawaveUuid, id: { notIn: [primaryId, absorbedId] } },
          select: { id: true },
        });
        if (otherClient || refs.some((ref) => ref.ownerId !== primaryId && ref.ownerId !== absorbedId)) {
          throw new Error("Подписка привязана к другому аккаунту. Обратитесь к администратору");
        }
        if (refs.length) continue;
        const max = await tx.subscription.aggregate({
          where: { ownerId: client.id },
          _max: { subscriptionIndex: true },
        });
        await tx.subscription.create({ data: {
          ownerId: client.id,
          remnawaveUuid: client.remnawaveUuid,
          subscriptionIndex: (max._max.subscriptionIndex ?? -1) + 1,
          tariffId: client.currentTariffId,
          autoRenewEnabled: client.autoRenewEnabled,
          autoRenewTariffId: client.autoRenewTariffId,
          autoRenewPriceOptionId: client.autoRenewPriceOptionId,
          autoRenewExtraDevices: client.autoRenewExtraDevices,
          autoRenewRetryCount: client.autoRenewRetryCount,
          autoRenewNotifiedAt: client.autoRenewNotifiedAt,
          autoRenewPromoCode: client.autoRenewPromoCode,
          currentPricePerDay: client.currentPricePerDay,
        } });
      }

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
      await tx.cloudPaymentAgreement.updateMany({ where: { clientId: absorbedId }, data: { clientId: primaryId } });
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
    { timeout: 30000, maxWait: 10000, isolationLevel: "Serializable" },
  );

  return result;
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
