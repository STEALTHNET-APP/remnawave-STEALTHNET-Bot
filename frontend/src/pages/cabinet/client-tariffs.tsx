import { useCallback, useEffect, useState } from "react";
import { useSearchParams, Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "framer-motion";
import { Package, Calendar, Wifi, Smartphone, CreditCard, Loader2, Gift, Tag, Check, Wallet, ChevronDown, Shield, Zap, ArrowLeft, Sparkles, RefreshCw } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { useCabinetDesign } from "@/lib/use-cabinet-design";
import { StealthTariffs } from "@/pages/cabinet/stealth/stealth-tariffs";
import { AuroraTariffs } from "@/pages/cabinet/aurora/aurora-tariffs";
import { api } from "@/lib/api";
import type { PublicTariffCategory, TariffConversionPreview } from "@/lib/api";
import { formatRuDays } from "@/lib/i18n";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/components/ui/toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from "@/components/ui/dialog";
import { useCabinetMiniapp } from "@/pages/cabinet/cabinet-layout";
import { PayNowPanel } from "@/components/payment/pay-now-panel";
import { ExtendSubscriptionDialog } from "@/components/payment/extend-subscription-dialog";
import { cn } from "@/lib/utils";

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: currency.toUpperCase() === "USD" ? "USD" : currency.toUpperCase() === "RUB" ? "RUB" : "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

// Цена за день — всегда с копейками (2 знака), в отличие от полной цены тарифа.
function formatMoneyPerDay(amount: number, currency: string) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: currency.toUpperCase() === "USD" ? "USD" : currency.toUpperCase() === "RUB" ? "RUB" : "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

type TariffPriceOption = { id: string; durationDays: number; price: number; sortOrder: number };
type DeviceDiscountTier = { minExtraDevices: number; discountPercent: number };
type TariffForPay = {
  id: string;
  name: string;
  price: number;
  currency: string;
  description?: string | null;
  durationDays?: number;
  trafficLimitBytes?: number | null;
  trafficResetMode?: string;
  deviceLimit?: number | null;
  includedDevices?: number;
  pricePerExtraDevice?: number;
  maxExtraDevices?: number;
  deviceDiscountTiers?: DeviceDiscountTier[];
  priceOptions?: TariffPriceOption[];
};

/**
 * Цена пакета доп. устройств с учётом длительности.
 * pricePerExtra указан за 30 дней (база), для других опций умножается на durationDays/30.
 * Скидка применяется ДО умножения на коэффициент.
 */
const EXTRA_DEVICE_BASE_DAYS = 30;
function applyExtrasPrice(
  pricePerExtra: number,
  extras: number,
  tiers: DeviceDiscountTier[] | undefined,
  durationDays: number = EXTRA_DEVICE_BASE_DAYS,
): { extrasTotal: number; pct: number } {
  const safe = Math.max(0, Math.floor(extras));
  if (safe === 0 || pricePerExtra <= 0) return { extrasTotal: 0, pct: 0 };
  const sorted = [...(tiers ?? [])].sort((a, b) => b.minExtraDevices - a.minExtraDevices);
  const tier = sorted.find((t) => safe >= t.minExtraDevices);
  const pct = tier?.discountPercent ?? 0;
  const safeDays = Math.max(1, durationDays);
  const monthly = pricePerExtra * safe * (100 - pct) / 100;
  return { extrasTotal: Math.round(monthly * (safeDays / EXTRA_DEVICE_BASE_DAYS) * 100) / 100, pct };
}

function hasExtras(t: TariffForPay): boolean {
  return (t.pricePerExtraDevice ?? 0) > 0 && (t.maxExtraDevices ?? 0) > 0;
}

export function ClientTariffsPage() {
  const design = useCabinetDesign();
  if (design === "stealth") return <StealthTariffs />;
  if (design === "aurora") return <AuroraTariffs />;
  return <ClassicTariffsPage />;
}

function ClassicTariffsPage() {
  const { t } = useTranslation();
  const { state, refreshProfile } = useClientAuth();
  const token = state.token;
  const client = state.client;
  const [tariffs, setTariffs] = useState<PublicTariffCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [plategaMethods, setPlategaMethods] = useState<{ id: number; label: string }[]>([]);
  const [yoomoneyEnabled, setYoomoneyEnabled] = useState(false);
  const [yookassaEnabled, setYookassaEnabled] = useState(false);
  const [cryptopayEnabled, setCryptopayEnabled] = useState(false);
  const [heleketEnabled, setHeleketEnabled] = useState(false);
  const [rollypayEnabled, setRollypayEnabled] = useState(false);
  const [lavaEnabled, setLavaEnabled] = useState(false);
  const [lavatopEnabled, setLavatopEnabled] = useState(false);
  const [overpayEnabled, setOverpayEnabled] = useState(false);
  const [paymentProviders, setPaymentProviders] = useState<{ id: string; label: string; sortOrder: number }[]>([]);
  const [trialConfig, setTrialConfig] = useState<{ trialEnabled: boolean; trialDays: number }>({ trialEnabled: false, trialDays: 0 });
  const [payModal, setPayModal] = useState<{ tariff: TariffForPay } | null>(null);
  const [payLoading, setPayLoading] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  // превью конвертации (режим «одна подписка из категории»):
  // показывается в модалке оплаты, чтобы юзер ДО оплаты понимал, что покупка
  // обновит существующую подписку, а не создаст вторую.
  const [convPreview, setConvPreview] = useState<TariffConversionPreview | null>(null);
  // судьба доп. устройств при конвертации: true = переезжают на новый
  // тариф (дней меньше), false = убираются (их остаток тоже превращается в дни).
  const [convKeepExtras, setConvKeepExtras] = useState(true);
  // без single-режима: у юзера уже есть подписка с этим тарифом —
  // предлагаем продлить её (открывает модалку продления) или купить ещё одну.
  const [extendDialogSubId, setExtendDialogSubId] = useState<string | null>(null);
  const [readyUrl, setReadyUrl] = useState<{ url: string; provider: string; paymentId?: string } | null>(null);
  const [trialLoading, setTrialLoading] = useState(false);
  const [trialError, setTrialError] = useState<string | null>(null);

  // Активная подписка пользователя (для предупреждения о сбросе трафика)
  const [activeSubInfo, setActiveSubInfo] = useState<{ hasActive: boolean; expireAt: string | null; tariffName: string | null; currentPricePerDay: number | null }>({ hasActive: false, expireAt: null, tariffName: null, currentPricePerDay: null });
  // Унифицированная модалка покупки: длительность + ДОП. устройства + скидки + total.
  const [purchaseModal, setPurchaseModal] = useState<{ tariff: TariffForPay } | null>(null);
  const [selectedPriceOptionId, setSelectedPriceOptionId] = useState<string | null>(null);
  /** Сколько ДОП. устройств клиент докупает поверх tariff.includedDevices (0..maxExtraDevices). */
  const [selectedExtraDevices, setSelectedExtraDevices] = useState<number>(0);
  // T-extend-devices (WolfVPN): при продлении — сохранить докупленные доп.устройства (цена выше)
  // или удалить (стандартная цена тарифа). false = сохранить (дефолт, как в боте). Передаётся
  // в backend как removeExtrasOnActivate (он сам пересчитает цену/уберёт устройства после оплаты).
  const [removeExtrasOnExtend, setRemoveExtrasOnExtend] = useState(false);

  // T-unify-cabinet (30.05.2026, WolfVPN): мульти-подписки как в боте.
  // Список подписок клиента — нужен для режима продления (берём tariffId подписки).
  const [userSubs, setUserSubs] = useState<{ id: string; subscriptionIndex: number; label: string; expireAt: string | null; emoji: string | null; tariffId: string | null; extraDevices: number; extraDevicesMonthlyPrice: number; isTrial: boolean; convertTariffIds: string[]; trialConvertAllTariffs: boolean; trialName: string | null }[]>([]);
  // покупка заменяет триал: выбор какого (если их несколько).
  const [replaceTrialChoice, setReplaceTrialChoice] = useState<string | null>(null);
  const [buyMode, setBuyMode] = useState<{ kind: "new" } | { kind: "extend"; subId: string; label: string }>({ kind: "new" });

  // T-unify-cabinet: ?extend=<subId> — пришли с кнопки «Продлить» конкретной подписки.
  // Как в боте (pay_tariff_ext): продлеваем ИМЕННО её и СТРОГО ТЕМ ЖЕ тарифом —
  // поэтому каталог фильтруется до тарифа подписки (см. displayTariffs ниже).
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const extendParam = searchParams.get("extend");
  const extendTarget = extendParam ? userSubs.find((s) => s.id === extendParam) ?? null : null;

  /**
   * T-unify-cabinet: доп. поля для платёжных запросов.
   *  - extend → продлить КОНКРЕТНУЮ подписку тем же тарифом (extendsSecondarySubId)
   *  - обычная покупка из каталога → ВСЕГДА новая подписка (как в боте: каталог не продлевает).
   *    asAdditional=true когда у клиента уже есть подписки (маркер «доп.»), иначе backend создаст первую.
   */
  function purchaseExtra(): { extendsSecondarySubId?: string; asAdditional?: boolean; removeExtrasOnActivate?: boolean } {
    if (buyMode.kind === "extend") return { extendsSecondarySubId: buyMode.subId, removeExtrasOnActivate: removeExtrasOnExtend };
    // same-tariff (single-режим): покупка того же тарифа = честное
    // продление через extend-флоу — там единая для всех подписок логика доплаты
    // за устройства и выбора «сохранить/убрать».
    if (convPreview?.willConvert && convPreview.mode === "extend" && convPreview.subscription) {
      return {
        extendsSecondarySubId: convPreview.subscription.id,
        ...(((convPreview.extras?.extraDevices ?? 0) > 0) ? { removeExtrasOnActivate: !convKeepExtras } : {}),
      };
    }
    const base: { asAdditional?: boolean; removeExtrasOnActivate?: boolean; replaceTrialSubId?: string } = userSubs.length > 0 ? { asAdditional: true } : {};
    // конвертация (single-категория): юзер выбрал убрать доп.
    // устройства — их остаточная ценность уйдёт в дни нового тарифа.
    if (convPreview?.willConvert && (convPreview.extras?.extraDevices ?? 0) > 0 && !convKeepExtras) {
      base.removeExtrasOnActivate = true;
    }
    // покупка заменяет триал (полностью, с удалением).
    // При нескольких триалах юзер выбирает какой; конверт-режим (willConvert)
    // сам обновляет подписку — замена не нужна.
    if (!convPreview?.willConvert) {
      const trialsOwned = userSubs.filter((s) => s.isTrial);
      if (trialsOwned.length > 0) {
        base.replaceTrialSubId = replaceTrialChoice ?? trialsOwned[0].id;
      }
    }
    return base;
  }

  // T-extend-devices (WolfVPN): доплата за СОХРАНЯЕМЫЕ доп.устройства при продлении подписки.
  // extraDevicesMonthlyPrice хранится за 30 дней → масштабируем на длительность опции.
  // Возвращает 0 если не продление / устройства удаляются / у подписки нет доп.устройств / тариф не тот.
  function extendExtraCost(tf: { id?: string; durationDays?: number; priceOptions?: TariffPriceOption[] }): number {
    if (!extendTarget || removeExtrasOnExtend || (extendTarget.extraDevices ?? 0) <= 0) return 0;
    if (extendTarget.tariffId && tf.id && extendTarget.tariffId !== tf.id) return 0;
    const opts = tf.priceOptions ?? [];
    const opt = (selectedPriceOptionId ? opts.find((o) => o.id === selectedPriceOptionId) : null) ?? opts[0];
    const days = opt?.durationDays ?? tf.durationDays ?? EXTRA_DEVICE_BASE_DAYS;
    return Math.round((extendTarget.extraDevicesMonthlyPrice ?? 0) * (Math.max(1, days) / EXTRA_DEVICE_BASE_DAYS));
  }

  // T-unify-cabinet (30.05.2026, WolfVPN): в режиме продления (?extend) показываем в каталоге
  // ТОЛЬКО тариф продлеваемой подписки — продлить можно строго тем же тарифом (как бот pay_tariff_ext).
  // для ТРИАЛЬНОЙ подписки дополнительно показываем тарифы из
  // настройки триала convertTariffIds — переход с пробного сквада на боевой.
  // триал с convertAllTariffs=true конвертируется в ЛЮБОЙ тариф — каталог не фильтруем.
  const extendAllowedTariffIds = extendTarget?.isTrial && extendTarget.trialConvertAllTariffs
    ? null
    : extendTarget?.tariffId
      ? [extendTarget.tariffId, ...(extendTarget.isTrial ? extendTarget.convertTariffIds : [])]
      : extendTarget?.isTrial && extendTarget.convertTariffIds.length > 0
        ? extendTarget.convertTariffIds
        : null;
  const displayTariffs = extendAllowedTariffIds
    ? tariffs
        .map((c) => ({ ...c, tariffs: c.tariffs.filter((tf) => extendAllowedTariffIds.includes(tf.id)) }))
        .filter((c) => c.tariffs.length > 0)
    : tariffs;

  // Промокод
  const [promoInput, setPromoInput] = useState("");
  const [promoChecking, setPromoChecking] = useState(false);
  const [promoResult, setPromoResult] = useState<{ type: string; discountPercent?: number | null; discountFixed?: number | null; name: string } | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);

  // Триал предлагаем только если у юзера ещё нет активной подписки и триал не использован.
  // Без проверки hasActive плашка висит даже после покупки тарифа.
  const showTrial = trialConfig.trialEnabled && !client?.trialUsed && !activeSubInfo.hasActive;

  const isMobileOrMiniapp = useCabinetMiniapp();
  const useCategoryCardLayout = isMobileOrMiniapp;
  const [expandedCategoryId, setExpandedCategoryId] = useState<string | null>(null);

  // Раскрываем категорию по умолчанию (мобильный аккордеон), чтобы сразу была видна
  // карточка тарифа с кнопкой оплаты. При продлении (?extend) раскрываем ИМЕННО категорию
  // продлеваемого тарифа — иначе единственная видимая категория осталась бы свёрнутой.
  useEffect(() => {
    if (!useCategoryCardLayout || tariffs.length === 0) return;
    const visible = extendTarget?.tariffId
      ? tariffs.filter((c) => c.tariffs.some((tf) => tf.id === extendTarget.tariffId))
      : tariffs;
    if (visible.length === 0) return;
    setExpandedCategoryId((prev) => (prev && visible.some((c) => c.id === prev) ? prev : visible[0].id));
  }, [useCategoryCardLayout, tariffs, extendTarget?.tariffId]);

  useEffect(() => {
    api.getPublicTariffs().then((r) => {
      setTariffs(r.items ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    api.getPublicConfig().then((c) => {
      setPlategaMethods(c.plategaMethods ?? []);
      setYoomoneyEnabled(Boolean(c.yoomoneyEnabled));
      setYookassaEnabled(Boolean(c.yookassaEnabled));
      setCryptopayEnabled(Boolean(c.cryptopayEnabled));
      setHeleketEnabled(Boolean(c.heleketEnabled));
      setRollypayEnabled(Boolean(c.rollypayEnabled));
      setLavaEnabled(Boolean(c.lavaEnabled));
      setLavatopEnabled(Boolean(c.lavatopEnabled));
      setOverpayEnabled(Boolean(c.overpayEnabled));
      setPaymentProviders(c.paymentProviders ?? []);
      setTrialConfig({ trialEnabled: !!c.trialEnabled, trialDays: c.trialDays ?? 0 });
    }).catch(() => { });
  }, []);

  // Загружаем статус подписки чтобы показать предупреждение о сбросе трафика
  useEffect(() => {
    if (!token) return;
    api.clientSubscription(token).then((res) => {
      // Remna возвращает данные в subscription.response (или subscription напрямую)
      const sub = res?.subscription as Record<string, unknown> | null;
      const payload = (sub && typeof sub === "object" && sub.response && typeof sub.response === "object")
        ? (sub.response as Record<string, unknown>)
        : (sub ?? null);
      const expireRaw = payload && typeof payload.expireAt === "string" ? payload.expireAt : null;
      let hasActive = false;
      let expireAt: string | null = null;
      if (expireRaw) {
        try {
          const d = new Date(expireRaw);
          if (!Number.isNaN(d.getTime()) && d.getTime() > Date.now()) {
            hasActive = true;
            expireAt = expireRaw;
          }
        } catch { /* ignore */ }
      }
      setActiveSubInfo({
        hasActive,
        expireAt,
        tariffName: res?.tariffDisplayName ?? null,
        currentPricePerDay: res?.currentPricePerDay ?? null,
      });
    }).catch(() => { /* not critical */ });
  }, [token]);

  // T-unify-cabinet (30.05.2026, WolfVPN): загружаем ВСЕ подписки клиента (root + secondary),
  // чтобы предложить выбор «продлить конкретную / купить новую» — точь-в-точь как в боте.
  const loadUserSubs = useCallback(() => {
    if (!token) return;
    api.clientAllSubscriptions(token).then((r) => {
      const list = (r.items ?? []).map((it) => {
        // Remna кладёт данные в subscription.response или напрямую.
        const raw = it.subscription as Record<string, unknown> | null;
        const payload = (raw && typeof raw === "object" && raw.response && typeof raw.response === "object")
          ? (raw.response as Record<string, unknown>)
          : (raw ?? null);
        const expireAt = payload && typeof payload.expireAt === "string" ? payload.expireAt : null;
        const idx = it.subscriptionIndex ?? 0;
        return {
          id: it.id,
          subscriptionIndex: idx,
          label: it.tariffDisplayName?.trim() || `Подписка #${idx}`,
          expireAt,
          emoji: it.tariffMenuEmoji ?? null,
          tariffId: it.tariffId ?? null,
          extraDevices: it.extraDevices ?? 0,
          extraDevicesMonthlyPrice: it.extraDevicesMonthlyPrice ?? 0,
          isTrial: Boolean(it.trialId),
          convertTariffIds: it.convertTariffIds ?? [],
          trialConvertAllTariffs: it.trialConvertAllTariffs ?? false,
          trialName: it.trialName ?? null,
        };
      });
      setUserSubs(list);
    }).catch(() => { /* not critical */ });
  }, [token]);

  useEffect(() => { loadUserSubs(); }, [loadUserSubs]);

  // Подгружаем превью конвертации при открытии модалки оплаты (только для
  // обычной покупки — явное продление и так работает с конкретной подпиской).
  useEffect(() => {
    if (!payModal || !token || buyMode.kind !== "new") {
      setConvPreview(null);
      return;
    }
    let alive = true;
    setConvKeepExtras(true);
    setReplaceTrialChoice(null);
    api.clientTariffConversionPreview(token, {
      tariffId: payModal.tariff.id,
      priceOptionId: selectedPriceOptionId ?? undefined,
    })
      .then((p) => { if (alive) setConvPreview(p); })
      .catch(() => { if (alive) setConvPreview(null); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payModal, token, buyMode.kind]);

  // Запрос на покупку тарифа: открываем единую модалку.
  function requestBuy(tariff: TariffForPay) {
    const opts = tariff.priceOptions ?? [];
    const defaultOpt = opts[0] ?? null;
    setSelectedPriceOptionId(defaultOpt?.id ?? null);
    setSelectedExtraDevices(0);
    setPurchaseModal({ tariff });
  }

  // Подтверждение из purchaseModal: total = priceOption.price + extras × pricePerExtra × (1 − pct/100).
  function confirmPurchase() {
    if (!purchaseModal) return;
    const baseTariff = purchaseModal.tariff;
    const opts = baseTariff.priceOptions ?? [];
    const opt = opts.find((o) => o.id === selectedPriceOptionId) ?? opts[0];
    const unitPrice = opt?.price ?? baseTariff.price;
    const optDays = opt?.durationDays ?? baseTariff.durationDays ?? 30;
    const { extrasTotal } = applyExtrasPrice(baseTariff.pricePerExtraDevice ?? 0, selectedExtraDevices, baseTariff.deviceDiscountTiers, optDays);
    // T-extend-devices: при продлении с сохранением устройств — добавляем их стоимость за период.
    const total = unitPrice + extrasTotal + extendExtraCost(baseTariff);
    const tariffWithOption: TariffForPay = {
      ...baseTariff,
      durationDays: opt?.durationDays ?? baseTariff.durationDays,
      price: total,
    };
    setSelectedPriceOptionId(opt?.id ?? null);
    setPurchaseModal(null);
    // T-unify-cabinet (30.05.2026, WolfVPN): строго как в боте.
    //  • Пришли по «Продлить» (?extend) → продление ИМЕННО этой подписки тем же тарифом.
    //  • Иначе (каталог) → ВСЕГДА новая подписка. Каталог НЕ продлевает чужие подписки.
    if (extendTarget) {
      setBuyMode({ kind: "extend", subId: extendTarget.id, label: extendTarget.label });
    } else {
      setBuyMode({ kind: "new" });
    }
    setPayModal({ tariff: tariffWithOption });
  }

  async function activateTrial() {
    if (!token) return;
    setTrialError(null);
    setTrialLoading(true);
    try {
      await api.clientActivateTrial(token);
      await refreshProfile();
    } catch (e) {
      setTrialError(e instanceof Error ? e.message : t("cabinet.tariffs.error_trial"));
    } finally {
      setTrialLoading(false);
    }
  }

  async function checkPromo() {
    if (!token || !promoInput.trim()) return;
    setPromoChecking(true);
    setPromoError(null);
    setPromoResult(null);
    try {
      const res = await api.clientCheckPromoCode(token, promoInput.trim());
      if (res.type === "DISCOUNT") {
        setPromoResult(res);
      } else {
        const activateRes = await api.clientActivatePromoCode(token, promoInput.trim());
        setPromoError(null);
        setPromoResult(null);
        setPromoInput("");
        setPayModal(null);
        toast.success("Промокод активирован 🎉", activateRes.message);
        await refreshProfile();
        return;
      }
    } catch (e) {
      setPromoError(e instanceof Error ? e.message : t("cabinet.tariffs.error_promo"));
      setPromoResult(null);
    } finally {
      setPromoChecking(false);
    }
  }

  function getDiscountedPrice(price: number): number {
    if (!promoResult) return price;
    let final = price;
    if (promoResult.discountPercent && promoResult.discountPercent > 0) {
      final -= final * promoResult.discountPercent / 100;
    }
    if (promoResult.discountFixed && promoResult.discountFixed > 0) {
      final -= promoResult.discountFixed;
    }
    return Math.max(0, Math.round(final * 100) / 100);
  }

  async function startPayment(tariff: TariffForPay, methodId: number) {
    if (!token) return;
    setPayError(null);
    setPayLoading(true);
    try {
      const res = await api.clientCreatePlategaPayment(token, {
        amount: tariff.price,
        currency: tariff.currency,
        paymentMethod: methodId,
        description: tariff.name,
        tariffId: tariff.id,
        tariffPriceOptionId: selectedPriceOptionId ?? undefined,
        deviceCount: selectedExtraDevices,
        promoCode: promoResult ? promoInput.trim() : undefined,
        ...purchaseExtra(),
      });
      if (res.paymentUrl) setReadyUrl({ url: res.paymentUrl, provider: "Platega", paymentId: res.paymentId });
    } catch (e) {
      setPayError(e instanceof Error ? e.message : t("cabinet.tariffs.error_payment"));
    } finally {
      setPayLoading(false);
    }
  }

  async function payByBalance(tariff: TariffForPay) {
    if (!token) return;
    setPayError(null);
    setPayLoading(true);
    try {
      const res = await api.clientPayByBalance(token, {
        tariffId: tariff.id,
        tariffPriceOptionId: selectedPriceOptionId ?? undefined,
        deviceCount: selectedExtraDevices,
        promoCode: promoResult ? promoInput.trim() : undefined,
        ...purchaseExtra(),
      });
      setPayModal(null);
      setPromoInput("");
      setPromoResult(null);
      setBuyMode({ kind: "new" });
      toast.success("Оплата прошла ✨", res.message);
      await refreshProfile();
      loadUserSubs(); // T-unify-cabinet: подписок стало больше — обновляем список для след. покупки
    } catch (e) {
      setPayError(e instanceof Error ? e.message : t("cabinet.tariffs.error_payment"));
    } finally {
      setPayLoading(false);
    }
  }

  async function startYoomoneyPayment(tariff: TariffForPay) {
    if (!token) return;
    if (tariff.currency.toUpperCase() !== "RUB") {
      setPayError(t("cabinet.tariffs.error_yoomoney_rub"));
      return;
    }
    setPayError(null);
    setPayLoading(true);
    try {
      const res = await api.yoomoneyCreateFormPayment(token, {
        amount: tariff.price,
        paymentType: "AC",
        tariffId: tariff.id,
        tariffPriceOptionId: selectedPriceOptionId ?? undefined,
        deviceCount: selectedExtraDevices,
        promoCode: promoResult ? promoInput.trim() : undefined,
        ...purchaseExtra(),
      });
      if (res.paymentUrl) setReadyUrl({ url: res.paymentUrl, provider: "ЮMoney", paymentId: res.paymentId });
    } catch (e) {
      setPayError(e instanceof Error ? e.message : t("cabinet.tariffs.error_payment"));
    } finally {
      setPayLoading(false);
    }
  }

  async function startYookassaPayment(tariff: TariffForPay) {
    if (!token) return;
    if (tariff.currency.toUpperCase() !== "RUB") {
      setPayError(t("cabinet.tariffs.error_yookassa_rub"));
      return;
    }
    setPayError(null);
    setPayLoading(true);
    try {
      const res = await api.yookassaCreatePayment(token, {
        amount: tariff.price,
        currency: "RUB",
        tariffId: tariff.id,
        tariffPriceOptionId: selectedPriceOptionId ?? undefined,
        deviceCount: selectedExtraDevices,
        promoCode: promoResult ? promoInput.trim() : undefined,
        ...purchaseExtra(),
      });
      if (res.confirmationUrl) setReadyUrl({ url: res.confirmationUrl, provider: "ЮKassa", paymentId: res.paymentId });
    } catch (e) {
      setPayError(e instanceof Error ? e.message : t("cabinet.tariffs.error_payment"));
    } finally {
      setPayLoading(false);
    }
  }

  async function startCryptopayPayment(tariff: TariffForPay) {
    if (!token) return;
    setPayError(null);
    setPayLoading(true);
    try {
      const res = await api.cryptopayCreatePayment(token, {
        amount: tariff.price,
        currency: tariff.currency,
        tariffId: tariff.id,
        tariffPriceOptionId: selectedPriceOptionId ?? undefined,
        deviceCount: selectedExtraDevices,
        promoCode: promoResult ? promoInput.trim() : undefined,
        ...purchaseExtra(),
      });
      if (res.payUrl) setReadyUrl({ url: res.payUrl, provider: "Crypto Bot", paymentId: res.paymentId });
    } catch (e) {
      setPayError(e instanceof Error ? e.message : t("cabinet.tariffs.error_payment"));
    } finally {
      setPayLoading(false);
    }
  }

  async function startHeleketPayment(tariff: TariffForPay) {
    if (!token) return;
    setPayError(null);
    setPayLoading(true);
    try {
      const res = await api.heleketCreatePayment(token, {
        amount: tariff.price,
        currency: tariff.currency,
        tariffId: tariff.id,
        tariffPriceOptionId: selectedPriceOptionId ?? undefined,
        deviceCount: selectedExtraDevices,
        promoCode: promoResult ? promoInput.trim() : undefined,
        ...purchaseExtra(),
      });
      if (res.payUrl) setReadyUrl({ url: res.payUrl, provider: "Heleket", paymentId: res.paymentId });
    } catch (e) {
      setPayError(e instanceof Error ? e.message : t("cabinet.tariffs.error_payment"));
    } finally {
      setPayLoading(false);
    }
  }

  async function startRollypayPayment(tariff: TariffForPay) {
    if (!token) return;
    setPayError(null);
    setPayLoading(true);
    try {
      const res = await api.rollypayCreatePayment(token, {
        amount: tariff.price,
        currency: tariff.currency,
        tariffId: tariff.id,
        tariffPriceOptionId: selectedPriceOptionId ?? undefined,
        deviceCount: selectedExtraDevices,
        promoCode: promoResult ? promoInput.trim() : undefined,
        ...purchaseExtra(),
      });
      if (res.payUrl) setReadyUrl({ url: res.payUrl, provider: "RollyPay", paymentId: res.paymentId });
    } catch (e) {
      setPayError(e instanceof Error ? e.message : t("cabinet.tariffs.error_payment"));
    } finally {
      setPayLoading(false);
    }
  }

  async function startLavaPayment(tariff: TariffForPay) {
    if (!token) return;
    setPayError(null);
    setPayLoading(true);
    try {
      const res = await api.lavaCreatePayment(token, {
        amount: tariff.price,
        currency: tariff.currency,
        tariffId: tariff.id,
        tariffPriceOptionId: selectedPriceOptionId ?? undefined,
        deviceCount: selectedExtraDevices,
        promoCode: promoResult ? promoInput.trim() : undefined,
        ...purchaseExtra(),
      });
      if (res.payUrl) setReadyUrl({ url: res.payUrl, provider: "LAVA", paymentId: res.paymentId });
    } catch (e) {
      setPayError(e instanceof Error ? e.message : t("cabinet.tariffs.error_payment"));
    } finally {
      setPayLoading(false);
    }
  }

  async function startLavatopPayment(tariff: TariffForPay) {
    if (!token) return;
    setPayError(null);
    setPayLoading(true);
    try {
      const res = await api.lavatopCreatePayment(token, {
        amount: tariff.price,
        currency: tariff.currency,
        tariffId: tariff.id,
        tariffPriceOptionId: selectedPriceOptionId ?? undefined,
        deviceCount: selectedExtraDevices,
        promoCode: promoResult ? promoInput.trim() : undefined,
        ...purchaseExtra(),
      });
      if (res.payUrl) setReadyUrl({ url: res.payUrl, provider: "Lava.top", paymentId: res.paymentId });
    } catch (e) {
      setPayError(e instanceof Error ? e.message : t("cabinet.tariffs.error_payment"));
    } finally {
      setPayLoading(false);
    }
  }

  async function startOverpayPayment(tariff: TariffForPay) {
    if (!token) return;
    setPayError(null);
    setPayLoading(true);
    try {
      const res = await api.overpayCreatePayment(token, {
        amount: tariff.price,
        currency: tariff.currency,
        tariffId: tariff.id,
        tariffPriceOptionId: selectedPriceOptionId ?? undefined,
        deviceCount: selectedExtraDevices,
        promoCode: promoResult ? promoInput.trim() : undefined,
        ...purchaseExtra(),
      });
      if (res.payUrl) setReadyUrl({ url: res.payUrl, provider: "Overpay", paymentId: res.paymentId });
    } catch (e) {
      setPayError(e instanceof Error ? e.message : t("cabinet.tariffs.error_payment"));
    } finally {
      setPayLoading(false);
    }
  }

  const closePayment = () => {
    setPayModal(null);
    setPromoInput("");
    setPromoResult(null);
    setPromoError(null);
    setPayError(null);
    setReadyUrl(null);
    // выбор заменяемого триала не должен переживать закрытие
    // модалки — иначе устаревший id уедет в следующий платёж.
    setReplaceTrialChoice(null);
  };

  // === КОНТЕНТ ОПЛАТЫ (ОБЩИЙ ДЛЯ MOBILE VIEW И DESKTOP DIALOG) ===
  const PaymentContent = () => {
    if (!payModal) return null;
    const tariff = payModal.tariff;
    const price = promoResult ? getDiscountedPrice(tariff.price) : tariff.price;
    const hasBalance = client ? client.balance >= price : false;

    if (readyUrl) {
      return (
        <PayNowPanel
          url={readyUrl.url}
          provider={readyUrl.provider}
          onBack={() => setReadyUrl(null)}
          onPaid={() => {
            const pid = readyUrl.paymentId;
            const u = readyUrl.url, prov = readyUrl.provider;
            closePayment();
            if (pid) {
              // T-pay-wait: ведём на страницу ожидания оплаты (polling статуса + анимация успеха).
              navigate(`/cabinet/payment-wait?id=${encodeURIComponent(pid)}`, { state: { url: u, provider: prov } });
            } else {
              toast.info("Ожидаем подтверждение оплаты 💳", "После успешной оплаты подписка активируется автоматически в течение минуты.");
              window.setTimeout(() => { refreshProfile(); loadUserSubs(); }, 5000);
            }
          }}
          compact={isMobileOrMiniapp}
        />
      );
    }

    return (
      <div className="space-y-6">
        {/* Карточка с инфой о тарифе */}
        <div className={cn("rounded-2xl relative overflow-hidden", isMobileOrMiniapp ? "bg-card/40 border border-white/5 p-5" : "bg-background/50 border border-border/50 p-4")}>
          <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="flex justify-between items-start gap-4 relative z-10">
            <div className="space-y-1.5">
              <p className={cn("font-medium", isMobileOrMiniapp ? "text-sm text-muted-foreground" : "text-muted-foreground")}>
                {isMobileOrMiniapp ? t("cabinet.tariffs.total") : t("cabinet.tariffs.tariff_label")}
              </p>
              {!isMobileOrMiniapp && <p className="font-bold text-foreground">{tariff.name}</p>}
              
              {isMobileOrMiniapp && (
                <div className="flex items-baseline gap-2">
                  {promoResult ? (
                    <>
                      <span className="text-3xl font-black text-primary">{formatMoney(price, tariff.currency)}</span>
                      <span className="text-lg line-through text-muted-foreground decoration-2">{formatMoney(tariff.price, tariff.currency)}</span>
                    </>
                  ) : (
                    <span className="text-3xl font-black text-primary">{formatMoney(tariff.price, tariff.currency)}</span>
                  )}
                </div>
              )}
            </div>
            
            {!isMobileOrMiniapp && (
              <div className="text-right">
                {promoResult ? (
                  <div className="flex flex-col items-end">
                    <span className="line-through text-muted-foreground/70 text-sm decoration-2">{formatMoney(tariff.price, tariff.currency)}</span>
                    <span className="font-bold text-xl text-primary">{formatMoney(price, tariff.currency)}</span>
                  </div>
                ) : (
                  <span className="font-bold text-xl text-primary">{formatMoney(tariff.price, tariff.currency)}</span>
                )}
              </div>
            )}
          </div>
          
          {isMobileOrMiniapp && (
            <div className="mt-4 pt-4 border-t border-white/5 grid grid-cols-2 gap-3 relative z-10">
              <div className="bg-background/40 rounded-2xl p-3 border border-white/5">
                <p className="text-xs text-muted-foreground font-bold uppercase tracking-wider mb-1">{t("cabinet.tariffs.duration_label")}</p>
                <div className="flex items-center gap-1.5 font-bold text-sm">
                  <Calendar className="h-4 w-4 text-primary" />
                  {tariff.durationDays} {t("cabinet.tariffs.days_short")}
                </div>
              </div>
              <div className="bg-background/40 rounded-2xl p-3 border border-white/5">
                <p className="text-xs text-muted-foreground font-bold uppercase tracking-wider mb-1">{t("cabinet.tariffs.traffic_label")}</p>
                <div className="flex items-center gap-1.5 font-bold text-sm">
                  <Wifi className="h-4 w-4 text-primary" />
                  {tariff.trafficLimitBytes != null && tariff.trafficLimitBytes > 0 ? `${(tariff.trafficLimitBytes / 1024 / 1024 / 1024).toFixed(1)} ${t("cabinet.tariffs.gb_unit")}${tariff.trafficResetMode === "monthly" || tariff.trafficResetMode === "monthly_rolling" ? t("cabinet.tariffs.per_month") : ""}` : "∞"}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* переход с триала на другой тариф: сквады/трафик заменятся. */}
        {buyMode.kind === "extend" && extendTarget?.isTrial && extendTarget.tariffId && tariff.id !== extendTarget.tariffId && (
          <div className={cn(
            "relative overflow-hidden border rounded-2xl p-4",
            "bg-violet-500/[0.06] border-violet-500/20",
          )}>
            <div className="absolute inset-0 bg-gradient-to-br from-violet-500/10 via-transparent to-fuchsia-500/5 pointer-events-none" />
            <div className="relative z-10 flex items-start gap-3">
              <div className="p-2 rounded-xl bg-violet-500/15 shrink-0">
                <RefreshCw className="h-4 w-4 text-violet-400" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold">Переход с пробного тарифа</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Пробная подписка станет платной «<b>{tariff.name}</b>»: сервера и лимит
                  трафика обновятся под новый тариф, отсчёт срока начнётся с момента оплаты.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* покупка заменяет активный триал (с удалением).
            Несколько триалов — выбор, какой заменить. */}
        {buyMode.kind === "new" && !convPreview?.willConvert && (() => {
          const trialsOwned = userSubs.filter((s) => s.isTrial);
          if (trialsOwned.length === 0) return null;
          const chosen = replaceTrialChoice ?? trialsOwned[0].id;
          return (
            <div className="relative overflow-hidden border rounded-2xl p-4 bg-amber-500/[0.07] border-amber-500/25">
              <div className="absolute inset-0 bg-gradient-to-r from-amber-500/10 to-transparent pointer-events-none" />
              <div className="relative z-10 space-y-2">
                <p className="text-sm font-bold">
                  {trialsOwned.length === 1
                    ? "Пробная подписка будет заменена этой покупкой"
                    : "Покупка заменит один из ваших пробных периодов"}
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Триал удалится полностью (дни и трафик пробного периода не переносятся) —
                  его место займёт новая подписка.
                </p>
                {trialsOwned.length > 1 && (
                  <div className="space-y-1.5 pt-0.5">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Какой триал заменить:</p>
                    {trialsOwned.map((tr) => (
                      <button
                        key={tr.id}
                        type="button"
                        onClick={() => setReplaceTrialChoice(tr.id)}
                        className={cn(
                          "w-full text-left rounded-xl border px-3 py-2 text-xs transition-all",
                          chosen === tr.id
                            ? "border-amber-500/50 bg-amber-500/10 font-bold"
                            : "border-white/10 bg-white/[0.03] hover:border-white/25",
                        )}
                      >
                        🎁 {tr.trialName ?? tr.label}
                        {tr.expireAt ? <span className="text-muted-foreground"> — до {new Date(tr.expireAt).toLocaleDateString("ru-RU")}</span> : null}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* без single-режима: подписка с этим тарифом уже есть —
            предлагаем продлить её вместо покупки второй (но не блокируем покупку). */}
        {buyMode.kind === "new" && !convPreview?.willConvert && (() => {
          // среди ВСЕХ подписок с этим тарифом предлагаем «самую живую»
          // (max expireAt) — а не первую по индексу. Триалы исключены:
          // их «продление» — это конвертация, а покупка их заменяет.
          const matches = userSubs.filter((s) => s.tariffId === tariff.id && !s.isTrial);
          const dupSub = matches.length > 0
            ? [...matches].sort((a, b) => (b.expireAt ? Date.parse(b.expireAt) : 0) - (a.expireAt ? Date.parse(a.expireAt) : 0))[0]
            : null;
          if (!dupSub) return null;
          return (
            <div className="relative overflow-hidden border rounded-2xl p-4 bg-indigo-500/[0.06] border-indigo-500/20">
              <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 via-transparent to-violet-500/5 pointer-events-none" />
              <div className="relative z-10 flex items-start gap-3">
                <div className="p-2 rounded-xl bg-indigo-500/15 shrink-0">
                  <RefreshCw className="h-4 w-4 text-indigo-400" />
                </div>
                <div className="min-w-0 space-y-2">
                  <p className="text-sm font-bold">У вас уже есть подписка с этим тарифом</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    «<b>{dupSub.label}</b>»{dupSub.expireAt ? <> — до {new Date(dupSub.expireAt).toLocaleDateString("ru-RU")}</> : null}.
                    Можно <b>продлить её</b> (дни сложатся) — или продолжить ниже и купить ещё одну отдельную подписку.
                  </p>
                  <Button
                    size="sm"
                    onClick={() => { setPayModal(null); setExtendDialogSubId(dupSub.id); }}
                    className="gap-1.5 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 text-white border-0 hover:opacity-90"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Продлить «{dupSub.label}»
                  </Button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Конвертация (режим «одна подписка из категории»): покупка обновит
            существующую подписку, а не создаст вторую. Показываем расчёт. */}
        <AnimatePresence>
          {convPreview?.willConvert && convPreview.subscription && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className={cn(
                "relative overflow-hidden border",
                isMobileOrMiniapp ? "rounded-2xl p-4 bg-violet-500/[0.08] border-violet-500/20" : "rounded-2xl p-4 bg-violet-500/[0.06] border-violet-500/20",
              )}>
                <div className="absolute inset-0 bg-gradient-to-br from-violet-500/10 via-transparent to-fuchsia-500/5 pointer-events-none" />
                <div className="relative z-10 flex items-start gap-3">
                  <div className="p-2 rounded-xl bg-violet-500/15 shrink-0">
                    <RefreshCw className="h-4 w-4 text-violet-400" />
                  </div>
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-bold">
                      {convPreview.mode === "extend"
                        ? "Этот тариф у вас уже есть — подписка будет продлена"
                        : convPreview.mode === "replace"
                          ? "Текущая подписка будет заменена новым тарифом"
                          : convPreview.subscription.isTrial
                            ? "Пробная подписка станет платной"
                            : `Подписка #${convPreview.subscription.index} будет обновлена`}
                    </p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {convPreview.mode === "extend" ? (
                        <>Вторая подписка не создастся — дни просто сложатся: остаток{" "}
                        <b>{formatRuDays(convPreview.remainingDays ?? 0)}</b> + покупка{" "}
                        <b>{formatRuDays(convPreview.purchasedDays ?? 0)}</b> ={" "}
                        <b className="text-violet-400">{formatRuDays(convPreview.totalDays ?? 0)}</b>.
                        Устройства и серверы останутся как есть.</>
                      ) : convPreview.mode === "replace" ? (
                      <>Старая подписка{convPreview.subscription.tariffName ? <> «<b>{convPreview.subscription.tariffName}</b>»</> : " (текущая)"} удалится, остаток <b>{formatRuDays(convPreview.remainingDays ?? 0)}</b> сгорит. Создастся новая на выбранный тариф — <b className="text-violet-400">{formatRuDays(convPreview.purchasedDays ?? 0)}</b> с нуля (VPN-ссылка сохранится).</>
                      ) : (
                      <>Покупка не создаст вторую подписку — она обновит
                      {convPreview.subscription.tariffName ? <> «<b>{convPreview.subscription.tariffName}</b>»</> : " текущую"}
                      {" "}до нового тарифа.
                      {(convPreview.convertedDays ?? 0) > 0 && (convPreview.remainingDays ?? 0) > 0 && !(convPreview.extras && convPreview.extras.extraDevices > 0) ? (
                        <> Остаток <b>{formatRuDays(convPreview.remainingDays ?? 0)}</b> превратится в{" "}
                        <b className="text-violet-400">{formatRuDays(convPreview.convertedDays ?? 0)}</b> по цене нового тарифа.</>
                      ) : null}</>
                      )}
                    </p>
                    {(convPreview.othersToRemove ?? 0) > 0 && (
                      <p className="text-xs font-bold text-amber-400">⚠️ Остальные {convPreview.othersToRemove} ваши подписки будут удалены — останется одна.</p>
                    )}
                    {convPreview.mode !== "extend" && (convPreview.extras?.extraDevices ?? 0) === 0 && (convPreview.totalDays ?? 0) > 0 && (
                      <p className="text-xs font-bold text-violet-400">
                        Итого: {formatRuDays(convPreview.totalDays ?? 0)} нового тарифа
                      </p>
                    )}

                    {/* same-tariff продление: выбор судьбы ПРЕЖНИХ доп. устройств.
                        учитываем и НОВЫЕ устройства, выбранные в этой
                        покупке (selectedExtraDevices) — они уже включены в tariff.price,
                        поэтому итоги и количества показываем честно с ними. */}
                    {convPreview.mode === "extend" && convPreview.extras && convPreview.extras.extraDevices > 0 && (
                      <div className="space-y-2 pt-1.5">
                        <p className="text-xs font-bold">
                          У вас докуплено +{convPreview.extras.extraDevices} доп. устройств — что с ними сделать?
                        </p>
                        {selectedExtraDevices > 0 && (
                          <p className="text-[11px] text-violet-300/90 leading-relaxed">
                            + {selectedExtraDevices} нов{selectedExtraDevices === 1 ? "ое" : "ых"} устройств{selectedExtraDevices === 1 ? "о" : ""} из этой покупки — уже в цене и добавятся в любом случае.
                          </p>
                        )}
                        <button
                          type="button"
                          onClick={() => setConvKeepExtras(true)}
                          className={cn(
                            "w-full text-left rounded-xl border p-3 transition-all",
                            convKeepExtras ? "border-violet-500/50 bg-violet-500/10" : "border-white/10 bg-white/[0.03] hover:border-white/25",
                          )}
                        >
                          <p className="text-xs font-bold flex items-center gap-1.5">
                            <Smartphone className="h-3.5 w-3.5 text-violet-400" />
                            Сохранить прежние (+{formatMoney(convPreview.extras.keep.extraCost ?? 0, tariff.currency)})
                          </p>
                          <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                            Всего будет <b>{convPreview.extras.keep.totalDevices + selectedExtraDevices} устройств</b>
                            {selectedExtraDevices > 0 && <> ({convPreview.extras.keep.totalDevices} прежних + {selectedExtraDevices} новых)</>}.
                            Доплата за прежние на новый период — итого спишется {formatMoney(tariff.price + (convPreview.extras.keep.extraCost ?? 0), tariff.currency)}.
                          </p>
                        </button>
                        <button
                          type="button"
                          onClick={() => setConvKeepExtras(false)}
                          className={cn(
                            "w-full text-left rounded-xl border p-3 transition-all",
                            !convKeepExtras ? "border-violet-500/50 bg-violet-500/10" : "border-white/10 bg-white/[0.03] hover:border-white/25",
                          )}
                        >
                          <p className="text-xs font-bold flex items-center gap-1.5">
                            <Zap className="h-3.5 w-3.5 text-violet-400" />
                            Убрать прежние — без доплаты за них
                          </p>
                          <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                            Останется <b>{convPreview.extras.drop.totalDevices + selectedExtraDevices} устройств</b>
                            {selectedExtraDevices > 0
                              ? <> ({convPreview.extras.drop.totalDevices} из тарифа + {selectedExtraDevices} новых)</>
                              : <> (только из тарифа)</>}.
                            Спишется ровно {formatMoney(tariff.price, tariff.currency)}.
                          </p>
                        </button>
                        {selectedExtraDevices > 0 && !convKeepExtras && selectedExtraDevices >= convPreview.extras.extraDevices && (
                          <p className="text-[11px] leading-relaxed rounded-lg border border-amber-500/25 bg-amber-500/10 text-amber-300/90 px-2.5 py-2">
                            ⚠️ Вы убираете {convPreview.extras.extraDevices} прежних и добавляете {selectedExtraDevices} новых — устройств меньше не станет,
                            а за новые вы платите. Если хотели просто оставить как есть — выберите «Сохранить прежние» и уберите новые устройства из покупки.
                          </p>
                        )}
                      </div>
                    )}

                    {/* выбор судьбы докупленных доп. устройств. */}
                    {convPreview.mode !== "extend" && convPreview.extras && convPreview.extras.extraDevices > 0 && (
                      <div className="space-y-2 pt-1.5">
                        <p className="text-xs font-bold">
                          У вас докуплено +{convPreview.extras.extraDevices} доп. устройств — что с ними сделать?
                        </p>
                        <button
                          type="button"
                          onClick={() => setConvKeepExtras(true)}
                          className={cn(
                            "w-full text-left rounded-xl border p-3 transition-all",
                            convKeepExtras
                              ? "border-violet-500/50 bg-violet-500/10"
                              : "border-white/10 bg-white/[0.03] hover:border-white/25",
                          )}
                        >
                          <p className="text-xs font-bold flex items-center gap-1.5">
                            <Smartphone className="h-3.5 w-3.5 text-violet-400" />
                            Оставить устройства
                          </p>
                          <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                            Всего будет <b>{convPreview.extras.keep.totalDevices + selectedExtraDevices} устройств</b>{" "}
                            ({convPreview.extras.newIncludedDevices} в тарифе + {convPreview.extras.extraDevices} доп.{selectedExtraDevices > 0 && <> + {selectedExtraDevices} новых</>}).
                            Остаток конвертируется в <b className="text-violet-400">{formatRuDays(convPreview.extras.keep.convertedDays)}</b> —
                            итого {formatRuDays(convPreview.extras.keep.totalDays)}.
                          </p>
                        </button>
                        <button
                          type="button"
                          onClick={() => setConvKeepExtras(false)}
                          className={cn(
                            "w-full text-left rounded-xl border p-3 transition-all",
                            !convKeepExtras
                              ? "border-violet-500/50 bg-violet-500/10"
                              : "border-white/10 bg-white/[0.03] hover:border-white/25",
                          )}
                        >
                          <p className="text-xs font-bold flex items-center gap-1.5">
                            <Zap className="h-3.5 w-3.5 text-violet-400" />
                            Убрать устройства — больше дней
                          </p>
                          <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                            Останется <b>{convPreview.extras.drop.totalDevices + selectedExtraDevices} устройств</b>{" "}
                            {selectedExtraDevices > 0 ? <>({convPreview.extras.drop.totalDevices} из тарифа + {selectedExtraDevices} новых)</> : <>(только из тарифа)</>}.
                            Стоимость прежних устройств превратится в дни: остаток конвертируется в{" "}
                            <b className="text-violet-400">{formatRuDays(convPreview.extras.drop.convertedDays)}</b> —
                            итого {formatRuDays(convPreview.extras.drop.totalDays)}.
                          </p>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Промокод */}
        <div className={cn("space-y-3", !isMobileOrMiniapp && "bg-background/40 border border-border/50 rounded-2xl p-4 focus-within:border-primary/50 focus-within:bg-background/60 hover:border-primary/30 transition-all duration-300 relative overflow-hidden group")}>
          {!isMobileOrMiniapp && <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />}
          <div className="flex items-center gap-2 text-sm font-bold text-foreground pl-1 relative z-10">
            {isMobileOrMiniapp ? <Tag className="h-4 w-4 text-primary" /> : <div className="p-1.5 bg-primary/10 rounded-lg"><Tag className="h-4 w-4 text-primary" /></div>}
            {t("cabinet.tariffs.promo_code")}
          </div>
          <div className="flex gap-2 relative z-10">
            <Input
              name="promo_code"
              autoComplete="off"
              inputMode="text"
              value={promoInput}
              onChange={(e) => setPromoInput(e.target.value)}
              placeholder={t("cabinet.tariffs.promo_placeholder")}
              className={cn("font-mono font-medium focus-visible:ring-primary/50", isMobileOrMiniapp ? "text-base bg-card/40 border-white/5 h-14 rounded-2xl" : "text-sm bg-background border-border/50 h-12 rounded-xl shadow-sm")}
              disabled={payLoading || promoChecking}
            />
            <Button
              variant={isMobileOrMiniapp ? "default" : "secondary"}
              onClick={checkPromo}
              disabled={!promoInput.trim() || payLoading || promoChecking}
              className={cn("shrink-0 font-bold bg-primary text-primary-foreground shadow-md transition-all hover:scale-105 active:scale-95", isMobileOrMiniapp ? "h-14 px-6 rounded-2xl text-base" : "h-12 px-5 rounded-xl text-sm border-0 hover:bg-primary/90")}
            >
              {promoChecking ? <Loader2 className="h-5 w-5 animate-spin" /> : t("cabinet.tariffs.promo_apply")}
            </Button>
          </div>
          <AnimatePresence>
            {promoResult && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden relative z-10">
                <div className={cn("flex items-center gap-2 px-4 py-3 bg-green-500/10 border border-green-500/20", isMobileOrMiniapp ? "rounded-2xl" : "rounded-lg")}>
                  <Check className={cn("text-green-500", isMobileOrMiniapp ? "h-5 w-5" : "h-4 w-4")} />
                  <span className={cn("font-bold text-green-500", isMobileOrMiniapp ? "text-sm" : "text-sm")}>
                    {promoResult.name}: -{promoResult.discountPercent ? `${promoResult.discountPercent}%` : ""}{promoResult.discountFixed ? ` ${promoResult.discountFixed}` : ""}
                  </span>
                </div>
              </motion.div>
            )}
            {promoError && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden relative z-10">
                <div className={cn("flex items-center gap-2 px-4 py-3 bg-destructive/10 border border-destructive/20", isMobileOrMiniapp ? "rounded-2xl" : "rounded-lg")}>
                  <span className={cn("font-bold text-destructive", isMobileOrMiniapp ? "text-sm" : "text-sm")}>
                    {promoError}
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Способы оплаты */}
        <div className={cn("space-y-3")}>
          <div className="flex items-center gap-2 pt-2 pb-1">
            <Wallet className={cn("text-primary", isMobileOrMiniapp ? "h-5 w-5" : "h-4 w-4")} />
            <span className={cn("font-bold", isMobileOrMiniapp ? "text-lg" : "text-sm")}>{t("cabinet.tariffs.payment_method")}</span>
          </div>

          {payError && (
            <div className={cn("p-4 bg-destructive/10 border border-destructive/20 text-destructive text-center font-bold", isMobileOrMiniapp ? "rounded-2xl text-sm" : "rounded-xl text-sm mb-4")}>
              {payError}
            </div>
          )}

          <div className="space-y-3">
            {client && (
              <Button
                size="lg"
                onClick={() => payByBalance(tariff)}
                disabled={payLoading || !hasBalance}
                className={cn("w-full shadow-lg border-0 group relative overflow-hidden", isMobileOrMiniapp ? "justify-between px-6 h-16 rounded-2xl bg-gradient-to-r from-orange-600 to-orange-500 hover:from-orange-500 hover:to-orange-400" : "gap-2 h-14 rounded-xl bg-gradient-to-r from-primary to-primary/80 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300")}
              >
                {!isMobileOrMiniapp && <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />}
                
                {isMobileOrMiniapp ? (
                  <>
                    <div className="flex items-center gap-3">
                      {payLoading ? <Loader2 className="h-6 w-6 text-white animate-spin" /> : <Wallet className="h-6 w-6 text-white" />}
                      <span className="text-base font-bold text-white">{t("cabinet.tariffs.pay_balance")}</span>
                    </div>
                    <span className="text-white/80 font-mono font-medium bg-black/20 px-2 py-1 rounded-lg">
                      {formatMoney(client.balance, tariff.currency)}
                    </span>
                  </>
                ) : (
                  <>
                    {payLoading ? <Loader2 className="h-5 w-5 animate-spin relative z-10" /> : <Wallet className="h-5 w-5 relative z-10" />}
                    <span className="text-base font-semibold relative z-10">{t("cabinet.tariffs.pay_balance")}</span>
                    <span className="opacity-90 font-medium ml-1 bg-black/10 px-2 py-0.5 rounded-md relative z-10">
                      ({formatMoney(client.balance, payModal.tariff.currency)})
                    </span>
                  </>
                )}
              </Button>
            )}

            {(() => {
              const providerLabel = (id: string, fallback: string) => paymentProviders.find((p) => p.id === id)?.label || fallback;
              const isRub = tariff.currency.toUpperCase() === "RUB";
              const btnCls = cn("w-full", isMobileOrMiniapp ? "justify-start gap-4 px-6 h-16 rounded-2xl border-white/5 bg-card/40 hover:bg-card/60" : "gap-3 hover:bg-background/80 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 rounded-xl h-14 border-border/50 group justify-center px-6 relative");

              const colorMap: Record<string, { bg10: string; bg20: string; text: string }> = {
                cryptopay: { bg10: "bg-yellow-500/10", bg20: "group-hover:bg-yellow-500/20", text: "text-yellow-500" },
                heleket: { bg10: "bg-orange-500/10", bg20: "group-hover:bg-orange-500/20", text: "text-orange-500" },
                rollypay: { bg10: "bg-sky-500/10", bg20: "group-hover:bg-sky-500/20", text: "text-sky-500" },
                yookassa: { bg10: "bg-green-500/10", bg20: "group-hover:bg-green-500/20", text: "text-green-500" },
                yoomoney: { bg10: "bg-green-500/10", bg20: "group-hover:bg-green-500/20", text: "text-green-500" },
                lava: { bg10: "bg-sky-500/10", bg20: "group-hover:bg-sky-500/20", text: "text-sky-500" },
                overpay: { bg10: "bg-indigo-500/10", bg20: "group-hover:bg-indigo-500/20", text: "text-indigo-500" },
              };

              type ProviderEntry = { id: string; enabled: boolean; onClick: () => void; label: string; icon: "crypto" | "card" };
              const providers: ProviderEntry[] = [
                { id: "cryptopay", enabled: cryptopayEnabled, onClick: () => startCryptopayPayment(tariff), label: providerLabel("cryptopay", "Crypto Bot"), icon: "crypto" },
                { id: "heleket", enabled: heleketEnabled, onClick: () => startHeleketPayment(tariff), label: providerLabel("heleket", "Heleket"), icon: "crypto" },
                { id: "rollypay", enabled: rollypayEnabled, onClick: () => startRollypayPayment(tariff), label: providerLabel("rollypay", "RollyPay"), icon: "card" },
                { id: "yookassa", enabled: yookassaEnabled && isRub, onClick: () => startYookassaPayment(tariff), label: providerLabel("yookassa", t("cabinet.tariffs.sbp_cards_ru")), icon: "card" },
                { id: "yoomoney", enabled: yoomoneyEnabled && isRub, onClick: () => startYoomoneyPayment(tariff), label: providerLabel("yoomoney", t("cabinet.tariffs.yoomoney_cards")), icon: "card" },
                { id: "lava", enabled: lavaEnabled && isRub, onClick: () => startLavaPayment(tariff), label: providerLabel("lava", "LAVA"), icon: "card" },
                { id: "lavatop", enabled: lavatopEnabled, onClick: () => startLavatopPayment(tariff), label: providerLabel("lavatop", "Lava.top"), icon: "card" },
                { id: "overpay", enabled: overpayEnabled, onClick: () => startOverpayPayment(tariff), label: providerLabel("overpay", "Overpay"), icon: "card" },
              ];

              const sortedProviders = paymentProviders.length > 0
                ? paymentProviders.map((pp) => providers.find((p) => p.id === pp.id)).filter((p): p is ProviderEntry => !!p)
                : providers;

              return (
                <>
                  {sortedProviders.filter((p) => p.enabled).map((p) => {
                    const c = colorMap[p.id] ?? colorMap.yookassa;
                    return (
                    <Button key={p.id} size="lg" variant="outline" onClick={p.onClick} disabled={payLoading} className={btnCls}>
                      {isMobileOrMiniapp ? (
                        <>
                          <div className={cn("p-2 rounded-xl", c.bg10)}>
                            {payLoading ? <Loader2 className={cn("h-6 w-6 animate-spin", c.text)} /> : p.icon === "crypto" ? <Zap className={cn("h-6 w-6", c.text)} /> : <CreditCard className={cn("h-6 w-6", c.text)} />}
                          </div>
                          <span className="text-base font-bold">{p.label}</span>
                        </>
                      ) : (
                        <>
                          <div className={cn("absolute left-6 p-1.5 rounded-lg transition-colors", c.bg10, c.bg20)}>
                            {payLoading ? <Loader2 className={cn("h-5 w-5 animate-spin", c.text)} /> : p.icon === "crypto" ? <Zap className={cn("h-5 w-5", c.text)} /> : <CreditCard className={cn("h-5 w-5", c.text)} />}
                          </div>
                          <span className="text-base font-medium">{p.label}</span>
                        </>
                      )}
                    </Button>
                    );
                  })}
                  {plategaMethods.map((m) => (
                    <Button key={m.id} size="lg" variant="outline" onClick={() => startPayment(tariff, m.id)} disabled={payLoading} className={btnCls}>
                      {isMobileOrMiniapp ? (
                        <>
                          <div className="p-2 rounded-xl bg-green-500/10">
                            {payLoading ? <Loader2 className="h-6 w-6 animate-spin text-green-500" /> : <CreditCard className="h-6 w-6 text-green-500" />}
                          </div>
                          <span className="text-base font-bold">{m.label}</span>
                        </>
                      ) : (
                        <>
                          <div className="absolute left-6 p-1.5 rounded-lg bg-green-500/10 group-hover:bg-green-500/20 transition-colors">
                            {payLoading ? <Loader2 className="h-5 w-5 animate-spin text-green-500" /> : <CreditCard className="h-5 w-5 text-green-500" />}
                          </div>
                          <span className="text-base font-medium">{m.label}</span>
                        </>
                      )}
                    </Button>
                  ))}
                </>
              );
            })()}
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      <AnimatePresence mode="wait">
        {/* MOBILE VIEW */}
        {isMobileOrMiniapp && payModal ? (
          <motion.div
            key="payment-view"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col w-full rounded-[2.5rem] border border-white/10 dark:border-white/5 bg-slate-50/60 dark:bg-slate-950/60 backdrop-blur-[32px] shadow-2xl relative"
          >
            <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-border/50 bg-background/30 backdrop-blur-md z-10 transition-colors rounded-t-[2.5rem]">
              <div className="flex items-center gap-3 min-w-0">
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="shrink-0 h-9 w-9 rounded-full bg-background/50 hover:bg-background/80 transition-transform hover:scale-105" 
                  onClick={closePayment}
                >
                  <ArrowLeft className="h-5 w-5" />
                </Button>
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm sm:text-base font-bold truncate text-foreground">{t("cabinet.tariffs.payment_title")}</h2>
                  <p className="text-[11px] font-medium text-muted-foreground truncate">{payModal.tariff.name}</p>
                </div>
              </div>
            </div>

            <div className="p-4 sm:p-6 pb-8">
               {PaymentContent()}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="tariffs-list"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.2 }}
            className="space-y-8 max-w-6xl mx-auto"
          >
            <div className="flex flex-col gap-2">
              <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-foreground">{t("cabinet.tariffs.title")}</h1>
              <p className="text-muted-foreground text-[15px] font-medium max-w-2xl">
                {t("cabinet.tariffs.subtitle")}
              </p>
            </div>

            {/* T-unify-cabinet (30.05.2026, WolfVPN): контекст продления (пришли с кнопки «Продлить» из дашборда) */}
            {extendTarget && (
              <Card className="rounded-3xl border border-primary/30 bg-primary/5 backdrop-blur-xl shadow-lg">
                <CardContent className="flex flex-col gap-4 pt-6">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/20 text-primary shadow-inner shrink-0">
                        <RefreshCw className="h-6 w-6" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold text-lg text-foreground truncate">
                          Продление: Подписка #{extendTarget.subscriptionIndex}
                        </p>
                        <p className="text-sm text-muted-foreground font-medium">
                          Выбранный тариф продлит именно эту подписку{extendTarget.label ? ` · ${extendTarget.label}` : ""}. Трафик сохранится.
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      className="w-full sm:w-auto rounded-xl shrink-0 gap-2"
                      onClick={() => { const p = new URLSearchParams(searchParams); p.delete("extend"); setSearchParams(p, { replace: true }); }}
                    >
                      Отменить продление
                    </Button>
                  </div>
                  {extendTarget.extraDevices > 0 && (
                    <div className="space-y-2 border-t border-primary/20 pt-3">
                      <p className="text-xs font-medium text-muted-foreground">
                        На подписке докуплено доп. устройств: <span className="font-bold text-foreground">{extendTarget.extraDevices}</span>. Что делаем при продлении?
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setRemoveExtrasOnExtend(false)}
                          className={`rounded-xl border px-3 py-2.5 text-left transition-all ${!removeExtrasOnExtend ? "border-primary bg-primary/10 ring-1 ring-primary/30" : "border-border/50 hover:bg-muted/30"}`}
                        >
                          <p className="text-sm font-semibold text-foreground">✓ Сохранить устройства</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">Цена выше — с учётом {extendTarget.extraDevices} доп. устройств</p>
                        </button>
                        <button
                          type="button"
                          onClick={() => setRemoveExtrasOnExtend(true)}
                          className={`rounded-xl border px-3 py-2.5 text-left transition-all ${removeExtrasOnExtend ? "border-primary bg-primary/10 ring-1 ring-primary/30" : "border-border/50 hover:bg-muted/30"}`}
                        >
                          <p className="text-sm font-semibold text-foreground">Удалить устройства</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">Стандартная цена тарифа</p>
                        </button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {showTrial && (
              <Card className="rounded-3xl border border-green-500/30 bg-green-500/5 backdrop-blur-xl shadow-lg hover:shadow-xl transition-all duration-300">
                <CardContent className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pt-6">
                  <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-green-500/20 text-green-500 shadow-inner shrink-0">
                      <Gift className="h-6 w-6" />
                    </div>
                    <div>
                      <p className="font-bold text-lg text-foreground">{t("cabinet.tariffs.free_trial")}</p>
                      <p className="text-sm text-muted-foreground font-medium">
                        {trialConfig.trialDays > 0
                          ? `${formatRuDays(trialConfig.trialDays)} ${t("cabinet.tariffs.free_access")}`
                          : t("cabinet.tariffs.free_access_0")}
                      </p>
                    </div>
                  </div>
                  <Button
                    className="w-full sm:w-auto bg-green-600 hover:bg-green-700 text-white shadow-lg h-12 rounded-xl text-md hover:scale-[1.02] transition-transform duration-300 shrink-0 gap-2"
                    onClick={activateTrial}
                    disabled={trialLoading}
                  >
                    {trialLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Gift className="h-5 w-5" />}
                    {t("cabinet.tariffs.free_trial")}
                  </Button>
                </CardContent>
                {trialError && <p className="text-sm text-destructive px-6 pb-4 font-medium">{trialError}</p>}
              </Card>
            )}

            <div data-tour="tariff-list">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary/50" />
              </div>
            ) : displayTariffs.length === 0 ? (
              <Card className="rounded-3xl border border-border/50 bg-card/40 backdrop-blur-xl shadow-sm">
                <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-4">
                  <Package className="h-12 w-12 opacity-20" />
                  <p className="text-base font-medium text-center">{t("cabinet.tariffs.empty")}</p>
                </CardContent>
              </Card>
            ) : useCategoryCardLayout ? (
              <div className="space-y-1">
                {displayTariffs.map((cat, catIndex) => (
                  <Collapsible
                    key={cat.id}
                    // При продлении (?extend) видимая категория единственная — раскрываем её
                    // принудительно, без зависимости от тайминга загрузки userSubs/tariffs.
                    open={displayTariffs.length === 1 || expandedCategoryId === cat.id}
                    onOpenChange={(open) => setExpandedCategoryId(open ? cat.id : null)}
                  >
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.25, delay: catIndex * 0.03 }}
                      className="rounded-3xl border border-border/50 bg-card/40 backdrop-blur-xl shadow-lg overflow-hidden transition-all duration-300"
                    >
                      <CollapsibleTrigger asChild>
                        <button
                          type="button"
                          className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-muted/20 active:bg-muted/30 transition-colors"
                        >
                          <span className="flex items-center gap-3 font-bold text-[16px] text-foreground">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/20 text-primary shadow-inner shrink-0">
                              <Package className="h-4 w-4" />
                            </div>
                            {cat.name}
                          </span>
                          <ChevronDown
                            className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-300 ${expandedCategoryId === cat.id ? "rotate-180" : ""}`}
                          />
                        </button>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="px-3 pb-4 pt-1 flex flex-col gap-3">
                          {cat.tariffs.map((tf) => (
                            <Card key={tf.id} className="rounded-2xl border border-border/50 bg-background/50 backdrop-blur-md shadow-sm hover:shadow-md transition-all duration-300">
                              <CardContent className="flex flex-row items-center gap-4 py-4 px-4 min-h-0 min-w-0">
                                <div className="flex-1 min-w-0 space-y-1.5">
                                  <p className="text-[15px] font-bold leading-tight truncate text-foreground">{tf.name}</p>
                                  {tf.description?.trim() ? (
                                    <p className="text-xs text-muted-foreground font-medium line-clamp-2">{tf.description}</p>
                                  ) : null}
                                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                                    <span className="flex items-center gap-1.5 bg-background/50 px-2 py-1 rounded-md border border-border/50">
                                      <Calendar className="h-3 w-3 text-primary" />
                                      {(() => {
                                        const opts = tf.priceOptions ?? [];
                                        if (opts.length > 1) {
                                          const minDays = opts.reduce((min, o) => Math.min(min, o.durationDays), opts[0].durationDays);
                                          return <>от {minDays} {t("cabinet.tariffs.days_short")}</>;
                                        }
                                        return <>{tf.durationDays} {t("cabinet.tariffs.days_short")}</>;
                                      })()}
                                    </span>
                                    <span className="flex items-center gap-1.5 bg-background/50 px-2 py-1 rounded-md border border-border/50">
                                      <Wifi className="h-3 w-3 text-primary" />
                                      {tf.trafficLimitBytes != null && tf.trafficLimitBytes > 0 ? `${(tf.trafficLimitBytes / 1024 / 1024 / 1024).toFixed(1)} ${t("cabinet.tariffs.gb_unit")}${tf.trafficResetMode === "monthly" || tf.trafficResetMode === "monthly_rolling" ? t("cabinet.tariffs.per_month") : ""}` : "∞"}
                                    </span>
                                    <span className="flex items-center gap-1.5 bg-background/50 px-2 py-1 rounded-md border border-border/50">
                                      <Smartphone className="h-3 w-3 text-primary" />
                                      {tf.deviceLimit != null && tf.deviceLimit > 0 ? `${tf.deviceLimit}` : "∞"}
                                    </span>
                                  </div>
                                </div>
                                <div className="flex flex-col items-center justify-center gap-2.5 shrink-0 min-w-[90px]">
                                  <span className="text-lg font-bold tabular-nums whitespace-nowrap text-foreground" title={formatMoney(tf.price, tf.currency)}>
                                    {(() => {
                                      const opts = tf.priceOptions ?? [];
                                      const dev = extendExtraCost(tf);
                                      if (opts.length > 1) {
                                        const min = opts.reduce((a, b) => (a.price < b.price ? a : b));
                                        return <>{t("cabinet.tariffs.from_price", { defaultValue: "от" })} {formatMoney(min.price + dev, tf.currency)}</>;
                                      }
                                      return formatMoney(tf.price + dev, tf.currency);
                                    })()}
                                  </span>
                                  {token ? (
                                    <Button
                                      size="sm"
                                      className="w-full h-9 rounded-xl shadow-md text-xs font-semibold gap-1.5 hover:scale-105 transition-transform"
                                      onClick={() => requestBuy({ ...tf })}
                                    >
                                      <CreditCard className="h-3.5 w-3.5 shrink-0" />
                                      {t("cabinet.tariffs.pay")}
                                    </Button>
                                  ) : (
                                    <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground bg-muted/50 px-2 py-1 rounded-md">{t("cabinet.tariffs.in_bot")}</span>
                                  )}
                                </div>
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      </CollapsibleContent>
                    </motion.div>
                  </Collapsible>
                ))}
              </div>
            ) : (
              <div className="space-y-8">
                {displayTariffs.map((cat, catIndex) => (
                  <motion.section
                    key={cat.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: catIndex * 0.05 }}
                  >
                    <h2 className="text-xl font-bold mb-4 flex items-center gap-3 text-foreground">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/20 text-primary shadow-inner shrink-0">
                        <Package className="h-5 w-5" />
                      </div>
                      {cat.name}
                    </h2>
                    <div className="grid gap-4 sm:gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {cat.tariffs.map((tf) => (
                        <Card key={tf.id} className="rounded-3xl border border-border/50 bg-card/40 backdrop-blur-xl shadow-lg hover:shadow-xl transition-all duration-300 flex flex-col group hover:-translate-y-1">
                          <CardContent className="flex-1 flex flex-col p-5 min-h-0 min-w-0">
                            <div className="mb-4">
                              <p className="text-lg font-bold leading-tight line-clamp-2 text-foreground group-hover:text-primary transition-colors">{tf.name}</p>
                              {tf.description?.trim() ? (
                                <p className="text-sm text-muted-foreground font-medium mt-1.5 line-clamp-2">{tf.description}</p>
                              ) : null}
                            </div>

                            <div className="flex flex-col gap-2.5 mt-auto mb-5 text-sm font-semibold text-muted-foreground">
                              <div className="flex items-center gap-3 bg-background/50 px-3 py-2 rounded-xl border border-border/50">
                                <div className="bg-primary/20 p-1.5 rounded-lg text-primary">
                                  <Calendar className="h-4 w-4 shrink-0" />
                                </div>
                                <span>
                                  {(() => {
                                    const opts = tf.priceOptions ?? [];
                                    if (opts.length > 1) {
                                      const minDays = opts.reduce((min, o) => Math.min(min, o.durationDays), opts[0].durationDays);
                                      return <>от {minDays} {t("cabinet.tariffs.days_label")}</>;
                                    }
                                    return <>{tf.durationDays} {t("cabinet.tariffs.days_label")}</>;
                                  })()}
                                </span>
                              </div>
                              <div className="flex items-center gap-3 bg-background/50 px-3 py-2 rounded-xl border border-border/50">
                                <div className="bg-primary/20 p-1.5 rounded-lg text-primary">
                                  <Wifi className="h-4 w-4 shrink-0" />
                                </div>
                                <span>
                                  {tf.trafficLimitBytes != null && tf.trafficLimitBytes > 0
                                    ? `${(tf.trafficLimitBytes / 1024 / 1024 / 1024).toFixed(1)} ${t("cabinet.tariffs.gb_unit")}${tf.trafficResetMode === "monthly" || tf.trafficResetMode === "monthly_rolling" ? t("cabinet.tariffs.per_month") : ""}`
                                    : t("cabinet.tariffs.unlimited_traffic")}
                                </span>
                              </div>
                              <div className="flex items-center gap-3 bg-background/50 px-3 py-2 rounded-xl border border-border/50">
                                <div className="bg-primary/20 p-1.5 rounded-lg text-primary">
                                  <Smartphone className="h-4 w-4 shrink-0" />
                                </div>
                                <span>{tf.deviceLimit != null && tf.deviceLimit > 0 ? `${tf.deviceLimit}` : "∞"} {t("cabinet.tariffs.devices")}</span>
                              </div>
                            </div>

                            <div className="pt-4 border-t border-border/50 mt-auto flex flex-col gap-3 min-w-0">
                              <span className="text-2xl font-black tabular-nums truncate min-w-0 text-foreground text-center" title={formatMoney(tf.price, tf.currency)}>
                                {(() => {
                                  const opts = tf.priceOptions ?? [];
                                  const dev = extendExtraCost(tf);
                                  if (opts.length > 1) {
                                    const min = opts.reduce((a, b) => (a.price < b.price ? a : b));
                                    return <>{t("cabinet.tariffs.from_price", { defaultValue: "от" })} {formatMoney(min.price + dev, tf.currency)}</>;
                                  }
                                  return formatMoney(tf.price + dev, tf.currency);
                                })()}
                              </span>
                              {token ? (
                                <Button
                                  size="lg"
                                  className="w-full h-12 rounded-xl shadow-md text-[15px] font-bold gap-2 hover:scale-[1.02] transition-transform"
                                  onClick={() => requestBuy({ ...tf })}
                                >
                                  <CreditCard className="h-5 w-5 shrink-0" />
                                  {t("cabinet.tariffs.pay")}
                                </Button>
                              ) : (
                                <div className="w-full h-12 rounded-xl bg-muted/50 border border-border/50 flex items-center justify-center">
                                  <span className="text-sm font-bold uppercase tracking-wider text-muted-foreground">{t("cabinet.tariffs.in_bot")}</span>
                                </div>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </motion.section>
                ))}
              </div>
            )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* DESKTOP VIEW: DIALOG БЕЗ СКРОЛЛИНГА */}
      {!isMobileOrMiniapp && (
        <Dialog open={!!payModal} onOpenChange={(open) => { if (!open && !payLoading) closePayment(); }}>
          <DialogContent className="w-full max-w-md mx-auto sm:rounded-3xl p-5 sm:p-6 border border-border/50 bg-card/60 backdrop-blur-3xl shadow-2xl" showCloseButton={!payLoading} onOpenAutoFocus={(e) => e.preventDefault()}>
            <DialogHeader className="mb-4 text-center sm:text-left">
              <DialogTitle className="text-2xl font-bold flex items-center justify-center sm:justify-start gap-2">
                <div className="p-2 bg-primary/10 rounded-xl">
                  <Shield className="h-6 w-6 text-primary" />
                </div>
                {t("cabinet.tariffs.payment_title")}
              </DialogTitle>
              <DialogDescription className="hidden" />
            </DialogHeader>

            {PaymentContent()}

            <DialogFooter className="mt-4 sm:justify-center border-t border-border/50 pt-4">
              <Button variant="ghost" onClick={closePayment} disabled={payLoading} className="rounded-xl hover:bg-background/50 hover:text-foreground text-muted-foreground transition-colors">
                {t("cabinet.tariffs.cancel")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Унифицированная модалка покупки: длительность + ДОП. устройства + total */}
      <UnifiedPurchaseModal
        modal={purchaseModal}
        selectedPriceOptionId={selectedPriceOptionId}
        setSelectedPriceOptionId={setSelectedPriceOptionId}
        selectedExtraDevices={selectedExtraDevices}
        setSelectedExtraDevices={setSelectedExtraDevices}
        onClose={() => setPurchaseModal(null)}
        onConfirm={confirmPurchase}
        extendKeepDevices={(extendTarget && !removeExtrasOnExtend) ? (extendTarget.extraDevices ?? 0) : 0}
        extendDeviceMonthlyPrice={extendTarget?.extraDevicesMonthlyPrice ?? 0}
      />

      {/* модалка продления существующей подписки — открывается
          из подсказки «у вас уже есть подписка с этим тарифом». */}
      {extendDialogSubId && (
        <ExtendSubscriptionDialog
          subId={extendDialogSubId}
          open
          onClose={() => setExtendDialogSubId(null)}
          onPaidByBalance={() => { loadUserSubs(); }}
        />
      )}
    </>
  );
}

// ─────────────── Унифицированная модалка покупки тарифа ───────────────
// Длительность (chips) → Устройства (плитки со скидкой) → итог + кнопка дальше.
function UnifiedPurchaseModal({
  modal,
  selectedPriceOptionId,
  setSelectedPriceOptionId,
  selectedExtraDevices,
  setSelectedExtraDevices,
  onClose,
  onConfirm,
  extendKeepDevices,
  extendDeviceMonthlyPrice,
}: {
  modal: { tariff: TariffForPay } | null;
  selectedPriceOptionId: string | null;
  setSelectedPriceOptionId: (v: string | null) => void;
  selectedExtraDevices: number;
  setSelectedExtraDevices: (v: number) => void;
  onClose: () => void;
  onConfirm: () => void;
  /** T-extend-devices: сохраняемые доп.устройства при продлении (0 если удаляем/не продление). */
  extendKeepDevices?: number;
  extendDeviceMonthlyPrice?: number;
}) {
  const [agree, setAgree] = useState(false);
  const tariff = modal?.tariff;
  // Сброс галочки согласия при открытии модалки под новый тариф.
  useEffect(() => { setAgree(false); }, [modal]);
  if (!tariff) return null;

  const opts = [...(tariff.priceOptions ?? [])].sort((a, b) =>
    a.sortOrder !== b.sortOrder ? a.sortOrder - b.sortOrder : a.durationDays - b.durationDays
  );
  const selectedOpt = opts.find((o) => o.id === selectedPriceOptionId) ?? opts[0] ?? null;
  const unitPrice = selectedOpt?.price ?? tariff.price;
  const includedDevices = tariff.includedDevices ?? 1;
  const pricePerExtra = tariff.pricePerExtraDevice ?? 0;
  const maxExtras = tariff.maxExtraDevices ?? 0;
  const extrasEnabled = hasExtras(tariff);
  const tiers = tariff.deviceDiscountTiers ?? [];

  // Best-deal по длительности (минимальная цена за день).
  let bestDurationId: string | null = null;
  if (opts.length > 1) {
    let bestRatio = Infinity;
    for (const o of opts) {
      if (o.durationDays <= 0) continue;
      const ratio = o.price / o.durationDays;
      if (ratio < bestRatio) {
        bestRatio = ratio;
        bestDurationId = o.id;
      }
    }
  }

  // Длительность выбранной опции — нужна для масштаба цены доп. устройств.
  const selectedDays = selectedOpt?.durationDays ?? tariff.durationDays ?? 30;

  // Плитки доп. устройств: +0..+maxExtras.
  const deviceTiles = Array.from({ length: maxExtras + 1 }, (_, i) => {
    const extras = i;
    const { extrasTotal, pct } = applyExtrasPrice(pricePerExtra, extras, tiers, selectedDays);
    return { extras, total: unitPrice + extrasTotal, pct, totalDevices: includedDevices + extras };
  });
  const bestExtra = deviceTiles.slice(1).reduce((best, cur) => {
    const perDev = cur.totalDevices > 0 ? cur.total / cur.totalDevices : Infinity;
    if (best == null || perDev < best.perDev) return { extras: cur.extras, perDev };
    return best;
  }, null as { extras: number; perDev: number } | null);

  const { extrasTotal: appliedExtras, pct: appliedPct } = applyExtrasPrice(pricePerExtra, selectedExtraDevices, tiers, selectedDays);
  // T-extend-devices: стоимость СОХРАНЯЕМЫХ доп.устройств при продлении (масштаб от 30 дней к длительности опции).
  const extendDevicesCost = (extendKeepDevices ?? 0) > 0 ? Math.round((extendDeviceMonthlyPrice ?? 0) * (selectedDays / EXTRA_DEVICE_BASE_DAYS)) : 0;
  const finalTotal = unitPrice + appliedExtras + extendDevicesCost;
  // Базовая сумма без скидки = pricePerExtra × extras × коэффициент длительности (для отображения «сэкономлено»).
  const baseExtrasNoDiscount = pricePerExtra * selectedExtraDevices * (selectedDays / EXTRA_DEVICE_BASE_DAYS);
  const savedAmount = baseExtrasNoDiscount - appliedExtras;

  return (
    <Dialog open={!!modal} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-background/85 backdrop-blur-3xl border-white/10 rounded-[2rem] sm:max-w-lg max-h-[92vh] overflow-y-auto overflow-x-hidden">
        <div className="absolute -top-20 -right-20 h-56 w-56 rounded-full bg-gradient-to-br from-primary/30 via-fuchsia-500/15 to-purple-500/20 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-16 h-52 w-52 rounded-full bg-gradient-to-tr from-cyan-500/15 to-primary/15 blur-3xl pointer-events-none" />

        <DialogHeader className="relative">
          <div className="flex items-center gap-3">
            <motion.div
              animate={{ rotate: [0, -6, 6, 0] }}
              transition={{ duration: 1.6, repeat: Infinity, repeatDelay: 4 }}
              className="h-14 w-14 rounded-3xl bg-gradient-to-br from-primary/30 via-fuchsia-500/20 to-purple-500/30 border border-white/15 flex items-center justify-center shadow-xl shrink-0"
            >
              <Package className="h-7 w-7 text-primary" />
            </motion.div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-2xl font-black tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-primary via-fuchsia-500 to-purple-500">
                {tariff.name}
              </DialogTitle>
              {tariff.description && (
                <DialogDescription className="text-xs text-muted-foreground mt-1 line-clamp-2">
                  {tariff.description}
                </DialogDescription>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="relative space-y-5 mt-2">
          {/* ── 1. Длительность ── */}
          {opts.length > 0 && (
            <section>
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2.5 block">
                <Calendar className="inline h-3 w-3 mr-1" /> Длительность
              </Label>
              <div className={cn(
                "grid gap-2",
                opts.length === 1 ? "grid-cols-1" : opts.length === 2 ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3"
              )}>
                {opts.map((opt) => {
                  const isActive = (selectedOpt?.id ?? opts[0]?.id) === opt.id;
                  const isBest = opt.id === bestDurationId;
                  const perDay = opt.durationDays > 0 ? opt.price / opt.durationDays : 0;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setSelectedPriceOptionId(opt.id)}
                      className={cn(
                        "relative overflow-hidden rounded-2xl border p-3 transition-all text-center",
                        "hover:scale-[1.03] hover:shadow-lg",
                        isActive
                          ? "bg-gradient-to-br from-primary/25 via-fuchsia-500/10 to-purple-500/15 border-primary/50 ring-2 ring-primary/40 shadow-lg shadow-primary/20"
                          : "bg-foreground/[0.03] dark:bg-white/[0.02] border-white/10 hover:border-white/20"
                      )}
                    >
                      {isBest && (
                        <span className="absolute -top-1.5 -right-1.5 px-1.5 py-0.5 rounded-md bg-amber-500 text-white text-[9px] font-black shadow">
                          ★
                        </span>
                      )}
                      <p className={cn("text-sm font-bold", isActive && "text-primary")}>
                        {opt.durationDays} {formatRuDays(opt.durationDays).replace(/^\d+\s/, "")}
                      </p>
                      {/* T-unify-cabinet (30.05.2026, WolfVPN): полная стоимость подписки за период */}
                      <p className={cn("text-[13px] font-extrabold tabular-nums mt-0.5", isActive ? "text-primary" : "text-foreground")}>
                        {formatMoney(opt.price, tariff.currency)}
                      </p>
                      <p className="text-[10px] text-muted-foreground tabular-nums">
                        {formatMoneyPerDay(perDay, tariff.currency)}/день
                      </p>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* ── 2. Доп. устройства (только если включены в тарифе) ── */}
          {extrasEnabled && (
            <section>
              <div className="flex items-center justify-between mb-2.5">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  <Smartphone className="inline h-3 w-3 mr-1" /> Доп. устройства
                </Label>
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  В тарифе: <strong className="text-foreground">{includedDevices}</strong>
                </span>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {deviceTiles.map((tile) => {
                  const isActive = tile.extras === selectedExtraDevices;
                  const isBest = bestExtra?.extras === tile.extras && tile.extras > 0 && tile.pct === 0;
                  return (
                    <motion.button
                      key={tile.extras}
                      type="button"
                      onClick={() => setSelectedExtraDevices(tile.extras)}
                      whileTap={{ scale: 0.96 }}
                      className={cn(
                        "relative overflow-hidden rounded-2xl border p-3 transition-all",
                        "hover:scale-[1.04] hover:shadow-lg",
                        isActive
                          ? "bg-gradient-to-br from-primary/25 via-fuchsia-500/15 to-purple-500/20 border-primary/50 ring-2 ring-primary/40 shadow-lg shadow-primary/20"
                          : tile.pct > 0
                            ? "bg-gradient-to-br from-emerald-500/[0.06] to-cyan-500/[0.04] border-emerald-500/25 hover:border-emerald-500/40"
                            : "bg-foreground/[0.03] dark:bg-white/[0.02] border-white/10 hover:border-white/20"
                      )}
                    >
                      {tile.pct > 0 && (
                        <div className={cn(
                          "absolute -top-1 -right-1 px-1.5 py-0.5 rounded-md text-[9px] font-black shadow z-10",
                          isActive ? "bg-fuchsia-500 text-white" : "bg-emerald-500 text-white"
                        )}>
                          −{tile.pct}%
                        </div>
                      )}
                      {isBest && (
                        <Sparkles className="absolute top-1.5 right-1.5 h-3 w-3 text-fuchsia-500" />
                      )}
                      <div className="flex items-center justify-center gap-1 mb-1">
                        <Smartphone className={cn("h-3.5 w-3.5", isActive ? "text-primary" : "text-muted-foreground")} />
                        <span className={cn("text-sm font-bold", isActive && "text-primary")}>
                          {tile.extras === 0 ? "Без доп." : `+${tile.extras}`}
                        </span>
                      </div>
                      <p className="text-[11px] font-bold text-foreground/90 tabular-nums text-center">
                        {formatMoney(tile.total, tariff.currency)}
                      </p>
                      <p className="text-[9px] text-muted-foreground/80 text-center mt-0.5">
                        {tile.totalDevices} устр
                      </p>
                      {isBest && (
                        <p className="text-[9px] font-medium text-fuchsia-500 dark:text-fuchsia-400 text-center mt-0.5">
                          выгоднее всего
                        </p>
                      )}
                    </motion.button>
                  );
                })}
              </div>
            </section>
          )}

          {/* ── 3. Итог ── */}
          <section className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/[0.08] via-fuchsia-500/[0.04] to-purple-500/[0.06] p-4">
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-xs text-muted-foreground">Длительность</span>
              <span className="text-xs font-medium tabular-nums">
                {selectedOpt?.durationDays ?? 0} {formatRuDays(selectedOpt?.durationDays ?? 0).replace(/^\d+\s/, "")}
              </span>
            </div>
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-xs text-muted-foreground">Тариф ({includedDevices} устр)</span>
              <span className="text-xs font-medium tabular-nums">
                {formatMoney(unitPrice, tariff.currency)}
              </span>
            </div>
            {extrasEnabled && selectedExtraDevices > 0 && (
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-xs text-muted-foreground">+{selectedExtraDevices} доп. устр</span>
                <span className="text-xs font-medium tabular-nums">
                  {formatMoney(pricePerExtra * (selectedDays / EXTRA_DEVICE_BASE_DAYS), tariff.currency)} × {selectedExtraDevices}
                </span>
              </div>
            )}
            {extendDevicesCost > 0 && (
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-xs text-muted-foreground">Сохранение {extendKeepDevices} доп. устр</span>
                <span className="text-xs font-medium tabular-nums">+{formatMoney(extendDevicesCost, tariff.currency)}</span>
              </div>
            )}
            {savedAmount > 0 && (
              <div className="flex items-baseline justify-between mb-1 text-emerald-500 dark:text-emerald-400">
                <span className="text-xs flex items-center gap-1">
                  <Sparkles className="h-3 w-3" /> Скидка {appliedPct}%
                </span>
                <span className="text-xs font-bold tabular-nums">
                  −{formatMoney(savedAmount, tariff.currency)}
                </span>
              </div>
            )}
            <div className="border-t border-primary/20 mt-2 pt-2 flex items-baseline justify-between">
              <span className="text-sm font-medium">К оплате</span>
              <AnimatePresence mode="popLayout">
                <motion.span
                  key={finalTotal}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="text-2xl font-black bg-clip-text text-transparent bg-gradient-to-r from-primary to-fuchsia-500 tabular-nums"
                >
                  {formatMoney(finalTotal, tariff.currency)}
                </motion.span>
              </AnimatePresence>
            </div>
          </section>
        </div>

        {/* ── Согласие с документами (обязательно перед оплатой) ── */}
        <div className="relative mt-4 flex items-start gap-2.5 rounded-2xl border border-white/10 bg-foreground/[0.03] dark:bg-white/[0.02] p-3.5">
          <Checkbox
            id="agree-pay"
            checked={agree}
            onCheckedChange={(v) => setAgree(v === true)}
            className="mt-0.5 shrink-0 border-white/50 bg-white/10 data-[state=checked]:bg-fuchsia-500 data-[state=checked]:border-fuchsia-500 data-[state=checked]:text-white"
          />
          <Label htmlFor="agree-pay" className="text-xs font-normal leading-relaxed text-muted-foreground cursor-pointer">
            Нажимая кнопку «К оплате», я подтверждаю, что ознакомился и согласен с условиями{" "}
            <Link to="/cabinet/documents/offer" target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">Публичной оферты</Link>,{" "}
            <Link to="/cabinet/documents/privacy" target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">Политикой обработки персональных данных</Link>{" "}и{" "}
            <Link to="/cabinet/documents/refund" target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">Политикой возврата</Link>.
          </Label>
        </div>

        <DialogFooter className="relative mt-3 gap-2 sm:gap-2 flex-col sm:flex-row">
          <Button variant="outline" onClick={onClose} className="rounded-xl">
            Отмена
          </Button>
          <Button
            onClick={onConfirm}
            disabled={!selectedOpt || !agree}
            className="rounded-xl gap-2 h-11 px-6 text-base font-bold bg-gradient-to-r from-primary via-fuchsia-500 to-purple-500 hover:from-primary/90 hover:via-fuchsia-500/90 hover:to-purple-500/90 shadow-lg shadow-primary/30"
          >
            <CreditCard className="h-4 w-4" />
            К оплате
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
