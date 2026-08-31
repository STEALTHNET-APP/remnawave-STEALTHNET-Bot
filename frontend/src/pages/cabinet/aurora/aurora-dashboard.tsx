/**
 * AuroraDashboard — главный экран мини-аппа «Aurora».
 *
 * Композиция (как в утверждённом макете):
 *   • крупная градиентная карточка подписки: логин, статус, дни, тариф/срок,
 *     полоса остатка трафика;
 *   • три плитки-метрики: устройства, израсходовано, дата обновления;
 *   • основная кнопка «Подключиться» и вторичная «Скопировать ссылку»;
 *   • поясняющий текст под кнопками.
 *
 * Данные берём теми же вызовами, что и остальные кабинеты
 * (`clientAllSubscriptions` + `getMyAllDevices`), чтобы поведение совпадало.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Copy } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Достаёт объект Remnawave-подписки из разных форм ответа бэка. */
function unwrapRemna(sub: unknown): Record<string, unknown> | null {
  if (!sub || typeof sub !== "object") return null;
  const raw = sub as Record<string, unknown>;
  const resp = raw.response;
  if (resp && typeof resp === "object") return resp as Record<string, unknown>;
  return raw;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Байты → человекочитаемо (0 Б / 940 МБ / 10 ГБ). */
function fmtBytes(b: number | null): string {
  if (b == null) return "—";
  if (b <= 0) return "0 Б";
  const u = ["Б", "КБ", "МБ", "ГБ", "ТБ"];
  let i = 0;
  let v = b;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(v >= 10 ? 0 : 1)} ${u[i]}`;
}

function fmtDateShort(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  } catch {
    return "—";
  }
}

function fmtDateLong(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
  } catch {
    return "—";
  }
}

function daysLeft(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.ceil((t - Date.now()) / 86_400_000));
}

/** «58 дней» с правильным окончанием. */
function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

export function AuroraDashboard() {
  const { state } = useClientAuth();
  const token = state.token ?? "";
  const navigate = useNavigate();

  const [items, setItems] = useState<Awaited<ReturnType<typeof api.clientAllSubscriptions>>["items"]>([]);
  const [devices, setDevices] = useState<{ total: number }>({ total: 0 });
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      const [subs, devs] = await Promise.all([
        api.clientAllSubscriptions(token).catch(() => ({ items: [] })),
        api.getMyAllDevices(token).catch(() => ({ total: 0, items: [] })),
      ]);
      if (cancelled) return;
      setItems(subs.items ?? []);
      setDevices({ total: devs.total ?? 0 });
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Показываем главную подписку (root / index 0), иначе первую доступную.
  const main = useMemo(
    () => items.find((i) => i.type === "root" || i.subscriptionIndex === 0) ?? items[0] ?? null,
    [items],
  );
  const remna = unwrapRemna(main?.subscription);

  const expireAt = typeof remna?.expireAt === "string" ? remna.expireAt : null;
  const left = daysLeft(expireAt);
  const status = typeof remna?.status === "string" ? remna.status : null;
  const isActive = status ? status === "ACTIVE" : left != null && left > 0;
  const username = typeof remna?.username === "string" ? remna.username : (state.client?.email ?? "");
  const subUrl = typeof remna?.subscriptionUrl === "string" ? remna.subscriptionUrl : null;

  const usedRaw =
    num((remna?.userTraffic as Record<string, unknown> | undefined)?.usedTrafficBytes) ??
    num(remna?.usedTrafficBytes);
  const limit = num(remna?.trafficLimitBytes);
  const unlimited = limit === 0 || limit == null;
  const used = usedRaw ?? 0;
  const restBytes = unlimited ? null : Math.max(0, (limit ?? 0) - used);
  const usedPct = unlimited ? 0 : Math.min(100, Math.round((used / (limit || 1)) * 100));

  const deviceLimit = num(remna?.hwidDeviceLimit);
  const isTrial = !!main?.trialId;

  const copyLink = async () => {
    if (!subUrl) return;
    try {
      await navigator.clipboard.writeText(subUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* буфер недоступен — молча игнорируем */
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-[190px] animate-pulse rounded-[26px] bg-[var(--au-surface)]" />
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[86px] animate-pulse rounded-[20px] bg-[var(--au-surface)]" />
          ))}
        </div>
        <div className="h-[58px] animate-pulse rounded-[20px] bg-[var(--au-surface)]" />
      </div>
    );
  }

  if (!main) {
    return (
      <div className="rounded-[26px] bg-[var(--au-surface)] p-6 text-center">
        <p className="text-[15px] font-semibold">Подписки пока нет</p>
        <p className="mt-1 text-[13px] text-[var(--au-muted)]">Выберите тариф — доступ включится сразу после оплаты.</p>
        <button
          type="button"
          onClick={() => navigate("/cabinet/tariffs")}
          className="mt-4 w-full rounded-[18px] bg-[linear-gradient(135deg,var(--au-from),var(--au-to))] px-5 py-3.5 text-[15px] font-bold text-white"
        >
          Выбрать тариф
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* ── Карточка подписки ── */}
      <section className="relative overflow-hidden rounded-[26px] bg-[linear-gradient(135deg,var(--au-from),var(--au-to))] p-5 text-white">
        <div className="flex items-start justify-between gap-3">
          <span className="truncate text-[15px] font-medium text-white/85">{username || "—"}</span>
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-white/20 px-3 py-1.5 text-[13px] font-semibold">
            <span className={cn("h-1.5 w-1.5 rounded-full", isActive ? "bg-white" : "bg-white/60")} />
            {isActive ? "Активна" : "Неактивна"}
          </span>
        </div>

        <div className="mt-4">
          <div className="text-[40px] font-extrabold leading-none tracking-tight">
            {left != null ? `${left} ${plural(left, "день", "дня", "дней")}` : "—"}
          </div>
          <div className="mt-1.5 text-[15px] text-white/80">
            {(isTrial ? "Пробный" : main.tariffDisplayName || "Подписка") + " · до " + fmtDateLong(expireAt)}
          </div>
        </div>

        <div className="mt-5">
          <div className="flex items-baseline justify-between text-[14px] text-white/85">
            <span>{unlimited ? "Трафик без ограничений" : `${fmtBytes(restBytes)} осталось`}</span>
            {!unlimited && <span className="text-white/70">из {fmtBytes(limit)}</span>}
          </div>
          <div className="mt-2 h-[6px] overflow-hidden rounded-full bg-white/25">
            <div
              className="h-full rounded-full bg-white/90 transition-[width] duration-500"
              style={{ width: unlimited ? "100%" : `${100 - usedPct}%` }}
            />
          </div>
        </div>
      </section>

      {/* ── Плитки-метрики ── */}
      <section className="grid grid-cols-3 gap-3">
        {[
          {
            v: deviceLimit != null ? `${devices.total}/${deviceLimit}` : String(devices.total),
            l: "Устройства",
          },
          { v: fmtBytes(used), l: "Израсходовано" },
          { v: fmtDateShort(expireAt), l: "Обновится" },
        ].map((t) => (
          <div key={t.l} className="rounded-[20px] bg-[var(--au-surface)] px-3 py-4 text-center">
            <div className="text-[19px] font-extrabold tracking-tight">{t.v}</div>
            <div className="mt-0.5 text-[12.5px] text-[var(--au-muted)]">{t.l}</div>
          </div>
        ))}
      </section>

      {/* ── Действия ── */}
      <button
        type="button"
        onClick={() => navigate("/cabinet/subscribe")}
        className="w-full rounded-[20px] bg-[linear-gradient(135deg,var(--au-from),var(--au-to))] px-5 py-4 text-[17px] font-bold text-white shadow-[0_10px_28px_-10px_rgba(79,70,229,0.65)] active:scale-[0.99] transition-transform"
      >
        Подключиться
      </button>

      <button
        type="button"
        onClick={copyLink}
        disabled={!subUrl}
        className="flex w-full items-center justify-center gap-2 rounded-[20px] border-2 border-[var(--au-from)]/35 px-5 py-4 text-[16px] font-bold text-[var(--au-from)] disabled:opacity-40 active:scale-[0.99] transition-transform"
      >
        {copied ? <Check className="h-[18px] w-[18px]" /> : <Copy className="h-[18px] w-[18px]" />}
        {copied ? "Ссылка скопирована" : "Скопировать ссылку"}
      </button>

      <p className="px-1 pt-1 text-[14px] leading-relaxed text-[var(--au-muted)]">
        Ссылку вставляют в приложение VPN. Кнопка «Подключиться» откроет страницу, где приложение
        подберётся под ваше устройство.
      </p>
    </div>
  );
}
