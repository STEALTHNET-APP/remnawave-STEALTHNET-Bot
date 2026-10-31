import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { Wallet, Bitcoin, Check, Loader2, RefreshCw, ArrowRight } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { api, type PublicTariff, type PublicTariffCategory, type PublicConfig, type TariffConversionPreview } from "@/lib/api";
import { cn } from "@/lib/utils";
import { AuroraSheet } from "@/components/aurora/aurora-sheet";
import { AuroraConfirmSheet } from "@/components/aurora/aurora-confirm-sheet";
import { AuButton, AuNotice } from "@/components/aurora/aurora-ui";
import { AuroraTariffCard, auroraPrice, auroraPeriodLabel, auroraTraffic, auroraDevices } from "./aurora-tariff-card";

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
  | { kind: "telegram_stars"; label: string; icon: typeof Bitcoin }
  | { kind: "cryptopay"; label: string; icon: typeof Bitcoin }
  | { kind: "heleket"; label: string; icon: typeof Bitcoin }
  | { kind: "rollypay"; label: string; icon: typeof Wallet }
  | { kind: "paritypay"; label: string; icon: typeof Wallet }
  | { kind: "cloudpayments"; label: string; icon: typeof Wallet }
  | { kind: "lava"; label: string; icon: typeof Wallet }
  | { kind: "overpay"; label: string; icon: typeof Wallet }
  | { kind: "lavatop"; label: string; icon: typeof Wallet }
  | { kind: "balance"; label: string; icon: typeof Wallet };

const fmtPrice = auroraPrice;

function fmtPricePerDay(n: number, currency: string) {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: currency.toUpperCase(), minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

export function AuroraTariffs() {
  const { t, i18n } = useTranslation();
  const { state, refreshProfile } = useClientAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const extendParam = searchParams.get("extend");
  const [extendTarget, setExtendTarget] = useState<{ id: string; label: string; tariffId: string | null; isTrial: boolean; convertTariffIds: string[]; trialConvertAllTariffs: boolean; extraDevices: number; extraDevicesMonthlyPrice: number } | null>(null);
  const [extKeepExtras, setExtKeepExtras] = useState(true);

  const [categories, setCategories] = useState<PublicTariffCategory[]>([]);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [loading, setLoading] = useState(true);

  const [selectedCatId, setSelectedCatId] = useState<string | null>(null);
  const [selectedTariffId, setSelectedTariffId] = useState<string | null>(null);
  const [selectedPriceOptionId, setSelectedPriceOptionId] = useState<string | null>(null);

  const promoLocation = useLocation();
  const [promoInput, setPromoInput] = useState(() => typeof promoLocation.state?.promoCode === "string" ? promoLocation.state.promoCode : "");
  const [promoApplied, setPromoApplied] = useState<string | null>(null);
  const [promoInfo, setPromoInfo] = useState<{ percent: number; fixed: number; name: string } | null>(null);
  const [promoMsg, setPromoMsg] = useState<string | null>(null);
  const [promoBusy, setPromoBusy] = useState(false);
  const [extraDevices, setExtraDevices] = useState(0);

  const [selectedMethod, setSelectedMethod] = useState<PayMethod | null>(null);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [convPreview, setConvPreview] = useState<TariffConversionPreview | null>(null);
  const [convKeepExtras, setConvKeepExtras] = useState(true);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [previewRetry, setPreviewRetry] = useState(0);
  const [balConfirm, setBalConfirm] = useState<{ title: string; body: string } | null>(null);
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
      if (cats.length > 0) {
        setSelectedCatId(cats[0].id);
        const firstTariff = cats[0].tariffs[0];
        if (firstTariff) {
          setSelectedTariffId(firstTariff.id);
          const opts = (firstTariff as TariffLite).priceOptions ?? [];
          if (opts.length > 0) {
            const def = opts.find((o) => o.durationDays === 30) ?? opts[0];
            setSelectedPriceOptionId(def.id);
          }
        }
      }
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const [mySubs, setMySubs] = useState<{ id: string; label: string; tariffId: string | null; expireAt: string | null; isTrial: boolean; trialName: string | null }[]>([]);
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
          label: it.tariffDisplayName?.trim() || t("aurora.subscription_index", { index: it.subscriptionIndex ?? 0 }),
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
        label: it.tariffDisplayName?.trim() || t("aurora.subscription_index", { index: idx }),
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
  }, [extendParam, state.token, t]);

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
    return filtered.length > 0 ? filtered : categories;
  }, [categories, extendTarget]);

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

  const currentCat = selectedCatId === "__all"
    ? { id: "__all", name: t("aurora.all_categories"), emojiKey: null, emoji: "", tariffs: displayCategories.flatMap((category) => category.tariffs) } as PublicTariffCategory
    : displayCategories.find((c) => c.id === selectedCatId) ?? displayCategories[0];
  const currentTariff = currentCat?.tariffs.find((t) => t.id === selectedTariffId) as TariffLite | undefined;
  const priceOptions: PriceOption[] = currentTariff?.priceOptions ?? [];
  const currentOption = priceOptions.find((o) => o.id === selectedPriceOptionId);
  const basePrice = currentOption?.price ?? currentTariff?.price ?? 0;
  const days = currentOption?.durationDays ?? currentTariff?.durationDays ?? 30;
  const extendExtrasCost = extendTarget && extKeepExtras && extendTarget.extraDevices > 0
    ? Math.round(extendTarget.extraDevicesMonthlyPrice * (Math.max(1, days) / 30))
    : 0;
  const convExtendExtrasCost = !extendTarget && convPreview?.mode === "extend" && convKeepExtras && (convPreview.extras?.extraDevices ?? 0) > 0
    ? Math.round((convPreview.extras?.extraDevicesMonthlyPrice ?? 0) * (Math.max(1, days) / 30))
    : 0;
  const extrasCost = (() => {
    if (extendTarget || !currentTariff || extraDevices <= 0) return 0;
    const perDevice = currentTariff.pricePerExtraDevice ?? 0;
    if (perDevice <= 0) return 0;
    const tiers = [...(currentTariff.deviceDiscountTiers ?? [])].sort((a, b) => b.minExtraDevices - a.minExtraDevices);
    const tier = tiers.find((t) => extraDevices >= t.minExtraDevices);
    const percent = tier?.discountPercent ?? 0;
    const monthly = (perDevice * extraDevices * (100 - percent)) / 100;
    return Math.round(monthly * (Math.max(1, days) / 30) * 100) / 100;
  })();
  const promoDiscount = (() => {
    if (!promoInfo) return 0;
    const gross = basePrice + extrasCost;
    const raw = promoInfo.percent > 0 ? (gross * promoInfo.percent) / 100 : promoInfo.fixed;
    return Math.min(gross, Math.max(0, Math.round(raw * 100) / 100));
  })();
  const totalPrice = Math.max(0, basePrice + extrasCost + extendExtrasCost + convExtendExtrasCost - promoDiscount);
  const pricePerDay = days > 0 ? totalPrice / days : 0;
  const currency = currentTariff?.currency ?? "rub";
  const requestedPreviewKey = `${selectedTariffId}:${selectedPriceOptionId ?? "base"}`;
  const previewReady = !!extendTarget || (previewKey === requestedPreviewKey && !previewError);

  const availableMethods: PayMethod[] = useMemo(() => {
    if (!config) return [];
    const list: PayMethod[] = [];
    (config.plategaMethods ?? []).forEach((m) => {
      list.push({ kind: "platega", id: m.id, label: m.label, icon: Wallet });
    });
    if (config.yookassaEnabled) list.push({ kind: "yookassa", label: t("aurora.payment_card_sbp"), icon: Wallet });
    if (config.yoomoneyEnabled) list.push({ kind: "yoomoney", label: "YooMoney", icon: Wallet });
    if (config.telegramStarsEnabled && currency.toUpperCase() === "RUB") list.push({ kind: "telegram_stars", label: "⭐ Telegram Stars", icon: Wallet });
    if (config.cryptopayEnabled) list.push({ kind: "cryptopay", label: "Crypto Pay", icon: Bitcoin });
    if (config.heleketEnabled) list.push({ kind: "heleket", label: "Heleket", icon: Bitcoin });
    if ((config as { rollypayEnabled?: boolean }).rollypayEnabled) list.push({ kind: "rollypay", label: "RollyPay", icon: Wallet });
    if ((config as { cloudpaymentsEnabled?: boolean }).cloudpaymentsEnabled) list.push({ kind: "cloudpayments", label: "CloudPayments", icon: Wallet });
if ((config as { paritypayEnabled?: boolean }).paritypayEnabled) list.push({ kind: "paritypay", label: "ParityPay", icon: Wallet });
    if (config.lavaEnabled) list.push({ kind: "lava", label: "Lava", icon: Wallet });
    if (config.lavatopEnabled) list.push({ kind: "lavatop", label: "Lava.top", icon: Wallet });
    if (config.overpayEnabled) list.push({ kind: "overpay", label: "Overpay", icon: Wallet });
    return list;
  }, [config, currency, t]);

  useEffect(() => {
    if (!selectedMethod && availableMethods.length > 0) {
      setSelectedMethod(availableMethods[0]);
    }
  }, [availableMethods, selectedMethod]);

  useEffect(() => {
    setExtraDevices(0);
  }, [selectedTariffId, selectedPriceOptionId]);

  useEffect(() => {
    refreshProfile().catch(() => {});
  }, []);

  const balance = state.client?.balance ?? 0;
  const canPayByBalance = balance >= totalPrice && totalPrice > 0;

  useEffect(() => {
    if (selectedMethod?.kind === "balance" && !canPayByBalance) {
      setSelectedMethod(availableMethods[0] ?? null);
    }
  }, [canPayByBalance]);

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

  async function applyPromo() {
    if (!state.token || !promoInput.trim()) return;
    setPromoBusy(true);
    setPromoMsg(null);
    try {
      const res = await api.clientCheckPromoCode(state.token, promoInput.trim());
      setPromoApplied(promoInput.trim());
      setPromoInfo({
        percent: res.discountPercent ?? 0,
        fixed: res.discountFixed ?? 0,
        name: res.name ?? "",
      });
      setPromoMsg(t("aurora.promo_applied"));
    } catch (e) {
      setPromoApplied(null);
      setPromoInfo(null);
      setPromoMsg(e instanceof Error ? e.message : t("aurora.promo_invalid"));
    } finally {
      setPromoBusy(false);
    }
  }

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
        const subName = prev!.subscription?.tariffName ? `«${prev!.subscription.tariffName}»` : t("aurora.balance_current_subscription");
        const bodyMain = prev!.mode === "replace"
          ? t("aurora.balance_replace_body", { remaining: prev!.remainingDays ?? 0, purchased: prev!.purchasedDays ?? 0 })
          : prev!.mode === "extend"
            ? t("aurora.balance_extend_body")
            : t("aurora.balance_convert_body", { remaining: prev!.remainingDays ?? 0, converted: prev!.convertedDays ?? 0 });
        const othersLine = (prev!.othersToRemove ?? 0) > 0 ? `\n${t("aurora.balance_others", { count: prev!.othersToRemove ?? 0 })}` : "";
        setBalConfirm({
          title: prev!.mode === "extend"
            ? t("aurora.balance_extend_title", { name: subName })
            : t("aurora.balance_replace_title", { name: subName }),
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
        ...(extraDevices > 0 && !extendTarget ? { deviceCount: extraDevices } : {}),
        ...(config?.multiSubscriptionsEnabled !== false && !extendTarget && !convPreview?.willConvert && mySubs.length > 0 ? { asAdditional: true } : {}),
        ...(extendTarget ? { extendsSecondarySubId: extendTarget.id } : {}),
        ...(extendTarget && extendTarget.extraDevices > 0 && !extKeepExtras
          ? { removeExtrasOnActivate: true }
          : {}),
        ...(!extendTarget && convPreview?.mode === "extend" && convPreview.subscription
          ? {
              extendsSecondarySubId: convPreview.subscription.id,
              ...(((convPreview.extras?.extraDevices ?? 0) > 0 && !convKeepExtras) ? { removeExtrasOnActivate: true } : {}),
            }
          : {}),
        ...(convPreview?.willConvert && convPreview.mode !== "extend" && (convPreview.extras?.extraDevices ?? 0) > 0 && !convKeepExtras
          ? { removeExtrasOnActivate: true }
          : {}),
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
      } else if (selectedMethod.kind === "telegram_stars") {
        const r = await api.starsCreatePayment(state.token, base);
        url = r.payUrl;
      } else if (selectedMethod.kind === "cryptopay") {
        const r = await api.cryptopayCreatePayment(state.token, base);
        url = r.miniAppPayUrl ?? r.webAppPayUrl ?? r.payUrl;
      } else if (selectedMethod.kind === "heleket") {
        const r = await api.heleketCreatePayment(state.token, base);
        url = r.payUrl;
      } else if (selectedMethod.kind === "cloudpayments") {
        const r = await api.cloudpaymentsCreatePayment(state.token, base);
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
      setPayError(e instanceof Error ? e.message : t("aurora.pay_error"));
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
      <div className="au-card p-6 text-center">
        <p className="text-[15px] font-semibold">{t("aurora.tariffs_empty")}</p>
        <p className="mt-1 text-[13px] text-[var(--au-muted)]">{t("aurora.tariffs_empty_hint")}</p>
      </div>
    );
  }

  const noticeCls = (tone: "accent" | "amber") =>
    cn(
      "rounded-[20px] p-4",
      tone === "amber" ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : "bg-[color-mix(in_srgb,var(--au-from)_9%,var(--au-bg))]",
    );

  const choiceCls = (active: boolean) =>
    cn(
      "w-full rounded-[16px] border-2 bg-[var(--au-surface)] text-[var(--au-ink)] p-3 text-left transition-colors",
      active ? "border-[var(--au-from)]" : "border-transparent",
    );

  const renewalNotice = (<>
    {extendTarget && (
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className={noticeCls("accent")}
      >
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--au-from)]">
            <RefreshCw className="h-4 w-4 text-white" />
          </span>
          <div className="min-w-0">
            <p className="text-[14px] font-bold">{t("aurora.renewal_title")}</p>
            <p className="truncate text-[12.5px] text-[var(--au-muted)]">{extendTarget.label}</p>
          </div>
        </div>
        {extendTarget.extraDevices > 0 && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setExtKeepExtras(true)} className={choiceCls(extKeepExtras)}>
              <p className="text-[13px] font-bold">{t("aurora.renewal_extra_devices", { count: extendTarget.extraDevices })}</p>
              <p className="mt-0.5 text-[12px] text-[var(--au-muted)]">
                {t("aurora.renewal_keep", { price: fmtPrice(Math.round(extendTarget.extraDevicesMonthlyPrice * (Math.max(1, days) / 30)), currency) })}
              </p>
            </button>
            <button type="button" onClick={() => setExtKeepExtras(false)} className={choiceCls(!extKeepExtras)}>
              <p className="text-[13px] font-bold">{t("aurora.renewal_remove")}</p>
              <p className="mt-0.5 text-[12px] text-[var(--au-muted)]">{t("aurora.renewal_remove_hint")}</p>
            </button>
          </div>
        )}
      </motion.section>
    )}
  </>);

  const purchaseNotices = (<>
    {!extendTarget && !convPreview?.willConvert && (() => {
      const trialsOwned = mySubs.filter((s) => s.isTrial);
      if (trialsOwned.length === 0) return null;
      const chosen = replaceTrialChoice ?? trialsOwned[0].id;
      return (
        <section className={noticeCls("amber")}>
          <p className="text-[14px] font-bold">
            {trialsOwned.length === 1 ? t("aurora.trial_replace_one") : t("aurora.trial_replace_many")}
          </p>
          <p className="mt-1 text-[13px] leading-relaxed opacity-80">{t("aurora.trial_replace_hint")}</p>
          {trialsOwned.length > 1 && (
            <div className="mt-2.5 space-y-2">
              {trialsOwned.map((tr) => (
                <button key={tr.id} type="button" onClick={() => setReplaceTrialChoice(tr.id)} className={choiceCls(chosen === tr.id)}>
                  <span className="text-[13px] font-semibold">
                    {tr.trialName ?? tr.label}
                    {tr.expireAt ? ` — ${t("aurora.trial_until", { date: new Date(tr.expireAt).toLocaleDateString(i18n.language) })}` : ""}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      );
    })()}

    {!extendTarget && !convPreview?.willConvert && (() => {
      const matches = selectedTariffId ? mySubs.filter((s) => s.tariffId === selectedTariffId && !s.isTrial) : [];
      const dup = matches.length > 0
        ? [...matches].sort((a, b) => (b.expireAt ? Date.parse(b.expireAt) : 0) - (a.expireAt ? Date.parse(a.expireAt) : 0))[0]
        : null;
      if (!dup) return null;
      return (
        <section className={noticeCls("accent")}>
          <p className="text-[14px] font-bold">{t("aurora.duplicate_title")}</p>
          <p className="mt-1 text-[13px] leading-relaxed opacity-80">
            {t("aurora.duplicate_text", {
              label: dup.label,
              until: dup.expireAt ? t("aurora.duplicate_until", { date: new Date(dup.expireAt).toLocaleDateString(i18n.language) }) : "",
              action: config?.multiSubscriptionsEnabled ? t("aurora.duplicate_extend_multi") : t("aurora.duplicate_extend_single"),
            })}
          </p>
          <button
            onClick={() => { setPaySheet(false); navigate(`/cabinet/tariffs?extend=${encodeURIComponent(dup.id)}`); }}
            className="mt-3 inline-flex items-center gap-2 rounded-[14px] bg-[var(--au-surface)] px-4 py-2.5 text-[13px] font-bold text-[var(--au-ink)] transition-transform active:scale-95"
          >
            <RefreshCw className="h-4 w-4" />
            {t("aurora.duplicate_extend", { label: dup.label })}
          </button>
        </section>
      );
    })()}

    {convPreview?.willConvert && convPreview.subscription && (
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className={noticeCls("accent")}
      >
        <div className="flex items-start gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--au-from)]">
            <RefreshCw className="h-4 w-4 text-white" />
          </span>
          <div className="min-w-0 space-y-1.5">
            <p className="text-[14px] font-bold">
              {convPreview.mode === "extend"
                ? t("aurora.convert_extend_title")
                : convPreview.mode === "replace"
                  ? t("aurora.convert_replace_title")
                  : convPreview.subscription.isTrial ? t("aurora.convert_trial_title") : t("aurora.convert_update_title")}
            </p>
            <p className="text-[13px] leading-relaxed text-[var(--au-muted)]">
              {convPreview.mode === "extend"
                ? t("aurora.convert_extend_body", {
                    remaining: convPreview.remainingDays ?? 0,
                    purchased: convPreview.purchasedDays ?? 0,
                    total: convPreview.totalDays ?? 0,
                  })
                : convPreview.mode === "replace"
                  ? t("aurora.convert_replace_body", {
                      name: convPreview.subscription.tariffName ? t("aurora.convert_name", { name: convPreview.subscription.tariffName }) : "",
                      remaining: convPreview.remainingDays ?? 0,
                      purchased: convPreview.purchasedDays ?? 0,
                    })
                  : t("aurora.convert_update_body", {
                      name: convPreview.subscription.tariffName ? t("aurora.convert_name", { name: convPreview.subscription.tariffName }) : t("aurora.convert_update_current"),
                      days: (convPreview.convertedDays ?? 0) > 0 && (convPreview.remainingDays ?? 0) > 0 && !(convPreview.extras && convPreview.extras.extraDevices > 0)
                        ? t("aurora.convert_update_days", { remaining: convPreview.remainingDays, converted: convPreview.convertedDays })
                        : "",
                    })}
            </p>
            {(convPreview.othersToRemove ?? 0) > 0 && (
              <p className="text-[13px] font-bold text-amber-700 dark:text-amber-300">
                {t("aurora.convert_others", { count: convPreview.othersToRemove })}
              </p>
            )}
            {convPreview.mode !== "extend" && (convPreview.extras?.extraDevices ?? 0) === 0 && (convPreview.totalDays ?? 0) > 0 && (
              <p className="text-[13px] font-bold text-[var(--au-from)]">{t("aurora.convert_total", { days: convPreview.totalDays })}</p>
            )}

            {convPreview.mode === "extend" && convPreview.extras && convPreview.extras.extraDevices > 0 && (
              <div className="space-y-2 pt-1">
                <p className="text-[13px] font-bold">{t("aurora.extras_question", { count: convPreview.extras.extraDevices })}</p>
                <button type="button" onClick={() => setConvKeepExtras(true)} className={choiceCls(convKeepExtras)}>
                  <p className="text-[13px] font-bold">{t("aurora.extras_keep", { price: fmtPrice(convPreview.extras.keep.extraCost ?? 0, currency) })}</p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--au-muted)]">
                    {t("aurora.extras_keep_hint", { count: convPreview.extras.keep.totalDevices })}
                  </p>
                </button>
                <button type="button" onClick={() => setConvKeepExtras(false)} className={choiceCls(!convKeepExtras)}>
                  <p className="text-[13px] font-bold">{t("aurora.extras_drop")}</p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--au-muted)]">
                    {t("aurora.extras_drop_hint", { count: convPreview.extras.drop.totalDevices })}
                  </p>
                </button>
              </div>
            )}

            {convPreview.mode !== "extend" && convPreview.extras && convPreview.extras.extraDevices > 0 && (
              <div className="space-y-2 pt-1">
                <p className="text-[13px] font-bold">{t("aurora.extras_question", { count: convPreview.extras.extraDevices })}</p>
                <button type="button" onClick={() => setConvKeepExtras(true)} className={choiceCls(convKeepExtras)}>
                  <p className="text-[13px] font-bold">{t("aurora.extras_keep_plain")}</p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--au-muted)]">
                    {t("aurora.extras_keep_plain_hint", {
                      count: convPreview.extras.keep.totalDevices,
                      included: convPreview.extras.newIncludedDevices,
                      extra: convPreview.extras.extraDevices,
                      days: convPreview.extras.keep.convertedDays,
                      total: convPreview.extras.keep.totalDays,
                    })}
                  </p>
                </button>
                <button type="button" onClick={() => setConvKeepExtras(false)} className={choiceCls(!convKeepExtras)}>
                  <p className="text-[13px] font-bold">{t("aurora.extras_drop_plain")}</p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--au-muted)]">
                    {t("aurora.extras_drop_plain_hint", {
                      count: convPreview.extras.drop.totalDevices,
                      days: convPreview.extras.drop.convertedDays,
                      total: convPreview.extras.drop.totalDays,
                    })}
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
        <h1 className="text-[26px] font-extrabold leading-tight tracking-tight text-[var(--au-ink)]">{t("aurora.tariffs")}</h1>
        <p className="mt-0.5 text-[14px] text-[var(--au-muted)]">
          {extendTarget ? t("aurora.renewal_subtitle") : t("aurora.tariffs_subtitle")}
        </p>
      </header>

      {renewalNotice}

      <div className="au-tariff-catalog" data-tour="tariff-list">
        <nav className="au-tariff-categories" aria-label={t("aurora.categories_label")}>
          {displayCategories.length > 1 && <button type="button" aria-pressed={currentCat?.id === "__all"} aria-controls="au-category-plans" onClick={() => setSelectedCatId("__all")}>
            <span>{t("aurora.all_categories")}</span><small>{displayCategories.reduce((total, category) => total + category.tariffs.length, 0)}</small>
          </button>}
          {displayCategories.map((category) => <button key={category.id} type="button" aria-pressed={currentCat?.id === category.id} aria-controls="au-category-plans" onClick={() => setSelectedCatId(category.id)}>
            <span>{category.emoji ? `${category.emoji} ` : ""}{category.name}</span><small>{category.tariffs.length}</small>
          </button>)}
        </nav>
        {currentCat && <section id="au-category-plans" aria-labelledby="au-category-title" className="space-y-4 min-w-0">
          <div className="au-tariff-category-heading"><h2 id="au-category-title">{currentCat.name}</h2><span>{t("aurora.tariffs_count", { count: currentCat.tariffs.length })}</span></div>
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

      <AuroraConfirmSheet
        open={balConfirm !== null}
        onClose={() => setBalConfirm(null)}
        title={balConfirm?.title ?? ""}
        description={balConfirm && (
          <span className="whitespace-pre-line">
            {balConfirm.body}
            {"\n"}
            {t("aurora.checkout_charge_confirm", { amount: fmtPrice(totalPrice, currency) })}
          </span>
        )}
        confirmLabel={t("aurora.checkout_continue")}
        loading={paying}
        onConfirm={() => { setBalConfirm(null); void doPay(); }}
      />

      <AuroraSheet
        open={paySheet && !!currentTariff}
        onClose={() => { setPaySheet(false); setPayError(null); }}
        title={t("aurora.checkout_title")}
        footer={
          <div className="space-y-2 pb-1">
            {payError && <AuNotice tone="error">{payError}</AuNotice>}
            <AuButton
              onClick={pay}
              disabled={paying || !selectedMethod || !currentTariff || !previewReady}
              loading={paying}
            >
              {paying ? t("aurora.pay_creating") : t("aurora.pay_for", { amount: fmtPrice(totalPrice, currency) })}
            </AuButton>
          </div>
        }
      >
        <div className="space-y-4 pb-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[12px] text-[var(--au-muted)]">{t("aurora.checkout_tariff")}</p>
              <p className="mt-0.5 break-words text-[18px] font-extrabold text-[var(--au-ink)]">{currentTariff?.name ?? t("aurora.checkout_tariff_fallback")}</p>
              <p className="mt-1 text-[13px] text-[var(--au-muted)]">
                {auroraPeriodLabel(days, t)} · {t("aurora.checkout_per_day", { price: fmtPricePerDay(pricePerDay, currency) })}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[12px] text-[var(--au-muted)]">{t("aurora.checkout_total")}</p>
              <p className="mt-0.5 text-[24px] font-extrabold tabular-nums text-[var(--au-ink)]">{fmtPrice(totalPrice, currency)}</p>
            </div>
          </div>

          {currentTariff && <dl className="au-tariff-checkout-facts">
            <div><dt>{t("aurora.checkout_devices_in_plan")}</dt><dd>{auroraDevices(currentTariff, t)}</dd></div>
            <div><dt>{t("aurora.traffic")}</dt><dd>{auroraTraffic(currentTariff, t).value}</dd></div>
          </dl>}

          {!extendTarget && currentTariff && (currentTariff.maxExtraDevices ?? 0) > 0 && (
            <div className="flex items-center justify-between gap-3 rounded-[18px] bg-[var(--au-surface)] px-4 py-3">
              <div className="min-w-0">
                <p className="text-[13.5px] font-semibold">{t("aurora.checkout_extra_devices")}</p>
                <p className="text-[11.5px] text-[var(--au-muted)]">{extrasCost > 0 ? `+${fmtPrice(extrasCost, currency)}` : t("aurora.checkout_extra_devices_hint")}</p>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" aria-label={t("aurora.checkout_less_devices")} onClick={() => setExtraDevices((value) => Math.max(0, value - 1))} className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--au-bg)] text-[18px] font-bold">−</button>
                <span className="w-6 text-center text-[15px] font-extrabold tabular-nums">{extraDevices}</span>
                <button type="button" aria-label={t("aurora.checkout_more_devices")} onClick={() => setExtraDevices((value) => Math.min(currentTariff.maxExtraDevices ?? 0, value + 1))} className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--au-bg)] text-[18px] font-bold">+</button>
              </div>
            </div>
          )}

          <dl className="au-tariff-checkout-breakdown">
            <div><dt>{t("aurora.checkout_plan_line", { period: auroraPeriodLabel(days, t) })}</dt><dd>{fmtPrice(basePrice, currency)}</dd></div>
            {extrasCost > 0 && <div><dt>{t("aurora.checkout_extra_line")}</dt><dd>+{fmtPrice(extrasCost, currency)}</dd></div>}
            {promoDiscount > 0 && <div><dt>{t("aurora.checkout_promo_line")}</dt><dd>−{fmtPrice(promoDiscount, currency)}</dd></div>}
            {(extendExtrasCost + convExtendExtrasCost) > 0 && <div><dt>{t("aurora.checkout_saved_line")}</dt><dd>+{fmtPrice(extendExtrasCost + convExtendExtrasCost, currency)}</dd></div>}
          </dl>

          <div>
            {extendTarget ? renewalNotice : previewReady ? purchaseNotices : previewError ? (
              <div role="alert" className="rounded-[18px] bg-[var(--au-surface)] p-4 text-[13px]">
                <p>{t("aurora.checkout_check_failed")}</p>
                <button type="button" className="mt-3 min-h-11 rounded-xl bg-[var(--au-bg)] px-4 font-bold" onClick={() => setPreviewRetry((value) => value + 1)}>{t("aurora.checkout_retry")}</button>
              </div>
            ) : (
              <p role="status" className="flex items-center gap-2 text-[13px] text-[var(--au-muted)]">
                <Loader2 className="h-4 w-4 animate-spin" />{t("aurora.checkout_checking")}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 rounded-[18px] bg-[var(--au-surface)] p-1.5">
            <input
              value={promoInput}
              onChange={(e) => { setPromoInput(e.target.value); setPromoMsg(null); }}
              placeholder={t("aurora.promo_placeholder")}
              className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-[16px] text-[var(--au-ink)] outline-none placeholder:text-[var(--au-muted)]"
            />
            <button
              onClick={applyPromo}
              disabled={promoBusy || !promoInput.trim()}
              className="shrink-0 whitespace-nowrap rounded-[13px] bg-[var(--au-bg)] px-4 py-2.5 text-[13px] font-bold text-[var(--au-ink)] transition disabled:opacity-45"
            >
              {promoBusy ? "…" : promoApplied ? <Check className="inline h-4 w-4 text-emerald-500" /> : <span className="inline-flex items-center gap-1">{t("aurora.promo_check")}<ArrowRight className="h-3.5 w-3.5" /></span>}
            </button>
          </div>
          {promoMsg && (
            <p className={cn("px-1 text-[13px]", promoApplied ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>{promoMsg}</p>
          )}

          <div className="space-y-2">
            <p className="px-1 text-[13px] font-semibold text-[var(--au-muted)]">{t("aurora.pay_method")}</p>
            {availableMethods.length > 0 ? (
              <div className="grid grid-cols-2 gap-2.5">
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
                        "flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-[18px] border-2 px-3 py-3 transition-colors active:scale-[0.97]",
                        active
                          ? "border-[var(--au-from)] bg-[color-mix(in_srgb,var(--au-from)_8%,var(--au-surface))]"
                          : "border-transparent bg-[var(--au-surface)]",
                      )}
                    >
                      <Icon className={cn("h-[21px] w-[21px]", active ? "text-[var(--au-from)]" : "text-[var(--au-muted)]")} />
                      <span className={cn("text-[12.5px] font-bold leading-tight", active ? "text-[var(--au-ink)]" : "text-[var(--au-muted)]")}>{m.label}</span>
                    </button>
                  );
                })}
                {state.client && (
                  <button
                    type="button"
                    onClick={() => canPayByBalance && setSelectedMethod({ kind: "balance", label: t("aurora.checkout_balance_tile", { amount: fmtPrice(balance, currency) }), icon: Wallet })}
                    disabled={!canPayByBalance}
                    className={cn(
                      "flex min-h-[76px] flex-col items-center justify-center gap-1 rounded-[18px] border-2 px-3 py-3 transition-colors enabled:active:scale-[0.97]",
                      selectedMethod?.kind === "balance"
                        ? "border-emerald-500 bg-emerald-500/10"
                        : canPayByBalance
                          ? "border-transparent bg-[var(--au-surface)]"
                          : "cursor-not-allowed border-transparent bg-[var(--au-surface)] opacity-55",
                    )}
                  >
                    <Wallet className={cn("h-[21px] w-[21px]", selectedMethod?.kind === "balance" ? "text-emerald-500" : "text-[var(--au-muted)]")} />
                    <span className={cn("text-[12.5px] font-bold", selectedMethod?.kind === "balance" ? "text-[var(--au-ink)]" : "text-[var(--au-muted)]")}>{t("aurora.checkout_balance")}</span>
                    <span className={cn("text-[11px] font-semibold tabular-nums", canPayByBalance ? "text-emerald-600 dark:text-emerald-400" : "text-[var(--au-muted)]")}>
                      {canPayByBalance ? fmtPrice(balance, currency) : t("aurora.checkout_insufficient", { amount: fmtPrice(balance, currency) })}
                    </span>
                  </button>
                )}
              </div>
            ) : (
              <div className="rounded-[18px] bg-[var(--au-surface)] p-4 text-center text-[13px] text-[var(--au-muted)]">
                {t("aurora.checkout_no_methods")}
              </div>
            )}
          </div>
        </div>
      </AuroraSheet>
    </div>
  );
}
