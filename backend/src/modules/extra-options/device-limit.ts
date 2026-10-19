import type { Prisma } from "@prisma/client";

type Db = Pick<Prisma.TransactionClient, "subscription" | "payment" | "$executeRaw">;

export function deviceOptionMetadata(value: unknown): Record<string, any> | null {
  try {
    const data = typeof value === "string" ? JSON.parse(value) : value;
    return data?.extraOption?.kind === "devices" ? data : null;
  } catch {
    return null;
  }
}

export function deviceLimitError(message: string) {
  return Object.assign(new Error(message), { code: "EXTRA_DEVICE_LIMIT" });
}

export async function lockDevicePurchases(db: Db, clientId: string) {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${clientId}, 43))`;
}

export async function validateDevicePurchase(db: Db, clientId: string, metadata: unknown) {
  const meta = deviceOptionMetadata(metadata);
  if (!meta) return metadata;
  const count = meta.extraOption.deviceCount;
  if (!Number.isSafeInteger(count) || count <= 0) throw deviceLimitError("Некорректное количество устройств.");
  const targetId = typeof meta.targetSubscriptionId === "string" ? meta.targetSubscriptionId : null;
  const sub = await db.subscription.findFirst({
    where: targetId ? { id: targetId, ownerId: clientId } : { ownerId: clientId, subscriptionIndex: 0 },
    select: { id: true, extraDevices: true, remnawaveUuid: true, expireAt: true, tariff: { select: { maxExtraDevices: true } } },
  });
  if (!sub?.remnawaveUuid || (sub.expireAt && sub.expireAt <= new Date())) {
    throw deviceLimitError("Сначала оформите или продлите подписку.");
  }
  const maximum = Math.max(0, sub.tariff?.maxExtraDevices ?? 0);
  const available = Math.max(0, maximum - sub.extraDevices);
  if (count > available) {
    throw deviceLimitError(`По тарифу можно докупить ещё ${available} устройств. Лимит дополнительных устройств: ${maximum}.`);
  }
  return JSON.stringify({ ...meta, targetSubscriptionId: sub.id });
}

export async function validateTariffDevices(db: Pick<Prisma.TransactionClient, "tariff" | "subscription">, clientId: string, tariffId: string, count: number | null | undefined, metadata?: unknown) {
  if (count == null || count === 0) return;
  if (!Number.isSafeInteger(count) || count < 0) throw deviceLimitError("Некорректное количество устройств.");
  const tariff = await db.tariff.findUnique({ where: { id: tariffId }, select: { maxExtraDevices: true } });
  let meta: Record<string, unknown> = {};
  try { meta = (typeof metadata === "string" ? JSON.parse(metadata) : metadata) ?? {}; } catch {}
  let existing = 0;
  if (typeof meta.extendsSecondarySubId === "string" && meta.removeExtrasOnActivate !== true) {
    const sub = await db.subscription.findFirst({ where: { id: meta.extendsSecondarySubId, OR: [{ ownerId: clientId }, { giftedToClientId: clientId }] }, select: { extraDevices: true } });
    existing = sub?.extraDevices ?? 0;
  }
  const available = Math.max(0, (tariff?.maxExtraDevices ?? 0) - existing);
  if (count > available) throw deviceLimitError(`По тарифу можно докупить ещё ${available} устройств.`);
}
