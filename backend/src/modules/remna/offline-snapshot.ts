export function offlineSubscriptionSnapshot(sub: {
  remnawaveUuid: string | null;
  shortUuid: string | null;
  remnaStatus: string | null;
  expireAt: Date | null;
  trafficUsedBytes: number | bigint | null;
  trafficLimitBytes: number | bigint | null;
  tariff?: { trafficLimitBytes: number | bigint | null } | null;
}) {
  let status = sub.remnaStatus ?? "UNKNOWN";
  if (status === "ACTIVE" && sub.expireAt && sub.expireAt.getTime() <= Date.now()) status = "EXPIRED";
  const limit = sub.trafficLimitBytes ?? sub.tariff?.trafficLimitBytes;
  return {
    response: {
      uuid: sub.remnawaveUuid,
      shortUuid: sub.shortUuid,
      status,
      expireAt: sub.expireAt?.toISOString() ?? null,
      subscriptionUrl: null,
      userTraffic: { usedTrafficBytes: Number(sub.trafficUsedBytes ?? 0) },
      trafficLimitBytes: limit != null ? Number(limit) : null,
    },
    isOfflineSnapshot: true,
  };
}
