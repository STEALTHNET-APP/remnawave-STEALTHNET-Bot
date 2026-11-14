import { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import { remnaGetUser, remnaGetUserByUsername, remnaCreateUser, remnaUpdateUser, remnaResetUserTraffic } from "../remna/remna.client.js";
import { findConvertibleSubscription, computeConvertedDays } from "../tariff/tariff-activation.service.js";
import { isMultiSubscriptionsEnabled } from "../client/multi-subscriptions.js";
import { calcExtrasMonthlyPrice } from "../tariff/extras-pricing.js";
import { DAY, cloudConfig, readMetadata } from "./cloudpayments.service.js";

type Plan = { subscriptionId: string; username: string; uuid: string | null; body: Record<string, any>; extraDevices: number; extrasMonthly: number; days: number; price: number; resetRequestedAt?: string; resetDone?: boolean; resetTraffic: boolean; trialDays: number };
function dataOf(value: unknown): Record<string, any> {
  const data = value as Record<string, any>;
  return data?.response ?? data?.data ?? data ?? {};
}

export async function fulfillCloudTariff(jobId: string) {
  let job = await prisma.cloudPaymentJob.findUniqueOrThrow({ where: { id: jobId }, include: { payment: { include: { tariff: true, tariffPriceOption: true, client: true } } } });
  const p = job.payment;
  const tariff = p.tariff;
  if (!tariff) throw new Error("Тариф удалён");
  const meta = readMetadata(p.metadata);
  const cfg = await cloudConfig();
  let plan = job.plan as Plan | null;
  if (!plan) {
    let targetId = meta.extendsSecondarySubId || p.subscriptionId;
    if (!targetId && !meta.purchasedAsGift) {
      const convertible = await findConvertibleSubscription(p.clientId, tariff.id, isMultiSubscriptionsEnabled(cfg), { preferredSubId: meta.replaceTrialSubId, trialSquadUuid: cfg.trialSquadUuid });
      targetId = convertible?.id;
    }
    let sub = targetId ? await prisma.subscription.findFirst({ where: { id: targetId, ownerId: p.clientId }, include: { trial: true } }) : null;
    if (targetId && !sub) throw new Error("Подписка не принадлежит плательщику");
    if (sub?.bannedUntil && sub.bannedUntil > new Date()) throw new Error("Подписка заблокирована");
    if (sub?.trialId && sub.trial?.convertEnabled === false) throw new Error("Конвертация пробного периода отключена");
    if (sub?.trialId && sub.tariffId !== tariff.id && !sub.trial?.convertAllTariffs && !JSON.parse(sub.trial?.convertTariffIds || "[]").includes(tariff.id)) throw new Error("Тариф недоступен для конвертации");
    const remote = sub?.remnawaveUuid ? await remnaGetUser(sub.remnawaveUuid) : null;
    if (remote?.error) throw new Error("Не удалось проверить текущую VPN-подписку");
    const user = dataOf(remote?.data);
    const now = new Date();
    const trialDays = Number(meta.cloudTrialDays ?? 0);
    const days = trialDays || Number(meta.cloudPeriodDays || p.tariffPriceOption?.durationDays || tariff.durationDays);
    const kept = meta.removeExtrasOnActivate ? 0 : sub?.extraDevices ?? 0;
    const extraDevices = kept + (p.deviceCount ?? 0);
    if (extraDevices > tariff.maxExtraDevices) throw new Error("Превышен лимит дополнительных устройств");
    const extrasMonthly = (meta.removeExtrasOnActivate ? 0 : sub?.extraDevicesMonthlyPrice ?? 0) + calcExtrasMonthlyPrice(tariff.pricePerExtraDevice, p.deviceCount ?? 0, tariff.deviceDiscountTiers);
    const price = Number(meta.cloudRegularAmount ?? p.amount);
    const oldExpiry = user.expireAt ? new Date(user.expireAt).getTime() : sub?.expireAt?.getTime() ?? 0;
    let remaining = Math.max(0, (oldExpiry - now.getTime()) / DAY);
    if (sub?.tariffId !== tariff.id && sub) remaining = isMultiSubscriptionsEnabled(cfg) ? computeConvertedDays({ remainingDays: remaining, oldPricePerDay: sub.currentPricePerDay, newPricePerDay: price / days }) : 0;
    const agreement = job.agreementId ? await prisma.cloudPaymentAgreement.findUnique({ where: { id: job.agreementId } }) : null;
    if (trialDays || sub?.trialId || meta.cloudRecurring && (agreement?.trialEndsAt || agreement?.graceEndsAt)) remaining = 0;
    const expiry = new Date(now.getTime() + (days + remaining) * DAY).toISOString();
    const limit = Number(tariff.trafficLimitBytes ?? 0);
    const currentLimit = Number(user.trafficLimitBytes ?? 0);
    const used = Number(user.userTraffic?.usedTrafficBytes ?? user.usedTrafficBytes ?? 0);
    const mode = tariff.trafficResetMode;
    const reset = !!sub && ["on_purchase", "monthly", "carry_over"].includes(mode);
    const plannedLimit = !sub || sub.tariffId !== tariff.id || mode === "on_purchase" || mode === "monthly" ? limit
      : !limit || !currentLimit ? 0 : mode === "carry_over" ? limit + Math.max(0, currentLimit - used) : limit + currentLimit;
    const allTariffs = await prisma.tariff.findMany({ select: { internalSquadUuids: true } });
    const tariffSquads = new Set(allTariffs.flatMap(t => t.internalSquadUuids));
    const squads: string[] = (user.activeInternalSquads ?? []).map((s: any) => typeof s === "string" ? s : s.uuid);
    const body = {
      expireAt: expiry, status: "ACTIVE", trafficLimitBytes: plannedLimit,
      trafficLimitStrategy: mode === "monthly" ? "MONTH" : mode === "monthly_rolling" ? "MONTH_ROLLING" : "NO_RESET",
      hwidDeviceLimit: tariff.includedDevices + extraDevices,
      activeInternalSquads: [...tariff.internalSquadUuids, ...squads.filter(s => !tariffSquads.has(s))],
      ...(p.client.telegramId && !meta.purchasedAsGift ? { telegramId: Number(p.client.telegramId) } : {}),
      ...(p.client.email && !meta.purchasedAsGift ? { email: p.client.email } : {}),
    };
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${p.clientId}))`;
      if (!sub) {
        const existing = await tx.subscription.findMany({ where: { ownerId: p.clientId }, select: { subscriptionIndex: true } });
        if (existing.length >= cfg.maxAdditionalSubscriptions) throw new Error("Достигнут лимит подписок");
        let index = meta.purchasedAsGift ? 1 : 0;
        while (existing.some(s => s.subscriptionIndex === index)) index++;
        sub = await tx.subscription.create({ data: { ownerId: p.clientId, subscriptionIndex: index, tariffId: tariff.id, purchasedAsGift: meta.purchasedAsGift === true }, include: { trial: true } });
      }
      if (job.agreementId) await tx.cloudPaymentAgreement.update({ where: { id: job.agreementId }, data: { subscriptionId: sub.id } });
      plan = { subscriptionId: sub.id, username: `cp_${sub.id}`, uuid: sub.remnawaveUuid, body, extraDevices, extrasMonthly, days, price, resetTraffic: reset, trialDays };
      await tx.cloudPaymentJob.update({ where: { id: jobId }, data: { plan: plan as unknown as Prisma.InputJsonObject } });
      await tx.payment.update({ where: { id: p.id }, data: { subscriptionId: sub.id } });
    });
  }
  if (!plan) throw new Error("Не удалось подготовить выдачу доступа");
  const currentPlan: Plan = plan;
  if (job.agreementId) {
    const agreement = await prisma.cloudPaymentAgreement.findUniqueOrThrow({ where: { id: job.agreementId } });
    if (currentPlan.trialDays && ["CANCEL_PENDING", "CANCELLED", "REJECTED", "COMPLETED"].includes(agreement.state)) {
      currentPlan.body.status = "DISABLED";
      currentPlan.body.expireAt = new Date().toISOString();
    }
  }
  if (currentPlan.uuid && currentPlan.resetTraffic && !currentPlan.resetDone) {
    if (currentPlan.resetRequestedAt) {
      const remote = await remnaGetUser(currentPlan.uuid);
      const resetAt = dataOf(remote.data).lastTrafficResetAt;
      if (remote.error || !resetAt || new Date(resetAt).getTime() + 1000 < new Date(currentPlan.resetRequestedAt).getTime()) throw new Error("Неопределённый результат сброса трафика: требуется сверка");
    } else {
      currentPlan.resetRequestedAt = new Date().toISOString();
      await prisma.cloudPaymentJob.update({ where: { id: jobId }, data: { plan: currentPlan as unknown as Prisma.InputJsonObject } });
      const result = await remnaResetUserTraffic(currentPlan.uuid);
      if (result.error) throw new Error("Не удалось подтвердить сброс трафика");
    }
    currentPlan.resetDone = true;
    await prisma.cloudPaymentJob.update({ where: { id: jobId }, data: { plan: currentPlan as unknown as Prisma.InputJsonObject } });
  }
  let uuid = currentPlan.uuid;
  if (!uuid) {
    const found = await remnaGetUserByUsername(currentPlan.username);
    if (found.error && found.status !== 404) throw new Error("Не удалось проверить создание VPN-подписки");
    uuid = dataOf(found.data).uuid;
    if (!uuid) {
      const created = await remnaCreateUser({ username: currentPlan.username, ...currentPlan.body });
      uuid = dataOf(created.data).uuid;
      if (!uuid) throw new Error("Создание VPN-подписки не подтверждено; повторим сверку");
    }
  }
  const applied = await remnaUpdateUser({ uuid, ...currentPlan.body });
  if (applied.error) throw new Error("Применение VPN-подписки не подтверждено; повторим сверку");
  await prisma.$transaction(async tx => {
    const sub = await tx.subscription.update({ where: { id: currentPlan.subscriptionId }, data: {
      remnawaveUuid: uuid!, tariffId: tariff.id, trialId: null, expireAt: new Date(currentPlan.body.expireAt), remnaStatus: currentPlan.body.status,
      extraDevices: currentPlan.extraDevices, extraDevicesMonthlyPrice: currentPlan.extrasMonthly, customPrice: currentPlan.price,
      currentPricePerDay: currentPlan.price / currentPlan.days, trafficLimitBytes: currentPlan.body.trafficLimitBytes,
      autoRenewEnabled: false, remnaSyncedAt: new Date(),
    } });
    if (sub.subscriptionIndex === 0) await tx.client.update({ where: { id: p.clientId }, data: { remnawaveUuid: uuid!, currentTariffId: tariff.id, autoRenewEnabled: false } });
    if (currentPlan.trialDays) await tx.client.update({ where: { id: p.clientId }, data: { trialUsed: true } });
    if (job.agreementId) await tx.cloudPaymentAgreement.update({ where: { id: job.agreementId }, data: {
      subscriptionId: sub.id, nextChargeAt: new Date(currentPlan.body.expireAt), graceEndsAt: null,
      trialEndsAt: currentPlan.trialDays ? new Date(currentPlan.body.expireAt) : null,
    } });
    await tx.cloudPaymentJob.update({ where: { id: jobId }, data: { state: "FULFILLED", error: null } });
  });
}
