export type TariffDeviceFields = {
  includedDevices?: number | null;
  deviceLimit?: number | null;
  maxExtraDevices?: number | null;
};

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export function tariffBaseDeviceLimit(tariff: TariffDeviceFields | null | undefined): number | null {
  const included = numeric(tariff?.includedDevices) ?? 0;
  const legacy = numeric(tariff?.deviceLimit) ?? 0;
  const limit = Math.max(included, legacy);
  return limit > 0 ? limit : null;
}

export function formatTariffDeviceLine(tariff: TariffDeviceFields | null | undefined): string {
  const limit = tariffBaseDeviceLimit(tariff);
  if (limit == null) return "устройства без лимита";
  const extraMax = numeric(tariff?.maxExtraDevices) ?? 0;
  return `устройства ${limit}${extraMax > 0 ? ` (+до ${extraMax})` : ""}`;
}
