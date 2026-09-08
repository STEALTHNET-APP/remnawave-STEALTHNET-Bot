/**
 * Stealth Dashboard — главная страница нового дизайна.
 *
 * мультиподписочность как в основном кабинете:
 *   1. Hero/визуал — мягкое свечение + большое лого/иконка над контентом
 *   2. Карточка «Подписки»: СПИСОК всех подписок клиента (единый код для любой —
 *      никаких спецслучаев для «нулевой»). На каждой: статус, «до даты», остаток
 *      дней, кнопки «Продлить» (/cabinet/tariffs?extend=id) и «Настроить»
 *      (/cabinet/subscribe?sub=id).
 *   3. Общие действия: установка VPN, промокоды, устройства, рефералка.
 *   4. Если подписок нет — hero + большая красная Buy CTA.
 */

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import gsap from "gsap";
import { EASE_OUT, EASE_SPRING, reducedMotion } from "@/lib/gsap-utils";
import { Zap, Settings2, Smartphone, Gift, Users, ChevronRight, Shield, Calendar, Clock, Plus, Check } from "lucide-react";
import { StealthPromocodeModal } from "@/components/stealth/stealth-promocode-modal";
import { StealthDevicesModal } from "@/components/stealth/stealth-devices-modal";
import { StealthTrialsModal } from "@/components/stealth/stealth-trials-modal";
import { ExtendSubscriptionDialog } from "@/components/payment/extend-subscription-dialog";
import { useClientAuth } from "@/contexts/client-auth";
import { api } from "@/lib/api";
import { StadiumButton } from "@/components/stealth/stadium-button";
import { cn } from "@/lib/utils";
import { getPublicConfigCached } from "@/lib/public-config";

interface SubCard {
  id: string;
  type: "root" | "secondary";
  index: number;
  label: string;
  emoji: string | null;
  expiresAt: string | null;
  daysLeft: number | null;
  isActive: boolean;
  isTrial: boolean;
  /** false → у триала нет кнопок продления/конвертации вовсе. */
  trialConvertEnabled: boolean;
  /** тариф подписки — нужен для тоггла автосписания (без тарифа списывать нечего). */
  tariffId: string | null;
  autoRenewEnabled: boolean;
}

type PaySuccessKind = "topup" | "tariff" | "generic";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch { return "—"; }
}

/**
 * Развернуть Remnawave-обёртку: ответ может приходить как
 * { response: {...} }, { data: { response: {...} } }, либо плоский объект.
 * Идентичная логика используется в classic-dashboard parseSubscription.
 */
function unwrapRemnaSub(sub: unknown): Record<string, unknown> | null {
  if (!sub || typeof sub !== "object") return null;
  const raw = sub as Record<string, unknown>;
  if (raw.response && typeof raw.response === "object") return raw.response as Record<string, unknown>;
  if (raw.data && typeof raw.data === "object") {
    const d = raw.data as Record<string, unknown>;
    if (d.response && typeof d.response === "object") return d.response as Record<string, unknown>;
  }
  return raw;
}

export function StealthDashboard() {
  const { state, refreshProfile } = useClientAuth();
  const [heroImage, setHeroImage] = useState<string | null>(null);
  useEffect(() => {
    getPublicConfigCached()
      .then((c) => setHeroImage((c as { stealthHeroImage?: string | null }).stealthHeroImage || null))
      .catch(() => {});
  }, []);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [reloadKey, setReloadKey] = useState(0); // bump чтобы перезагрузить инфо после модалок
  const [showPromo, setShowPromo] = useState(false);
  const [showDevices, setShowDevices] = useState(false);
  const [showTrials, setShowTrials] = useState(false);
  const [extendSubId, setExtendSubId] = useState<string | null>(null);
  const [paySuccess, setPaySuccess] = useState<PaySuccessKind | null>(null);
  const [autoRenewBusyId, setAutoRenewBusyId] = useState<string | null>(null);
  const [autoRenewError, setAutoRenewError] = useState<{ id: string; message: string } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const subsCardRef = useRef<HTMLDivElement>(null);
  const paySuccessRef = useRef<HTMLDivElement>(null);
  const closingRef = useRef(false);

  // T-pay-success-modal: ЕДИНЫЙ детект возврата с любой платёжки (как в classic client-dashboard).
  // Бэкенд редиректит по-разному: ?payment=success, ?yookassa=success, ?heleket=success,
  // ?yoomoney_form=success, ?lava=success, ?lavatop=success, ?overpay=return.
  useEffect(() => {
    const providerSuccess =
      searchParams.get("payment") === "success" ||
      searchParams.get("yoomoney_form") === "success" ||
      searchParams.get("yookassa") === "success" ||
      searchParams.get("heleket") === "success" ||
      searchParams.get("lava") === "success" ||
      searchParams.get("lavatop") === "success" ||
      searchParams.get("overpay") === "return";
    if (!providerSuccess) return;
    const paymentKind = searchParams.get("payment_kind");
    const kind: PaySuccessKind = paymentKind === "topup" ? "topup" : paymentKind === "tariff" ? "tariff" : "generic";
    setPaySuccess(kind);
    setSearchParams({}, { replace: true });
    setReloadKey((k) => k + 1);
    if (state.token) refreshProfile().catch(() => {});
  }, [searchParams, setSearchParams, state.token, refreshProfile]);

  // ── GSAP-анимации (вместо framer-motion) ──
  // Hero: «дыхательная» пульсация glow/эхо-кольца/ядра — бесконечные yoyo-твины.
  useEffect(() => {
    const hero = heroRef.current;
    if (!hero) return;
    const ctx = gsap.context(() => {
      if (reducedMotion()) return;
      const glow = hero.querySelector<HTMLElement>("[data-hero-glow]");
      const echo = hero.querySelector<HTMLElement>("[data-hero-echo]");
      const core = hero.querySelector<HTMLElement>("[data-hero-core]");
      if (glow) {
        gsap.fromTo(glow, { opacity: 0.7, scale: 1 }, { opacity: 1, scale: 1.06, duration: 2.25, yoyo: true, repeat: -1, ease: "sine.inOut" });
      }
      if (echo) {
        gsap.fromTo(echo, { opacity: 0.5, scale: 1 }, { opacity: 0.15, scale: 1.12, duration: 2.25, yoyo: true, repeat: -1, ease: "sine.inOut" });
      }
      if (core) {
        gsap.fromTo(core, { scale: 1 }, { scale: 1.03, duration: 2.25, yoyo: true, repeat: -1, ease: "sine.inOut" });
      }
    }, hero);
    return () => ctx.revert();
  }, []);

  // Страничный reveal — один gsap.context на верхних блоках root.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || reducedMotion()) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        root.children,
        { y: 16, opacity: 0, filter: "blur(3px)" },
        { y: 0, opacity: 1, filter: "blur(0px)", duration: 0.45, ease: EASE_OUT, stagger: 0.08, overwrite: "auto", clearProps: "filter,transform" },
      );
    }, root);
    return () => ctx.revert();
  }, []);

  // Модалка «Оплата прошла»: вход (backdrop fade + spring-поп карточки и чекмарка),
  // выход — gsap.out 200ms, потом unmount (бывший AnimatePresence).
  useEffect(() => {
    const modal = paySuccessRef.current;
    if (!paySuccess || !modal) return;
    closingRef.current = false;
    const ctx = gsap.context(() => {
      const backdrop = modal.querySelector<HTMLElement>(":scope > .absolute");
      const dialog = modal.querySelector<HTMLElement>(":scope > .relative");
      const check = modal.querySelector<HTMLElement>("[data-pay-check]");
      if (reducedMotion()) return;
      if (backdrop) gsap.fromTo(backdrop, { opacity: 0 }, { opacity: 1, duration: 0.2, ease: EASE_OUT });
      if (dialog) gsap.fromTo(dialog, { opacity: 0, y: 24, scale: 0.96 }, { opacity: 1, y: 0, scale: 1, duration: 0.45, ease: EASE_SPRING });
      if (check) gsap.fromTo(check, { scale: 0, rotate: -25 }, { scale: 1, rotate: 0, duration: 0.5, delay: 0.1, ease: EASE_SPRING });
    }, modal);
    return () => ctx.revert();
  }, [paySuccess]);

  function closePaySuccess() {
    if (closingRef.current) return;
    closingRef.current = true;
    const modal = paySuccessRef.current;
    if (!modal || reducedMotion()) {
      setPaySuccess(null);
      return;
    }
    const ctx = gsap.context(() => {
      const backdrop = modal.querySelector<HTMLElement>(":scope > .absolute");
      const dialog = modal.querySelector<HTMLElement>(":scope > .relative");
      if (backdrop) gsap.to(backdrop, { opacity: 0, duration: 0.2, ease: EASE_OUT });
      if (dialog) gsap.to(dialog, { opacity: 0, y: 16, scale: 0.96, duration: 0.2, ease: EASE_OUT });
    }, modal);
    window.setTimeout(() => {
      ctx.revert();
      setPaySuccess(null);
    }, 200);
  }

  // ── Данные через TanStack Query: подписки+трансформация и счётчик триалов ──
  const subsQuery = useQuery({
    queryKey: ["stealth", "sub-cards", state.token, reloadKey],
    queryFn: async (): Promise<{ cards: SubCard[]; devices: { used: number; total: number } }> => {
      const [all, dev] = await Promise.all([
        api.clientAllSubscriptions(state.token!).catch((): { items: [] } => ({ items: [] })),
        api.getClientDevices(state.token!).catch(() => ({ total: 0 })),
      ]);
      let devicesTotal = 0;
      const cards: SubCard[] = (all.items ?? []).map((it) => {
        const s = unwrapRemnaSub(it.subscription);
        const expireAt = typeof s?.expireAt === "string" ? s.expireAt : null;
        const expDate = expireAt ? new Date(expireAt) : null;
        const validDate = expDate && !Number.isNaN(expDate.getTime()) ? expDate : null;
        const isActive = !!validDate && validDate.getTime() > Date.now();
        const daysLeft = isActive
          ? Math.max(0, Math.ceil((validDate!.getTime() - Date.now()) / 86_400_000))
          : null;
        const limit = typeof s?.hwidDeviceLimit === "number" ? s.hwidDeviceLimit
          : s?.hwidDeviceLimit != null ? Number(s.hwidDeviceLimit) : 0;
        if (Number.isFinite(limit) && limit > 0) devicesTotal += limit;
        const idx = it.subscriptionIndex ?? 0;
        return {
          id: it.id,
          type: it.type,
          index: idx,
          label: it.tariffDisplayName?.trim() || `Подписка #${idx}`,
          emoji: it.tariffMenuEmoji ?? null,
          expiresAt: expireAt,
          daysLeft,
          isActive,
          isTrial: Boolean(it.trialId),
          trialConvertEnabled: it.trialConvertEnabled ?? true,
          tariffId: it.tariffId ?? null,
          autoRenewEnabled: it.autoRenewEnabled === true,
        };
      });
      return { cards, devices: { used: dev?.total ?? 0, total: devicesTotal } };
    },
    enabled: !!state.token,
  });
  const subs = subsQuery.data?.cards ?? null;
  const devices = subsQuery.data?.devices ?? { used: 0, total: 0 };
  const loading = subsQuery.isLoading;

  const trialsQuery = useQuery({
    queryKey: ["stealth", "trials-count", state.token, reloadKey],
    queryFn: () => api.getClientAvailableTrials(state.token!),
    enabled: !!state.token,
  });
  const trialsCount = trialsQuery.data?.items.length ?? 0;

  // Карточки подписок — stagger при появлении данных (бывший per-card delay).
  useEffect(() => {
    const card = subsCardRef.current;
    if (!card) return;
    const rows = card.querySelectorAll<HTMLElement>("[data-sub-card]");
    if (!rows.length) return;
    const ctx = gsap.context(() => {
      if (reducedMotion()) {
        gsap.set(rows, { opacity: 1, y: 0 });
        return;
      }
      gsap.fromTo(
        rows,
        { y: 12, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.4, stagger: 0.07, ease: EASE_OUT, overwrite: "auto", clearProps: "transform" },
      );
    }, card);
    return () => ctx.revert();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subs?.length, reloadKey]);

  // Тоггл автосписания конкретной подписки — после успеха инвалидируем кеш подписок.
  async function toggleAutoRenew(sub: SubCard) {
    if (!state.token || autoRenewBusyId) return;
    const next = !sub.autoRenewEnabled;
    setAutoRenewBusyId(sub.id);
    setAutoRenewError(null);
    try {
      await api.clientSetSubscriptionAutoRenew(state.token, sub.type, sub.id, next);
    } catch (e) {
      setAutoRenewError({ id: sub.id, message: e instanceof Error ? e.message : "Не удалось изменить автосписание" });
    } finally {
      setAutoRenewBusyId(null);
    }
  }

  const hasAnySub = (subs?.length ?? 0) > 0;
  const hasActiveSub = (subs ?? []).some((s) => s.isActive);

  return (
    <div ref={rootRef} className="px-4 pt-2 space-y-5">
      {/* Hero — большой светящийся шар-логотип с живой пульсацией */}
      <div ref={heroRef} className="relative h-44 md:h-56 flex items-center justify-center">
        <div
          data-hero-glow
          className="absolute inset-0"
          style={{
            background: "radial-gradient(closest-side, rgb(var(--stealth-accent) / 0.22), transparent 65%)",
            filter: "blur(14px)",
          }}
        />
        {/* внешнее тающее кольцо-эхо */}
        <div
          data-hero-echo
          className="absolute h-44 w-44 md:h-56 md:w-56 rounded-full border border-saccent-500/15"
          aria-hidden="true"
        />
        <div
          data-hero-core
          className="relative h-32 w-32 md:h-40 md:w-40 rounded-full bg-gradient-to-br from-zinc-900 to-black border border-saccent-500/25 flex items-center justify-center shadow-[0_0_70px_-10px_rgb(var(--stealth-accent)_/_0.55),inset_0_0_34px_rgb(var(--stealth-accent)_/_0.12)]"
        >
          {heroImage ? (
            <img src={heroImage} alt="" className="h-16 w-16 md:h-20 md:w-20 object-contain drop-shadow-[0_0_12px_rgb(var(--stealth-accent)_/_0.6)]" />
          ) : (
            <Shield className="h-14 w-14 md:h-16 md:w-16 text-saccent-500 drop-shadow-[0_0_12px_rgb(var(--stealth-accent)_/_0.6)]" strokeWidth={1.5} />
          )}
        </div>
      </div>

      {/* Subscriptions card */}
      <div
        ref={subsCardRef}
        className="relative rounded-3xl bg-white/[0.04] border border-white/[0.08] p-5 backdrop-blur-2xl space-y-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_24px_48px_-24px_rgba(0,0,0,0.8)] before:absolute before:inset-0 before:rounded-3xl before:bg-gradient-to-b before:from-white/[0.05] before:to-transparent before:pointer-events-none"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-xl font-bold tracking-tight">
            {(subs?.length ?? 0) > 1 ? "Подписки" : "Подписка"}
          </h2>
          {!loading && !hasAnySub && (
            <span className="rounded-full bg-white/[0.04] border border-white/[0.06] px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
              Нет подписки
            </span>
          )}
        </div>

        {/* Список подписок — единый рендер для любой (включая index 0) */}
        {hasAnySub && (
          <div className="space-y-2.5">
            {(subs ?? []).map((s) => (
              <div
                key={s.id}
                data-sub-card
                className={cn(
                  "relative rounded-2xl border p-3.5 space-y-2.5 transition-all duration-300 backdrop-blur-xl",
                  s.isActive
                    ? "bg-white/[0.04] border-white/[0.09] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] hover:border-saccent-500/30 hover:shadow-[0_0_40px_-12px_rgb(var(--stealth-accent)_/_0.45),inset_0_1px_0_rgba(255,255,255,0.05)]"
                    : "bg-zinc-900/40 border-white/[0.05]",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="relative flex h-2 w-2 shrink-0">
                      {s.isActive && (
                        <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
                      )}
                    </span>
                    <span
                      className={cn(
                        "relative inline-flex h-2 w-2 rounded-full",
                        s.isActive
                          ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]"
                          : "bg-zinc-600",
                      )}
                    />
                    <span className="text-sm font-bold truncate">
                      {s.emoji ? `${s.emoji} ` : ""}{s.label}
                    </span>
                    {s.isTrial && (
                      <span className="shrink-0 rounded-md bg-saccent-500/10 border border-saccent-500/25 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-saccent-400">
                        проба
                      </span>
                    )}
                  </div>
                  {s.isActive ? (
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.04] border border-white/[0.06] px-2 py-1 text-[11px] tabular-nums shrink-0">
                      <Clock className="h-3 w-3 text-zinc-400" strokeWidth={2.2} />
                      {s.daysLeft} дн.
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-lg bg-zinc-800/80 border border-white/[0.05] px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                      истекла
                    </span>
                  )}
                </div>

                {/* flex-wrap: на узких экранах группа кнопок уезжает
                    на новую строку целиком, а не вылезает за край карточки. Кнопки
                    тянутся flex-1 (min-w-0) и переносят/обрезают подпись при нехватке места. */}
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-2">
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500 tabular-nums shrink-0">
                    <Calendar className="h-3 w-3 text-saccent-400/80" strokeWidth={2.2} />
                    до {formatDate(s.expiresAt)}
                  </span>
                  <div className="flex items-center gap-1.5 ml-auto min-w-0">
                    {/* триал: «Конвертировать» = выбор тарифа в каталоге (navigate),
                        обычная подписка: продление в диалоге без ухода со страницы. */}
                    {(!s.isTrial || s.trialConvertEnabled) && (
                      <button
                        onClick={() => {
                          if (s.isTrial) navigate(`/cabinet/tariffs?extend=${encodeURIComponent(s.id)}`);
                          else setExtendSubId(s.id);
                        }}
                        className="min-w-0 flex-1 justify-center rounded-xl bg-saccent-500/10 hover:bg-saccent-500/20 border border-saccent-500/25 hover:border-saccent-500/45 px-3 py-1.5 text-xs font-bold text-saccent-400 transition-all duration-300 hover:shadow-[0_0_20px_-6px_rgb(var(--stealth-accent)_/_0.55)] active:scale-95 inline-flex items-center gap-1.5"
                      >
                        <Zap className="h-3 w-3 shrink-0" />
                        <span className="truncate">{s.isTrial ? "Конвертировать" : "Продлить"}</span>
                      </button>
                    )}
                    <button
                      onClick={() => navigate(`/cabinet/subscribe?sub=${encodeURIComponent(s.id)}`)}
                      className="min-w-0 flex-1 justify-center rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] hover:border-white/20 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-all duration-300 active:scale-95 inline-flex items-center gap-1.5"
                    >
                      <Settings2 className="h-3 w-3 shrink-0" />
                      <span className="truncate">Настроить</span>
                    </button>
                  </div>
                </div>

                {/* Тоггл автосписания — только для НЕ-триальных подписок с тарифом. */}
                {!s.isTrial && s.tariffId && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 pt-0.5">
                      <span className="text-[11px] text-zinc-400">♻️ Автосписание</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={s.autoRenewEnabled}
                        aria-label="Автосписание"
                        disabled={autoRenewBusyId !== null}
                        onClick={() => toggleAutoRenew(s)}
                        className={cn(
                          "relative h-5 w-9 rounded-full border transition-colors shrink-0",
                          s.autoRenewEnabled
                            ? "bg-emerald-500/80 border-emerald-400/40"
                            : "bg-zinc-700/70 border-white/[0.08]",
                          autoRenewBusyId !== null && "opacity-60",
                        )}
                      >
                        <span
                          className={cn(
                            "absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-transform",
                            s.autoRenewEnabled ? "translate-x-[18px]" : "translate-x-0.5",
                          )}
                        />
                      </button>
                    </div>
                    {autoRenewError?.id === s.id && (
                      <p className="text-[10px] leading-snug text-saccent-400">{autoRenewError.message}</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Devices pill */}
        {hasAnySub && (
          <div className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.04] border border-white/[0.06] px-3 py-1.5 text-xs">
            <Smartphone className="h-3.5 w-3.5 text-zinc-400" />
            <span className="text-zinc-200">
              Устройства{" "}
              <span className="tabular-nums">
                {devices.used}{devices.total > 0 ? `/${devices.total}` : ""}
              </span>
            </span>
          </div>
        )}

        {/* Action stack */}
        <div className="space-y-2.5 pt-1">
          <StadiumButton
            variant="ghost"
            size="md"
            iconLeft={hasAnySub ? <Plus className="h-4 w-4 text-saccent-400" /> : <Zap className="h-4 w-4 text-saccent-400" />}
            onClick={() => navigate("/cabinet/tariffs")}
          >
            {hasAnySub ? "Оформить ещё подписку" : "Оформить подписку"}
          </StadiumButton>

          {trialsCount > 0 && (
            <StadiumButton
              variant="highlight"
              size="md"
              iconLeft={
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-saccent-500/15 border border-saccent-500/30">
                  <Gift className="h-3.5 w-3.5 text-saccent-400" />
                </span>
              }
              iconRight={<ChevronRight className="h-4 w-4 text-zinc-500" />}
              onClick={() => setShowTrials(true)}
            >
              <span className="flex-1 text-left">🎁 Пробный период</span>
            </StadiumButton>
          )}

          <StadiumButton
            variant="highlight"
            size="md"
            iconLeft={
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-saccent-500/15 border border-saccent-500/30">
                <Settings2 className="h-3.5 w-3.5 text-saccent-400" />
              </span>
            }
            iconRight={<ChevronRight className="h-4 w-4 text-zinc-500" />}
            onClick={() => navigate("/cabinet/subscribe")}
          >
            <span className="flex-1 text-left">Установить и настроить VPN</span>
          </StadiumButton>

          <div className="grid grid-cols-2 gap-2.5">
            <StadiumButton
              variant="ghost" size="md"
              iconLeft={<Gift className="h-4 w-4 text-zinc-400" />}
              onClick={() => setShowPromo(true)}
              className="!text-xs whitespace-nowrap !px-3"
            >
              Промокоды
            </StadiumButton>
            <StadiumButton
              variant="ghost" size="md"
              iconLeft={<Smartphone className="h-4 w-4 text-zinc-400" />}
              onClick={() => setShowDevices(true)}
              className="!text-xs whitespace-nowrap !px-3"
            >
              Мои устройства
            </StadiumButton>
          </div>

          <StadiumButton
            variant="ghost"
            size="md"
            iconLeft={<Users className="h-4 w-4 text-zinc-400" />}
            onClick={() => navigate("/cabinet/referral")}
          >
            Реферальная система
          </StadiumButton>
        </div>
      </div>

      {/* Если активных подписок нет — большая Buy CTA */}
      {!loading && !hasActiveSub && (
        <div data-buy-cta className="px-1">
          <StadiumButton
            variant="primary" size="lg"
            onClick={() => navigate("/cabinet/tariffs")}
          >
            {hasAnySub ? "Продлить подписку" : "Начать бесплатно"}
          </StadiumButton>
        </div>
      )}

      {/* Модалки */}
      <StealthPromocodeModal
        open={showPromo}
        onClose={() => setShowPromo(false)}
        onActivated={() => setReloadKey((k) => k + 1)}
      />
      <StealthDevicesModal
        open={showDevices}
        onClose={() => setShowDevices(false)}
        onChanged={() => setReloadKey((k) => k + 1)}
      />
      <StealthTrialsModal
        open={showTrials}
        onClose={() => setShowTrials(false)}
        onActivated={() => setReloadKey((k) => k + 1)}
      />

      {/* Продление без редиректа — самодостаточный диалог (срок → устройства → оплата). */}
      {extendSubId !== null && (
        <ExtendSubscriptionDialog
          subId={extendSubId}
          open
          onClose={() => setExtendSubId(null)}
          onPaidByBalance={() => setReloadKey((k) => k + 1)}
        />
      )}

      {/* Модалка «Оплата прошла» при возврате с платёжки.
          Вход — gsap (backdrop fade + карточка spring-pop); выход — gsap.out
          200ms, потом unmount (бывший AnimatePresence). */}
      {paySuccess !== null && (
        <div
          ref={paySuccessRef}
          data-pay-success
          className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center pb-24 sm:pb-0 px-4"
        >
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-md"
            onClick={closePaySuccess}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-emerald-500/20 bg-zinc-900/95 p-6 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.6),0_0_50px_-10px_rgba(52,211,153,0.35)]">
            <div className="absolute -top-16 left-1/2 -translate-x-1/2 h-40 w-40 rounded-full bg-emerald-500/25 blur-3xl pointer-events-none" />
            <div className="relative flex flex-col items-center gap-4 text-center">
              <div
                data-pay-check
                className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-green-600 shadow-xl shadow-emerald-500/40"
              >
                <Check className="h-10 w-10 text-white" strokeWidth={3} />
              </div>
              <h3 className="text-2xl font-black tracking-tight">Оплата прошла ✨</h3>
              <p className="text-sm leading-relaxed text-zinc-400 px-1">
                {paySuccess === "topup"
                  ? "Баланс пополнен — средства уже на счету."
                  : paySuccess === "tariff"
                    ? "Спасибо за покупку! Подписка активируется автоматически в течение минуты."
                    : "Спасибо за покупку! Если подписка не появилась сразу — обновите страницу через минуту."}
              </p>
              <button
                type="button"
                onClick={closePaySuccess}
                className="mt-1 w-full h-12 rounded-2xl text-base font-bold text-white bg-gradient-to-r from-emerald-500 to-green-600 hover:opacity-90 active:scale-[0.98] transition shadow-[0_8px_24px_-8px_rgba(52,211,153,0.6)]"
              >
                Отлично
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
