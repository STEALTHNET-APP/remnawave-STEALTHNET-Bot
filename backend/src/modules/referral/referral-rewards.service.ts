import { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import { getReferralBaseAmount, isReferralEligiblePayment } from "./referral.service.js";
import { remnaGetUser, remnaUpdateUser } from "../remna/remna.client.js";

type RewardConfig = { referralRewardMode: string; referralRewardAmount: number; referralRewardDays: number; defaultCurrency: string; referralRewardEnabledAt?: string | null };

export async function grantReferralReward(paymentId: string, config: RewardConfig) {
  return prisma.$transaction(async tx => {
    const initial = await tx.payment.findUnique({ where: { id: paymentId }, select: { clientId: true, client: { select: { referrerId: true } } } });
    if (!initial) return { distributed: false, message: "Payment not found" };
    const ids = [initial.clientId, initial.client.referrerId].filter((id): id is string => !!id).sort();
    await tx.$queryRaw`SELECT id FROM clients WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { client: { include: { referrer: true } } } });
    if (payment.status !== "PAID" || !isReferralEligiblePayment(payment.provider) || getReferralBaseAmount(payment.amount, payment.metadata) <= 0) {
      return { distributed: false, message: "No eligible external payment" };
    }
    if (payment.client.referrerId !== initial.client.referrerId) throw new Error("Referrer changed; retry referral reward");
    const claim = await tx.payment.updateMany({ where: { id: paymentId, referralDistributedAt: null }, data: { referralDistributedAt: new Date() } });
    if (!claim.count) return { distributed: false, message: "Already distributed" };
    const referrer = payment.client.referrer;
    const skip = { distributed: true, message: "No new one-time referral reward" };
    if (!referrer || referrer.id === payment.clientId || referrer.isBlocked || payment.client.isBlocked) return skip;
    if (config.referralRewardEnabledAt && (payment.paidAt ?? payment.createdAt).getTime() < Date.parse(config.referralRewardEnabledAt)) return skip;
    if (await tx.referralReward.findUnique({ where: { refereeId: payment.clientId } })) return skip;
    const payments = await tx.payment.findMany({ where: { clientId: payment.clientId, status: "PAID", amount: { gt: 0 } }, orderBy: [{ paidAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }, { id: "asc" }] });
    const first = payments.find(p => isReferralEligiblePayment(p.provider) && getReferralBaseAmount(p.amount, p.metadata) > 0);
    if (first?.id !== payment.id) return skip;
    const days = config.referralRewardMode === "days" ? config.referralRewardDays : 0;
    const amount = config.referralRewardMode === "balance" ? Math.round(config.referralRewardAmount * 100) / 100 : 0;
    if ((days && (!Number.isInteger(days) || days < 1 || days > 365)) || (amount && (!Number.isFinite(amount) || amount < 0.01 || amount > 1000000)) || (!days && !amount)) throw new Error("Invalid referral reward settings");
    await tx.referralReward.create({ data: {
      refereeId: payment.clientId, referrerId: referrer.id, paymentId, kind: config.referralRewardMode,
      amount, days, currency: config.defaultCurrency.toUpperCase(), appliedAt: amount ? new Date() : null,
    } });
    if (amount) {
      await tx.client.update({ where: { id: referrer.id }, data: { balance: { increment: amount } } });
      await tx.referralCredit.create({ data: { referrerId: referrer.id, paymentId, amount, level: 1 } });
    }
    return { distributed: true, message: days ? "Referral days saved" : "Referral balance credited" };
  });
}

async function readExpiry(uuid: string) {
  const result = await remnaGetUser(uuid);
  const raw = result.data as { response?: { expireAt?: unknown; status?: unknown }; expireAt?: unknown; status?: unknown } | undefined;
  const user = raw?.response ?? raw;
  const expiry = typeof user?.expireAt === "string" ? Date.parse(user.expireAt) : NaN;
  if (result.error || !Number.isFinite(expiry)) throw new Error("Не удалось прочитать срок подписки в Remnawave");
  return { expiry, status: user?.status };
}

async function lockRewardClient(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM clients WHERE id = ${id} FOR UPDATE`;
  const client = await tx.client.findUnique({ where: { id } });
  if (!client || client.isBlocked) throw new Error("Клиент недоступен для начисления дней");
}

export async function applyReferralDays(rewardId: string) {
  const initial = await prisma.referralReward.findUnique({ where: { id: rewardId } });
  if (!initial || initial.kind !== "days" || initial.appliedAt) return false;
  const planned = await prisma.$transaction(async tx => {
    await lockRewardClient(tx, initial.referrerId);
    const reward = await tx.referralReward.findUniqueOrThrow({ where: { id: rewardId } });
    if (reward.appliedAt) return false;
    if (reward.targetExpireAt) return true;
    const earlier = await tx.referralReward.findFirst({ where: { referrerId: reward.referrerId, kind: "days", appliedAt: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    if (earlier?.id !== reward.id) return false;
    const sub = await tx.subscription.findFirst({ where: { ownerId: reward.referrerId, purchasedAsGift: false }, orderBy: { subscriptionIndex: "asc" } });
    if (!sub?.remnawaveUuid || sub.bannedUntil || sub.subRevokedAt || sub.giftStatus === "GIFT_RESERVED" || sub.giftStatus === "GIFT_CODE_ACTIVE") return false;
    const remote = await readExpiry(sub.remnawaveUuid);
    if (remote.status !== "ACTIVE" && remote.status !== "EXPIRED" && remote.status !== "LIMITED") return false;
    const target = new Date(Math.max(Date.now(), remote.expiry) + reward.days * 86400000);
    await tx.referralReward.update({ where: { id: reward.id }, data: { subscriptionId: sub.id, remnawaveUuid: sub.remnawaveUuid, targetExpireAt: target } });
    return true;
  }, { timeout: 30000, maxWait: 15000 });
  if (!planned) return false;
  return prisma.$transaction(async tx => {
    await lockRewardClient(tx, initial.referrerId);
    const reward = await tx.referralReward.findUniqueOrThrow({ where: { id: rewardId } });
    if (reward.appliedAt) return false;
    if (!reward.subscriptionId || !reward.remnawaveUuid || !reward.targetExpireAt) throw new Error("Нет сохранённого плана начисления дней");
    await tx.$queryRaw`SELECT id FROM subscriptions WHERE id = ${reward.subscriptionId} FOR UPDATE`;
    const sub = await tx.subscription.findFirst({ where: { id: reward.subscriptionId, ownerId: reward.referrerId, remnawaveUuid: reward.remnawaveUuid, purchasedAsGift: false } });
    if (!sub || sub.bannedUntil || sub.subRevokedAt || sub.giftStatus === "GIFT_RESERVED" || sub.giftStatus === "GIFT_CODE_ACTIVE") return false;
    const remote = await readExpiry(reward.remnawaveUuid);
    if (remote.status !== "ACTIVE" && remote.status !== "EXPIRED" && remote.status !== "LIMITED") return false;
    const expireAt = new Date(Math.max(remote.expiry, reward.targetExpireAt.getTime()));
    const status = remote.status === "EXPIRED" ? "ACTIVE" : remote.status;
    const result = await remnaUpdateUser({ uuid: reward.remnawaveUuid, expireAt: expireAt.toISOString(), ...(remote.status === "EXPIRED" ? { status } : {}) });
    if (result.error || result.status < 200 || result.status >= 300) throw new Error("Не удалось добавить реферальные дни; бонус сохранён");
    await tx.subscription.update({ where: { id: sub.id }, data: { expireAt, remnaStatus: status, remnaSyncedAt: new Date() } });
    await tx.referralReward.update({ where: { id: reward.id }, data: { appliedAt: new Date() } });
    return true;
  }, { timeout: 30000, maxWait: 15000 });
}

export async function processReferralDayRewards() {
  const rewards = await prisma.referralReward.findMany({ where: { kind: "days", appliedAt: null, nextAttemptAt: { lte: new Date() } }, orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }, { id: "asc" }], take: 100 });
  for (const reward of rewards) {
    try { await applyReferralDays(reward.id); }
    catch (error) { console.warn("[referral-days]", reward.id, error instanceof Error ? error.message : "Delivery failed"); }
    await prisma.referralReward.updateMany({ where: { id: reward.id, appliedAt: null }, data: { nextAttemptAt: new Date(Date.now() + 60000) } });
  }
}
