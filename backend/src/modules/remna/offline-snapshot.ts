function baseDeviceLimit(
  tariff: { includedDevices?: number | null; deviceLimit?: number | null } | null | undefined,
): number | null {
  const included = typeof tariff?.includedDevices === "number" && Number.isFinite(tariff.includedDevices) ? tariff.includedDevices : 0;
  const legacy = typeof tariff?.deviceLimit === "number" && Number.isFinite(tariff.deviceLimit) ? tariff.deviceLimit : 0;
  const limit = Math.max(included, legacy);
  return limit > 0 ? limit : null;
}

export function offlineSubscriptionSnapshot(sub: {
  remnawaveUuid: string | null;
  shortUuid: string | null;
  remnaStatus: string | null;
  expireAt: Date | null;
  trafficUsedBytes: number | bigint | null;
  trafficLimitBytes: number | bigint | null;
  extraDevices?: number | null;
  tariff?: { trafficLimitBytes: number | bigint | null; includedDevices?: number | null; deviceLimit?: number | null } | null;
}) {
  let status = sub.remnaStatus ?? "UNKNOWN";
  if (status === "ACTIVE" && sub.expireAt && sub.expireAt.getTime() <= Date.now()) status = "EXPIRED";
  const limit = sub.trafficLimitBytes ?? sub.tariff?.trafficLimitBytes;
  const baseDevices = baseDeviceLimit(sub.tariff);
  const totalDevices = baseDevices != null ? baseDevices + (sub.extraDevices ?? 0) : null;
  return {
    response: {
      uuid: sub.remnawaveUuid,
      shortUuid: sub.shortUuid,
      status,
      expireAt: sub.expireAt?.toISOString() ?? null,
      subscriptionUrl: null,
      userTraffic: { usedTrafficBytes: Number(sub.trafficUsedBytes ?? 0) },
      trafficLimitBytes: limit != null ? Number(limit) : null,
      hwidDeviceLimit: totalDevices,
    },
    isOfflineSnapshot: true,
  };
}
