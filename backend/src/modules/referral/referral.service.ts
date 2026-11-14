/**
 * Трёхуровневая реферальная система: начисление процентов от пополнений
 * рефералов уровня 1, 2 и 3 при переходе платежа в статус PAID.
 * Начисляется только с реальных внешних платежей (см. isReferralEligiblePayment):
 * траты внутреннего баланса и админские выдачи бонус не дают.
 */

import { prisma } from "../../db.js";
import { getSystemConfig } from "../client/client.service.js";

/**
 * Провайдеры, которые двигают внутренние средства, а не реальные деньги:
 * - "balance" — оплата с внутреннего баланса (покупка тарифа, автопродление,
 *   доп. подписка). Деньги уже были учтены при пополнении через внешний провайдер.
 * - "admin_grant" — выдача тарифа админом (amount = 0, денег нет).
 * Реферальный бонус с них не начисляется, иначе одни и те же деньги дают
 * бонус дважды (issue #201).
 */
const INTERNAL_PAYMENT_PROVIDERS: ReadonlySet<string> = new Set(["balance", "admin_grant"]);

/**
 * true — платёж оплачен реальными внешними деньгами (Platega, YooKassa, CryptoPay и т.п.)
 * и с него можно начислять реферальный бонус. Пустой/неизвестный provider — не начисляем.
 */
export function isReferralEligiblePayment(provider: string | null | undefined): boolean {
  if (typeof provider !== "string") return false;
  const normalized = provider.trim().toLowerCase();
  if (normalized === "") return false;
  return !INTERNAL_PAYMENT_PROVIDERS.has(normalized);
}

/**
 * Сумма, от которой считается реферальный бонус. Если платёж смешанный
 * (часть списана с внутреннего баланса, часть — внешним провайдером, напр.
 * автопродление ЮKassa + баланс), metadata.cardPortion хранит реально
 * оплаченную внешнюю часть — бонус считается только от неё (issue #201).
 * Некорректные/отсутствующие данные — вся сумма платежа.
 */
export function getReferralBaseAmount(amount: number, metadata: string | null | undefined): number {
  if (!metadata) return amount;
  let parsed: unknown;
  try {
    parsed = JSON.parse(metadata);
  } catch {
    return amount;
  }
  if (typeof parsed !== "object" || parsed === null || !("cardPortion" in parsed)) return amount;
  const cardPortion: unknown = parsed.cardPortion;
  if (typeof cardPortion !== "number" || !Number.isFinite(cardPortion) || cardPortion < 0) return amount;
  return Math.min(cardPortion, amount);
}

/**
 * Распределяет реферальные бонусы по цепочке рефереров (до 3 уровней)
 * при оплате. Вызывать один раз при переводе платежа в PAID.
 * Идемпотентно: повторный вызов для того же платежа не дублирует начисления
 * (проверка по referralDistributedAt).
 */
export async function distributeReferralRewards(paymentId: string): Promise<{ distributed: boolean; message: string }> {
  const config = await getSystemConfig();
  if (config.referralRewardMode && config.referralRewardMode !== "percent") {
    const { grantReferralReward } = await import("./referral-rewards.service.js");
    return grantReferralReward(paymentId, config);
  }
  const p1 = config.defaultReferralPercent;
  const p2 = config.referralPercentLevel2;
  const p3 = config.referralPercentLevel3;

  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({
      where: { id: paymentId },
      include: {
        client: {
          include: {
            referrer: {
              include: {
                referrer: {
                  include: {
                    referrer: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!payment) {
      return { distributed: false, message: "Payment not found" };
    }
    if (payment.status !== "PAID") {
      return { distributed: false, message: "Payment is not PAID" };
    }
    if (!isReferralEligiblePayment(payment.provider)) {
      return { distributed: false, message: "Payment is not funded by an external provider; no referral rewards" };
    }
    if (payment.referralDistributedAt != null) {
      return { distributed: false, message: "Referral rewards already distributed for this payment" };
    }

    // Claim (идемпотентность при гонках/дублях webhook)
    const claim = await tx.payment.updateMany({
      where: { id: paymentId, status: "PAID", referralDistributedAt: null },
      data: { referralDistributedAt: new Date() },
    });
    if (claim.count === 0) {
      return { distributed: false, message: "Referral rewards already distributed for this payment" };
    }

    const level1 = payment.client.referrer ?? null;
    const level2 = level1?.referrer ?? null;
    const level3 = level2?.referrer ?? null;

    // v5.0.0: после выпила multi-bot реферальный бонус считается от amount
    // (раньше использовалось baseAmount = amount без наценки клона).
    const amount = getReferralBaseAmount(payment.amount, payment.metadata);
    const updates: { clientId: string; bonus: number; level: number }[] = [];
    // ВНИМАНИЕ: Client.referralPercent — это индивидуальный override клиента
    // как реферера ПЕРВОГО уровня (т.е. процент с его прямых рефералов).
    // Для 2/3 уровня этот override НЕ применяется — там всегда глобальный
    // дефолт из SystemConfig.referralPercentLevel2 / referralPercentLevel3.
    // Раньше тут было `level2?.referralPercent ?? p2` — это давало бонус
    // 2 уровня по проценту 1-го уровня (если у промежуточного реферера
    // стоял VIP-override). См. отчёт пользователя 14.05.2026.
    const pct1 = level1?.referralPercent ?? p1;
    const pct2 = p2;
    const pct3 = p3;
    if (level1 && !level1.isBlocked && pct1 > 0) {
      updates.push({ clientId: level1.id, bonus: Math.round(amount * (pct1 / 100) * 100) / 100, level: 1 });
    }
    if (level2 && !level2.isBlocked && pct2 > 0) {
      updates.push({ clientId: level2.id, bonus: Math.round(amount * (pct2 / 100) * 100) / 100, level: 2 });
    }
    if (level3 && !level3.isBlocked && pct3 > 0) {
      updates.push({ clientId: level3.id, bonus: Math.round(amount * (pct3 / 100) * 100) / 100, level: 3 });
    }

    for (const { clientId, bonus, level } of updates) {
      await tx.client.update({
        where: { id: clientId },
        data: { balance: { increment: bonus } },
      });
      await tx.referralCredit.create({
        data: { referrerId: clientId, paymentId, amount: bonus, level },
      });
    }

    if (updates.length === 0) {
      return { distributed: true, message: "No referrers or all blocked; payment marked as distributed" };
    }

    return {
      distributed: true,
      message: `Distributed to ${updates.length} referrer(s)`,
    };
  });
}
