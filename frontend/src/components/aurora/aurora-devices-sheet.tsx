/**
 * AuroraDevicesSheet — шторка управления подключёнными устройствами (HWID) в дизайне Aurora.
 *
 * Особенности:
 *   • Отображение текущего списка устройств через api.getMyAllDevices;
 *   • Группировка по подпискам при наличии нескольких активных тарифов;
 *   • Определение платформы (iOS, Android, Windows, Mac, Linux) с нативными иконками;
 *   • Двухэтапное безопасное отключение устройства с подтверждением;
 *   • Интеграция с темой оформления Aurora (светлая и тёмная темы, единые CSS-переменные).
 */

import { useEffect, useState } from "react";
import {
  Smartphone, Laptop, Monitor, Apple, Tv, Trash2, Loader2, AlertCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useClientAuth } from "@/contexts/client-auth";
import { api, type ClientDeviceItem } from "@/lib/api";
import { AuroraSheet } from "@/components/aurora/aurora-sheet";

interface Props {
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
}

function platformIcon(platform?: string) {
  const p = (platform ?? "").toLowerCase();
  if (/ios|iphone|ipad/.test(p)) return Apple;
  if (/android/.test(p)) return Smartphone;
  if (/mac|darwin/.test(p)) return Laptop;
  if (/win/.test(p)) return Monitor;
  if (/linux/.test(p)) return Tv;
  return Smartphone;
}

function fmtDate(iso?: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

export function AuroraDevicesSheet({ open, onClose, onChanged }: Props) {
  const { t } = useTranslation();
  const { state } = useClientAuth();
  const token = state.token;

  const [devices, setDevices] = useState<ClientDeviceItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [removingHwid, setRemovingHwid] = useState<string | null>(null);
  const [confirmHwid, setConfirmHwid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.getMyAllDevices(token);
      setDevices(res.items ?? []);
      setTotal(res.total ?? (res.items ?? []).length);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("cabinet.profile.devices_error_load", "Не удалось загрузить устройства")
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) {
      load();
      setConfirmHwid(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, token]);

  async function removeDevice(item: ClientDeviceItem) {
    if (!token) return;
    setRemovingHwid(item.hwid);
    setError(null);
    try {
      await api.deleteClientDevice(token, item.hwid, {
        type: item.subscriptionType,
        id: item.subscriptionId,
      });
      setDevices((prev) =>
        prev.filter((d) => !(d.hwid === item.hwid && d.subscriptionId === item.subscriptionId))
      );
      setTotal((prev) => Math.max(0, prev - 1));
      setConfirmHwid(null);
      onChanged?.();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("cabinet.profile.devices_error_disconnect", "Не удалось отключить устройство")
      );
    } finally {
      setRemovingHwid(null);
    }
  }

  return (
    <AuroraSheet
      open={open}
      onClose={onClose}
      title={t("cabinet.profile.sessions_desc", "Подключённые устройства")}
    >
      <div className="space-y-4 pb-4">
        {/* Инфо-карточка со счётчиком */}
        <div className="rounded-[20px] bg-[var(--au-surface)] p-4 flex items-center justify-between">
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-[var(--au-ink)]">
              {t("cabinet.profile.sessions_label", "Подключено устройств")}
            </div>
            <div className="text-[12px] text-[var(--au-muted)] mt-0.5 leading-snug">
              {t(
                "cabinet.profile.devices_disconnect_hint",
                "Отключите устройство, чтобы освободить слот для другого"
              )}
            </div>
          </div>
          <span className="flex h-10 min-w-10 px-3 items-center justify-center rounded-full bg-[var(--au-bg)] text-[16px] font-extrabold text-[var(--au-ink)] tabular-nums shrink-0 ml-3">
            {total}
          </span>
        </div>

        {/* Баннер ошибки */}
        {error && (
          <div className="rounded-[16px] bg-red-500/10 border border-red-500/20 p-3 text-[13px] text-red-500 dark:text-red-400 flex items-center gap-2.5">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span className="flex-1 min-w-0">{error}</span>
            <button
              type="button"
              onClick={load}
              className="text-[12px] font-bold underline hover:no-underline shrink-0"
            >
              {t("common.retry", "Повторить")}
            </button>
          </div>
        )}

        {/* Индикатор загрузки */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-10">
            <Loader2 className="h-7 w-7 animate-spin text-[var(--au-from)]" />
            <span className="mt-2 text-[13px] text-[var(--au-muted)]">
              {t("common.loading", "Загрузка устройств…")}
            </span>
          </div>
        ) : devices.length === 0 ? (
          /* Пустое состояние */
          <div className="rounded-[22px] bg-[var(--au-surface)] p-8 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[var(--au-bg)] text-[var(--au-muted)] mb-3">
              <Smartphone className="h-7 w-7" />
            </div>
            <p className="text-[15px] font-bold text-[var(--au-ink)]">
              {t("cabinet.profile.no_devices_title", "Устройств пока нет")}
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-[var(--au-muted)] max-w-[280px] mx-auto">
              {t(
                "cabinet.profile.devices_empty_hint",
                "Подключитесь к VPN через приложение, и ваше устройство появится здесь."
              )}
            </p>
          </div>
        ) : (
          /* Список устройств */
          (() => {
            const groups = new Map<string, { label: string; items: ClientDeviceItem[] }>();
            for (const d of devices) {
              const key = d.subscriptionId || "default";
              const label = `Подписка #${d.subscriptionIndex}${
                d.tariffName ? ` — ${d.tariffName}` : ""
              }`;
              if (!groups.has(key)) groups.set(key, { label, items: [] });
              groups.get(key)!.items.push(d);
            }
            const showGroupLabels = groups.size > 1;

            return (
              <div className="space-y-4">
                {Array.from(groups.entries()).map(([subId, group]) => (
                  <div key={subId} className="space-y-2">
                    {showGroupLabels && (
                      <div className="px-1 text-[12px] font-semibold text-[var(--au-muted)]">
                        {group.label}
                      </div>
                    )}
                    {group.items.map((d) => {
                      const Icon = platformIcon(d.platform);
                      const confirmKey = `${d.hwid}_${d.subscriptionId}`;
                      const isConfirm = confirmHwid === confirmKey;
                      const isRemoving = removingHwid === d.hwid;

                      return (
                        <div
                          key={confirmKey}
                          className="flex items-center gap-3 rounded-[20px] bg-[var(--au-surface)] p-3.5 transition-all"
                        >
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--au-bg)] text-[var(--au-ink)]">
                            <Icon className="h-5 w-5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-[14.5px] font-bold text-[var(--au-ink)]">
                                {d.deviceModel ||
                                  d.platform ||
                                  t("cabinet.profile.device", "Устройство")}
                              </span>
                              {d.appName && (
                                <span className="inline-block rounded-md bg-[var(--au-bg)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--au-from)] border border-white/5 shrink-0">
                                  {d.appName}
                                </span>
                              )}
                            </div>
                            <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-[var(--au-muted)]">
                              <span className="font-mono">{d.hwid.slice(0, 12)}…</span>
                              {d.createdAt && (
                                <>
                                  <span>·</span>
                                  <span>{fmtDate(d.createdAt)}</span>
                                </>
                              )}
                            </div>
                          </div>

                          {isConfirm ? (
                            <div className="flex items-center gap-1.5 shrink-0 ml-1">
                              <button
                                type="button"
                                onClick={() => removeDevice(d)}
                                disabled={isRemoving}
                                className="rounded-xl bg-red-500 hover:bg-red-600 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50 transition-colors shadow-sm"
                              >
                                {isRemoving ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  t("cabinet.profile.device_disconnect", "Отключить")
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmHwid(null)}
                                disabled={isRemoving}
                                className="rounded-xl bg-[var(--au-bg)] px-2.5 py-1.5 text-[12px] font-semibold text-[var(--au-muted)] hover:text-[var(--au-ink)] transition-colors"
                              >
                                {t("common.cancel", "Отмена")}
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmHwid(confirmKey)}
                              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--au-bg)] text-red-500/80 hover:text-red-500 hover:bg-red-500/10 transition-colors active:scale-95"
                              title={t("cabinet.profile.device_disconnect", "Отключить")}
                              aria-label="Отключить"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            );
          })()
        )}
      </div>
    </AuroraSheet>
  );
}
