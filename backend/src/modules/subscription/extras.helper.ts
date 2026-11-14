/**
 * T-extras-drop-after-pay (14.05.2026)
 *
 * Helper для удаления всех доп. устройств подписки с жёстким kick HWID в Remna.
 * Используется в двух точках:
 *   1. UI endpoint /api/client/subscription/:type/:id/remove-extra-devices (юзер сам нажал)
 *   2. ПОСЛЕ успешной активации платежа (если в metadata.removeExtrasOnActivate=true)
 *
 * Что делает:
 *   • Получает текущие HWID-устройства из Remna
 *   • Если их больше нового лимита (tariff.includedDevices) — удаляет лишние (старые первыми)
 *   • Уменьшает hwidDeviceLimit в Remna до базы тарифа
 *   • Обнуляет Subscription.extraDevices + extraDevicesMonthlyPrice
 *
 * Идемпотентно: повторный вызов для подписки без extras — no-op.
 */
import { prisma } from "../../db.js";
import {
  remnaGetUser,
  remnaGetUserHwidDevices,
  remnaDeleteUserHwidDevice,
  remnaUpdateUser,
} from "../remna/remna.client.js";

export interface RemoveExtrasResult {
  ok: boolean;
  extraDevicesRemoved: number;
  hwidKicked: number;
  newDeviceLimit: number;
  error?: string;
}

/**
 * Кикает HWID-устройства сверх лимита `keepLimit` (старые первыми) — без изменения
 * лимита/счётчиков. Используется когда лимит уже выставлен вызывающим кодом
 * (например extendSecondarySubscription при «продлить без устройств»).
 * Возвращает количество киканутых устройств.
 */
export async function kickExcessHwidDevices(remnawaveUuid: string, keepLimit: number): Promise<number> {
  let removedHwids = 0;
  try {
    const devicesRes = await remnaGetUserHwidDevices(remnawaveUuid);
    const devicesData = devicesRes.data as { response?: { devices?: Array<{ hwid: string; createdAt?: string }> } } | undefined;
    const activeDevices = devicesData?.response?.devices ?? [];
    if (activeDevices.length > keepLimit) {
      // Сортируем по createdAt asc — старые удаляем первыми, новые сохраняем.
      const sorted = [...activeDevices].sort((a, b) => {
        const aT = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bT = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return aT - bT;
      });
      const toRemove = sorted.slice(0, activeDevices.length - keepLimit);
      for (const dev of toRemove) {
        await remnaDeleteUserHwidDevice(remnawaveUuid, dev.hwid).catch((e) => {
          console.error("[remove-extras-helper] kick HWID failed:", dev.hwid, e);
        });
        removedHwids += 1;
      }
    }
  } catch (e) {
    console.error("[remove-extras-helper] devices kick error:", e);
  }
  return removedHwids;
}

export async function removeAllExtraDevicesForSub(subId: string): Promise<RemoveExtrasResult> {
  const sub = await prisma.subscription.findUnique({
    where: { id: subId },
    select: { id: true, remnawaveUuid: true, tariffId: true, extraDevices: true },
  });
  if (!sub) {
    return { ok: false, extraDevicesRemoved: 0, hwidKicked: 0, newDeviceLimit: 0, error: "подписка не найдена" };
  }
  if (!sub.remnawaveUuid) {
    return { ok: false, extraDevicesRemoved: 0, hwidKicked: 0, newDeviceLimit: 0, error: "подписка не привязана к панели" };
  }
  if ((sub.extraDevices ?? 0) === 0) {
    // Уже нет extras — ничего не делаем.
    return { ok: true, extraDevicesRemoved: 0, hwidKicked: 0, newDeviceLimit: 0 };
  }

  const tariff = sub.tariffId
    ? await prisma.tariff.findUnique({
        where: { id: sub.tariffId },
        select: { includedDevices: true, deviceLimit: true },
      })
    : null;
  const includedDevices = tariff?.includedDevices ?? tariff?.deviceLimit ?? 1;

  // Список активных HWID — вариант Б: жёстко удалить лишние.
  const removedHwids = await kickExcessHwidDevices(sub.remnawaveUuid, includedDevices);

  // Уменьшаем лимит в Remna до базы.
  const updateRes = await remnaUpdateUser({
    uuid: sub.remnawaveUuid,
    hwidDeviceLimit: includedDevices,
  });
  if (updateRes.error) {
    return {
      ok: false,
      extraDevicesRemoved: 0,
      hwidKicked: removedHwids,
      newDeviceLimit: 0,
      error: updateRes.error,
    };
  }

  // Обнуляем счётчик + monthlyPrice в БД.
  await prisma.subscription.update({
    where: { id: sub.id },
    data: { extraDevices: 0, extraDevicesMonthlyPrice: 0 },
  });

  return {
    ok: true,
    extraDevicesRemoved: sub.extraDevices ?? 0,
    hwidKicked: removedHwids,
    newDeviceLimit: includedDevices,
  };
}

export interface GrantDevicesResult {
  ok: boolean;
  newDeviceLimit: number;
  error?: string;
}

// T-admin-services (портировано из WolfVPN): ВЫДАТЬ доп. устройства подписке (как покупка юзера,
// но инициирует админ — без оплаты). hwidDeviceLimit += N в Remna + extraDevices/monthlyPrice += в БД.
// monthlyPrice (₽/30 дней) попадает в цену продления автоматически (см. client.routes расчёт).
export async function applyDevicesToSubscription(subId: string, deviceCount: number, monthlyPrice: number): Promise<GrantDevicesResult> {
  if (!Number.isFinite(deviceCount) || deviceCount <= 0) {
    return { ok: false, newDeviceLimit: 0, error: "Количество устройств должно быть больше 0" };
  }
  const sub = await prisma.subscription.findUnique({
    where: { id: subId },
    select: { id: true, remnawaveUuid: true },
  });
  if (!sub) return { ok: false, newDeviceLimit: 0, error: "подписка не найдена" };
  if (!sub.remnawaveUuid) return { ok: false, newDeviceLimit: 0, error: "подписка не привязана к панели" };

  const userRes = await remnaGetUser(sub.remnawaveUuid);
  if (userRes.error) return { ok: false, newDeviceLimit: 0, error: userRes.error };
  const u = userRes.data as Record<string, unknown> | null;
  const inner = (u?.response ?? u) as Record<string, unknown> | undefined;
  const current = typeof inner?.hwidDeviceLimit === "number" ? inner.hwidDeviceLimit : 0;
  const newDevices = current + deviceCount;

  const updateRes = await remnaUpdateUser({ uuid: sub.remnawaveUuid, hwidDeviceLimit: newDevices });
  if (updateRes.error) return { ok: false, newDeviceLimit: 0, error: updateRes.error };

  await prisma.subscription.update({
    where: { id: sub.id },
    data: {
      extraDevices: { increment: deviceCount },
      extraDevicesMonthlyPrice: { increment: Math.max(0, monthlyPrice) },
    },
  });
  return { ok: true, newDeviceLimit: newDevices };
}
