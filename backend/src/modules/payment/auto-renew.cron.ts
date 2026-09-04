import cron from "node-cron";
import { prisma } from "../../db.js";
import { randomUUID } from "crypto";
import { activateTariffByPaymentId, applyExtraDevicesPrice, parseDeviceDiscountTiers } from "../tariff/tariff-activation.service.js";
import { remnaGetUser, isRemnaConfigured } from "../remna/remna.client.js";
import { getSystemConfig } from "../client/client.service.js";
import { createYookassaAutopayment } from "../yookassa/yookassa.service.js";
import { applyPercent } from "../client/personal-discount.js";

/**
 * Считает базовую сумму автопродления для клиента: priceOption.price + extras * pricePerExtra * scaling * discount.
 */
async function computeAutoRenewBaseAmount(client: {
  id: string;
  autoRenewExtraDevices: number;
  autoRenewPriceOptionId: string | null;
  autoRenewTariff: { id: string; price: number; durationDays: number; pricePerExtraDevice: number; deviceDiscountTiers: unknown } | null;
}): Promise<{ amount: number; priceOptionId: string | null; durationDays: number; extras: number }> {
  if (!client.autoRenewTariff) return { amount: 0, priceOptionId: null, durationDays: 30, extras: 0 };
  const tariff = client.autoRenewTariff;
  let opt: { id: string; durationDays: number; price: number } | null = null;
  if (client.autoRenewPriceOptionId) {
    const savedOpt = await prisma.tariffPriceOption.findFirst({
      where: { id: client.autoRenewPriceOptionId, tariffId: tariff.id },
    });
    if (savedOpt) opt = { id: savedOpt.id, durationDays: savedOpt.durationDays, price: savedOpt.price };
  }
  if (!opt) {
    const fallback = await prisma.tariffPriceOption.findFirst({
      where: { tariffId: tariff.id },
      orderBy: { price: "asc" },
    });
    if (fallback) opt = { id: fallback.id, durationDays: fallback.durationDays, price: fallback.price };
  }
  const unitPrice = opt?.price ?? tariff.price;
  const durationDays = opt?.durationDays ?? tariff.durationDays;
  const extras = Math.max(0, client.autoRenewExtraDevices ?? 0);
  const tiers = parseDeviceDiscountTiers(tariff.deviceDiscountTiers);
  const { extrasTotal } = applyExtraDevicesPrice(tariff.pricePerExtraDevice ?? 0, extras, tiers, durationDays);
  return {
    amount: unitPrice + extrasTotal,
    priceOptionId: opt?.id ?? null,
    durationDays,
    extras,
  };
}

import {
  notifyAutoRenewSuccess,
  notifyAutoRenewFailed,
  notifyAutoRenewUpcoming,
  notifyAutoRenewRetry,
  notifyAutoRenewYookassaSuccess,
  notifyAutoRenewYookassaFailed,
  notifyAdminsAboutAutoRenewFailed,
} from "../notification/telegram-notify.service.js";
import { dispatchAutoRenewNotification, tryMarkSubDedup } from "../notification/auto-renew-notifications.service.js";

async function tryApplyPromoForAutoRenew(
  clientId: string,
  code: string | null,
  basePrice: number,
): Promise<{ finalPrice: number; promoCodeId: string | null }> {
  if (!code?.trim()) return { finalPrice: basePrice, promoCodeId: null };
  const promo = await prisma.promoCode.findUnique({ where: { code: code.trim() } });
  if (!promo || !promo.isActive || promo.type !== "DISCOUNT") {
    return { finalPrice: basePrice, promoCodeId: null };
  }
  if (promo.expiresAt && promo.expiresAt < new Date()) {
    return { finalPrice: basePrice, promoCodeId: null };
  }
  if (promo.maxUses > 0) {
    const totalUsages = await prisma.promoCodeUsage.count({ where: { promoCodeId: promo.id } });
    if (totalUsages >= promo.maxUses) return { finalPrice: basePrice, promoCodeId: null };
  }
  const clientUsages = await prisma.promoCodeUsage.count({
    where: { promoCodeId: promo.id, clientId },
  });
  if (clientUsages >= promo.maxUsesPerClient) return { finalPrice: basePrice, promoCodeId: null };

  let finalPrice = basePrice;
  if (promo.discountPercent && promo.discountPercent > 0) {
    finalPrice = Math.max(0, finalPrice - finalPrice * promo.discountPercent / 100);
  }
  if (promo.discountFixed && promo.discountFixed > 0) {
    finalPrice = Math.max(0, finalPrice - promo.discountFixed);
  }
  finalPrice = Math.round(finalPrice * 100) / 100;
  if (finalPrice <= 0) return { finalPrice: basePrice, promoCodeId: null };
  return { finalPrice, promoCodeId: promo.id };
}

export function startAutoRenewScheduler() {
  cron.schedule("* * * * *", async () => {
    try {
      await processAutoRenewals();
    } catch (e) {
      console.error("[auto-renew] Error in cron job:", e);
    }
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function processAutoRenewals() {
  if (!isRemnaConfigured()) {
    console.warn("[auto-renew] Remna is not configured. Skipping.");
    return;
  }

  const config = await getSystemConfig();
  const daysBeforeExpiry = config.autoRenewDaysBeforeExpiry ?? 1;
  const notifyDaysBefore = config.autoRenewNotifyDaysBefore ?? 3;
  const gracePeriodDays = config.autoRenewGracePeriodDays ?? 2;
  const maxRetries = config.autoRenewMaxRetries ?? 3;

  const renewThreshold = daysBeforeExpiry * DAY_MS;
  const notifyThreshold = notifyDaysBefore * DAY_MS;
  const gracePeriod = gracePeriodDays * DAY_MS;

  const clients = await prisma.client.findMany({
    where: {
      autoRenewEnabled: true,
      autoRenewTariffId: { not: null },
      remnawaveUuid: { not: null },
      isBlocked: false,
    },
    include: { autoRenewTariff: true },
  });

  const now = Date.now();

  for (const client of clients) {
    if (!client.remnawaveUuid || !client.autoRenewTariff) continue;

    const primaryHasAutoRenew = await prisma.subscription.findUnique({
      where: { ownerId_subscriptionIndex: { ownerId: client.id, subscriptionIndex: 0 } },
      select: { autoRenewEnabled: true },
    });
    if (primaryHasAutoRenew?.autoRenewEnabled === true) {
      continue;
    }

    try {
      const remnaUser = await remnaGetUser(client.remnawaveUuid);
      if (remnaUser.error) {
        console.error(`[auto-renew] Failed to fetch remna user ${client.remnawaveUuid}:`, remnaUser.error);
        const errStr = String(remnaUser.error);
        if (errStr.includes("Validation") || errStr.includes("not found") || errStr.includes("404")) {
          await prisma.client.update({
            where: { id: client.id },
            data: { autoRenewEnabled: false },
          }).catch(() => {});
        }
        continue;
      }

      const userData = (remnaUser.data as Record<string, unknown>)?.response ?? (remnaUser.data as Record<string, unknown>);
      if (!userData || typeof userData !== "object") continue;
      const expireAtRaw = (userData as Record<string, unknown>).expireAt;
      if (!expireAtRaw) continue;

      const expireAtDate = new Date(expireAtRaw as string);
      if (Number.isNaN(expireAtDate.getTime())) continue;

      const timeLeft = expireAtDate.getTime() - now;
      const renewBase = await computeAutoRenewBaseAmount(client);

      if (timeLeft > 0 && timeLeft <= notifyThreshold) {
        const shouldNotify =
          !client.autoRenewNotifiedAt ||
          now - client.autoRenewNotifiedAt.getTime() > DAY_MS;

        const personalPctPhase1 = typeof client.personalDiscountPercent === "number" && client.personalDiscountPercent > 0
          ? Math.min(100, client.personalDiscountPercent)
          : 0;
        const upcomingPrice = applyPercent(renewBase.amount, personalPctPhase1);

        if (shouldNotify && client.balance < upcomingPrice) {
          await notifyAutoRenewUpcoming(
            client.id,
            client.autoRenewTariff.name,
            upcomingPrice,
            client.autoRenewTariff.currency,
            Math.max(0, Math.ceil(timeLeft / DAY_MS)),
          );
          await prisma.client.update({
            where: { id: client.id },
            data: { autoRenewNotifiedAt: new Date() },
          });
        }
      }

      if (timeLeft > 0) {
        await dispatchAutoRenewNotification(client.id, "UPCOMING", {
          tariffName: client.autoRenewTariff.name,
          amount: renewBase.amount,
          currency: client.autoRenewTariff.currency,
          minutesLeft: Math.round(timeLeft / 60000),
          expireAt: expireAtDate,
          subIndex: 0,
          balance: client.balance,
          dedupKeyForRoot: { clientId: client.id, ttlMs: 60 * 60 * 1000 },
        }).catch(() => {});
      }

      if (timeLeft <= renewThreshold && timeLeft >= -(3 * DAY_MS)) {
        const baseTariffPrice = renewBase.amount;
        const personalPct = typeof client.personalDiscountPercent === "number" && client.personalDiscountPercent > 0
          ? Math.min(100, client.personalDiscountPercent)
          : 0;
        const priceAfterPersonal = applyPercent(baseTariffPrice, personalPct);

        const { finalPrice: tariffPrice, promoCodeId: autoRenewPromoCodeId } =
          await tryApplyPromoForAutoRenew(client.id, client.autoRenewPromoCode, priceAfterPersonal);

        const debitGuard = await prisma.client.updateMany({
          where: { id: client.id, balance: { gte: tariffPrice - 0.01 } },
          data: {
            balance: { decrement: tariffPrice },
            autoRenewRetryCount: 0,
            autoRenewNotifiedAt: null,
          },
        });

        if (debitGuard.count > 0) {
          let renewalFailed = false;
          let createdPaymentId: string | null = null;
          let createdPromoUsageId: string | null = null;
          try {
            const metaObj: Record<string, unknown> = { autoRenew: true };
            if (autoRenewPromoCodeId) {
              metaObj.promoCodeId = autoRenewPromoCodeId;
              metaObj.originalPrice = baseTariffPrice;
            }
            if (personalPct > 0) {
              metaObj.personalDiscountPercent = personalPct;
              if (!metaObj.originalPrice) metaObj.originalPrice = baseTariffPrice;
            }
            const hasExtras = autoRenewPromoCodeId || personalPct > 0;
            const { paymentId } = await prisma.$transaction(async (tx) => {
              const payment = await tx.payment.create({
                data: {
                  clientId: client.id,
                  orderId: randomUUID(),
                  amount: tariffPrice,
                  currency: client.autoRenewTariff!.currency.toUpperCase(),
                  status: "PAID",
                  provider: "balance",
                  tariffId: client.autoRenewTariff!.id,
                  tariffPriceOptionId: renewBase.priceOptionId,
                  deviceCount: renewBase.extras,
                  paidAt: new Date(),
                  metadata: hasExtras ? JSON.stringify(metaObj) : null,
                },
              });

              if (autoRenewPromoCodeId) {
                const usage = await tx.promoCodeUsage.create({
                  data: { promoCodeId: autoRenewPromoCodeId, clientId: client.id },
                });
                createdPromoUsageId = usage.id;
              }
              return { paymentId: payment.id };
            });
            createdPaymentId = paymentId;

            const activationRes = await activateTariffByPaymentId(paymentId);
            if (!activationRes.ok) {
              throw new Error(`Activation failed: ${activationRes.error}`);
            }

            import("../referral/referral.service.js")
              .then((m) => m.distributeReferralRewards(paymentId))
              .catch((e) => console.error("[auto-renew] Referral reward error:", e));
          } catch (err) {
            renewalFailed = true;
            await prisma.client.update({
              where: { id: client.id },
              data: { balance: { increment: tariffPrice } },
            }).catch((e) => console.error("[auto-renew] Rollback debit failed:", e));
            if (createdPaymentId) {
              await prisma.payment.updateMany({
                where: { id: createdPaymentId, status: "PAID" },
                data: { status: "FAILED" },
              }).catch((e) => console.error("[auto-renew] Rollback payment failed:", e));
            }
            if (createdPromoUsageId) {
              await prisma.promoCodeUsage.deleteMany({
                where: { id: createdPromoUsageId },
              }).catch((e) => console.error("[auto-renew] Rollback promo usage failed:", e));
            }
            console.error(`[auto-renew] Client ${client.id} renewal failed, debit rolled back:`, err);
            notifyAdminsAboutAutoRenewFailed(
              client.id,
              client.autoRenewTariff.name,
              err instanceof Error ? err.message : String(err),
            ).catch((e) => console.error("[auto-renew] admin notify failed:", e));
          }
          if (renewalFailed) continue;

          await notifyAutoRenewSuccess(
            client.id,
            client.autoRenewTariff.name,
            tariffPrice,
            client.autoRenewTariff.currency,
          );
          await dispatchAutoRenewNotification(client.id, "SUCCESS", {
            tariffName: client.autoRenewTariff.name,
            amount: tariffPrice,
            currency: client.autoRenewTariff.currency,
            expireAt: expireAtDate,
            subIndex: 0,
            balance: Math.max(0, client.balance - tariffPrice),
          }).catch(() => {});
        } else {
          let yookassaPaid = false;

          if (
            config.yookassaRecurringEnabled &&
            client.yookassaPaymentMethodId &&
            config.yookassaShopId?.trim() &&
            config.yookassaSecretKey?.trim()
          ) {
            const recentAutopay = await prisma.payment.findFirst({
              where: {
                clientId: client.id,
                provider: "yookassa",
                status: "PAID",
                tariffId: client.autoRenewTariffId,
                paidAt: { gte: new Date(Date.now() - 2 * 60 * 60 * 1000) },
              },
              orderBy: { paidAt: "desc" },
            });

            if (recentAutopay) {
              const activationRes = await activateTariffByPaymentId(recentAutopay.id);
              if (activationRes.ok) {
                await prisma.client.update({
                  where: { id: client.id },
                  data: { autoRenewRetryCount: 0, autoRenewNotifiedAt: null },
                });
                await notifyAutoRenewYookassaSuccess(
                  client.id,
                  client.autoRenewTariff!.name,
                  recentAutopay.amount,
                  client.autoRenewTariff!.currency,
                  client.yookassaPaymentMethodTitle ?? undefined,
                  undefined,
                  recentAutopay.amount,
                );
              }
              yookassaPaid = true;
            } else {
              const balancePortion = Math.min(client.balance, tariffPrice);
              const cardPortion = tariffPrice - balancePortion;
              const orderId = randomUUID();
              const serviceName = config.serviceName?.trim() || "STEALTHNET";
              const tgIdSuffix = client.telegramId ? ` tg:${client.telegramId}` : "";
              const autopayResult = await createYookassaAutopayment({
                shopId: config.yookassaShopId.trim(),
                secretKey: config.yookassaSecretKey.trim(),
                amount: cardPortion,
                currency: client.autoRenewTariff!.currency.toUpperCase(),
                paymentMethodId: client.yookassaPaymentMethodId,
                description: `Автопродление ${serviceName}${tgIdSuffix}`,
                metadata: { auto_renew: "true", client_id: client.id },
                customerEmail: client.email,
                customerTelegramUsername: client.telegramUsername ?? null,
              });

              if (autopayResult.ok) {
                if (balancePortion > 0) {
                  await prisma.client.updateMany({
                    where: { id: client.id, balance: { gte: balancePortion } },
                    data: { balance: { decrement: balancePortion } },
                  });
                }
                const payment = await prisma.$transaction(async (tx) => {
                  const ypMeta: Record<string, unknown> = { autoRenew: true };
                  if (autoRenewPromoCodeId) {
                    ypMeta.promoCodeId = autoRenewPromoCodeId;
                    ypMeta.originalPrice = baseTariffPrice;
                  }
                  if (personalPct > 0) {
                    ypMeta.personalDiscountPercent = personalPct;
                    if (!ypMeta.originalPrice) ypMeta.originalPrice = baseTariffPrice;
                  }
                  const ypHasExtras = autoRenewPromoCodeId || personalPct > 0;
                  const p = await tx.payment.create({
                    data: {
                      clientId: client.id,
                      orderId,
                      amount: tariffPrice,
                      currency: client.autoRenewTariff!.currency.toUpperCase(),
                      status: "PAID",
                      provider: "yookassa",
                      tariffId: client.autoRenewTariff!.id,
                      tariffPriceOptionId: renewBase.priceOptionId,
                      deviceCount: renewBase.extras,
                      paidAt: new Date(),
                      externalId: autopayResult.paymentId,
                      metadata: ypHasExtras ? JSON.stringify(ypMeta) : null,
                    },
                  });

                  if (autoRenewPromoCodeId) {
                    await tx.promoCodeUsage.create({
                      data: { promoCodeId: autoRenewPromoCodeId, clientId: client.id },
                    });
                  }

                  return p;
                });

                let activationRes = await activateTariffByPaymentId(payment.id);
                for (let attempt = 1; attempt <= 2 && !activationRes.ok; attempt++) {
                  await new Promise((r) => setTimeout(r, 1500 * attempt));
                  activationRes = await activateTariffByPaymentId(payment.id);
                }

                if (activationRes.ok) {
                  await prisma.client.update({
                    where: { id: client.id },
                    data: {
                      autoRenewRetryCount: 0,
                      autoRenewNotifiedAt: null,
                    },
                  });

                  import("../referral/referral.service.js")
                    .then((m) => m.distributeReferralRewards(payment.id))
                    .catch((e) => console.error("[auto-renew] Referral reward error:", e));

                  await notifyAutoRenewYookassaSuccess(
                    client.id,
                    client.autoRenewTariff!.name,
                    tariffPrice,
                    client.autoRenewTariff!.currency,
                    client.yookassaPaymentMethodTitle ?? undefined,
                    balancePortion > 0 ? balancePortion : undefined,
                    cardPortion,
                  );
                }
                yookassaPaid = true;
              } else {
                await notifyAutoRenewYookassaFailed(
                  client.id,
                  client.autoRenewTariff!.name,
                  autopayResult.error,
                );
              }
            }
          }

          if (!yookassaPaid) {
            const currentRetryCount = client.autoRenewRetryCount ?? 0;

            if (currentRetryCount < maxRetries) {
              const newRetryCount = currentRetryCount + 1;
              await prisma.client.update({
                where: { id: client.id },
                data: { autoRenewRetryCount: newRetryCount },
              });

              await notifyAutoRenewRetry(
                client.id,
                client.autoRenewTariff.name,
                tariffPrice,
                client.autoRenewTariff.currency,
                newRetryCount,
                maxRetries,
              );
            } else {
              const expiredSince = timeLeft < 0 ? Math.abs(timeLeft) : 0;

              if (expiredSince >= gracePeriod) {
                await prisma.client.update({
                  where: { id: client.id },
                  data: {
                    autoRenewEnabled: false,
                    autoRenewRetryCount: 0,
                    autoRenewNotifiedAt: null,
                  },
                });
                await notifyAutoRenewFailed(
                  client.id,
                  client.autoRenewTariff.name,
                  "balance",
                );
                await dispatchAutoRenewNotification(client.id, "EXPIRED", {
                  tariffName: client.autoRenewTariff.name,
                  amount: renewBase.amount,
                  currency: client.autoRenewTariff.currency,
                  expireAt: expireAtDate,
                  subIndex: 0,
                  balance: client.balance,
                }).catch(() => {});
              }
            }
          }
        }
      }
    } catch (e) {
      console.error(`[auto-renew] Error processing client ${client.id}:`, e);

      const currentRetryCount = client.autoRenewRetryCount ?? 0;
      if (currentRetryCount < maxRetries) {
        await prisma.client
          .update({
            where: { id: client.id },
            data: { autoRenewRetryCount: currentRetryCount + 1 },
          })
          .catch((err) => console.error("[auto-renew] Failed to update retry count:", err));
      } else {
        await prisma.client
          .update({
            where: { id: client.id },
            data: {
              autoRenewEnabled: false,
              autoRenewRetryCount: 0,
              autoRenewNotifiedAt: null,
            },
          })
          .catch((err) => console.error("[auto-renew] Failed to disable auto-renew on error:", err));

        await notifyAutoRenewFailed(client.id, client.autoRenewTariff.name, "error").catch(() => {});
        await dispatchAutoRenewNotification(client.id, "FAILED", {
          tariffName: client.autoRenewTariff?.name ?? "-",
          amount: 0,
          currency: client.autoRenewTariff?.currency ?? "RUB",
          subIndex: 0,
          balance: client.balance,
        }).catch(() => {});
      }
    }
  }

  await processSecondaryAutoRenewals();
}

async function processSecondaryAutoRenewals(): Promise<void> {
  const config = await getSystemConfig();
  const daysBeforeExpiry = config.autoRenewDaysBeforeExpiry ?? 1;
  const gracePeriodDays = config.autoRenewGracePeriodDays ?? 2;
  const renewThreshold = daysBeforeExpiry * DAY_MS;
  const gracePeriod = gracePeriodDays * DAY_MS;
  const now = Date.now();

  const orphans = await prisma.subscription.findMany({
    where: { autoRenewEnabled: true, tariffId: null, autoRenewTariffId: null },
    select: { id: true, ownerId: true, subscriptionIndex: true, owner: { select: { balance: true } } },
  });
  for (const o of orphans) {
    await prisma.subscription.update({ where: { id: o.id }, data: { autoRenewEnabled: false } }).catch(() => {});
    console.warn(`[auto-renew/sec] sub ${o.id}: тариф удален и fallback-тарифа нет - автосписание выключено.`);
    await dispatchAutoRenewNotification(o.ownerId, "EXPIRED", {
      tariffName: "-",
      amount: 0,
      currency: "RUB",
      subIndex: o.subscriptionIndex ?? 0,
      balance: o.owner?.balance ?? 0,
    }).catch(() => {});
  }

  const secondaries = await prisma.subscription.findMany({
    where: {
      autoRenewEnabled: true,
      remnawaveUuid: { not: null },
      OR: [{ tariffId: { not: null } }, { autoRenewTariffId: { not: null } }],
    },
    include: {
      tariff: true,
      owner: {
        select: {
          id: true,
          balance: true,
          isBlocked: true,
          telegramId: true,
          telegramUsername: true,
          email: true,
          yookassaPaymentMethodId: true,
          yookassaPaymentMethodTitle: true,
          personalDiscountPercent: true,
        },
      },
    },
  });

  for (const sec of secondaries) {
    if (!sec.remnawaveUuid || !sec.owner || sec.owner.isBlocked) continue;
    let tariffForRenewal = sec.tariff;
    if (!tariffForRenewal && sec.autoRenewTariffId) {
      tariffForRenewal = await prisma.tariff.findUnique({ where: { id: sec.autoRenewTariffId } });
    }
    if (!tariffForRenewal) {
      continue;
    }
    try {
      const remnaUser = await remnaGetUser(sec.remnawaveUuid);
      if (remnaUser.error) {
        console.warn(`[auto-renew/sec] Failed to fetch remna user ${sec.remnawaveUuid}:`, remnaUser.error);
        // Отключаем автопродление для несуществующих / битых в Remnawave пользователей
        await prisma.subscription.update({
          where: { id: sec.id },
          data: { autoRenewEnabled: false },
        }).catch(() => {});
        continue;
      }
      const userData = (remnaUser.data as Record<string, unknown>)?.response ?? remnaUser.data;
      const expireAtRaw = (userData as Record<string, unknown> | null)?.expireAt;
      if (!expireAtRaw) continue;
      const expireAtDate = new Date(expireAtRaw as string);
      if (Number.isNaN(expireAtDate.getTime())) continue;
      const timeLeft = expireAtDate.getTime() - now;

      const renewDurationDays = tariffForRenewal.durationDays || 30;
      const extrasMonthly = sec.extraDevicesMonthlyPrice ?? 0;
      const extrasForPeriod = extrasMonthly > 0
        ? Math.floor(extrasMonthly * (renewDurationDays / 30))
        : 0;
      const baseRenewPrice = extrasForPeriod > 0
        ? tariffForRenewal.price
        : (sec.customPrice && sec.customPrice > 0 ? sec.customPrice : tariffForRenewal.price);
      let priceBeforeDiscount = baseRenewPrice + extrasForPeriod;
      const pd = sec.owner.personalDiscountPercent ?? 0;
      const priceRaw = pd > 0
        ? Math.max(0, Math.floor(priceBeforeDiscount * (1 - pd / 100)))
        : priceBeforeDiscount;
      const price = Math.round(priceRaw * 100) / 100;

      if (timeLeft > 0) {
        const minutesLeft = Math.round(timeLeft / 60000);
        await dispatchAutoRenewNotification(sec.owner.id, "UPCOMING", {
          tariffName: tariffForRenewal.name,
          amount: price,
          currency: tariffForRenewal.currency,
          minutesLeft,
          expireAt: expireAtDate,
          subIndex: sec.subscriptionIndex,
          balance: sec.owner.balance ?? 0,
          dedupKeyForSec: { secondarySubscriptionId: sec.id, ttlMs: 60 * 60 * 1000 },
        }).catch(() => {});
      }

      if (timeLeft > renewThreshold || timeLeft < -7 * DAY_MS) continue;
      if (price <= 0) continue;

      const recentYkPayment = await prisma.payment.findFirst({
        where: {
          clientId: sec.owner.id,
          provider: "yookassa",
          status: "PAID",
          tariffId: tariffForRenewal.id,
          paidAt: { gte: new Date(now - 2 * 60 * 60 * 1000) },
          metadata: { contains: sec.id },
        },
        orderBy: { paidAt: "desc" },
      });
      if (recentYkPayment) {
        const { extendSecondarySubscription } = await import("../tariff/tariff-activation.service.js");
        await extendSecondarySubscription(
          sec.id,
          {
            id: tariffForRenewal.id,
            durationDays: tariffForRenewal.durationDays,
            trafficLimitBytes: tariffForRenewal.trafficLimitBytes,
            deviceLimit: tariffForRenewal.deviceLimit,
            includedDevices: tariffForRenewal.includedDevices ?? undefined,
            pricePerExtraDevice: tariffForRenewal.pricePerExtraDevice ?? 0,
            maxExtraDevices: tariffForRenewal.maxExtraDevices ?? 0,
            internalSquadUuids: tariffForRenewal.internalSquadUuids,
            trafficResetMode: tariffForRenewal.trafficResetMode ?? undefined,
            price,
          },
          undefined,
          0,
        );
        continue;
      }

      const balanceForUser = sec.owner.balance ?? 0;
      let paidViaBalance = 0;
      let paidViaYookassa = 0;
      let yookassaPaymentId: string | null = null;
      let success = false;

      const balanceDebit = await prisma.client.updateMany({
        where: { id: sec.owner.id, balance: { gte: price - 0.01 } },
        data: { balance: { decrement: price } },
      });

      if (balanceDebit.count > 0) {
        paidViaBalance = price;
        success = true;
      } else {
        const ykEnabled =
          config.yookassaRecurringEnabled === true &&
          !!sec.owner.yookassaPaymentMethodId &&
          !!config.yookassaShopId?.trim() &&
          !!config.yookassaSecretKey?.trim();

        if (!ykEnabled) {
          // Если льготный период истек - выключаем автосписание
          const expiredSince = timeLeft < 0 ? Math.abs(timeLeft) : 0;
          if (expiredSince >= gracePeriod) {
            await prisma.subscription.update({
              where: { id: sec.id },
              data: { autoRenewEnabled: false },
            }).catch(() => {});
            console.log(`[auto-renew/sec] sec ${sec.id} failed: grace period over. Auto-renew disabled.`);
            await dispatchAutoRenewNotification(sec.owner.id, "EXPIRED", {
              tariffName: tariffForRenewal.name,
              amount: price,
              currency: tariffForRenewal.currency,
              expireAt: expireAtDate,
              subIndex: sec.subscriptionIndex,
              balance: balanceForUser,
            }).catch(() => {});
            continue;
          }

          // Троттлинг: проверяем подписку с нулевым балансом не чаще 1 раза в час
          const checkAllowed = await tryMarkSubDedup(sec.id, "sec_nobal_check", 60 * 60 * 1000);
          if (!checkAllowed) {
            continue;
          }

          console.log(`[auto-renew/sec] Insufficient balance for sec ${sec.id} (need ${price}, have ${balanceForUser}); YK fallback disabled. Skipping.`);
          await dispatchAutoRenewNotification(sec.owner.id, "FAILED", {
            tariffName: tariffForRenewal.name,
            amount: price,
            currency: tariffForRenewal.currency,
            expireAt: expireAtDate,
            subIndex: sec.subscriptionIndex,
            balance: balanceForUser,
            dedupKeyForSec: { secondarySubscriptionId: sec.id, ttlMs: 24 * 60 * 60 * 1000 },
          }).catch(() => {});
          continue;
        }

        const ykAttemptAllowed = await tryMarkSubDedup(sec.id, "yk_attempt", 60 * 60 * 1000);
        if (!ykAttemptAllowed) {
          continue;
        }

        const balancePortion = Math.min(Math.max(0, balanceForUser), price);
        const cardPortion = price - balancePortion;

        if (balancePortion > 0) {
          const partialDebit = await prisma.client.updateMany({
            where: { id: sec.owner.id, balance: { gte: balancePortion } },
            data: { balance: { decrement: balancePortion } },
          });
          if (partialDebit.count > 0) {
            paidViaBalance = balancePortion;
          }
        }

        try {
          const orderIdForYk = randomUUID();
          const tgIdSuffix = sec.owner.telegramId ? ` tg:${sec.owner.telegramId}` : "";
          const autopayResult = await createYookassaAutopayment({
            shopId: config.yookassaShopId!.trim(),
            secretKey: config.yookassaSecretKey!.trim(),
            amount: cardPortion,
            currency: tariffForRenewal.currency.toUpperCase(),
            paymentMethodId: sec.owner.yookassaPaymentMethodId!,
            description: `Автопродление #${sec.subscriptionIndex} (${tariffForRenewal.name})${tgIdSuffix}`,
            metadata: {
              orderId: orderIdForYk,
              extendsSecondarySubId: sec.id,
              autoRenew: "true",
              clientId: sec.owner.id,
            },
            customerEmail: sec.owner.email,
            customerTelegramUsername: sec.owner.telegramUsername ?? null,
          });

          if (autopayResult.ok) {
            paidViaYookassa = cardPortion;
            yookassaPaymentId = autopayResult.paymentId;
            success = true;
          } else {
            if (paidViaBalance > 0) {
              await prisma.client.update({
                where: { id: sec.owner.id },
                data: { balance: { increment: paidViaBalance } },
              }).catch(() => {});
              paidViaBalance = 0;
            }
            console.error(`[auto-renew/sec] YK autopay failed for sec ${sec.id}: ${autopayResult.error}`);
            const ykFailNoticeAllowed = await tryMarkSubDedup(sec.id, "yk_fail_notice", 24 * 60 * 60 * 1000);
            if (ykFailNoticeAllowed) {
              await notifyAutoRenewYookassaFailed(sec.owner.id, tariffForRenewal.name, autopayResult.error).catch(() => {});
            }
            await dispatchAutoRenewNotification(sec.owner.id, "FAILED", {
              tariffName: tariffForRenewal.name,
              amount: price,
              currency: tariffForRenewal.currency,
              expireAt: expireAtDate,
              subIndex: sec.subscriptionIndex,
              balance: sec.owner.balance ?? 0,
              dedupKeyForSec: { secondarySubscriptionId: sec.id, ttlMs: 24 * 60 * 60 * 1000 },
            }).catch(() => {});
            continue;
          }
        } catch (e) {
          if (paidViaBalance > 0) {
            await prisma.client.update({
              where: { id: sec.owner.id },
              data: { balance: { increment: paidViaBalance } },
            }).catch(() => {});
            paidViaBalance = 0;
          }
          const errMsg = e instanceof Error ? e.message : "unknown error";
          console.error(`[auto-renew/sec] YK autopay exception for sec ${sec.id}:`, errMsg);
          const ykExcNoticeAllowed = await tryMarkSubDedup(sec.id, "yk_fail_notice", 24 * 60 * 60 * 1000);
          if (ykExcNoticeAllowed) {
            await notifyAutoRenewYookassaFailed(sec.owner.id, tariffForRenewal.name, errMsg).catch(() => {});
          }
          continue;
        }
      }

      if (!success) continue;

      const payment = await prisma.payment.create({
        data: {
          clientId: sec.owner.id,
          orderId: randomUUID(),
          tariffId: tariffForRenewal.id,
          amount: price,
          currency: tariffForRenewal.currency.toUpperCase(),
          status: "PAID",
          provider: paidViaYookassa > 0 ? "yookassa" : "balance",
          paidAt: new Date(),
          metadata: JSON.stringify({
            extendsSecondarySubId: sec.id,
            autoRenew: true,
            balancePortion: paidViaBalance,
            cardPortion: paidViaYookassa,
            yookassaPaymentId,
          }),
        },
      }).catch((err) => {
        console.error(`[auto-renew/sec] Failed to create Payment record for sec ${sec.id}:`, err);
        return null;
      });

      const { extendSecondarySubscription } = await import("../tariff/tariff-activation.service.js");
      const result = await extendSecondarySubscription(
        sec.id,
        {
          id: tariffForRenewal.id,
          durationDays: tariffForRenewal.durationDays,
          trafficLimitBytes: tariffForRenewal.trafficLimitBytes,
          deviceLimit: tariffForRenewal.deviceLimit,
          includedDevices: tariffForRenewal.includedDevices ?? undefined,
          pricePerExtraDevice: tariffForRenewal.pricePerExtraDevice ?? 0,
          maxExtraDevices: tariffForRenewal.maxExtraDevices ?? 0,
          internalSquadUuids: tariffForRenewal.internalSquadUuids,
          trafficResetMode: tariffForRenewal.trafficResetMode ?? undefined,
          price,
        },
        undefined,
        0,
      );

      if (!result.ok) {
        if (paidViaBalance > 0) {
          await prisma.client.update({
            where: { id: sec.owner.id },
            data: { balance: { increment: paidViaBalance } },
          }).catch(() => {});
        }
        if (payment && paidViaYookassa > 0) {
          console.error(`[auto-renew/sec] sec ${sec.id} extend FAILED, YK paid ${paidViaYookassa} kept.`);
        } else if (payment) {
          await prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED" } }).catch(() => {});
        }
        console.error(`[auto-renew/sec] Failed to extend sec ${sec.id}: ${result.error}`);
        continue;
      }

      if (paidViaYookassa > 0) {
        await notifyAutoRenewYookassaSuccess(
          sec.owner.id,
          tariffForRenewal.name,
          price,
          tariffForRenewal.currency,
          sec.owner.yookassaPaymentMethodTitle ?? undefined,
          paidViaBalance,
          paidViaYookassa,
        ).catch(() => {});
      }
      await dispatchAutoRenewNotification(sec.owner.id, "SUCCESS", {
        tariffName: tariffForRenewal.name,
        amount: price,
        currency: tariffForRenewal.currency,
        expireAt: expireAtDate,
        subIndex: sec.subscriptionIndex,
        balance: Math.max(0, (sec.owner.balance ?? 0) - paidViaBalance),
      }).catch(() => {});

      console.log(`[auto-renew/sec] Renewed sec ${sec.id} for client ${sec.owner.id}`);
    } catch (e) {
      console.error(`[auto-renew/sec] Unexpected error processing sec ${sec.id}:`, e);
    }
  }
}
