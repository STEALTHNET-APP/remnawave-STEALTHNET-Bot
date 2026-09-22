type SubscriptionOwner = {
  ownerId: string;
  giftedToClientId: string | null;
  remnawaveUuid: string | null;
};
export type DeviceDependencies = {
  findSubscription(id: string): Promise<SubscriptionOwner | null>;
  getDevices(uuid: string): Promise<{ status: number; data?: unknown; error?: string }>;
};
type Device = { hwid: string; platform?: string; deviceModel?: string; appName?: string; createdAt?: string };
type DeviceResult = {
  status: number;
  body: { total: number; devices: Device[] } | { message: string };
};
function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** A selected subscription is authoritative, even without the legacy type field. */
export function usesLegacyDeviceFallback(body: { subscriptionId?: string; subscriptionType?: string }): boolean {
  return !body.subscriptionId && !body.subscriptionType;
}

/** Do not turn a missing/failed VPN response into a convincing zero-device count. */
export async function readSubscriptionDevices(clientId: string, id: string, deps: DeviceDependencies): Promise<DeviceResult> {
  const sub = await deps.findSubscription(id);
  if (!sub || (sub.ownerId !== clientId && sub.giftedToClientId !== clientId)) {
    return { status: 404, body: { message: "Подписка не найдена" } };
  }
  if (!sub.remnawaveUuid) {
    return { status: 409, body: { message: "Подписка не привязана к VPN" } };
  }
  const unavailable = { status: 503, body: { message: "Не удалось загрузить устройства. Попробуйте ещё раз." } };
  let result: Awaited<ReturnType<DeviceDependencies["getDevices"]>>;
  try {
    result = await deps.getDevices(sub.remnawaveUuid);
  } catch {
    return unavailable;
  }
  if (result.error || result.status < 200 || result.status >= 300) return unavailable;
  const response = object(object(result.data)?.response);
  if (!Array.isArray(response?.devices)) return unavailable;
  const devices = new Map<string, Device>();
  for (const value of response.devices) {
    const raw = object(value);
    if (!raw || typeof raw.hwid !== "string" || !raw.hwid.trim()) return unavailable;
    if (devices.has(raw.hwid)) continue;
    devices.set(raw.hwid, {
      hwid: raw.hwid,
      platform: optionalText(raw.platform),
      deviceModel: optionalText(raw.deviceModel),
      appName: optionalText(raw.appName ?? raw.clientName ?? raw.userAgent ?? raw.app),
      createdAt: optionalText(raw.createdAt),
    });
  }
  return { status: 200, body: { total: devices.size, devices: [...devices.values()] } };
}
