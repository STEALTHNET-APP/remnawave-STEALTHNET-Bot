import { randomUUID } from "node:crypto";
import { prisma } from "../../db.js";
import { getSystemConfig } from "../client/client.service.js";
import { isRemnaConfigured, remnaGetUser } from "../remna/remna.client.js";
function reply(status: number, body: Record<string, unknown>) {
    return { status, body };
}
export async function activateTrial(clientId: string, trialId: string, expectedPrice?: unknown) {
    if (!isRemnaConfigured())
        return reply(503, { message: "Сервис временно недоступен" });
    const trial = await prisma.trial.findUnique({
        where: { id: trialId },
        include: { tariff: true },
    });
    if (!trial || !trial.enabled) {
        return reply(404, { message: "Триал не найден или отключён" });
    }
    const price = trial.price ?? 0;
    if (price > 0 && (typeof expectedPrice !== "number" || expectedPrice !== price)) {
        return reply(409, { message: "Цена триала изменилась. Обновите список и подтвердите покупку.", price });
    }
    const existingUsage = await prisma.clientTrialUsage.findUnique({
        where: { clientId_trialId: { clientId, trialId } },
    });
    if (existingUsage) {
        return reply(409, { message: existingUsage.subscriptionId ? "Этот пробный период уже активирован" : "Активация уже начата. Если подписка не появилась, обратитесь в поддержку." });
    }
    const cfgTrialStandalone = await getSystemConfig().catch(() => null);
    if (cfgTrialStandalone?.multiSubscriptionsEnabled !== true) {
        const existingSubsT = await prisma.subscription.count({ where: { ownerId: clientId, purchasedAsGift: false, giftStatus: null } });
        if (existingSubsT > 0) {
            return reply(400, { message: "Пробный период недоступен — у вас уже есть подписка." });
        }
    }
    const trialTrafficLimit = trial.trafficLimitBytes ?? trial.tariff?.trafficLimitBytes ?? null;
    let trialSquads: string[] = trial.tariff?.internalSquadUuids ?? [];
    if (!trial.tariffId) {
        try {
            const parsed = trial.squadUuids ? JSON.parse(trial.squadUuids) as unknown : [];
            trialSquads = Array.isArray(parsed) ? parsed.map((x) => String(x)) : [];
        }
        catch {
            trialSquads = [];
        }
        if (trialSquads.length === 0) {
            return reply(503, { message: "Триал настроен некорректно (нет сквадов)" });
        }
    }
    let paymentId: string | null = null;
    try {
        await prisma.$transaction(async tx => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${clientId}, 42))`;
            const pending = await tx.clientTrialUsage.findFirst({ where: { clientId, subscriptionId: null } });
            if (pending) throw new Error("TRIAL_ACTIVATION_PENDING");
            if (cfgTrialStandalone?.multiSubscriptionsEnabled !== true && await tx.subscription.count({ where: { ownerId: clientId, purchasedAsGift: false, giftStatus: null } }) > 0) throw new Error("TRIAL_SUBSCRIPTION_EXISTS");
            await tx.clientTrialUsage.create({ data: { clientId, trialId } });
            if (price > 0) {
                const debit = await tx.client.updateMany({ where: { id: clientId, balance: { gte: price } }, data: { balance: { decrement: price } } });
                if (debit.count !== 1) throw new Error("TRIAL_INSUFFICIENT_BALANCE");
                const payment = await tx.payment.create({ data: { clientId, orderId: `trial-${randomUUID()}`, amount: price, currency: "RUB", provider: "balance", status: "PROCESSING", metadata: JSON.stringify({ trialId, trialName: trial.name, trialBalanceReserved: true }) } });
                paymentId = payment.id;
            }
        });
    }
    catch (error) {
        if (error instanceof Error && ["TRIAL_ACTIVATION_PENDING", "TRIAL_SUBSCRIPTION_EXISTS"].includes(error.message)) {
            return reply(409, { message: error.message === "TRIAL_SUBSCRIPTION_EXISTS" ? "Пробный период недоступен — у вас уже есть подписка." : "Другая активация уже начата. Дождитесь её завершения." });
        }
        if (error instanceof Error && error.message === "TRIAL_INSUFFICIENT_BALANCE") {
            return reply(400, { message: `Недостаточно средств. Пополните баланс для покупки триала за ${price}.`, code: "INSUFFICIENT_BALANCE" });
        }
        if ((error as {
            code?: string;
        }).code === "P2002") {
            return reply(409, { message: "Активация этого пробного периода уже начата" });
        }
        throw error;
    }
    const { createAdditionalSubscription } = await import("../gift/gift.service.js");
    let subResult;
    try {
    subResult = await createAdditionalSubscription(clientId, {
        id: trial.tariffId ?? undefined,
        name: trial.name,
        price: 0,
        durationDays: trial.durationDays,
        trafficLimitBytes: trialTrafficLimit,
        deviceLimit: trial.deviceLimit ?? trial.tariff?.deviceLimit ?? null,
        includedDevices: trial.tariff?.includedDevices ?? trial.deviceLimit ?? undefined,
        internalSquadUuids: trialSquads,
        trafficResetMode: trial.tariff?.trafficResetMode ?? undefined,
    }, { skipConfigCheck: true, extraDevices: 0 });
    } catch (error) {
        console.error("[trial] Activation needs reconciliation", { clientId, trialId, paymentId });
        return reply(502, { message: paymentId ? "Активация требует проверки. Сумма зарезервирована на балансе, обратитесь в поддержку." : "Активация требует проверки. Обратитесь в поддержку." });
    }
    if (!subResult.ok) {
        if (subResult.status < 500) {
            await prisma.$transaction(async tx => {
                await tx.clientTrialUsage.delete({ where: { clientId_trialId: { clientId, trialId } } });
                if (paymentId) {
                    const failed = await tx.payment.updateMany({ where: { id: paymentId, status: "PROCESSING" }, data: { status: "FAILED" } });
                    if (failed.count === 1) await tx.client.update({ where: { id: clientId }, data: { balance: { increment: price } } });
                }
            });
        }
        return reply(subResult.status, { message: subResult.status >= 500 && paymentId ? "Активация требует проверки. Сумма зарезервирована на балансе, обратитесь в поддержку." : subResult.error });
    }
    await prisma.$transaction(async tx => {
        await tx.subscription.update({ where: { id: subResult.data.subscriptionId }, data: { trialId: trial.id, autoRenewEnabled: false, autoRenewTariffId: null } });
        await tx.clientTrialUsage.update({ where: { clientId_trialId: { clientId, trialId } }, data: { subscriptionId: subResult.data.subscriptionId } });
        await tx.client.update({ where: { id: clientId }, data: { trialUsed: true } });
        if (paymentId) await tx.payment.update({ where: { id: paymentId }, data: { status: "PAID", paidAt: new Date(), subscriptionId: subResult.data.subscriptionId } });
    });
    if (subResult.data.subscriptionIndex === 0) {
        const createdSubForSync = await prisma.subscription.findUnique({
            where: { id: subResult.data.subscriptionId },
            select: { remnawaveUuid: true },
        });
        if (createdSubForSync?.remnawaveUuid) {
            await prisma.client.update({
                where: { id: clientId },
                data: { remnawaveUuid: createdSubForSync.remnawaveUuid },
            }).catch(() => { });
        }
    }
    const createdSub = await prisma.subscription.findUnique({
        where: { id: subResult.data.subscriptionId },
        select: { remnawaveUuid: true },
    });
    let subscriptionUrl: string | null = null;
    if (createdSub?.remnawaveUuid) {
        try {
            const r = await remnaGetUser(createdSub.remnawaveUuid);
            const inner = (r.data as {
                response?: Record<string, unknown>;
                data?: Record<string, unknown>;
            } | null)?.response
                ?? (r.data as {
                    response?: Record<string, unknown>;
                    data?: Record<string, unknown>;
                } | null)?.data
                ?? (r.data as Record<string, unknown> | null);
            subscriptionUrl = (inner as {
                subscriptionUrl?: string;
            } | null)?.subscriptionUrl ?? null;
        }
        catch { }
    }
    import("../notification/telegram-notify.service.js")
        .then((m) => m.notifyAdminsAboutTrialActivated(clientId, trial.name, trial.durationDays))
        .catch((e) => console.error("[trial activate] admin notify failed:", e));
    return reply(200, {
        message: `🎁 Пробная подписка «${trial.name}» активирована на ${trial.durationDays} дн.!`,
        subscriptionId: subResult.data.subscriptionId,
        trialId: trial.id,
        durationDays: trial.durationDays,
        tariffId: trial.tariffId,
        tariffHasLocations: !!(trial.tariff?.locations?.trim()),
        subscriptionUrl,
    });
}

export async function syncExistingTrialUsagesFlag(): Promise<number> {
  try {
    const res = await prisma.$executeRawUnsafe(
      "UPDATE clients SET trial_used = true WHERE id IN (SELECT DISTINCT client_id FROM client_trial_usages) AND trial_used = false;"
    );
    return typeof res === "number" ? res : 0;
  } catch (err) {
    console.warn("[trial] syncExistingTrialUsagesFlag error:", err);
    return 0;
  }
}
