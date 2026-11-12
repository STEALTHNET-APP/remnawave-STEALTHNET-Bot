import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Bitcoin, Wallet } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { api, type PublicTariff, type PublicTariffCategory, type TariffConversionPreview } from "@/lib/api";
import { getTelegramWebApp, openPaymentInBrowser } from "@/lib/open-payment-url";
import { usePublicConfig } from "@/lib/public-config";
import { useAvailableTrials, usePublicTariffs } from "@/lib/queries";

export type PayMethodKind =
  | "platega"
  | "yookassa"
  | "yoomoney"
  | "telegram_stars"
  | "cryptopay"
  | "heleket"
  | "rollypay"
  | "cispay"
  | "paritypay"
  | "cloudpayments"
  | "lava"
  | "lavatop"
  | "overpay"
  | "balance";

export type PayMethod =
  | { kind: "platega"; id: number; label: string; icon: typeof Wallet }
  | { kind: Exclude<PayMethodKind, "platega">; label: string; icon: typeof Wallet };

export type PayReadyInfo = { url: string; provider: string; paymentId?: string; kind: PayMethodKind };

export type MoneyFormat = "classic" | "aurora" | "stealth";

export interface CabinetTariffPurchaseSub {
  id: string;
  subscriptionIndex: number;
  label: string;
  expireAt: string | null;
  emoji: string | null;
  tariffId: string | null;
  extraDevices: number;
  extraDevicesMonthlyPrice: number;
  isTrial: boolean;
  trialConvertEnabled: boolean;
  convertTariffIds: string[];
  trialConvertAllTariffs: boolean;
  trialName: string | null;
}

export interface CabinetTariffPurchaseOptions {
  subLabel?: (index: number) => string;
  autoSelectFirst?: boolean;
  autoSelectExtended?: false | "tariffOnly" | "withTrialConversion";
  catalogFallbackToAll?: boolean;
  extras?: boolean;
  extrasDuringExtend?: boolean;
  resetExtrasOnSelection?: boolean;
  convExtendExtras?: boolean;
  promoDiscount?: "none" | "plan" | "total";
  promoAppliedMessage?: string | null;
  promoInvalidMessage?: string;
  promoActivateOnNonDiscount?: (code: string, result: { type: string; name: string }) => void | Promise<void>;
  clearPromoOnCheck?: boolean;
  additional?: "never" | "whenSubscriptions" | "multiSubscriptions";
  extrasOnExtendPayload?: "conditional" | "always";
  deviceCount?: "never" | "positive" | "always";
  trialReplacement?: "owned" | "convertible";
  trialConversionGuard?: boolean;
  preview?: "auto" | "manual";
  previewReplaceTrialSubId?: boolean;
  resetTrialChoiceOnPreview?: boolean;
  requirePreview?: boolean;
  requirePriceOption?: boolean;
  refreshProfileOnMount?: boolean;
  trialBadgeLabel?: string;
  tariffFallbackLabel?: string;
  beforeBalancePay?: () => string | null;
  onBalancePaid?: (result: { message: string }) => void;
  providerLabels?: Partial<Record<PayMethodKind, string>>;
  extraProviders?: PayMethodKind[];
  rubOnlyKinds?: PayMethodKind[];
  fallbackOrder?: PayMethodKind[];
  orderByConfigArray?: boolean;
  sendAmount?: boolean;
  payErrorMessage?: string;
}

export interface CabinetTariffPurchaseDoPayOptions {
  method?: PayMethod;
  onReadyUrl?: (info: PayReadyInfo) => void;
}

type TariffPaymentBase = {
  tariffId: string;
  tariffPriceOptionId?: string;
  promoCode?: string;
  deviceCount?: number;
  extendsSecondarySubId?: string;
  asAdditional?: boolean;
  removeExtrasOnActivate?: boolean;
  replaceTrialSubId?: string;
};

const EXTRA_DEVICE_BASE_DAYS = 30;

const DEFAULT_METHOD_ORDER: PayMethodKind[] = [
  "platega",
  "yookassa",
  "yoomoney",
  "telegram_stars",
  "cryptopay",
  "heleket",
  "rollypay",
  "cispay",
  "cloudpayments",
  "paritypay",
  "lava",
  "lavatop",
  "overpay",
  "balance",
];

const METHOD_LABELS: Record<PayMethodKind, string> = {
  platega: "Platega",
  yookassa: "YooKassa",
  yoomoney: "YooMoney",
  telegram_stars: "⭐ Telegram Stars",
  cryptopay: "Crypto Pay",
  heleket: "Heleket",
  rollypay: "RollyPay",
  cispay: "CisPay",
  paritypay: "ParityPay",
  cloudpayments: "CloudPayments",
  lava: "Lava",
  lavatop: "Lava.top",
  overpay: "Overpay",
  balance: "Баланс",
};

const CRYPTO_METHODS: PayMethodKind[] = ["telegram_stars", "cryptopay", "heleket"];

export function currencySymbol(currency: string): string {
  const code = currency.toUpperCase();
  if (code === "RUB") return "₽";
  if (code === "USD") return "$";
  return code;
}

function intlCurrency(currency: string, legacyFallback: boolean): string {
  const code = currency.toUpperCase();
  return legacyFallback && code !== "USD" && code !== "RUB" ? "USD" : code;
}

export function formatMoney(amount: number, currency: string, format: MoneyFormat = "classic"): string {
  if (format === "stealth") return `${Math.round(amount)}${currencySymbol(currency)}`;
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: intlCurrency(currency, format === "classic"),
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatMoneyPerDay(amount: number, currency: string, format: MoneyFormat = "classic"): string {
  if (format === "stealth") return `${amount.toFixed(2)}${currencySymbol(currency)}`;
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: intlCurrency(currency, format === "classic"),
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function applyExtrasPrice(
  pricePerExtra: number,
  extras: number,
  tiers: { minExtraDevices: number; discountPercent: number }[] | undefined,
  durationDays: number = EXTRA_DEVICE_BASE_DAYS,
): { extrasTotal: number; pct: number } {
  const safe = Math.max(0, Math.floor(extras));
  if (safe === 0 || pricePerExtra <= 0) return { extrasTotal: 0, pct: 0 };
  const sorted = [...(tiers ?? [])].sort((a, b) => b.minExtraDevices - a.minExtraDevices);
  const tier = sorted.find((t) => safe >= t.minExtraDevices);
  const pct = tier?.discountPercent ?? 0;
  const safeDays = Math.max(1, durationDays);
  const monthly = (pricePerExtra * safe * (100 - pct)) / 100;
  return { extrasTotal: Math.round(monthly * (safeDays / EXTRA_DEVICE_BASE_DAYS) * 100) / 100, pct };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function useCabinetTariffPurchase(options: CabinetTariffPurchaseOptions = {}) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const { state, refreshProfile } = useClientAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const token = state.token;
  const config = usePublicConfig();

  const tariffsQuery = usePublicTariffs();
  const trialsQuery = useAvailableTrials(token);

  const categories = useMemo<PublicTariffCategory[]>(
    () => (tariffsQuery.data?.items ?? []).filter((category) => category.tariffs.length > 0),
    [tariffsQuery.data],
  );
  const loading = tariffsQuery.isLoading || (tariffsQuery.isFetching && !tariffsQuery.data);
  const catalogError = tariffsQuery.isError;
  const remnaAvailable = tariffsQuery.data?.remnaAvailable ?? true;
  const refetchCatalog = useCallback(() => {
    void tariffsQuery.refetch();
  }, [tariffsQuery]);

  const availableTrials = trialsQuery.data?.items ?? [];
  const hasTrials = availableTrials.length > 0;
  const refetchTrials = trialsQuery.refetch;

  const [mySubs, setMySubs] = useState<CabinetTariffPurchaseSub[]>([]);
  const refreshSubscriptions = useCallback(async () => {
    if (!token) {
      setMySubs([]);
      return;
    }
    try {
      const result = await api.clientAllSubscriptions(token);
      const labelFor = optionsRef.current.subLabel ?? ((index: number) => `Подписка #${index}`);
      setMySubs((result.items ?? []).map((item) => {
        const raw = item.subscription as Record<string, unknown> | null;
        const payload = raw && typeof raw === "object" && raw.response && typeof raw.response === "object"
          ? (raw.response as Record<string, unknown>)
          : raw;
        const index = item.subscriptionIndex ?? 0;
        return {
          id: item.id,
          subscriptionIndex: index,
          label: item.tariffDisplayName?.trim() || labelFor(index),
          expireAt: payload && typeof payload.expireAt === "string" ? payload.expireAt : null,
          emoji: item.tariffMenuEmoji ?? null,
          tariffId: item.tariffId ?? null,
          extraDevices: item.extraDevices ?? 0,
          extraDevicesMonthlyPrice: item.extraDevicesMonthlyPrice ?? 0,
          isTrial: Boolean(item.trialId),
          trialConvertEnabled: item.trialConvertEnabled !== false,
          convertTariffIds: item.convertTariffIds ?? [],
          trialConvertAllTariffs: item.trialConvertAllTariffs ?? false,
          trialName: item.trialName ?? null,
        };
      }));
    } catch {
      setMySubs([]);
    }
  }, [token]);

  useEffect(() => {
    void refreshSubscriptions();
  }, [refreshSubscriptions]);

  const extendParam = searchParams.get("extend");
  const extendTarget = useMemo(() => {
    if (!extendParam) return null;
    const found = mySubs.find((sub) => sub.id === extendParam) ?? null;
    if (!found) return null;
    if (optionsRef.current.trialConversionGuard && found.isTrial && !found.trialConvertEnabled) return null;
    return found;
  }, [extendParam, mySubs]);
  const trialConversionBlocked = Boolean(
    optionsRef.current.trialConversionGuard
      && extendParam
      && mySubs.some((sub) => sub.id === extendParam && sub.isTrial && !sub.trialConvertEnabled),
  );

  const [selectedCatId, setSelectedCatId] = useState<string | null>(null);
  const [selectedTariffId, setSelectedTariffId] = useState<string | null>(null);
  const [selectedPriceOptionId, setSelectedPriceOptionId] = useState<string | null>(null);
  const [extraDevices, setExtraDevices] = useState(0);
  const [extKeepExtras, setExtKeepExtras] = useState(true);
  const [replaceTrialChoice, setReplaceTrialChoice] = useState<string | null>(null);
  const [promoInput, setPromoInput] = useState(() => (typeof location.state?.promoCode === "string" ? location.state.promoCode : ""));
  const [promoApplied, setPromoApplied] = useState<string | null>(null);
  const [promoInfo, setPromoInfo] = useState<{ percent: number; fixed: number; name: string } | null>(null);
  const [promoMsg, setPromoMsg] = useState<string | null>(null);
  const [promoBusy, setPromoBusy] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState<PayMethod | null>(null);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [convPreview, setConvPreview] = useState<TariffConversionPreview | null>(null);
  const [convKeepExtras, setConvKeepExtras] = useState(true);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [previewRetry, setPreviewRetry] = useState(0);
  const [previewEnabled, setPreviewEnabled] = useState(options.preview !== "manual");

  const displayCategories = useMemo(() => {
    if (!extendTarget) return categories;
    if (extendTarget.isTrial && extendTarget.trialConvertAllTariffs) return categories;
    const allowed = [
      ...(extendTarget.tariffId ? [extendTarget.tariffId] : []),
      ...(extendTarget.isTrial ? extendTarget.convertTariffIds : []),
    ];
    if (allowed.length === 0) return categories;
    const filtered = categories
      .map((category) => ({ ...category, tariffs: category.tariffs.filter((tariff) => allowed.includes(tariff.id)) }))
      .filter((category) => category.tariffs.length > 0);
    if (filtered.length > 0 || options.catalogFallbackToAll === false) return filtered;
    return categories;
  }, [categories, extendTarget, options.catalogFallbackToAll]);

  useEffect(() => {
    if (!options.autoSelectFirst) return;
    if (categories.length === 0) return;
    if (selectedCatId) return;
    const category = categories[0];
    const tariff = category.tariffs[0];
    setSelectedCatId(category.id);
    if (!tariff) return;
    setSelectedTariffId(tariff.id);
    const priceOptions = tariff.priceOptions ?? [];
    if (priceOptions.length > 0) {
      setSelectedPriceOptionId((priceOptions.find((option) => option.durationDays === 30) ?? priceOptions[0]).id);
    }
  }, [options.autoSelectFirst, categories, selectedCatId]);

  useEffect(() => {
    const mode = options.autoSelectExtended ?? false;
    if (!extendTarget || !mode || categories.length === 0) return;
    const preferredId = extendTarget.tariffId
      ?? (mode === "withTrialConversion" && extendTarget.isTrial ? extendTarget.convertTariffIds[0] : null);
    if (!preferredId) return;
    const category = categories.find((item) => item.tariffs.some((tariff) => tariff.id === preferredId));
    const tariff = category?.tariffs.find((item) => item.id === preferredId);
    if (!category || !tariff) return;
    setSelectedCatId(category.id);
    setSelectedTariffId(tariff.id);
    const priceOptions = tariff.priceOptions ?? [];
    if (priceOptions.length > 0) {
      setSelectedPriceOptionId((priceOptions.find((option) => option.durationDays === 30) ?? priceOptions[0]).id);
    }
  }, [extendTarget, categories, options.autoSelectExtended]);

  useEffect(() => {
    if (!options.resetExtrasOnSelection) return;
    setExtraDevices(0);
  }, [options.resetExtrasOnSelection, selectedTariffId, selectedPriceOptionId]);

  useEffect(() => {
    if (options.refreshProfileOnMount === false) return;
    refreshProfile().catch(() => {});
  }, [options.refreshProfileOnMount, refreshProfile]);

  const currentCat = displayCategories.find((category) => category.id === selectedCatId);
  const selectedTariff = (currentCat?.tariffs.find((tariff) => tariff.id === selectedTariffId)
    ?? displayCategories.flatMap((category) => category.tariffs).find((tariff) => tariff.id === selectedTariffId)) as PublicTariff | undefined;
  const priceOptions = selectedTariff?.priceOptions ?? [];
  const selectedPriceOption = priceOptions.find((option) => option.id === selectedPriceOptionId);
  const basePrice = selectedPriceOption?.price ?? selectedTariff?.price ?? 0;
  const days = selectedPriceOption?.durationDays ?? selectedTariff?.durationDays ?? EXTRA_DEVICE_BASE_DAYS;
  const currency = selectedTariff?.currency ?? "rub";

  const extrasCalc = useMemo(
    () => applyExtrasPrice(selectedTariff?.pricePerExtraDevice ?? 0, extraDevices, selectedTariff?.deviceDiscountTiers, days),
    [selectedTariff, extraDevices, days],
  );
  const extrasTotal = options.extras && selectedTariff && (options.extrasDuringExtend || !extendTarget) ? extrasCalc.extrasTotal : 0;
  const extrasDiscountPct = extrasCalc.pct;

  const keepExtrasCost = useMemo(() => {
    if (!extendTarget || extendTarget.extraDevices <= 0) return 0;
    if (extendTarget.tariffId && selectedTariff && extendTarget.tariffId !== selectedTariff.id) return 0;
    return Math.round(extendTarget.extraDevicesMonthlyPrice * (Math.max(1, days) / EXTRA_DEVICE_BASE_DAYS));
  }, [extendTarget, selectedTariff, days]);
  const extendExtrasCost = extKeepExtras ? keepExtrasCost : 0;
  const convExtendExtrasCost = options.convExtendExtras !== false
    && !extendTarget
    && convPreview?.mode === "extend"
    && convKeepExtras
    && (convPreview.extras?.extraDevices ?? 0) > 0
    ? Math.round((convPreview.extras?.extraDevicesMonthlyPrice ?? 0) * (Math.max(1, days) / EXTRA_DEVICE_BASE_DAYS))
    : 0;

  const totalPrice = basePrice + extrasTotal + extendExtrasCost + convExtendExtrasCost;
  const promoMode = options.promoDiscount ?? "none";
  const promoDiscount = useMemo(() => {
    if (promoMode === "none" || !promoInfo) return 0;
    if (promoMode === "total") {
      let discounted = totalPrice;
      if (promoInfo.percent > 0) discounted -= (discounted * promoInfo.percent) / 100;
      if (promoInfo.fixed > 0) discounted -= promoInfo.fixed;
      return round2(totalPrice - Math.max(0, round2(discounted)));
    }
    const gross = basePrice + extrasTotal;
    const raw = promoInfo.percent > 0 ? (gross * promoInfo.percent) / 100 : promoInfo.fixed;
    return Math.min(gross, Math.max(0, round2(raw)));
  }, [promoMode, promoInfo, totalPrice, basePrice, extrasTotal]);
  const finalPrice = promoMode === "none" || !promoInfo
    ? totalPrice
    : Math.max(0, round2(totalPrice - promoDiscount));
  const pricePerDay = days > 0 ? finalPrice / days : 0;

  const balance = state.client?.balance ?? 0;
  const canPayWithBalance = balance >= finalPrice && finalPrice > 0;
  const personalDiscountPct = Math.max(
    0,
    (state.client as { personalDiscountPercent?: number | null } | null)?.personalDiscountPercent ?? 0,
  );

  const availableMethods = useMemo<PayMethod[]>(() => {
    if (!config) return [];
    const list: PayMethod[] = [];
    const providers = config.paymentProviders ?? [];
    const providerLabels = options.providerLabels ?? {};
    const labelFor = (id: string, fallback: string) => {
      const configured = providers.find((provider) => provider.id === id)?.label?.trim();
      return configured || fallback || METHOD_LABELS[id as PayMethodKind] || id;
    };
    const iconFor = (kind: PayMethodKind) => (CRYPTO_METHODS.includes(kind) ? Bitcoin : Wallet);
    const rubOnly = options.rubOnlyKinds ?? [];
    const isRub = currency.toUpperCase() === "RUB";
    const push = (kind: Exclude<PayMethodKind, "platega" | "balance">, fallback: string) => {
      if (rubOnly.includes(kind) && !isRub) return;
      list.push({ kind, label: labelFor(kind, providerLabels[kind] ?? fallback), icon: iconFor(kind) });
    };
    (config.plategaMethods ?? []).forEach((method) => {
      list.push({ kind: "platega", id: method.id, label: labelFor(`platega_${method.id}`, method.label), icon: Wallet });
    });
    if (config.yookassaEnabled) push("yookassa", METHOD_LABELS.yookassa);
    if (config.yoomoneyEnabled) push("yoomoney", METHOD_LABELS.yoomoney);
    if (config.telegramStarsEnabled && isRub) push("telegram_stars", METHOD_LABELS.telegram_stars);
    if (config.cryptopayEnabled) push("cryptopay", METHOD_LABELS.cryptopay);
    if (config.heleketEnabled) push("heleket", METHOD_LABELS.heleket);
    if (config.rollypayEnabled) push("rollypay", METHOD_LABELS.rollypay);
    if (config.cispayEnabled) push("cispay", METHOD_LABELS.cispay);
    if (config.cloudpaymentsEnabled) push("cloudpayments", METHOD_LABELS.cloudpayments);
    if (config.paritypayEnabled) push("paritypay", METHOD_LABELS.paritypay);
    if (config.lavaEnabled) push("lava", METHOD_LABELS.lava);
    const extraProviders = options.extraProviders ?? [];
    if (config.lavatopEnabled && extraProviders.includes("lavatop")) push("lavatop", METHOD_LABELS.lavatop);
    if (config.overpayEnabled && extraProviders.includes("overpay")) push("overpay", METHOD_LABELS.overpay);
    const methodId = (method: PayMethod) => (method.kind === "platega" ? `platega_${method.id}` : method.kind);
    const order = new Map(providers.map((provider, index) => [provider.id, options.orderByConfigArray ? index : (provider.sortOrder ?? index)]));
    const fallbackOrder = options.fallbackOrder ?? DEFAULT_METHOD_ORDER;
    const fallback = new Map(list.map((method, index) => {
      const position = fallbackOrder.indexOf(method.kind);
      return [methodId(method), 100 + (position >= 0 ? position : index)];
    }));
    return list.sort(
      (a, b) => (order.get(methodId(a)) ?? fallback.get(methodId(a)) ?? 999) - (order.get(methodId(b)) ?? fallback.get(methodId(b)) ?? 999),
    );
  }, [config, currency, options]);

  useEffect(() => {
    if (!selectedMethod && availableMethods.length > 0) setSelectedMethod(availableMethods[0]);
  }, [availableMethods, selectedMethod]);

  useEffect(() => {
    if (selectedMethod?.kind === "balance" && !canPayWithBalance) setSelectedMethod(availableMethods[0] ?? null);
  }, [canPayWithBalance]);

  const ownedTrials = useMemo(() => mySubs.filter((sub) => sub.isTrial), [mySubs]);
  const activeTrial = useMemo(
    () => mySubs.find((sub) => sub.isTrial
      && sub.trialConvertEnabled
      && (!sub.expireAt || Date.parse(sub.expireAt) > Date.now())) ?? null,
    [mySubs],
  );
  const checkoutTrial = (replaceTrialChoice ? mySubs.find((sub) => sub.id === replaceTrialChoice) : null) ?? activeTrial;
  const selectedTrialSubId = extendTarget?.id ?? replaceTrialChoice ?? activeTrial?.id ?? undefined;
  const checkoutIsTrial = extendTarget?.isTrial === true
    || convPreview?.subscription?.isTrial === true
    || convPreview?.subscription?.trialId != null
    || (!extendTarget && checkoutTrial != null);
  const checkoutTrialName = extendTarget?.trialName
    || convPreview?.subscription?.trialName
    || checkoutTrial?.trialName
    || extendTarget?.label
    || checkoutTrial?.label
    || convPreview?.subscription?.tariffName
    || options.trialBadgeLabel
    || "";
  const checkoutTariffName = selectedTariff?.name ?? options.tariffFallbackLabel ?? "";
  const duplicateSubscription = useMemo(() => {
    const matches = selectedTariffId ? mySubs.filter((sub) => sub.tariffId === selectedTariffId && !sub.isTrial) : [];
    return matches.length > 0
      ? [...matches].sort((a, b) => (b.expireAt ? Date.parse(b.expireAt) : 0) - (a.expireAt ? Date.parse(a.expireAt) : 0))[0]
      : null;
  }, [mySubs, selectedTariffId]);

  const requestedPreviewKey = `${selectedTariffId}:${selectedPriceOptionId ?? "base"}`;
  const previewTrialSubId = options.previewReplaceTrialSubId ? selectedTrialSubId : undefined;
  useEffect(() => {
    if (options.preview !== "manual" && extendTarget) {
      setConvPreview(null);
      setPreviewKey(null);
      setPreviewError(false);
      return;
    }
    if (!previewEnabled) {
      setConvPreview(null);
      setPreviewKey(null);
      setPreviewError(false);
      return;
    }
    if (!token || !selectedTariffId) {
      setConvPreview(null);
      return;
    }
    let alive = true;
    setConvKeepExtras(true);
    if (options.resetTrialChoiceOnPreview) setReplaceTrialChoice(null);
    setConvPreview(null);
    setPreviewKey(null);
    setPreviewError(false);
    api.clientTariffConversionPreview(token, {
      tariffId: selectedTariffId,
      priceOptionId: selectedPriceOptionId ?? undefined,
      ...(previewTrialSubId ? { replaceTrialSubId: previewTrialSubId } : {}),
    })
      .then((preview) => {
        if (alive) {
          setConvPreview(preview);
          setPreviewKey(requestedPreviewKey);
        }
      })
      .catch(() => {
        if (alive) {
          setConvPreview(null);
          setPreviewError(true);
        }
      });
    return () => {
      alive = false;
    };
  }, [
    previewEnabled,
    token,
    selectedTariffId,
    selectedPriceOptionId,
    previewTrialSubId,
    previewRetry,
    extendTarget,
    requestedPreviewKey,
    options.preview,
    options.resetTrialChoiceOnPreview,
  ]);

  const previewReady = Boolean(extendTarget) || (previewKey === requestedPreviewKey && !previewError);
  const retryPreview = useCallback(() => setPreviewRetry((value) => value + 1), []);

  const applyPromo = useCallback(async () => {
    if (!token || !promoInput.trim()) return;
    const code = promoInput.trim();
    setPromoBusy(true);
    setPromoMsg(null);
    if (optionsRef.current.clearPromoOnCheck) {
      setPromoApplied(null);
      setPromoInfo(null);
    }
    try {
      const result = await api.clientCheckPromoCode(token, code);
      if (result.type !== "DISCOUNT" && optionsRef.current.promoActivateOnNonDiscount) {
        await optionsRef.current.promoActivateOnNonDiscount(code, result);
        setPromoApplied(null);
        setPromoInfo(null);
        setPromoInput("");
        if (optionsRef.current.promoAppliedMessage === null) setPromoMsg(null);
        return;
      }
      setPromoApplied(code);
      setPromoInfo({
        percent: result.discountPercent ?? 0,
        fixed: result.discountFixed ?? 0,
        name: result.name ?? "",
      });
      setPromoMsg(optionsRef.current.promoAppliedMessage === undefined ? "Промокод применён" : optionsRef.current.promoAppliedMessage);
    } catch (error) {
      setPromoApplied(null);
      setPromoInfo(null);
      setPromoMsg(error instanceof Error ? error.message : optionsRef.current.promoInvalidMessage ?? "Промокод недействителен");
    } finally {
      setPromoBusy(false);
    }
  }, [token, promoInput]);

  const clearPromo = useCallback(() => {
    setPromoInput("");
    setPromoApplied(null);
    setPromoInfo(null);
    setPromoMsg(null);
  }, []);

  const extendExtrasFor = useCallback((tariff: PublicTariff, durationDays?: number, keep?: boolean) => {
    if (!extendTarget || extendTarget.extraDevices <= 0) return 0;
    if (!(keep ?? extKeepExtras)) return 0;
    if (extendTarget.tariffId && tariff.id && extendTarget.tariffId !== tariff.id) return 0;
    const tariffOptions = tariff.priceOptions ?? [];
    const option = (selectedPriceOptionId ? tariffOptions.find((item) => item.id === selectedPriceOptionId) : null) ?? tariffOptions[0];
    const targetDays = durationDays ?? option?.durationDays ?? tariff.durationDays ?? EXTRA_DEVICE_BASE_DAYS;
    return Math.round(extendTarget.extraDevicesMonthlyPrice * (Math.max(1, targetDays) / EXTRA_DEVICE_BASE_DAYS));
  }, [extendTarget, extKeepExtras, selectedPriceOptionId]);

  const prepareBalancePayment = useCallback(async (includeTrial = false) => {
    if (!token || !selectedTariffId) return null;
    setPaying(true);
    const preview = await api.clientTariffConversionPreview(token, {
      tariffId: selectedTariffId,
      priceOptionId: selectedPriceOptionId ?? undefined,
      ...(optionsRef.current.previewReplaceTrialSubId && selectedTrialSubId ? { replaceTrialSubId: selectedTrialSubId } : {}),
    }).catch(() => null);
    setPaying(false);
    const willReplace = Boolean(preview && preview.willConvert && (preview.mode !== "extend" || (preview.othersToRemove ?? 0) > 0));
    const isTrial = includeTrial && (
      extendTarget?.isTrial === true
      || (!extendTarget && checkoutTrial != null)
      || preview?.subscription?.isTrial === true
      || preview?.subscription?.trialId != null
    );
    return { preview, willReplace, isTrial };
  }, [token, selectedTariffId, selectedPriceOptionId, selectedTrialSubId, extendTarget, checkoutTrial]);

  const doPay = useCallback(async (payOptions: CabinetTariffPurchaseDoPayOptions = {}) => {
    const activeOptions = optionsRef.current;
    const method = payOptions.method ?? selectedMethod;
    if (!token || !selectedTariffId) return;
    if (activeOptions.requirePriceOption && !selectedPriceOptionId) return;
    if (activeOptions.requirePreview && !previewReady) return;
    if (!method) return;
    setPaying(true);
    setPayError(null);
    try {
      const base: TariffPaymentBase = { tariffId: selectedTariffId };
      if (selectedPriceOptionId) base.tariffPriceOptionId = selectedPriceOptionId;
      if (promoApplied) base.promoCode = promoApplied;
      if (activeOptions.deviceCount === "positive" && extraDevices > 0 && !extendTarget) base.deviceCount = extraDevices;
      if (activeOptions.deviceCount === "always") base.deviceCount = extraDevices;

      const convExtend = convPreview?.willConvert && convPreview.mode === "extend" ? convPreview.subscription : undefined;
      if (extendTarget) {
        base.extendsSecondarySubId = extendTarget.id;
        if (activeOptions.extrasOnExtendPayload === "always") base.removeExtrasOnActivate = !extKeepExtras;
        else if (extendTarget.extraDevices > 0 && !extKeepExtras) base.removeExtrasOnActivate = true;
      } else if (convExtend) {
        base.extendsSecondarySubId = convExtend.id;
        if ((convPreview?.extras?.extraDevices ?? 0) > 0 && !convKeepExtras) base.removeExtrasOnActivate = true;
      } else if (convPreview?.willConvert && (convPreview.extras?.extraDevices ?? 0) > 0 && !convKeepExtras) {
        base.removeExtrasOnActivate = true;
      }

      if (!extendTarget && !convExtend) {
        const additional = activeOptions.additional ?? "never";
        if (additional === "whenSubscriptions" && mySubs.length > 0) base.asAdditional = true;
        if (additional === "multiSubscriptions" && config?.multiSubscriptionsEnabled !== false && !convPreview?.willConvert && mySubs.length > 0) {
          base.asAdditional = true;
        }
      }

      if (activeOptions.trialReplacement === "convertible") {
        if (!extendTarget && selectedTrialSubId && (!convPreview?.willConvert
          || convPreview?.subscription?.isTrial === true
          || convPreview?.subscription?.trialId != null)) {
          base.replaceTrialSubId = selectedTrialSubId;
        }
      } else if (!extendTarget && !convPreview?.willConvert) {
        const trialSubId = replaceTrialChoice ?? ownedTrials[0]?.id;
        if (trialSubId) base.replaceTrialSubId = trialSubId;
      }

      const sendAmount = Boolean(activeOptions.sendAmount);
      const amountValues = sendAmount ? { amount: totalPrice, currency } : {};
      let url: string | null = null;
      let paymentId: string | null = null;

      if (method.kind === "platega") {
        const result = await api.clientCreatePlategaPayment(token, {
          ...base,
          ...amountValues,
          ...(sendAmount && selectedTariff ? { description: selectedTariff.name } : {}),
          paymentMethod: method.id,
        });
        url = result.paymentUrl;
        paymentId = result.paymentId;
      } else if (method.kind === "yookassa") {
        const result = await api.yookassaCreatePayment(token, {
          ...base,
          ...(sendAmount ? { amount: totalPrice, currency: "RUB" } : {}),
        });
        url = result.confirmationUrl;
        paymentId = result.paymentId;
      } else if (method.kind === "yoomoney") {
        const result = await api.yoomoneyCreateFormPayment(token, {
          ...base,
          ...(sendAmount ? { amount: totalPrice } : {}),
          paymentType: "AC",
        });
        url = result.paymentUrl;
        paymentId = result.paymentId;
      } else if (method.kind === "telegram_stars") {
        const result = await api.starsCreatePayment(token, { ...base, ...amountValues });
        url = result.payUrl;
        paymentId = result.paymentId;
      } else if (method.kind === "cryptopay") {
        const result = await api.cryptopayCreatePayment(token, { ...base, ...amountValues });
        url = result.miniAppPayUrl ?? result.webAppPayUrl ?? result.payUrl;
        paymentId = result.paymentId;
      } else if (method.kind === "heleket") {
        const result = await api.heleketCreatePayment(token, { ...base, ...amountValues });
        url = result.payUrl;
        paymentId = result.paymentId;
      } else if (method.kind === "cloudpayments") {
        const result = await api.cloudpaymentsCreatePayment(token, { ...base, ...amountValues });
        url = result.payUrl;
        paymentId = result.paymentId;
      } else if (method.kind === "paritypay") {
        const result = await api.paritypayCreatePayment(token, { ...base, ...amountValues });
        url = result.payUrl;
        paymentId = result.paymentId;
      } else if (method.kind === "rollypay") {
        const result = await api.rollypayCreatePayment(token, { ...base, ...amountValues });
        url = result.payUrl;
        paymentId = result.paymentId;
      } else if (method.kind === "cispay") {
        const result = await api.cispayCreatePayment(token, { ...base, ...amountValues });
        url = result.payUrl;
        paymentId = result.paymentId;
      } else if (method.kind === "lava") {
        const result = await api.lavaCreatePayment(token, { ...base, ...amountValues });
        url = result.payUrl;
        paymentId = result.paymentId;
      } else if (method.kind === "lavatop") {
        const result = await api.lavatopCreatePayment(token, { ...base, ...(sendAmount ? amountValues : { amount: finalPrice, currency }) });
        url = result.payUrl;
        paymentId = result.paymentId;
      } else if (method.kind === "overpay") {
        const result = await api.overpayCreatePayment(token, { ...base, ...(sendAmount ? amountValues : { amount: finalPrice, currency }) });
        url = result.payUrl;
        paymentId = result.paymentId;
      } else if (method.kind === "balance") {
        const balanceError = activeOptions.beforeBalancePay?.();
        if (balanceError) {
          setPayError(balanceError);
          return;
        }
        const result = await api.clientPayByBalance(token, base);
        await refreshProfile();
        clearPromo();
        if (activeOptions.onBalancePaid) {
          activeOptions.onBalancePaid(result);
          return;
        }
        navigate("/cabinet/dashboard?paid=balance");
        return;
      }

      if (url) {
        if (payOptions.onReadyUrl) {
          payOptions.onReadyUrl({ url, provider: method.label, paymentId: paymentId ?? undefined, kind: method.kind });
        } else {
          openPaymentInBrowser(url);
          if (paymentId && getTelegramWebApp()) {
            navigate(`/cabinet/payment-wait?id=${encodeURIComponent(paymentId)}&kind=tariff`, {
              state: { url, provider: method.label },
            });
          }
        }
      }
    } catch (error) {
      setPayError(error instanceof Error ? error.message : activeOptions.payErrorMessage ?? "Ошибка создания платежа");
    } finally {
      setPaying(false);
    }
  }, [
    token,
    selectedTariffId,
    selectedPriceOptionId,
    selectedMethod,
    previewReady,
    promoApplied,
    extraDevices,
    extendTarget,
    extKeepExtras,
    convPreview,
    convKeepExtras,
    mySubs.length,
    config?.multiSubscriptionsEnabled,
    selectedTrialSubId,
    replaceTrialChoice,
    ownedTrials,
    totalPrice,
    finalPrice,
    currency,
    selectedTariff,
    refreshProfile,
    clearPromo,
    navigate,
  ]);

  return {
    config,
    categories,
    displayCategories,
    currentCat,
    selectedTariff,
    priceOptions,
    selectedPriceOption,
    loading,
    catalogError,
    remnaAvailable,
    refetchCatalog,
    selectedCatId,
    setSelectedCatId,
    selectedTariffId,
    setSelectedTariffId,
    selectedPriceOptionId,
    setSelectedPriceOptionId,
    extraDevices,
    setExtraDevices,
    days,
    basePrice,
    extrasTotal,
    extrasDiscountPct,
    extendExtrasCost,
    keepExtrasCost,
    convExtendExtrasCost,
    extendExtrasFor,
    promoDiscount,
    personalDiscountPct,
    totalPrice,
    finalPrice,
    pricePerDay,
    currency,
    balance,
    canPayWithBalance,
    availableMethods,
    selectedMethod,
    setSelectedMethod,
    paying,
    payError,
    setPayError,
    doPay,
    prepareBalancePayment,
    mySubs,
    refreshSubscriptions,
    extendTarget,
    extKeepExtras,
    setExtKeepExtras,
    trialConversionBlocked,
    availableTrials,
    hasTrials,
    refetchTrials,
    ownedTrials,
    activeTrial,
    checkoutTrial,
    checkoutIsTrial,
    checkoutTrialName,
    checkoutTariffName,
    duplicateSubscription,
    replaceTrialChoice,
    setReplaceTrialChoice,
    convPreview,
    convKeepExtras,
    setConvKeepExtras,
    previewReady,
    previewError,
    retryPreview,
    setPreviewEnabled,
    promoInput,
    setPromoInput,
    promoApplied,
    promoInfo,
    promoMsg,
    setPromoMsg,
    promoBusy,
    applyPromo,
    clearPromo,
  };
}
