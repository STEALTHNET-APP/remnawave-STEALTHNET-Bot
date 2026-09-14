/** Aurora: categories contain complete tariff cards; each card opens the
 * existing checkout with its chosen duration. Subscription changes are
 * explained in checkout using the server conversion preview. */

import { useEffect, useMemo, useState, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Wallet, Bitcoin, Check, AlertCircle, Loader2, RefreshCw, X } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { api, type PublicTariff, type PublicTariffCategory, type PublicConfig, type TariffConversionPreview } from "@/lib/api";
import { cn } from "@/lib/utils";
import { AuroraTariffCard, auroraPrice, auroraDays, auroraTraffic, auroraDevices } from "./aurora-tariff-card";

interface PriceOption {
  id: string;
  durationDays: number;
  price: number;
}

type TariffLite = PublicTariff;

type PayMethod =
  | { kind: "platega"; id: number; label: string; icon: typeof Wallet }
  | { kind: "yookassa"; label: string; icon: typeof Wallet }
  | { kind: "yoomoney"; label: string; icon: typeof Wallet }
  | { kind: "cryptopay"; label: string; icon: typeof Bitcoin }
  | { kind: "heleket"; label: string; icon: typeof Bitcoin }
  | { kind: "rollypay"; label: string; icon: typeof Wallet }
  | { kind: "paritypay"; label: string; icon: typeof Wallet }
  | { kind: "lava"; label: string; icon: typeof Wallet }
  | { kind: "overpay"; label: string; icon: typeof Wallet }
  | { kind: "lavatop"; label: string; icon: typeof Wallet }
  | { kind: "balance"; label: string; icon: typeof Wallet };

const fmtPrice = auroraPrice;

// Цена за день — всегда с копейками (2 знака), в отличие от полной цены.
function fmtPricePerDay(n: number, currency: string) {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: currency.toUpperCase(), minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
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
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [previewRetry, setPreviewRetry] = useState(0);
  // Блокирующее подтверждение балансовой покупки (мгновенное списание → замена/удаление подписок).
  const [balConfirm, setBalConfirm] = useState<{ title: string; body: string } | null>(null);
  // Шторка оплаты: промокод + способы + подтверждение. Раньше всё это лежало
  // в конце страницы, и часть клиентов просто не докручивала до кнопки.
  const [paySheet, setPaySheet] = useState(false);
  const paySheetRef = useRef<HTMLDivElement>(null);

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

  const currentCat = displayCategories.find((c) => c.id === selectedCatId) ?? displayCategories[0];
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
  const requestedPreviewKey = `${selectedTariffId}:${selectedPriceOptionId ?? "base"}`;
  const previewReady = !!extendTarget || (previewKey === requestedPreviewKey && !previewError);

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
    if ((config as { paritypayEnabled?: boolean }).paritypayEnabled) list.push({ kind: "paritypay", label: "ParityPay", icon: Wallet });
    if (config.lavaEnabled) list.push({ kind: "lava", label: "Lava", icon: Wallet });
    if (config.lavatopEnabled) list.push({ kind: "lavatop", label: "Lava.top", icon: Wallet });
    if (config.overpayEnabled) list.push({ kind: "overpay", label: "Overpay", icon: Wallet });
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
    if (!paySheet || !state.token || !selectedTariffId || extendTarget) { setConvPreview(null); return; }
    let alive = true;
    setConvKeepExtras(true);
    setPreviewKey(null);
    setPreviewError(false);
    setConvPreview(null);
    api.clientTariffConversionPreview(state.token, {
      tariffId: selectedTariffId,
      priceOptionId: selectedPriceOptionId ?? undefined,
    })
      .then((p) => { if (alive) { setConvPreview(p); setPreviewKey(requestedPreviewKey); } })
      .catch(() => { if (alive) { setConvPreview(null); setPreviewError(true); } });
    return () => { alive = false; };
  }, [state.token, selectedTariffId, selectedPriceOptionId, extendTarget, paySheet, previewRetry, requestedPreviewKey]);

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
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    paySheetRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setPaySheet(false); }
      if (event.key !== "Tab") return;
      const nodes = Array.from(paySheetRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),a[href],[tabindex="0"]') || []);
      const first=nodes[0], last=nodes[nodes.length-1];
      if(event.shiftKey && document.activeElement===first){event.preventDefault();last?.focus();}
      if(!event.shiftKey && document.activeElement===last){event.preventDefault();first?.focus();}
    };
    document.addEventListener("keydown",onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.dataset.auSheet = "1";
    return () => {
      document.removeEventListener("keydown",onKey);
      previousFocus?.focus();
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
    if (!state.token || !selectedTariffId || !selectedMethod || !previewReady) return;
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
    if (!state.token || !selectedTariffId || !selectedMethod || !previewReady) return;
    setPaying(true);
    setPayError(null);
    try {
      const base = {
        tariffId: selectedTariffId,
        tariffPriceOptionId: selectedPriceOptionId ?? undefined,
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
      } else if (selectedMethod.kind === "paritypay") {
        const r = await api.paritypayCreatePayment(state.token, base);
        url = r.payUrl;
      } else if (selectedMethod.kind === "rollypay") {
        const r = await api.rollypayCreatePayment(state.token, base);
        url = r.payUrl;
      } else if (selectedMethod.kind === "lava") {
        const r = await api.lavaCreatePayment(state.token, base);
        url = r.payUrl;
      } else if (selectedMethod.kind === "lavatop") {
        const r = await api.lavatopCreatePayment(state.token, { ...base, amount: totalPrice, currency });
        url = r.payUrl;
      } else if (selectedMethod.kind === "overpay") {
        const r = await api.overpayCreatePayment(state.token, { ...base, amount: totalPrice, currency });
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
      (tone === "accent" || tone === "indigo") && "bg-[color-mix(in_srgb,var(--au-from)_9%,var(--au-bg))]",
    );

  /** Кнопка выбора внутри уведомления (устройства, триалы). */
  const choiceCls = (active: boolean) =>
    cn(
      "w-full rounded-[16px] border-2 bg-[var(--au-surface)] text-[var(--au-ink)] p-3 text-left transition-colors",
      active ? "border-[var(--au-from)]" : "border-transparent",
    );

  const renewalNotice = (<>
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

  </>);

  const purchaseNotices = (<>
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
              {config?.multiSubscriptionsEnabled ? "Можно продлить её или купить ещё одну отдельную подписку." : "Можно продлить текущую подписку — дни сложатся."}
            </p>
            <button
              onClick={() => { setPaySheet(false); navigate(`/cabinet/tariffs?extend=${encodeURIComponent(dup.id)}`); }}
              className="mt-3 inline-flex items-center gap-2 rounded-[16px] bg-[var(--au-surface)] text-[var(--au-ink)] px-4 py-2.5 text-[13px] font-bold active:scale-95 transition-transform"
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

  </>);

  return (
    <div className="space-y-3">
      <header className="px-1 pb-1">
        <h1 className="text-[26px] font-extrabold leading-tight tracking-tight">Тарифы</h1>
        <p className="mt-0.5 text-[14px] text-[var(--au-muted)]">
          {extendTarget ? "Продление подписки — выберите срок" : "Выберите категорию и сравните, что входит в каждый тариф"}
        </p>
      </header>

      {renewalNotice}

      <div className="au-tariff-catalog" data-tour="tariff-list">
        <nav className="au-tariff-categories" aria-label="Категории тарифов">
          {displayCategories.map((category) => <button key={category.id} type="button" aria-pressed={currentCat?.id === category.id} aria-controls="au-category-plans" onClick={() => setSelectedCatId(category.id)}>
            <span>{category.emoji ? `${category.emoji} ` : ""}{category.name}</span><small>{category.tariffs.length}</small>
          </button>)}
        </nav>
        {currentCat && <section id="au-category-plans" aria-labelledby="au-category-title" className="space-y-4 min-w-0">
          <div className="au-tariff-category-heading"><h2 id="au-category-title">{currentCat.name}</h2><span>Тарифов: {currentCat.tariffs.length}</span></div>
          <div className="au-tariff-cards">
            {currentCat.tariffs.map((tariff) => <AuroraTariffCard
              key={tariff.id}
              tariff={tariff}
              owned={mySubs.some((sub) => sub.tariffId === tariff.id && !sub.isTrial)}
              canBuy={!!state.token}
              extraMonthlyPrice={extendTarget?.tariffId === tariff.id && extKeepExtras && extendTarget.extraDevices > 0 ? extendTarget.extraDevicesMonthlyPrice : 0}
              onPeriodChange={extendTarget?.tariffId === tariff.id ? setSelectedPriceOptionId : undefined}
              onChoose={(chosen, optionId) => {
                setSelectedTariffId(chosen.id);
                setSelectedPriceOptionId(optionId ?? null);
                setConvPreview(null);
                setPreviewKey(null);
                setPreviewError(false);
                setPayError(null);
                setConvKeepExtras(true);
                setReplaceTrialChoice(null);
                setPromoInput(""); setPromoApplied(null); setPromoMsg(null);
                setPaySheet(true);
              }}
            />)}
          </div>
        </section>}
      </div>

      {/* Подтверждение балансовой оплаты: списание мгновенное и необратимое */}
      {balConfirm && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/45 p-4 sm:items-center"
          onClick={() => setBalConfirm(null)}
        >
          <div
            className="w-full max-w-sm space-y-4 rounded-[26px] bg-[var(--au-bg)] p-5 shadow-2xl"
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
            ref={paySheetRef}
            role="dialog"
            aria-modal="true"
            aria-label="Оплата тарифа"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            transition={{ type: "spring", stiffness: 340, damping: 34 }}
            className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-t-[28px] bg-[var(--au-bg)] px-5 pt-3 text-[var(--au-ink)] [backface-visibility:hidden] [isolation:isolate]"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 20px)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-end"><button type="button" aria-label="Закрыть оплату" onClick={()=>setPaySheet(false)} className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--au-surface)]"><X size={20}/></button></div>
            {/* «ручка» шторки */}
            <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-[var(--au-surface)]" />

            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div className="min-w-0">
                <p className="break-words text-[17px] font-extrabold">{currentTariff?.name ?? "Тариф"}</p>
                <p className="text-[13px] text-[var(--au-muted)]">
                  {days} {pluralDays(days)} · {fmtPricePerDay(pricePerDay, currency)} в день
                </p>
              </div>
              <span className="shrink-0 text-[26px] font-extrabold tabular-nums">{fmtPrice(totalPrice, currency)}</span>
            </div>

            {currentTariff && <dl className="au-tariff-checkout-facts">
              <div><dt>Устройства в тарифе</dt><dd>{auroraDevices(currentTariff)}</dd></div>
              <div><dt>Трафик</dt><dd>{auroraTraffic(currentTariff).value}</dd></div>
            </dl>}
            <dl className="au-tariff-checkout-breakdown">
              <div><dt>Тариф на {auroraDays(days)}</dt><dd>{fmtPrice(basePrice, currency)}</dd></div>
              {(extendExtrasCost + convExtendExtrasCost) > 0 && <div><dt>Сохранённые устройства</dt><dd>+{fmtPrice(extendExtrasCost + convExtendExtrasCost, currency)}</dd></div>}
            </dl>
            <div className="mt-4 space-y-3">
              {extendTarget ? renewalNotice : previewReady ? purchaseNotices : previewError ? <div role="alert" className="rounded-[20px] bg-[var(--au-surface)] p-4 text-[13px]">
                <p>Не удалось проверить условия покупки. Повторите проверку перед оплатой.</p>
                <button type="button" className="mt-3 min-h-11 rounded-xl bg-[var(--au-bg)] px-4 font-bold" onClick={() => setPreviewRetry((value) => value + 1)}>Повторить проверку</button>
              </div> : <p role="status" className="flex items-center gap-2 text-[13px] text-[var(--au-muted)]"><Loader2 className="h-4 w-4 animate-spin" />Проверяем условия вашей подписки…</p>}
            </div>

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
                  className="shrink-0 whitespace-nowrap rounded-[15px] bg-[var(--au-surface)] px-4 py-2.5 text-[13px] font-bold transition disabled:opacity-45"
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
                            ? "border-[var(--au-from)] bg-[var(--au-surface)]"
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
                          ? "border-[#0F9D58] bg-[var(--au-surface)]"
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
                disabled={paying || !selectedMethod || !currentTariff || !previewReady}
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
