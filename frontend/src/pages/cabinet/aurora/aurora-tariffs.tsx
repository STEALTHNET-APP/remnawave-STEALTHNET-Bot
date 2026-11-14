import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { Wallet, Check, Gift, Loader2, RefreshCw, ArrowRight, Tag } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import type { PublicTariffCategory } from "@/lib/api";
import { cn } from "@/lib/utils";
import { AuroraSheet } from "@/components/aurora/aurora-sheet";
import { AuroraTrialsSheet } from "@/components/aurora/aurora-trials-sheet";
import { AuButton, AuNotice } from "@/components/aurora/aurora-ui";
import { AuroraTariffCard, auroraPeriodLabel, auroraTraffic, auroraDevices } from "./aurora-tariff-card";
import { formatMoney, formatMoneyPerDay, useCabinetTariffPurchase } from "../use-cabinet-tariff-purchase";

const fmtPrice = (amount: number, currency: string) => formatMoney(amount, currency, "aurora");
const fmtPricePerDay = (amount: number, currency: string) => formatMoneyPerDay(amount, currency, "aurora");

export function AuroraTariffs() {
  const { t, i18n } = useTranslation();
  const { state, refreshProfile } = useClientAuth();
  const navigate = useNavigate();
  const [trialsSheetOpen, setTrialsSheetOpen] = useState(false);
  const [paySheet, setPaySheet] = useState(false);
  const [balConfirm, setBalConfirm] = useState<{ title: string; body: string } | null>(null);

  const {
    config,
    categories,
    displayCategories,
    selectedTariff: currentTariff,
    loading,
    selectedCatId,
    setSelectedCatId,
    selectedTariffId,
    setSelectedTariffId,
    setSelectedPriceOptionId,
    extraDevices,
    setExtraDevices,
    days,
    basePrice,
    extrasTotal,
    extendExtrasCost,
    keepExtrasCost,
    convExtendExtrasCost,
    promoDiscount,
    personalDiscountPct,
    personalDiscountAmount,
    hasPersonalDiscount,
    totalPrice,
    finalPrice,
    pricePerDay,
    currency,
    balance,
    canPayWithBalance: canPayByBalance,
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
    promoMsg,
    setPromoMsg,
    promoBusy,
    applyPromo,
    clearPromo,
  } = useCabinetTariffPurchase({
    subLabel: (index) => t("aurora.subscription_index", { index }),
    autoSelectFirst: true,
    autoSelectExtended: "withTrialConversion",
    extras: true,
    resetExtrasOnSelection: true,
    promoDiscount: "plan",
    promoAppliedMessage: t("aurora.promo_applied"),
    promoInvalidMessage: t("aurora.promo_invalid"),
    additional: "multiSubscriptions",
    deviceCount: "positive",
    trialReplacement: "convertible",
    trialConversionGuard: true,
    preview: "manual",
    previewReplaceTrialSubId: true,
    requirePreview: true,
    trialBadgeLabel: t("aurora.trial_badge"),
    tariffFallbackLabel: t("aurora.checkout_tariff_fallback"),
    extraProviders: ["lavatop", "overpay"],
    providerLabels: { yookassa: t("aurora.payment_card_sbp") },
    payErrorMessage: t("aurora.pay_error"),
  });

  useEffect(() => {
    setPreviewEnabled(paySheet);
  }, [paySheet, setPreviewEnabled]);

  async function pay() {
    if (!state.token || !selectedTariffId || !selectedMethod || !previewReady) return;
    if (selectedMethod.kind === "balance") {
      const info = await prepareBalancePayment(true);
      if (info && (info.willReplace || info.isTrial)) {
        const prev = info.preview;
        const isTrial = info.isTrial;
        const trialName = extendTarget?.trialName
          || prev?.subscription?.trialName
          || checkoutTrial?.trialName
          || extendTarget?.label
          || checkoutTrial?.label
          || prev?.subscription?.tariffName
          || t("aurora.trial_badge");
        const subName = prev?.subscription?.tariffName ? `«${prev.subscription.tariffName}»` : t("aurora.balance_current_subscription");
        const bodyMain = isTrial
          ? t("aurora.convert_trial_body", {
              trial: trialName,
              tariff: checkoutTariffName,
              days: t("aurora.trial_days", { count: prev?.purchasedDays ?? days }),
            })
          : prev!.mode === "replace"
            ? t("aurora.balance_replace_body", { remaining: prev!.remainingDays ?? 0, purchased: prev!.purchasedDays ?? 0 })
            : prev!.mode === "extend"
              ? t("aurora.balance_extend_body")
              : (prev!.remainingDays ?? 0) > 0
                ? t("aurora.balance_convert_body", { remaining: prev!.remainingDays ?? 0, converted: prev!.convertedDays ?? 0 })
                : t("aurora.balance_convert_body_zero");
        const othersLine = (prev?.othersToRemove ?? 0) > 0 ? `\n${t("aurora.balance_others", { count: prev!.othersToRemove ?? 0 })}` : "";
        setBalConfirm({
          title: isTrial
            ? t("aurora.balance_trial_title", { tariff: checkoutTariffName })
            : prev!.mode === "extend"
              ? t("aurora.balance_extend_title", { name: subName })
              : t("aurora.balance_replace_title", { name: subName }),
          body: bodyMain + othersLine,
        });
        return;
      }
    }
    await doPay();
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

  const currentCat = selectedCatId === "__all"
    ? { id: "__all", name: t("aurora.all_categories"), emojiKey: null, emoji: "", tariffs: displayCategories.flatMap((category) => category.tariffs) } as PublicTariffCategory
    : displayCategories.find((category) => category.id === selectedCatId) ?? displayCategories[0];

  const renewalNotice = (<>
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
            <p className="text-[14px] font-bold">
              {extendTarget.isTrial ? t("aurora.renewal_trial_title") : t("aurora.renewal_title")}
            </p>
            {extendTarget.isTrial ? (
              <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--au-muted)]">
                {t("aurora.renewal_trial_body", { label: extendTarget.label })}
              </p>
            ) : (
              <p className="truncate text-[12.5px] text-[var(--au-muted)]">{extendTarget.label}</p>
            )}
          </div>
        </div>
        {extendTarget.extraDevices > 0 && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setExtKeepExtras(true)} className={choiceCls(extKeepExtras)}>
              <p className="text-[13px] font-bold">{t("aurora.renewal_extra_devices", { count: extendTarget.extraDevices })}</p>
              <p className="mt-0.5 text-[12px] text-[var(--au-muted)]">
                {t("aurora.renewal_keep", { price: fmtPrice(keepExtrasCost, currency) })}
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
      const trialsOwned = ownedTrials;
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
      const dup = duplicateSubscription;
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
              {convPreview.subscription.isTrial
                ? t("aurora.convert_trial_title")
                : convPreview.mode === "extend"
                  ? t("aurora.convert_extend_title")
                  : convPreview.mode === "replace"
                    ? t("aurora.convert_replace_title")
                    : t("aurora.convert_update_title")}
            </p>
            <p className="text-[13px] leading-relaxed text-[var(--au-muted)]">
              {convPreview.subscription.isTrial
                ? t("aurora.convert_trial_body", {
                    trial: extendTarget?.trialName
                      || convPreview.subscription.trialName
                      || extendTarget?.label
                      || convPreview.subscription.tariffName
                      || t("aurora.trial_badge"),
                    tariff: checkoutTariffName,
                    days: t("aurora.trial_days", { count: convPreview.purchasedDays ?? days }),
                  })
                : convPreview.mode === "extend"
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
          {extendTarget?.isTrial
            ? t("aurora.renewal_trial_subtitle")
            : extendTarget ? t("aurora.renewal_subtitle") : t("aurora.tariffs_subtitle")}
        </p>
      </header>

      {renewalNotice}

      {trialConversionBlocked && (
        <section className={noticeCls("amber")}>
          <p className="text-[14px] font-bold">{t("aurora.trial_convert_disabled_title")}</p>
          <p className="mt-1 text-[13px] leading-relaxed opacity-80">{t("aurora.trial_convert_disabled_body")}</p>
        </section>
      )}

      {!extendTarget && !trialConversionBlocked && activeTrial && (
        <section className={noticeCls("accent")}>
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--au-from),var(--au-to))] text-white">
              <Gift className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[14px] font-bold">{t("aurora.trial_active_title")}</p>
              <p className="mt-0.5 text-[12.5px] leading-relaxed opacity-80">{t("aurora.trial_active_body")}</p>
            </div>
          </div>
        </section>
      )}

      {mySubs.length === 0 && hasTrials && (
        <section className={noticeCls("accent")}>
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--au-from),var(--au-to))] text-white">
              <Gift className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-bold">{t("aurora.trial_banner_title")}</p>
              <p className="mt-0.5 text-[12.5px] leading-snug opacity-80">{t("aurora.trial_banner_hint")}</p>
            </div>
            <button
              type="button"
              onClick={() => setTrialsSheetOpen(true)}
              className="shrink-0 rounded-full bg-[var(--au-from)] px-4 py-2 text-[13px] font-bold text-white transition-transform active:scale-[0.98]"
            >
              {t("aurora.try_trial")}
            </button>
          </div>
        </section>
      )}

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
                setPayError(null);
                setConvKeepExtras(true);
                setReplaceTrialChoice(null);
                clearPromo();
                setPaySheet(true);
              }}
            />)}
          </div>
        </section>}
      </div>

      <AuroraSheet
        open={paySheet && !!currentTariff}
        onClose={() => { setPaySheet(false); setPayError(null); setBalConfirm(null); }}
        title={balConfirm ? t("aurora.checkout_confirm_title") : t("aurora.checkout_title")}
        footer={
          <div className="space-y-2 pb-1">
            {payError && <AuNotice tone="error">{payError}</AuNotice>}
            {balConfirm ? (
              <>
                <AuButton
                  onClick={() => void doPay()}
                  disabled={paying || !selectedMethod}
                  loading={paying}
                >
                  {paying
                    ? t("aurora.pay_creating")
                    : t("aurora.balance_confirm_pay", { amount: fmtPrice(finalPrice, currency) })}
                </AuButton>
                <AuButton
                  variant="surface"
                  onClick={() => { setBalConfirm(null); setPayError(null); }}
                  disabled={paying}
                >
                  {t("aurora.balance_back_to_methods")}
                </AuButton>
              </>
            ) : (
              <AuButton
                onClick={pay}
                disabled={paying || !selectedMethod || !currentTariff || !previewReady}
                loading={paying}
              >
                {paying ? t("aurora.pay_creating") : t("aurora.pay_for", { amount: fmtPrice(finalPrice, currency) })}
              </AuButton>
            )}
          </div>
        }
      >
        {balConfirm ? (
          <div className="space-y-3 pb-2">
            <div className="rounded-[22px] bg-[var(--au-surface)] p-5">
              <h3 className="text-[19px] font-extrabold leading-tight text-[var(--au-ink)]">{balConfirm.title}</h3>
              <p className="mt-2.5 whitespace-pre-line text-[14px] leading-relaxed text-[var(--au-muted)]">{balConfirm.body}</p>
              <div className="mt-4 flex items-center justify-between gap-3 rounded-[16px] bg-[var(--au-bg)] px-4 py-3">
                <span className="text-[13px] font-semibold text-[var(--au-muted)]">{t("aurora.checkout_total")}</span>
                <span className="text-[21px] font-extrabold tabular-nums text-[var(--au-ink)]">{fmtPrice(finalPrice, currency)}</span>
              </div>
              <p className="mt-3 text-[12.5px] leading-relaxed text-[var(--au-muted)]">
                {t("aurora.checkout_charge_confirm", { amount: fmtPrice(finalPrice, currency) })}
              </p>
            </div>
          </div>
        ) : (
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
              <p className="mt-0.5 text-[24px] font-extrabold tabular-nums text-[var(--au-ink)]">{fmtPrice(finalPrice, currency)}</p>
              {(hasPersonalDiscount || promoDiscount > 0) && (
                <p className="mt-0.5 text-[12px] font-semibold tabular-nums text-[var(--au-muted)] line-through">{fmtPrice(totalPrice, currency)}</p>
              )}
            </div>
          </div>

          {hasPersonalDiscount && (
            <div className="flex items-center justify-between gap-3 rounded-[16px] bg-[color-mix(in_srgb,#f59e0b_10%,var(--au-bg))] px-4 py-2.5">
              <span className="text-[13px] font-bold text-[var(--au-ink)]">🎰 {t("aurora.personal_discount_badge", { percent: personalDiscountPct })}</span>
              <span className="text-[13px] font-extrabold tabular-nums text-emerald-600 dark:text-emerald-400">−{fmtPrice(personalDiscountAmount, currency)}</span>
            </div>
          )}

          {currentTariff && <dl className="au-tariff-checkout-facts">
            <div><dt>{t("aurora.checkout_devices_in_plan")}</dt><dd>{auroraDevices(currentTariff, t)}</dd></div>
            <div><dt>{t("aurora.traffic")}</dt><dd>{auroraTraffic(currentTariff, t).value}</dd></div>
          </dl>}

          {!extendTarget && currentTariff && (currentTariff.maxExtraDevices ?? 0) > 0 && (
            <div className="flex items-center justify-between gap-3 rounded-[18px] bg-[var(--au-surface)] px-4 py-3">
              <div className="min-w-0">
                <p className="text-[13.5px] font-semibold">{t("aurora.checkout_extra_devices")}</p>
                <p className="text-[11.5px] text-[var(--au-muted)]">{extrasTotal > 0 ? `+${fmtPrice(extrasTotal, currency)}` : t("aurora.checkout_extra_devices_hint")}</p>
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
            {extrasTotal > 0 && <div><dt>{t("aurora.checkout_extra_line")}</dt><dd>+{fmtPrice(extrasTotal, currency)}</dd></div>}
            {personalDiscountAmount > 0 && <div><dt>{t("aurora.checkout_personal_discount_line")}</dt><dd>−{fmtPrice(personalDiscountAmount, currency)}</dd></div>}
            {promoDiscount > 0 && <div><dt>{t("aurora.checkout_promo_line")}</dt><dd>−{fmtPrice(promoDiscount, currency)}</dd></div>}
            {(extendExtrasCost + convExtendExtrasCost) > 0 && <div><dt>{t("aurora.checkout_saved_line")}</dt><dd>+{fmtPrice(extendExtrasCost + convExtendExtrasCost, currency)}</dd></div>}
          </dl>

          <div>
            {extendTarget ? renewalNotice : previewReady ? purchaseNotices : previewError ? (
              <div role="alert" className="rounded-[18px] bg-[var(--au-surface)] p-4 text-[13px]">
                <p>{t("aurora.checkout_check_failed")}</p>
                <button type="button" className="mt-3 min-h-11 rounded-xl bg-[var(--au-bg)] px-4 font-bold" onClick={retryPreview}>{t("aurora.checkout_retry")}</button>
              </div>
            ) : (
              <p role="status" className="flex items-center gap-2 text-[13px] text-[var(--au-muted)]">
                <Loader2 className="h-4 w-4 animate-spin" />{t("aurora.checkout_checking")}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 rounded-[18px] border border-[color-mix(in_srgb,var(--au-muted)_22%,transparent)] bg-[color-mix(in_srgb,var(--au-surface)_85%,var(--au-bg))] p-1.5 transition-all focus-within:border-[var(--au-from)]">
            <Tag className="ml-3 h-4 w-4 shrink-0 text-[var(--au-muted)]" />
            <input
              value={promoInput}
              onChange={(e) => { setPromoInput(e.target.value); setPromoMsg(null); }}
              placeholder={t("aurora.promo_placeholder")}
              className="min-w-0 flex-1 border-none bg-transparent px-1 py-2.5 text-[16px] text-[var(--au-ink)] shadow-none outline-none ring-0 placeholder:text-[var(--au-muted)] focus:outline-none focus:ring-0 focus-visible:!outline-none focus-visible:!ring-0"
            />
            <button
              onClick={applyPromo}
              disabled={promoBusy || !promoInput.trim()}
              className="shrink-0 whitespace-nowrap rounded-[13px] border border-[color-mix(in_srgb,var(--au-muted)_18%,transparent)] bg-[var(--au-bg)] px-4 py-2.5 text-[13px] font-bold text-[var(--au-ink)] transition-all hover:bg-[color-mix(in_srgb,var(--au-from)_15%,var(--au-bg))] disabled:opacity-45"
            >
              {promoBusy ? "…" : promoApplied ? <Check className="inline h-4 w-4 text-emerald-500" /> : <span className="inline-flex items-center gap-1">{t("aurora.promo_check")}<ArrowRight className="h-3.5 w-3.5" /></span>}
            </button>
          </div>
          {promoMsg && (
            <p className={cn("px-1 text-[13px]", promoApplied ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>{promoMsg}</p>
          )}

          {checkoutIsTrial && (
            <div className="rounded-[20px] bg-[color-mix(in_srgb,var(--au-from)_9%,var(--au-bg))] p-4">
              <p className="flex items-center gap-2 text-[14px] font-bold text-[var(--au-ink)]">
                <RefreshCw className="h-4 w-4 shrink-0 text-[var(--au-from)]" />
                {t("aurora.checkout_trial_notice_title")}
              </p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--au-muted)]">
                {t("aurora.checkout_trial_notice_body", { trial: checkoutTrialName, tariff: checkoutTariffName })}
              </p>
            </div>
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
        )}
      </AuroraSheet>

      <AuroraTrialsSheet
        open={trialsSheetOpen}
        onClose={() => setTrialsSheetOpen(false)}
        onActivated={() => {
          void refetchTrials();
          void refreshSubscriptions();
          void refreshProfile();
        }}
      />
    </div>
  );
}
