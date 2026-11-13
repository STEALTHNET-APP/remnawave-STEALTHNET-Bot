import { Router } from "express";
import { prisma } from "../../db.js";

export const adminAnalyticsRouter = Router();

const PAID_EXTERNAL_WHERE = { status: "PAID" as const, provider: { not: "balance" } };

// ═══════════════════════════════════════════════════════════════
//  АНАЛИТИКА (полная)
// ═══════════════════════════════════════════════════════════════

/** helper: заполняет дневной ряд нулями */
function fillDaySeries(map: Record<string, number>, from: Date, to: Date): { date: string; value: number }[] {
  const out: { date: string; value: number }[] = [];
  const d = new Date(from);
  while (d <= to) {
    const key = d.toISOString().slice(0, 10);
    out.push({ date: key, value: map[key] ?? 0 });
    d.setDate(d.getDate() + 1);
  }
  return out;
}

adminAnalyticsRouter.get("/", async (_req, res) => {
  const now = new Date();
  const day1Ago = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const day7Ago = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const day30Ago = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const day90Ago = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  // ─── Все оплаченные платежи за 90 дней ───
  const payments90 = await prisma.payment.findMany({
    where: { status: "PAID", paidAt: { gte: day90Ago } },
    select: { amount: true, paidAt: true, provider: true, tariffId: true, clientId: true },
    orderBy: { paidAt: "asc" },
  });

  const revenueByDay: Record<string, number> = {};
  const revenueByProvider: Record<string, number> = {};
  const tariffSalesCount: Record<string, number> = {};
  const tariffRevenue: Record<string, number> = {};
  const uniqueBuyers = new Set<string>();
  let rev7 = 0, rev30 = 0, cnt7 = 0, cnt30 = 0;

  const isExternal = (provider: string | null) => provider !== "balance";
  for (const p of payments90) {
    const day = p.paidAt ? p.paidAt.toISOString().slice(0, 10) : "unknown";
    const prov = p.provider ?? "unknown";
    if (isExternal(p.provider)) {
      revenueByDay[day] = (revenueByDay[day] ?? 0) + p.amount;
      uniqueBuyers.add(p.clientId);
      if (p.paidAt && p.paidAt >= day7Ago) { rev7 += p.amount; cnt7++; }
      if (p.paidAt && p.paidAt >= day30Ago) { rev30 += p.amount; cnt30++; }
      if (p.tariffId) tariffRevenue[p.tariffId] = (tariffRevenue[p.tariffId] ?? 0) + p.amount;
    }
    revenueByProvider[prov] = (revenueByProvider[prov] ?? 0) + p.amount;
    if (p.tariffId) tariffSalesCount[p.tariffId] = (tariffSalesCount[p.tariffId] ?? 0) + 1;
  }

  const revenueSeries = fillDaySeries(revenueByDay, day90Ago, now);

  const [balanceAgg, [clientStats], recentClients, utmGroups, utmTrialGroups, referrerGroups] = await Promise.all([
    prisma.client.aggregate({ _sum: { balance: true } }),
    prisma.$queryRaw<Array<{
      both_count: bigint;
      bot_count: bigint;
      site_count: bigint;
      trial_count: bigint;
      referrer_count: bigint;
    }>>`
      SELECT
        COUNT(*) FILTER (WHERE telegram_id IS NOT NULL AND email IS NOT NULL) AS both_count,
        COUNT(*) FILTER (WHERE telegram_id IS NOT NULL AND email IS NULL) AS bot_count,
        COUNT(*) FILTER (WHERE telegram_id IS NULL AND email IS NOT NULL) AS site_count,
        COUNT(*) FILTER (WHERE trial_used = true) AS trial_count,
        COUNT(*) FILTER (WHERE referrer_id IS NOT NULL) AS referrer_count
      FROM clients
    `,
    prisma.client.findMany({
      where: { createdAt: { gte: day90Ago } },
      select: { createdAt: true, trialUsed: true },
    }),
    prisma.client.groupBy({ by: ["utmSource", "utmCampaign"], _count: { _all: true } }),
    prisma.client.groupBy({ by: ["utmSource", "utmCampaign"], where: { trialUsed: true }, _count: { _all: true } }),
    prisma.client.groupBy({ by: ["referrerId"], where: { referrerId: { not: null } }, _count: { _all: true } }),
  ]);

  const totalBalance = balanceAgg._sum.balance ?? 0;
  const botClients = Number(clientStats?.bot_count ?? 0);
  const siteClients = Number(clientStats?.site_count ?? 0);
  const bothClients = Number(clientStats?.both_count ?? 0);
  const trialUsedCount = Number(clientStats?.trial_count ?? 0);
  const withReferrer = Number(clientStats?.referrer_count ?? 0);

  const clientsByDay: Record<string, number> = {};
  for (const c of recentClients) {
    const day = c.createdAt.toISOString().slice(0, 10);
    clientsByDay[day] = (clientsByDay[day] ?? 0) + 1;
  }

  const clientsSeries = fillDaySeries(clientsByDay, day90Ago, now);

  // ─── Аналитика по источникам трафика (UTM) ───
  const bySourceKey: Record<string, { registrations: number; trials: number; payments: number; revenue: number }> = {};
  function keyFor(source: string | null, campaign: string | null) {
    const s = source?.trim() || "(без метки)";
    const c = campaign?.trim() || "";
    return `${s}\t${c}`;
  }
  for (const group of utmGroups) {
    const k = keyFor(group.utmSource, group.utmCampaign);
    if (!bySourceKey[k]) bySourceKey[k] = { registrations: 0, trials: 0, payments: 0, revenue: 0 };
    bySourceKey[k].registrations += group._count._all;
  }
  for (const group of utmTrialGroups) {
    const k = keyFor(group.utmSource, group.utmCampaign);
    if (!bySourceKey[k]) bySourceKey[k] = { registrations: 0, trials: 0, payments: 0, revenue: 0 };
    bySourceKey[k].trials += group._count._all;
  }
  const paymentClientIds = [...new Set(payments90.map((p) => p.clientId))];
  const paymentClients = paymentClientIds.length > 0
    ? await prisma.client.findMany({
        where: { id: { in: paymentClientIds } },
        select: { id: true, trialUsed: true, utmSource: true, utmCampaign: true },
      })
    : [];
  const clientIdToUtm = new Map(paymentClients.map((c) => [c.id, { source: c.utmSource, campaign: c.utmCampaign }]));
  for (const p of payments90) {
    const utm = clientIdToUtm.get(p.clientId);
    const k = keyFor(utm?.source ?? null, utm?.campaign ?? null);
    if (!bySourceKey[k]) bySourceKey[k] = { registrations: 0, trials: 0, payments: 0, revenue: 0 };
    if (isExternal(p.provider)) {
      bySourceKey[k].payments++;
      bySourceKey[k].revenue += p.amount;
    }
  }
  const campaignsStats = Object.entries(bySourceKey).map(([key, v]) => {
    const [source, campaign] = key.split("\t");
    return { source, campaign: campaign || null, ...v };
  }).sort((a, b) => b.revenue - a.revenue);

  // ─── Триалы по дням (клиенты с trialUsed, приближаем по createdAt) ───
  // Точной даты триала нет, но можем показать клиентов использовавших триал
  // Вместо этого считаем из promo activations и trial по дням
  const trialsByDay: Record<string, number> = {};
  for (const c of recentClients) {
    if (!c.trialUsed) continue;
    const day = c.createdAt.toISOString().slice(0, 10);
    trialsByDay[day] = (trialsByDay[day] ?? 0) + 1;
  }
  const trialsSeries = fillDaySeries(trialsByDay, day90Ago, now);

  // ─── Конверсия: триал → покупка ───
  const trialToPaid = paymentClients.filter((c) => c.trialUsed && uniqueBuyers.has(c.id)).length;
  const trialConversionRate = trialUsedCount > 0 ? Math.round((trialToPaid / trialUsedCount) * 100) : 0;

  // ─── Топ тарифов (продажи + доход) ───
  const tariffIds = Object.keys(tariffSalesCount);
  const tariffRows = tariffIds.length > 0
    ? await prisma.tariff.findMany({ where: { id: { in: tariffIds } }, select: { id: true, name: true } })
    : [];
  const tariffMap = Object.fromEntries(tariffRows.map((t) => [t.id, t.name]));
  const topTariffs = Object.entries(tariffSalesCount)
    .map(([id, count]) => ({ name: tariffMap[id] ?? id, count, revenue: tariffRevenue[id] ?? 0 }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  // ─── Доход по провайдерам ───
  const providerSeries = Object.entries(revenueByProvider).map(([provider, amount]) => ({
    provider: provider === "balance" ? "Баланс" : provider === "platega" ? "Platega" : provider === "cryptopay" ? "Crypto Pay" : provider === "heleket" ? "Heleket" : provider === "overpay" ? "Overpay" : provider,
    amount,
  }));

  // ─── Топ рефералов ───
  const referralCredits = await prisma.referralCredit.findMany({
    select: { referrerId: true, amount: true, level: true },
  });
  const refEarnings: Record<string, { total: number; l1: number; l2: number; l3: number; count: number }> = {};
  for (const rc of referralCredits) {
    if (!refEarnings[rc.referrerId]) refEarnings[rc.referrerId] = { total: 0, l1: 0, l2: 0, l3: 0, count: 0 };
    const e = refEarnings[rc.referrerId];
    e.total += rc.amount;
    e.count++;
    if (rc.level === 1) e.l1 += rc.amount;
    else if (rc.level === 2) e.l2 += rc.amount;
    else if (rc.level === 3) e.l3 += rc.amount;
  }

  // Количество рефералов у каждого реферера
  const referralCounts: Record<string, number> = {};
  for (const group of referrerGroups) {
    if (group.referrerId) referralCounts[group.referrerId] = group._count._all;
  }

  const topReferrerIds = Object.entries(refEarnings)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 15)
    .map(([id]) => id);

  const topReferrerClients = topReferrerIds.length > 0
    ? await prisma.client.findMany({
        where: { id: { in: topReferrerIds } },
        select: { id: true, email: true, telegramUsername: true, telegramId: true },
      })
    : [];
  const refClientMap = Object.fromEntries(topReferrerClients.map((c) => [c.id, c]));
  const topReferrers = topReferrerIds.map((id) => {
    const c = refClientMap[id];
    const e = refEarnings[id];
    return {
      id,
      name: c?.telegramUsername ? `@${c.telegramUsername}` : c?.email ?? c?.telegramId ?? id,
      referrals: referralCounts[id] ?? 0,
      earnings: e.total,
      l1: e.l1,
      l2: e.l2,
      l3: e.l3,
      credits: e.count,
    };
  });

  // ─── Промо аналитика ───
  const [promoActivationsTotal, promoCodeUsagesTotal] = await Promise.all([
    prisma.promoActivation.count(),
    prisma.promoCodeUsage.count(),
  ]);

  // Промо-ссылки по группам
  const promoGroupStats = await prisma.promoGroup.findMany({
    select: { id: true, name: true, code: true, maxActivations: true, _count: { select: { activations: true } } },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  // Промокоды по коду
  const promoCodeStats = await prisma.promoCode.findMany({
    select: { id: true, code: true, name: true, type: true, maxUses: true, _count: { select: { usages: true } } },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  // Промо активации по дням
  const promoActs90 = await prisma.promoActivation.findMany({
    where: { createdAt: { gte: day90Ago } },
    select: { createdAt: true },
  });
  const promoActsByDay: Record<string, number> = {};
  for (const a of promoActs90) {
    const day = a.createdAt.toISOString().slice(0, 10);
    promoActsByDay[day] = (promoActsByDay[day] ?? 0) + 1;
  }
  const promoActsSeries = fillDaySeries(promoActsByDay, day90Ago, now);

  // Промокоды использований по дням
  const promoUsages90 = await prisma.promoCodeUsage.findMany({
    where: { createdAt: { gte: day90Ago } },
    select: { createdAt: true },
  });
  const promoUsagesByDay: Record<string, number> = {};
  for (const u of promoUsages90) {
    const day = u.createdAt.toISOString().slice(0, 10);
    promoUsagesByDay[day] = (promoUsagesByDay[day] ?? 0) + 1;
  }
  const promoUsagesSeries = fillDaySeries(promoUsagesByDay, day90Ago, now);

  // ─── Реферальные начисления по дням ───
  const refCredits90 = await prisma.referralCredit.findMany({
    where: { createdAt: { gte: day90Ago } },
    select: { createdAt: true, amount: true },
  });
  const refCreditsByDay: Record<string, number> = {};
  for (const rc of refCredits90) {
    const day = rc.createdAt.toISOString().slice(0, 10);
    refCreditsByDay[day] = (refCreditsByDay[day] ?? 0) + rc.amount;
  }
  const refCreditsSeries = fillDaySeries(refCreditsByDay, day90Ago, now);

  // ─── Сводка (доход и кол-во платежей — только внешние поступления, без оплаты с баланса) ───
  const [totalClients, activeClients, totalRevenueAgg, totalPayments, referralCreditsSum,
    clientsNew24h, clientsNew7d, clientsNew30d, paymentsPending] = await Promise.all([
    prisma.client.count(),
    prisma.client.count({ where: { remnawaveUuid: { not: null } } }),
    prisma.payment.aggregate({ where: PAID_EXTERNAL_WHERE, _sum: { amount: true } }),
    prisma.payment.count({ where: PAID_EXTERNAL_WHERE }),
    prisma.referralCredit.aggregate({ _sum: { amount: true } }),
    prisma.client.count({ where: { createdAt: { gte: day1Ago } } }),
    prisma.client.count({ where: { createdAt: { gte: day7Ago } } }),
    prisma.client.count({ where: { createdAt: { gte: day30Ago } } }),
    prisma.payment.count({ where: { status: "PENDING" } }),
  ]);

  const totalRevenue = totalRevenueAgg._sum.amount ?? 0;
  const avgCheck = totalPayments > 0 ? Math.round((totalRevenue / totalPayments) * 100) / 100 : 0;
  const arpu = totalClients > 0 ? Math.round((totalRevenue / totalClients) * 100) / 100 : 0;
  const payingClients = uniqueBuyers.size;
  const payingPercent = totalClients > 0 ? Math.round((payingClients / totalClients) * 100) : 0;

  return res.json({
    // Графики
    revenueSeries,
    clientsSeries,
    trialsSeries,
    promoActsSeries,
    promoUsagesSeries,
    refCreditsSeries,

    // Таблицы / списки
    topTariffs,
    providerSeries,
    topReferrers,
    campaignsStats,
    promoGroupStats: promoGroupStats.map((g) => ({
      name: g.name,
      code: g.code,
      maxActivations: g.maxActivations,
      activations: g._count.activations,
    })),
    promoCodeStats: promoCodeStats.map((c) => ({
      code: c.code,
      name: c.name,
      type: c.type,
      maxUses: c.maxUses,
      usages: c._count.usages,
    })),

    // Сводка
    summary: {
      totalClients,
      activeClients,
      totalRevenue,
      totalPayments,
      totalReferralPaid: referralCreditsSum._sum.amount ?? 0,
      promoActivations: promoActivationsTotal,
      promoCodeUsages: promoCodeUsagesTotal,
      // Новое
      clientsNew24h,
      clientsNew7d,
      clientsNew30d,
      botClients,
      siteClients,
      bothClients,
      trialUsedCount,
      trialToPaid,
      trialConversionRate,
      avgCheck,
      arpu,
      payingClients,
      payingPercent,
      rev7,
      rev30,
      cnt7,
      cnt30,
      paymentsPending,
      totalBalance: Math.round(totalBalance * 100) / 100,
      withReferrer,
    },
  });
});

