/**
 * AuroraTariffs — вкладка «Тарифы» третьего дизайна мини-аппа.
 *
 * Композиция (в стиле главного экрана Aurora):
 *   • заголовок страницы;
 *   • chip-переключатели категорий и тарифов (если их больше одного);
 *   • крупная градиентная карточка: выбор срока пилюлями, итоговая цена,
 *     цена за день — визуальный близнец карточки подписки на дашборде;
 *   • предупреждения о продлении/замене подписки;
 *   • кнопка «Оплатить» СРАЗУ под карточкой — она открывает нижнюю шторку
 *     с промокодом, способами оплаты и подтверждением. Раньше всё это было
 *     простынёй в конце страницы, и часть клиентов не докручивала до кнопки;
 *   • блок «Что входит».
 *
 * ВАЖНО: вся денежная логика (промокоды, превью конвертации, судьба доп.
 * устройств, семь платёжных провайдеров, оплата балансом с подтверждением)
 * перенесена из Stealth-версии без изменений — здесь отличается только
 * оформление. Правки поведения нужно вносить в обе страницы синхронно.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Wallet, Bitcoin, Check, AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { api, type PublicTariffCategory, type PublicConfig, type TariffConversionPreview } from "@/lib/api";
import { cn } from "@/lib/utils";

interface PriceOption {
  id: string;
  durationDays: number;
  price: number;
}

interface TariffLite {
  id: string;
  name: string;
  price: number;
  currency: string;
  priceOptions?: PriceOption[];
  durationDays?: number;
  trafficLimitBytes?: string | null;
  includedDevices?: number;
}

type PayMethod =
  | { kind: "platega"; id: number; label: string; icon: typeof Wallet }
  | { kind: "yookassa"; label: string; icon: typeof Wallet }
  | { kind: "yoomoney"; label: string; icon: typeof Wallet }
  | { kind: "cryptopay"; label: string; icon: typeof Bitcoin }
  | { kind: "heleket"; label: string; icon: typeof Bitcoin }
  | { kind: "rollypay"; label: string; icon: typeof Wallet }
  | { kind: "lava"; label: string; icon: typeof Wallet }
  | { kind: "balance"; label: string; icon: typeof Wallet };

function fmtPrice(n: number, currency: string) {
  const sym = currency === "rub" || currency === "RUB" ? "₽" : currency === "usd" || currency === "USD" ? "$" : currency.toUpperCase();
  return `${Math.round(n)}${sym}`;
}

// Цена за день — всегда с копейками (2 знака), в отличие от полной цены.
function fmtPricePerDay(n: number, currency: string) {
  const sym = currency === "rub" || currency === "RUB" ? "₽" : currency === "usd" || currency === "USD" ? "$" : currency.toUpperCase();
  return `${n.toFixed(2)}${sym}`;
}

/** «30 дней» с правильным окончанием. */
function pluralDays(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "день";
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return "дня";
  return "дней";
}

export function AuroraTariffs() {
  const { state, refreshProfile } = useClientAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // режим продления конкретной подписки (?extend=<subId> с дашборда).
  // Механика как в основном кабинете: каталог фильтруется до тарифа подписки,
  // оплата уходит с extendsSecondarySubId — единый код для любой подписки.
  const extendParam = searchParams.get("extend");
  const [extendTarget, setExtendTarget] = useState<{ id: string; label: string; tariffId: string | null; isTrial: boolean; convertTariffIds: string[]; trialConvertAllTariffs: boolean; extraDevices: number; extraDevicesMonthlyPrice: number } | null>(null);
  // судьба доп. устройств при продлении (true = сохранить, цена выше).
  const [extKeepExtras, setExtKeepExtras] = useState(true);

  const [categories, setCategories] = useState<PublicTariffCategory[]>([]);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [loading, setLoading] = useState(true);

  const [selectedCatId, setSelectedCatId] = useState<string | null>(null);
  const [selectedTariffId, setSelectedTariffId] = useState<string | null>(null);
  const [selectedPriceOptionId, setSelectedPriceOptionId] = useState<string | null>(null);

  const [promoInput, setPromoInput] = useState("");
  const [promoApplied, setPromoApplied] = useState<string | null>(null);
  const [promoMsg, setPromoMsg] = useState<string | null>(null);
  const [promoBusy, setPromoBusy] = useState(false);

  const [selectedMethod, setSelectedMethod] = useState<PayMethod | null>(null);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  // превью конвертации (режим «одна подписка из категории»).
  const [convPreview, setConvPreview] = useState<TariffConversionPreview | null>(null);
  // судьба доп. устройств при конвертации (true = оставить).
  const [convKeepExtras, setConvKeepExtras] = useState(true);
  // Блокирующее подтверждение балансовой покупки (мгновенное списание → замена/удаление подписок).
  const [balConfirm, setBalConfirm] = useState<{ title: string; body: string } | null>(null);
  // Шторка оплаты: промокод + способы + подтверждение. Раньше всё это лежало
  // в конце страницы, и часть клиентов просто не докручивала до кнопки.
  const [paySheet, setPaySheet] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([
      api.getPublicTariffs().catch(() => ({ items: [] as PublicTariffCategory[] })),
      api.getPublicConfig().catch(() => null),
    ]).then(([t, c]) => {
      if (!alive) return;
      const cats = (t.items ?? []).filter((cat) => cat.tariffs.length > 0);
      setCategories(cats);
      setConfig(c);
      // initial selections
      if (cats.length > 0) {
        setSelectedCatId(cats[0].id);
        const firstTariff = cats[0].tariffs[0];
        if (firstTariff) {
          setSelectedTariffId(firstTariff.id);
          const opts = (firstTariff as TariffLite).priceOptions ?? [];
          if (opts.length > 0) {
            // Default to ~30 days option if exists, else first
            const def = opts.find((o) => o.durationDays === 30) ?? opts[0];
            setSelectedPriceOptionId(def.id);
          }
        }
      }
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  // Все подписки клиента: для режима продления (?extend) и для подсказки
  // «у вас уже есть подписка с этим тарифом — продлить или купить ещё одну».
  const [mySubs, setMySubs] = useState<{ id: string; label: string; tariffId: string | null; expireAt: string | null; isTrial: boolean; trialName: string | null }[]>([]);
  // покупка заменяет триал: выбор какого (если несколько).
  const [replaceTrialChoice, setReplaceTrialChoice] = useState<string | null>(null);
  useEffect(() => {
    if (!state.token) { setExtendTarget(null); setMySubs([]); return; }
    let alive = true;
    api.clientAllSubscriptions(state.token).then((r) => {
      if (!alive) return;
      const items = r.items ?? [];
      setMySubs(items.map((it) => {
        const raw = it.subscription as Record<string, unknown> | null;
        const payload = (raw && typeof raw === "object" && raw.response && typeof raw.response === "object")
          ? (raw.response as Record<string, unknown>)
          : raw;
        return {
          id: it.id,
          label: it.tariffDisplayName?.trim() || `Подписка #${it.subscriptionIndex ?? 0}`,
          tariffId: it.tariffId ?? null,
          expireAt: payload && typeof payload.expireAt === "string" ? payload.expireAt : null,
          isTrial: Boolean(it.trialId),
          trialName: it.trialName ?? null,
        };
      }));
      if (!extendParam) { setExtendTarget(null); return; }
      const it = items.find((s) => s.id === extendParam);
      if (!it) { setExtendTarget(null); return; }
      const idx = it.subscriptionIndex ?? 0;
      setExtendTarget({
        id: it.id,
        label: it.tariffDisplayName?.trim() || `Подписка #${idx}`,
        tariffId: it.tariffId ?? null,
        isTrial: Boolean(it.trialId),
        convertTariffIds: it.convertTariffIds ?? [],
        trialConvertAllTariffs: it.trialConvertAllTariffs ?? false,
        extraDevices: it.extraDevices ?? 0,
        extraDevicesMonthlyPrice: it.extraDevicesMonthlyPrice ?? 0,
      });
      setExtKeepExtras(true);
    }).catch(() => { if (alive) { setExtendTarget(null); setMySubs([]); } });
    return () => { alive = false; };
  }, [extendParam, state.token]);

  // В режиме продления каталог сужается до тарифа подписки (как в основном
  // кабинете). Для триальной подписки добавляются тарифы из настройки триала
  // convertTariffIds — переход с пробного сквада на боевой; convertAllTariffs —
  // каталог не фильтруется вовсе. Standalone-триал (без тарифа) — только разрешённые.
  const displayCategories = useMemo(() => {
    if (!extendTarget) return categories;
    if (extendTarget.isTrial && extendTarget.trialConvertAllTariffs) return categories;
    const allowed = [
      ...(extendTarget.tariffId ? [extendTarget.tariffId] : []),
      ...(extendTarget.isTrial ? extendTarget.convertTariffIds : []),
    ];
    if (allowed.length === 0) return categories;
    const filtered = categories
      .map((c) => ({ ...c, tariffs: c.tariffs.filter((t) => allowed.includes(t.id)) }))
      .filter((c) => c.tariffs.length > 0);
    // Тариф подписки удалён из каталога — fallback на полный список.
    return filtered.length > 0 ? filtered : categories;
  }, [categories, extendTarget]);

  // Предвыбор категории/тарифа подписки при входе в режим продления.
  useEffect(() => {
    if (!extendTarget?.tariffId || categories.length === 0) return;
    const cat = categories.find((c) => c.tariffs.some((t) => t.id === extendTarget.tariffId));
    const tariff = cat?.tariffs.find((t) => t.id === extendTarget.tariffId) as TariffLite | undefined;
    if (!cat || !tariff) return;
    setSelectedCatId(cat.id);
    setSelectedTariffId(tariff.id);
    const opts = tariff.priceOptions ?? [];
    if (opts.length > 0) {
      const def = opts.find((o) => o.durationDays === 30) ?? opts[0];
      setSelectedPriceOptionId(def.id);
    }
  }, [extendTarget?.tariffId, categories]);

  const currentCat = displayCategories.find((c) => c.id === selectedCatId);
  const currentTariff = currentCat?.tariffs.find((t) => t.id === selectedTariffId) as TariffLite | undefined;
  const priceOptions: PriceOption[] = currentTariff?.priceOptions ?? [];
  const currentOption = priceOptions.find((o) => o.id === selectedPriceOptionId);
  const basePrice = currentOption?.price ?? currentTariff?.price ?? 0;
  const days = currentOption?.durationDays ?? currentTariff?.durationDays ?? 30;
  // доплата за СОХРАНЯЕМЫЕ доп. устройства при продлении
  // (цена хранится за 30 дней — масштабируем на выбранный срок).
  const extendExtrasCost = extendTarget && extKeepExtras && extendTarget.extraDevices > 0
    ? Math.round(extendTarget.extraDevicesMonthlyPrice * (Math.max(1, days) / 30))
    : 0;
  // same-tariff продление (single-режим, без ?extend): доплата за
  // сохраняемые устройства из превью — чтобы «Итого» совпадало со списанием.
  const convExtendExtrasCost = !extendTarget && convPreview?.mode === "extend" && convKeepExtras && (convPreview.extras?.extraDevices ?? 0) > 0
    ? Math.round((convPreview.extras?.extraDevicesMonthlyPrice ?? 0) * (Math.max(1, days) / 30))
    : 0;
  const totalPrice = basePrice + extendExtrasCost + convExtendExtrasCost;
  const pricePerDay = days > 0 ? totalPrice / days : 0;
  const currency = currentTariff?.currency ?? "rub";

  // Payment methods доступные сейчас
  const availableMethods: PayMethod[] = useMemo(() => {
    if (!config) return [];
    const list: PayMethod[] = [];
    (config.plategaMethods ?? []).forEach((m) => {
      list.push({ kind: "platega", id: m.id, label: m.label, icon: Wallet });
    });
    if (config.yookassaEnabled) list.push({ kind: "yookassa", label: "YooKassa", icon: Wallet });
    if (config.yoomoneyEnabled) list.push({ kind: "yoomoney", label: "YooMoney", icon: Wallet });
    if (config.cryptopayEnabled) list.push({ kind: "cryptopay", label: "Crypto Pay", icon: Bitcoin });
    if (config.heleketEnabled) list.push({ kind: "heleket", label: "Heleket", icon: Bitcoin });
    if ((config as { rollypayEnabled?: boolean }).rollypayEnabled) list.push({ kind: "rollypay", label: "RollyPay", icon: Wallet });
    if (config.lavaEnabled) list.push({ kind: "lava", label: "Lava", icon: Wallet });
    return list;
  }, [config]);

  // Auto-select first method when methods load
  useEffect(() => {
    if (!selectedMethod && availableMethods.length > 0) {
      setSelectedMethod(availableMethods[0]);
    }
  }, [availableMethods, selectedMethod]);

  // Свежий баланс: профиль мог быть не загружен/устаревшим — без этого тайл
  // «Баланс» показывал 0 и решение о доступности оплаты было неверным.
  useEffect(() => {
    refreshProfile().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Balance available?
  const balance = state.client?.balance ?? 0;
  const canPayByBalance = balance >= totalPrice && totalPrice > 0;

  // Если выбран «Баланс», а юзер переключился на тариф дороже остатка —
  // мягко возвращаем первый доступный метод, чтобы не отправлять заведомо
  // провальную оплату.
  useEffect(() => {
    if (selectedMethod?.kind === "balance" && !canPayByBalance) {
      setSelectedMethod(availableMethods[0] ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPayByBalance]);

  // Превью конвертации: если тариф из single-категории и у клиента уже есть
  // подписка этой категории — покупка обновит её, а не создаст вторую. Показываем
  // юзеру расчёт до оплаты. В режиме явного продления (?extend) превью не нужно.
  useEffect(() => {
    if (!state.token || !selectedTariffId || extendTarget) { setConvPreview(null); return; }
    let alive = true;
    setConvKeepExtras(true);
    api.clientTariffConversionPreview(state.token, {
      tariffId: selectedTariffId,
      priceOptionId: selectedPriceOptionId ?? undefined,
    })
      .then((p) => { if (alive) setConvPreview(p); })
      .catch(() => { if (alive) setConvPreview(null); });
    return () => { alive = false; };
  }, [state.token, selectedTariffId, selectedPriceOptionId, extendTarget]);

  // Пока шторка открыта — фон не скроллим (иначе в Telegram-вебвью страница
  // уезжает под шторкой и её тяжело вернуть).
  //
  // Заодно помечаем корень атрибутом: по нему в index.css прячется стеклянное
  // нижнее меню. Меню и так закрыто шторкой, но его backdrop-filter продолжает
  // считаться под нашим слоем — на мобильном WebKit два вложенных размытия при
  // каждой перерисовке (смена способа оплаты меняет рамку и тень) дают
  // стробоскоп и проваливание фона в прозрачность.
  useEffect(() => {
    if (!paySheet) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.dataset.auSheet = "1";
    return () => {
      document.body.style.overflow = prev;
      delete document.documentElement.dataset.auSheet;
    };
  }, [paySheet]);

  async function applyPromo() {
    if (!state.token || !promoInput.trim()) return;
    setPromoBusy(true);
    setPromoMsg(null);
    try {
      // clientCheckPromoCode возвращает данные промо при успехе или throws при ошибке
      await api.clientCheckPromoCode(state.token, promoInput.trim());
      setPromoApplied(promoInput.trim());
      setPromoMsg("Промокод применён");
    } catch (e) {
      setPromoApplied(null);
      setPromoMsg(e instanceof Error ? e.message : "Промокод недействителен");
    } finally {
      setPromoBusy(false);
    }
  }

  // Баланс списывает МГНОВЕННО → перед заменой/удалением подписок показываем
  // блокирующее подтверждение (как в боте). Чистое продление того же тарифа — без окна.
  async function pay() {
    if (!state.token || !selectedTariffId || !selectedPriceOptionId || !selectedMethod) return;
    if (selectedMethod.kind === "balance") {
      setPaying(true);
      setPayError(null);
      const prev = await api.clientTariffConversionPreview(state.token, {
        tariffId: selectedTariffId,
        priceOptionId: selectedPriceOptionId ?? undefined,
      }).catch(() => null);
      setPaying(false);
      const willReplace = !!(prev && prev.willConvert && (prev.mode !== "extend" || (prev.othersToRemove ?? 0) > 0));
      if (willReplace) {
        const subName = prev!.subscription?.tariffName ? `«${prev!.subscription.tariffName}»` : "текущую подписку";
        const bodyMain = prev!.mode === "replace"
          ? `Старая подписка удалится, остаток ${prev!.remainingDays ?? 0} дн. сгорит — создастся новая на выбранный тариф (${prev!.purchasedDays ?? 0} дн. с нуля). VPN-ссылка сохранится.`
          : prev!.mode === "extend"
            ? `Этот тариф у вас уже есть — он будет продлён.`
            : `Текущая подписка будет переведена на новый тариф. Остаток ${prev!.remainingDays ?? 0} дн. пересчитается в ${prev!.convertedDays ?? 0} дн. по цене нового тарифа.`;
        const othersLine = (prev!.othersToRemove ?? 0) > 0 ? `\n⚠️ Остальные ${prev!.othersToRemove} ваши подписки будут удалены — останется одна.` : "";
        setBalConfirm({
          title: prev!.mode === "extend" ? `Продление затронет ${subName}` : `Покупка заменит ${subName}`,
          body: bodyMain + othersLine,
        });
        return;
      }
    }
    await doPay();
  }

  async function doPay() {
    if (!state.token || !selectedTariffId || !selectedPriceOptionId || !selectedMethod) return;
    setPaying(true);
    setPayError(null);
    try {
      const base = {
        tariffId: selectedTariffId,
        tariffPriceOptionId: selectedPriceOptionId,
        promoCode: promoApplied ?? undefined,
        // режим продления конкретной подписки (?extend=) —
        // оплата продлевает ИМЕННО её, а не создаёт новую.
        ...(extendTarget ? { extendsSecondarySubId: extendTarget.id } : {}),
        // юзер выбрал продлить БЕЗ доп. устройств — бэк удалит их
        // после успешной оплаты и не начислит доплату.
        ...(extendTarget && extendTarget.extraDevices > 0 && !extKeepExtras
          ? { removeExtrasOnActivate: true }
          : {}),
        // same-tariff (single-режим): покупка того же тарифа = честное
        // продление через extend-флоу (единая логика доплаты/устройств).
        ...(!extendTarget && convPreview?.mode === "extend" && convPreview.subscription
          ? {
              extendsSecondarySubId: convPreview.subscription.id,
              ...(((convPreview.extras?.extraDevices ?? 0) > 0 && !convKeepExtras) ? { removeExtrasOnActivate: true } : {}),
            }
          : {}),
        // конвертация: юзер выбрал убрать доп. устройства —
        // их остаточная ценность уйдёт в дни нового тарифа.
        ...(convPreview?.willConvert && convPreview.mode !== "extend" && (convPreview.extras?.extraDevices ?? 0) > 0 && !convKeepExtras
          ? { removeExtrasOnActivate: true }
          : {}),
        // покупка заменяет активный триал (выбор при нескольких).
        ...(() => {
          if (extendTarget || convPreview?.willConvert) return {};
          const trialsOwned = mySubs.filter((s) => s.isTrial);
          return trialsOwned.length > 0
            ? { replaceTrialSubId: replaceTrialChoice ?? trialsOwned[0].id }
            : {};
        })(),
      };
      let url: string | null = null;
      if (selectedMethod.kind === "platega") {
        const r = await api.clientCreatePlategaPayment(state.token, { ...base, paymentMethod: selectedMethod.id });
        url = r.paymentUrl;
      } else if (selectedMethod.kind === "yookassa") {
        const r = await api.yookassaCreatePayment(state.token, base);
        url = r.confirmationUrl;
      } else if (selectedMethod.kind === "yoomoney") {
        const r = await api.yoomoneyCreateFormPayment(state.token, { ...base, paymentType: "AC" });
        url = r.paymentUrl;
      } else if (selectedMethod.kind === "cryptopay") {
        const r = await api.cryptopayCreatePayment(state.token, base);
        // CryptoBot mini-app preferred when in Telegram, иначе fallback
        url = r.miniAppPayUrl ?? r.webAppPayUrl ?? r.payUrl;
      } else if (selectedMethod.kind === "heleket") {
        const r = await api.heleketCreatePayment(state.token, base);
        url = r.payUrl;
      } else if (selectedMethod.kind === "rollypay") {
        const r = await api.rollypayCreatePayment(state.token, base);
        url = r.payUrl;
      } else if (selectedMethod.kind === "lava") {
        const r = await api.lavaCreatePayment(state.token, base);
        url = r.payUrl;
      } else if (selectedMethod.kind === "balance") {
        await api.clientPayByBalance(state.token, base);
        await refreshProfile();
        navigate("/cabinet/dashboard?paid=balance");
        return;
      }
      if (url) window.location.href = url;
    } catch (e) {
      setPayError(e instanceof Error ? e.message : "Ошибка создания платежа");
    } finally {
      setPaying(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="flex gap-2">
          {[88, 104, 96].map((w, i) => (
            <div key={i} className="h-9 animate-pulse rounded-full bg-[var(--au-surface)]" style={{ width: w }} />
          ))}
        </div>
        <div className="h-[210px] animate-pulse rounded-[26px] bg-[var(--au-surface)]" />
        <div className="h-[56px] animate-pulse rounded-[20px] bg-[var(--au-surface)]" />
        <div className="grid grid-cols-2 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[84px] animate-pulse rounded-[20px] bg-[var(--au-surface)]" />
          ))}
        </div>
      </div>
    );
  }

  if (categories.length === 0) {
    return (
      <div className="rounded-[26px] bg-[var(--au-surface)] p-6 text-center">
        <p className="text-[15px] font-semibold">Тарифы пока не настроены</p>
        <p className="mt-1 text-[13px] text-[var(--au-muted)]">Загляните позже — они скоро появятся.</p>
      </div>
    );
  }

  /** Мягкая карточка-уведомление: светлая заливка выбранного оттенка. */
  const noticeCls = (tone: "accent" | "amber" | "indigo") =>
    cn(
      "rounded-[22px] p-4",
      tone === "amber" && "bg-[#FFF7E8] text-[#7A4E00]",
      tone === "indigo" && "bg-[#EEF0FF] text-[#2C327A]",
      tone === "accent" && "bg-[color-mix(in_srgb,var(--au-from)_9%,#ffffff)]",
    );

  /** Кнопка выбора внутри уведомления (устройства, триалы). */
  const choiceCls = (active: boolean) =>
    cn(
      "w-full rounded-[16px] border-2 bg-white/70 p-3 text-left transition-colors",
      active ? "border-[var(--au-from)]" : "border-transparent",
    );

  return (
    <div className="space-y-3">
      <header className="px-1 pb-1">
        <h1 className="text-[26px] font-extrabold leading-tight tracking-tight">Тарифы</h1>
        <p className="mt-0.5 text-[14px] text-[var(--au-muted)]">
          {extendTarget ? "Продление подписки — выберите срок" : "Выберите срок и способ оплаты"}
        </p>
      </header>

      {/* Режим продления: бейдж с подпиской, каталог сужен до её тарифа */}
      {extendTarget && (
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className={noticeCls("accent")}
        >
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--au-from),var(--au-to))]">
              <RefreshCw className="h-4 w-4 text-white" />
            </span>
            <div className="min-w-0">
              <p className="text-[14px] font-bold">Продление подписки</p>
              <p className="truncate text-[12.5px] text-[var(--au-muted)]">{extendTarget.label}</p>
            </div>
          </div>
          {/* доп. устройства подписки: сохранить (доплата) или убрать. */}
          {extendTarget.extraDevices > 0 && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setExtKeepExtras(true)} className={choiceCls(extKeepExtras)}>
                <p className="text-[13px] font-bold">+{extendTarget.extraDevices} устройств</p>
                <p className="mt-0.5 text-[12px] text-[var(--au-muted)]">
                  сохранить (+{fmtPrice(Math.round(extendTarget.extraDevicesMonthlyPrice * (Math.max(1, days) / 30)), currency)})
                </p>
              </button>
              <button type="button" onClick={() => setExtKeepExtras(false)} className={choiceCls(!extKeepExtras)}>
                <p className="text-[13px] font-bold">Убрать</p>
                <p className="mt-0.5 text-[12px] text-[var(--au-muted)]">без доплаты, устройства отключатся</p>
              </button>
            </div>
          )}
        </motion.section>
      )}

      {/* Категории (только если больше одной) */}
      {displayCategories.length > 1 && (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" style={{ scrollbarWidth: "none" }}>
          {displayCategories.map((c) => {
            const active = c.id === selectedCatId;
            return (
              <button
                key={c.id}
                onClick={() => {
                  setSelectedCatId(c.id);
                  const firstT = c.tariffs[0];
                  if (firstT) {
                    setSelectedTariffId(firstT.id);
                    const opts = (firstT as TariffLite).priceOptions ?? [];
                    setSelectedPriceOptionId((opts.find((o) => o.durationDays === 30) ?? opts[0])?.id ?? null);
                  }
                }}
                className={cn(
                  "shrink-0 rounded-full px-4 py-2.5 text-[14px] font-semibold transition-all active:scale-95",
                  active
                    ? "bg-[linear-gradient(135deg,var(--au-from),var(--au-to))] text-white shadow-[0_8px_20px_-8px_color-mix(in_srgb,var(--au-from)_60%,transparent)]"
                    : "bg-[var(--au-surface)] text-[var(--au-muted)]",
                )}
              >
                {c.emoji ? `${c.emoji} ` : ""}{c.name}
              </button>
            );
          })}
        </div>
      )}

      {/* Тарифы внутри категории (если больше одного) */}
      {currentCat && currentCat.tariffs.length > 1 && (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" style={{ scrollbarWidth: "none" }}>
          {currentCat.tariffs.map((t) => {
            const active = t.id === selectedTariffId;
            return (
              <button
                key={t.id}
                onClick={() => {
                  setSelectedTariffId(t.id);
                  const opts = (t as TariffLite).priceOptions ?? [];
                  setSelectedPriceOptionId((opts.find((o) => o.durationDays === 30) ?? opts[0])?.id ?? null);
                }}
                className={cn(
                  "shrink-0 rounded-full border-2 px-3.5 py-2 text-[13px] font-semibold transition-all active:scale-95",
                  active
                    ? "border-[var(--au-from)] bg-white text-[var(--au-from)]"
                    : "border-transparent bg-[var(--au-surface)] text-[var(--au-muted)]",
                )}
              >
                {t.name}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Главная карточка: срок и итоговая цена ── */}
      <motion.section
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="relative overflow-hidden rounded-[26px] bg-[linear-gradient(135deg,var(--au-from),var(--au-to))] p-5 text-white"
      >
        <div className="flex items-center justify-between gap-3">
          <span className="truncate text-[15px] font-medium text-white/85">{currentTariff?.name ?? "Тариф"}</span>
          <span className="shrink-0 rounded-full bg-white/20 px-3 py-1.5 text-[13px] font-semibold">
            {days} {pluralDays(days)}
          </span>
        </div>

        {/* Ряд пилюль — только когда есть из чего выбирать: при единственном
            варианте срок уже написан в бейдже справа, дубль лишний. */}
        {priceOptions.length > 1 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {[...priceOptions].sort((a, b) => a.durationDays - b.durationDays).map((opt) => {
              const active = opt.id === selectedPriceOptionId;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSelectedPriceOptionId(opt.id)}
                  className={cn(
                    // тап — на CSS, см. пояснение у плиток способов оплаты
                    "min-w-[62px] rounded-full px-3.5 py-2 text-[13px] font-bold transition-colors active:scale-[0.94]",
                    active ? "bg-white text-[var(--au-ink)]" : "bg-white/18 text-white/90",
                  )}
                >
                  {opt.durationDays} дн.
                </button>
              );
            })}
          </div>
        )}

        <div className="mt-5 flex items-end justify-between gap-4">
          <div>
            <div className="text-[13px] text-white/75">К оплате</div>
            <motion.div
              key={totalPrice}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="text-[40px] font-extrabold leading-none tracking-tight tabular-nums"
            >
              {fmtPrice(totalPrice, currency)}
            </motion.div>
          </div>
          <div className="pb-1 text-right">
            <div className="text-[19px] font-bold tabular-nums">{fmtPricePerDay(pricePerDay, currency)}</div>
            <div className="text-[13px] text-white/75">в день</div>
          </div>
        </div>
      </motion.section>

      {/* покупка заменяет активный триал (выбор при нескольких). */}
      {!extendTarget && !convPreview?.willConvert && (() => {
        const trialsOwned = mySubs.filter((s) => s.isTrial);
        if (trialsOwned.length === 0) return null;
        const chosen = replaceTrialChoice ?? trialsOwned[0].id;
        return (
          <section className={noticeCls("amber")}>
            <p className="text-[14px] font-bold">
              {trialsOwned.length === 1 ? "Пробная подписка будет заменена этой покупкой" : "Покупка заменит один из пробных периодов"}
            </p>
            <p className="mt-1 text-[13px] leading-relaxed opacity-80">
              Триал удалится полностью (дни и трафик пробного периода не переносятся).
            </p>
            {trialsOwned.length > 1 && (
              <div className="mt-2.5 space-y-2">
                {trialsOwned.map((tr) => (
                  <button key={tr.id} type="button" onClick={() => setReplaceTrialChoice(tr.id)} className={choiceCls(chosen === tr.id)}>
                    <span className="text-[13px] font-semibold">
                      {tr.trialName ?? tr.label}
                      {tr.expireAt ? ` — до ${new Date(tr.expireAt).toLocaleDateString("ru-RU")}` : ""}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        );
      })()}

      {/* без single-режима: подписка с этим тарифом уже есть —
          предлагаем продлить её, либо продолжить покупку ещё одной. */}
      {!extendTarget && !convPreview?.willConvert && (() => {
        // среди ВСЕХ подписок с этим тарифом предлагаем «самую живую».
        // Триалы исключены: их «продление» — конвертация, покупка их заменяет.
        const matches = selectedTariffId ? mySubs.filter((s) => s.tariffId === selectedTariffId && !s.isTrial) : [];
        const dup = matches.length > 0
          ? [...matches].sort((a, b) => (b.expireAt ? Date.parse(b.expireAt) : 0) - (a.expireAt ? Date.parse(a.expireAt) : 0))[0]
          : null;
        if (!dup) return null;
        return (
          <section className={noticeCls("indigo")}>
            <p className="text-[14px] font-bold">У вас уже есть подписка с этим тарифом</p>
            <p className="mt-1 text-[13px] leading-relaxed opacity-80">
              «{dup.label}»{dup.expireAt ? ` — до ${new Date(dup.expireAt).toLocaleDateString("ru-RU")}` : ""}.
              Можно продлить её (дни сложатся) — или продолжить ниже и купить ещё одну отдельную подписку.
            </p>
            <button
              onClick={() => navigate(`/cabinet/tariffs?extend=${encodeURIComponent(dup.id)}`)}
              className="mt-3 inline-flex items-center gap-2 rounded-[16px] bg-white px-4 py-2.5 text-[13px] font-bold active:scale-95 transition-transform"
            >
              <RefreshCw className="h-4 w-4" />
              Продлить «{dup.label}»
            </button>
          </section>
        );
      })()}

      {/* Конвертация: покупка из single-категории обновляет существующую подписку */}
      {convPreview?.willConvert && convPreview.subscription && (
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className={noticeCls("accent")}
        >
          <div className="flex items-start gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--au-from),var(--au-to))]">
              <RefreshCw className="h-4 w-4 text-white" />
            </span>
            <div className="min-w-0 space-y-1.5">
              <p className="text-[14px] font-bold">
                {convPreview.mode === "extend"
                  ? "Этот тариф у вас уже есть — подписка будет продлена"
                  : convPreview.mode === "replace"
                    ? "Текущая подписка будет заменена новым тарифом"
                    : convPreview.subscription.isTrial ? "Пробная подписка станет платной" : "Подписка будет обновлена"}
              </p>
              <p className="text-[13px] leading-relaxed text-[var(--au-muted)]">
                {convPreview.mode === "extend"
                  ? `Вторая подписка не создастся — дни сложатся: остаток ${convPreview.remainingDays ?? 0} дн. + покупка ${convPreview.purchasedDays ?? 0} дн. = ${convPreview.totalDays ?? 0} дн. Устройства и серверы останутся как есть.`
                  : convPreview.mode === "replace"
                  ? `Старая подписка${convPreview.subscription.tariffName ? ` «${convPreview.subscription.tariffName}»` : ""} удалится, остаток ${convPreview.remainingDays ?? 0} дн. сгорит. Создастся новая на выбранный тариф — ${convPreview.purchasedDays ?? 0} дн. с нуля (VPN-ссылка сохранится).`
                  : <>Покупка не создаст вторую подписку — она обновит
                {convPreview.subscription.tariffName ? ` «${convPreview.subscription.tariffName}»` : " текущую"} до нового тарифа.
                {(convPreview.convertedDays ?? 0) > 0 && (convPreview.remainingDays ?? 0) > 0 && !(convPreview.extras && convPreview.extras.extraDevices > 0)
                  ? ` Остаток ${convPreview.remainingDays} дн. превратится в ${convPreview.convertedDays} дн. по цене нового тарифа.`
                  : ""}</>}
              </p>
              {(convPreview.othersToRemove ?? 0) > 0 && (
                <p className="text-[13px] font-bold text-[#B45309]">
                  Остальные {convPreview.othersToRemove} ваши подписки будут удалены — останется одна.
                </p>
              )}
              {convPreview.mode !== "extend" && (convPreview.extras?.extraDevices ?? 0) === 0 && (convPreview.totalDays ?? 0) > 0 && (
                <p className="text-[13px] font-bold text-[var(--au-from)]">Итого: {convPreview.totalDays} дн. нового тарифа</p>
              )}

              {/* same-tariff продление: устройства — сохранить (доплата) или убрать. */}
              {convPreview.mode === "extend" && convPreview.extras && convPreview.extras.extraDevices > 0 && (
                <div className="space-y-2 pt-1">
                  <p className="text-[13px] font-bold">
                    У вас докуплено +{convPreview.extras.extraDevices} доп. устройств — что с ними сделать?
                  </p>
                  <button type="button" onClick={() => setConvKeepExtras(true)} className={choiceCls(convKeepExtras)}>
                    <p className="text-[13px] font-bold">Сохранить устройства (+{fmtPrice(convPreview.extras.keep.extraCost ?? 0, currency)})</p>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--au-muted)]">
                      Всего {convPreview.extras.keep.totalDevices} устройств. Доплата за устройства добавится к «К оплате» выше.
                    </p>
                  </button>
                  <button type="button" onClick={() => setConvKeepExtras(false)} className={choiceCls(!convKeepExtras)}>
                    <p className="text-[13px] font-bold">Убрать устройства — без доплаты</p>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--au-muted)]">
                      Останется {convPreview.extras.drop.totalDevices} устройств (только из тарифа).
                    </p>
                  </button>
                </div>
              )}

              {/* выбор судьбы доп. устройств при конвертации. */}
              {convPreview.mode !== "extend" && convPreview.extras && convPreview.extras.extraDevices > 0 && (
                <div className="space-y-2 pt-1">
                  <p className="text-[13px] font-bold">
                    У вас докуплено +{convPreview.extras.extraDevices} доп. устройств — что с ними сделать?
                  </p>
                  <button type="button" onClick={() => setConvKeepExtras(true)} className={choiceCls(convKeepExtras)}>
                    <p className="text-[13px] font-bold">Оставить устройства</p>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--au-muted)]">
                      Всего {convPreview.extras.keep.totalDevices} устройств
                      ({convPreview.extras.newIncludedDevices} в тарифе + {convPreview.extras.extraDevices} доп.).
                      Конвертация остатка: +{convPreview.extras.keep.convertedDays} дн. —
                      итого {convPreview.extras.keep.totalDays} дн.
                    </p>
                  </button>
                  <button type="button" onClick={() => setConvKeepExtras(false)} className={choiceCls(!convKeepExtras)}>
                    <p className="text-[13px] font-bold">Убрать устройства — больше дней</p>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--au-muted)]">
                      Останется {convPreview.extras.drop.totalDevices} устройств (только из тарифа).
                      Стоимость устройств тоже превратится в дни: +{convPreview.extras.drop.convertedDays} дн. —
                      итого {convPreview.extras.drop.totalDays} дн.
                    </p>
                  </button>
                </div>
              )}
            </div>
          </div>
        </motion.section>
      )}

      {/* Главное действие: видно сразу, без прокрутки — оплата открывается шторкой */}
      <button
        type="button"
        onClick={() => setPaySheet(true)}
        disabled={!currentTariff || totalPrice <= 0}
        className="flex w-full items-center justify-center gap-2 rounded-[20px] bg-[linear-gradient(135deg,var(--au-from),var(--au-to))] px-5 py-4 text-[17px] font-bold text-white shadow-[0_10px_28px_-10px_color-mix(in_srgb,var(--au-from)_70%,transparent)] transition-transform active:scale-[0.99] disabled:opacity-45"
      >
        Оплатить {fmtPrice(totalPrice, currency)}
      </button>

      {/* ── Что входит ── */}
      <section className="rounded-[22px] bg-[var(--au-surface)] p-4">
        <p className="text-[13px] font-semibold text-[var(--au-muted)]">Что входит</p>
        <ul className="mt-2.5 space-y-2">
          {[
            currentTariff?.includedDevices ? `До ${currentTariff.includedDevices} устройств` : "Поддержка нескольких устройств",
            currentTariff?.trafficLimitBytes && currentTariff.trafficLimitBytes !== "0" ? "Ограниченный трафик" : "Безлимитный трафик",
            "Минимальные задержки",
          ].map((b, i) => (
            <li key={i} className="flex items-center gap-2.5 text-[14px]">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--au-from),var(--au-to))]">
                <Check className="h-3 w-3 text-white" strokeWidth={3} />
              </span>
              {b}
            </li>
          ))}
        </ul>
      </section>

      {/* Подтверждение балансовой оплаты: списание мгновенное и необратимое */}
      {balConfirm && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/45 p-4 sm:items-center"
          onClick={() => setBalConfirm(null)}
        >
          <div
            className="w-full max-w-sm space-y-4 rounded-[26px] bg-white p-5 shadow-2xl"
            style={{ marginBottom: "calc(env(safe-area-inset-bottom, 0px) + 8px)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#FFF7E8]">
                <AlertCircle className="h-5 w-5 text-[#B45309]" />
              </span>
              <div className="space-y-1.5">
                <p className="text-[15px] font-bold">{balConfirm.title}</p>
                <p className="whitespace-pre-line text-[13px] leading-relaxed text-[var(--au-muted)]">{balConfirm.body}</p>
              </div>
            </div>
            <p className="text-[13px] text-[var(--au-muted)]">
              Списать {fmtPrice(totalPrice, currency)} с баланса и продолжить?
            </p>
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => setBalConfirm(null)}
                className="flex-1 rounded-[18px] bg-[var(--au-surface)] py-3.5 text-[15px] font-bold text-[var(--au-muted)] transition-transform active:scale-95"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => { setBalConfirm(null); void doPay(); }}
                className="flex-1 rounded-[18px] bg-[linear-gradient(135deg,var(--au-from),var(--au-to))] py-3.5 text-[15px] font-bold text-white transition-transform active:scale-95"
              >
                Продолжить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Шторка оплаты ── */}
      {paySheet && (
        <div
          className="fixed inset-0 z-[55] flex items-end justify-center bg-black/45"
          onClick={() => setPaySheet(false)}
        >
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            transition={{ type: "spring", stiffness: 340, damping: 34 }}
            className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-t-[28px] bg-[var(--au-bg)] px-5 pt-3 text-[var(--au-ink)] [backface-visibility:hidden] [isolation:isolate]"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 20px)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* «ручка» шторки */}
            <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-[var(--au-surface)]" />

            <div className="flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-[17px] font-extrabold">{currentTariff?.name ?? "Тариф"}</p>
                <p className="text-[13px] text-[var(--au-muted)]">
                  {days} {pluralDays(days)} · {fmtPricePerDay(pricePerDay, currency)} в день
                </p>
              </div>
              <span className="shrink-0 text-[26px] font-extrabold tabular-nums">{fmtPrice(totalPrice, currency)}</span>
            </div>

            {/* Предупреждения дублируем в шторке: наверху страницы их могли пролистать */}
            {(convPreview?.willConvert || (!extendTarget && mySubs.some((s2) => s2.isTrial))) && (
              <p className="mt-3 rounded-[16px] bg-[#FFF7E8] px-3.5 py-2.5 text-[13px] leading-relaxed text-[#7A4E00]">
                {convPreview?.mode === "extend"
                  ? "Этот тариф у вас уже есть — подписка будет продлена, дни сложатся."
                  : convPreview?.willConvert
                    ? "Покупка обновит текущую подписку, а не создаст вторую."
                    : "Пробная подписка будет заменена этой покупкой."}
              </p>
            )}

            <div className="mt-4 space-y-3">
              {/* ── Промокод ── */}
              {/* min-w-0 на input обязателен: flex-item с дефолтным min-width:auto
                  не сжимался на узких экранах и выталкивал кнопку за край контейнера. */}
              <div className="flex items-center gap-2 rounded-[20px] bg-[var(--au-surface)] p-2">
                <input
                  value={promoInput}
                  onChange={(e) => { setPromoInput(e.target.value); setPromoMsg(null); }}
                  placeholder="Промокод"
                  // 16px обязательны: при меньшем размере iOS Safari принудительно
                  // приближает страницу, когда поле получает фокус, и вернуть
                  // масштаб обратно пользователь уже не может.
                  className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-[16px] outline-none placeholder:text-[var(--au-muted)]"
                />
                <button
                  onClick={applyPromo}
                  disabled={promoBusy || !promoInput.trim()}
                  className="shrink-0 whitespace-nowrap rounded-[15px] bg-white px-4 py-2.5 text-[13px] font-bold transition disabled:opacity-45"
                >
                  {promoBusy ? "…" : promoApplied ? <Check className="inline h-4 w-4" /> : "Применить"}
                </button>
              </div>
              {promoMsg && (
                <p className={cn("px-1 text-[13px]", promoApplied ? "text-[#0F9D58]" : "text-[#D93025]")}>{promoMsg}</p>
              )}

              {/* ── Способы оплаты ── */}
              <div className="px-1 pt-1">
                <p className="text-[13px] font-semibold text-[var(--au-muted)]">Способ оплаты</p>
              </div>
              {availableMethods.length > 0 ? (
                <div className="grid grid-cols-2 gap-3">
                  {availableMethods.map((m) => {
                    const active = selectedMethod && (
                      (selectedMethod.kind === "platega" && m.kind === "platega" && selectedMethod.id === m.id) ||
                      (selectedMethod.kind === m.kind && m.kind !== "platega" && selectedMethod.kind !== "platega")
                    );
                    const Icon = m.icon;
                    return (
                      <button
                        key={`${m.kind}-${m.kind === "platega" ? m.id : ""}`}
                        type="button"
                        onClick={() => setSelectedMethod(m)}
                        className={cn(
                          // Тап анимируем CSS-ом, а не framer-motion: JS-transform на
                          // каждом нажатии пересобирал слой и мигал на телефоне.
                          // Тень у активной плитки убрана по той же причине —
                          // анимировать её вместе с рамкой WebKit не успевает.
                          "flex flex-col items-center gap-2 rounded-[20px] border-2 px-3 py-4 transition-colors active:scale-[0.97]",
                          active
                            ? "border-[var(--au-from)] bg-white"
                            : "border-transparent bg-[var(--au-surface)]",
                        )}
                      >
                        <Icon className={cn("h-[22px] w-[22px]", active ? "text-[var(--au-from)]" : "text-[var(--au-muted)]")} />
                        <span className={cn("text-[13px] font-bold", !active && "text-[var(--au-muted)]")}>{m.label}</span>
                      </button>
                    );
                  })}
                  {/* Тайл «Баланс» виден всегда: раньше он прятался при нехватке средств,
                      и клиенты думали, что оплаты с баланса в приложении нет вовсе. */}
                  {state.client && (
                    <button
                      type="button"
                      onClick={() => canPayByBalance && setSelectedMethod({ kind: "balance", label: `Баланс (${balance.toFixed(0)}${fmtPrice(0, currency).slice(-1)})`, icon: Wallet })}
                      disabled={!canPayByBalance}
                      className={cn(
                        "flex flex-col items-center gap-1.5 rounded-[20px] border-2 px-3 py-4 transition-colors enabled:active:scale-[0.97]",
                        selectedMethod?.kind === "balance"
                          ? "border-[#0F9D58] bg-white"
                          : canPayByBalance
                            ? "border-transparent bg-[var(--au-surface)]"
                            : "cursor-not-allowed border-transparent bg-[var(--au-surface)] opacity-55",
                      )}
                    >
                      <Wallet className={cn("h-[22px] w-[22px]", selectedMethod?.kind === "balance" ? "text-[#0F9D58]" : "text-[var(--au-muted)]")} />
                      <span className={cn("text-[13px] font-bold", selectedMethod?.kind !== "balance" && "text-[var(--au-muted)]")}>Баланс</span>
                      <span className={cn("text-[12px] font-semibold tabular-nums", canPayByBalance ? "text-[#0F9D58]" : "text-[var(--au-muted)]")}>
                        {canPayByBalance ? fmtPrice(balance, currency) : `${fmtPrice(balance, currency)} — не хватает`}
                      </span>
                    </button>
                  )}
                </div>
              ) : (
                <div className="rounded-[20px] bg-[var(--au-surface)] p-4 text-center text-[13px] text-[var(--au-muted)]">
                  Способы оплаты не настроены.
                </div>
              )}

              {payError && (
                <div className="flex items-start gap-2 rounded-[20px] bg-[#FDECEA] p-4 text-[13px] text-[#8B1D13]">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{payError}</span>
                </div>
              )}

              <button
                type="button"
                onClick={pay}
                disabled={paying || !selectedMethod || !currentTariff}
                className="flex w-full items-center justify-center gap-2 rounded-[20px] bg-[linear-gradient(135deg,var(--au-from),var(--au-to))] px-5 py-4 text-[17px] font-bold text-white shadow-[0_10px_28px_-10px_color-mix(in_srgb,var(--au-from)_70%,transparent)] transition-transform active:scale-[0.99] disabled:opacity-45"
              >
                {paying && <Loader2 className="h-[18px] w-[18px] animate-spin" />}
                {paying ? "Создаём платёж…" : `Оплатить ${fmtPrice(totalPrice, currency)}`}
              </button>
            </div>
          </motion.div>
        </div>
      )}

    </div>
  );
}
